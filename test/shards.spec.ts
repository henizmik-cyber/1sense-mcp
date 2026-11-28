import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { INGESTED_LANDS } from "../src/lib/coverage.js";
import { dbForLand } from "../src/lib/shards.js";
import { getParcel, searchParcels } from "../src/tools/parcels.js";
import { getBodenrichtwert } from "../src/tools/bodenrichtwert.js";
import { handleParcelApi } from "../src/map-api.js";
import { makeCtx } from "./fixtures.js";

/** A Hessen parcel (land 06) living in the DB_WEST shard. */
const HESSEN_PARCEL = "06123401200042";

describe("parcel shard routing", () => {
  beforeAll(async () => {
    // Simulate the Hessen load: data in the shard plus the coverage flip the
    // load procedure performs.
    INGESTED_LANDS.add("06");
    await env.DB_WEST.prepare(
      `INSERT OR IGNORE INTO parcels (id, land, gemarkung_nr, gemarkung_name, flur, zaehler, nenner,
        municipality, kreis, area_m2, centroid_lat, centroid_lng, minx, miny, maxx, maxy, geometry_key)
       VALUES ('${HESSEN_PARCEL}', '06', '1234', 'Mitte', '012', '00042', NULL,
        'Wiesbaden', 'Wiesbaden', 3100, 50.0825, 8.24, 8.2395, 50.082, 8.2405, 50.083, NULL)`,
    ).run();
  });

  it("routes land prefixes to the right shard", () => {
    expect(dbForLand(env, "05")).toBe(env.DB);
    expect(dbForLand(env, "01")).toBe(env.DB_NORTH);
    expect(dbForLand(env, "06")).toBe(env.DB_WEST);
    expect(dbForLand(env, "08")).toBe(env.DB_BW);
    expect(dbForLand(env, "16")).toBe(env.DB_EAST);
    expect(dbForLand(env, "09")).toBeNull(); // Bavaria: nowhere
  });

  it("getParcel reads a non-NRW parcel from its shard", async () => {
    const res = await getParcel(makeCtx(env), { parcel_id: HESSEN_PARCEL });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.coverage).toBe("Hessen");
      expect((res.data as { municipality: string }).municipality).toBe("Wiesbaden");
    }
  });

  it("searchParcels fans out across shards", async () => {
    const res = await searchParcels(makeCtx(env), { city: "Wiesbaden" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { count: number; parcels: { id: string }[] };
      expect(data.parcels.map((p) => p.id)).toContain(HESSEN_PARCEL);
    }
  });

  it("the map parcel API reads from the shard", async () => {
    const req = new Request(
      `https://1sensedata.com/map/api/parcel?id=${HESSEN_PARCEL}`,
      { headers: { "cf-connecting-ip": "198.51.100.99" } },
    );
    const res = await handleParcelApi(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { parcel: { municipality: string } };
    expect(body.parcel.municipality).toBe("Wiesbaden");
  });

  it("a covered parcel in a Land without open BRW gets an explanation, not an error", async () => {
    INGESTED_LANDS.add("10");
    await env.DB_WEST.prepare(
      `INSERT OR IGNORE INTO parcels (id, land, gemarkung_nr, gemarkung_name, flur, zaehler, nenner,
        municipality, kreis, area_m2, centroid_lat, centroid_lng, minx, miny, maxx, maxy, geometry_key)
       VALUES ('10815000100191', '10', '8150', NULL, '001', '00191', NULL,
        'Freisen', 'Landkreis St. Wendel', 757, 49.58, 7.265, 7.2649, 49.5806, 7.2658, 49.5809, NULL)`,
    ).run();
    const res = await getBodenrichtwert(makeCtx(env), { parcel_id: "10815000100191" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.coverage).toBe("Saarland");
      expect(res.data).toBeNull();
      expect(res.coverage_note).toMatch(/Saarland/);
      expect(res.coverage_note).toMatch(/not be reused|viewed/);
    }
  });

  it("a point with no zone lists where open BRW exist", async () => {
    // Mid-Hessen point, no zones seeded there.
    const res = await getBodenrichtwert(makeCtx(env), { lat: 50.55, lng: 9.0 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("no_data");
      expect(res.error.message).toMatch(/loaded for: .*Nordrhein-Westfalen/);
    }
  });

  it("classifies Bavaria by outline, not by bounding box", async () => {
    const munich = await getBodenrichtwert(makeCtx(env), { lat: 48.14, lng: 11.58 });
    expect(munich.ok && munich.coverage).toBe("not-available");
    // Ulm (BW) faces Neu-Ulm (BY) across the Danube; Fulda (HE) sits inside
    // the old Bavaria bounding box. Neither may be called Bavaria.
    for (const [lat, lng] of [[48.4, 9.99], [50.55, 9.68]]) {
      const res = await getBodenrichtwert(makeCtx(env), { lat, lng });
      expect(res.ok ? res.coverage : "error").not.toBe("not-available");
    }
  });

  it("Bavaria stays not-available", async () => {
    const res = await getParcel(makeCtx(env), { parcel_id: "09123401200042" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.coverage).toBe("not-available");
      expect(res.data).toBeNull();
    }
  });
});
