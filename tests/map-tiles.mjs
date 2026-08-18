import assert from "node:assert/strict";
import { clampMapZoom, MAP_MAX_ZOOM, overzoomTile } from "../src/mapTiles.ts";

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

console.log("Map tile checks passed");
