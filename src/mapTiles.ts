export const MAP_MIN_ZOOM = 2;
export const MAP_MAX_ZOOM = 19;

type MapCenter = { latitude: number; longitude: number };

const ADSB_ALTITUDE_HUES = [
  { value: 0, result: 20 },
  { value: 2_000, result: 32.5 },
  { value: 4_000, result: 43 },
  { value: 6_000, result: 54 },
  { value: 8_000, result: 72 },
  { value: 9_000, result: 85 },
  { value: 11_000, result: 140 },
  { value: 40_000, result: 300 },
  { value: 51_000, result: 360 },
];

const ADSB_HUE_LIGHTNESS = [
  { value: 0, result: 53 }, { value: 20, result: 50 }, { value: 32, result: 54 },
  { value: 40, result: 52 }, { value: 46, result: 51 }, { value: 50, result: 46 },
  { value: 60, result: 43 }, { value: 80, result: 41 }, { value: 100, result: 41 },
  { value: 120, result: 41 }, { value: 140, result: 41 }, { value: 160, result: 40 },
  { value: 180, result: 40 }, { value: 190, result: 44 }, { value: 198, result: 50 },
  { value: 200, result: 58 }, { value: 220, result: 58 }, { value: 240, result: 58 },
  { value: 255, result: 55 }, { value: 266, result: 55 }, { value: 270, result: 58 },
  { value: 280, result: 58 }, { value: 290, result: 47 }, { value: 300, result: 43 },
  { value: 310, result: 48 }, { value: 320, result: 48 }, { value: 340, result: 52 },
  { value: 360, result: 53 },
];

export function clampMapZoom(zoom: number, minZoom = MAP_MIN_ZOOM, maxZoom = MAP_MAX_ZOOM) {
  return Math.max(minZoom, Math.min(maxZoom, Math.round(zoom)));
}

export function overzoomTile(displayZoom: number, x: number, y: number, sourceMaxZoom: number) {
  const sourceZoom = Math.min(displayZoom, sourceMaxZoom);
  const scale = 2 ** (displayZoom - sourceZoom);
  return {
    zoom: sourceZoom,
    x: Math.floor(x / scale),
    y: Math.floor(y / scale),
    scale,
    offsetX: ((x % scale) + scale) % scale,
    offsetY: ((y % scale) + scale) % scale,
  };
}

export function unprojectMapPosition(x: number, y: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const rawLongitude = (x / scale) * 360 - 180;
  const longitude = ((rawLongitude + 180) % 360 + 360) % 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return { latitude: (180 / Math.PI) * Math.atan(Math.sinh(n)), longitude };
}

export function projectMapPosition(latitude: number, longitude: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const lat = Math.max(-85.0511, Math.min(85.0511, latitude));
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export function zoomMapAroundPoint(center: MapCenter, fromZoom: number, toZoom: number, offsetX: number, offsetY: number) {
  const sourceCenter = projectMapPosition(center.latitude, center.longitude, fromZoom);
  const zoomScale = 2 ** (toZoom - fromZoom);
  return unprojectMapPosition(
    (sourceCenter.x + offsetX) * zoomScale - offsetX,
    (sourceCenter.y + offsetY) * zoomScale - offsetY,
    toZoom,
  );
}

export function adsbAltitudeColor(altitude: number | null | undefined, onGround = false) {
  if (onGround) return "hsl(220 0% 30%)";
  if (altitude == null || !Number.isFinite(altitude)) return "hsl(0 0% 75%)";
  const hue = interpolateStops(altitude, ADSB_ALTITUDE_HUES);
  const lightness = interpolateStops(hue, ADSB_HUE_LIGHTNESS);
  return `hsl(${formatColourNumber(hue)} 88% ${formatColourNumber(lightness)}%)`;
}

function interpolateStops(value: number, stops: Array<{ value: number; result: number }>) {
  if (value <= stops[0].value) return stops[0].result;
  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const next = stops[index];
    if (value <= next.value) {
      const progress = (value - previous.value) / (next.value - previous.value);
      return previous.result + (next.result - previous.result) * progress;
    }
  }
  return stops[stops.length - 1]?.result || 0;
}

function formatColourNumber(value: number) {
  return Number(value.toFixed(2));
}
