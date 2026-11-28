-- Parcel shard schema: one D1 per Länder group (NRW stays in the main DB).
-- Mirrors the parcels table in migrations/0001_init.sql exactly.

CREATE TABLE IF NOT EXISTS parcels (
  id TEXT PRIMARY KEY,              -- normalized Flurstückskennzeichen (digits + '/')
  land TEXT NOT NULL,               -- 2-digit Bundesland prefix
  gemarkung_nr TEXT NOT NULL,
  gemarkung_name TEXT,
  flur TEXT NOT NULL,
  zaehler TEXT NOT NULL,
  nenner TEXT,
  municipality TEXT,
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
