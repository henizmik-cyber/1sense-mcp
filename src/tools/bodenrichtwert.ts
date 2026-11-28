import { type Envelope, type ToolContext, err, ok } from "../lib/types.js";
import {
  BAVARIA_NOTE,
  BRW_LANDS,
  BRW_NOT_OPEN,
  BRW_SOURCES,
  COVERED_NOTE,
  LAND_NAMES,
  brwNoteForLand,
  coverageForLandPrefix,
  coverageNoteForLandPrefix,
  coverageStatusForLand,
} from "../lib/coverage.js";
import { inBavaria } from "../lib/bavaria.js";
import {
  GERMANY_BBOX,
  type GeoJsonGeometry,
  inBbox,
  pointInGeometry,
} from "../lib/geo.js";
import { parseParcelId } from "../lib/parcel-id.js";
import { dbForLand } from "../lib/shards.js";

interface BrwRow {
  zone_id: string;
  brw_eur_m2: number | null;
  stand: string | null;
  nutzungsart: string | null;
  entwicklungszustand: string | null;
  municipality: string | null;
  geometry_key: string | null;
  land: string | null;
}

export interface GetBodenrichtwertArgs {
  parcel_id?: string;
  lat?: number;
  lng?: number;
}

export async function getBodenrichtwert(
  ctx: ToolContext,
  args: GetBodenrichtwertArgs,
): Promise<Envelope<unknown>> {
  let point: { lat: number; lng: number } | null = null;

  if (args.parcel_id) {
    const parsed = parseParcelId(args.parcel_id);
    if (!parsed) {
      return err(
        "invalid_arguments",
        `Could not parse "${args.parcel_id}" as a Flurstückskennzeichen.`,
      );
    }
    const coverage = coverageForLandPrefix(parsed.land);
    const db = dbForLand(ctx.env, parsed.land);
    if (coverage === "not-available" || coverage === "not-covered" || !db) {
      return ok(coverage, null, coverageNoteForLandPrefix(parsed.land));
    }
    if (!(parsed.land in BRW_LANDS)) {
      // Parcel is covered, but its Land publishes no open BRW (or not yet
      // loaded): say so instead of a bare "no data".
      return ok(coverage, null, brwNoteForLand(parsed.land));
    }
    const row = await db
      .prepare("SELECT centroid_lat, centroid_lng FROM parcels WHERE id = ?")
      .bind(parsed.normalized)
      .first<{ centroid_lat: number | null; centroid_lng: number | null }>();
    if (!row || row.centroid_lat === null || row.centroid_lng === null) {
      return err(
        "no_data",
        `No parcel with id ${parsed.normalized} in the ingested data — pass lat/lng instead, or check the id. ${COVERED_NOTE}`,
      );
    }
    point = { lat: row.centroid_lat, lng: row.centroid_lng };
  } else if (args.lat !== undefined && args.lng !== undefined) {
    point = { lat: args.lat, lng: args.lng };
    if (!inBbox({ lat: point.lat, lng: point.lng }, GERMANY_BBOX)) {
      return ok(
        "not-covered",
        null,
        `The point (${point.lat}, ${point.lng}) lies outside Germany. ${COVERED_NOTE}`,
      );
    }
  } else {
    return err(
      "invalid_arguments",
      "Provide either `parcel_id` or both `lat` and `lng` (WGS84).",
    );
  }

  const { results: candidates } = await ctx.env.DB.prepare(
    `SELECT zone_id, brw_eur_m2, stand, nutzungsart, entwicklungszustand, municipality, geometry_key, land
     FROM bodenrichtwerte
     WHERE minx <= ?1 AND maxx >= ?1 AND miny <= ?2 AND maxy >= ?2
     ORDER BY (maxx - minx) * (maxy - miny) ASC
     LIMIT 80`,
  )
    .bind(point.lng, point.lat)
    .all<BrwRow>();

  // Several values (EFH/MFH/…) can share one zone polygon and geometry file:
  // test each file once. Smallest bounding boxes come first, so a large
  // rural zone can't crowd the small urban zone that holds the point out of
  // the candidate window.
  const inside = new Map<string, boolean>();
  const MAX_GEOMETRY_FETCHES = 25;
  const matches: BrwRow[] = [];
  for (const cand of candidates) {
    const key = cand.geometry_key;
    if (!key) continue;
    if (!inside.has(key)) {
      if (inside.size >= MAX_GEOMETRY_FETCHES) break;
      let hit = false;
      const obj = await ctx.env.GEO.get(key);
      if (obj) {
        try {
          const feature = (await obj.json()) as { geometry?: GeoJsonGeometry };
          hit = !!feature.geometry && pointInGeometry(point, feature.geometry);
        } catch {
          // Unparseable zone geometry: skip, never guess.
        }
      }
      inside.set(key, hit);
    }
    if (inside.get(key)) matches.push(cand);
  }

  if (matches.length === 0) {
    if (inBavaria(point)) {
      return ok("not-available", null, `${BAVARIA_NOTE} ${BRW_NOT_OPEN["09"]}`);
    }
    const loaded = Object.keys(BRW_LANDS)
      .map((p) => LAND_NAMES[p] ?? p)
      .sort()
      .join(", ");
    return err(
      "no_data",
      `No Bodenrichtwert zone covers (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}). Open Bodenrichtwerte are loaded for: ${loaded}. Several Länder publish none openly (viewer or paid only).`,
    );
  }

  const land = matches[0].land ?? "05";
  return ok(
    coverageStatusForLand(land),
    {
      point,
      zones: matches.map((m) => ({
        zone_id: m.zone_id,
        brw_eur_m2: m.brw_eur_m2,
        stand: m.stand,
        nutzungsart: m.nutzungsart,
        entwicklungszustand: m.entwicklungszustand,
        municipality: m.municipality,
      })),
      source: BRW_SOURCES[land] ?? "Bodenrichtwerte (open data)",
    },
    COVERED_NOTE,
  );
}
