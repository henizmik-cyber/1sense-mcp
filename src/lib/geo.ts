export interface LngLat {
  lng: number;
  lat: number;
}

export function mapLink(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lng.toFixed(6)}#map=18/${lat.toFixed(6)}/${lng.toFixed(6)}`;
}

type Ring = [number, number][];

/** Ray-casting point-in-ring test (GeoJSON [lng, lat] order). */
function pointInRing(pt: LngLat, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > pt.lat !== yj > pt.lat &&
      pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygonRings(pt: LngLat, rings: Ring[]): boolean {
  if (rings.length === 0) return false;
  if (!pointInRing(pt, rings[0])) return false;
  // Holes
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(pt, rings[i])) return false;
  }
  return true;
}

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export function pointInGeometry(pt: LngLat, geom: GeoJsonGeometry): boolean {
  if (geom.type === "Polygon") {
    return pointInPolygonRings(pt, geom.coordinates as Ring[]);
  }
  if (geom.type === "MultiPolygon") {
    return (geom.coordinates as Ring[][]).some((poly) =>
      pointInPolygonRings(pt, poly),
    );
  }
  return false;
}

/** Rough WGS84 bounding boxes used only for coverage classification of lat/lng input. */
export const NRW_BBOX = { minLng: 5.85, minLat: 50.3, maxLng: 9.5, maxLat: 52.55 };
export const BAVARIA_BBOX = { minLng: 8.95, minLat: 47.25, maxLng: 13.9, maxLat: 50.6 };

export function inBbox(
  pt: LngLat,
  b: { minLng: number; minLat: number; maxLng: number; maxLat: number },
): boolean {
  return (
    pt.lng >= b.minLng && pt.lng <= b.maxLng && pt.lat >= b.minLat && pt.lat <= b.maxLat
  );
}
