import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const width = Number(process.argv[2] || 1280);
const height = Number(process.argv[3] || 480);
const scale = Number(process.argv[4] || 100);
const appPort = Number(process.argv[5] || 4173);
const debugPort = 9700 + (width === 1920 ? 300 : 0) + scale + (height === 400 ? 20 : 0);
const userDataDir = await mkdtemp(join(tmpdir(), "daily-dashboard-clock-"));
const chrome = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`, "about:blank",
], { stdio: "ignore" });

try {
  await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

  for (const size of ["half", "tall", "wide", "full"]) {
    const url = `http://127.0.0.1:${appPort}/?mock=1&clockSize=${size}&scale=${scale}&clockSmoke=${width}x${height}`;
    await cdp.send("Page.navigate", { url });
    await delay(450);
    await assertEval(cdp, `innerWidth === ${width} && innerHeight === ${height}`, `${size}: viewport is exactly ${width}x${height}`);
    await assertEval(cdp, `document.querySelector('[data-widget="clock"]')?.classList.contains('widget-size-${size}')`, `${size}: dashboard assigns the requested clock size`);
    await assertEval(cdp, `document.querySelector('.clock-widget')?.classList.contains('clock-widget-${size}')`, `${size}: clock renders its matching responsive mode`);
    await assertEval(cdp, `(() => {
      const widget = document.querySelector('.clock-widget');
      const body = document.querySelector('.clock-widget-body');
      const face = document.querySelector('.analog-clock, .digital-clock');
      if (!widget || !body || !face) return false;
      const w = widget.getBoundingClientRect(), b = body.getBoundingClientRect(), f = face.getBoundingClientRect();
      return widget.scrollWidth <= widget.clientWidth + 1 && widget.scrollHeight <= widget.clientHeight + 1 &&
        b.left >= w.left - 1 && b.right <= w.right + 1 && b.top >= w.top - 1 && b.bottom <= w.bottom + 1 &&
        f.left >= b.left - 1 && f.right <= b.right + 1 && f.top >= b.top - 1 && f.bottom <= b.bottom + 1;
    })()`, `${size}: clock content is contained without clipping or scrolling`);

    const analogExpected = size === "half" || size === "tall";
    const agendaExpected = size === "half" || size === "full";
    await assertEval(cdp, `Boolean(document.querySelector('.analog-clock')) === ${analogExpected}`, `${size}: uses the expected analog/digital presentation`);
    await assertEval(cdp, `Boolean(document.querySelector('.clock-agenda')) === ${agendaExpected}`, `${size}: uses the expected agenda presentation`);
    if (agendaExpected) await assertEval(cdp, "document.querySelectorAll('.clock-agenda-item').length > 0", `${size}: today's mock reminders are visible`);

    await click(cdp, ".clock-zone-button");
    await assertEval(cdp, "Boolean(document.querySelector('.clock-zone-popover select'))", `${size}: timezone selector opens inside the widget`);
    await evaluate(cdp, `(() => { const select = document.querySelector('.clock-zone-popover select'); select.value = 'Europe/London'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await delay(80);
    await assertEval(cdp, "document.querySelector('.clock-zone-button')?.textContent.includes('London')", `${size}: timezone selection updates immediately`);

    if (analogExpected) {
      const before = await evaluate(cdp, "document.querySelector('.second-hand').style.transform");
      await delay(220);
      const after = await evaluate(cdp, "document.querySelector('.second-hand').style.transform");
      if (before === after) throw new Error(`${size}: accurate second hand did not advance`);
    }
  }

  console.log(`Clock widget smoke test passed at ${width}x${height} / ${scale}%`);
  await cdp.close();
} finally {
  chrome.kill("SIGTERM");
}

async function click(cdp, selector) {
  await assertEval(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`, `missing ${selector}`);
  await cdp.send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(selector)}).click()`, awaitPromise: true });
  await delay(60);
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
