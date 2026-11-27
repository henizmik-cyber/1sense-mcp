import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { dispatchTool } from "../src/lib/dispatch.js";
import { UNLOCK_URL } from "../src/lib/types.js";
import {
  COMPANY_NAME,
  PARCEL_A,
  PARCEL_C,
  PERSON_NAME,
  collectKeys,
  makeCtx,
  seedAll,
  toolDef,
} from "./fixtures.js";

/** Keys that would carry personal data — must never occur in gated responses. */
const FORBIDDEN_KEYS = [
  "name",
  "first_name",
  "last_name",
  "owner_name",
  "person",
  "persons",
  "officers",
  "officers_legal_entities",
  "birthdate",
  "address",
];

describe("gated tools return the locked shape and never personal data", () => {
  beforeEach(async () => {
    await seedAll(env);
  });

  it("get_owner_chain returns locked preview with structure, no names", async () => {
    const payload = await dispatchTool(makeCtx(env), toolDef("get_owner_chain"), {
      parcel_id: PARCEL_A,
    });
    const body = payload.body as Record<string, unknown>;

    expect(body.status).toBe("locked");
    expect(body.unlock).toBe(UNLOCK_URL);
    expect(body.preview).toContain("Objektgesellschaft");
    expect(body.preview).toContain("1 intermediate holding");

    const text = JSON.stringify(body);
    expect(text).not.toContain(PERSON_NAME);
    expect(text).not.toContain("Mustermann");
    for (const key of collectKeys(body)) {
      expect(FORBIDDEN_KEYS).not.toContain(key);
    }
  });

  it("get_owner_chain without compiled data is still locked and honest", async () => {
    const payload = await dispatchTool(makeCtx(env), toolDef("get_owner_chain"), {
      parcel_id: PARCEL_C,
    });
    const body = payload.body as Record<string, unknown>;
    expect(body.status).toBe("locked");
    expect(String(body.preview)).toMatch(/No owner chain/i);
    expect(body.unlock).toBe(UNLOCK_URL);
  });

  it("company_properties returns count + cities only", async () => {
    const payload = await dispatchTool(
      makeCtx(env),
      toolDef("company_properties"),
      { name: "Objekt Rheinpark" },
    );
    const body = payload.body as {
      status: string;
      unlock: string;
      preview: { company: string; property_count: number; cities: string[] };
    };

    expect(body.status).toBe("locked");
    expect(body.unlock).toBe(UNLOCK_URL);
    expect(body.preview.company).toBe(COMPANY_NAME);
    expect(body.preview.property_count).toBe(3);
    expect(body.preview.cities).toEqual(["Köln", "Leverkusen"]);

    const text = JSON.stringify(body);
    expect(text).not.toContain(PERSON_NAME);
    for (const key of collectKeys(body)) {
      expect(FORBIDDEN_KEYS).not.toContain(key);
    }
  });

  it("locked hits are logged with locked_hit = 1", async () => {
    await dispatchTool(makeCtx(env), toolDef("get_owner_chain"), {
      parcel_id: PARCEL_A,
    });
    const row = await env.DB.prepare(
      "SELECT tool, locked_hit, country FROM request_log ORDER BY id DESC LIMIT 1",
    ).first<{ tool: string; locked_hit: number; country: string }>();
    expect(row?.tool).toBe("get_owner_chain");
    expect(row?.locked_hit).toBe(1);
    expect(row?.country).toBe("DE");
  });

  it("gated tools never leak the seeded person even across many parcels", async () => {
    for (const parcelId of [PARCEL_A, PARCEL_C]) {
      const payload = await dispatchTool(
        makeCtx(env, "203.0.113.50"),
        toolDef("get_owner_chain"),
        { parcel_id: parcelId },
      );
      expect(JSON.stringify(payload.body)).not.toContain("Mustermann");
    }
  });
});
