import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { INGESTED_LANDS } from "../src/lib/coverage.js";
import { dbForLand } from "../src/lib/shards.js";
import { getParcel, searchParcels } from "../src/tools/parcels.js";
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

  it("Bavaria stays not-available", async () => {
    const res = await getParcel(makeCtx(env), { parcel_id: "09123401200042" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.coverage).toBe("not-available");
      expect(res.data).toBeNull();
    }
  });
});
