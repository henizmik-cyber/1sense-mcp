import type { ToolDef } from "../tools/registry.js";
import { type ToolContext, err } from "./types.js";
import { hashArgs, sha256Hex } from "./hash.js";
import { checkAndCountRateLimit } from "./ratelimit.js";
import { logCall } from "./log.js";

export interface ToolResultPayload {
  body: unknown;
  isError: boolean;
}

function isLocked(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { status?: string }).status === "locked"
  );
}

function isErrorBody(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { ok?: boolean }).ok === false
  );
}

/**
 * Runs one tool call through the shared pipeline:
 * rate limit (unless exempt) → handler → structured error fallback → call log.
 * Handlers never leak stack traces: any thrown error becomes a typed envelope.
 */
export async function dispatchTool(
  ctx: ToolContext,
  def: ToolDef,
  args: unknown,
): Promise<ToolResultPayload> {
  const argsHash = await hashArgs(args);

  if (!def.rateLimitExempt) {
    const ipHash = await sha256Hex(ctx.ip);
    const rl = await checkAndCountRateLimit(ctx.env, ipHash);
    if (!rl.allowed) {
      const body = err(
        "rate_limited",
        `Anonymous limit reached (${rl.limit} tool calls per day per IP). The window resets at ${rl.resetAt}. For higher limits, call request_access with your email and use case.`,
        { limit: rl.limit, reset_at: rl.resetAt },
      );
      await logCall(ctx.env, {
        tool: def.name,
        argsHash,
        country: ctx.country,
        lockedHit: false,
      });
      return { body, isError: true };
    }
  }

  let body: unknown;
  try {
    body = await def.handler(ctx, args as never);
  } catch (e) {
    console.error(
      JSON.stringify({ event: "tool_error", tool: def.name, message: String(e) }),
    );
    body = err(
      "internal_error",
      `Unexpected error while executing ${def.name}. Nothing was returned; try again or adjust the arguments.`,
    );
  }

  await logCall(ctx.env, {
    tool: def.name,
    argsHash,
    country: ctx.country,
    lockedHit: isLocked(body),
  });

  return { body, isError: isErrorBody(body) };
}

/** Serializes a payload into an MCP tool result. */
export function toMcpResult(payload: ToolResultPayload): {
  content: { type: "text"; text: string }[];
  isError?: boolean;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(payload.body, null, 2) }],
    ...(payload.isError ? { isError: true } : {}),
  };
}
