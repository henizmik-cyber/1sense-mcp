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
export const INGESTED_LANDS = new Set<string>([
  "01", // Schleswig-Holstein
  "02", // Hamburg
  "03", // Niedersachsen
  "04", // Bremen
  "05", // Nordrhein-Westfalen
  "06", // Hessen
  "07", // Rheinland-Pfalz
  "10", // Saarland
  "11", // Berlin
  "12", // Brandenburg
  "13", // Mecklenburg-Vorpommern
  "14", // Sachsen
  "15", // Sachsen-Anhalt
  "16", // Thüringen
]);

/** Covered status value for a Land: "NRW" is kept for compatibility. */
export function coverageStatusForLand(prefix: string): string {
  return prefix === "05" ? "NRW" : (LAND_NAMES[prefix] ?? prefix);
}

/** Länder whose Bodenrichtwerte are loaded, with the Stichtag in use. */
export const BRW_LANDS: Record<string, string> = {
  "02": "2026-01-01", // Hamburg
  "03": "2026-01-01", // Niedersachsen
  "04": "2026-01-01", // Bremen (incl. Bremerhaven, served by LGLN)
  "05": "2026-01-01", // Nordrhein-Westfalen
  "06": "2024-01-01", // Hessen — newest Stichtag published as data (2026 is viewer-only)
  "11": "2026-01-01", // Berlin
  "12": "2026-01-01", // Brandenburg
  "13": "2026-01-01", // Mecklenburg-Vorpommern (OGC API, CC BY 4.0)
  "15": "2026-01-01", // Sachsen-Anhalt
  "16": "2026-01-01", // Thüringen
};

/**
 * Länder that publish no open Bodenrichtwert polygons (verified 2026-11-28):
 * viewer/raster only, paid extracts, or terms forbidding reuse. Kept explicit
 * so answers say "not published openly" instead of a bare "no data".
 */
export const BRW_NOT_OPEN: Record<string, string> = {
  "01": "Schleswig-Holstein publishes Bodenrichtwerte for viewing only (DANord viewer); there is no open dataset.",
  "07": "Rheinland-Pfalz publishes Bodenrichtwerte openly only as a map image; the data itself is a paid service.",
  "08": "Baden-Württemberg has no Land-wide open Bodenrichtwert dataset (BORIS-BW is a viewer; licensing is per Gutachterausschuss).",
  "09": "Bayern provides Bodenrichtwerte only as paid extracts.",
  "10": "Saarland's Bodenrichtwerte may be viewed but not reused (BORIS Saarland terms).",
  "14": "Sachsen publishes Bodenrichtwerte openly only as a map image; datasets are supplied on paid request.",
};

/** Source + license line returned with each Land's Bodenrichtwerte. */
export const BRW_SOURCES: Record<string, string> = {
  "02": "Bodenrichtwerte Hamburg, LGV (dl-de/by-2.0)",
  "03": "BORIS.NI, © GDI-NI (dl-de/by-2.0)",
  "04": "BORIS.NI (Bremen), © GDI-NI (dl-de/by-2.0)",
  "05": "BORIS-NRW (dl-de/zero-2.0)",
  "06": "BORIS-Hessen (dl-de/zero-2.0)",
  "11": "Bodenrichtwerte Berlin (dl-de/zero-2.0)",
  "12": "BORIS Brandenburg, © GeoBasis-DE/LGB (dl-de/by-2.0)",
  "13": "BORIS.MV, Gutachterausschüsse Mecklenburg-Vorpommern (CC BY 4.0)",
  "15": "Bodenrichtwerte Sachsen-Anhalt, LVermGeo (dl-de/by-2.0)",
  "16": "BORIS Thüringen, © GDI-Th (CC BY 4.0)",
};

/** Human note for a Land without loaded Bodenrichtwerte. */
export function brwNoteForLand(prefix: string): string {
  const name = LAND_NAMES[prefix] ?? `Bundesland prefix ${prefix}`;
  return (
    BRW_NOT_OPEN[prefix] ??
    `Bodenrichtwerte for ${name} are not loaded yet.`
  );
}

export const COVERED_NOTE = `Parcel coverage: ${[...INGESTED_LANDS]
  .map((p) => LAND_NAMES[p] ?? p)
  .sort()
  .join(", ")}. Bodenrichtwerte: ${Object.keys(BRW_LANDS)
  .map((p) => LAND_NAMES[p] ?? p)
  .sort()
  .join(", ")}. Bavaria publishes no open parcel data (not-available); further Länder are being ingested.`;

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
