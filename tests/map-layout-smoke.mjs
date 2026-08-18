import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const width = Number(process.argv[2] || 1280);
const height = Number(process.argv[3] || 480);
const port = 9341;
const baseUrl = `http://127.0.0.1:1420/?mock=1&mapSmoke=${width}x${height}`;
const userDataDir = await mkdtemp(join(tmpdir(), "daily-dashboard-maps-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  "about:blank",
], { stdio: "ignore" });

try {
  await waitForHttp(`http://127.0.0.1:${port}/json/version`);
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${baseUrl}`, { method: "PUT" })).json();
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: baseUrl });
  await delay(900);

  await assertEval(cdp, `window.innerWidth === ${width} && window.innerHeight === ${height}`, `viewport is exactly ${width}×${height}`);
  await click(cdp, ".rail-button[title='Live aircraft']");
  await delay(250);
  await click(cdp, ".weather-header button[title='Radar page']");
  await delay(900);

  await assertEval(cdp, `(() => {
    const grid = document.querySelector('.dashboard-grid');
    const gridRect = grid.getBoundingClientRect();
    const readMap = (widget, containerSelector) => {
      const slot = document.querySelector('[data-widget="' + widget + '"]');
      const container = slot?.querySelector(containerSelector);
      const map = container?.querySelector('.interactive-map');
      if (!slot || !container || !map) return false;
      const slotRect = slot.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const mapRect = map.getBoundingClientRect();
      return mapRect.height > 80 && Math.abs(mapRect.height - containerRect.height) < 1 && mapRect.top >= slotRect.top && mapRect.bottom <= slotRect.bottom;
    };
    return gridRect.bottom <= innerHeight && grid.scrollHeight <= grid.clientHeight + 2 && readMap('aircraft', '.aircraft-map-wrap') && readMap('weather', '.weather-radar-page');
  })()`, "ADS-B and radar maps fill their widget space without dashboard overflow");

  await assertEval(cdp, "document.querySelectorAll('.interactive-map.map-monochrome').length === 2 && document.querySelectorAll('.map-theme-button[title=\"Use colour map\"]').length === 2", "both maps start in matching monochrome mode");

  for (const selector of ["[data-widget='aircraft'] .interactive-map", "[data-widget='weather'] .interactive-map"]) {
    const before = await readMapView(cdp, selector);
    await dragMap(cdp, selector, 120, 40);
    const moved = await readMapView(cdp, selector);
    if (!(moved.longitude < before.longitude && moved.latitude > before.latitude && Math.abs(moved.longitude - before.longitude) < 3 && Math.abs(moved.latitude - before.latitude) < 2)) {
      throw new Error(`${selector} drag should pan smoothly in the expected direction: ${JSON.stringify({ before, moved })}`);
    }
    await dragMap(cdp, selector, -120, -40);
    const returned = await readMapView(cdp, selector);
    if (!(Math.abs(returned.longitude - before.longitude) < 0.08 && Math.abs(returned.latitude - before.latitude) < 0.08)) {
      throw new Error(`${selector} reverse drag should return close to its starting centre: ${JSON.stringify({ before, returned })}`);
    }
  }

  await cdp.send("Runtime.evaluate", { expression: "[...document.querySelectorAll('.map-theme-button')].forEach(button => button.click())", awaitPromise: true });
  await delay(100);
  await assertEval(cdp, "document.querySelectorAll('.interactive-map.map-colour').length === 2", "both maps can switch back to colour mode");

  for (let index = 0; index < 6; index += 1) {
    await cdp.send("Runtime.evaluate", {
      expression: "document.querySelector('[data-widget=\"weather\"] .map-controls button[title=\"Zoom in\"]').click()",
      awaitPromise: true,
    });
    await delay(60);
  }
  await delay(350);
  await assertEval(cdp, `(() => {
    const weather = document.querySelector('[data-widget="weather"]');
    const baseUrls = [...weather.querySelectorAll('.map-base-tile')].map(tile => tile.src);
    const radarUrls = [...weather.querySelectorAll('.radar-tile')].map(tile => getComputedStyle(tile).backgroundImage);
    const baseZooms = baseUrls.map(url => Number(url.match(/openstreetmap\\.org\\/(\\d+)\\//)?.[1]));
    const radarZooms = radarUrls.map(url => Number(url.match(/\\/256\\/(\\d+)\\//)?.[1])).filter(Number.isFinite);
    const error = weather.querySelector('.map-feed-error')?.textContent || '';
    return baseZooms.includes(13) && radarZooms.length > 0 && radarZooms.every(zoom => zoom <= 7) && !/zoom level not supported/i.test(error);
  })()`, "weather can zoom past level 7 while radar requests remain provider-safe");

  await click(cdp, ".rail-settings");
  await delay(100);
  await cdp.send("Runtime.evaluate", {
    expression: "[...document.querySelectorAll('.scale-setting button')].find(button => button.textContent.trim() === '200%').click()",
    awaitPromise: true,
  });
  await delay(80);
  await cdp.send("Runtime.evaluate", {
    expression: "[...document.querySelectorAll('.setup-panel button')].find(button => button.textContent.trim() === 'Save Settings').click()",
    awaitPromise: true,
  });
  await delay(100);
  await click(cdp, ".setup-panel header button[title='Close']");
  await delay(120);
  await assertEval(cdp, "getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--app-scale').trim() === '2'", "application is running at 200% for scaled-pointer verification");
  const scaledBefore = await readMapView(cdp, "[data-widget='aircraft'] .interactive-map");
  await dragMap(cdp, "[data-widget='aircraft'] .interactive-map", 120, 40);
  const scaledMoved = await readMapView(cdp, "[data-widget='aircraft'] .interactive-map");
  const scaledLongitudeDelta = Math.abs(scaledMoved.longitude - scaledBefore.longitude);
  if (!(scaledMoved.longitude < scaledBefore.longitude && scaledMoved.latitude > scaledBefore.latitude && scaledLongitudeDelta > 0.25 && scaledLongitudeDelta < 1.2)) {
    throw new Error(`200% ADS-B drag should account for rendered scaling: ${JSON.stringify({ scaledBefore, scaledMoved })}`);
  }
  await dragMap(cdp, "[data-widget='aircraft'] .interactive-map", -120, -40);
  const scaledReturned = await readMapView(cdp, "[data-widget='aircraft'] .interactive-map");
  if (!(Math.abs(scaledReturned.longitude - scaledBefore.longitude) < 0.08 && Math.abs(scaledReturned.latitude - scaledBefore.latitude) < 0.08)) {
    throw new Error(`200% ADS-B reverse drag should return close to its starting centre: ${JSON.stringify({ scaledBefore, scaledReturned })}`);
  }

  console.log(`Map UX smoke test passed at ${width}x${height}`);
  await cdp.close();
} finally {
  chrome.kill("SIGTERM");
}

async function click(cdp, selector) {
  await assertEval(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`, `missing ${selector}`);
  await cdp.send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(selector)}).click()`, awaitPromise: true });
}

async function readMapView(cdp, selector) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => { const map = document.querySelector(${JSON.stringify(selector)}); return { latitude: Number(map.dataset.centerLatitude), longitude: Number(map.dataset.centerLongitude), zoom: Number(map.dataset.zoom) }; })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result.result.value;
}

async function dragMap(cdp, selector, deltaX, deltaY) {
  const boundsResult = await cdp.send("Runtime.evaluate", {
    expression: `(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: rect.left + rect.width * 0.3, y: rect.top + rect.height * 0.72 }; })()`,
    returnByValue: true,
  });
  const start = boundsResult.result.result.value;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x, y: start.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left", buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 4; step += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: start.x + deltaX * step / 4,
      y: start.y + deltaY * step / 4,
      button: "left",
      buttons: 1,
    });
    await delay(35);
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: start.x + deltaX, y: start.y + deltaY, button: "left", buttons: 0, clickCount: 1 });
  await delay(120);
}

async function assertEval(cdp, expression, message) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (!result.result.result.value) throw new Error(message);
}

async function connectCdp(url) {
  const ws = new WebSocket(url);
  const callbacks = new Map();
  let id = 0;
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && callbacks.has(message.id)) {
      const callback = callbacks.get(message.id);
      callbacks.delete(message.id);
      message.error ? callback.reject(new Error(JSON.stringify(message.error))) : callback.resolve(message);
    }
  });
  return {
    send(method, params = {}) {
      const callId = ++id;
      ws.send(JSON.stringify({ id: callId, method, params }));
      return new Promise((resolve, reject) => callbacks.set(callId, { resolve, reject }));
    },
    close() { ws.close(); },
  };
}

async function waitForHttp(url) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
