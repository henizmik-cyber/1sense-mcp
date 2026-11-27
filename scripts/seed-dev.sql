-- Small dev fixture for wrangler dev (mirrors test/fixtures.ts).
INSERT OR REPLACE INTO parcels (id, land, gemarkung_nr, gemarkung_name, flur, zaehler, nenner,
  municipality, kreis, area_m2, centroid_lat, centroid_lng, minx, miny, maxx, maxy, geometry_key)
VALUES
  ('05260100700123', '05', '2601', 'Lindenthal', '007', '00123', NULL,
   'Köln', 'Köln', 5200, 50.94, 6.95, 6.9495, 50.9395, 6.9505, 50.9405, 'geo/parcels/2601/007.json'),
  ('05260100700124/0005', '05', '2601', 'Lindenthal', '007', '00124', '0005',
   'Köln', 'Köln', 1200, 50.9406, 6.9508, 6.9505, 50.9405, 6.9511, 50.9409, 'geo/parcels/2601/007.json'),
  ('05110100200050', '05', '1101', 'Stadtmitte', '002', '00050', NULL,
   'Düsseldorf', 'Düsseldorf', 8000, 51.2277, 6.7735, 6.773, 51.2272, 6.774, 51.2282, NULL);

INSERT OR REPLACE INTO bodenrichtwerte (zone_id, brw_eur_m2, stand, nutzungsart, entwicklungszustand,
  municipality, minx, miny, maxx, maxy, geometry_key)
VALUES
  ('BRW-K-001', 950, '2025-01-01', 'W - Wohnbaufläche', 'B', 'Köln',
   6.94, 50.93, 6.96, 50.95, 'geo/brw/BRW-K-001.json');

INSERT OR REPLACE INTO companies (id, name, court, register_number, seat, status, purpose, is_spv)
VALUES
  ('Koeln-HRB12345', 'Objekt Rheinpark GmbH & Co. KG', 'Amtsgericht Köln', 'HRB 12345', 'Köln',
   'aktiv', 'Erwerb, Verwaltung und Verwertung von Grundstücken', 1);

DELETE FROM officers WHERE company_id = 'Koeln-HRB12345';
INSERT INTO officers (company_id, name, role, is_legal_entity)
VALUES ('Koeln-HRB12345', 'Objekt Rheinpark Verwaltungs GmbH', 'Komplementärin', 1);

INSERT OR REPLACE INTO owner_chain_meta (parcel_id, owner_entity_type, intermediate_holdings, chain_depth, updated_at)
VALUES ('05260100700123', 'Objektgesellschaft', 1, 2, '2026-11-01T00:00:00Z');

INSERT OR REPLACE INTO company_properties_meta (company_id, property_count, cities, updated_at)
VALUES ('Koeln-HRB12345', 3, '["Köln","Leverkusen"]', '2026-11-01T00:00:00Z');
