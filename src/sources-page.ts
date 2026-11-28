/** /map/quellen — the full source and license list behind the map.
 * Several Länder license under CC BY 4.0 or dl-de/by-2.0, which require a
 * visible attribution; the map's attribution control links here. Keep this
 * list in step with the Länder actually loaded (see src/lib/coverage.ts). */

interface Source {
  land: string;
  data: string;
  credit: string;
  license: string;
  licenseUrl: string;
}

const DL_ZERO = "https://www.govdata.de/dl-de/zero-2-0";
const DL_BY = "https://www.govdata.de/dl-de/by-2-0";
const CC_BY = "https://creativecommons.org/licenses/by/4.0/";

const SOURCES: Source[] = [
  { land: "Nordrhein-Westfalen", data: "Flurstücke, Bodenrichtwerte, Luftbilder, 3D-Gebäude", credit: "© Geobasis NRW", license: "dl-de/zero-2.0", licenseUrl: DL_ZERO },
  { land: "Schleswig-Holstein", data: "Flurstücke, Luftbilder", credit: "© GeoBasis-DE/LVermGeo SH", license: "CC BY 4.0", licenseUrl: CC_BY },
  { land: "Hamburg", data: "Flurstücke, Bodenrichtwerte, Luftbilder", credit: "Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV)", license: "dl-de/by-2.0", licenseUrl: DL_BY },
  { land: "Niedersachsen", data: "Flurstücke, Luftbilder", credit: "© GeoBasis-DE/LGLN 2026", license: "CC BY 4.0", licenseUrl: CC_BY },
  { land: "Bremen", data: "Flurstücke, Luftbilder", credit: "Landesamt GeoInformation Bremen", license: "CC BY 4.0", licenseUrl: CC_BY },
  { land: "Hessen", data: "Flurstücke, Bodenrichtwerte, Luftbilder", credit: "Hessische Verwaltung für Bodenmanagement und Geoinformation (HVBG), Daten verändert", license: "dl-de/zero-2.0", licenseUrl: DL_ZERO },
  { land: "Rheinland-Pfalz", data: "Flurstücke, Luftbilder", credit: "©GeoBasis-DE / LVermGeoRP 2026", license: "dl-de/by-2.0", licenseUrl: DL_BY },
  { land: "Baden-Württemberg", data: "Flurstücke, Luftbilder", credit: "Datenquelle: LGL, www.lgl-bw.de", license: "dl-de/by-2.0", licenseUrl: DL_BY },
  { land: "Saarland", data: "Flurstücke, Luftbilder", credit: "© GeoBasis DE/LVGL-SL 2026", license: "dl-de/by-2.0", licenseUrl: DL_BY },
  { land: "Berlin", data: "Flurstücke, Bodenrichtwerte, Luftbilder", credit: "Geoportal Berlin", license: "dl-de/zero-2.0", licenseUrl: DL_ZERO },
  { land: "Brandenburg", data: "Flurstücke, Bodenrichtwerte, Luftbilder", credit: "© GeoBasis-DE/LGB", license: "dl-de/by-2.0", licenseUrl: DL_BY },
  { land: "Mecklenburg-Vorpommern", data: "Flurstücke, Luftbilder", credit: "© GeoBasis-DE/M-V 2026", license: "CC BY 4.0", licenseUrl: CC_BY },
  { land: "Sachsen", data: "Flurstücke, Luftbilder", credit: "Quelle: GeoSN", license: "dl-de/by-2.0", licenseUrl: DL_BY },
  { land: "Sachsen-Anhalt", data: "Flurstücke, Bodenrichtwerte, Luftbilder", credit: "© GeoBasis-DE / LVermGeo ST", license: "dl-de/by-2.0", licenseUrl: DL_BY },
  { land: "Thüringen", data: "Flurstücke, Bodenrichtwerte, Luftbilder", credit: "© GDI-Th", license: "CC BY 4.0", licenseUrl: CC_BY },
  { land: "Bayern", data: "Luftbilder, Flurkarte als Kartenbild (keine Flurstücksdaten)", credit: "© Bayerische Vermessungsverwaltung; Europäische Union, enthält Copernicus Sentinel-2 Daten, verarbeitet durch das BKG", license: "CC BY 4.0", licenseUrl: CC_BY },
  { land: "Europa (Copernicus)", data: "Satellitenbild für kleine Maßstäbe (Sentinel-2, 10 m)", credit: "Europäische Union, enthält veränderte Copernicus-Sentinel-Daten, bereitgestellt durch das BKG", license: "Copernicus-Datennutzung (frei)", licenseUrl: "https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice" },
  { land: "Bund (BKG)", data: "Gemeinde- und Kreisnamen (Verwaltungsgebiete VG250), Umriss Bayern", credit: "© GeoBasis-DE / BKG 2026", license: "dl-de/by-2.0", licenseUrl: DL_BY },
];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sourcesPage(): string {
  const rows = SOURCES.map(
    (s) => `<tr><td>${esc(s.land)}</td><td>${esc(s.data)}</td><td>${esc(s.credit)}</td>` +
      `<td><a href="${s.licenseUrl}">${esc(s.license)}</a></td></tr>`,
  ).join("\n");
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>1Sense — Quellen</title>
<link rel="stylesheet" href="https://fonts.bunny.net/css?family=petrona:400,600|instrument-sans:400,500&display=swap">
<style>
:root { --ink: #1f2322; --sand-100: #f4efec; --rule: rgba(31,35,34,0.15); }
body { margin: 0; background: #fff; color: var(--ink); font-family: "Instrument Sans", system-ui, sans-serif; font-size: 15px; line-height: 1.5; }
main { max-width: 920px; margin: 0 auto; padding: 40px 16px 72px; }
.top a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--rule); }
h1 { font-family: "Petrona", Georgia, serif; font-weight: 600; font-size: 32px; margin: 32px 0 12px; }
p { color: rgba(31,35,34,0.8); }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; margin-top: 20px; font-size: 14px; }
th, td { text-align: left; padding: 9px 10px; border-top: 1px solid var(--rule); vertical-align: top; }
th { font-weight: 500; background: var(--sand-100); }
td a { color: inherit; }
</style>
</head>
<body>
<main>
  <nav class="top"><a href="/map">← Zur Karte</a></nav>
  <h1>Quellen &amp; Lizenzen</h1>
  <p>Die Karte zeigt amtliche offene Geodaten der Länder. Eigentümerdaten sind nicht Teil dieser Daten und werden auf der Karte nicht angezeigt.
  Bayern stellt Flurstücke nicht als offene Daten bereit. Bodenrichtwerte sind nur für Länder enthalten, die sie offen veröffentlichen.</p>
  <div class="table-wrap">
  <table>
    <thead><tr><th>Land</th><th>Daten</th><th>Quellenvermerk</th><th>Lizenz</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  </div>
  <p style="margin-top:24px">Grundkarte: OpenFreeMap, © OpenMapTiles, Daten © OpenStreetMap-Mitwirkende.</p>
</main>
</body>
</html>`;
}
