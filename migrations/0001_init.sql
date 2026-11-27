-- 1Sense MCP v1 schema. NRW only; see HANDOFF-MCP.md.

CREATE TABLE IF NOT EXISTS parcels (
  id TEXT PRIMARY KEY,              -- normalized Flurstückskennzeichen (digits + '/')
  land TEXT NOT NULL,               -- 2-digit Bundesland prefix, '05' = NRW
  gemarkung_nr TEXT NOT NULL,
  gemarkung_name TEXT,
  flur TEXT NOT NULL,
  zaehler TEXT NOT NULL,
  nenner TEXT,
  municipality TEXT,                -- Gemeinde name, e.g. 'Köln'
  kreis TEXT,
  area_m2 REAL,
  centroid_lat REAL,
  centroid_lng REAL,
  minx REAL, miny REAL, maxx REAL, maxy REAL,  -- WGS84 bbox
  geometry_key TEXT                 -- R2 key of the per-Flur GeoJSON file
);
CREATE INDEX IF NOT EXISTS idx_parcels_municipality ON parcels (municipality);
CREATE INDEX IF NOT EXISTS idx_parcels_area ON parcels (area_m2);
CREATE INDEX IF NOT EXISTS idx_parcels_bbox ON parcels (centroid_lat, centroid_lng);

CREATE TABLE IF NOT EXISTS bodenrichtwerte (
  zone_id TEXT PRIMARY KEY,
  brw_eur_m2 REAL,
  stand TEXT,                       -- Stichtag, e.g. '2025-01-01'
  nutzungsart TEXT,
  entwicklungszustand TEXT,
  municipality TEXT,
  minx REAL, miny REAL, maxx REAL, maxy REAL,  -- WGS84 bbox for prefilter
  geometry_key TEXT                 -- R2 key of the zone polygon GeoJSON
);
CREATE INDEX IF NOT EXISTS idx_brw_bbox ON bodenrichtwerte (minx, maxx, miny, maxy);
CREATE INDEX IF NOT EXISTS idx_brw_municipality ON bodenrichtwerte (municipality);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,              -- '<court>-<register>' e.g. 'Koeln-HRB12345'
  name TEXT NOT NULL,
  court TEXT,
  register_number TEXT,             -- e.g. 'HRB 12345'
  seat TEXT,
  status TEXT,
  purpose TEXT,                     -- Unternehmensgegenstand
  is_spv INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies (name);
CREATE INDEX IF NOT EXISTS idx_companies_register ON companies (register_number);

-- Officers: natural persons are ingested with is_legal_entity = 0 and are NEVER
-- returned by any tool. Only legal entities (is_legal_entity = 1) may appear in
-- responses. See src/tools/companies.ts.
CREATE TABLE IF NOT EXISTS officers (
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  is_legal_entity INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (company_id) REFERENCES companies (id)
);
CREATE INDEX IF NOT EXISTS idx_officers_company ON officers (company_id);

-- Gated-data metadata: structure/counts ONLY, never names. The gated tools read
-- exclusively from these two tables.
CREATE TABLE IF NOT EXISTS owner_chain_meta (
  parcel_id TEXT PRIMARY KEY,
  owner_entity_type TEXT,           -- e.g. 'Objektgesellschaft', 'GmbH & Co. KG'
  intermediate_holdings INTEGER NOT NULL DEFAULT 0,
  chain_depth INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS company_properties_meta (
  company_id TEXT PRIMARY KEY,
  property_count INTEGER NOT NULL DEFAULT 0,
  cities TEXT,                      -- JSON array of city names
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  use_case TEXT,
  source_tool TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip_hash TEXT NOT NULL,
  day TEXT NOT NULL,                -- UTC date 'YYYY-MM-DD'
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, day)
);

CREATE TABLE IF NOT EXISTS request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  tool TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  country TEXT,
  locked_hit INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_request_log_tool ON request_log (tool, ts);
