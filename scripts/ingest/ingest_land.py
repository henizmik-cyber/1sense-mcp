#!/usr/bin/env python3
"""Generic per-Land parcel ingester for the Germany rollout.

One script for every Land beyond NRW. Two parse paths:

  * OGR path  — GeoPackage / Shapefile (incl. inside zips), read per file
                with geopandas. Used for NI, HB, MV, BB, BW, and NAS data
                after an external `ogr2ogr -f GPKG` conversion (HH, HE, SN).
  * GML path  — streamed with lxml (constant memory), for the GML family:
                INSPIRE CadastralParcels (RP, TH, SL), ALKIS-vereinfacht
                GML (ST, SH) and the Berlin WFS dump.

Outputs per Land (same contract as ingest_parcels.py for NRW):
  out/sql-<land>/parcels_*.sql        -> DB_NAME=<shard> ./load_d1.sh remote out/sql-<land>
  out/tiles/parcels_<land>.ndjson     -> appended into the national tileset
  out/r2/geo/parcels/<land>/<gemarkung>/<flur>.json  -> upload_r2.py

The R2 keys include the Land prefix (geo/parcels/<land>/…) — Gemarkung
numbers repeat across Länder. NRW keeps its legacy keys without the prefix.

Usage:
  python3 ingest_land.py --land 03 --src downloads/ni
  python3 ingest_land.py --land 07 --src downloads/rp --crs 4258 --axis latlon
  python3 ingest_land.py --land 13 --src downloads/mv --crs 25833
"""

from __future__ import annotations

import argparse
import io
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path

from common import (
    NdjsonWriter,
    SqlChunkWriter,
    normalize_kennzeichen,
    pick_column,
    round_coords,
    write_geojson,
)

PARCEL_COLUMNS = [
    "id", "land", "gemarkung_nr", "gemarkung_name", "flur", "zaehler", "nenner",
    "municipality", "kreis", "area_m2", "centroid_lat", "centroid_lng",
    "minx", "miny", "maxx", "maxy", "geometry_key",
]

KENNZ_CANDIDATES = [
    "flurstueckskennzeichen", "flstkennz", "kennzeichen", "fsk", "fsko",
    "nationalcadastralreference",
]
AREA_CANDIDATES = [
    "amtlicheflaeche", "amtliche_flaeche", "amtlfl", "flaeche", "afl", "areavalue",
]
GMK_CANDIDATES = [
    "gemarkung", "gemarkungsname", "gmkname", "gmk__bez", "gmn_txt", "namgmk",
]
MUNI_CANDIDATES = [
    "gemeinde", "gemeindename", "gmdname", "kommune", "gem__bez", "gdz_txt", "namgem",
]
KREIS_CANDIDATES = ["kreis", "kreisname", "krsname", "krs_txt"]

# GML element localnames that represent one parcel, with their field spellings.
GML_PARCEL_TAGS = {
    "CadastralParcel": {  # INSPIRE CP (RP, TH, SL)
        "kennz": ["nationalCadastralReference"],
        "area": ["areaValue"],
        "gmk": [], "muni": [], "kreis": [],
    },
    "Flurstueck": {  # ALKIS-vereinfacht 2.0 (ST) / SH GML
        "kennz": ["flstkennz", "flurstueckskennzeichen"],
        "area": ["flaeche", "amtlicheflaeche"],
        "gmk": ["gemarkung"], "muni": ["gemeinde"], "kreis": ["kreis"],
    },
    "flurstuecke": {  # Berlin WFS feature type
        "kennz": ["fsko"],
        "area": ["afl"],
        "gmk": ["namgmk"], "muni": ["namgem"], "kreis": [],
    },
    "AX_Flurstueck": {  # raw NAS (HH, HE, SN) — names come from VG250
        "kennz": ["flurstueckskennzeichen"],
        "area": ["amtlicheFlaeche"],
        "gmk": [], "muni": [], "kreis": [],
    },
}

# Ring containers: everything below one of these forms ONE ring, whether it
# is a single posList (simple GML) or many curve segments (NAS).
RING_TAGS = ("exterior", "interior")
POLY_TAGS = ("Polygon", "PolygonPatch")


def localname(tag) -> str:
    # Comments/processing instructions carry a function as .tag, not a str.
    if not isinstance(tag, str):
        return ""
    return tag.rsplit("}", 1)[-1]


class AdminLookup:
    """Fills missing Gemeinde/Kreis names from BKG VG250 (dl-de/by-2.0,
    © GeoBasis-DE / BKG) by point-in-polygon on the parcel centroid.
    INSPIRE CadastralParcels (RP, SL, TH) carry no municipality at all."""

    def __init__(self, gpkg: Path, land: str):
        import geopandas as gpd
        from shapely import STRtree

        def load(layer: str, name_fn):
            gdf = gpd.read_file(gpkg, layer=layer)
            gdf = gdf[gdf["AGS"].astype(str).str[:2] == land]
            if "GF" in gdf.columns:
                gdf = gdf[gdf["GF"] == 4]  # land areas, not water surfaces
            gdf = gdf.to_crs(4326)
            names = [name_fn(r) for _, r in gdf.iterrows()]
            geoms = list(gdf.geometry)
            return STRtree(geoms), geoms, names

        self.gem = load("vg250_gem", lambda r: str(r["GEN"]))
        self.krs = load("vg250_krs", lambda r: f"{r['BEZ']} {r['GEN']}")
        print(f"VG250 lookup: {len(self.gem[2])} Gemeinden, {len(self.krs[2])} Kreise "
              f"for Land {land}")

    @staticmethod
    def _find(index, lng: float, lat: float) -> str | None:
        from shapely import Point

        tree, geoms, names = index
        pt = Point(lng, lat)
        for i in tree.query(pt, predicate="intersects"):
            return names[int(i)]
        return None

    def municipality(self, lng: float, lat: float) -> str | None:
        return self._find(self.gem, lng, lat)

    def kreis(self, lng: float, lat: float) -> str | None:
        return self._find(self.krs, lng, lat)


class Sink:
    """Shared writers for one Land run."""

    def __init__(self, land: str, out: Path, admin: AdminLookup | None = None):
        self.land = land
        self.out = out
        self.admin = admin
        self.sql = SqlChunkWriter(out / f"sql-{land}", "parcels", "parcels",
                                  PARCEL_COLUMNS, rows_per_stmt=250, rows_per_file=20000)
        self.ndjson = NdjsonWriter(out / "tiles" / f"parcels_{land}.ndjson")
        self.by_flur: dict[tuple[str, str], list] = defaultdict(list)
        self.seen: set[str] = set()
        self.count = 0
        self.skipped = 0
        self.wrong_land = 0

    def add(self, kennz_raw, area, gmk_name, muni, kreis,
            geometry_4326: dict, bounds: tuple[float, float, float, float],
            centroid: tuple[float, float]) -> None:
        norm = normalize_kennzeichen(kennz_raw)
        if norm is None:
            self.skipped += 1
            return
        if norm[0:2] != self.land:
            self.wrong_land += 1
            return
        if norm in self.seen:
            return
        self.seen.add(norm)
        gemarkung, flur = norm[2:6], norm[6:9]
        rest = norm[9:]
        zaehler, _, nenner = rest.partition("/")
        geom_key = f"geo/parcels/{self.land}/{gemarkung}/{flur}.json"
        area_val = None
        if area is not None:
            try:
                f = float(area)
                if f == f:
                    area_val = round(f, 1)
            except (TypeError, ValueError):
                pass
        minx, miny, maxx, maxy = bounds
        if self.admin is not None:
            if muni is None:
                muni = self.admin.municipality(centroid[0], centroid[1])
            if kreis is None:
                kreis = self.admin.kreis(centroid[0], centroid[1])
        self.sql.add([
            norm, self.land, gemarkung,
            (str(gmk_name) if gmk_name is not None else None),
            flur, zaehler, nenner or None,
            (str(muni) if muni is not None else None),
            (str(kreis) if kreis is not None else None),
            area_val,
            round(centroid[1], 7), round(centroid[0], 7),
            round(minx, 7), round(miny, 7), round(maxx, 7), round(maxy, 7),
            geom_key,
        ])
        geometry = round_coords(geometry_4326)
        self.ndjson.add(
            {"id": norm, "area_m2": area_val,
             "municipality": (str(muni) if muni is not None else None)},
            geometry,
        )
        self.by_flur[(gemarkung, flur)].append(
            {"type": "Feature", "properties": {"id": norm}, "geometry": geometry}
        )
        self.count += 1

    def close(self) -> None:
        for (gemarkung, flur), features in self.by_flur.items():
            path = (self.out / "r2" / "geo" / "parcels" / self.land
                    / gemarkung / f"{flur}.json")
            if path.exists():
                existing = json.loads(path.read_text(encoding="utf-8"))
                have = {f["properties"]["id"] for f in features}
                features = features + [
                    f for f in existing.get("features", [])
                    if f.get("properties", {}).get("id") not in have
                ]
            write_geojson(path, {"type": "FeatureCollection", "features": features})
        files = self.sql.close()
        tiles = self.ndjson.close()
        print(f"\nDone ({self.land}): {self.count} parcels -> {files} SQL file(s), "
              f"{tiles} tile features, geometry under out/r2/geo/parcels/{self.land}")
        if self.skipped:
            print(f"  WARNING: {self.skipped} rows with unparseable Kennzeichen")
        if self.wrong_land:
            print(f"  NOTE: {self.wrong_land} rows belonged to another Land (skipped)")


# ---------- OGR path (GPKG / Shape) ----------

def select_parcel_files(names: list[str]) -> list[str]:
    """Prefer the Flurstück file over Nutzung/Gebäude/Punkt side layers."""
    cand = [n for n in names if n.lower().endswith((".gpkg", ".shp"))]
    flur = [
        n for n in cand
        if "flurstueck" in Path(n).name.lower()
        and not any(x in Path(n).name.lower() for x in ("punkt", "nutzung", "grenz"))
    ]
    return flur or cand


def iter_vector_files(src: Path):
    plain = [p for p in sorted(src.rglob("*")) if p.suffix.lower() in (".gpkg", ".shp")]
    for name in select_parcel_files([str(p) for p in plain]):
        yield Path(name)
    for path in sorted(src.rglob("*.zip")):
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
        for n in select_parcel_files(names):
            yield Path(f"/vsizip/{path}/{n}")


def pick_parcel_layer(path) -> str | None:
    import pyogrio

    layers = [str(l[0]) for l in pyogrio.list_layers(str(path))]
    for layer in layers:
        low = layer.lower()
        if "flurstueck" in low or "flurstück" in low or "cadastralparcel" in low:
            return layer
    return layers[0] if len(layers) == 1 else None


def run_ogr(src: Path, sink: Sink, crs_override: int | None) -> None:
    import geopandas as gpd

    files = list(iter_vector_files(src))
    if not files:
        raise SystemExit(f"ERROR: no vector files under {src}")
    print(f"{len(files)} vector file(s)")
    for path in files:
        layer = pick_parcel_layer(path)
        if layer is None:
            print(f"  skip (no parcel layer): {path}")
            continue
        low = layer.lower()
        if not ("flurstueck" in low or "flurstück" in low or "cadastralparcel" in low):
            # Single-layer file whose name does not say "Flurstück" — check the
            # columns before trusting it.
            pass
        gdf = gpd.read_file(str(path), layer=layer)
        if gdf.crs is None:
            gdf = gdf.set_crs(crs_override or 25832)
        cols = list(gdf.columns)
        kennz_col = pick_column(cols, KENNZ_CANDIDATES, "Kennzeichen", required=False)
        if kennz_col is None:
            print(f"  skip (no Kennzeichen column): {path} [{layer}] cols={cols[:8]}")
            continue
        area_col = pick_column(cols, AREA_CANDIDATES, "Fläche", required=False)
        gmk_col = pick_column(cols, GMK_CANDIDATES, "Gemarkung", required=False)
        muni_col = pick_column(cols, MUNI_CANDIDATES, "Gemeinde", required=False)
        kreis_col = pick_column(cols, KREIS_CANDIDATES, "Kreis", required=False)

        gdf4326 = gdf.to_crs(4326)
        centroids = gdf.geometry.centroid
        centroids4326 = gpd.GeoSeries(centroids, crs=gdf.crs).to_crs(4326)
        bounds = gdf4326.bounds
        for idx, row in gdf4326.iterrows():
            if row.geometry is None:
                continue
            b = bounds.loc[idx]
            c = centroids4326.loc[idx]
            sink.add(
                row[kennz_col],
                row[area_col] if area_col else None,
                row[gmk_col] if gmk_col else None,
                row[muni_col] if muni_col else None,
                row[kreis_col] if kreis_col else None,
                row.geometry.__geo_interface__,
                (b["minx"], b["miny"], b["maxx"], b["maxy"]),
                (float(c.x), float(c.y)),
            )
        print(f"  {sink.count} total after {path}")


# ---------- GML stream path ----------

def ring_from_poslist(text: str, dim: int, swap: bool, tf, min_points: int = 3):
    vals = text.split()
    if len(vals) < min_points * dim or len(vals) % dim:
        return None
    xs = [float(v) for v in vals[0::dim]]
    ys = [float(v) for v in vals[1::dim]]
    if swap:
        xs, ys = ys, xs
    lon, lat = tf.transform(xs, ys)
    return [[round(x, 7), round(y, 7)] for x, y in zip(lon, lat)]


def run_gml(src: Path, sink: Sink, crs: int, axis_latlon: bool) -> None:
    from lxml import etree
    from pyproj import Transformer

    tf = Transformer.from_crs(crs, 4326, always_xy=True)

    def handle_stream(fh, name: str) -> None:
        root = None
        context = etree.iterparse(fh, events=("start", "end"))
        for event, elem in context:
            if event == "start":
                if root is None:
                    root = elem
                continue
            tag = localname(elem.tag)
            spec = GML_PARCEL_TAGS.get(tag)
            if spec is None:
                # Keep memory flat: drop every finished feature we are not
                # interested in — top-level ones and those wrapped in
                # (gml:)featureMember/member (NAS extracts) or wfs:Insert/
                # Replace/Update (NAS update deliveries, e.g. Hessen's NBA files,
                # where ~337k buildings/land-use objects precede the parcels).
                parent = elem.getparent()
                if parent is not None and (
                    parent is root
                    or localname(parent.tag) in ("featureMember", "member", "featureMembers",
                                                 "Insert", "Replace", "Update")
                ):
                    elem.clear()
                    parent.remove(elem)
                continue
            fields: dict[str, str | None] = {"kennz": None, "area": None,
                                             "gmk": None, "muni": None, "kreis": None}
            for node in elem.iter():
                nl = localname(node.tag)
                for key in ("kennz", "area", "gmk", "muni", "kreis"):
                    if nl in spec[key] and node.text and fields[key] is None:
                        fields[key] = node.text.strip()

            polygons: list[list] = []
            for poly in elem.iter():
                if localname(poly.tag) not in POLY_TAGS:
                    continue
                rings: list[list] = []
                for ring_el in poly:
                    rl = localname(ring_el.tag)
                    if rl not in RING_TAGS:
                        continue
                    coords: list[list[float]] = []
                    for pl in ring_el.iter():
                        if localname(pl.tag) != "posList" or not pl.text:
                            continue
                        dim = int(pl.get("srsDimension", "2"))
                        part = ring_from_poslist(pl.text, dim, axis_latlon, tf,
                                                 min_points=2)
                        if not part:
                            continue
                        if coords and coords[-1] == part[0]:
                            part = part[1:]  # NAS segments share endpoints
                        coords.extend(part)
                    if len(coords) < 3:
                        continue
                    if coords[0] != coords[-1]:
                        coords.append(coords[0])
                    if len(coords) >= 4:
                        if rl == "exterior":
                            rings.insert(0, coords)
                        else:
                            rings.append(coords)
                if rings:
                    polygons.append(rings)
            if fields["kennz"] and polygons:
                geometry = (
                    {"type": "Polygon", "coordinates": polygons[0]}
                    if len(polygons) == 1
                    else {"type": "MultiPolygon", "coordinates": polygons}
                )
                xs = [p[0] for poly in polygons for p in poly[0]]
                ys = [p[1] for poly in polygons for p in poly[0]]
                bounds = (min(xs), min(ys), max(xs), max(ys))
                centroid = (sum(xs) / len(xs), sum(ys) / len(ys))
                sink.add(fields["kennz"], fields["area"], fields["gmk"],
                         fields["muni"], fields["kreis"], geometry, bounds, centroid)
            if tag in GML_PARCEL_TAGS:
                elem.clear()
                parent = elem.getparent()
                if parent is not None:
                    parent.remove(elem)

    paths = sorted(p for p in src.rglob("*")
                   if p.suffix.lower() in (".gml", ".xml", ".zip"))
    if not paths:
        raise SystemExit(f"ERROR: no GML/zip files under {src}")
    done = 0
    for path in paths:
        if path.suffix.lower() == ".zip":
            with zipfile.ZipFile(path) as zf:
                for n in zf.namelist():
                    if n.lower().endswith((".gml", ".xml")):
                        with zf.open(n) as fh:
                            handle_stream(fh, n)
        else:
            with open(path, "rb") as fh:
                handle_stream(fh, path.name)
        done += 1
        if done % 100 == 0 or done == len(paths):
            print(f"  {done}/{len(paths)} files, {sink.count} parcels")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--land", required=True, help="2-digit Land prefix, e.g. 03")
    ap.add_argument("--src", required=True, help="directory with downloaded data")
    ap.add_argument("--mode", choices=["auto", "ogr", "gml"], default="auto")
    ap.add_argument("--crs", type=int, default=25832,
                    help="source EPSG for GML path / CRS-less files (default 25832)")
    ap.add_argument("--axis", choices=["xy", "latlon"], default="xy",
                    help="posList axis order in the GML path (4258 URNs are latlon)")
    ap.add_argument("--out", default="out")
    ap.add_argument("--admin", default="downloads/vg250/vg250_ebenen_0101/DE_VG250.gpkg",
                    help="BKG VG250 GeoPackage used to fill missing Gemeinde/Kreis "
                         "names ('' to disable)")
    args = ap.parse_args()

    src = Path(args.src)
    if not src.is_dir():
        raise SystemExit(f"ERROR: {src} is not a directory")
    admin = None
    if args.admin and Path(args.admin).exists():
        admin = AdminLookup(Path(args.admin), args.land)
    elif args.admin:
        print(f"NOTE: {args.admin} not found — Gemeinde/Kreis gaps stay empty")
    sink = Sink(args.land, Path(args.out), admin)

    mode = args.mode
    if mode == "auto":
        has_vec = any(p.suffix.lower() in (".gpkg", ".shp") for p in src.rglob("*")) or \
            any(n.lower().endswith((".gpkg", ".shp"))
                for p in src.rglob("*.zip") for n in zipfile.ZipFile(p).namelist())
        mode = "ogr" if has_vec else "gml"
    print(f"Land {args.land}, mode {mode}, src {src}")
    if mode == "ogr":
        run_ogr(src, sink, args.crs)
    else:
        run_gml(src, sink, args.crs, args.axis == "latlon")
    sink.close()


if __name__ == "__main__":
    main()
