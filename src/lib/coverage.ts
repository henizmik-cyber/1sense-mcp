import type { CoverageStatus } from "./types.js";

/** AGS Bundesland prefixes (first two digits of ALKIS Flurstückskennzeichen). */
export const LAND_NAMES: Record<string, string> = {
  "01": "Schleswig-Holstein",
  "02": "Hamburg",
  "03": "Niedersachsen",
  "04": "Bremen",
  "05": "Nordrhein-Westfalen",
  "06": "Hessen",
  "07": "Rheinland-Pfalz",
  "08": "Baden-Württemberg",
  "09": "Bayern",
  "10": "Saarland",
  "11": "Berlin",
  "12": "Brandenburg",
  "13": "Mecklenburg-Vorpommern",
  "14": "Sachsen",
  "15": "Sachsen-Anhalt",
  "16": "Thüringen",
};

/** Länder whose parcels are ingested (prefix). Extend as Länder are loaded;
 * shard routing in shards.ts works for every non-Bavarian prefix already. */
export const INGESTED_LANDS = new Set<string>(["05"]);

/** Covered status value for a Land: "NRW" is kept for compatibility. */
export function coverageStatusForLand(prefix: string): string {
  return prefix === "05" ? "NRW" : (LAND_NAMES[prefix] ?? prefix);
}

export const COVERED_NOTE = `Parcel coverage: ${[...INGESTED_LANDS]
  .map((p) => LAND_NAMES[p] ?? p)
  .sort()
  .join(
    ", ",
  )}. Bodenrichtwerte: NRW only so far. Bavaria publishes no open parcel data (not-available); further Länder are being ingested.`;

export const BAVARIA_NOTE =
  "Bavaria publishes no open parcel data — coverage is not-available there (not a temporary gap in this service).";

/** Well-known Bavarian municipalities, for city-based requests. */
const BAVARIAN_CITIES = new Set(
  [
    "münchen",
    "muenchen",
    "munich",
    "nürnberg",
    "nuernberg",
    "nuremberg",
    "augsburg",
    "regensburg",
    "würzburg",
    "wuerzburg",
    "ingolstadt",
    "fürth",
    "fuerth",
    "erlangen",
    "bamberg",
    "bayreuth",
    "landshut",
    "passau",
    "rosenheim",
  ].map((c) => c.toLowerCase()),
);

export function coverageForLandPrefix(prefix: string): CoverageStatus {
  if (INGESTED_LANDS.has(prefix)) return coverageStatusForLand(prefix);
  if (prefix === "09") return "not-available";
  return "not-covered";
}

/** True when the prefix has ingested parcel data behind it. */
export function isIngestedLand(prefix: string): boolean {
  return INGESTED_LANDS.has(prefix);
}

export function coverageNoteForLandPrefix(prefix: string): string {
  if (INGESTED_LANDS.has(prefix)) return COVERED_NOTE;
  if (prefix === "09") return BAVARIA_NOTE;
  const name = LAND_NAMES[prefix] ?? `Bundesland prefix ${prefix}`;
  return `${name} is not covered yet. ${COVERED_NOTE}`;
}

/** Returns a coverage verdict for a city name, or null if the city is not a known non-NRW case. */
export function coverageForCity(
  city: string,
): { coverage: CoverageStatus; note: string } | null {
  if (BAVARIAN_CITIES.has(city.trim().toLowerCase())) {
    return { coverage: "not-available", note: BAVARIA_NOTE };
  }
  return null;
}
