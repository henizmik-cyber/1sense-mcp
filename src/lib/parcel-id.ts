export interface ParcelIdParts {
  land: string; // 2 digits
  gemarkung: string; // 4 digits
  flur: string; // 3 digits
  zaehler: string;
  nenner: string | null;
  /** Canonical form used as the D1 primary key. */
  normalized: string;
}

/**
 * Parses an ALKIS Flurstückskennzeichen.
 * Accepts common spellings: "05 2601 007 00123/0000", "052601007001230000__",
 * "052601-007-00123/0000". Underscores (NAS filler) are stripped.
 */
export function parseParcelId(raw: string): ParcelIdParts | null {
  const cleaned = raw.replace(/[\s_\-.]/g, "");
  if (!/^\d+(\/\d+)?$/.test(cleaned)) return null;
  if (cleaned.length < 10) return null;

  const land = cleaned.slice(0, 2);
  const gemarkung = cleaned.slice(2, 6);
  const flur = cleaned.slice(6, 9);
  const rest = cleaned.slice(9);
  if (rest.length === 0) return null;

  let zaehler: string;
  let nenner: string | null = null;
  if (rest.includes("/")) {
    const [z, n] = rest.split("/");
    zaehler = z;
    nenner = n && Number(n) !== 0 ? n : null;
  } else if (rest.length > 5) {
    // Fixed-width NAS form: 5-digit Zähler + 4-digit Nenner.
    zaehler = rest.slice(0, 5);
    const n = rest.slice(5, 9);
    nenner = n && Number(n) !== 0 ? n : null;
  } else {
    zaehler = rest;
  }
  if (!/^\d+$/.test(zaehler)) return null;

  const normalized = normalizeParts(land, gemarkung, flur, zaehler, nenner);
  return { land, gemarkung, flur, zaehler, nenner, normalized };
}

export function normalizeParts(
  land: string,
  gemarkung: string,
  flur: string,
  zaehler: string,
  nenner: string | null,
): string {
  const base = `${land}${gemarkung}${flur.padStart(3, "0")}${zaehler.padStart(5, "0")}`;
  return nenner ? `${base}/${nenner.padStart(4, "0")}` : base;
}
