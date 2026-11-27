import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { dispatchTool } from "../src/lib/dispatch.js";
import type { ToolError, ToolSuccess } from "../src/lib/types.js";
import {
  COMPANY_NAME,
  PARCEL_A,
  PARCEL_B,
  PERSON_NAME,
  makeCtx,
  seedAll,
  seedBrw,
  seedCompanies,
  seedParcels,
  toolDef,
} from "./fixtures.js";

let ipCounter = 10;
function freshCtx() {
  return makeCtx(env, `203.0.113.${ipCounter++}`);
}

describe("search_parcels", () => {
  it("finds Köln parcels sorted by size with map links", async () => {
    await seedParcels(env);
    const payload = await dispatchTool(freshCtx(), toolDef("search_parcels"), {
      city: "Köln",
    });
    const body = payload.body as ToolSuccess<{
      count: number;
      parcels: { id: string; size_m2: number; map_link: string }[];
    }>;
    expect(body.ok).toBe(true);
    expect(body.coverage).toBe("NRW");
    expect(body.data.count).toBe(2);
    expect(body.data.parcels[0].id).toBe(PARCEL_A); // larger first
    expect(body.data.parcels[0].map_link).toContain("openstreetmap.org");
  });

  it("applies min_m2 filter", async () => {
    await seedParcels(env);
    const payload = await dispatchTool(freshCtx(), toolDef("search_parcels"), {
      city: "Köln",
      min_m2: 2000,
    });
    const body = payload.body as ToolSuccess<{ count: number }>;
    expect(body.data.count).toBe(1);
  });

  it("returns coverage not-available for Bavarian cities", async () => {
    const payload = await dispatchTool(freshCtx(), toolDef("search_parcels"), {
      city: "München",
    });
    const body = payload.body as ToolSuccess<{ count: number }>;
    expect(body.ok).toBe(true);
    expect(body.coverage).toBe("not-available");
    expect(body.data.count).toBe(0);
    expect(body.coverage_note).toMatch(/Bavaria/);
  });

  it("requires city or bbox", async () => {
    const payload = await dispatchTool(freshCtx(), toolDef("search_parcels"), {});
    expect(payload.isError).toBe(true);
    expect((payload.body as ToolError).error.code).toBe("invalid_arguments");
  });

  it("states that zoning filters are not applied in v1", async () => {
    await seedParcels(env);
    const payload = await dispatchTool(freshCtx(), toolDef("search_parcels"), {
      city: "Köln",
      zoning: "GE",
    });
    const body = payload.body as ToolSuccess<unknown>;
    expect(body.coverage_note).toMatch(/zoning.*ignored/i);
  });
});

describe("get_parcel", () => {
  it("returns geometry, neighbors and map link", async () => {
    await seedParcels(env);
    const payload = await dispatchTool(freshCtx(), toolDef("get_parcel"), {
      parcel_id: "05 2601 007 00123",
    });
    const body = payload.body as ToolSuccess<{
      id: string;
      geometry: { type: string } | null;
      neighbors: { id: string }[];
      map_link: string;
    }>;
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(PARCEL_A);
    expect(body.data.geometry?.type).toBe("Polygon");
    expect(body.data.neighbors.map((n) => n.id)).toContain(PARCEL_B);
  });

  it("returns coverage not-available for Bavarian ids (prefix 09)", async () => {
    const payload = await dispatchTool(freshCtx(), toolDef("get_parcel"), {
      parcel_id: "091234005001230000",
    });
    const body = payload.body as ToolSuccess<null>;
    expect(body.ok).toBe(true);
    expect(body.coverage).toBe("not-available");
    expect(body.data).toBeNull();
  });

  it("returns a structured no_data error for unknown parcels", async () => {
    await seedParcels(env);
    const payload = await dispatchTool(freshCtx(), toolDef("get_parcel"), {
      parcel_id: "05 9999 001 00001",
    });
    expect(payload.isError).toBe(true);
    const body = payload.body as ToolError;
    expect(body.error.code).toBe("no_data");
    expect(JSON.stringify(body)).not.toMatch(/\n\s+at /); // no stack traces
  });
});

describe("get_bodenrichtwert", () => {
  it("resolves zones by parcel id with point-in-polygon filtering", async () => {
    await seedParcels(env);
    await seedBrw(env);
    const payload = await dispatchTool(freshCtx(), toolDef("get_bodenrichtwert"), {
      parcel_id: PARCEL_A,
    });
    const body = payload.body as ToolSuccess<{
      zones: { zone_id: string; brw_eur_m2: number; stand: string }[];
    }>;
    expect(body.ok).toBe(true);
    expect(body.data.zones).toHaveLength(1); // BRW-K-002 bbox matches, polygon does not
    expect(body.data.zones[0].zone_id).toBe("BRW-K-001");
    expect(body.data.zones[0].brw_eur_m2).toBe(950);
    expect(body.data.zones[0].stand).toBe("2025-01-01");
  });

  it("works with lat/lng directly", async () => {
    await seedBrw(env);
    const payload = await dispatchTool(freshCtx(), toolDef("get_bodenrichtwert"), {
      lat: 50.94,
      lng: 6.95,
    });
    const body = payload.body as ToolSuccess<{ zones: unknown[] }>;
    expect(body.ok).toBe(true);
    expect(body.data.zones).toHaveLength(1);
  });

  it("returns not-available for points in Bavaria", async () => {
    const payload = await dispatchTool(freshCtx(), toolDef("get_bodenrichtwert"), {
      lat: 48.137,
      lng: 11.575,
    });
    const body = payload.body as ToolSuccess<null>;
    expect(body.coverage).toBe("not-available");
    expect(body.data).toBeNull();
  });
});

describe("find_company", () => {
  it("returns company data with legal-entity officers only", async () => {
    await seedCompanies(env);
    const payload = await dispatchTool(freshCtx(), toolDef("find_company"), {
      query: "Objekt Rheinpark",
    });
    const body = payload.body as ToolSuccess<{
      companies: {
        name: string;
        spv_indicator: boolean;
        officers_legal_entities: { name: string }[];
        related_entities: { name: string }[];
      }[];
    }>;
    expect(body.ok).toBe(true);
    const main = body.data.companies.find((c) => c.name === COMPANY_NAME);
    expect(main).toBeDefined();
    expect(main?.spv_indicator).toBe(true);
    expect(main?.officers_legal_entities.map((o) => o.name)).toEqual([
      "Objekt Rheinpark Verwaltungs GmbH",
    ]);
    expect(JSON.stringify(body)).not.toContain(PERSON_NAME);
  });

  it("is honest when no company data is ingested", async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM officers"),
      env.DB.prepare("DELETE FROM companies"),
    ]);
    const payload = await dispatchTool(freshCtx(), toolDef("find_company"), {
      query: "Irgendeine GmbH",
    });
    const body = payload.body as ToolSuccess<{ count: number }>;
    expect(body.ok).toBe(true);
    expect(body.data.count).toBe(0);
    expect(body.coverage_note).toMatch(/No company data ingested yet/);
  });
});

describe("estimate_buildable", () => {
  it("returns a clearly labeled estimate from defaults", async () => {
    await seedParcels(env);
    const payload = await dispatchTool(freshCtx(), toolDef("estimate_buildable"), {
      parcel_id: PARCEL_A,
    });
    const body = payload.body as ToolSuccess<{
      estimate: { gfa_m2_low: number; gfa_m2_high: number };
      assumptions: { grz: number };
      disclaimer: string;
    }>;
    expect(body.ok).toBe(true);
    expect(body.data.estimate.gfa_m2_low).toBe(4160); // 5200 * 0.4 * 2
    expect(body.data.estimate.gfa_m2_high).toBe(6240); // 5200 * 0.4 * 3
    expect(body.data.disclaimer).toMatch(/ESTIMATE ONLY/);
  });
});

describe("request_access", () => {
  it("writes a lead and returns a confirmation", async () => {
    const payload = await dispatchTool(freshCtx(), toolDef("request_access"), {
      email: "dealteam@example.com",
      use_case: "Collateral checks for NRW logistics assets",
      source_tool: "get_owner_chain",
    });
    const body = payload.body as ToolSuccess<{ received: boolean }>;
    expect(body.ok).toBe(true);
    expect(body.data.received).toBe(true);

    const lead = await env.DB.prepare(
      "SELECT email, use_case, source_tool, created_at FROM leads ORDER BY id DESC LIMIT 1",
    ).first<{ email: string; use_case: string; source_tool: string; created_at: string }>();
    expect(lead?.email).toBe("dealteam@example.com");
    expect(lead?.use_case).toContain("Collateral checks");
    expect(lead?.source_tool).toBe("get_owner_chain");
    expect(lead?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects invalid emails with a structured error", async () => {
    const payload = await dispatchTool(freshCtx(), toolDef("request_access"), {
      email: "not-an-email",
      use_case: "Testing the funnel",
    });
    expect(payload.isError).toBe(true);
    expect((payload.body as ToolError).error.code).toBe("invalid_arguments");
  });
});

describe("full seed smoke", () => {
  it("all data tools answer against the full fixture set", async () => {
    await seedAll(env);
    const ctx = freshCtx();
    for (const [tool, args] of [
      ["search_parcels", { city: "Düsseldorf" }],
      ["get_parcel", { parcel_id: PARCEL_B }],
      ["get_bodenrichtwert", { lat: 50.941, lng: 6.9495 }],
      ["find_company", { query: "HRB 12345" }],
    ] as const) {
      const payload = await dispatchTool(ctx, toolDef(tool), args);
      expect(payload.isError, `${tool} failed: ${JSON.stringify(payload.body)}`).toBe(
        false,
      );
    }
  });
});
