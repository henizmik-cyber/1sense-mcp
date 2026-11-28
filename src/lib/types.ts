/** Shared context handed to every tool handler. */
export interface ToolContext {
  env: Env;
  /** Client IP as seen by Cloudflare ("unknown" if absent, e.g. local dev). */
  ip: string;
  /** ISO country code from request.cf ("unknown" if absent). */
  country: string;
}

export const UNLOCK_URL = "https://1sensedata.com/access";

/**
 * Coverage semantics:
 * - A covered request returns the Bundesland as the status — "NRW" for
 *   Nordrhein-Westfalen (kept for compatibility), the full Land name for
 *   every Land ingested later (data may still be partial — coverage_note
 *   says what is ingested).
 * - "not-available": Bavaria. No open parcel data exists for Bavaria.
 * - "not-covered": a Bundesland not ingested yet.
 */
export type CoverageStatus = "not-available" | "not-covered" | (string & {});

export interface ToolSuccess<T> {
  ok: true;
  coverage: CoverageStatus;
  coverage_note?: string;
  data: T;
}

export interface ToolError {
  ok: false;
  error: {
    code:
      | "invalid_arguments"
      | "no_data"
      | "rate_limited"
      | "internal_error";
    message: string;
    details?: Record<string, unknown>;
  };
}

export type Envelope<T> = ToolSuccess<T> | ToolError;

/** Exact locked shape from HANDOFF-MCP.md §2. Never carries personal data. */
export interface LockedResponse {
  status: "locked";
  preview: string | Record<string, unknown>;
  unlock: typeof UNLOCK_URL;
}

export function ok<T>(
  coverage: CoverageStatus,
  data: T,
  coverage_note?: string,
): ToolSuccess<T> {
  return coverage_note
    ? { ok: true, coverage, coverage_note, data }
    : { ok: true, coverage, data };
}

export function err(
  code: ToolError["error"]["code"],
  message: string,
  details?: Record<string, unknown>,
): ToolError {
  return details
    ? { ok: false, error: { code, message, details } }
    : { ok: false, error: { code, message } };
}

export function locked(preview: LockedResponse["preview"]): LockedResponse {
  return { status: "locked", preview, unlock: UNLOCK_URL };
}
