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

export const COVERED_NOTE =
  "v1 coverage: all of Nordrhein-Westfalen (NRW) — every Kreis and kreisfreie Stadt. Data: ALKIS (parcels) + BORIS-NRW (Bodenrichtwerte), both dl-de/zero-2.0.";

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
  if (prefix === "05") return "NRW";
  if (prefix === "09") return "not-available";
  return "not-covered";
}

export function coverageNoteForLandPrefix(prefix: string): string {
  if (prefix === "05") return COVERED_NOTE;
  if (prefix === "09") return BAVARIA_NOTE;
  const name = LAND_NAMES[prefix] ?? `Bundesland prefix ${prefix}`;
  return `${name} is not covered in v1. ${COVERED_NOTE}`;
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
