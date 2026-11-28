# Germany rollout — verified open-data sources (probed 2026-11-27/28)

All URLs below were probed live by research agents. Details per Land are in
the session transcript; this is the reusable summary.

## Phase 1 — parcels (status 2026-11-28)
Bavaria: closed (fee 1.80 €/parcel, GebOVerm). FS-DE (BKG national) is NOT
open — V GeoBund only. Everything else is per-Land, ingested with
scripts/ingest/ingest_land.py + download_lands.py.

| Land | Channel | Parcels |
|---|---|---|
| SH | ATOM -> per-Gemeinde WFS GML (CC BY 4.0) | downloading |
| HH | NAS zip, 289 files (dl-de/by-2.0) | 261,686 |
| NI | 45 per-Kreis GPKG, IBM COS bucket (CC BY 4.0) | 6,284,710 |
| HB | AdV-Shape zip-in-zip (CC BY 4.0) | 207,099 |
| HE | Downloadcenter REST, per-Kreis NAS packages (no conditions) | ingesting |
| RP | INSPIRE CP GML, one file, EPSG:4258 lat/lon (dl-de/by-2.0) | 6,203,229 |
| BW | per-Gemarkung Shape zips, ~100 KB/s per connection (dl-de/by-2.0) | downloading (days) |
| SL | INSPIRE WFS paged, EPSG:4258 lat/lon (dl-de/by-2.0) | 1,282,212 |
| BE | WFS paged, 25,000/page (dl-de/zero-2.0) | 403,586 |
| BB | per-Kreis Shape dir listing (dl-de/by-2.0) | 3,146,270 |
| MV | AAA2Shape Land zip, EPSG:25833 (CC BY 4.0) | 1,959,974 |
| SN | NAS zip-in-zip, 48 GB XML, EPSG:25833 (dl-de/by-2.0) | re-ingesting (letter Nenner) |
| ST | GBIS GML vereinfacht, statewide zip (dl-de/by-2.0) | 2,699,693 |
| TH | INSPIRE Atom -> 2,704 Gemarkung zips (CC BY 4.0) | ingesting |

Gemeinde/Kreis names missing in INSPIRE data are filled from BKG VG250
(dl-de/by-2.0, "© GeoBasis-DE / BKG") — needs map attribution.

Gotchas: Hamburg Kennzeichen pads the empty Flur with '_' (read by position);
Sachsen Nenner carries letters ("40a" -> /000a); Flurstücksfolge (chars 19-20)
is not needed for uniqueness; NumPy 2 repr broke SQL floats (fixed).

## Phase 2 — Bodenrichtwerte, north/east (probed 2026-11-28)
- Hamburg: OPEN dl-de/by-2.0 — https://www.daten-hamburg.de/opendata/bodenrichtwerte/Bodenrichtwerte_HH_2026_csv.zip
  (198 MB, VBORIS CSV `|`, WKT; eastings carry "32" zone prefix). Annual, 2026-01-01.
  WFS has geometry but no values. Several values per zone (EFH/MFH) — key on zone+Nutzung.
- Berlin: OPEN dl-de/zero-2.0 — WFS https://gdi.berlin.de/services/wfs/brw2026, brw2026:brw2026_vector,
  1,623 zones, GeoJSON in one request (8.6 MB). No Entwicklungszustand field. EPSG:25833.
- Brandenburg: OPEN dl-de/by-2.0 (© GeoBasis-DE/LGB) — OGC API
  https://ogc-api.geobasis-bb.de/boris/collections/br_bodenrichtwert/items?f=json&stichtag=2026-01-01
  8,201 items, limit/offset paging, geometry joined. EPSG:25833 default.
- Sachsen-Anhalt: OPEN dl-de/by-2.0 — https://www.lvermgeo.sachsen-anhalt.de/datei/anzeigen/id/646905,501/brw_20260101_v1.zip
  (51 MB, no Range). Use the CSV br_15_2026-01-01.csv (has GENA). Biennial.
- Thüringen: OPEN CC BY 4.0 (© GDI-Th) — WFS https://www.geoproxy.geoportal-th.de/geoproxy/services/boris/boris_wfs
  boris:bodenrichtwertzone, filter STICHTAG=2026-01-01 -> 22,941; use GML 3.2 (JSON output broken).
- Niedersachsen / Bremen: documented open (dl-de/by-2.0 / CC BY 4.0) at
  https://opendata.lgln.niedersachsen.de/doorman/noauth/boris_2026_wfs and borishb_2026_wfs —
  all LGLN endpoints 503 during the probe. RE-PROBE before building on them.
- NOT open: Sachsen (WMS raster; bulk on paid request; Leipzig city WFS has no license — skipped),
  Mecklenburg-Vorpommern (paid, GAKostVO), Schleswig-Holstein (viewer only; a Grundsteuer
  ArcGIS layer has no license — skipped).

## Phase 2 — Bodenrichtwerte, south/west
- Hessen: OPEN — WFS https://www.gds.hessen.de/wfs2/boris/cgi-bin/brw/2024/wfs
  boris:BR_BodenrichtwertZonal, 34,125 zones, dl-de/zero-2.0, Stichtag
  2024-01-01 (2026 is viewer-only). OUTPUTFORMAT=application/x-zip-csv,
  pipe-delimited Latin-1, geometry WKT column `umring`. DOWNLOADED to
  downloads/brw_he (7 pages, 34,125 rows verified).
- Rheinland-Pfalz: NOT open as vectors (raster WMS only; vector WFS 548 = 401/paid).
- Saarland: NOT open (terms forbid derived datasets).
- Baden-Württemberg: NOT open (BORIS-BW viewer, per-Gutachterausschuss contracts,
  no commercial use). Do not use credentials found in the viewer's public config.
- Bayern: NOT open (paid extracts).

## Phase 3 — LoD2 (inventory complete)
CityGML 1.0, bldg:measuredHeight + GroundSurface everywhere except SL.
CRS must be read per file (UTM33: BB, BE, MV, SN; SN uses
"urn:ogc:def:crs,crs:EPSG:6.12:25833,..." form).

| Land | Channel | Files | Size | CRS | License |
|---|---|---|---|---|---|
| BY | Metalink https://geodaten.bayern.de/odd/a/lod2/citygml/meta/metalink/09.meta4 (sha256, 2 mirrors) | 18,297 × 2 km | 152.7 GB raw | 25832 | CC BY 4.0 |
| NI | public S3 listing https://lod2.s3.eu-de.cloud-object-storage.appdomain.cloud/?list-type=2 | 37,940 × 1 km | 146.7 GB raw | 25832 | CC BY 4.0 |
| BB | https://data.geobasis-bb.de/geobasis/daten/3d_gebaeude/lod2_gml/ | 19,309 zips | 4.8 GB zip | 25833 | dl-de/by-2.0 |
| BE | Atom https://gdi.berlin.de/data/a_lod2/atom/0.atom (.xml inside zip) | 925 | 1.9 GB zip | 25833 | dl-de/zero-2.0 |
| HH | https://daten-hamburg.de/opendata/3d_stadtmodell_lod2/LoD2-DE_HH_2026-04-28.zip (follow 301 to www.) | 783 entries | 0.66 GB zip | 25832 | dl-de/by-2.0 |
| HB | https://gdi2.geo.bremen.de/inspire/download/LoD/data/LOD2_CITYGML_{HB,BHV}.zip (zip-in-zip) | 108+ | 0.48 GB | 25832 | CC BY 4.0 |
| SH | GeoJSON index ...single.php?file=LOD2_SH_Massendownload.geojson&id=4 -> data_link | 13,805 .xml | ? | 25832 | CC BY 4.0 |
| MV | Atom https://www.geodaten-mv.de/dienste/gebaeude_atom?type=dataset&id=8397b554-5cb9-4274-8be8-c20490d9a6e8 | 6,344 zips | ? | 25833 | CC BY 4.0 |
| SN | batch-download page JSON -> geocloud Nextcloud share AyJqXpJAZJXomCb | 4,942 zips | ~8.8 GB | 25833 | dl-de/by-2.0 |
| ST | LoD2-{1..4}.zip under .../Online-Bereitstellung-LVermGeo/3D/ | 5,439 entries | 4.5 GB zip / 49.7 raw | 25832 | dl-de/by-2.0 |
| RP | https://geobasis-rlp.de/data/geb3dlo/current/gml/ | 5,266 × 2 km | 62.1 GB raw | 25832 | dl-de/by-2.0 |
| BW | grid via MVT https://opengeodata.lgl-bw.de/tiles/vts/2x2Gitter/{z}/{x}/{y}.pbf -> downloadURL | 9,354 zips | ~17 GB zip | 25832 | dl-de/by-2.0 |
| HE | Downloadcenter REST path=3D-Daten/3D-Gebäudemodelle/3D-Gebäudemodelle LoD2, per Gemeinde, date-stamped URLs, HEAD 405 | 483 zips | ~10.5 GB zip | 25832 | HVGG §18 open |
| TH | OFFLINE since ~2026-11-20 (soft-200 970-byte outage page) — retry later | ? | ? | ? | CC BY 4.0 |
| SL | NOT open as CityGML (shop, restricted); INSPIRE BU-3D WFS only (EPSG:7423, no GroundSurface) | 738,006 features | — | — | dl-de/by-2.0 |

Note: Bayern LoD2 is open even though Bavarian parcels are not.
