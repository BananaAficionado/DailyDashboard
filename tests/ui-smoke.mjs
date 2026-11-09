// Run the current UI regressions against a running development server.
import { spawn } from "node:child_process";

const baseUrl = process.argv[2] || "http://127.0.0.1:1420";
const port = new URL(baseUrl).port || "1420";
const suites = [
  ["tests/display-lock-smoke.mjs", baseUrl],
  ["tests/startup-update-smoke.mjs", baseUrl],
  ["tests/local-calendar-smoke.mjs", baseUrl],
  ["tests/weather-solar-smoke.mjs", baseUrl],
  ["tests/weather-rollover-smoke.mjs", baseUrl],
  ["tests/calendar-rollover-smoke.mjs", baseUrl],
  ["tests/widget-size-matrix.mjs", baseUrl],
  ["tests/design-review.mjs", baseUrl],
  ["tests/short-viewport.mjs", `${baseUrl}/?mock=1`],
  ["tests/responsive-widget-smoke.mjs", "1280", "480", "100", port],
  ["tests/responsive-widget-smoke.mjs", "2560", "800", "200", port],
  ["tests/clock-widget-smoke.mjs", "1280", "480", "100", port],
  ["tests/clock-widget-smoke.mjs", "1920", "600", "150", port],
  ["tests/clock-widget-smoke.mjs", "2560", "800", "200", port],
  ["tests/map-layout-smoke.mjs", "1280", "480", port],
];
for (const args of suites) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${args[0]} exited with ${code}`)));
  });
}
console.log("All UI regression suites passed.");
