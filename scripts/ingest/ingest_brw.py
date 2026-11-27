#!/usr/bin/env python3
"""Ingest BORIS-NRW Bodenrichtwerte (land-wide zonal values, shapefile, annual).

Source (verified 2026-11-26, license dl-de/zero-2.0):
  https://www.opengeodata.nrw.de/produkte/infrastruktur_bauen_wohnen/boris/BRW/BRW_EPSG25832_Shape.zip

Outputs:
  out/sql/brw_*.sql                      -> load with scripts/ingest/load_d1.sh
  out/r2/geo/brw/<zone_id>.json          -> upload with upload_r2.py

Usage:
  python3 ingest_brw.py
"""

from __future__ import annotations

import argparse
import re
import zipfile
from datetime import datetime
from pathlib import Path

import requests

from common import NdjsonWriter, SqlChunkWriter, pick_column, round_coords, write_geojson

BRW_URL = (
    "https://www.opengeodata.nrw.de/produkte/infrastruktur_bauen_wohnen/boris/"
    "BRW/BRW_EPSG25832_Shape.zip"
)

BRW_COLUMNS = [
    "zone_id", "brw_eur_m2", "stand", "nutzungsart", "entwicklungszustand",
    "municipality", "minx", "miny", "maxx", "maxy", "geometry_key",
]


def download(url: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / url.rsplit("/", 1)[-1]
    if dest.exists() and dest.stat().st_size > 0:
        print(f"cached: {dest.name}")
        return dest
    print(f"downloading {url}")
    with requests.get(url, stream=True, timeout=1200) as resp:
        resp.raise_for_status()
        with open(dest, "wb") as fh:
            for chunk in resp.iter_content(1 << 20):
                fh.write(chunk)
    return dest


def extract_shp(zip_path: Path, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(dest_dir)
    shps = sorted(dest_dir.rglob("*.shp"), key=lambda p: p.stat().st_size, reverse=True)
    if not shps:
        raise SystemExit(f"ERROR: no .shp inside {zip_path.name}")
    if len(shps) > 1:
        print(f"NOTE: multiple shapefiles, using the largest: {shps[0].name}")
    return shps[0]


def parse_number(value) -> float | None:
    """Accepts 950, "950", "1,1", "1.250,50". Returns None instead of guessing."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return None if value != value else float(value)
    text = str(value).strip()
    if not text:
        return None
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def normalize_stand(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%Y%m%d"):
        try:
            return datetime.strptime(text[:10], fmt).date().isoformat()
        except ValueError:
            continue
    return text or None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="out")
    ap.add_argument("--downloads", default="downloads")
    args = ap.parse_args()

    import geopandas as gpd

    zip_path = download(BRW_URL, Path(args.downloads))
    shp = extract_shp(zip_path, Path(args.downloads) / "brw_extracted")
    print(f"reading {shp.name} (this is the land-wide file — expect a few minutes)")
    gdf = gpd.read_file(shp)
    if gdf.crs is None:
        gdf = gdf.set_crs(25832)
    gdf = gdf.to_crs(4326)

    cols = list(gdf.columns)
    brw_col = pick_column(cols, ["brw", "bodenrichtwert", "brwert"], "Bodenrichtwert EUR/m²")
    stand_col = pick_column(cols, ["stag", "stichtag", "stand"], "Stichtag", required=False)
    nutz_col = pick_column(
        cols, ["nutzung", "nuta", "enuta", "nutzungsart"], "Nutzungsart", required=False
    )
    entw_col = pick_column(
        cols, ["entw", "entwicklungszustand", "entw_zust", "ez"],
        "Entwicklungszustand", required=False,
    )
    muni_col = pick_column(
        cols, ["gena", "gemeinde", "gemeindename", "gabe"], "Gemeinde", required=False
    )
    zone_col = pick_column(
        cols, ["wnum", "brwznr", "zonennr", "objectid", "oid"], "zone id", required=False
    )

    out = Path(args.out)
    sql = SqlChunkWriter(out / "sql", "brw", "bodenrichtwerte", BRW_COLUMNS)
    ndjson = NdjsonWriter(out / "tiles" / "brw.ndjson")
    bounds = gdf.bounds
    count = 0
    seen_ids: set[str] = set()

    for idx, row in gdf.iterrows():
        raw_zone = row[zone_col] if zone_col else None
        zone_id = re.sub(r"\W+", "-", str(raw_zone)) if raw_zone is not None else f"row{idx}"
        if zone_id in seen_ids:
            zone_id = f"{zone_id}-{idx}"
        seen_ids.add(zone_id)

        brw = parse_number(row[brw_col])
        if brw is None:
            continue  # no parseable value, no row — never guess

        b = bounds.loc[idx]
        geometry = round_coords(row.geometry.__geo_interface__, 6)
        # Tile input: geometry plus what the legend / hover shows.
        ndjson.add(
            {
                "zone_id": zone_id,
                "brw_eur_m2": round(brw, 2),
                "nutzungsart": (str(row[nutz_col]) if nutz_col and row[nutz_col] is not None else None),
                "stand": normalize_stand(row[stand_col]) if stand_col else None,
            },
            geometry,
        )
        geom_key = f"geo/brw/{zone_id}.json"
        sql.add([
            zone_id,
            round(brw, 2),
            normalize_stand(row[stand_col]) if stand_col else None,
            (row[nutz_col] if nutz_col else None),
            (row[entw_col] if entw_col else None),
            (row[muni_col] if muni_col else None),
            round(float(b["minx"]), 7), round(float(b["miny"]), 7),
            round(float(b["maxx"]), 7), round(float(b["maxy"]), 7),
            geom_key,
        ])
        write_geojson(
            out / "r2" / "geo" / "brw" / f"{zone_id}.json",
            {
                "type": "Feature",
                "properties": {"zone_id": zone_id},
                "geometry": geometry,
            },
        )
        count += 1
        if count % 5000 == 0:
            print(f"  {count} zones…")

    files = sql.close()
    tile_count = ndjson.close()
    print(f"\nDone: {count} BRW zones -> {files} SQL file(s), geometry under "
          f"{out / 'r2' / 'geo' / 'brw'}, {tile_count} tile features in "
          f"{out / 'tiles' / 'brw.ndjson'}")


if __name__ == "__main__":
    main()
