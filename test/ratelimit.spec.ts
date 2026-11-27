import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { dispatchTool } from "../src/lib/dispatch.js";
import { ANON_DAILY_LIMIT } from "../src/lib/ratelimit.js";
import type { ToolError } from "../src/lib/types.js";
import { makeCtx, seedParcels, toolDef } from "./fixtures.js";

describe("anonymous rate limiting (10 calls/day/IP)", () => {
  beforeEach(async () => {
    await seedParcels(env);
  });

  it("allows the first 10 calls, blocks the 11th", async () => {
    const ctx = makeCtx(env, "198.51.100.1");
    const search = toolDef("search_parcels");

    for (let i = 0; i < ANON_DAILY_LIMIT; i++) {
      const payload = await dispatchTool(ctx, search, { city: "Köln" });
      expect(payload.isError).toBe(false);
    }

    const blocked = await dispatchTool(ctx, search, { city: "Köln" });
    expect(blocked.isError).toBe(true);
    const body = blocked.body as ToolError;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.message).toContain("request_access");
  });

  it("does not rate-limit request_access (the funnel stays open)", async () => {
    const ctx = makeCtx(env, "198.51.100.2");
    const search = toolDef("search_parcels");
    for (let i = 0; i < ANON_DAILY_LIMIT + 2; i++) {
      await dispatchTool(ctx, search, { city: "Köln" });
    }

    const payload = await dispatchTool(ctx, toolDef("request_access"), {
      email: "agent@example.com",
      use_case: "Site acquisition screening in Köln",
    });
    expect(payload.isError).toBe(false);
  });

  it("limits are per IP", async () => {
    const search = toolDef("search_parcels");
    const ctxA = makeCtx(env, "198.51.100.3");
    for (let i = 0; i < ANON_DAILY_LIMIT + 1; i++) {
      await dispatchTool(ctxA, search, { city: "Köln" });
    }
    const blocked = await dispatchTool(ctxA, search, { city: "Köln" });
    expect(blocked.isError).toBe(true);

    const ctxB = makeCtx(env, "198.51.100.4");
    const fresh = await dispatchTool(ctxB, search, { city: "Köln" });
    expect(fresh.isError).toBe(false);
  });
});
