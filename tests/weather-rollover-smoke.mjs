import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {access, mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extname, join, relative, resolve} from 'node:path';
import {cleanupTestBrowser} from './browser-cleanup.mjs';

// With no URL, exercise the production build under its CSP, as in CI.
let server;
let base = process.argv[2];
if (!base) {
  const dist = resolve('dist');
  await access(join(dist, 'index.html'));
  const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
  const policy = Object.entries(config.app.security.csp).map(([key, value]) => `${key} ${Array.isArray(value) ? value.join(' ') : value}`).join('; ');
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const file = resolve(dist, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (relative(dist, file).startsWith('..')) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.setHeader('Content-Security-Policy', policy);
      res.setHeader('Content-Type', ({'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml'})[extname(file)] || 'application/octet-stream');
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}
const profile = await mkdtemp(join(tmpdir(), 'dashboard-design-'));
const chrome = spawn(process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], {stdio:'ignore'});
let cdp, scriptId;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await delay(100); }
  }
  assert.ok(port, 'Chrome did not start');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method:'PUT'})).json();
  cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {width:1280,height:480,deviceScaleFactor:1,mobile:false});

  await navigate({zone:'Australia/Melbourne', host:'America/Los_Angeles', now:'2026-12-31T23:59:59+11:00'});
  assert.equal(await evaluate('window.weatherRequests'), 1, 'timezone discovery must not duplicate the initial request');
  await click('[title="Next forecast day"]'); await click('[title="Next forecast day"]');
  await evaluate(`document.querySelector('.weather-day-graph').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`);
  await waitFor(`Boolean(document.querySelector('.weather-graph-readout'))`);
  await evaluate(`window.weatherMode='hold'`);
  await advance('2027-01-01T00:00:00+11:00', 'midnight');
  await waitFor('window.weatherRequests===2');
  assert.equal(await evaluate('new Date().getDate()'), 31, 'weather must roll over before the host computer date changes');
  await checkDay('2027-01-01');
  assert.equal(await evaluate(`document.querySelector('.weather-temperature small').textContent`), 'Daytime high', 'yesterday’s current conditions must not be relabelled as fresh');
  assert.equal(await evaluate(`Boolean(document.querySelector('.weather-graph-readout'))`), false, 'old graph inspection must clear on day change');
  await evaluate(`window.weatherMode='normal';window.releaseWeather()`);
  await waitFor(`document.querySelector('.weather-temperature small')?.textContent==='Current conditions'`);
  assert.equal(await evaluate(`document.querySelector('.weather-temperature strong').textContent`), '22°C');
  await click('.forecast-controls button:last-child');
  await advance('2027-01-02T00:00:00+11:00', 'midnight');
  await waitFor(`document.querySelector('.forecast-day')?.dataset.date==='2027-01-02'&&document.querySelectorAll('.forecast-day').length===5`);
  await advance('2027-01-05T12:00:00+11:00', 'focus');
  await waitFor(`document.querySelector('.forecast-day')?.dataset.date==='2027-01-05'&&document.querySelectorAll('.forecast-day').length===5`);
  await advance('2027-01-10T12:00:00+11:00', 'visibility');
  await waitFor(`document.querySelector('.forecast-day')?.dataset.date==='2027-01-10'&&document.querySelectorAll('.forecast-day').length===5`);
  assert.equal(await evaluate('window.weatherRequests'), 5, 'one refresh per new local day, including multi-day resume');
  await advance('2027-01-09T12:00:00+11:00', 'focus');
  await waitFor(`document.querySelector('.forecast-day')?.dataset.date==='2027-01-09'&&document.querySelectorAll('.forecast-day').length===5`);
  assert.equal(await evaluate('window.weatherRequests'), 6, 'a backwards system-clock correction must also refresh the day');
  console.log('PASS exact local midnight, year rollover, selection/graph reset, five-day renewal and multi-day sleep/resume');

  await navigate({zone:'America/New_York', host:'Australia/Melbourne', now:'2026-12-31T23:59:59-05:00'});
  await evaluate(`window.weatherMode='fail'`);
  await advance('2027-01-01T00:00:00-05:00', 'midnight');
  await waitFor('window.weatherRequests===2'); await checkDay('2027-01-01');
  assert.equal(await evaluate(`document.querySelector('.weather-temperature small').textContent`), 'Daytime high');
  await evaluate(`window.weatherMode='stale';window.dispatchEvent(new Event('online'))`);
  await waitFor('window.weatherRequests===3&&window.weatherTimers.some(timer=>timer.ms===60000)');
  await checkDay('2027-01-01');
  await evaluate(`window.weatherMode='hold';void window.weatherTimers.find(timer=>timer.ms===60000).callback()`);
  await waitFor('window.weatherRequests===4');
  await evaluate(`for(let i=0;i<4;i++)window.dispatchEvent(new Event('online'))`);
  assert.equal(await evaluate('window.weatherRequests'), 4, 'pending refreshes must coalesce reconnect notifications');
  await evaluate(`window.weatherMode='normal';window.releaseWeather()`);
  await waitFor(`document.querySelector('.weather-temperature small')?.textContent==='Current conditions'`);
  await evaluate(`window.dispatchEvent(new Event('online'))`);
  assert.equal(await evaluate('window.weatherRequests'), 4, 'a successful refresh must stop retrying');
  console.log('PASS offline rollover, cached daily forecast, stale provider response, automatic retry and reconnect coalescing');

  await navigate({zone:'Australia/Melbourne', host:'America/Los_Angeles', now:'2026-12-31T23:59:59+11:00'});
  await click('.weather-header [title="Hide Weather"]');
  await waitFor(`!document.querySelector('.weather-panel')`);
  await advance('2027-01-01T00:00:00+11:00', 'midnight');
  await waitFor('window.weatherRequests===2');
  await click('.rail-button[title="Weather"]'); await checkDay('2027-01-01');
  console.log('PASS weather refresh while the widget is hidden, with the new date on reopening');

  const matrix = [[1280,400,75],[1280,400,100],[1280,480,100],[1280,480,200],
    [1920,600,100],[1920,600,150],[1920,600,200],[1920,720,100],[1920,720,150],[1920,720,200],
    [2560,800,100],[2560,800,125],[2560,800,150],[2560,800,175],[2560,800,200],
    [2048,640,100,1.25],[1707,533,100,1.5],[1463,457,100,1.75],[1280,400,100,2]];
  for (const [width,height,scale,dpr=1] of matrix) for (const size of ['half','tall','wide','full']) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:dpr,mobile:false});
    await navigate({native:false,zone:'Australia/Melbourne',host:'America/Los_Angeles',now:'2026-07-07T23:59:59+10:00'},
      `?mock=1&widget=weather&widgetSize=${size}&scale=${scale}&weatherTime=2026-07-07T23:59:59%2B10:00`);
    await evaluate(`(()=>{const url=new URL(location.href);url.searchParams.set('weatherTime','2026-07-08T00:00:00+10:00');history.replaceState(null,'',url);window.weatherTicks.forEach(tick=>tick());})()`);
    await checkDay('2026-07-08');
    assert.equal(await evaluate(`(()=>{const p=document.querySelector('.weather-panel'),r=p.getBoundingClientRect();return r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&p.scrollWidth<=p.clientWidth+1&&Boolean(p.querySelector('#temp-gradient-2026-07-08'))&&p.dataset.solarPhase==='night'})()`), true, `${width}x${height}/${scale}/${dpr}/${size} rollover layout`);
  }
  console.log('PASS midnight rollover in all 76 weather size/display/scaling combinations under production CSP');
} finally {
  if (cdp) cdp.close();
  await cleanupTestBrowser(chrome, profile);
  if (server) await new Promise(resolve => server.close(resolve));
}

async function navigate(config, query='') {
  if (scriptId) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', {identifier:scriptId});
  const result = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {source:`(${installFixture.toString()})(${JSON.stringify(config)})`});
  scriptId = result.identifier;
  await cdp.send('Emulation.setTimezoneOverride', {timezoneId:config.host});
  await cdp.send('Page.navigate', {url:base+query});
  await waitFor(`Boolean(document.querySelector('.weather-panel[data-forecast-date] .weather-day-graph'))`);
}
async function advance(instant, source) {
  const elapsed = await evaluate(`Date.parse(${JSON.stringify(instant)})-window.weatherNow`);
  await evaluate(`window.weatherNow=Date.parse(${JSON.stringify(instant)})`);
  if (source==='midnight') {
    const ms = await evaluate(`window.weatherTimers.find(timer=>timer.ms===${elapsed})?.ms`);
    assert.equal(ms, elapsed, 'the local date change must have its own exact timer');
    await evaluate(`window.weatherTimers.find(timer=>timer.ms===${elapsed}).callback()`);
  } else if (source==='focus') await evaluate(`window.dispatchEvent(new Event('focus'))`);
  else await evaluate(`Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'))`);
}
async function checkDay(date) {
  await waitFor(`document.querySelector('.weather-panel')?.dataset.forecastDate===${JSON.stringify(date)}`);
  assert.equal(await evaluate(`document.querySelector('[title="Previous forecast day"]').disabled`), true);
}
async function click(selector) {
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
}
async function waitFor(expression) {
  for (let i=0;i<100;i++) { if (await evaluate(expression)) return; await delay(50); }
  throw Error('Timed out: '+expression+'; '+await evaluate('document.body.innerText.slice(0,500)'));
}
async function evaluate(expression) {
  const r = await cdp.send('Runtime.evaluate', {expression,returnByValue:true,awaitPromise:true});
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
function delay(ms) { return new Promise(resolve=>setTimeout(resolve,ms)); }
async function connect(url) {
  const ws = new WebSocket(url), pending = new Map(); let id=0;
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const r=JSON.parse(event.data);if(pending.has(r.id)){const p=pending.get(r.id);pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}});
  ws.addEventListener('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Test browser connection closed'));}pending.clear();});
  return {send(method,params={}){const key=++id;ws.send(JSON.stringify({id:key,method,params}));return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(key);reject(Error('Timed out: '+method));},15000);pending.set(key,{resolve,reject,timer});});},close(){ws.close();}};
}

function installFixture(config) {
  const NativeDate = Date;
  window.weatherNow = NativeDate.parse(config.now);
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [window.weatherNow])); }
    static now() { return window.weatherNow; }
  };
  const timers = new Map(), intervals = new Map();
  const timeout = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window);
  const interval = window.setInterval.bind(window), clearInterval = window.clearInterval.bind(window);
  Object.defineProperty(window,'weatherTimers',{get:()=>[...timers.values()]});
  Object.defineProperty(window,'weatherTicks',{get:()=>[...intervals.values()]});
  window.setTimeout = (callback,ms,...args) => {
    const id = timeout(callback, ms>=1000 ? 86_400_000 : ms,...args);
    timers.set(id,{callback,ms,name:callback.name}); return id;
  };
  window.clearTimeout = id => { timers.delete(id); clear(id); };
  window.setInterval = (callback,ms,...args) => { const id=interval(callback,ms,...args);if(ms===30000)intervals.set(id,callback);return id; };
  window.clearInterval = id => { intervals.delete(id); clearInterval(id); };
  if (config.native===false) return;
  window.weatherRequests = 0; window.weatherMode='normal';
  window.__TAURI_INTERNALS__ = {invoke:async command=>{
    if(command==='load_initial_config')return {env:{googleClientId:'example.apps.googleusercontent.com'},settings:{weatherLocation:{name:'Example City',latitude:0,longitude:0},updatePreference:'ignore',widgetLayout:{visible:['weather'],order:['weather'],stacks:[],sizes:{weather:'full'}}}};
    if(command==='load_saved_tokens')return {};
    if(command==='display_lock_info')return {supported:false,displays:[],binding:null,status:''};
    if(command==='local_spotify_snapshot')return {available:false,controls:{},status:'Open Spotify'};
    return null;
  }};
  const fetch = window.fetch.bind(window);
  window.fetch = async (url, options={}) => {
    if (!String(url).startsWith('https://api.open-meteo.com/')) return fetch(url,options);
    window.weatherRequests++;
    if(window.weatherMode==='fail')throw Error('Offline weather fixture');
    if(window.weatherMode==='hold')await new Promise((resolve,reject)=>{
      window.releaseWeather=resolve;
      options.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
    });
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:config.zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const part = key=>parts.find(item=>item.type===key).value;
    const start = NativeDate.parse(`${part('year')}-${part('month')}-${part('day')}T12:00Z`)-(window.weatherMode==='stale'?86400000:0);
    const dates = Array.from({length:5},(_,i)=>new NativeDate(start+i*86400000).toISOString().slice(0,10));
    const times = dates.flatMap(date=>Array.from({length:24},(_,i)=>`${date}T${String(i).padStart(2,'0')}:00`));
    return new Response(JSON.stringify({timezone:config.zone,current:{time:dates[0]+'T00:00',temperature_2m:20+window.weatherRequests,apparent_temperature:19},
      daily:{time:dates,sunrise:dates.map(d=>d+'T06:00'),sunset:dates.map(d=>d+'T18:00'),temperature_2m_min:[10,11,12,13,14],temperature_2m_max:[20,21,22,23,24],uv_index_max:[3,4,5,6,7],precipitation_sum:[1,2,3,4,5],precipitation_probability_max:[10,20,30,40,50]},
      hourly:{time:times,temperature_2m:times.map(()=>18),apparent_temperature:times.map(()=>17),precipitation:times.map(()=>0),precipitation_probability:times.map(()=>25)}}),{headers:{'Content-Type':'application/json'}});
  };
}
