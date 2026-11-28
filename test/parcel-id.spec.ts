import { describe, expect, it } from "vitest";
import { parseParcelId } from "../src/lib/parcel-id.js";

// Same cases as scripts/ingest/common.py normalize_kennzeichen — the two must
// agree, or ids typed by users miss the rows the ingest wrote.
const CASES: [string, string][] = [
  ["020607___08752______", "02060700008752"], // Hamburg: no Flur, padded
  ["075355000047500004__", "07535500004750/0004"], // Rheinland-Pfalz (INSPIRE)
  ["108150001001910001__", "10815000100191/0001"], // Saarland
  ["15152800700091______", "15152800700091"], // Sachsen-Anhalt
  ["11057017600389____", "11057017600389"], // Berlin (18 chars)
  ["160101147001380203__", "16010114700138/0203"], // Thüringen
  ["05 2601 007 00123", "05260100700123"], // NRW, spaced
  ["052601007001230000", "05260100700123"], // NRW, fixed width, no padding
  ["05 2601 007 00124/0005", "05260100700124/0005"],
  ["145840___00040000a01", "14584000000040/000a"], // Sachsen: parcel "40a"
  ["144271___00521003500", "14427100000521/0035"], // Sachsen: Flurstücksfolge ignored
  ["14584000000040/000a", "14584000000040/000a"], // canonical form round-trips
  ["14584000000040/000A", "14584000000040/000a"], // case-insensitive
];

describe("parseParcelId", () => {
  for (const [raw, expected] of CASES) {
    it(`normalizes ${raw}`, () => {
      expect(parseParcelId(raw)?.normalized).toBe(expected);
    });
  }

  it("reads Hamburg's padded Flur as 000, not as part of the Zähler", () => {
    const p = parseParcelId("020607___08752______");
    expect(p?.land).toBe("02");
    expect(p?.gemarkung).toBe("0607");
    expect(p?.flur).toBe("000");
    expect(p?.zaehler).toBe("08752");
    expect(p?.nenner).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parseParcelId("not-a-parcel")).toBeNull();
    expect(parseParcelId("12345")).toBeNull();
    expect(parseParcelId("ab0607___08752______")).toBeNull();
  });
});
