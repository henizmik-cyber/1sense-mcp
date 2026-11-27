import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { handleParcelApi, handleTileRequest } from "../src/map-api.js";
import { mapPage } from "../src/map-page.js";
import { dispatchTool } from "../src/lib/dispatch.js";
import { ANON_DAILY_LIMIT } from "../src/lib/ratelimit.js";
import { PARCEL_A, PERSON_NAME, makeCtx, seedBrw, seedParcels, toolDef } from "./fixtures.js";

function tileRequest(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://1sensedata.com${path}`, { headers });
}

describe("PMTiles range proxy (/map/tiles/*)", () => {
  const BYTES = new Uint8Array(100).map((_, i) => i);

  beforeEach(async () => {
    await env.GEO.put("tiles/parcels.pmtiles", BYTES);
  });

  it("serves an absolute byte range as 206 with content-range", async () => {
    const res = await handleTileRequest(
      tileRequest("/map/tiles/parcels.pmtiles", { range: "bytes=10-19" }),
      env,
      "parcels.pmtiles",
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 10-19/100");
    expect(res.headers.get("content-length")).toBe("10");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it("clamps a range that reaches past the end of the object", async () => {
    const res = await handleTileRequest(
      tileRequest("/map/tiles/parcels.pmtiles", { range: "bytes=90-199" }),
      env,
      "parcels.pmtiles",
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 90-99/100");
    expect((await res.arrayBuffer()).byteLength).toBe(10);
  });

  it("serves the whole file without a Range header", async () => {
    const res = await handleTileRequest(
      tileRequest("/map/tiles/parcels.pmtiles"),
      env,
      "parcels.pmtiles",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it("rejects unknown tileset names", async () => {
    const res = await handleTileRequest(
      tileRequest("/map/tiles/secret.pmtiles"),
      env,
      "secret.pmtiles",
    );
    expect(res.status).toBe(404);
  });

  it("rejects a range starting past the end", async () => {
    const res = await handleTileRequest(
      tileRequest("/map/tiles/parcels.pmtiles", { range: "bytes=500-600" }),
      env,
      "parcels.pmtiles",
    );
    expect(res.status).toBe(416);
  });
});

describe("parcel API (/map/api/parcel)", () => {
  beforeEach(async () => {
    await seedParcels(env);
    await seedBrw(env);
  });

  function apiRequest(id: string, ip = "198.51.100.77"): Request {
    return new Request(
      `https://1sensedata.com/map/api/parcel?id=${encodeURIComponent(id)}`,
      { headers: { "cf-connecting-ip": ip } },
    );
  }

  it("returns parcel facts with the matching BRW zone", async () => {
    const res = await handleParcelApi(apiRequest(PARCEL_A), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      parcel: { id: string; area_m2: number; municipality: string };
      brw_zones: { zone_id: string; brw_eur_m2: number }[];
    };
    expect(body.ok).toBe(true);
    expect(body.parcel.id).toBe(PARCEL_A);
    expect(body.parcel.area_m2).toBe(5200);
    expect(body.parcel.municipality).toBe("Köln");
    // BRW-K-001 covers the centroid; BRW-K-002's polygon does not.
    expect(body.brw_zones.map((z) => z.zone_id)).toEqual(["BRW-K-001"]);
    expect(body.brw_zones[0].brw_eur_m2).toBe(950);
  });

  it("rejects an invalid id and an unknown parcel", async () => {
    const bad = await handleParcelApi(apiRequest("not-a-parcel"), env);
    expect(bad.status).toBe(400);
    const missing = await handleParcelApi(apiRequest("05999900900999"), env);
    expect(missing.status).toBe(404);
  });

  it("has its own budget — an exhausted MCP limit does not block the map", async () => {
    const ip = "198.51.100.88";
    const ctx = makeCtx(env, ip);
    const search = toolDef("search_parcels");
    for (let i = 0; i < ANON_DAILY_LIMIT + 1; i++) {
      await dispatchTool(ctx, search, { city: "Köln" });
    }
    const blocked = await dispatchTool(ctx, search, { city: "Köln" });
    expect(blocked.isError).toBe(true);

    const res = await handleParcelApi(apiRequest(PARCEL_A, ip), env);
    expect(res.status).toBe(200);
  });
});

describe("map page", () => {
  it("renders the explorer shell with the locked owner funnel", () => {
    const html = mapPage();
    expect(html).toContain("Karte");
    expect(html).toContain("Satellit");
    expect(html).toContain("https://1sensedata.com/access");
    expect(html).toContain("Bodenrichtwert");
    expect(html).toContain("pmtiles");
    // The template literal must not leak unescaped interpolations or regex
    // escapes: a stray "${" would render literally in the served page.
    expect(html).not.toContain("${");
  });

  it("never contains personal names", () => {
    expect(mapPage()).not.toContain(PERSON_NAME);
  });
});
