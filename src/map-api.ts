/** HTTP endpoints behind 1sensedata.com/map: the PMTiles range proxy and the
 * parcel-facts API the map panel calls. The page itself lives in map-page.ts.
 *
 * Rate limits (documented decision): tile requests are NOT rate-limited —
 * they are static range reads from R2 and a panning user issues hundreds of
 * them. The parcel API gets its own budget (MAP_API_DAILY_LIMIT, separate
 * "map:" key) so map clicks never consume the MCP tool budget and vice versa.
 */

import { parseParcelId } from "./lib/parcel-id.js";
import { dbForLand } from "./lib/shards.js";
import { getBodenrichtwert } from "./tools/bodenrichtwert.js";
import { sha256Hex } from "./lib/hash.js";
import { MAP_API_DAILY_LIMIT, checkAndCountRateLimit } from "./lib/ratelimit.js";
import type { ToolContext } from "./lib/types.js";

/** Tileset files served from the onesense-geo bucket under tiles/. */
const TILESETS = new Set(["parcels.pmtiles", "brw.pmtiles", "buildings.pmtiles"]);

const TILE_CACHE = "public, max-age=300";

/**
 * Edge cache for tile ranges. A cold R2 range read costs ~0.6-1.5 s and a
 * map load chains several (header -> directory -> tiles, per tileset), so
 * ranges are kept in the Cloudflare cache. Two constraints shape this:
 * the Cache API refuses 206 responses (ranges are stored as 200 and the 206
 * is rebuilt), and keys must include the object's etag so a re-uploaded
 * tileset never mixes old and new bytes.
 */
const EDGE_TTL_S = 86_400;
const META_TTL_MS = 60_000;
const MAX_CACHED_RANGE = 8 * 1024 * 1024;
const tileMeta = new Map<string, { etag: string; size: number; at: number }>();

/** Test hook: forget remembered tileset versions. */
export function _resetTileMetaCache(): void {
  tileMeta.clear();
}

async function currentMeta(env: Env, key: string, refresh = false) {
  const hit = tileMeta.get(key);
  if (hit && !refresh && Date.now() - hit.at < META_TTL_MS) return hit;
  const head = await env.GEO.head(key);
  if (!head) {
    tileMeta.delete(key);
    return null;
  }
  const meta = { etag: head.etag, size: head.size, at: Date.now() };
  tileMeta.set(key, meta);
  return meta;
}

function rangeResponse(
  body: BodyInit | null,
  offset: number,
  length: number,
  size: number,
  etag: string,
  cacheState: "hit" | "miss" | "bypass",
): Response {
  return new Response(body, {
    status: 206,
    headers: {
      "content-type": "application/octet-stream",
      "content-range": `bytes ${offset}-${offset + length - 1}/${size}`,
      "content-length": String(length),
      "accept-ranges": "bytes",
      "cache-control": TILE_CACHE,
      etag: `"${etag}"`,
      "x-tile-cache": cacheState,
    },
  });
}

export async function handleTileRequest(
  request: Request,
  env: Env,
  name: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  if (!TILESETS.has(name)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const key = `tiles/${name}`;

  const rangeHeader = request.headers.get("range");
  if (!rangeHeader) {
    const obj = await env.GEO.get(key);
    if (!obj) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(request.method === "HEAD" ? null : obj.body, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(obj.size),
        "accept-ranges": "bytes",
        "cache-control": TILE_CACHE,
        etag: obj.httpEtag,
      },
    });
  }

  // The pmtiles client always sends a single absolute range: bytes=start-end.
  const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) {
    return new Response("Unsupported Range", { status: 416 });
  }
  const offset = Number(m[1]);
  const end = m[2] === "" ? null : Number(m[2]);

  // Cached path: bounded ranges (all the pmtiles client sends) of sane size.
  if (request.method === "GET" && end !== null && end >= offset &&
      end - offset + 1 <= MAX_CACHED_RANGE) {
    const cached = await cachedRange(env, key, offset, end, ctx);
    if (cached) return cached;
  }

  let obj: R2ObjectBody | null = null;
  try {
    obj = await env.GEO.get(
      key,
      end === null
        ? { range: { offset } }
        : { range: { offset, length: end - offset + 1 } },
    );
  } catch {
    // R2 throws on a range that starts beyond the object.
    return new Response("Range not satisfiable", { status: 416 });
  }
  if (!obj) return Response.json({ error: "not_found" }, { status: 404 });

  const size = obj.size; // full object size
  const available = size - offset;
  const length =
    end === null ? available : Math.min(end - offset + 1, available);
  if (length <= 0) {
    return new Response("Range not satisfiable", { status: 416 });
  }

  return rangeResponse(request.method === "HEAD" ? null : obj.body, offset, length,
    size, obj.etag, "bypass");
}

/** Serves one range from the edge cache, filling it from R2 on a miss.
 * Returns null when the caller should fall back to a plain R2 read
 * (out-of-range request, object gone). */
async function cachedRange(
  env: Env,
  key: string,
  offset: number,
  end: number,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  const cache = (caches as unknown as { default: Cache }).default;
  for (let attempt = 0; attempt < 2; attempt++) {
    const meta = await currentMeta(env, key, attempt > 0);
    if (!meta || offset >= meta.size) return null;
    const length = Math.min(end, meta.size - 1) - offset + 1;
    const cacheKey = new Request(
      `https://tile-cache.1sensedata.internal/${encodeURIComponent(key)}/${meta.etag}/${offset}-${offset + length - 1}`,
    );

    const hit = await cache.match(cacheKey);
    if (hit) return rangeResponse(hit.body, offset, length, meta.size, meta.etag, "hit");

    // etagMatches guards against the object being replaced between head()
    // and get(): on a mismatch R2 returns metadata without a body.
    const obj = await env.GEO.get(key, {
      range: { offset, length },
      onlyIf: { etagMatches: meta.etag },
    });
    if (!obj) return null;
    if (!("body" in obj)) continue; // replaced meanwhile: refresh version, retry
    const bytes = await (obj as R2ObjectBody).arrayBuffer();
    const store = cache.put(cacheKey, new Response(bytes, {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": `public, max-age=${EDGE_TTL_S}`,
      },
    }));
    if (ctx) ctx.waitUntil(store);
    else await store;
    return rangeResponse(bytes, offset, length, meta.size, meta.etag, "miss");
  }
  return null;
}

interface PanelParcelRow {
  id: string;
  area_m2: number | null;
  municipality: string | null;
  kreis: string | null;
  gemarkung_name: string | null;
  gemarkung_nr: string;
  flur: string;
  zaehler: string;
  nenner: string | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
}

export async function handleParcelApi(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const ipHash = await sha256Hex(ip);
  const rl = await checkAndCountRateLimit(env, ipHash, new Date(), {
    keyPrefix: "map:",
    limit: MAP_API_DAILY_LIMIT,
  });
  if (!rl.allowed) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "rate_limited",
          message: `Daily map limit reached (${rl.limit} lookups). Resets at ${rl.resetAt}.`,
        },
      },
      { status: 429 },
    );
  }

  const parsed = parseParcelId(id);
  if (!parsed) {
    return Response.json(
      {
        ok: false,
        error: { code: "invalid_arguments", message: "Invalid parcel id." },
      },
      { status: 400 },
    );
  }

  const db = dbForLand(env, parsed.land);
  if (!db) {
    return Response.json(
      {
        ok: false,
        error: { code: "no_data", message: "No parcel data for this Land." },
      },
      { status: 404 },
    );
  }
  const row = await db.prepare(
    `SELECT id, area_m2, municipality, kreis, gemarkung_name, gemarkung_nr,
            flur, zaehler, nenner, centroid_lat, centroid_lng
     FROM parcels WHERE id = ?`,
  )
    .bind(parsed.normalized)
    .first<PanelParcelRow>();
  if (!row) {
    return Response.json(
      {
        ok: false,
        error: { code: "no_data", message: "Parcel not in the ingested data." },
      },
      { status: 404 },
    );
  }

  // Bodenrichtwert via the existing tool logic (bbox candidates from D1,
  // exact point-in-polygon against the zone geometry in R2).
  const ctx: ToolContext = { env, ip, country: "unknown" };
  let brwZones: unknown = null;
  // True when the parcel's Land publishes no open Bodenrichtwerte (or none
  // are loaded), so the panel can say so instead of silently omitting them.
  let brwUnavailable = false;
  try {
    const envlp = await getBodenrichtwert(ctx, { parcel_id: parsed.normalized });
    if (envlp.ok && envlp.data) {
      brwZones = (envlp.data as { zones?: unknown }).zones ?? null;
    } else if (envlp.ok && envlp.data === null) {
      brwUnavailable = true;
    }
  } catch {
    brwZones = null; // panel degrades to parcel facts only
  }

  return Response.json(
    {
      ok: true,
      parcel: {
        id: row.id,
        area_m2: row.area_m2,
        municipality: row.municipality,
        kreis: row.kreis,
        gemarkung: row.gemarkung_name ?? row.gemarkung_nr,
        flur: row.flur,
        zaehler: row.zaehler,
        nenner: row.nenner,
        centroid:
          row.centroid_lat !== null && row.centroid_lng !== null
            ? { lat: row.centroid_lat, lng: row.centroid_lng }
            : null,
      },
      brw_zones: brwZones,
      brw_unavailable: brwUnavailable,
    },
    { headers: { "cache-control": "public, max-age=86400" } },
  );
}
