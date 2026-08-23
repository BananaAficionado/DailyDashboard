import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const width = Number(process.argv[2] || 1280);
const height = Number(process.argv[3] || 480);
const scale = Number(process.argv[4] || 100);
const appPort = Number(process.argv[5] || 4173);
const debugPort = 9200 + (width === 1920 ? 300 : 0) + scale;
const baseUrl = `http://127.0.0.1:${appPort}/?mock=1&calendarTall=1&scale=${scale}&responsiveSmoke=${width}x${height}`;
const userDataDir = await mkdtemp(join(tmpdir(), "daily-dashboard-responsive-"));
const chrome = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`, "about:blank",
], { stdio: "ignore" });

try {
  await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${baseUrl}`, { method: "PUT" })).json();
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: baseUrl });
  await delay(700);

  await assertEval(cdp, `innerWidth === ${width} && innerHeight === ${height}`, `viewport is exactly ${width}x${height}`);
  await assertEval(cdp, `document.querySelector('.app-shell')?.classList.contains('app-scale-${scale}')`, `application scale is ${scale}%`);
  await assertEval(cdp, "!document.querySelector('.rail-button[title=\"Codex\"]')", "Codex rail control is excluded by the release flag");

  await click(cdp, ".weather-rain-history-toggle");
  await assertEval(cdp, "document.querySelector('.weather-rain-history-toggle')?.textContent.trim() === 'Rain 1h' && Boolean(document.querySelector('.rain-history-1h'))", "rain history opens at one hour");
  await click(cdp, ".weather-rain-history-toggle");
  await assertEval(cdp, "document.querySelector('.weather-rain-history-toggle')?.textContent.trim() === 'Rain 24h' && document.querySelectorAll('.rain-history-24h .rain-history-column').length === 24", "rain history switches to 24 hours");
  await click(cdp, ".weather-rain-history-toggle");
  await assertEval(cdp, "document.querySelector('.weather-rain-history-toggle')?.textContent.trim() === 'Rain History' && !document.querySelector('.rain-history-page')", "rain history returns to forecast");

  await click(cdp, ".rail-settings");
  await assertEval(cdp, "![...document.querySelectorAll('.provider-panel strong')].some(node => node.textContent.trim() === 'Codex') && ![...document.querySelectorAll('.widget-order button')].some(node => node.textContent.trim() === 'Codex')", "Codex settings and layout controls are excluded");
  await click(cdp, ".setup-panel header button[title='Close']");

  const calendarMetrics = await evaluate(cdp, `(() => {
    const panel = document.querySelector('[data-widget="calendar"] .calendar-panel');
    const bar = panel?.querySelector('.topbar');
    const bounds = bar?.getBoundingClientRect();
    const time = bar?.querySelector('.current-time')?.getBoundingClientRect();
    return { panelClass: panel?.className, width: bounds?.width, controls: [...(bar?.querySelectorAll('button') || [])].map(button => { const rect = button.getBoundingClientRect(); return { name: button.title || button.textContent.trim(), left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width), barRight: Math.round(bounds.right) }; }), time: time ? { left: Math.round(time.left), right: Math.round(time.right), top: Math.round(time.top), bottom: Math.round(time.bottom), width: Math.round(time.width) } : null };
  })()`);
  console.log(`Calendar compact metrics: ${JSON.stringify(calendarMetrics)}`);

  await assertEval(cdp, `(() => {
    const panel = document.querySelector('[data-widget="calendar"] .calendar-panel');
    const bar = panel?.querySelector('.topbar');
    if (!panel?.classList.contains('calendar-widget-size-tall') || !bar) return false;
    const bounds = bar.getBoundingClientRect();
    const required = ['Today', 'Previous', 'Next', 'Search', 'Day', 'Week', 'Hide Calendar'];
    const buttons = [...bar.querySelectorAll('button')].filter(button => required.includes(button.title || button.textContent.trim()));
    const time = bar.querySelector('.current-time')?.getBoundingClientRect();
    const occupied = [...buttons.map(button => button.getBoundingClientRect()), time].filter(Boolean);
    const overlapFree = occupied.every((rect, index) => occupied.slice(index + 1).every(other => rect.right <= other.left + 1 || other.right <= rect.left + 1 || rect.bottom <= other.top + 1 || other.bottom <= rect.top + 1));
    return buttons.length === required.length && overlapFree && buttons.every(button => {
      const rect = button.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return rect.width > 0 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && (top === button || button.contains(top));
    }) && time?.width > 0 && time.right <= bounds.right + 1;
  })()`, "one-column calendar retains visible, unobstructed navigation, time, search, and Day/Week controls");

  await assertEval(cdp, "getComputedStyle(document.querySelector('[data-widget=\"calendar\"] .calendar-source-sidebar')).position === 'absolute' && document.querySelector('[data-widget=\"calendar\"] .calendar-card').classList.contains('sources-collapsed')", "one-column calendar source selector collapses into an overlay");
  await click(cdp, "[data-widget='calendar'] .source-panel-toggle");
  await assertEval(cdp, "document.querySelector('[data-widget=\"calendar\"] .source-panel-content') && document.querySelector('[data-widget=\"calendar\"] .calendar-source-sidebar').getBoundingClientRect().width > 100", "calendar source overlay can still be opened");

  await cdp.send("Page.navigate", { url: `${baseUrl}&empty=1` });
  await delay(400);
  await assertEval(cdp, `(() => { const grid = document.querySelector('.dashboard-grid'); const idle = document.querySelector('.empty-dashboard'); if (!grid || !idle) return false; const g = grid.getBoundingClientRect(); const i = idle.getBoundingClientRect(); return grid.scrollHeight <= grid.clientHeight + 1 && grid.scrollWidth <= grid.clientWidth + 1 && i.width <= g.width + 1 && i.height <= g.height + 1 && i.left >= g.left - 1 && i.top >= g.top - 1; })()`, "no-widgets screen remains fitted without scrolling");
  await assertEval(cdp, "Number(getComputedStyle(document.querySelector('.idle-background-picker')).opacity) === 1", "idle background selector initially remains visible for the rail hide interval");
  await delay(3100);
  await assertEval(cdp, "Number(getComputedStyle(document.querySelector('.idle-background-picker')).opacity) === 0", "idle background selector hides after the rail hide interval");
  await click(cdp, ".idle-background-picker button[title='Fish pond']");
  await assertEval(cdp, "['Orange roughy','Blue cod','Snapper','Sea perch','Gemfish'].every(species => document.querySelector(`.pixel-fish[aria-label='${species}']`)) && new Set([...document.querySelectorAll('.pixel-fish')].map(fish => fish.getAttribute('class'))).size >= 5", "pixel fish pond contains five distinct requested species");
  await evaluate(cdp, `(() => { const pond = document.querySelector('.pixel-fish-pond'); const bounds = pond.getBoundingClientRect(); pond.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: bounds.left + bounds.width * .62, clientY: bounds.top + bounds.height * .42 })); })()`);
  await delay(350);
  await assertEval(cdp, "new Set([...document.querySelectorAll('.pixel-fish-lane')].map(fish => fish.style.transform)).size === 9 && [...document.querySelectorAll('.pixel-fish-lane')].every(fish => ['seeking-cursor','circling-cursor'].includes(fish.dataset.behaviour))", "each fish independently steers toward or circles the cursor");
  await evaluate(cdp, `(() => { const pond = document.querySelector('.pixel-fish-pond'); const bounds = pond.getBoundingClientRect(); const fish = document.querySelector('.pixel-fish-lane').getBoundingClientRect(); pond.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, clientX: Math.min(bounds.right - 30, fish.right + 90), clientY: Math.min(bounds.bottom - 30, fish.top + fish.height / 2) })); })()`);
  await delay(80);
  await assertEval(cdp, "document.querySelectorAll('.pixel-fish-food i').length === 7 && [...document.querySelectorAll('.pixel-fish-lane')].some(fish => fish.dataset.behaviour === 'seeking-food')", "fish food is placed and takes priority over the cursor");
  await delay(3200);
  await assertEval(cdp, "document.querySelectorAll('.pixel-fish-food').length === 0", "a fish reaches and eats the food");
  await evaluate(cdp, "document.querySelector('.pixel-fish-pond').dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: null }))");
  await delay(120);
  await assertEval(cdp, "[...document.querySelectorAll('.pixel-fish-lane')].every(fish => fish.dataset.behaviour === 'wandering')", "fish gently return to autonomous swimming when the cursor leaves");
  await click(cdp, ".idle-background-picker button[title='Stars']");
  await assertEval(cdp, "document.querySelectorAll('.background-star').length >= 250 && document.querySelectorAll('.constellation-line').length > 0 && document.querySelector('.night-sky')?.getAttribute('aria-label').includes('Melbourne')", "night sky renders a location-aware star field and projected constellations");
  await evaluate(cdp, "document.querySelector('.constellation-hit-line')?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))");
  await delay(80);
  await assertEval(cdp, "Boolean(document.querySelector('.constellation-popup')) && Number.parseFloat(getComputedStyle(document.querySelector('.constellation-hit-line')).strokeWidth) >= 18 && document.querySelectorAll('.constellation-hit-star').length > 0", "the enlarged constellation hover region opens its information popup");
  await click(cdp, ".idle-background-picker button[title='Topographic']");
  await assertEval(cdp, "document.querySelector('.idle-topographic-map .interactive-map')?.dataset.zoom === '12' && Boolean(document.querySelector('.idle-topographic-map .map-controls')) && !document.querySelector('.idle-topographic-map .map-attribution')", "topographic background is closer, interactive, and source labels are hidden");
  const terrainStart = await evaluate(cdp, "document.querySelector('.idle-topographic-map .interactive-map')?.dataset.centerLatitude + ',' + document.querySelector('.idle-topographic-map .interactive-map')?.dataset.centerLongitude");
  await delay(1800);
  await assertEval(cdp, `document.querySelector('.idle-topographic-map .interactive-map')?.dataset.centerLatitude + ',' + document.querySelector('.idle-topographic-map .interactive-map')?.dataset.centerLongitude !== ${JSON.stringify(terrainStart)} && Boolean(document.querySelector('.idle-topographic-map')?.dataset.tourFeature)`, "topographic background gently tours terrain waypoints");
  await click(cdp, ".idle-background-picker button[title='Slideshow']");
  await assertEval(cdp, "document.querySelector('.idle-slideshow-message')?.textContent.includes('Please select an album folder from the settings menu') && document.querySelector('.empty-dashboard-content')?.classList.contains('is-hidden')", "slideshow gives the required folder guidance without overlapping no-widget text");

  console.log(`Responsive widget smoke test passed at ${width}x${height} / ${scale}%`);
  await cdp.close();
} finally {
  chrome.kill("SIGTERM");
}

async function click(cdp, selector) {
  await assertEval(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`, `missing ${selector}`);
  await cdp.send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(selector)}).click()`, awaitPromise: true });
  await delay(80);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return result.result.result.value;
}

async function assertEval(cdp, expression, message) {
  if (!await evaluate(cdp, expression)) throw new Error(message);
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
      const { resolve, reject } = callbacks.get(message.id);
      callbacks.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message);
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
    try { if ((await fetch(url)).ok) return; } catch {}
    await delay(120);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
