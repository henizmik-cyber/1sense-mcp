#!/usr/bin/env python3
"""Ingest NRW LoD2 building models into tile input for the map's 3D layer.

Source (verified 2026-11-27, license dl-de/zero-2.0):
  https://www.opengeodata.nrw.de/produkte/geobasis/3dg/lod2_gml/lod2_gml/
One plain CityGML file per 1-km kachel (~35k files, ~220 GB in all), named
LoD2_32_<E>_<N>_1_NW.gml. Far too large to keep, so this script streams:
download one kachel -> parse building footprints + heights -> write one
NDJSON per kachel under out/tiles/lod2/ -> delete the GML. A kachel whose
NDJSON already exists is skipped, so an interrupted run resumes for free.

Each feature is {"h": <height in m>} with the ground-surface footprint
(EPSG:25832 -> WGS84). BuildingParts become their own features (they carry
their own heights); a Building's remaining surfaces become one feature.

Afterwards concatenate + tile:
  cat out/tiles/lod2/*.ndjson > out/tiles/buildings.ndjson
  tippecanoe -o out/tiles/buildings.pmtiles -l buildings -Z14 -z16 -q --force \
    --read-parallel --drop-densest-as-needed out/tiles/buildings.ndjson

Usage:
  python3 ingest_lod2.py                 # full run (hours; resumable)
  python3 ingest_lod2.py --match _32_35  # subset by file-name fragment
  python3 ingest_lod2.py --workers 8
"""

from __future__ import annotations

import argparse
import json
import re
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

INDEX_URL = "https://www.opengeodata.nrw.de/produkte/geobasis/3dg/lod2_gml/lod2_gml/index.json"
BASE_URL = "https://www.opengeodata.nrw.de/produkte/geobasis/3dg/lod2_gml/lod2_gml/"

# Globals initialised once per worker process (pickling a Transformer is slow).
_transformer = None


def _get_transformer():
    global _transformer
    if _transformer is None:
        from pyproj import Transformer

        _transformer = Transformer.from_crs(25832, 4326, always_xy=True)
    return _transformer


def localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_poslist(text: str) -> tuple[list[tuple[float, float]], list[float]]:
    """3D posList -> ((x, y) ring, z values). Never guesses on malformed input."""
    vals = text.split()
    if len(vals) < 9 or len(vals) % 3:
        return [], []
    ring = []
    zs = []
    for i in range(0, len(vals), 3):
        ring.append((float(vals[i]), float(vals[i + 1])))
        zs.append(float(vals[i + 2]))
    return ring, zs


def extract_features(elem) -> list[dict]:
    """One CityGML Building/BuildingPart element -> GeoJSON features."""
    tf = _get_transformer()

    height = None
    rings_25832: list[list[tuple[float, float]]] = []
    ground_z: list[float] = []
    all_z: list[float] = []

    in_ground = 0
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
                        rings_25832.append(ring)
                        ground_z.extend(zs)
                        all_z.extend(zs)
        elif name == "posList" and node.text:
            # Roof/wall surfaces: only the z range matters (height fallback).
            vals = node.text.split()
            if len(vals) >= 3 and len(vals) % 3 == 0:
                all_z.extend(float(v) for v in vals[2::3])

    if not rings_25832:
        return []

    if height is None and all_z and ground_z:
        height = max(all_z) - min(ground_z)
    if height is None or height <= 0:
        return []

    polygons = []
    for ring in rings_25832:
        xs, ys = tf.transform([p[0] for p in ring], [p[1] for p in ring])
        polygons.append([[[round(x, 7), round(y, 7)] for x, y in zip(xs, ys)]])

    geometry = (
        {"type": "Polygon", "coordinates": polygons[0]}
        if len(polygons) == 1
        else {"type": "MultiPolygon", "coordinates": polygons}
    )
    return [
        {
            "type": "Feature",
            "properties": {"h": round(height, 1)},
            "geometry": geometry,
        }
    ]


def process_kachel(name: str, out_dir: Path) -> tuple[str, int, str | None]:
    """Download + parse one kachel; returns (name, feature_count, error)."""
    out_path = out_dir / (name.replace(".gml", "") + ".ndjson")
    if out_path.exists():
        return name, -1, None  # already done (resume)

    import io

    import requests
    from lxml import etree

    try:
        resp = requests.get(BASE_URL + name, timeout=600)
        resp.raise_for_status()
    except Exception as e:  # noqa: BLE001 — report, caller decides
        return name, 0, f"download: {e}"

    count = 0
    tmp = out_path.with_suffix(".part")
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            context = etree.iterparse(io.BytesIO(resp.content), events=("end",))
            for _, elem in context:
                name_l = localname(elem.tag)
                if name_l in ("Building", "BuildingPart"):
                    for feat in extract_features(elem):
                        json.dump(feat, fh, separators=(",", ":"))
                        fh.write("\n")
                        count += 1
                    # Clear so an enclosing Building does not re-emit its parts.
                    elem.clear()
                    parent = elem.getparent()
                    if parent is not None:
                        parent.remove(elem)
        tmp.rename(out_path)
    except Exception as e:  # noqa: BLE001
        tmp.unlink(missing_ok=True)
        return name, 0, f"parse: {e}"

    return name, count, None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--match", action="append", default=None,
                    help="substring filter on kachel file names (repeatable)")
    ap.add_argument("--out", default="out")
    ap.add_argument("--workers", type=int, default=6,
                    help="parallel download+parse workers (be polite to the portal)")
    args = ap.parse_args()

    import requests

    resp = requests.get(INDEX_URL, timeout=120)
    resp.raise_for_status()
    files = resp.json()["datasets"][0]["files"]
    names = [f["name"] for f in files if f["name"].endswith(".gml")]
    # ~1.5 KB files are empty kacheln (no buildings) — skip the fetch.
    sizes = {f["name"]: int(f["size"]) for f in files}
    names = [n for n in names if sizes.get(n, 0) > 2000]
    if args.match:
        matches = [m.lower() for m in args.match]
        names = [n for n in names if any(m in n.lower() for m in matches)]
    if not names:
        raise SystemExit("ERROR: no kacheln matched.")

    out_dir = Path(args.out) / "tiles" / "lod2"
    out_dir.mkdir(parents=True, exist_ok=True)
    total_bytes = sum(sizes[n] for n in names)
    print(f"{len(names)} kacheln selected ({total_bytes / 1e9:.1f} GB to stream), "
          f"output: {out_dir}")

    done = 0
    skipped = 0
    features = 0
    errors: list[str] = []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(process_kachel, n, out_dir): n for n in names}
        for fut in as_completed(futures):
            name, count, err = fut.result()
            if err:
                errors.append(f"{name}: {err}")
                print(f"  ERROR {name}: {err}")
            elif count == -1:
                skipped += 1
            else:
                features += count
            done += 1
            if done % 500 == 0:
                print(f"  {done}/{len(names)} kacheln ({features} buildings, "
                      f"{skipped} skipped, {len(errors)} errors)")

    print(f"\nDone: {done} kacheln, {features} new building features, "
          f"{skipped} already present, {len(errors)} errors.")
    if errors:
        err_file = out_dir.parent / "lod2_errors.txt"
        err_file.write_text("\n".join(errors), encoding="utf-8")
        print(f"Errors listed in {err_file} — re-run to retry just those "
              "(finished kacheln are skipped).")
    print("Next: cat out/tiles/lod2/*.ndjson > out/tiles/buildings.ndjson, "
          "then tippecanoe (see module docstring).")


if __name__ == "__main__":
    main()
