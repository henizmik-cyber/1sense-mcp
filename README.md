# 1Sense Data — German Property MCP

Look up German land parcels, zoning values and company structures. Owner chains
available via early access.

Remote MCP server (Streamable HTTP) on Cloudflare Workers for AI agents doing
site acquisition, deal screening, collateral checks and expansion planning in
Germany.

- **Endpoint:** `https://1sensedata.com/mcp`
- **Coverage:** parcels from the open cadastre data of every Land except
  Bavaria (which publishes none — requests there return
  `coverage: "not-available"`); Länder are added as their data is loaded (see
  `INGESTED_LANDS` in `src/lib/coverage.ts`). Bodenrichtwerte only where a Land
  publishes them openly: NRW, Niedersachsen, Bremen, Hamburg, Hessen (2024),
  Berlin, Brandenburg, Mecklenburg-Vorpommern,
  Sachsen-Anhalt, Thüringen. Every response states its coverage; for Länder
  without open Bodenrichtwerte it says why.
- **Access tiers:** anonymous use is limited to 10 tool calls per day per IP;
  `request_access` (always available) is how you get early access and higher
  limits.

## Install

**Claude Code**

```bash
claude mcp add --transport http 1sense https://1sensedata.com/mcp
```

**Claude Desktop** — Settings → Connectors → *Add custom connector* with the
URL above, or via `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "1sense": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://1sensedata.com/mcp"]
    }
  }
}
```

**Cursor** — `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "1sense": { "url": "https://1sensedata.com/mcp" }
  }
}
```

## Example prompts

1. *"Find parcels over 5.000 m² in Köln and tell me the Bodenrichtwert for the
   three largest."*
2. *"What is the Bodenrichtwert at lat 50.94, lng 6.95, and roughly how much
   GFA could a 5.200 m² parcel there support?"*
3. *"Look up 'Objekt Rheinpark' in the company register, show its structure,
   and check who owns parcel 05 2601 007 00123."*

## Tools

| Tool | Access | What it returns |
|---|---|---|
| `search_parcels` | open | Parcels by city/bbox + size filters: id, size, municipality, centroid, map link |
| `get_parcel` | open | One parcel: GeoJSON geometry, size, Gemarkung/Flur, approximate neighbors, map link |
| `get_bodenrichtwert` | open | Official land value zone(s) for a parcel or point: EUR/m², Stand, Nutzungsart |
| `find_company` | open | Register data: court, seat, status, purpose, SPV indicator, officers (**legal entities only**), related entities |
| `estimate_buildable` | open | Rough GFA estimate from default GRZ/floors — clearly labeled, no zoning/LoD2 in v1 |
| `get_owner_chain` | early access | Locked preview: owner entity type + chain structure. Never a person's name |
| `company_properties` | early access | Locked preview: property count + cities only |
| `request_access` | open, unlimited | Records your email + use case, confirms |

Every tool returns a typed JSON envelope: `{ ok, coverage, coverage_note?, data }`
on success, `{ ok: false, error: { code, message } }` on failure (codes:
`invalid_arguments`, `no_data`, `rate_limited`, `internal_error` — never stack
traces). Gated tools return `{ status: "locked", preview, unlock }`.

**Personal data policy:** no tool returns a natural person's name or any other
personal data, on any code path. Officer lists are filtered to legal entities;
owner-chain previews carry counts and structure depth only.

## Map explorer

`https://1sensedata.com/map` — the product's visible face: a full-bleed
MapLibre map of the loaded Länder's parcels and Bodenrichtwert zones in the
1Sense ink-on-paper look. Every parcel click shows open facts plus the locked
owner card that funnels to `/access`. No personal data is rendered anywhere.
`/map/quellen` lists every source with its required attribution and license
(several Länder use CC BY 4.0 / dl-de/by-2.0); the map links to it.

- **Views:** Karte (OpenFreeMap Liberty, recolored client-side to the sand
  palette) and Satellit (Geobasis NRW DOP WMTS, dl-de/zero-2.0; its tile
  matrix identifiers are web zoom − 5, mapped in `transformRequest`). Satellit
  is NRW-only for now and greyed out elsewhere.
- **Vector tiles:** three PMTiles files in R2 (`tiles/parcels.pmtiles` z13–16,
  `tiles/brw.pmtiles` z8–14, `tiles/buildings.pmtiles` z13–16), built by
  tippecanoe from the ingest pipeline's NDJSON output (`out/tiles/*.ndjson`)
  and served by the Worker's range proxy `GET /map/tiles/{file}`.
- **3D buildings:** official LoD2 models (footprint + measured height,
  `ingest_lod2.py` streams the ~220 GB CityGML kachel set), rendered as
  fill-extrusions behind the 3D chip, which also pitches the camera.
- **Parcel facts:** `GET /map/api/parcel?id=` reuses the MCP tool logic
  (D1 lookup + BRW point-in-polygon). Rate limits: tile reads are unlimited
  (static range reads); the parcel API has its own budget of 300 lookups per
  day per IP (`MAP_API_DAILY_LIMIT`), counted under a `map:`-prefixed key so
  map use never consumes the MCP tool budget (10/day anonymous) or vice versa.

Build & upload the tilesets after an ingest run:

```bash
cd scripts/ingest
tippecanoe -o out/tiles/parcels.pmtiles -l parcels -Z13 -z16 -q --force \
  --read-parallel --drop-densest-as-needed --coalesce-densest-as-needed \
  --detect-shared-borders out/tiles/parcels.ndjson
tippecanoe -o out/tiles/brw.pmtiles -l brw -Z8 -z14 -q --force \
  --read-parallel --drop-densest-as-needed --coalesce-densest-as-needed \
  --detect-shared-borders --simplify-only-low-zooms out/tiles/brw.ndjson
python3 ingest_lod2.py                # streams LoD2 kacheln (hours, resumable)
cat out/tiles/lod2/*.ndjson > out/tiles/buildings.ndjson
tippecanoe -o out/tiles/buildings.pmtiles -l buildings -Z13 -z16 -q --force \
  --read-parallel --drop-densest-as-needed out/tiles/buildings.ndjson
python3 upload_tiles.py               # same S3 credentials as upload_r2.py
```

## Data sources & licenses

Parcels and Bodenrichtwerte come from each Land's own open-data portal; the
full per-Land list with required attributions is served at `/map/quellen`
(`src/sources-page.ts`). The national BKG product FS-DE is **not** open
(V GeoBund only), and Bavaria sells its parcel data, so neither is used.
Missing Gemeinde/Kreis names in INSPIRE-format Länder (RP, SL, TH) are filled
from BKG VG250 (dl-de/by-2.0). NRW:

| Data | Source | License |
|---|---|---|
| Parcels (Flurstücke) | [ALKIS "Grundrissdaten vereinfacht" GeoPackage, per Kreis](https://www.opengeodata.nrw.de/produkte/geobasis/lk/akt/gru_vereinfacht_gpkg/) | [dl-de/zero-2.0](https://www.govdata.de/dl-de/zero-2-0) — no restrictions, no attribution required |
| Bodenrichtwerte | [BORIS-NRW land-wide shapefile](https://www.opengeodata.nrw.de/produkte/infrastruktur_bauen_wohnen/boris/BRW/BRW_EPSG25832_Shape.zip) | [dl-de/zero-2.0](https://www.govdata.de/dl-de/zero-2-0) |
| Companies (Handelsregister) | [OffeneRegister dump](https://daten.offeneregister.de/de_companies_ocdata.jsonl.bz2) | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) — company data sourced from [OpenCorporates](https://opencorporates.com/) via OffeneRegister.de |
| 3D buildings (LoD2) | [CityGML per 1-km kachel](https://www.opengeodata.nrw.de/produkte/geobasis/3dg/lod2_gml/lod2_gml/) | [dl-de/zero-2.0](https://www.govdata.de/dl-de/zero-2-0) |

Source geodata is EPSG:25832; the API serves WGS84. Parcels update quarterly,
Bodenrichtwerte annually. The company dump is a **snapshot of 2019-02-05**
(Germany-wide); `find_company` says so in its responses, and live
Handelsregister updates are a later ingestion stage. The dump carries no
Unternehmensgegenstand, so the SPV indicator is name-pattern-based only.
URLs verified against the portals on 2026-11-26.

## Development

```bash
npm install
npm test                  # vitest (Workers runtime): locks, rate limit, happy paths
npm run db:migrate:local  # apply migrations to the local D1
npm run seed:local        # small Köln/Düsseldorf fixture incl. local R2 geometry
npm run dev               # wrangler dev on :8787
npm run smoke             # MCP client against the running dev server
```

## Deploy

```bash
npx wrangler d1 create onesense       # once; paste the id into wrangler.jsonc
npx wrangler r2 bucket create onesense-geo   # once
npm run db:migrate:remote
npm run deploy
```

## Ingestion (NRW)

Offline Python pipeline (see `scripts/ingest/`):

```bash
cd scripts/ingest
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python3 ingest_parcels.py --all       # full NRW; default (no flag) is Köln + Düsseldorf
python3 ingest_brw.py                 # BORIS-NRW land-wide (~184 MB download)

./load_d1.sh remote                   # or: ./load_d1.sh local
python3 upload_r2.py                  # S3 API (fast); or --wrangler / --wrangler-local

# Companies (Germany-wide, OffeneRegister dump, ~260 MB):
curl -o downloads/de_companies_ocdata.jsonl.bz2 https://daten.offeneregister.de/de_companies_ocdata.jsonl.bz2
python3 ingest_companies.py           # --limit N for smoke runs, --land "North Rhine-Westphalia" to filter
./load_d1.sh remote out/sql-companies
```

`upload_r2.py` wants `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` for the fast parallel path.

## Other Länder

Parcels beyond NRW live in four D1 shards (`DB_NORTH`, `DB_WEST`, `DB_BW`,
`DB_EAST`, schema in `migrations-shard/`), routed by the Kennzeichen's Land
prefix in `src/lib/shards.ts`; each shard stays far below D1's 10 GB cap.

```bash
cd scripts/ingest
python3 download_lands.py sh          # also: he, sl, bw, be, th (other Länder are single
                                      # downloads — every URL is in docs/germany-sources.md)
python3 ingest_land.py --land 03 --src downloads/ni           # GPKG/Shape (OGR path)
python3 ingest_land.py --land 07 --src downloads/rp --mode gml --crs 4258 --axis latlon
python3 ingest_land.py --land 02 --src downloads/hh --mode gml --crs 25832   # raw NAS
DB_NAME=onesense-p-north ./load_d1.sh remote out/sql-03

python3 ingest_brw_land.py --land 06  # Bodenrichtwerte: 02 06 11 12 15 16
./load_d1.sh remote out/sql-brw-06    # main DB (bodenrichtwerte.land, migration 0002)
```

Then add the Land to `INGESTED_LANDS` / `BRW_LANDS` in `src/lib/coverage.ts`,
rebuild the PMTiles from all `out/tiles/parcels*.ndjson` / `brw*.ndjson`, and
deploy. Format gotchas the ingesters handle: Hamburg pads the empty Flur with
`_` (Kennzeichen are read by position), Sachsen numbers parcels with letters
(`40a` → Nenner `000a`), Hessen's NAS update deliveries wrap features in
`wfs:Insert`, INSPIRE Länder in EPSG:4258 list latitude first, and Hamburg's
BRW CSV gives each of ~7 values per zone its own number (grouped by polygon).

## Architecture

- Cloudflare Workers + Durable Objects (`agents/mcp` McpAgent, Streamable HTTP)
- D1: parcel index, Bodenrichtwert zones (bbox prefilter), companies, leads,
  rate limits, request log. R2: parcel geometry per Flur, BRW zone polygons;
  point-in-polygon runs in the Worker.
- Every tool call is logged: tool, args hash (SHA-256), country, `locked_hit`
  (the KPI).
