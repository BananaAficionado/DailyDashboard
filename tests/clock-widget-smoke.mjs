import { cleanupTestBrowser } from "./browser-cleanup.mjs";
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
    await waitForEval(cdp, "Boolean(document.querySelector('[data-widget=clock]'))", 3000);
    await assertEval(cdp, `innerWidth === ${width} && innerHeight === ${height}`, `${size}: viewport is exactly ${width}x${height}`);
    await assertEval(cdp, `document.querySelector('[data-widget="clock"]')?.classList.contains('widget-size-${size}')`, `${size}: dashboard assigns the requested clock size`);
    await assertEval(cdp, `document.querySelector('.clock-widget')?.classList.contains('clock-widget-${size}')`, `${size}: clock renders its matching responsive mode`);
    const containment = await evaluate(cdp, `(() => {
      const widget = document.querySelector('.clock-widget');
      const body = document.querySelector('.clock-widget-body');
      const face = document.querySelector('.analog-clock, .digital-clock');
      if (!widget || !body || !face) return { pass: false, missing: true };
      const w = widget.getBoundingClientRect(), b = body.getBoundingClientRect(), f = face.getBoundingClientRect();
      const pass = widget.scrollWidth <= widget.clientWidth + 1 && widget.scrollHeight <= widget.clientHeight + 1 &&
        b.left >= w.left - 1 && b.right <= w.right + 1 && b.top >= w.top - 1 && b.bottom <= w.bottom + 1 &&
        f.left >= b.left - 1 && f.right <= b.right + 1 && f.top >= b.top - 1 && f.bottom <= b.bottom + 1 &&
        (!face.classList.contains('digital-clock') || (face.scrollWidth <= face.clientWidth + 1 && face.scrollHeight <= face.clientHeight + 1));
      return { pass, widget: [widget.clientWidth, widget.scrollWidth, widget.clientHeight, widget.scrollHeight], body: [b.left, b.right, b.top, b.bottom], widgetRect: [w.left, w.right, w.top, w.bottom], face: [f.left, f.right, f.top, f.bottom], faceScroll: [face.clientWidth, face.scrollWidth, face.clientHeight, face.scrollHeight] };
    })()`);
    if (!containment.pass) throw new Error(`${size}: clock content is contained without clipping or scrolling ${JSON.stringify(containment)}`);

    const analogExpected = size === "half" || size === "tall";
    const agendaExpected = size !== "tall";
    await assertEval(cdp, `Boolean(document.querySelector('.analog-clock')) === ${analogExpected}`, `${size}: uses the expected analog/digital presentation`);
    await assertEval(cdp, `Boolean(document.querySelector('.clock-agenda')) === ${agendaExpected}`, `${size}: uses the expected agenda presentation`);
    if (agendaExpected) {
      await assertEval(cdp, "document.querySelectorAll('.clock-agenda-item').length > 0", `${size}: today's mock reminders are visible`);
      const faceWidthBeforeDetails = await evaluate(cdp, "document.querySelector('.analog-clock-wrap, .digital-clock').getBoundingClientRect().width");
      await click(cdp, ".clock-agenda-item");
      await delay(100);
      const detailGeometry = await evaluate(cdp, `(() => {
        const body = document.querySelector('.clock-widget-body');
        const pane = document.querySelector('.clock-side-pane');
        const details = document.querySelector('.clock-agenda-details[role=dialog]');
        const face = document.querySelector('.analog-clock-wrap, .digital-clock');
        if (!body || !pane || !details || !face || !body.classList.contains('details-open')) return { pass: false, missing: true, bodyClass: body?.className };
        const b = body.getBoundingClientRect(), p = pane.getBoundingClientRect(), d = details.getBoundingClientRect();
        const durations = getComputedStyle(body).transitionDuration.split(',').map(value => parseFloat(value));
        const pass = Math.max(...durations) === 0 && face.getBoundingClientRect().width <= ${faceWidthBeforeDetails} + 1 &&
          p.left >= b.left - 1 && p.right <= b.right + 1 && Math.abs(d.width - p.width) <= 1 && d.top >= p.top - 1 && d.bottom <= p.bottom + 1;
        return { pass, duration: durations, faceWidth: face.getBoundingClientRect().width, before: ${faceWidthBeforeDetails}, body: [b.left,b.right,b.top,b.bottom], pane: [p.left,p.right,p.top,p.bottom], details: [d.left,d.right,d.top,d.bottom] };
      })()`);
      if (!detailGeometry.pass) throw new Error(`${size}: details remain contained while clock space updates without layout animation ${JSON.stringify(detailGeometry)}`);
      await click(cdp, ".clock-agenda-details .icon-button");
    }

    if (size === "half" && analogExpected) {
      await assertEval(cdp, `(() => {
        const clock = document.querySelector('.analog-clock');
        const wrap = document.querySelector('.analog-clock-wrap');
        const c = clock.getBoundingClientRect(), w = wrap.getBoundingClientRect();
        return [...document.querySelectorAll('.clock-number')].every(number => getComputedStyle(number).display === 'none') &&
          c.width >= Math.min(w.width, w.height) * .68;
      })()`, "half: analog numerals are removed and the face uses the available compact space");
    }

    await click(cdp, analogExpected ? '.clock-face-toggle button[title="Digital clock"]' : '.clock-face-toggle button[title="Analog clock"]');
    await assertEval(cdp, `Boolean(document.querySelector('${analogExpected ? ".digital-clock" : ".analog-clock"}'))`, `${size}: the user can switch clock faces`);
    await click(cdp, analogExpected ? '.clock-face-toggle button[title="Analog clock"]' : '.clock-face-toggle button[title="Digital clock"]');

    await click(cdp, ".clock-zone-button");
    await assertEval(cdp, `(() => {
      const widget = document.querySelector('.clock-widget').getBoundingClientRect();
      const popover = document.querySelector('.clock-zone-popover').getBoundingClientRect();
      const options = document.querySelector('.clock-zone-options');
      return popover.top >= widget.top && popover.bottom <= widget.bottom + 1 &&
        options.getBoundingClientRect().bottom <= popover.bottom + 1 && options.scrollHeight > options.clientHeight;
    })()`, `${size}: timezone selector is a contained, scrollable in-app menu`);
    const optionBounds = await evaluate(cdp, `(() => { const rect = document.querySelector('.clock-zone-options').getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: optionBounds.x, y: optionBounds.y });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: optionBounds.x, y: optionBounds.y, deltaX: 0, deltaY: 180 });
    await delay(100);
    await assertEval(cdp, "document.querySelector('.clock-zone-options').scrollTop > 0", `${size}: mouse wheel scrolls the timezone choices`);
    await click(cdp, '.clock-zone-options button:nth-child(13)');
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
  await cleanupTestBrowser(chrome, userDataDir);
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

async function waitForEval(cdp, expression, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(cdp, expression)) return;
    await delay(60);
  }
  throw new Error(`Timed out waiting for page condition: ${expression}`);
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
