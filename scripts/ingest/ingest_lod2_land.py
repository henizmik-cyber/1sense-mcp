#!/usr/bin/env python3
"""LoD2 3D buildings for the Länder beyond NRW (Phase 3).

Same output contract as ingest_lod2.py (NRW): one NDJSON per downloaded
file under out/tiles/lod2_<land>/, each feature {"h": height_m} with the
ground-surface footprint in WGS84. Files are streamed: download -> parse ->
delete, and a finished file is skipped on re-run, so runs resume for free.

Differences from NRW, all verified 2026-11-28 (docs/germany-sources.md):
  * CRS is read per file from its srsName (UTM33 in BB, BE, MV, SN);
  * sources are plain .gml/.xml, zips, zip-in-zip (Bremen), or a few huge
    zips (Hamburg, Sachsen-Anhalt) whose entries are parsed one by one;
  * each Land has its own listing (S3 bucket, Metalink, Apache index, Atom,
    GeoJSON index, REST).

Not covered here: Sachsen and Baden-Württemberg (tile lists need the
batch-page JSON / vector-tile grid — separate pass), Thüringen (download
servers offline since ~2026-11-20), Saarland (LoD2 not open as CityGML).

Usage:
  python3 ingest_lod2_land.py --land 03 --workers 8
  python3 ingest_lod2_land.py --land 09 --limit 20      # smoke run
"""

from __future__ import annotations

import argparse
import html
import json
import re
import tempfile
import zipfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import requests

UA = {"User-Agent": "1sense-ingest/1.0"}

# ---------- per-file parsing ----------

_transformers: dict[int, object] = {}


def _tf(epsg: int):
    tf = _transformers.get(epsg)
    if tf is None:
        from pyproj import Transformer

        tf = Transformer.from_crs(epsg, 4326, always_xy=True)
        _transformers[epsg] = tf
    return tf


def localname(tag) -> str:
    if not isinstance(tag, str):
        return ""
    return tag.rsplit("}", 1)[-1]


def detect_epsg(head: bytes, default: int) -> int:
    text = head.decode("utf-8", "replace")
    if re.search(r"25833|UTM_?33|UTM33", text):
        return 25833
    if re.search(r"25832|UTM_?32|UTM32", text):
        return 25832
    return default


def parse_poslist(text: str):
    vals = text.split()
    if len(vals) < 9 or len(vals) % 3:
        return [], []
    ring, zs = [], []
    for i in range(0, len(vals), 3):
        ring.append((float(vals[i]), float(vals[i + 1])))
        zs.append(float(vals[i + 2]))
    return ring, zs


def extract_features(elem, epsg: int) -> list[dict]:
    """One Building/BuildingPart -> GeoJSON features (footprint + height)."""
    tf = _tf(epsg)
    height = None
    rings: list[list[tuple[float, float]]] = []
    ground_z: list[float] = []
    all_z: list[float] = []
    for node in elem.iter():
        name = localname(node.tag)
        if name == "measuredHeight" and node.text:
            try:
                height = float(node.text)
            except ValueError:
                pass
        elif name == "GroundSurface":
            for pos in node.iter():
                if localname(pos.tag) == "posList" and pos.text:
                    ring, zs = parse_poslist(pos.text)
                    if len(ring) >= 4:
                        rings.append(ring)
                        ground_z.extend(zs)
                        all_z.extend(zs)
        elif name == "posList" and node.text:
            vals = node.text.split()
            if len(vals) >= 3 and len(vals) % 3 == 0:
                try:
                    all_z.extend(float(v) for v in vals[2::3])
                except ValueError:
                    pass
    if not rings:
        return []
    if height is None and all_z and ground_z:
        height = max(all_z) - min(ground_z)
    if height is None or height <= 0 or height > 400:
        return []  # no height, or an implausible one: never guess
    polygons = []
    for ring in rings:
        xs, ys = tf.transform([p[0] for p in ring], [p[1] for p in ring])
        polygons.append([[[round(x, 7), round(y, 7)] for x, y in zip(xs, ys)]])
    geometry = ({"type": "Polygon", "coordinates": polygons[0]} if len(polygons) == 1
                else {"type": "MultiPolygon", "coordinates": polygons})
    return [{"type": "Feature", "properties": {"h": round(height, 1)}, "geometry": geometry}]


def parse_citygml(fh, out, default_epsg: int) -> int:
    """Stream one CityGML document from a binary file object into `out`."""
    from lxml import etree

    head = fh.read(65536)
    epsg = detect_epsg(head, default_epsg)

    class Chain:
        """Replays the sniffed head, then the rest of the stream."""

        def __init__(self, first: bytes, rest):
            self.first, self.rest = first, rest

        def read(self, n=-1):
            if self.first:
                chunk = self.first if n < 0 else self.first[:n]
                self.first = self.first[len(chunk):]
                return chunk
            return self.rest.read(n)

    count = 0
    for _, elem in etree.iterparse(Chain(head, fh), events=("end",), huge_tree=True):
        if localname(elem.tag) in ("Building", "BuildingPart"):
            for feat in extract_features(elem, epsg):
                json.dump(feat, out, separators=(",", ":"))
                out.write("\n")
                count += 1
            elem.clear()
            parent = elem.getparent()
            if parent is not None:
                parent.remove(elem)
    return count


def extract_inspire_bu(elem) -> list[dict]:
    """INSPIRE bu-core3d Building (Saarland): no semantic GroundSurface and
    no measuredHeight. Coordinates are lat lon h (EPSG:7423 = ETRS89 +
    EVRS; ETRS89 is within ~1 m of WGS84, so no reprojection for display).
    Footprint = the horizontal surface(s) at the building's lowest level;
    fallback = the union of all surfaces projected onto the ground.
    Height = bu-base:heightAboveGround, fallback max(z) - min(z)."""
    from shapely.geometry import Polygon, mapping
    from shapely.ops import unary_union

    heights: list[float] = []  # typically eave + highest point: use the max
    surfaces: list[tuple[list[tuple[float, float]], list[float]]] = []
    for node in elem.iter():
        name = localname(node.tag)
        if name == "value" and node.text and \
                localname(node.getparent().tag) == "HeightAboveGround":
            try:
                heights.append(float(node.text))
            except ValueError:
                pass
        elif name == "posList" and node.text:
            vals = node.text.split()
            if len(vals) < 12 or len(vals) % 3:
                continue
            try:
                f = [float(v) for v in vals]
            except ValueError:
                continue
            ring = [(f[i + 1], f[i]) for i in range(0, len(f), 3)]  # lat lon -> lng lat
            surfaces.append((ring, f[2::3]))
    if not surfaces:
        return []
    zmin = min(min(z) for _, z in surfaces)
    zmax = max(max(z) for _, z in surfaces)
    ground = [Polygon(r) for r, z in surfaces
              if max(z) - min(z) < 0.05 and abs(min(z) - zmin) < 0.1 and len(r) >= 4]
    ground = [p for p in ground if p.is_valid and p.area > 0]
    if ground:
        footprint = unary_union(ground)
    else:
        projected = [Polygon(r).buffer(0) for r, _ in surfaces if len(r) >= 4]
        footprint = unary_union([p for p in projected if p.area > 0])
    if footprint.is_empty:
        return []
    height = max(heights) if heights else zmax - zmin
    if height is None or height <= 0 or height > 400:
        return []
    geometry = json.loads(json.dumps(mapping(footprint)))
    from common import round_coords

    return [{"type": "Feature", "properties": {"h": round(height, 1)},
             "geometry": round_coords(geometry, 7)}]


def parse_inspire_bu(fh, out) -> int:
    from lxml import etree

    count = 0
    for _, elem in etree.iterparse(fh, events=("end",), huge_tree=True):
        if localname(elem.tag) == "Building" and "bu-core3d" in str(elem.tag) or \
                (localname(elem.tag) == "Building" and "inspire.ec.europa.eu" in str(elem.tag)):
            for feat in extract_inspire_bu(elem):
                json.dump(feat, out, separators=(",", ":"))
                out.write("\n")
                count += 1
            elem.clear()
            parent = elem.getparent()
            if parent is not None:
                parent.remove(elem)
    return count


def parse_zip(path_or_file, out, default_epsg: int) -> int:
    count = 0
    with zipfile.ZipFile(path_or_file) as zf:
        for info in zf.infolist():
            n = info.filename.lower()
            if n.endswith((".gml", ".xml")):
                with zf.open(info) as fh:
                    count += parse_citygml(fh, out, default_epsg)
            elif n.endswith(".zip"):  # zip-in-zip (Bremen): spill the inner zip to disk
                with tempfile.NamedTemporaryFile(suffix=".zip") as tmp:
                    with zf.open(info) as fh:
                        while chunk := fh.read(1 << 22):
                            tmp.write(chunk)
                    tmp.flush()
                    count += parse_zip(tmp.name, out, default_epsg)
    return count


def process_job(job: dict, out_dir: str, default_epsg: int) -> tuple[str, int, str | None]:
    """Download one source file to a temp file, parse it, delete it."""
    name = re.sub(r"[^\w.-]", "_", job["name"])
    out_path = Path(out_dir) / (name + ".ndjson")
    if out_path.exists():
        return name, -1, None
    tmp_dir = Path(out_dir) / "_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp = tmp_dir / name
    try:
        import time

        for attempt in range(1, 7):
            try:
                with requests.get(job["url"], timeout=(30, 300), headers=UA, stream=True) as r:
                    r.raise_for_status()
                    with open(tmp, "wb") as fh:
                        for chunk in r.iter_content(1 << 20):
                            fh.write(chunk)
                break
            except Exception:  # noqa: BLE001
                if attempt == 6:
                    raise
                time.sleep(min(15 * attempt, 90))  # back off: busy servers recover
        # "Soft 200" outage pages (seen at Thüringen) are tiny HTML documents.
        if tmp.stat().st_size < 4096 and b"<html" in tmp.read_bytes()[:2048].lower():
            return name, 0, "server returned an HTML page instead of data"
        part = out_path.with_suffix(".part")
        with open(part, "w", encoding="utf-8") as out:
            if zipfile.is_zipfile(tmp):
                n = parse_zip(tmp, out, default_epsg)
            else:
                with open(tmp, "rb") as fh:
                    head = fh.read(8192)
                    fh.seek(0)
                    if b"bu-core3d" in head:  # INSPIRE buildings (Saarland)
                        n = parse_inspire_bu(fh, out)
                    else:
                        n = parse_citygml(fh, out, default_epsg)
        part.rename(out_path)
        return name, n, None
    except Exception as e:  # noqa: BLE001
        return name, 0, f"{type(e).__name__}: {str(e)[:200]}"
    finally:
        tmp.unlink(missing_ok=True)


# ---------- per-Land listings ----------

def hrefs(url: str, pattern: str) -> list[str]:
    text = requests.get(url, timeout=120, headers=UA).text
    found = re.findall(r'href="([^"]+)"', text)
    out = []
    for h in found:
        h = html.unescape(h)
        if re.search(pattern, h):
            out.append(h if h.startswith("http") else url.rstrip("/") + "/" + h.lstrip("./"))
    return sorted(set(out))


def list_ni() -> list[dict]:
    base = "https://lod2.s3.eu-de.cloud-object-storage.appdomain.cloud/"
    jobs, token = [], None
    while True:
        url = base + "?list-type=2" + (f"&continuation-token={requests.utils.quote(token)}" if token else "")
        text = requests.get(url, timeout=120, headers=UA).text
        for key in re.findall(r"<Key>([^<]+\.gml)</Key>", text):
            if "/" not in key:
                jobs.append({"url": base + key, "name": key})
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", text)
        if not m:
            break
        token = html.unescape(m.group(1))
    return jobs


def list_by() -> list[dict]:
    text = requests.get("https://geodaten.bayern.de/odd/a/lod2/citygml/meta/metalink/09.meta4",
                        timeout=300, headers=UA).text
    jobs = []
    for m in re.finditer(r'<file name="([^"]+)">(.*?)</file>', text, re.S):
        urls = re.findall(r"<url[^>]*>([^<]+)</url>", m.group(2))
        if urls:
            jobs.append({"url": urls[0].strip(), "name": m.group(1)})
    return jobs


def list_rp() -> list[dict]:
    return [{"url": u, "name": u.rsplit("/", 1)[-1]}
            for u in hrefs("https://geobasis-rlp.de/data/geb3dlo/current/gml/", r"\.gml$")]


def list_bb() -> list[dict]:
    return [{"url": u, "name": u.rsplit("/", 1)[-1]}
            for u in hrefs("https://data.geobasis-bb.de/geobasis/daten/3d_gebaeude/lod2_gml/",
                           r"lod2_.*\.zip$")]


def list_be() -> list[dict]:
    text = requests.get("https://gdi.berlin.de/data/a_lod2/atom/0.atom", timeout=120,
                        headers=UA).text
    urls = sorted(set(html.unescape(u) for u in re.findall(r'href="([^"]+\.zip)"', text)))
    return [{"url": u, "name": u.rsplit("/", 1)[-1]} for u in urls]


def list_mv() -> list[dict]:
    text = requests.get("https://www.geodaten-mv.de/dienste/gebaeude_atom?type=dataset"
                        "&id=8397b554-5cb9-4274-8be8-c20490d9a6e8", timeout=300,
                        headers=UA).text
    urls = sorted(set(html.unescape(u) for u in
                      re.findall(r'href="([^"]*gebaeude_download[^"]*)"', text)))
    return [{"url": u, "name": re.search(r"file=([^&]+)", u).group(1)} for u in urls
            if re.search(r"file=([^&]+)", u)]


def list_sh() -> list[dict]:
    idx = requests.get("https://geodaten.schleswig-holstein.de/gaialight-sh/_apps/dladownload/"
                       "single.php?file=LOD2_SH_Massendownload.geojson&id=4",
                       timeout=600, headers=UA).json()
    jobs = []
    for f in idx.get("features", []):
        link = (f.get("properties") or {}).get("data_link")
        if link:
            m = re.search(r"file=([^&]+)", link)
            jobs.append({"url": link, "name": m.group(1) if m else link.rsplit("/", 1)[-1]})
    return jobs


def list_sl() -> list[dict]:
    """Saarland: AdV LoD2 is shop-only; the INSPIRE BU-3D WFS is open
    (dl-de/by-2.0). Pages of 15,000 (server cap); deegree reports
    numberReturned=0 while streaming, so the total comes from a hits query."""
    base = ("https://geoportal.saarland.de/gdi-sl/inspirewfs_Gebaeude_3D_LoD2"
            "?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=bu-core3d:Building"
            "&NAMESPACES=xmlns(bu-core3d,http://inspire.ec.europa.eu/schemas/bu-core3d/4.0)")
    import time

    m = None
    for attempt in range(1, 9):
        try:
            hits = requests.get(base + "&RESULTTYPE=hits", timeout=300, headers=UA).text
            m = re.search(r'numberMatched="(\d+)"', hits)
        except Exception:  # noqa: BLE001
            m = None
        if m:
            break
        time.sleep(min(15 * attempt, 90))
    if not m:
        # Count measured 2026-11-28; pages past the true end come back
        # empty, so a stale count cannot corrupt the output.
        print("NOTE: hits query kept failing; using last measured count 738006")
        m = re.match(r"(\d+)", "738006")
    # 500 per page: the server's DB pool times out intermittently under load
    # (HTTP 500 "Timeout waiting for idle object"); small pages + retries + one
    # worker keep the crawl gentle and reliable.
    total, page = int(m.group(1)), 500
    return [{"url": f"{base}&COUNT={page}&STARTINDEX={s}", "name": f"sl_bu_{s:07d}.gml"}
            for s in range(0, total, page)]


def list_fixed(urls: list[str]) -> list[dict]:
    return [{"url": u, "name": u.rsplit("/", 1)[-1]} for u in urls]


def list_he() -> list[dict]:
    """Downloadcenter REST: Kreis navigation, 20 entries per page, URLs carry
    today's date — always taken fresh from the API."""
    base = ("https://gds.hessen.de/INTERSHOP/rest/WFS/HLBG-Geodaten-Site/-/downloadcenter"
            "?path=" + requests.utils.quote("3D-Daten/3D-Gebäudemodelle/3D-Gebäudemodelle LoD2"))
    top = requests.get(base + "&navigation=all", timeout=120, headers=UA).json()
    kreise = sorted(set(re.findall(r'"name"\s*:\s*"([^"]+)"', json.dumps(top, ensure_ascii=False))))
    jobs: dict[str, dict] = {}
    for kreis in kreise:
        if kreis.lower().endswith(".zip"):
            continue
        for page in range(1, 40):
            url = f"{base}{requests.utils.quote('/' + kreis)}&navigation=all&page={page}"
            try:
                data = requests.get(url, timeout=120, headers=UA).json()
            except Exception:  # noqa: BLE001
                break
            new = 0
            for uri in re.findall(r'"uri"\s*:\s*"([^"]+\.zip)"', json.dumps(data)):
                full = uri if uri.startswith("http") else "https://gds.hessen.de" + uri
                key = full.rsplit("/", 1)[-1]
                if key not in jobs:
                    jobs[key] = {"url": full, "name": f"{kreis}_{key}"}
                    new += 1
            if new == 0:
                break
    return list(jobs.values())


LANDS = {
    "01": ("Schleswig-Holstein", list_sh, 25832),
    "02": ("Hamburg", lambda: list_fixed(
        ["https://www.daten-hamburg.de/opendata/3d_stadtmodell_lod2/LoD2-DE_HH_2026-04-28.zip"]), 25832),
    "03": ("Niedersachsen", list_ni, 25832),
    "04": ("Bremen", lambda: list_fixed(
        ["https://gdi2.geo.bremen.de/inspire/download/LoD/data/LOD2_CITYGML_HB.zip",
         "https://gdi2.geo.bremen.de/inspire/download/LoD/data/LOD2_CITYGML_BHV.zip"]), 25832),
    "06": ("Hessen", list_he, 25832),
    "07": ("Rheinland-Pfalz", list_rp, 25832),
    "09": ("Bayern", list_by, 25832),
    "10": ("Saarland (INSPIRE BU-3D)", list_sl, 4326),
    "11": ("Berlin", list_be, 25833),
    "12": ("Brandenburg", list_bb, 25833),
    "13": ("Mecklenburg-Vorpommern", list_mv, 25833),
    "15": ("Sachsen-Anhalt", lambda: list_fixed(
        [f"https://www.geodatenportal.sachsen-anhalt.de/gfds_webshare/download/LVermGeo/"
         f"Geodatenportal/Online-Bereitstellung-LVermGeo/3D/LoD2-{i}.zip" for i in range(1, 5)]),
        25832),
}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--land", required=True, choices=sorted(LANDS))
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=None, help="only the first N files (smoke run)")
    ap.add_argument("--out", default="out")
    args = ap.parse_args()

    name, lister, default_epsg = LANDS[args.land]
    jobs = lister()
    if args.limit:
        jobs = jobs[: args.limit]
    if not jobs:
        raise SystemExit(f"ERROR: no files listed for {name} — check the source")
    out_dir = Path(args.out) / "tiles" / f"lod2_{args.land}"
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"{name}: {len(jobs)} file(s), {args.workers} workers -> {out_dir}", flush=True)

    done = skipped = feats = 0
    errors: list[str] = []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futs = [pool.submit(process_job, j, str(out_dir), default_epsg) for j in jobs]
        for fut in as_completed(futs):
            fname, n, err = fut.result()
            done += 1
            if err:
                errors.append(f"{fname}: {err}")
            elif n == -1:
                skipped += 1
            else:
                feats += n
            if done % 200 == 0 or done == len(jobs):
                print(f"  {done}/{len(jobs)} files, {feats} buildings, {skipped} skipped, "
                      f"{len(errors)} errors", flush=True)
    if errors:
        (out_dir / "_errors.txt").write_text("\n".join(errors), encoding="utf-8")
        print(f"errors listed in {out_dir / '_errors.txt'} — re-run to retry", flush=True)
    print(f"Done ({args.land}): {feats} new buildings, {skipped} already present, "
          f"{len(errors)} errors", flush=True)


if __name__ == "__main__":
    main()
