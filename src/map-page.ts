/** The /map explorer page, served on 1sensedata.com/map via a zone route in
 * wrangler.jsonc. Design matches the 1sensedata.com landing page and /access
 * (Petrona/Instrument Sans, ink-on-paper palette): full-bleed map, floating
 * white cards, right-hand parcel panel with a locked owner card that funnels
 * to /access. The basemap is OpenFreeMap Liberty, recolored client-side to
 * the sand palette; satellite combines each Land's open aerial imagery.
 *
 * The page never renders personal names — parcel facts and Bodenrichtwerte
 * only; the owner question is always the locked card.
 */

import { BAVARIA_RING } from "./lib/bavaria.js";

export function mapPage(): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>1Sense — Karten-Explorer</title>
<meta name="description" content="Flurstücke und Bodenrichtwerte für Deutschland auf einer Karte. Wem ein Grundstück gehört, beantwortet 1Sense im Early Access.">
<link rel="canonical" href="https://1sensedata.com/map">
<link rel="stylesheet" href="https://fonts.bunny.net/css?family=petrona:400,600|instrument-sans:400,500&display=swap">
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.css">
<style>
:root {
  --ink: #1f2322;
  --paper: #ffffff;
  --sand-100: #f4efec;
  --sand-400: #e1d5cd;
  --accent: #C05B2E;
  --rule: rgba(31, 35, 34, 0.2);
  --font-text: "Petrona", "Iowan Old Style", Georgia, serif;
  --font-small: "Instrument Sans", ui-sans-serif, system-ui, sans-serif;
  --shadow: 0 2px 14px rgba(31, 35, 34, 0.14);
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  color: var(--ink);
  font-family: var(--font-small);
  font-size: 15px;
  background: var(--sand-100);
  overflow: hidden;
}
#map { position: absolute; inset: 0; }
a { color: inherit; }

.card {
  position: absolute;
  background: var(--paper);
  border: 1px solid rgba(31, 35, 34, 0.08);
  border-radius: 10px;
  box-shadow: var(--shadow);
  z-index: 10;
}

/* Top-left: brand */
.brand { top: 14px; left: 14px; padding: 12px 16px 11px; max-width: 250px; }
.brand .wordmark {
  font-family: var(--font-text);
  font-size: 22px;
  font-weight: 600;
  text-decoration: none;
  line-height: 1.1;
  display: inline-block;
}
.brand .tagline { font-size: 12.5px; color: rgba(31,35,34,0.65); margin-top: 2px; }
.brand .hint {
  font-size: 12.5px;
  color: rgba(31,35,34,0.75);
  background: var(--sand-100);
  border-radius: 6px;
  padding: 6px 9px;
  margin-top: 9px;
  display: none;
}
.brand .hint.show { display: block; }

/* Bottom-left: view switcher + layer chips */
.controls { bottom: 26px; left: 14px; padding: 10px 12px; display: flex; flex-direction: column; gap: 9px; }
.seg { display: inline-flex; background: var(--sand-100); border-radius: 8px; padding: 3px; }
.seg-btn {
  font-family: var(--font-small);
  font-size: 13.5px;
  border: 0;
  background: transparent;
  color: rgba(31,35,34,0.7);
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
}
.seg-btn.active { background: var(--ink); color: var(--paper); }
.seg-btn:disabled { opacity: 0.35; cursor: default; }
.chips { display: flex; gap: 6px; }
.chip {
  font-family: var(--font-small);
  font-size: 12.5px;
  border: 1px solid var(--rule);
  background: var(--paper);
  color: rgba(31,35,34,0.75);
  border-radius: 999px;
  padding: 5px 12px;
  cursor: pointer;
}
.chip.active { background: var(--sand-100); border-color: var(--ink); color: var(--ink); }
.chip .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; background: var(--rule); }
.chip.active .dot { background: var(--accent); }

/* Bottom-right: BRW legend */
.legend { bottom: 44px; right: 14px; padding: 11px 14px 10px; }
.legend-title { font-size: 12px; font-weight: 500; margin-bottom: 7px; }
.legend-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: rgba(31,35,34,0.8); margin: 3px 0; }
.legend-swatch { width: 16px; height: 11px; border-radius: 3px; border: 1px solid rgba(31,35,34,0.12); }

/* Right: parcel panel */
.panel {
  top: 14px;
  right: 14px;
  width: 330px;
  max-height: calc(100% - 28px);
  overflow-y: auto;
  padding: 18px 20px 20px;
}
.panel[hidden] { display: none; }
.panel-close {
  position: absolute;
  top: 10px; right: 12px;
  border: 0; background: transparent;
  font-size: 20px; line-height: 1;
  color: rgba(31,35,34,0.55);
  cursor: pointer;
  padding: 4px;
}
.panel-kicker { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(31,35,34,0.55); }
.panel-id {
  font-family: var(--font-text);
  font-size: 21px;
  font-weight: 600;
  margin: 3px 0 14px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.facts { margin: 0 0 4px; }
.fact { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-top: 1px solid rgba(31,35,34,0.09); font-size: 14px; }
.fact dt { color: rgba(31,35,34,0.6); margin: 0; }
.fact dd { margin: 0; text-align: right; font-weight: 500; }
.brw-value { font-family: var(--font-text); font-size: 19px; font-weight: 600; }
.panel-note { font-size: 11.5px; color: rgba(31,35,34,0.5); margin-top: 12px; }
.panel-loading { color: rgba(31,35,34,0.6); padding: 8px 0 4px; }
.panel-error { color: #b3261e; font-size: 13.5px; padding: 6px 0; }

/* Locked owner card */
.locked {
  margin-top: 16px;
  background: var(--sand-100);
  border: 1px solid var(--sand-400);
  border-radius: 10px;
  padding: 14px 16px 16px;
}
.locked-head { display: flex; align-items: center; gap: 8px; }
.locked-head svg { flex: 0 0 auto; }
.locked-title { font-family: var(--font-text); font-size: 17px; font-weight: 600; }
.locked p { font-size: 13.5px; line-height: 1.5; color: rgba(31,35,34,0.8); margin: 8px 0 12px; }
.locked-cta {
  display: block;
  text-align: center;
  font-family: var(--font-text);
  font-size: 16px;
  font-weight: 600;
  color: var(--paper);
  background: var(--accent);
  border-radius: 8px;
  padding: 10px 16px;
  text-decoration: none;
}
.locked-cta:hover { opacity: 0.92; }

/* MapLibre chrome in our look */
.maplibregl-ctrl-group { border-radius: 8px; box-shadow: var(--shadow); }
.maplibregl-ctrl-attrib { font-family: var(--font-small); font-size: 11px; }

/* Mobile: panel becomes a bottom sheet */
@media (max-width: 719px) {
  .brand { max-width: calc(100% - 28px); }
  .brand .tagline { display: none; }
  .controls { bottom: 24px; }
  .legend { display: none !important; }
  .panel {
    top: auto;
    left: 0; right: 0; bottom: 0;
    width: 100%;
    max-height: 62vh;
    border-radius: 14px 14px 0 0;
    border-left: 0; border-right: 0; border-bottom: 0;
    padding-top: 10px;
  }
  .panel::before {
    content: "";
    display: block;
    width: 38px; height: 4px;
    border-radius: 2px;
    background: rgba(31,35,34,0.22);
    margin: 0 auto 10px;
  }
}
</style>
</head>
<body>
<div id="map"></div>

<header class="card brand">
  <a class="wordmark" href="https://1sensedata.com/">1Sense</a>
  <div class="tagline">Flurstücke &amp; Bodenrichtwerte · Deutschland</div>
  <div class="hint" id="zoomHint">Näher heranzoomen, um Flurstücke zu sehen und auszuwählen.</div>
</header>

<div class="card controls">
  <div class="seg" role="group" aria-label="Kartenansicht">
    <button id="btnKarte" class="seg-btn active" type="button">Karte</button>
    <button id="btnSat" class="seg-btn" type="button">Satellit</button>
  </div>
  <div class="chips">
    <button id="chipParcels" class="chip active" type="button"><span class="dot"></span>Flurstücke</button>
    <button id="chipBrw" class="chip active" type="button"><span class="dot"></span>Bodenrichtwerte</button>
    <button id="chip3d" class="chip" type="button"><span class="dot"></span>3D</button>
  </div>
</div>

<div class="card legend" id="legend">
  <div class="legend-title">Bodenrichtwert (€/m²)</div>
  <div id="legendRows"></div>
</div>

<aside class="card panel" id="panel" hidden aria-label="Flurstück-Details">
  <button class="panel-close" id="panelClose" type="button" aria-label="Schließen">×</button>
  <div class="panel-kicker">Flurstück</div>
  <h2 class="panel-id" id="panelId"></h2>
  <div id="panelBody"></div>
  <div class="locked">
    <div class="locked-head">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1f2322" stroke-width="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>
      <div class="locked-title">Wem gehört dieses Grundstück?</div>
    </div>
    <p>Die Eigentümerkette – vom Flurstück bis zur Gesellschaft, die dahintersteht – ist Teil des Early Access.</p>
    <a class="locked-cta" href="https://1sensedata.com/access">Early Access anfordern</a>
  </div>
  <div class="panel-note">Quellen: amtliche Liegenschaftskataster und Bodenrichtwerte der Länder · <a href="/map/quellen">Quellen &amp; Lizenzen</a>. Keine Eigentümerdaten auf dieser Karte.</div>
</aside>

<script src="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.js"></script>
<script src="https://unpkg.com/pmtiles@3.2.0/dist/pmtiles.js"></script>
<script>
(function () {
  "use strict";

  var INK = "#1f2322";
  var BRW_STOPS = [
    [0, "#efe4d0"],
    [50, "#e8cdb0"],
    [150, "#dda888"],
    [400, "#C05B2E"],
    [1000, "#8f3f1e"],
    [2500, "#5c2a16"]
  ];
  var LEGEND_LABELS = [
    "unter 50", "50 – 150", "150 – 400", "400 – 1.000", "1.000 – 2.500", "über 2.500"
  ];
  var NUTZUNG = {
    W: "Wohnen", G: "Gewerbe", M: "Gemischt", MI: "Gemischt",
    F: "Forst", LF: "Land-/Forstwirtschaft", L: "Landwirtschaft",
    SF: "Sonderfläche", S: "Sonstiges", B: "Bauland", E: "Entwicklung"
  };

  // ---- Legend ----
  var legendRows = document.getElementById("legendRows");
  for (var i = 0; i < BRW_STOPS.length; i++) {
    var row = document.createElement("div");
    row.className = "legend-row";
    var sw = document.createElement("span");
    sw.className = "legend-swatch";
    sw.style.background = BRW_STOPS[i][1];
    row.appendChild(sw);
    row.appendChild(document.createTextNode(LEGEND_LABELS[i]));
    legendRows.appendChild(row);
  }

  // ---- Color helpers: recolor the Liberty basemap to the sand palette ----
  function parseColor(str) {
    if (typeof str !== "string") return null;
    var s = str.trim().toLowerCase();
    var m = /^#([0-9a-f]{3})$/.exec(s);
    if (m) {
      return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16),
              parseInt(m[1][2] + m[1][2], 16), 1];
    }
    m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
    if (m) {
      return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16),
              parseInt(m[1].slice(4, 6), 16), m[2] ? parseInt(m[2], 16) / 255 : 1];
    }
    m = /^rgba?\\(([^)]+)\\)$/.exec(s);
    if (m) {
      var p = m[1].split(",").map(function (x) { return parseFloat(x); });
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    m = /^hsla?\\(([^)]+)\\)$/.exec(s);
    if (m) {
      var q = m[1].split(",").map(function (x) { return parseFloat(x); });
      var rgb = hslToRgb(q[0] / 360, q[1] / 100, q[2] / 100);
      return [rgb[0], rgb[1], rgb[2], q.length > 3 ? q[3] : 1];
    }
    return null;
  }
  function hslToRgb(h, s, l) {
    if (s === 0) { var v = Math.round(l * 255); return [v, v, v]; }
    function hue(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var q2 = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p2 = 2 * l - q2;
    return [Math.round(hue(p2, q2, h + 1 / 3) * 255),
            Math.round(hue(p2, q2, h) * 255),
            Math.round(hue(p2, q2, h - 1 / 3) * 255)];
  }
  // Pulls the basemap onto 1Sense paper: every color is mixed toward a target
  // tone whose choice depends on the layer's role (ground, line, label, water).
  var PAPER_RGB = [244, 239, 236];
  var INK_RGB = [31, 35, 34];
  var WATER_RGB = [202, 216, 213];
  function mixColor(str, target, k) {
    var c = parseColor(str);
    if (!c) return str;
    var r = Math.round(c[0] + (target[0] - c[0]) * k);
    var g = Math.round(c[1] + (target[1] - c[1]) * k);
    var b = Math.round(c[2] + (target[2] - c[2]) * k);
    return "rgba(" + r + "," + g + "," + b + "," + c[3] + ")";
  }
  function walkColors(value, target, k) {
    if (typeof value === "string" && parseColor(value)) {
      return mixColor(value, target, k);
    }
    if (Array.isArray(value)) {
      return value.map(function (v) { return walkColors(v, target, k); });
    }
    if (value && typeof value === "object" && Array.isArray(value.stops)) {
      var out = {};
      for (var key in value) out[key] = value[key];
      out.stops = value.stops.map(function (st) {
        return [st[0], walkColors(st[1], target, k)];
      });
      return out;
    }
    return value;
  }
  function recolorProps(props, mapTarget) {
    if (!props) return;
    for (var key in props) {
      if (!/-color$/.test(key)) continue;
      var rule = mapTarget(key);
      if (rule) props[key] = walkColors(props[key], rule[0], rule[1]);
    }
  }
  function restyle(style) {
    var layers = (style.layers || []).filter(function (l) {
      // 3D building extrusions throw hard shadows that break the paper look.
      return l.type !== "fill-extrusion";
    });
    style.layers = layers;
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      if (layer.id === "background" || layer.type === "background") {
        layer.paint = layer.paint || {};
        layer.paint["background-color"] = "#f4efec";
        continue;
      }
      var isWater = /water|waterway|ocean/.test(layer.id || "");
      var rule;
      if (isWater) {
        rule = function () { return [WATER_RGB, 0.8]; };
      } else if (layer.type === "symbol") {
        rule = function (key) {
          if (/halo/.test(key)) return [PAPER_RGB, 0.85];
          return [INK_RGB, 0.5]; // text + icons toward ink: keep labels readable
        };
      } else if (layer.type === "line") {
        rule = function () { return [PAPER_RGB, 0.55]; };
      } else {
        rule = function () { return [PAPER_RGB, 0.7]; };
      }
      recolorProps(layer.paint, rule);
      recolorProps(layer.layout, rule);
    }
    return style;
  }

  // ---- WMTS matrix mapping: Geobasis NRW DOP identifiers are web zoom - 5,
  // zero-padded to two digits ("00".."16"); col/row match the web grid. ----
  var DOP_RE = /(wmts_nw_dop\\/tiles\\/nw_dop\\/EPSG_3857_16\\/)(\\d+)\\//;
  function transformRequest(url) {
    var m = DOP_RE.exec(url);
    if (m) {
      var matrix = String(Number(m[2]) - 5);
      if (matrix.length < 2) matrix = "0" + matrix;
      return { url: url.replace(DOP_RE, "$1" + matrix + "/") };
    }
    return { url: url };
  }

  // ---- Map ----
  var protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);

  var PARCEL_MINZOOM = 13;
  var state = { view: "karte", parcels: true, brw: true, b3d: false, selectedId: null };

  fetch("https://tiles.openfreemap.org/styles/liberty")
    .then(function (r) { return r.json(); })
    .then(function (style) { start(restyle(style)); })
    .catch(function () {
      // Basemap unreachable: still show our own layers on plain paper.
      start({
        version: 8,
        glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
        sources: {},
        layers: [{ id: "background", type: "background",
                   paint: { "background-color": "#f4efec" } }]
      });
    });

  function start(style) {
    var map = new maplibregl.Map({
      container: "map",
      style: style,
      center: [6.9578, 50.9413],
      zoom: 15,
      hash: true,
      attributionControl: { compact: true },
      transformRequest: transformRequest
    });
    window._map = map; // debugging handle, carries no data
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true }
    }), "top-right");

    // ---- Aerial imagery beyond NRW: one open source per Land (verified
    // 2026-11-28, docs/germany-sources.md). No national open DOP exists (the
    // BKG mosaic is V-GeoBund only), so Länder sources are layered, each
    // limited to its Land's box; WMS tiles are transparent PNG outside the
    // Land so neighbours show through at borders. Sentinel-2 (10 m) is the
    // low-zoom base so Satellit also works zoomed out.
    var WMS = "SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES=&CRS=EPSG:3857" +
      "&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE";
    function wms(base, layers) { return [base + WMS + "&LAYERS=" + layers]; }
    var BY_TILES = [];
    for (var h = 1; h <= 9; h++) {
      BY_TILES.push("https://wmtsod" + h + ".bayernwolke.de/wmts/by_dop/smerc/{z}/{x}/{y}");
    }
    // Bottom to top. bounds: VG250 Land extents (+0.01°).
    var SAT_SOURCES = [
      { id: "sat-de", tiles: [
          "https://sgx.geodatenzentrum.de/wms_sen2europe?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES=" +
          "&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg&LAYERS=rgb"],
        bounds: [5.8, 47.2, 15.1, 55.1], maxzoom: 13,
        attribution: "Satellit: Europäische Union, enthält veränderte Copernicus-Sentinel-Daten (BKG)" },
      { id: "sat-09", tiles: BY_TILES, bounds: [8.966, 47.26, 13.85, 50.574], maxzoom: 19,
        attribution: "Luftbilder Bayern: © Bayerische Vermessungsverwaltung, EU/Copernicus Sentinel-2, BKG (CC BY 4.0)" },
      { id: "sat-08", tiles: [
          "https://owsproxy.lgl-bw.de/owsproxy/ows/WMTS_LGL-BW_ATKIS_DOP_20_C?SERVICE=WMTS&REQUEST=GetTile" +
          "&VERSION=1.0.0&LAYER=DOP_20_C&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible" +
          "&TILEMATRIX=GoogleMapsCompatible:{z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg"],
        bounds: [7.502, 47.522, 10.506, 49.801], maxzoom: 20,
        attribution: "Luftbilder: LGL-BW (2026) dl-de/by-2.0, www.lgl-bw.de" },
      { id: "sat-10", tiles: wms("https://geoportal.saarland.de/freewms/dop2023?", "sl_dop20_rgb"),
        bounds: [6.347, 49.102, 7.414, 49.649], attribution: "Luftbilder: © GeoBasis DE/LVGL-SL (2026)" },
      { id: "sat-07", tiles: wms("https://geo4.service24.rlp.de/wms/rp_dop20.fcgi?", "rp_dop20"),
        bounds: [6.102, 48.957, 8.518, 50.952], attribution: "Luftbilder: ©GeoBasis-DE / LVermGeoRP (2026), dl-de/by-2-0" },
      { id: "sat-06", tiles: wms("https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows?", "he_dop_rgb"),
        bounds: [7.762, 49.385, 10.246, 51.667], attribution: "Luftbilder: HVBG Hessen (Daten verändert)" },
      { id: "sat-16", tiles: wms("https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP?", "th_dop"),
        bounds: [9.867, 50.195, 12.664, 51.659], attribution: "Luftbilder: © GDI-Th (CC BY 4.0)" },
      { id: "sat-14", tiles: wms("https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest?", "sn_dop_020"),
        bounds: [11.861, 50.162, 15.052, 51.695], attribution: "Luftbilder: Quelle: GeoSN, dl-de/by-2-0" },
      { id: "sat-15", tiles: wms("https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_DOP_WMS_OpenData/guest?", "lsa_lvermgeo_dop20_2"),
        bounds: [10.551, 50.928, 13.197, 53.052], attribution: "Luftbilder: © GeoBasis-DE/LVermGeo ST" },
      { id: "sat-03", tiles: wms("https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms?", "ni_dop20"),
        bounds: [6.336, 51.285, 11.608, 54.148], attribution: "Luftbilder: LGLN (2026) CC BY 4.0" },
      { id: "sat-04", tiles: wms("https://geodienste.bremen.de/wms_dop_lb?", "dop10_2025_HB,dop10_2025_BHV"),
        bounds: [8.472, 53.001, 9.001, 53.62], attribution: "Luftbilder: Landesamt GeoInformation Bremen" },
      { id: "sat-01", tiles: wms("https://dienste.gdi-sh.de/WMS_SH_DOP20col_OpenGBD?", "sh_dop20_rgb"),
        bounds: [7.511, 53.35, 11.682, 55.109], attribution: "Luftbilder: © GeoBasis-DE/LVermGeo SH/CC BY 4.0" },
      { id: "sat-02", tiles: [wms("https://geodienste.hamburg.de/wms_dop_zeitreihe_unbelaubt?", "dop_zeitreihe_unbelaubt")[0] + "&TIME=2026"],
        bounds: [8.094, 53.385, 10.336, 54.038], attribution: "Luftbilder: Freie und Hansestadt Hamburg, LGV" },
      { id: "sat-13", tiles: wms("https://www.geodaten-mv.de/dienste/adv_dop?", "mv_dop"),
        bounds: [10.584, 53.1, 14.422, 54.894], attribution: "Luftbilder: © GeoBasis-DE/M-V 2026 (CC BY 4.0)" },
      { id: "sat-12", tiles: wms("https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms?", "bebb_dop20c"),
        bounds: [11.256, 51.349, 14.776, 53.569], attribution: "Luftbilder: © GeoBasis-DE/LGB, dl-de/by-2-0" },
      { id: "sat-11", tiles: wms("https://gdi.berlin.de/services/wms/truedop_2026?", "truedop_2026"),
        bounds: [13.078, 52.328, 13.77, 52.685], attribution: "Luftbilder: Geoportal Berlin (dl-de/zero-2.0)" }
    ];
    var SAT_LAYER_IDS = [];

    // Bavaria publishes no open parcel data; its open (CC BY 4.0) ALKIS
    // Parzellarkarte WMS still shows boundaries as an image — no parcel
    // numbers, nothing to click. The hint below says so in Bavaria.
    var BAVARIA_RING = ${JSON.stringify(BAVARIA_RING)};
    function inBavaria(lng, lat) {
      var inside = false;
      for (var i = 0, j = BAVARIA_RING.length - 1; i < BAVARIA_RING.length; j = i++) {
        var xi = BAVARIA_RING[i][0], yi = BAVARIA_RING[i][1];
        var xj = BAVARIA_RING[j][0], yj = BAVARIA_RING[j][1];
        if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }

    map.on("load", function () {
      var origin = location.origin;

      SAT_SOURCES.forEach(function (s) {
        map.addSource(s.id, {
          type: "raster", tiles: s.tiles, tileSize: 256, bounds: s.bounds,
          minzoom: 5, maxzoom: s.maxzoom || 19, attribution: s.attribution
        });
        map.addLayer({ id: s.id + "-layer", type: "raster", source: s.id,
                       layout: { visibility: "none" } });
        SAT_LAYER_IDS.push(s.id + "-layer");
      });

      map.addSource("by-parcels", {
        type: "raster",
        tiles: ["https://geoservices.bayern.de/od/wms/alkis/v1/parzellarkarte?" + WMS +
                "&LAYERS=by_alkis_parzellarkarte_umr_schwarz"],
        tileSize: 256, bounds: [8.966, 47.26, 13.85, 50.574], minzoom: 15, maxzoom: 19,
        attribution: "Flurkarte Bayern (Bild): © Bayerische Vermessungsverwaltung, CC BY 4.0"
      });

      map.addSource("dop", {
        type: "raster",
        tiles: ["https://www.wmts.nrw.de/geobasis/wmts_nw_dop/tiles/nw_dop/EPSG_3857_16/{z}/{x}/{y}"],
        tileSize: 256,
        minzoom: 5,
        maxzoom: 21,
        bounds: [5.69, 50.26, 9.69, 52.58],
        attribution: "Luftbilder: © Geobasis NRW (dl-de/zero-2.0)"
      });
      map.addSource("brw", {
        type: "vector",
        url: "pmtiles://" + origin + "/map/tiles/brw.pmtiles",
        attribution: 'Bodenrichtwerte: amtliche Gutachterausschüsse der Länder'
      });
      map.addSource("parcels", {
        type: "vector",
        url: "pmtiles://" + origin + "/map/tiles/parcels.pmtiles",
        promoteId: "id",
        attribution: 'Flurstücke: ALKIS © GeoBasis-DE / Vermessungsverwaltungen der Länder, © GeoBasis-DE / BKG · <a href="/map/quellen">Quellen &amp; Lizenzen</a>'
      });
      map.addSource("buildings", {
        type: "vector",
        url: "pmtiles://" + origin + "/map/tiles/buildings.pmtiles",
        attribution: "3D-Gebäude: LoD2 © Geobasis NRW (dl-de/zero-2.0)"
      });

      map.addLayer({
        id: "dop-layer",
        type: "raster",
        source: "dop",
        layout: { visibility: "none" },
        paint: { "raster-opacity": 1 }
      });

      var brwColor = ["interpolate", ["linear"],
                      ["coalesce", ["get", "brw_eur_m2"], 0]];
      for (var i = 0; i < BRW_STOPS.length; i++) {
        brwColor.push(BRW_STOPS[i][0], BRW_STOPS[i][1]);
      }
      map.addLayer({
        id: "brw-fill",
        type: "fill",
        source: "brw",
        "source-layer": "brw",
        paint: { "fill-color": brwColor, "fill-opacity": 0.28 }
      });
      map.addLayer({
        id: "brw-line",
        type: "line",
        source: "brw",
        "source-layer": "brw",
        minzoom: 12,
        paint: { "line-color": "#C05B2E", "line-width": 0.4, "line-opacity": 0.3 }
      });

      // LoD2 building models (official Geobasis NRW heights), off by default;
      // the 3D chip toggles the layer together with the camera pitch.
      map.addLayer({
        id: "buildings-3d",
        type: "fill-extrusion",
        source: "buildings",
        "source-layer": "buildings",
        minzoom: 13.5,
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": "#e9e1da",
          "fill-extrusion-height": ["get", "h"],
          "fill-extrusion-opacity": 0.92,
          "fill-extrusion-vertical-gradient": true
        }
      });

      map.addLayer({
        id: "by-parcels-layer",
        type: "raster",
        source: "by-parcels",
        layout: { visibility: "none" },
        paint: { "raster-opacity": 0.55 }
      });

      map.addLayer({
        id: "parcel-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        paint: {
          // Hover tint so the parcel under the cursor is visibly clickable.
          "fill-color": "#C05B2E",
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false], 0.14,
            0
          ]
        }
      });
      map.addLayer({
        id: "parcel-line",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        paint: {
          "line-color": INK,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.25, 16, 0.55],
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.3, 17, 1.4]
        }
      });
      map.addLayer({
        id: "parcel-selected",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": "#C05B2E", "line-width": 2.5 }
      });

      map.on("click", "parcel-fill", function (e) {
        if (!state.parcels || !e.features || !e.features.length) return;
        var id = e.features[0].properties && e.features[0].properties.id;
        if (id) selectParcel(id);
      });
      var hoverId = null;
      function clearHover() {
        if (hoverId !== null) {
          map.setFeatureState(
            { source: "parcels", sourceLayer: "parcels", id: hoverId },
            { hover: false }
          );
          hoverId = null;
        }
      }
      map.on("mousemove", "parcel-fill", function (e) {
        map.getCanvas().style.cursor = "pointer";
        if (!e.features || !e.features.length) return;
        var fid = e.features[0].id;
        if (fid === hoverId) return;
        clearHover();
        hoverId = fid;
        map.setFeatureState(
          { source: "parcels", sourceLayer: "parcels", id: fid },
          { hover: true }
        );
      });
      map.on("mouseleave", "parcel-fill", function () {
        map.getCanvas().style.cursor = "";
        clearHover();
      });

      updateZoomHint();
      map.on("moveend", updateZoomHint);
      map.on("moveend", syncRegionalLayers);
      syncRegionalLayers();
    });

    // ---- UI state ----
    var btnKarte = document.getElementById("btnKarte");
    var btnSat = document.getElementById("btnSat");
    var chipParcels = document.getElementById("chipParcels");
    var chipBrw = document.getElementById("chipBrw");
    var chip3d = document.getElementById("chip3d");
    var legend = document.getElementById("legend");
    var panel = document.getElementById("panel");
    var panelId = document.getElementById("panelId");
    var panelBody = document.getElementById("panelBody");
    var zoomHint = document.getElementById("zoomHint");

    function setView(view) {
      state.view = view;
      btnKarte.classList.toggle("active", view === "karte");
      btnSat.classList.toggle("active", view === "satellit");
      if (!map.getLayer("dop-layer")) return;
      syncRegionalLayers();
      // Ink lines disappear on imagery — switch parcel strokes to paper.
      var lineColor = view === "satellit" ? "#ffffff" : INK;
      var lineOpacity = view === "satellit"
        ? ["interpolate", ["linear"], ["zoom"], 13, 0.4, 16, 0.85]
        : ["interpolate", ["linear"], ["zoom"], 13, 0.25, 16, 0.55];
      map.setPaintProperty("parcel-line", "line-color", lineColor);
      map.setPaintProperty("parcel-line", "line-opacity", lineOpacity);
    }
    // Regional raster layers (each Land's imagery, Bavaria's outline image)
    // are shown only where their Land overlaps the view. MapLibre lists the
    // attribution of every visible source regardless of its bounds, so this
    // keeps the credits to the Länder actually on screen — and skips tile
    // requests to servers whose area is out of view.
    var REGIONAL = SAT_SOURCES.map(function (s) {
      return { layer: s.id + "-layer", bounds: s.bounds, sat: true };
    }).concat([
      { layer: "dop-layer", bounds: [5.69, 50.26, 9.69, 52.58], sat: true },
      { layer: "by-parcels-layer", bounds: [8.966, 47.26, 13.85, 50.574], sat: false }
    ]);
    function syncRegionalLayers() {
      var b = map.getBounds();
      var v = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      REGIONAL.forEach(function (r) {
        if (!map.getLayer(r.layer)) return;
        var hit = r.bounds[0] <= v[2] && r.bounds[2] >= v[0] &&
                  r.bounds[1] <= v[3] && r.bounds[3] >= v[1];
        var on = hit && (r.sat ? state.view === "satellit" : state.parcels);
        map.setLayoutProperty(r.layer, "visibility", on ? "visible" : "none");
      });
    }

    btnKarte.addEventListener("click", function () { setView("karte"); });
    btnSat.addEventListener("click", function () { setView("satellit"); });

    function syncLayers() {
      chipParcels.classList.toggle("active", state.parcels);
      chipBrw.classList.toggle("active", state.brw);
      legend.style.display = state.brw ? "" : "none";
      var vis = function (on) { return on ? "visible" : "none"; };
      syncRegionalLayers();
      ["parcel-fill", "parcel-line", "parcel-selected"].forEach(function (id) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis(state.parcels));
      });
      ["brw-fill", "brw-line"].forEach(function (id) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis(state.brw));
      });
    }
    chipParcels.addEventListener("click", function () {
      state.parcels = !state.parcels; syncLayers();
    });
    chipBrw.addEventListener("click", function () {
      state.brw = !state.brw; syncLayers();
    });
    chip3d.addEventListener("click", function () {
      state.b3d = !state.b3d;
      chip3d.classList.toggle("active", state.b3d);
      if (map.getLayer("buildings-3d")) {
        map.setLayoutProperty("buildings-3d", "visibility",
          state.b3d ? "visible" : "none");
      }
      if (state.b3d) {
        var z = map.getZoom();
        map.easeTo({ pitch: 55, zoom: z < 14 ? 15.5 : z, duration: 800 });
      } else {
        map.easeTo({ pitch: 0, duration: 600 });
      }
    });

    var ZOOM_HINT = zoomHint.textContent;
    function updateZoomHint() {
      var c = map.getCenter();
      if (state.parcels && map.getZoom() >= 8 && inBavaria(c.lng, c.lat)) {
        zoomHint.textContent = "Bayern stellt Flurstücke nicht als offene Daten bereit: " +
          "Grenzen nur als Kartenbild, ohne Auswahl.";
        zoomHint.classList.add("show");
        return;
      }
      zoomHint.textContent = ZOOM_HINT;
      zoomHint.classList.toggle("show", state.parcels && map.getZoom() < PARCEL_MINZOOM);
    }

    // ---- Parcel panel ----
    function formatId(id) {
      // 05 2601 007 00123 (/0004) — readable grouping of the Kennzeichen.
      var m = /^(\\d{2})(\\d{4})(\\d{3})(\\d{5})(?:\\/(\\d{4}))?$/.exec(id);
      if (!m) return id;
      var s = m[1] + " " + m[2] + " " + m[3] + " " + m[4];
      return m[5] ? s + " / " + m[5] : s;
    }
    function fmtArea(v) {
      if (v === null || v === undefined) return null;
      return Number(v).toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " m²";
    }
    function fmtEur(v) {
      if (v === null || v === undefined) return null;
      return Number(v).toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " €/m²";
    }
    function factRow(label, value, cls) {
      if (value === null || value === undefined || value === "") return "";
      return '<div class="fact"><dt>' + label + '</dt><dd' +
        (cls ? ' class="' + cls + '"' : "") + ">" + value + "</dd></div>";
    }
    function esc(s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function selectParcel(id) {
      state.selectedId = id;
      if (map.getLayer("parcel-selected")) {
        map.setFilter("parcel-selected", ["==", ["get", "id"], id]);
      }
      panel.hidden = false;
      panelId.textContent = formatId(id);
      panelBody.innerHTML = '<div class="panel-loading">Lade Daten …</div>';
      fetch("/map/api/parcel?id=" + encodeURIComponent(id))
        .then(function (r) {
          return r.json().then(function (data) { return { status: r.status, data: data }; });
        })
        .then(function (res) { renderPanel(res.status, res.data); })
        .catch(function () {
          panelBody.innerHTML =
            '<div class="panel-error">Daten konnten nicht geladen werden. Bitte später erneut versuchen.</div>';
        });
    }

    function renderPanel(status, data) {
      if (!data || data.ok !== true) {
        var msg = status === 429
          ? "Tageslimit für Abfragen erreicht. Morgen geht es weiter — oder Early Access anfordern."
          : "Zu diesem Flurstück liegen keine Daten vor.";
        panelBody.innerHTML = '<div class="panel-error">' + msg + "</div>";
        return;
      }
      var p = data.parcel || {};
      var html = '<dl class="facts">';
      html += factRow("Fläche", fmtArea(p.area_m2));
      html += factRow("Gemeinde", p.municipality ? esc(p.municipality) : null);
      html += factRow("Kreis", p.kreis ? esc(p.kreis) : null);
      html += factRow("Gemarkung", p.gemarkung ? esc(p.gemarkung) : null);
      html += factRow("Flur", p.flur ? esc(p.flur) : null);
      html += factRow("Flurstück", p.zaehler
        ? esc(p.zaehler.replace(/^0+(?=\\d)/, "")) +
          (p.nenner ? " / " + esc(p.nenner.replace(/^0+(?=\\d)/, "")) : "")
        : null);
      var zones = data.brw_zones;
      if (zones && zones.length) {
        var z = zones[0];
        html += factRow("Bodenrichtwert", fmtEur(z.brw_eur_m2), "brw-value");
        var nutz = z.nutzungsart ? (NUTZUNG[z.nutzungsart] || esc(z.nutzungsart)) : null;
        html += factRow("Nutzung", nutz);
        html += factRow("Stichtag", z.stand ? esc(z.stand) : null);
        if (zones.length > 1) {
          for (var i = 1; i < zones.length; i++) {
            html += factRow("Weitere Zone", fmtEur(zones[i].brw_eur_m2));
          }
        }
      } else if (data.brw_unavailable) {
        html += factRow("Bodenrichtwert", "nicht offen veröffentlicht");
      }
      html += "</dl>";
      panelBody.innerHTML = html;
    }

    document.getElementById("panelClose").addEventListener("click", closePanel);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closePanel();
    });
    function closePanel() {
      panel.hidden = true;
      state.selectedId = null;
      if (map.getLayer("parcel-selected")) {
        map.setFilter("parcel-selected", ["==", ["get", "id"], ""]);
      }
    }
  }
})();
</script>
</body>
</html>`;
}
