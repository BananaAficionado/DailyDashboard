import { cleanupTestBrowser } from "./browser-cleanup.mjs";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const appUrl = (process.argv[2] || "http://127.0.0.1:1420").replace(/\/$/, "");
const output = process.env.UI_REVIEW_OUTPUT || "/tmp/daily-dashboard-review";
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "dashboard-design-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=9444", `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });
try {
  await waitForHttp("http://127.0.0.1:9444/json/version");
  const target = await (await fetch("http://127.0.0.1:9444/json/new?about:blank", { method: "PUT" })).json();
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  const matrix = [[1280,480,100], [1920,600,100], [1920,600,150], [1920,600,200],
    [2560,800,100], [2560,800,125], [2560,800,150], [2560,800,175], [2560,800,200],
    [2048,640,100,1.25], [1707,533,100,1.5], [1463,457,100,1.75], [1280,400,100,2]];
  for (const [width,height,scale,dpr = 1] of matrix) {
    const label = `${width}x${height}-${scale}${dpr !== 1 ? `-dpr${dpr}` : ""}`;
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
    await cdp.send("Page.navigate", { url: `${appUrl}/?mock=1&scale=${scale}&designReview=${label}` });
    await delay(650);
    await assertEval(cdp, `document.querySelector('.app-scale-${scale}') !== null`, `${label}: scale applied`);
    await assertEval(cdp, `(() => {
      const shell = document.querySelector('.app-shell').getBoundingClientRect();
      return Math.abs(shell.width - innerWidth) < 2 && Math.abs(shell.height - innerHeight) < 2 && document.documentElement.scrollWidth <= innerWidth;
    })()`, `${label}: dashboard fits viewport`);
    await assertEval(cdp, `(() => {
      const headers = [...document.querySelectorAll('.topbar, .spotify-header, .weather-header')];
      return headers.every(header => {
        const bounds = header.getBoundingClientRect();
        const controls = [...header.querySelectorAll('button')].filter(node => node.getClientRects().length);
        return controls.every(button => {
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
        });
      }) && (() => {
        const rows = [...document.querySelectorAll('.spotify-panel .track-copy, .spotify-panel .scrubber, .spotify-panel .time-row, .spotify-panel .player-controls')].map(node => node.getBoundingClientRect());
        return rows.every((rect, i) => rows.slice(i + 1).every(other => rect.bottom <= other.top + 1));
      })();
    })()`, `${label}: widget controls contained, music controls do not overlap`);
    await screenshot(`${label}-dashboard`);
    await assertEval(cdp, `(() => [...document.querySelectorAll('.day-column')].every(column => {
      const events = [...column.querySelectorAll('.timed-event')].map(node => node.getBoundingClientRect());
      return events.every((rect, index) => events.slice(index + 1).every(other => rect.right <= other.left + 1 || other.right <= rect.left + 1 || rect.bottom <= other.top + 1 || other.bottom <= rect.top + 1));
    }))()`, `${label}: simultaneous meetings do not overlap`);
    await click(cdp, '.timed-event');
    await assertEval(cdp, `(() => {
      const dialog = document.querySelector('.calendar-event-dialog');
      const d = dialog?.getBoundingClientRect();
      const c = document.querySelector('.calendar-card').getBoundingClientRect();
      return d && d.left >= c.left && d.right <= c.right + 1 && d.top >= c.top && d.bottom <= c.bottom + 1 && dialog.scrollWidth <= dialog.clientWidth + 1;
    })()`, `${label}: meeting details fit calendar`);
    await screenshot(`${label}-meeting-details`);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await assertEval(cdp, `!document.querySelector('.calendar-event-dialog')`, `${label}: Escape closes event details`);

    await click(cdp, '.rail-settings');
    const nav = await evaluate(cdp, `[...document.querySelectorAll('.settings-nav button')].map(node => node.getAttribute('aria-controls'))`);
    const original = await evaluate(cdp, `JSON.stringify(document.querySelector('.setup-panel').getBoundingClientRect().toJSON())`);
    for (const section of nav) {
      await click(cdp, `.settings-nav button[aria-controls="${section}"]`);
      await assertEval(cdp, `(() => {
        const panel = document.querySelector('.setup-panel');
        const bounds = panel.getBoundingClientRect();
        const content = panel.querySelector('.settings-content');
        const visible = [...content.children].filter(node => node.tagName === 'SECTION' && getComputedStyle(node).display !== 'none');
        const save = panel.querySelector('.settings-save');
        const rect = save.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight &&
          visible.length === 1 && visible[0].id === '${section}' && content.scrollWidth <= content.clientWidth + 1 &&
          (hit === save || save.contains(hit)) && JSON.stringify(bounds.toJSON()) === ${JSON.stringify(original)};
      })()`, `${label}: ${section} fits, actions accessible, frame stable`);
      await screenshot(`${label}-${section}`);
    }
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await assertEval(cdp, `!document.querySelector('.setup-panel')`, `${label}: Escape closes settings`);
    await click(cdp, '.rail-settings');
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", modifiers: 8 });
    await assertEval(cdp, `document.activeElement.classList.contains('settings-save')`, `${label}: focus trapped inside dialog`);
    await click(cdp, '.settings-save');
    await delay(100);
    await assertEval(cdp, `document.querySelector('.settings-footer').textContent.includes('Settings saved')`, `${label}: save confirmation`);
    await click(cdp, '.settings-close-button');
    if (width === 1280 && height === 480) {
      await click(cdp, '.topbar .icon-button[title="Search"]');
      await cdp.send('Input.insertText', { text: 'Project' });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' });
      await assertEval(cdp, `document.querySelector('.segmented .selected').textContent === 'Day' && [...document.querySelectorAll('.timed-event strong')].some(node => node.textContent === 'Project Sync')`, 'calendar search navigates to a matching meeting');
      await click(cdp, '.volume-control .icon-button');
      await assertEval(cdp, `Boolean(document.querySelector('.volume-slider'))`, 'music volume control opens');
      await click(cdp, '.rail-settings');
      await click(cdp, '.settings-nav button[aria-controls="settings-calendar"]');
      await evaluate(cdp, `document.querySelector('#settings-calendar input').focus(); document.querySelector('#settings-calendar input').select()`);
      await cdp.send('Input.insertText', { text: 'team-calendar' });
      await click(cdp, '.settings-nav button[aria-controls="settings-layout"]');
      await click(cdp, '.widget-order button:last-child');
      await click(cdp, '.settings-nav button[aria-controls="settings-calendar"]');
      await assertEval(cdp, `document.querySelector('#settings-calendar input').value === 'team-calendar'`, 'immediate widget saves preserve unsaved connection settings');
      await click(cdp, '.settings-save');
      await click(cdp, '.settings-close-button');
      await click(cdp, '.rail-settings');
      await click(cdp, '.settings-nav button[aria-controls="settings-calendar"]');
      await assertEval(cdp, `document.querySelector('#settings-calendar input').value === 'team-calendar'`, 'connection edits persist after saving and reopening');
      await click(cdp, '.settings-close-button');
    }
    for (const [widget, title] of [['terminal', 'Terminal'], ['aircraft', 'Live aircraft']]) {
      await cdp.send('Page.navigate', { url: `${appUrl}/?mock=1&empty=1&scale=${scale}` });
      await delay(350);
      if (widget === 'terminal') {
        await screenshot(`${label}-idle`);
        await click(cdp, '.empty-dashboard-action');
        await assertEval(cdp, `document.querySelector('.app-shell').classList.contains('rail-peek-open') && document.activeElement.classList.contains('rail-button')`, `${label}: empty state reveals and focuses widget controls`);
      }
      await click(cdp, `.rail-button[title="${title}"]`);
      await assertEval(cdp, `(() => {
        const slot = document.querySelector('[data-widget="${widget}"]');
        const rect = slot?.getBoundingClientRect();
        return rect && rect.width > innerWidth * .9 && rect.bottom <= innerHeight + 1 && slot.scrollWidth <= slot.clientWidth + 1;
      })()`, `${label}: ${widget} fills the available space`);
      await screenshot(`${label}-${widget}`);
    }
    console.log(`PASS ${label}: dashboard, meetings, ${nav.length} settings sections, keyboard, save, terminal and aircraft`);
  }
  await cdp.close();
  async function screenshot(name) {
    const result = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(output, `${name}.png`), Buffer.from(result.result.data, "base64"));
  }
} finally { await cleanupTestBrowser(chrome, profile); }

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
  if (!await evaluate(cdp, expression)) {
    const details = await evaluate(cdp, `JSON.stringify([...document.querySelectorAll('[data-widget], .topbar, .spotify-header, .weather-header, .track-copy, .scrubber, .time-row, .player-controls')].map(node => ({class:node.className, rect:node.getBoundingClientRect().toJSON(), scroll:[node.clientWidth,node.scrollWidth,node.clientHeight,node.scrollHeight], buttons:[...node.querySelectorAll('button')].map(button=>({name:button.title||button.textContent,rect:button.getBoundingClientRect().toJSON()}))})))`);
    console.error(details);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(output, 'failure.png'), Buffer.from(shot.result.data, 'base64'));
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
