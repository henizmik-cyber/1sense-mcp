export const ANON_DAILY_LIMIT = 10;

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
): Promise<RateLimitResult> {
  const day = utcDay(now);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (ip_hash, day, count) VALUES (?1, ?2, 1)
     ON CONFLICT (ip_hash, day) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(ipHash, day)
    .first<{ count: number }>();

  const count = row?.count ?? 1;
  return {
    allowed: count <= ANON_DAILY_LIMIT,
    count,
    limit: ANON_DAILY_LIMIT,
    resetAt: nextUtcMidnight(now),
  };
}
