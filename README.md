# 1Sense Data — German Property MCP

Look up German land parcels, zoning values and company structures. Owner chains
available via early access.

Remote MCP server (Streamable HTTP) on Cloudflare Workers for AI agents doing
site acquisition, deal screening, collateral checks and expansion planning in
Germany.

- **Endpoint:** `https://1sensedata.com/mcp`
- **Coverage (v1):** all of Nordrhein-Westfalen (NRW) — every Kreis and
  kreisfreie Stadt, ~9.4M parcels. Bavaria publishes no open parcel data —
  requests there return `coverage: "not-available"`. Every response states its
  coverage.
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

## Data sources & licenses

| Data | Source | License |
|---|---|---|
| Parcels (Flurstücke) | [ALKIS "Grundrissdaten vereinfacht" GeoPackage, per Kreis](https://www.opengeodata.nrw.de/produkte/geobasis/lk/akt/gru_vereinfacht_gpkg/) | [dl-de/zero-2.0](https://www.govdata.de/dl-de/zero-2-0) — no restrictions, no attribution required |
| Bodenrichtwerte | [BORIS-NRW land-wide shapefile](https://www.opengeodata.nrw.de/produkte/infrastruktur_bauen_wohnen/boris/BRW/BRW_EPSG25832_Shape.zip) | [dl-de/zero-2.0](https://www.govdata.de/dl-de/zero-2-0) |
| Companies (Handelsregister) | [OffeneRegister dump](https://daten.offeneregister.de/de_companies_ocdata.jsonl.bz2) | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) — company data sourced from [OpenCorporates](https://opencorporates.com/) via OffeneRegister.de |

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

## NRW ingestion

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

## Architecture

- Cloudflare Workers + Durable Objects (`agents/mcp` McpAgent, Streamable HTTP)
- D1: parcel index, Bodenrichtwert zones (bbox prefilter), companies, leads,
  rate limits, request log. R2: parcel geometry per Flur, BRW zone polygons;
  point-in-polygon runs in the Worker.
- Every tool call is logged: tool, args hash (SHA-256), country, `locked_hit`
  (the KPI).
