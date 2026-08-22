import assert from "node:assert/strict";
import { adsbAltitudeColor, clampMapZoom, MAP_MAX_ZOOM, overzoomTile, projectMapPosition, unprojectMapPosition, zoomMapAroundPoint } from "../src/mapTiles.ts";

assert.equal(clampMapZoom(25), MAP_MAX_ZOOM, "base-map zoom is capped at the provider-safe maximum");
assert.equal(clampMapZoom(14.6), 15, "fractional pinch zoom snaps to the nearest tile level");

assert.deepEqual(
  overzoomTile(7, 93, 61, 7),
  { zoom: 7, x: 93, y: 61, scale: 1, offsetX: 0, offsetY: 0 },
  "radar tiles are requested directly at supported zoom levels",
);

assert.deepEqual(
  overzoomTile(12, 2990, 1967, 7),
  { zoom: 7, x: 93, y: 61, scale: 32, offsetX: 14, offsetY: 15 },
  "high-detail weather views reuse and crop the matching maximum-level radar tile",
);

const melbourneZoom = 7;
const melbourneWorldX = ((144.9631 + 180) / 360) * 256 * 2 ** melbourneZoom;
const melbourneLatitudeRadians = -37.8136 * Math.PI / 180;
const melbourneWorldY = (1 - Math.asinh(Math.tan(melbourneLatitudeRadians)) / Math.PI) / 2 * 256 * 2 ** melbourneZoom;
const pannedMelbourne = unprojectMapPosition(melbourneWorldX - 150, melbourneWorldY, melbourneZoom);
assert.ok(Math.abs(pannedMelbourne.latitude - -37.8136) < 0.0001, "horizontal panning preserves latitude");
assert.ok(pannedMelbourne.longitude > 143 && pannedMelbourne.longitude < 144, `a short Melbourne pan remains near Melbourne, not the opposite side of the globe: ${pannedMelbourne.longitude}`);

const cursorOffset = { x: 140, y: -55 };
const cursorZoomCenter = zoomMapAroundPoint({ latitude: -37.8136, longitude: 144.9631 }, 7, 8, cursorOffset.x, cursorOffset.y);
const cursorWorldBefore = projectMapPosition(-37.8136, 144.9631, 7);
const cursorWorldAfter = projectMapPosition(cursorZoomCenter.latitude, cursorZoomCenter.longitude, 8);
assert.ok(Math.abs(cursorWorldAfter.x + cursorOffset.x - (cursorWorldBefore.x + cursorOffset.x) * 2) < 0.0001, "wheel zoom keeps the cursor's longitude anchored");
assert.ok(Math.abs(cursorWorldAfter.y + cursorOffset.y - (cursorWorldBefore.y + cursorOffset.y) * 2) < 0.0001, "wheel zoom keeps the cursor's latitude anchored");
const centredZoom = zoomMapAroundPoint({ latitude: -37.8136, longitude: 144.9631 }, 7, 8, 0, 0);
assert.ok(Math.abs(centredZoom.latitude - -37.8136) < 0.0001 && Math.abs(centredZoom.longitude - 144.9631) < 0.0001, "button-style centred zoom preserves the map centre");

assert.equal(adsbAltitudeColor(null), "hsl(0 0% 75%)", "unknown altitude uses ADSB Exchange grey");
assert.equal(adsbAltitudeColor(0, true), "hsl(220 0% 30%)", "ground aircraft use ADSB Exchange ground grey");
assert.equal(adsbAltitudeColor(0), "hsl(20 88% 50%)", "sea-level aircraft start orange");
assert.equal(adsbAltitudeColor(11_000), "hsl(140 88% 41%)", "11,000-foot aircraft are green");
assert.equal(adsbAltitudeColor(40_000), "hsl(300 88% 43%)", "40,000-foot aircraft are magenta");
assert.equal(adsbAltitudeColor(51_000), "hsl(360 88% 53%)", "51,000-foot aircraft complete the scale in red");

console.log("Map tile checks passed");
