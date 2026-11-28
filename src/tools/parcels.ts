import {
  type Envelope,
  type ToolContext,
  err,
  ok,
} from "../lib/types.js";
import {
  BAVARIA_NOTE,
  COVERED_NOTE,
  coverageForCity,
  coverageForLandPrefix,
  coverageNoteForLandPrefix,
  coverageStatusForLand,
} from "../lib/coverage.js";
import { mapLink } from "../lib/geo.js";
import { parseParcelId } from "../lib/parcel-id.js";
import { allParcelDbs, dbForLand } from "../lib/shards.js";

interface ParcelRow {
  id: string;
  land: string;
  gemarkung_nr: string;
  gemarkung_name: string | null;
  flur: string;
  zaehler: string;
  nenner: string | null;
  municipality: string | null;
  kreis: string | null;
  area_m2: number | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
  minx: number | null;
  miny: number | null;
  maxx: number | null;
  maxy: number | null;
  geometry_key: string | null;
}

export interface ParcelSummary {
  id: string;
  size_m2: number | null;
  municipality: string | null;
  kreis: string | null;
  gemarkung: string | null;
  flur: string;
  centroid: { lat: number; lng: number } | null;
  map_link: string | null;
}

function toSummary(row: ParcelRow): ParcelSummary {
  const hasCentroid = row.centroid_lat !== null && row.centroid_lng !== null;
  return {
    id: row.id,
    size_m2: row.area_m2,
    municipality: row.municipality,
    kreis: row.kreis,
    gemarkung: row.gemarkung_name ?? row.gemarkung_nr,
    flur: row.flur,
    centroid: hasCentroid
      ? { lat: row.centroid_lat as number, lng: row.centroid_lng as number }
      : null,
    map_link: hasCentroid
      ? mapLink(row.centroid_lat as number, row.centroid_lng as number)
      : null,
  };
}

export interface SearchParcelsArgs {
  city?: string;
  bbox?: number[];
  min_m2?: number;
  max_m2?: number;
  zoning?: string;
  limit?: number;
}

export async function searchParcels(
  ctx: ToolContext,
  args: SearchParcelsArgs,
): Promise<Envelope<unknown>> {
  if (!args.city && !args.bbox) {
    return err(
      "invalid_arguments",
      "Provide either `city` (e.g. \"Köln\") or `bbox` [minLng, minLat, maxLng, maxLat].",
    );
  }
  if (args.bbox && args.bbox.length !== 4) {
    return err(
      "invalid_arguments",
      "`bbox` must be [minLng, minLat, maxLng, maxLat] in WGS84.",
    );
  }

  if (args.city) {
    const verdict = coverageForCity(args.city);
    if (verdict) {
      return ok(verdict.coverage, { count: 0, parcels: [] }, verdict.note);
    }
  }

  const conditions: string[] = [];
  const binds: (string | number)[] = [];
  if (args.city) {
    conditions.push(
      "(municipality = ?" + " COLLATE NOCASE OR gemarkung_name = ? COLLATE NOCASE)",
    );
    binds.push(args.city.trim(), args.city.trim());
  }
  if (args.bbox) {
    const [minLng, minLat, maxLng, maxLat] = args.bbox;
    conditions.push(
      "centroid_lng >= ? AND centroid_lng <= ? AND centroid_lat >= ? AND centroid_lat <= ?",
    );
    binds.push(minLng, maxLng, minLat, maxLat);
  }
  if (args.min_m2 !== undefined) {
    conditions.push("area_m2 >= ?");
    binds.push(args.min_m2);
  }
  if (args.max_m2 !== undefined) {
    conditions.push("area_m2 <= ?");
    binds.push(args.max_m2);
  }
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  binds.push(limit);

  // Parcels are sharded by Länder group: fan the search out and merge.
  const sql = `SELECT * FROM parcels WHERE ${conditions.join(" AND ")}
     ORDER BY area_m2 DESC LIMIT ?`;
  const perShard = await Promise.all(
    allParcelDbs(ctx.env).map((db) =>
      db
        .prepare(sql)
        .bind(...binds)
        .all<ParcelRow>()
        .then((r) => r.results)
        .catch(() => [] as ParcelRow[]),
    ),
  );
  const results = perShard
    .flat()
    .sort((a, b) => (b.area_m2 ?? 0) - (a.area_m2 ?? 0))
    .slice(0, limit);

  // One Land in the result set → its status; several (or none) → "DE".
  const lands = [...new Set(results.map((r) => r.land))];
  const searchCoverage =
    lands.length === 1 ? coverageStatusForLand(lands[0]) : "DE";

  const notes: string[] = [COVERED_NOTE];
  if (args.zoning) {
    notes.push(
      "`zoning` filter was ignored: zoning (XPlanung/B-Plan) data is not part of v1 — no result was filtered by it.",
    );
  }
  if (results.length === 0 && args.city) {
    notes.push(
      `No parcels found for "${args.city}". Either the name does not match a Gemeinde/Gemarkung in the ingested data, or that area is not loaded yet.`,
    );
  }

  return ok(
    searchCoverage,
    { count: results.length, parcels: results.map(toSummary) },
    notes.join(" "),
  );
}

export interface GetParcelArgs {
  parcel_id: string;
}

export async function getParcel(
  ctx: ToolContext,
  args: GetParcelArgs,
): Promise<Envelope<unknown>> {
  const parsed = parseParcelId(args.parcel_id);
  if (!parsed) {
    return err(
      "invalid_arguments",
      `Could not parse "${args.parcel_id}" as a Flurstückskennzeichen (expected e.g. "05 2601 007 00123" or "052601007001230000").`,
    );
  }

  const coverage = coverageForLandPrefix(parsed.land);
  const db = dbForLand(ctx.env, parsed.land);
  if (coverage === "not-available" || coverage === "not-covered" || !db) {
    return ok(coverage, null, coverageNoteForLandPrefix(parsed.land));
  }

  const row = await db
    .prepare("SELECT * FROM parcels WHERE id = ?")
    .bind(parsed.normalized)
    .first<ParcelRow>();
  if (!row) {
    return err(
      "no_data",
      `No parcel with id ${parsed.normalized} in the ingested data. ${COVERED_NOTE}`,
    );
  }

  // Neighbors: approximate, via overlapping expanded bounding boxes.
  let neighbors: ParcelSummary[] = [];
  if (row.minx !== null) {
    const pad = 0.00015; // ~10-15 m
    const { results } = await db.prepare(
      `SELECT * FROM parcels
       WHERE id != ? AND minx <= ? AND maxx >= ? AND miny <= ? AND maxy >= ?
       LIMIT 12`,
    )
      .bind(
        row.id,
        (row.maxx as number) + pad,
        (row.minx as number) - pad,
        (row.maxy as number) + pad,
        (row.miny as number) - pad,
      )
      .all<ParcelRow>();
    neighbors = results.map(toSummary);
  }

  // Geometry: stored per Flur in R2; pick this parcel's feature out of the file.
  let geometry: unknown = null;
  let geometryNote: string | undefined;
  if (row.geometry_key) {
    const obj = await ctx.env.GEO.get(row.geometry_key);
    if (obj) {
      try {
        const fc = (await obj.json()) as {
          features?: { properties?: { id?: string }; geometry?: unknown }[];
        };
        geometry =
          fc.features?.find((f) => f.properties?.id === row.id)?.geometry ?? null;
      } catch {
        geometryNote = "Stored geometry file could not be parsed.";
      }
    }
  }
  if (geometry === null && !geometryNote) {
    geometryNote = "No geometry ingested for this parcel yet.";
  }

  return ok(
    coverage,
    {
      ...toSummary(row),
      gemarkung_nr: row.gemarkung_nr,
      zaehler: row.zaehler,
      nenner: row.nenner,
      bbox:
        row.minx !== null
          ? [row.minx, row.miny, row.maxx, row.maxy]
          : null,
      geometry,
      geometry_note: geometryNote,
      neighbors,
      neighbors_note:
        "Neighbors are approximate (bounding-box adjacency), not exact topological neighbors.",
    },
    COVERED_NOTE,
  );
}

const DEFAULT_GRZ = 0.4;
const FLOORS_LOW = 2;
const FLOORS_HIGH = 3;

export async function estimateBuildable(
  ctx: ToolContext,
  args: GetParcelArgs,
): Promise<Envelope<unknown>> {
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

  const row = await db.prepare(
    "SELECT id, area_m2, municipality FROM parcels WHERE id = ?",
  )
    .bind(parsed.normalized)
    .first<{ id: string; area_m2: number | null; municipality: string | null }>();
  if (!row || row.area_m2 === null) {
    return err(
      "no_data",
      `No parcel (or no area) for id ${parsed.normalized} in the ingested data.`,
    );
  }

  const footprint = row.area_m2 * DEFAULT_GRZ;
  return ok(
    coverage,
    {
      parcel_id: row.id,
      municipality: row.municipality,
      area_m2: row.area_m2,
      estimate: {
        gfa_m2_low: Math.round(footprint * FLOORS_LOW),
        gfa_m2_high: Math.round(footprint * FLOORS_HIGH),
      },
      assumptions: {
        grz: DEFAULT_GRZ,
        floors: [FLOORS_LOW, FLOORS_HIGH],
        basis:
          "Default GRZ and floor counts only — no B-Plan/XPlanung zoning and no LoD2 building heights are ingested in v1.",
      },
      disclaimer:
        "ESTIMATE ONLY. This is a rough gross-floor-area estimate from default density values. It is not a statement about actual building rights; §34 BauGB / B-Plan rules decide those.",
    },
    COVERED_NOTE,
  );
}
