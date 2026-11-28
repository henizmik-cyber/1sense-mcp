#!/usr/bin/env python3
"""Bodenrichtwerte (BRW) for the Länder beyond NRW — one reader per source,
all writing the same outputs as ingest_brw.py (NRW):

  out/sql-brw-<land>/brw_*.sql          -> ./load_d1.sh remote out/sql-brw-<land>  (main DB)
  out/r2/geo/brw/<land>/<zone_id>.json  -> upload_r2.py
  out/tiles/brw_<land>.ndjson           -> appended into the national BRW tileset

Sources (verified 2026-11-28; see the shared rollout notes):
  06 Hessen          WFS 2024 as zipped CSV pages      downloads/brw_he   dl-de/zero-2.0
  02 Hamburg         VBORIS CSV 2026                   downloads/brw_hh   dl-de/by-2.0
  15 Sachsen-Anhalt  VBORIS CSV 2026 (zip)             downloads/brw_st   dl-de/by-2.0
  11 Berlin          WFS GeoJSON 2026 (EPSG:25833)     downloads/brw_be   dl-de/zero-2.0
  12 Brandenburg     OGC API GeoJSON pages (WGS84)     downloads/brw_bb   dl-de/by-2.0
  16 Thüringen       WFS GML 3.2 2026                  downloads/brw_th   CC BY 4.0

Several sources carry more than one value per zone polygon (e.g. EFH/MFH in
Hamburg); each value becomes its own row with a suffixed zone_id.

Usage:  python3 ingest_brw_land.py --land 06
"""

from __future__ import annotations

import argparse
import csv
import glob
import io
import json
import re
import sys
import zipfile
from datetime import datetime
from pathlib import Path

from common import NdjsonWriter, SqlChunkWriter, round_coords, write_geojson

BRW_COLUMNS = [
    "zone_id", "brw_eur_m2", "stand", "nutzungsart", "entwicklungszustand",
    "municipality", "minx", "miny", "maxx", "maxy", "geometry_key", "land",
]

csv.field_size_limit(sys.maxsize)  # WKT polygons can be megabytes


def parse_number(value) -> float | None:
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


def iso_date(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%Y%m%d"):
        try:
            return datetime.strptime(text[:10], fmt).date().isoformat()
        except ValueError:
            continue
    return text or None


def short_code(label) -> str | None:
    """'Wohnbaufläche (W)' -> 'W'; plain codes pass through."""
    if label is None:
        return None
    text = str(label).strip()
    m = re.search(r"\(([A-Za-zÄÖÜäöü]+)\)\s*$", text)
    return m.group(1) if m else (text or None)


class Out:
    def __init__(self, land: str, out: Path):
        self.land = land
        self.out = out
        self.sql = SqlChunkWriter(out / f"sql-brw-{land}", "brw", "bodenrichtwerte",
                                  BRW_COLUMNS)
        self.tiles = NdjsonWriter(out / "tiles" / f"brw_{land}.ndjson")
        self.seen: dict[str, int] = {}
        self.geoms_written: set[str] = set()
        self.count = 0
        self.skipped = 0

    def add(self, key: str, brw, stand, nutzung, entw, muni, geom_4326,
            zone_no: str | None = None) -> None:
        """One BRW value. Values that share one zone polygon (EFH/MFH/…)
        get one R2 geometry file and one map shape instead of one stacked
        copy each. They are grouped by the polygon itself — Hamburg gives
        every value its own WNUM, so zone numbers can't be trusted for it."""
        import hashlib

        zone_no = "g" + hashlib.sha1(geom_4326.wkb).hexdigest()[:16] \
            if geom_4326 is not None else zone_no
        brw = parse_number(brw)
        if brw is None or geom_4326 is None or geom_4326.is_empty:
            self.skipped += 1  # no parseable value or shape: never guess
            return
        base = re.sub(r"\W+", "-", f"{self.land}-{key}").strip("-")
        n = self.seen.get(base, 0) + 1
        self.seen[base] = n
        zone_id = base if n == 1 else f"{base}-{n}"
        geom_id = (re.sub(r"\W+", "-", f"{self.land}-{zone_no}").strip("-")
                   if zone_no else zone_id)
        minx, miny, maxx, maxy = geom_4326.bounds
        geom_key = f"geo/brw/{self.land}/{geom_id}.json"
        stand = iso_date(stand)
        nutzung = short_code(nutzung)
        entw = short_code(entw)
        self.sql.add([
            zone_id, round(brw, 2), stand, nutzung, entw,
            (str(muni) if muni else None),
            round(minx, 7), round(miny, 7), round(maxx, 7), round(maxy, 7),
            geom_key, self.land,
        ])
        if geom_key not in self.geoms_written:
            self.geoms_written.add(geom_key)
            geometry = round_coords(geom_4326.__geo_interface__, 6)
            write_geojson(self.out / "r2" / geom_key,
                          {"type": "Feature", "properties": {"zone_id": geom_id},
                           "geometry": geometry})
            # Map shows the zone's first-listed value; the panel/tool list all.
            self.tiles.add({"zone_id": geom_id, "brw_eur_m2": round(brw, 2),
                            "nutzungsart": nutzung, "stand": stand}, geometry)
        self.count += 1

    def close(self) -> None:
        files = self.sql.close()
        self.tiles.close()
        print(f"Done ({self.land}): {self.count} BRW rows -> {files} SQL file(s)"
              + (f", {self.skipped} skipped (no value/geometry)" if self.skipped else ""))


def transformer(src_epsg: int):
    from pyproj import Transformer
    from shapely.ops import transform

    tf = Transformer.from_crs(src_epsg, 4326, always_xy=True)
    return lambda g: transform(tf.transform, g)


def strip_zone_prefix(geom):
    """Hamburg writes eastings as 32xxxxxxx (zone prefix): drop it."""
    from shapely.ops import transform

    def fix(x, y, z=None):
        import numpy as np

        x = np.asarray(x)
        x = np.where(x > 1e7, x - 32_000_000, x)
        return (x, y) if z is None else (x, y, z)

    return transform(fix, geom)


# ---------- readers ----------

def find_wkt(fields) -> str | None:
    """The polygon's column differs per publisher (last column in Hamburg,
    elsewhere in Sachsen-Anhalt, 'umring' sometimes empty in Hessen): take
    the field that actually holds a (MULTI)POLYGON."""
    for v in fields:
        if v and v.lstrip().upper().startswith(("POLYGON", "MULTIPOLYGON")):
            return v.strip()
    return None


def read_vboris_csv(text_stream, out: Out, to4326, prefix_fix=False) -> None:
    """VBORIS CSV (HH, ST): '|' separated, polygon as WKT in one of the fields."""
    from shapely import wkt

    reader = csv.reader(text_stream, delimiter="|", quoting=csv.QUOTE_NONE)
    header = [h.strip().lstrip("﻿") for h in next(reader)]
    idx = {h: i for i, h in enumerate(header)}
    for row in reader:
        wkt_text = find_wkt(row)
        if wkt_text is None or len(row) < len(header) - 1:
            out.skipped += 1
            continue
        geom = wkt.loads(wkt_text)
        if prefix_fix:
            geom = strip_zone_prefix(geom)
        g = lambda f: row[idx[f]] if f in idx else None  # noqa: E731
        key = f"{g('WNUM')}-{g('NUTA') or ''}{('-' + g('ERGNUTA')) if g('ERGNUTA') else ''}"
        out.add(key, g("BRW"), g("STAG"), g("NUTA"), g("ENTW"), g("GENA"), to4326(geom),
                zone_no=g("WNUM"))


def run_hh(out: Out) -> None:
    to4326 = transformer(25832)
    for z in sorted(glob.glob("downloads/brw_hh/*csv*.zip")):
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                if n.lower().endswith(".csv"):
                    with zf.open(n) as fh:
                        read_vboris_csv(io.TextIOWrapper(fh, "utf-8-sig"), out, to4326,
                                        prefix_fix=True)


def run_st(out: Out) -> None:
    to4326 = transformer(25832)
    for z in sorted(glob.glob("downloads/brw_st/*.zip")):
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                if re.search(r"br_15_.*\.csv$", n):
                    with zf.open(n) as fh:
                        read_vboris_csv(io.TextIOWrapper(fh, "utf-8-sig"), out, to4326)


def run_he(out: Out) -> None:
    """BORIS-Hessen WFS 2024 as zipped CSV pages (Latin-1, WKT in 'umring')."""
    from shapely import wkt

    to4326 = transformer(25832)
    for z in sorted(glob.glob("downloads/brw_he/page_*.zip")):
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                if not n.lower().endswith(".csv"):
                    continue
                with zf.open(n) as fh:
                    reader = csv.DictReader(io.TextIOWrapper(fh, "latin-1"),
                                            delimiter="|", quoting=csv.QUOTE_NONE)
                    for r in reader:
                        extra = r.get(None) or []  # fields beyond the header
                        text = find_wkt(list(r.values())[:-1] + list(extra)
                                        if None in r else list(r.values()))
                        if not text:
                            out.skipped += 1
                            continue
                        key = f"{r.get('bodenrichtwertNummer')}-{r.get('nutzungArt') or ''}"
                        out.add(key, r.get("bodenrichtwert"), r.get("stichtag"),
                                r.get("nutzungArt"), r.get("entwicklungszustand"),
                                r.get("gemeindename"), to4326(wkt.loads(text)))


def run_be(out: Out) -> None:
    from shapely.geometry import shape

    to4326 = transformer(25833)
    data = json.load(open("downloads/brw_be/brw2026.json", encoding="utf-8"))
    for f in data["features"]:
        p = f["properties"]
        # nutzung is "W - Wohngebiet": keep the code before the dash.
        nutzung = (p.get("nutzung") or "").split(" - ")[0] or None
        out.add(f"{p.get('brwid')}-{nutzung or ''}", p.get("brw"), p.get("stichtag"),
                nutzung, None, p.get("bezirk") or "Berlin",
                to4326(shape(f["geometry"])))


def run_bb(out: Out) -> None:
    """OGC API Features pages (WGS84). Codes resolved via the API's own
    code lists (BR_Art_Nutzung, BR_Entwicklungszustand_Bodenrichtwert)."""
    from shapely.geometry import shape

    art = json.load(open("downloads/brw_bb/gid_BR_Art_Nutzung.json"))["entries"]
    entw = json.load(open("downloads/brw_bb/gid_BR_Entwicklungszustand_Bodenrichtwert.json"))["entries"]
    for path in sorted(glob.glob("downloads/brw_bb/page_*.json")):
        for f in json.load(open(path, encoding="utf-8"))["features"]:
            p = f["properties"]
            nutz = p.get("nutzung")
            if isinstance(nutz, str):
                try:
                    nutz = json.loads(nutz)
                except ValueError:
                    nutz = None
            nutz_code = (nutz or {}).get("art") if isinstance(nutz, dict) else None
            gem = p.get("gemeinde")
            if isinstance(gem, str):
                try:
                    gem = json.loads(gem)
                except ValueError:
                    gem = None
            muni = None
            if isinstance(gem, list) and gem:
                muni = (gem[0].get("properties") or {}).get("bezeichnung")
            out.add(f"{p.get('bodenrichtwertNummer')}-{nutz_code or ''}",
                    p.get("bodenrichtwert"), p.get("stichtag"),
                    art.get(str(nutz_code)) if nutz_code else None,
                    entw.get(str(p.get("entwicklungszustand"))),
                    muni, shape(f["geometry"]),
                    zone_no=p.get("bodenrichtwertNummer"))


def run_th(out: Out) -> None:
    """BORIS Thüringen WFS GML 3.2, flat feature type boris:bodenrichtwertzone."""
    import geopandas as gpd

    gdf = gpd.read_file("downloads/brw_th/brw2026.gml")
    if gdf.crs is None:
        gdf = gdf.set_crs(25832)
    gdf = gdf.to_crs(4326)
    cols = {c.upper(): c for c in gdf.columns}
    g = lambda r, k: r[cols[k]] if k in cols else None  # noqa: E731
    for _, r in gdf.iterrows():
        nutz = g(r, "NUTZUNG_ART") or g(r, "NUTZUNGSART")
        out.add(f"{g(r, 'BODENRICHTWERTNUMMER')}-{g(r, 'NUTZUNGSART') or ''}",
                g(r, "BODENRICHTWERT"), g(r, "STICHTAG"), nutz,
                g(r, "ENTWICKLUNGSZUSTAND"), g(r, "GEMEINDENAME"), r.geometry)


READERS = {"02": run_hh, "06": run_he, "11": run_be, "12": run_bb, "15": run_st,
           "16": run_th}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--land", required=True, choices=sorted(READERS))
    ap.add_argument("--out", default="out")
    args = ap.parse_args()
    out = Out(args.land, Path(args.out))
    READERS[args.land](out)
    out.close()


if __name__ == "__main__":
    main()
