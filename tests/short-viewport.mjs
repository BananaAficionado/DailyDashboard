import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9334;
const baseUrl = process.argv[2] || "http://127.0.0.1:1420/?mock=1&layoutFresh=1280x400";

const userDataDir = await mkdtemp(join(tmpdir(), "daily-dashboard-short-"));
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
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 400,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send("Page.navigate", { url: baseUrl });
  await delay(900);

  await assertEval(cdp, "window.innerWidth === 1280 && window.innerHeight === 400", "browser viewport should be 1280 x 400");
  await assertEval(cdp, "!document.querySelector('.setup-backdrop')", "mock mode should open directly to the dashboard");
  await assertEval(cdp, "(() => { const grid = document.querySelector('.dashboard-grid'); const rect = grid.getBoundingClientRect(); return rect.top === 0 && rect.bottom <= 400 && grid.scrollHeight <= grid.clientHeight + 2; })()", "dashboard grid should fit inside a 400px tall viewport without page-level cropping");
  await assertEval(cdp, "(() => [...document.querySelectorAll('.widget-slot')].every((node) => { const rect = node.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= 400 && rect.height >= 190; }))()", "all widget frames should remain visible at 1280 x 400");
  await assertEval(cdp, "(() => [...document.querySelectorAll('.spotify-header,.weather-header,.topbar')].every((node) => { const rect = node.getBoundingClientRect(); const parent = node.closest('.widget-slot')?.getBoundingClientRect() || document.body.getBoundingClientRect(); return rect.top >= parent.top && rect.bottom <= parent.bottom; }))()", "widget headers should not be cropped by short-height layout");
  await assertEval(cdp, "(() => [...document.querySelectorAll('.rail-button')].every((node) => { const rect = node.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= 400; }))()", "rail controls should stay visible at 400px tall");
  await cdp.send("Runtime.evaluate", {
    expression: "document.querySelector('.rail-arrange').click()",
    awaitPromise: true,
  });
  await delay(150);
  await assertEval(cdp, selfDragExpression("wide"), "dragging a 2/3 widget over itself should not flash a 2/3 or 1/3 resize preview");
  await cdp.send("Runtime.evaluate", {
    expression: "document.querySelector('.rail-button[title=\"Spotify\"].active')?.click()",
    awaitPromise: true,
  });
  await delay(250);
  await cdp.send("Runtime.evaluate", {
    expression: "document.querySelector('.rail-button[title=\"Weather\"].active')?.click()",
    awaitPromise: true,
  });
  await delay(350);
  await assertEval(cdp, "document.querySelector('.widget-slot')?.classList.contains('widget-size-full')", "calendar expands to 3/3 width before the full-width self-drag check");
  await assertEval(cdp, selfDragExpression("full"), "dragging a 3/3 widget over itself should not flash a 2/3 or 1/3 resize preview");

  await cdp.send("Runtime.evaluate", {
    expression: "document.querySelector('.rail-settings').click()",
    awaitPromise: true,
  });
  await delay(200);
  await assertEval(cdp, "(() => { const panel = document.querySelector('.setup-panel'); const rect = panel.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= 400 && rect.height <= 400; })()", "settings panel should fit inside a 1280 x 400 viewport");

  console.log("Short viewport smoke test passed at 1280x400");
  await cdp.close();
} finally {
  chrome.kill("SIGTERM");
}

async function assertEval(cdp, expression, message) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (!result.result.result.value) {
    throw new Error(message);
  }
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
    close() {
      ws.close();
    },
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

function selfDragExpression(expectedSize) {
  return `(() => {
    const slot = document.querySelector('.widget-slot.widget-size-${expectedSize}');
    const handle = slot?.querySelector('.drag-handle');
    if (!slot || !handle) return false;
    const rect = slot.getBoundingClientRect();
    const pointer = {
      bubbles: true,
      cancelable: true,
      pointerId: 11,
      pointerType: 'mouse',
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    handle.dispatchEvent(new PointerEvent('pointerdown', pointer));
    handle.dispatchEvent(new PointerEvent('pointermove', pointer));
    const ok = !document.querySelector('.grid-drop-zone') &&
      !document.querySelector('.split-drop-indicator') &&
      !document.querySelector('.bump-drop-indicator') &&
      !document.body.textContent.includes('2/3 width') &&
      !document.body.textContent.includes('1/3 width');
    handle.dispatchEvent(new PointerEvent('pointerup', pointer));
    return ok;
  })()`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
