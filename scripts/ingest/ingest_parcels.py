#!/usr/bin/env python3
"""Ingest NRW ALKIS parcels (vereinfachte Liegenschaftskarte, GeoPackage).

Source (verified 2026-11-26, license dl-de/zero-2.0):
  https://www.opengeodata.nrw.de/produkte/geobasis/lk/akt/gru_vereinfacht_gpkg/
The directory lists one .gpkg zip per Kreis / kreisfreie Stadt.

Default scope is Köln + Düsseldorf (verify the pipeline end to end first),
then re-run with --all for the remaining Kreise.

Outputs:
  out/sql/parcels_*.sql           -> load with scripts/ingest/load_d1.sh
  out/r2/geo/parcels/<gemarkung>/<flur>.json   -> upload with upload_r2.py

Usage:
  python3 ingest_parcels.py                    # Köln + Düsseldorf
  python3 ingest_parcels.py --match aachen     # one Kreis by name fragment
  python3 ingest_parcels.py --all              # every listed file
"""

from __future__ import annotations

import argparse
import re
import zipfile
from collections import defaultdict
from pathlib import Path

import requests

from common import (
    SqlChunkWriter,
    normalize_kennzeichen,
    pick_column,
    round_coords,
    write_geojson,
)

DIR_URL = "https://www.opengeodata.nrw.de/produkte/geobasis/lk/akt/gru_vereinfacht_gpkg/"
# Köln is AGS 05315, Düsseldorf 05111; file names on the portal typically carry
# either the city name or the AGS key — match both.
DEFAULT_MATCHES = ["koeln", "köln", "05315", "duesseldorf", "düsseldorf", "05111"]

PARCEL_COLUMNS = [
    "id", "land", "gemarkung_nr", "gemarkung_name", "flur", "zaehler", "nenner",
    "municipality", "kreis", "area_m2", "centroid_lat", "centroid_lng",
    "minx", "miny", "maxx", "maxy", "geometry_key",
]


def list_zip_urls() -> list[str]:
    """The portal serves an XML index: <file name="..._GeoPackage.zip" .../>.
    File names contain umlauts (e.g. Köln), so they are percent-encoded."""
    from urllib.parse import quote

    resp = requests.get(DIR_URL, timeout=60)
    resp.raise_for_status()
    # The index is UTF-8 but the server sends no charset header; without this,
    # umlaut file names (Köln, Düsseldorf) get double-encoded into 404 URLs.
    text = resp.content.decode("utf-8")
    names = re.findall(r'<file name="([^"]+\.zip)"', text, flags=re.IGNORECASE)
    if not names:  # fallback: plain HTML listing
        names = re.findall(r'href="([^"]+\.zip)"', text, flags=re.IGNORECASE)
    if not names:
        raise SystemExit(
            f"ERROR: no .zip entries found at {DIR_URL} — the portal layout may have "
            "changed. Open the URL in a browser and update DIR_URL/matching."
        )
    return sorted({DIR_URL + quote(n.lstrip("./")) for n in names})


def download(url: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / url.rsplit("/", 1)[-1]
    if dest.exists() and dest.stat().st_size > 0:
        if zipfile.is_zipfile(dest):
            print(f"  cached: {dest.name}")
            return dest
        print(f"  cached file corrupt, re-downloading: {dest.name}")
        dest.unlink()
    print(f"  downloading {url}")
    part = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, timeout=600) as resp:
        resp.raise_for_status()
        with open(part, "wb") as fh:
            for chunk in resp.iter_content(1 << 20):
                fh.write(chunk)
    part.rename(dest)
    return dest


def extract_gpkg(zip_path: Path, dest_dir: Path) -> list[Path]:
    out = []
    with zipfile.ZipFile(zip_path) as zf:
        for name in zf.namelist():
            if name.lower().endswith(".gpkg"):
                target = dest_dir / Path(name).name
                if not target.exists():
                    zf.extract(name, dest_dir)
                    extracted = dest_dir / name
                    if extracted != target:
                        extracted.rename(target)
                out.append(target)
    if not out:
        raise SystemExit(f"ERROR: no .gpkg inside {zip_path.name}")
    return out


def pick_parcel_layer(gpkg: Path) -> str:
    import pyogrio

    layers = [str(l[0]) for l in pyogrio.list_layers(gpkg)]
    for layer in layers:
        if "flurstueck" in layer.lower() or "flurstück" in layer.lower():
            return layer
    if len(layers) == 1:
        return layers[0]
    raise SystemExit(
        f"ERROR: could not identify the Flurstück layer in {gpkg.name}.\n"
        f"  Layers: {layers}\n"
        "Update pick_parcel_layer() after inspecting the file."
    )


def process_gpkg(gpkg: Path, sql: SqlChunkWriter, geo_root: Path) -> int:
    import geopandas as gpd

    layer = pick_parcel_layer(gpkg)
    print(f"  reading {gpkg.name} layer={layer}")
    gdf = gpd.read_file(gpkg, layer=layer)
    if gdf.crs is None:
        gdf = gdf.set_crs(25832)

    cols = list(gdf.columns)
    kennz_col = pick_column(
        cols,
        ["flurstueckskennzeichen", "flstkennz", "kennzeichen", "fsk"],
        "Flurstückskennzeichen",
    )
    gmk_name_col = pick_column(
        cols, ["gemarkung", "gemarkungsname", "gmkname"], "Gemarkung name", required=False
    )
    muni_col = pick_column(
        cols,
        ["gemeinde", "gemeindename", "gmdname", "kommune"],
        "Gemeinde/municipality",
        required=False,
    )
    kreis_col = pick_column(
        cols, ["kreis", "kreisname", "krsname"], "Kreis", required=False
    )
    area_col = pick_column(
        cols,
        ["amtlicheflaeche", "amtliche_flaeche", "amtlfl", "flaeche"],
        "amtliche Fläche",
        required=False,
    )

    # Metric area/centroid in the source CRS, then reproject for the API.
    centroids_25832 = gdf.geometry.centroid
    areas = gdf[area_col] if area_col else gdf.geometry.area
    gdf4326 = gdf.to_crs(4326)
    centroids = gpd.GeoSeries(centroids_25832, crs=gdf.crs).to_crs(4326)
    bounds = gdf4326.bounds

    by_flur: dict[tuple[str, str], list] = defaultdict(list)
    count = 0
    skipped = 0

    for idx, row in gdf4326.iterrows():
        norm = normalize_kennzeichen(row[kennz_col])
        if norm is None:
            skipped += 1
            continue
        land, gemarkung, flur = norm[0:2], norm[2:6], norm[6:9]
        rest = norm[9:]
        zaehler, _, nenner = rest.partition("/")
        geom_key = f"geo/parcels/{gemarkung}/{flur}.json"
        c = centroids.loc[idx]
        b = bounds.loc[idx]
        area = areas.loc[idx]
        # Guard None/NaN before float() — official area can be missing.
        area_val = None if area is None or area != area else round(float(area), 1)
        sql.add([
            norm, land, gemarkung,
            (row[gmk_name_col] if gmk_name_col else None),
            flur, zaehler, nenner or None,
            (row[muni_col] if muni_col else None),
            (row[kreis_col] if kreis_col else None),
            area_val,
            round(float(c.y), 7), round(float(c.x), 7),
            round(float(b["minx"]), 7), round(float(b["miny"]), 7),
            round(float(b["maxx"]), 7), round(float(b["maxy"]), 7),
            geom_key,
        ])
        by_flur[(gemarkung, flur)].append(
            {
                "type": "Feature",
                "properties": {"id": norm},
                "geometry": round_coords(row.geometry.__geo_interface__),
            }
        )
        count += 1

    for (gemarkung, flur), features in by_flur.items():
        path = geo_root / "r2" / "geo" / "parcels" / gemarkung / f"{flur}.json"
        if path.exists():
            # Merge with an earlier run (another Kreis can share a Gemarkung edge).
            import json

            existing = json.loads(path.read_text(encoding="utf-8"))
            seen = {f["properties"]["id"] for f in features}
            features = features + [
                f for f in existing.get("features", [])
                if f.get("properties", {}).get("id") not in seen
            ]
        write_geojson(path, {"type": "FeatureCollection", "features": features})

    if skipped:
        print(f"  WARNING: skipped {skipped} rows with unparseable Kennzeichen")
    print(f"  {count} parcels from {gpkg.name}")
    return count


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--match", action="append", default=None,
                    help="substring to select portal files (repeatable); default: Köln + Düsseldorf")
    ap.add_argument("--all", action="store_true", help="ingest every listed file (full NRW)")
    ap.add_argument("--exclude", action="append", default=None,
                    help="substring to skip among selected files (repeatable), e.g. an AGS key")
    ap.add_argument("--out", default="out", help="output directory (default: out)")
    ap.add_argument("--downloads", default="downloads", help="download cache directory")
    args = ap.parse_args()

    out = Path(args.out)
    urls = list_zip_urls()
    if not args.all:
        matches = [m.lower() for m in (args.match or DEFAULT_MATCHES)]
        urls = [u for u in urls if any(m in u.lower() for m in matches)]
        if not urls:
            raise SystemExit(
                "ERROR: no portal file matched. Run with --all to list everything, or "
                f"check the directory listing at {DIR_URL}"
            )
    if args.exclude:
        excludes = [e.lower() for e in args.exclude]
        urls = [u for u in urls if not any(e in u.lower() for e in excludes)]
    print(f"{len(urls)} file(s) selected:")
    for u in urls:
        print(f"  {u}")

    sql = SqlChunkWriter(out / "sql", "parcels", "parcels", PARCEL_COLUMNS,
                         rows_per_stmt=250, rows_per_file=20000)
    total = 0
    for url in urls:
        zip_path = download(url, Path(args.downloads))
        for gpkg in extract_gpkg(zip_path, Path(args.downloads) / "extracted"):
            total += process_gpkg(gpkg, sql, out)
    files = sql.close()
    print(f"\nDone: {total} parcels -> {files} SQL file(s) in {out / 'sql'}, "
          f"geometry under {out / 'r2' / 'geo' / 'parcels'}")
    print("Next: scripts/ingest/load_d1.sh to load D1, upload_r2.py for geometry.")


if __name__ == "__main__":
    main()
