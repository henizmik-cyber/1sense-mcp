export const ANON_DAILY_LIMIT = 10;

/**
 * The map explorer's parcel API gets its own, higher budget: a human panning a
 * map clicks far more often than an agent calls tools, and the endpoint only
 * reads two small D1 rows plus one R2 zone file. Counted in the same
 * rate_limits table under a "map:"-prefixed key so it never eats into the MCP
 * budget. Tile range requests are not rate-limited at all (static reads).
 */
export const MAP_API_DAILY_LIMIT = 300;

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  /** ISO timestamp when the window resets (next UTC midnight). */
  resetAt: string;
}

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function nextUtcMidnight(now = new Date()): string {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return next.toISOString();
}

/**
 * Counts this call against the per-IP daily budget and reports whether it is
 * still inside the limit. Keyed on sha256(ip) so raw IPs are never stored.
 */
export async function checkAndCountRateLimit(
  env: Env,
  ipHash: string,
  now = new Date(),
  opts: { keyPrefix?: string; limit?: number } = {},
): Promise<RateLimitResult> {
  const limit = opts.limit ?? ANON_DAILY_LIMIT;
  const day = utcDay(now);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (ip_hash, day, count) VALUES (?1, ?2, 1)
     ON CONFLICT (ip_hash, day) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind((opts.keyPrefix ?? "") + ipHash, day)
    .first<{ count: number }>();

  const count = row?.count ?? 1;
  return {
    allowed: count <= limit,
    count,
    limit,
    resetAt: nextUtcMidnight(now),
  };
}
