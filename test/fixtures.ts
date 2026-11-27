import type { ToolContext } from "../src/lib/types.js";
import { TOOLS, type ToolDef } from "../src/tools/registry.js";

/** Köln parcel with geometry, BRW zone and owner-chain metadata. */
export const PARCEL_A = "05260100700123";
/** Köln parcel with Nenner, neighbor of A. */
export const PARCEL_B = "05260100700124/0005";
/** Düsseldorf parcel without gated metadata. */
export const PARCEL_C = "05110100200050";
/** A natural person seeded as an officer — must NEVER appear in any response. */
export const PERSON_NAME = "Max Mustermann";

export const COMPANY_ID = "Koeln-HRB12345";
export const COMPANY_NAME = "Objekt Rheinpark GmbH & Co. KG";

export function toolDef(name: string): ToolDef {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) throw new Error(`unknown tool ${name}`);
  return def;
}

export function makeCtx(env: Env, ip = "203.0.113.7"): ToolContext {
  return { env, ip, country: "DE" };
}

function square(
  lng: number,
  lat: number,
  d: number,
): [number, number][][] {
  return [
    [
      [lng - d, lat - d],
      [lng + d, lat - d],
      [lng + d, lat + d],
      [lng - d, lat + d],
      [lng - d, lat - d],
    ],
  ];
}

export async function seedParcels(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO parcels (id, land, gemarkung_nr, gemarkung_name, flur, zaehler, nenner,
        municipality, kreis, area_m2, centroid_lat, centroid_lng, minx, miny, maxx, maxy, geometry_key)
       VALUES ('${PARCEL_A}', '05', '2601', 'Lindenthal', '007', '00123', NULL,
        'Köln', 'Köln', 5200, 50.94, 6.95, 6.9495, 50.9395, 6.9505, 50.9405, 'geo/parcels/2601/007.json')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO parcels (id, land, gemarkung_nr, gemarkung_name, flur, zaehler, nenner,
        municipality, kreis, area_m2, centroid_lat, centroid_lng, minx, miny, maxx, maxy, geometry_key)
       VALUES ('${PARCEL_B}', '05', '2601', 'Lindenthal', '007', '00124', '0005',
        'Köln', 'Köln', 1200, 50.9406, 6.9508, 6.9505, 50.9405, 6.9511, 50.9409, 'geo/parcels/2601/007.json')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO parcels (id, land, gemarkung_nr, gemarkung_name, flur, zaehler, nenner,
        municipality, kreis, area_m2, centroid_lat, centroid_lng, minx, miny, maxx, maxy, geometry_key)
       VALUES ('${PARCEL_C}', '05', '1101', 'Stadtmitte', '002', '00050', NULL,
        'Düsseldorf', 'Düsseldorf', 8000, 51.2277, 6.7735, 6.773, 51.2272, 6.774, 51.2282, NULL)`,
    ),
  ]);

  await env.GEO.put(
    "geo/parcels/2601/007.json",
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: PARCEL_A },
          geometry: { type: "Polygon", coordinates: square(6.95, 50.94, 0.0005) },
        },
        {
          type: "Feature",
          properties: { id: PARCEL_B },
          geometry: { type: "Polygon", coordinates: square(6.9508, 50.9406, 0.0002) },
        },
      ],
    }),
  );
}

export async function seedBrw(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO bodenrichtwerte (zone_id, brw_eur_m2, stand, nutzungsart, entwicklungszustand,
        municipality, minx, miny, maxx, maxy, geometry_key)
       VALUES ('BRW-K-001', 950, '2025-01-01', 'W - Wohnbaufläche', 'B',
        'Köln', 6.94, 50.93, 6.96, 50.95, 'geo/brw/BRW-K-001.json')`,
    ),
    // Bbox overlaps the test point, polygon does not — must be filtered out.
    env.DB.prepare(
      `INSERT OR IGNORE INTO bodenrichtwerte (zone_id, brw_eur_m2, stand, nutzungsart, entwicklungszustand,
        municipality, minx, miny, maxx, maxy, geometry_key)
       VALUES ('BRW-K-002', 2400, '2025-01-01', 'G - Gewerbliche Baufläche', 'B',
        'Köln', 6.94, 50.93, 6.96, 50.95, 'geo/brw/BRW-K-002.json')`,
    ),
  ]);

  await env.GEO.put(
    "geo/brw/BRW-K-001.json",
    JSON.stringify({
      type: "Feature",
      properties: { zone_id: "BRW-K-001" },
      geometry: { type: "Polygon", coordinates: square(6.95, 50.94, 0.005) },
    }),
  );
  await env.GEO.put(
    "geo/brw/BRW-K-002.json",
    JSON.stringify({
      type: "Feature",
      properties: { zone_id: "BRW-K-002" },
      geometry: { type: "Polygon", coordinates: square(6.958, 50.948, 0.001) },
    }),
  );
}

export async function seedCompanies(env: Env): Promise<void> {
  await env.DB.batch([
    // Officers has no unique key, so clear before re-seeding (storage is shared
    // across tests in the same worker).
    env.DB.prepare(`DELETE FROM officers WHERE company_id = '${COMPANY_ID}'`),
    env.DB.prepare(
      `INSERT OR IGNORE INTO companies (id, name, court, register_number, seat, status, purpose, is_spv)
       VALUES ('${COMPANY_ID}', '${COMPANY_NAME}', 'Amtsgericht Köln', 'HRB 12345', 'Köln', 'aktiv',
        'Erwerb, Verwaltung und Verwertung von Grundstücken', 1)`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO companies (id, name, court, register_number, seat, status, purpose, is_spv)
       VALUES ('Koeln-HRB12346', 'Objekt Rheinpark Verwaltungs GmbH', 'Amtsgericht Köln', 'HRB 12346',
        'Köln', 'aktiv', 'Verwaltung eigenen Vermögens', 0)`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO officers (company_id, name, role, is_legal_entity)
       VALUES ('${COMPANY_ID}', 'Objekt Rheinpark Verwaltungs GmbH', 'Komplementärin', 1)`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO officers (company_id, name, role, is_legal_entity)
       VALUES ('${COMPANY_ID}', '${PERSON_NAME}', 'Geschäftsführer', 0)`,
    ),
  ]);
}

export async function seedGatedMeta(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO owner_chain_meta (parcel_id, owner_entity_type, intermediate_holdings, chain_depth, updated_at)
       VALUES ('${PARCEL_A}', 'Objektgesellschaft', 1, 2, '2026-11-01T00:00:00Z')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO company_properties_meta (company_id, property_count, cities, updated_at)
       VALUES ('${COMPANY_ID}', 3, '["Köln","Leverkusen"]', '2026-11-01T00:00:00Z')`,
    ),
  ]);
}

export async function seedAll(env: Env): Promise<void> {
  await seedParcels(env);
  await seedBrw(env);
  await seedCompanies(env);
  await seedGatedMeta(env);
}

/** Recursively collects every object key in a JSON-like value. */
export function collectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}
