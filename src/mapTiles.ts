export const MAP_MIN_ZOOM = 2;
export const MAP_MAX_ZOOM = 19;

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
