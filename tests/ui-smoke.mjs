import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9333;
const baseUrl = process.argv[2] || "http://127.0.0.1:1420/?mock=1";

const userDataDir = await mkdtemp(join(tmpdir(), "daily-dashboard-chrome-"));
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
  await delay(1200);

  await assertEval(cdp, "!document.querySelector('.setup-backdrop')", "mock mode should render dashboard without setup overlay");
  await assertEval(cdp, "Boolean(document.querySelector('.rail-button[title=\"Clock\"]'))", "left rail includes the new responsive clock widget");
  await assertEval(cdp, "[...document.querySelectorAll('.time-label')].map((node) => node.textContent).includes('6 PM')", "calendar default range includes 6 PM");
  await assertEval(cdp, "document.querySelector('.time-grid').getBoundingClientRect().height >= 528", "calendar default range spans 8 AM through 6 PM");
  await assertEval(cdp, "(() => { const title = [...document.querySelectorAll('.timed-event strong')].find((node) => node.textContent === 'Project Sync'); if (!title) return false; const event = title.closest('.timed-event'); const detail = event.querySelector('span'); const eventRect = event.getBoundingClientRect(); return event.classList.contains('short') && eventRect.height >= 36 && title.getBoundingClientRect().width > 34 && detail.getBoundingClientRect().width > 34; })()", "30-minute calendar meetings show readable title and detail text");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 220,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await delay(150);
  await assertEval(cdp, "(() => { const rect = document.querySelector('.rail-button.bottom').getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= window.innerHeight; })()", "settings cog remains visible at the vertical minimum");
  await assertEval(cdp, "document.querySelector('.calendar-scroll').scrollHeight > document.querySelector('.calendar-scroll').clientHeight", "calendar can scroll vertically when the window is short");
  await cdp.send("Runtime.evaluate", {
    expression: "document.querySelector('.calendar-scroll').scrollTop = 140",
    awaitPromise: true,
  });
  await delay(100);
  await assertEval(cdp, "document.querySelector('.day-header').getBoundingClientRect().bottom < document.querySelector('.topbar').getBoundingClientRect().bottom + 84", "dates scroll away with calendar content");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 400,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await delay(150);
  await assertEval(cdp, "document.querySelector('.widget-column').classList.contains('open') && Boolean(document.querySelector('.weather-panel')) && Boolean(document.querySelector('.spotify-panel'))", "widget column starts open with weather and Spotify available");
  await assertEval(cdp, "Boolean(document.querySelector('.calendar-source-sidebar')) && [...document.querySelectorAll('.source-group-toggle span')].map((node) => node.textContent).includes('My calendars') && [...document.querySelectorAll('.source-group-toggle span')].map((node) => node.textContent).includes('Other calendars')", "calendar source sidebar exposes My calendars and Other calendars groups");
  await assertEval(cdp, "[...document.querySelectorAll('.timed-event strong')].some((node) => node.textContent === 'Shared Team Planning')", "other calendar event is visible before filtering");
  await click(cdp, ".calendar-source-group:nth-child(2) .source-group-action");
  await delay(250);
  await assertEval(cdp, "![...document.querySelectorAll('.timed-event strong')].some((node) => node.textContent === 'Shared Team Planning')", "other calendar group can be deselected from the calendar sidebar");
  await click(cdp, ".calendar-source-group:nth-child(2) .source-group-action");
  await delay(250);
  await assertEval(cdp, "[...document.querySelectorAll('.timed-event strong')].some((node) => node.textContent === 'Shared Team Planning')", "other calendar group can be reselected from the calendar sidebar");
  await click(cdp, ".topbar .icon-button[title='Rearrange widgets']");
  await delay(300);
  await assertEval(cdp, "document.querySelector('.app-shell').classList.contains('rearrange-mode') && [...document.querySelectorAll('.drag-handle')].every((node) => Number(getComputedStyle(node).opacity) > 0.8)", "rearrange button enables visible widget drag handles");
  await assertEval(cdp, "(() => { const slots = document.querySelectorAll('.widget-slot'); const source = slots[0].querySelector('.drag-handle'); const target = slots[1]; const dt = new DataTransfer(); source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt })); source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); return dt.getData('text/plain') === 'spotify'; })()", "widget drag operation sets a transferable move payload");
  await delay(250);
  await assertEval(cdp, "document.querySelector('.widget-slot:first-child .weather-panel') !== null", "dragging widgets in rearrange mode changes widget order");
  await click(cdp, ".topbar .icon-button[title='Rearrange widgets']");
  await delay(150);
  await click(cdp, ".rail-button:nth-child(2)");
  await delay(250);
  await assertEval(cdp, "!document.querySelector('.spotify-panel') && Boolean(document.querySelector('.weather-panel'))", "music rail button hides Spotify panel");
  await click(cdp, ".rail-button:nth-child(2)");
  await delay(250);
  await assertEval(cdp, "Boolean(document.querySelector('.spotify-panel'))", "music rail button shows Spotify panel again");
  await assertEval(cdp, layoutFitsWithSpotifyExpression(), "calendar stays within its grid column when Spotify is open");
  await assertEval(cdp, "[...document.querySelectorAll('.track-copy strong')].some(node => node.textContent === 'Mock Dashboard Track')", "Spotify panel renders song metadata");
  await assertEval(cdp, "document.querySelector('.weather-main strong').textContent.includes('18')", "weather widget renders current temperature");
  await assertEval(cdp, "document.querySelector('.weather-header .icon-button[title=\"Hide Weather\"] svg') !== null", "weather widget has a close control");
  await click(cdp, ".weather-header .icon-button[title='Hide Weather']");
  await delay(250);
  await assertEval(cdp, "!document.querySelector('.weather-panel') && Boolean(document.querySelector('.spotify-panel'))", "weather close control hides only weather");
  await click(cdp, ".rail-button[title='Weather']");
  await delay(250);
  await click(cdp, ".forecast-controls button[title='Next forecast day']");
  await delay(150);
  await assertEval(cdp, "!document.querySelector('.forecast-controls button[title=\"Previous forecast day\"]').disabled", "weather forecast can navigate to the next day");
  await click(cdp, ".forecast-controls button:last-child");
  await delay(150);
  await assertEval(cdp, "document.querySelectorAll('.five-day-forecast .forecast-day').length === 5", "weather forecast can show the next five days");
  await assertEval(cdp, "document.querySelector('.spotify-header .icon-button[title=\"Hide Spotify\"] svg') !== null", "Spotify hide button is rendered in the header");
  await assertEval(cdp, "(() => { const cover = document.querySelector('.album-cover').getBoundingClientRect(); return cover.width >= 160 && cover.height >= 90; })()", "Spotify album art uses expanded space");
  await assertEval(cdp, "(() => { const play = document.querySelector('.play-button').getBoundingClientRect(); const prev = document.querySelector('.transport-controls .icon-button').getBoundingClientRect(); return Math.abs(play.width - prev.width) <= 1 && getComputedStyle(document.querySelector('.play-button')).backgroundColor !== 'rgb(245, 246, 248)'; })()", "Spotify play button is compact and not a large white circle");
  await assertEval(cdp, "(() => { const panel = document.querySelector('.spotify-panel').getBoundingClientRect(); const play = document.querySelector('.play-button').getBoundingClientRect(); return Math.abs((play.left + play.width / 2) - (panel.left + panel.width / 2)) <= 2; })()", "Spotify play button is centered in the widget");
  await assertEval(cdp, "(() => { const status = document.querySelector('.playback-status').getBoundingClientRect(); const scrubber = document.querySelector('.scrubber').getBoundingClientRect(); return status.top > scrubber.bottom && getComputedStyle(document.querySelector('.playback-status')).color === 'rgb(75, 206, 122)'; })()", "Spotify device status is centered below the scrubber in accent color");
  await click(cdp, ".volume-control .icon-button");
  await delay(100);
  await assertEval(cdp, "Boolean(document.querySelector('.volume-slider'))", "Spotify volume slider appears from the speaker control");
  await assertEval(cdp, "document.querySelector('.extra-controls.left .icon-button[title=\"Favourite\"]') !== null", "favourite button is on the left of media controls");
  await click(cdp, ".spotify-header .icon-button[title='Hide Spotify']");
  await delay(250);
  await assertEval(cdp, "!document.querySelector('.spotify-panel') && Boolean(document.querySelector('.weather-panel'))", "Spotify close control hides only Spotify");
  await click(cdp, ".rail-button:nth-child(2)");
  await delay(250);
  await click(cdp, ".weather-header .icon-button[title='Change location']");
  await delay(150);
  await assertEval(cdp, "document.querySelector('.weather-setup strong').textContent.includes('Change Weather Location')", "weather settings opens without clearing location");
  await click(cdp, ".weather-header .icon-button[title='Close weather settings']");
  await delay(150);
  await assertEval(cdp, "Boolean(document.querySelector('.weather-main'))", "weather settings can be closed back to normal state");
  await click(cdp, ".topbar .icon-button[title='Toggle side rail']");
  await delay(150);
  await assertEval(cdp, "(() => { const rail = document.querySelector('.rail').getBoundingClientRect(); const calendar = document.querySelector('.calendar-panel').getBoundingClientRect(); return document.querySelector('.app-shell').classList.contains('rail-closed') && rail.width === 0 && calendar.left < 2; })()", "hamburger closes side rail and calendar resizes into the space");
  await click(cdp, ".topbar .icon-button[title='Search']");
  await delay(150);
  await assertEval(cdp, "Boolean(document.querySelector('.calendar-search'))", "search button opens search input");
  await cdp.send("Input.insertText", { text: "Project" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await delay(250);
  await assertEval(cdp, "document.querySelector('.segmented .selected').textContent === 'Day'", "enter in calendar search switches to the matching meeting day");
  await assertEval(cdp, "[...document.querySelectorAll('.timed-event strong')].some(node => node.textContent === 'Project Sync')", "search result meeting is visible after pressing enter");
  await cdp.send("Runtime.evaluate", {
    expression: "const input = document.querySelector('.calendar-search'); input.focus(); input.setSelectionRange(0, input.value.length);",
    awaitPromise: true,
  });
  await cdp.send("Input.insertText", { text: "No matching meeting" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await delay(150);
  await assertEval(cdp, "document.querySelector('.toast.show')?.textContent.includes('No calendar matches')", "latest error appears as an animated toast");
  await delay(6400);
  await assertEval(cdp, "!document.querySelector('.toast')", "toast error clears after its timeout");
  await click(cdp, ".topbar .icon-button[title='Refresh']");
  await delay(150);
  await assertEval(cdp, "document.querySelector('.topbar .icon-button[title=\"Refresh\"]') !== null", "refresh button remains mounted after click");
  await assertEval(cdp, "document.querySelector('.topbar .icon-button[title=\"Fullscreen\"]') === null", "fullscreen button is removed from the widget topbar");

  await click(cdp, ".topbar .icon-button[title='Toggle side rail']");
  await delay(150);
  await click(cdp, ".rail-button.bottom");
  await delay(250);
  await assertEval(cdp, fitsSetupExpression(), "settings panel fits inside 1280x400 viewport");
  await assertEval(cdp, "document.querySelector('.setup-panel header .icon-button[title=\"Close\"] svg') !== null", "settings close button is visible");
  await assertEval(cdp, "document.querySelector('.settings-action-button')?.textContent.includes('Toggle Full Screen')", "settings exposes the fullscreen toggle");
  await assertEval(cdp, "document.querySelector('.layout-settings') !== null", "settings expose widget layout controls");
  await assertEval(cdp, "[...document.querySelectorAll('.setup-grid label span')].some((node) => node.textContent === 'Calendar Timezone') && Boolean(document.querySelector('.setup-grid select'))", "settings expose a selectable calendar timezone");
  await assertEval(cdp, "document.querySelector('.weather-settings-grid input[placeholder=\"City or suburb\"]') !== null && [...document.querySelectorAll('.weather-settings-actions button')].some((button) => button.textContent === 'Use Location')", "settings page exposes manual and current-location weather controls");
  await assertEval(cdp, "document.querySelector('.widget-order button:first-child').textContent.includes('Weather')", "settings widget order reflects the current dragged order");
  await click(cdp, ".widget-order button:first-child");
  await delay(150);
  await assertEval(cdp, "document.querySelector('.widget-order button:first-child').textContent.includes('Spotify')", "settings widget order button moves widgets");
  await click(cdp, ".layout-buttons button:first-child");
  await click(cdp, ".setup-panel header .icon-button[title='Close']");
  await delay(250);
  await assertEval(cdp, "document.querySelector('.app-shell').classList.contains('layout-thirds') && [...document.querySelectorAll('.layout-buttons button')].length === 2", "combined widgets layout mode can be selected from settings");
  await assertEval(cdp, "(() => { const calendar = document.querySelector('.calendar-panel').getBoundingClientRect(); const widgets = document.querySelector('.widget-column').getBoundingClientRect(); const heading = document.querySelector('.date-heading').getBoundingClientRect(); return calendar.width > widgets.width && heading.right <= calendar.right; })()", "combined widgets mode defaults to a double-wide calendar when side widgets are stacked");
  await click(cdp, ".topbar .icon-button[title='Rearrange widgets']");
  await delay(300);
  await click(cdp, ".widget-slot:first-child .drag-handle");
  await delay(150);
  await click(cdp, ".widget-slot:nth-child(2) .drop-target.top");
  await delay(250);
  await assertEval(cdp, "document.querySelector('.app-shell').classList.contains('thirds-stacked') && document.querySelector('.widget-column').getBoundingClientRect().width < document.querySelector('.calendar-panel').getBoundingClientRect().width", "top-half drop stacks widgets into a split third column");
  await click(cdp, ".topbar .icon-button[title='Rearrange widgets']");
  await delay(150);
  await click(cdp, ".rail-button.bottom");
  await delay(150);
  await click(cdp, ".layout-buttons button:nth-child(2)");
  await click(cdp, ".setup-panel header .icon-button[title='Close']");
  await delay(250);
  await click(cdp, ".rail-button[title='Weather']");
  await delay(150);
  await assertEval(cdp, "(() => { const activeWidgetButtons = [...document.querySelectorAll('.rail-button.active')].filter((button) => ['Spotify', 'Weather'].includes(button.title)); return activeWidgetButtons.length === 1 && activeWidgetButtons[0].title === 'Weather' && !document.querySelector('.spotify-panel') && Boolean(document.querySelector('.weather-panel')); })()", "focus mode highlights only the visible widget after switching widgets");
  await click(cdp, ".rail-button.bottom");
  await delay(150);
  await click(cdp, ".advanced-toggle");
  await delay(150);
  await assertEval(cdp, fitsSetupExpression(), "advanced settings panel remains viewport-bounded at 1280x400");
  await assertEval(cdp, "[...document.querySelectorAll('.rail > .rail-button svg,.topbar .icon-button svg')].every(svg => { const r = svg.getBoundingClientRect(); return r.width >= 16 && r.width <= 24 && r.height >= 16 && r.height <= 24; })", "toolbar and rail icons are consistently scaled");

  console.log("UI smoke test passed at 1280x400");
  await cdp.close();
} finally {
  chrome.kill("SIGTERM");
}

function fitsSetupExpression() {
  return `(() => {
    const panel = document.querySelector('.setup-panel');
    if (!panel) return false;
    const rect = panel.getBoundingClientRect();
    return rect.top >= 0 && rect.left >= 0 && rect.bottom <= 400 && rect.height <= 400;
  })()`;
}

function layoutFitsWithSpotifyExpression() {
  return `(() => {
    const calendar = document.querySelector('.calendar-panel').getBoundingClientRect();
    const topbar = document.querySelector('.topbar').getBoundingClientRect();
    const spotify = document.querySelector('.spotify-panel').getBoundingClientRect();
    const overflowingControls = [...document.querySelectorAll('.topbar > *')]
      .filter((node) => getComputedStyle(node).display !== 'none')
      .some((node) => node.getBoundingClientRect().right > spotify.left + 1);
    return calendar.right <= spotify.left + 1 && topbar.right <= spotify.left + 1 && !overflowingControls;
  })()`;
}

async function click(cdp, selector) {
  await assertEval(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`, `missing ${selector}`);
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(selector)}).click()`,
    awaitPromise: true,
  });
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
