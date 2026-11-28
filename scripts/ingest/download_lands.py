#!/usr/bin/env python3
"""Downloaders for the Länder without a plain file directory.

  python3 download_lands.py sh   # Schleswig-Holstein: ATOM -> per-Gemeinde WFS GML
  python3 download_lands.py he   # Hessen: Downloadcenter REST -> per-Kreis NAS zips
  python3 download_lands.py sl   # Saarland: paged INSPIRE WFS -> GML pages
  python3 download_lands.py bw   # Baden-Württemberg: per-Gemarkung Shape zips

Each writes into downloads/<land>/ and skips files that already exist, so an
interrupted run resumes. Sources and licenses: see README (Map explorer) and
docs/ingest notes; all verified 2026-11-27.
"""

from __future__ import annotations

import re
import sys
import time
from pathlib import Path

import requests

UA = {"User-Agent": "1sense-ingest/1.0"}


def fetch(url: str, dest: Path, retries: int = 4) -> bool:
    if dest.exists() and dest.stat().st_size > 0:
        return False
    for attempt in range(1, retries + 1):
        try:
            # (connect, read) timeouts: a stalled transfer fails fast and the
            # retry loop starts it again instead of hanging for many minutes.
            with requests.get(url, timeout=(30, 120), headers=UA, stream=True) as r:
                r.raise_for_status()
                tmp = dest.with_suffix(dest.suffix + ".part")
                with open(tmp, "wb") as fh:
                    for chunk in r.iter_content(1 << 20):
                        fh.write(chunk)
                tmp.rename(dest)
            return True
        except Exception as e:  # noqa: BLE001
            if attempt == retries:
                print(f"  FAILED {url}: {e}")
                return False
            time.sleep(5 * attempt)
    return False


def run_sh() -> None:
    out = Path("downloads/sh")
    out.mkdir(parents=True, exist_ok=True)
    feed_url = ("https://dienste.gdi-sh.de/SH_OpenGBD/feeds/"
                "Atom_SH_ALKIS_vereinf_OpenGBD/Atom_SH_ALKIS_vereinf_OpenGBD.xml")
    feed = requests.get(feed_url, timeout=120, headers=UA).text
    gkz = sorted(set(re.findall(r"gemeindeschluessel=(\d{8})", feed)))
    if not gkz:
        # Subfeeds may carry the key — enumerate them one level down.
        subs = sorted(set(re.findall(r'href="(https://[^"]+\.xml)"', feed)))
        print(f"no direct keys; scanning {len(subs)} subfeeds")
        for s in subs:
            try:
                sub = requests.get(s, timeout=60, headers=UA).text
                gkz.extend(re.findall(r"gemeindeschluessel=(\d{8})", sub))
            except Exception as e:  # noqa: BLE001
                print(f"  subfeed failed {s}: {e}")
        gkz = sorted(set(gkz))
    print(f"SH: {len(gkz)} Gemeinden")
    base = ("https://dienste.gdi-sh.de/WFS_SH_ALKIS_vereinf_OpenGBD"
            "?Request=GetFeature&Service=WFS&Version=2.0.0"
            "&StoredQuery_ID=GetFlstByGemeinde&gemeindeschluessel=")
    done = 0
    for g in gkz:
        if fetch(base + g, out / f"{g}.gml"):
            done += 1
        if done and done % 100 == 0:
            print(f"  {done} fetched")
    print("SH done")


def run_he() -> None:
    out = Path("downloads/he")
    out.mkdir(parents=True, exist_ok=True)
    base = ("https://gds.hessen.de/INTERSHOP/rest/WFS/HLBG-Geodaten-Site/-/"
            "downloadcenter?path=Liegenschaftskataster/"
            "Bestandsdatenausgabe%20Grundriss%20(xml)")
    top = requests.get(base + "&navigation=all", timeout=120, headers=UA).json()

    def walk(obj, found):
        if isinstance(obj, dict):
            uri = None
            if "downloadLink" in obj and isinstance(obj["downloadLink"], dict):
                uri = obj["downloadLink"].get("uri")
            for k in ("uri", "url"):
                if uri is None and isinstance(obj.get(k), str) and obj[k].endswith(".zip"):
                    uri = obj[k]
            if uri and ".zip" in uri:
                found.add(uri)
            for v in obj.values():
                walk(v, found)
        elif isinstance(obj, list):
            for v in obj:
                walk(v, found)

    # Kreis folder names from the top listing, then each Kreis's package zip.
    names = sorted(set(re.findall(r'"name"\s*:\s*"([^"]+)"', requests.get(
        base + "&navigation=all", timeout=120, headers=UA).text)))
    kreise = [n for n in names if not n.lower().endswith(".zip")]
    print(f"HE: {len(kreise)} Kreis folders (sample {kreise[:3]})")
    for kreis in kreise:
        sub = requests.get(
            f"{base}/{requests.utils.quote(kreis)}&navigation=all",
            timeout=120, headers=UA).json()
        found: set[str] = set()
        walk(sub, found)
        pkt = [u for u in found if "PKT" in u] or sorted(found)
        if not pkt:
            print(f"  WARNING: no zips for {kreis}")
            continue
        for u in (pkt if "PKT" in pkt[0] else found):
            url = u if u.startswith("http") else "https://gds.hessen.de" + u
            name = re.sub(r"[^\w.-]", "_", url.rsplit("/", 1)[-1].split("?")[0])
            if fetch(url, out / f"{kreis}_{name}"):
                print(f"  {kreis}: {name}")
            if "PKT" in u:
                break  # one package per Kreis is enough
    print("HE done")


def run_sl() -> None:
    out = Path("downloads/sl")
    out.mkdir(parents=True, exist_ok=True)
    base = ("https://geoportal.saarland.de/gdi-sl/inspirewfs_Flurstuecke_Grundstuecke_ALKIS"
            "?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature"
            "&TYPENAMES=cp:CadastralParcel&NAMESPACES=xmlns(cp,"
            "http://inspire.ec.europa.eu/schemas/cp/4.0)")
    # deegree reports numberReturned="0" while streaming features (see the
    # comment it embeds about WFS CR 144) — count the members we actually got
    # and advance by that.
    count = 50000
    start = 0
    page = 0
    while True:
        dest = out / f"page_{page:04d}.gml"
        url = f"{base}&COUNT={count}&STARTINDEX={start}"
        fetch(url, dest)
        returned = dest.read_bytes().count(b"<wfs:member>") if dest.exists() else 0
        print(f"  page {page}: {returned} features")
        if returned == 0:
            break
        start += returned
        page += 1
    print("SL done")


def run_be() -> None:
    # One-shot GetFeature gets connection-reset after ~17 MB — page instead.
    out = Path("downloads/be")
    out.mkdir(parents=True, exist_ok=True)
    (out / "be_flurstuecke.gml").unlink(missing_ok=True)  # broken one-shot dump
    base = ("https://gdi.berlin.de/services/wfs/alkis_flurstuecke"
            "?service=WFS&version=2.0.0&request=GetFeature"
            "&typenames=alkis_flurstuecke:flurstuecke")
    count = 25000
    start = 0
    page = 0
    while True:
        dest = out / f"page_{page:04d}.gml"
        fetch(f"{base}&COUNT={count}&STARTINDEX={start}", dest)
        returned = dest.read_bytes().count(b"<wfs:member>") if dest.exists() else 0
        print(f"  page {page}: {returned} features")
        if returned == 0:
            break
        start += returned
        page += 1
    print("BE done")


def run_th() -> None:
    out = Path("downloads/th")
    out.mkdir(parents=True, exist_ok=True)
    feed = requests.get(
        "https://www.geoproxy.geoportal-th.de/inspire-dl/atom/DataSet/"
        "DataSet_0fe95724-6a09-47d3-afcb-d31d14a72598.xml",
        timeout=120, headers=UA).text
    urls = sorted(set(
        u.replace("http://", "https://", 1)
        for u in re.findall(
            r"https?://www\.geoproxy\.geoportal-th\.de/download-service/inspire/"
            r"annex1/cp/25832/Gemarkung_\d+\.zip", feed)))
    print(f"TH: {len(urls)} Gemarkung files")
    for i, u in enumerate(urls, 1):
        fetch(u, out / u.rsplit("/", 1)[-1])
        if i % 200 == 0:
            print(f"  {i}/{len(urls)}")
    print("TH done")


def run_bw() -> None:
    out = Path("downloads/bw")
    out.mkdir(parents=True, exist_ok=True)
    # Gemarkung keys + names from the Land-wide admin-boundaries product.
    vg = out / "_vg" / "Verw-Grenzen_ALKIS.zip"
    vg.parent.mkdir(exist_ok=True)
    fetch("https://opengeodata.lgl-bw.de/data/vg/Verw-Grenzen_ALKIS.zip", vg)
    import io
    import zipfile

    import pyogrio

    import geopandas as gpd

    with zipfile.ZipFile(vg) as zf:
        shp = next(n for n in zf.namelist()
                   if n.lower().endswith("v_al_gemarkung.shp"))
    gdf = gpd.read_file(f"/vsizip/{vg}/{shp}")
    gemarkungen = sorted(
        ("08" + str(row["gemarkung_"]).zfill(4), str(row["gemarkun_1"]))
        for _, row in gdf.iterrows()
    )
    print(f"BW: {len(gemarkungen)} Gemarkungen from Verw-Grenzen")
    base = "https://opengeodata.lgl-bw.de/data/alkis/"
    misses = []
    for i, (key, name) in enumerate(gemarkungen, 1):
        dest = out / f"ALKIS-oE_{key}_shp.zip"
        if dest.exists() and dest.stat().st_size > 0:
            continue
        # The file name embeds the Gemarkung name; spellings with spaces are
        # not fully predictable, so probe a few variants with HEAD first.
        got = False
        for variant in (name, name.replace(" ", "-"), name.replace(" ", "_"),
                        name.replace(" ", "")):
            url = f"{base}ALKIS-oE_{key}_{requests.utils.quote(variant)}_shp.zip"
            try:
                if requests.head(url, timeout=30, headers=UA).status_code == 200:
                    got = fetch(url, dest, retries=3)
                    break
            except Exception:  # noqa: BLE001
                continue
        if not got and not dest.exists():
            misses.append((key, name))
        if i % 200 == 0:
            print(f"  {i}/{len(gemarkungen)} ({len(misses)} misses)")
    (out / "_misses.txt").write_text(
        "\n".join(f"{k} {n}" for k, n in misses), encoding="utf-8")
    print(f"BW done; {len(misses)} misses listed in downloads/bw/_misses.txt")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else ""
    {"sh": run_sh, "he": run_he, "sl": run_sl, "bw": run_bw,
     "be": run_be, "th": run_th}.get(
        which, lambda: sys.exit("usage: download_lands.py sh|he|sl|bw|be|th"))()
