import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {access, mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extname, join, relative, resolve} from 'node:path';
import {cleanupTestBrowser} from './browser-cleanup.mjs';

let server, base = process.argv[2];
if (!base) {
  const dist = resolve('dist'); await access(join(dist,'index.html'));
  const config = JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8'));
  const policy = Object.entries(config.app.security.csp).map(([k,v])=>`${k} ${Array.isArray(v)?v.join(' '):v}`).join('; ');
  server = createServer(async(req,res)=>{
    const url = new URL(req.url,'http://127.0.0.1');
    const file = resolve(dist,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if (relative(dist,file).startsWith('..')) {res.writeHead(403).end();return;}
    try {
      const body=await readFile(file); res.setHeader('Content-Security-Policy',policy);
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');
      res.end(body);
    } catch {res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
}
const profile=await mkdtemp(join(tmpdir(),'dashboard-design-'));
const chrome=spawn(process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank',
],{stdio:'ignore'});
let cdp,scriptId;
try {
  let port;
  for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await delay(100);}}
  assert.ok(port,'Chrome did not start');
  const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  cdp=await connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:480,deviceScaleFactor:1,mobile:false});

  for(const provider of ['google','microsoft','ical']) {
    await navigate({provider,view:'day',zone:'Australia/Melbourne',host:'America/Los_Angeles',now:'2026-12-31T23:59:59+11:00'});
    assert.equal(await evaluate('calendarRequests.length'),1,'initial load should request the correct date once');
    await click('.event-pill');await waitFor(`Boolean(document.querySelector('.calendar-event-dialog'))`);
    await advance('2027-01-01T00:00:00+11:00','midnight');
    await waitFor(`calendarRequests.length===2&&document.querySelector('.event-pill')?.textContent.includes('revision 2')`);
    assert.deepEqual(await dates(),['2027-01-01']);
    assert.equal(await evaluate('new Date().getDate()'),31,'the calendar must roll over before the host date');
    assert.equal(await evaluate(`document.querySelector('.date-heading').textContent.includes('2027')`),true);
    assert.equal(await evaluate(`Boolean(document.querySelector('.calendar-event-dialog'))`),false,'old pinned details must close when following today');
    assert.equal(await evaluate(`document.querySelector('.day-heading.is-today')?.dataset.date`),'2027-01-01');
    await advance('2027-01-01T12:00:00+11:00','focus');
    await waitFor(`calendarRequests.length===3&&document.querySelector('.event-pill')?.textContent.includes('revision 3')`);
    await evaluate(`window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'))`);
    assert.equal(await evaluate('calendarRequests.length'),3,'focus/visibility events must coalesce');
    assert.equal(await evaluate(`document.querySelectorAll('.current-time-marker').length`),1);
    await advance('2027-01-08T12:00:00+11:00','visibility');
    await waitFor(`calendarRequests.length===4&&document.querySelector('.event-pill')?.textContent.includes('revision 4')`);
    assert.deepEqual(await dates(),['2027-01-08']);
    console.log(`PASS ${provider}: midnight/year rollover, new events, today highlight, same-day resume and multi-day sleep`);
  }

  await navigate({provider:'google',view:'week',zone:'America/New_York',host:'Australia/Melbourne',now:'2026-10-31T23:59:59-04:00'});
  assert.equal(await evaluate('calendarRequests[0].first'),'2026-10-25','initial timezone must precede the first request');
  await advance('2026-11-01T00:00:00-04:00','midnight');
  await waitFor('calendarRequests.length===2');
  assert.equal((await dates())[0],'2026-11-01');
  await advance('2026-11-02T00:00:00-05:00','midnight');
  await waitFor('calendarRequests.length===3');
  assert.equal(await evaluate(`document.querySelector('.day-heading.is-today')?.dataset.date`),'2026-11-02');
  await click('.topbar [title="Next"]');
  const browsed=await dates();
  await advance('2026-11-03T00:00:00-05:00','midnight');
  assert.deepEqual(await dates(),browsed,'midnight must preserve a deliberately browsed range');
  await click('.today-button');
  await waitFor(`document.querySelector('.day-heading.is-today')?.dataset.date==='2026-11-03'`);
  await click('.topbar [title="Previous"]');
  const past=await dates();
  await advance('2026-11-04T00:00:00-05:00','midnight');
  assert.deepEqual(await dates(),past,'past browsing must also stay put');
  await click('.today-button');
  await advance('2026-11-05T00:00:00-05:00','midnight');
  await waitFor(`document.querySelector('.day-heading.is-today')?.dataset.date==='2026-11-05'`);
  await evaluate(`calendarNow=Date.parse('2026-11-06T12:00:00-05:00')`);
  await click('.today-button');
  await waitFor(`document.querySelector('.day-heading.is-today')?.dataset.date==='2026-11-06'`);
  console.log('PASS week boundary, 25-hour DST day, past/future browsing and Today tracking');

  await navigate({provider:'google',view:'day',zone:'Australia/Melbourne',host:'UTC',now:'2026-12-31T23:59:59+11:00'});
  await evaluate(`calendarMode='fail'`);
  await advance('2027-01-01T00:00:00+11:00','midnight');
  await waitFor('calendarRequests.length===2&&calendarTimers.some(timer=>timer.ms===60000)');
  assert.deepEqual(await dates(),['2027-01-01']);
  assert.equal(await evaluate(`document.querySelectorAll('.event-pill').length`),0,'yesterday’s events must not appear under today');
  await evaluate(`calendarMode='normal';void calendarTimers.find(timer=>timer.ms===60000).callback()`);
  await waitFor(`calendarRequests.length===3&&document.querySelector('.event-pill')?.textContent.includes('revision 3')`);
  await advance('2027-01-02T00:00:00+11:00','midnight');
  await waitFor('calendarRequests.length===4');
  await click('.topbar [title="Hide Calendar"]');
  const hiddenRevision=await evaluate('calendarRequests.length');
  await advance('2027-01-03T00:00:00+11:00','midnight');
  await waitFor(`calendarRequests.length===${hiddenRevision+1}`);
  await click('.rail-button[title="Calendar"]');
  assert.deepEqual(await dates(),['2027-01-03']);
  console.log('PASS offline rollover/retry and updates while the calendar is hidden');

  await navigate({provider:'ical',view:'day',zone:'Australia/Melbourne',host:'UTC',now:'2026-12-31T23:59:59+11:00',hold:true});
  await waitFor('calendarRequests.length===1');
  await advance('2027-01-01T00:00:00+11:00','midnight');
  await waitFor(`calendarRequests.length===2&&document.querySelector('.event-pill')?.textContent.includes('revision 2')`);
  await evaluate('releaseCalendar()');
  await settled();
  assert.equal(await evaluate(`document.querySelector('.event-pill')?.textContent.includes('revision 2')`),true,'late native feed responses must not replace today’s data');
  console.log('PASS obsolete native iCalendar responses are discarded after rollover');

  const matrix=[[1280,400,75],[1280,400,100],[1280,480,100],[1280,480,200],
    [1920,600,100],[1920,600,150],[1920,600,200],[1920,720,100],[1920,720,150],[1920,720,200],
    [2560,800,100],[2560,800,125],[2560,800,150],[2560,800,175],[2560,800,200],
    [2048,640,100,1.25],[1707,533,100,1.5],[1463,457,100,1.75],[1280,400,100,2]];
  for(const [width,height,scale,dpr=1] of matrix) for(const size of ['half','tall','wide','full']) for(const view of ['day','week','work']) {
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});
    await navigate({provider:'google',view,size,scale,zone:'Australia/Melbourne',host:'UTC',now:'2026-11-01T23:59:59+11:00'});
    await advance('2026-11-02T00:00:00+11:00','midnight');
    await waitFor(`calendarRequests.length===2&&document.querySelector('.day-heading.is-today')?.dataset.date==='2026-11-02'&&document.querySelector('.event-pill')?.textContent.includes('revision 2')`);
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-widget="calendar"].widget-size-${size}'))`),true,`requested calendar size ${size}/${view} must be exercised: `+await evaluate(`document.querySelector('[data-widget="calendar"]')?.className`));
    const days=await dates();
    assert.equal(days.length,view==='day'?1:view==='work'?5:7);
    if(view==='work')assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.day-heading'),node=>Number(node.dataset.weekday))`),[1,2,3,4,5]);
    assert.equal(await evaluate(`(()=>{const p=document.querySelector('.calendar-panel'),r=p.getBoundingClientRect(),t=p.querySelector('.calendar-timeline');return r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&p.scrollWidth<=p.clientWidth+1&&t.dataset.startHour==='9'&&t.dataset.endHour==='18'})()`),true,`${width}x${height}/${scale}/${dpr}/${size}/${view}`);
  }
  console.log('PASS calendar rollover in all 228 mode/size/display/scaling combinations under production CSP');
} finally {
  if(cdp)cdp.close();
  await cleanupTestBrowser(chrome,profile);
  if(server)await new Promise(resolve=>server.close(resolve));
}

async function navigate(config) {
  if(scriptId)await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:scriptId});
  const r=await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installFixture.toString()})(${JSON.stringify(config)})`});scriptId=r.identifier;
  await cdp.send('Emulation.setTimezoneOverride',{timezoneId:config.host});
  await cdp.send('Page.navigate',{url:base});
  await waitFor(`document.querySelectorAll('.day-heading').length>0&&calendarRequests.length>0`);
  if(!config.hold)await waitFor(`Boolean(document.querySelector('.event-pill'))`);
}
async function dates(){return evaluate(`Array.from(document.querySelectorAll('.day-heading'),node=>node.dataset.date)`);}
async function advance(time,source) {
  const elapsed=await evaluate(`Date.parse(${JSON.stringify(time)})-calendarNow`);
  await evaluate(`calendarNow=Date.parse(${JSON.stringify(time)})`);
  if(source==='midnight') {
    assert.equal(await evaluate(`calendarTimers.some(timer=>timer.ms===${elapsed})`),true,'exact local midnight timer');
    await evaluate(`calendarTimers.filter(timer=>timer.ms===${elapsed}).forEach(timer=>timer.callback())`);
  }else if(source==='focus')await evaluate(`window.dispatchEvent(new Event('focus'))`);
  else await evaluate(`Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'))`);
  await settled();
}
async function settled(){await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');}
async function click(selector){await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await settled();}
async function waitFor(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(50);}throw Error('Timed out: '+expression+'; '+await evaluate('document.body.innerText.slice(0,500)'));}
async function evaluate(expression){const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function connect(url){
  const ws=new WebSocket(url),pending=new Map();let id=0;
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const r=JSON.parse(event.data),p=pending.get(r.id);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}});
  ws.addEventListener('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Test browser closed'));}pending.clear();});
  return{send(method,params={}){const key=++id;ws.send(JSON.stringify({id:key,method,params}));return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(key);reject(Error('Timed out: '+method));},15000);pending.set(key,{resolve,reject,timer});});},close(){ws.close();}};
}

function installFixture(config){
  const NativeDate=Date;window.calendarNow=NativeDate.parse(config.now);
  window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[calendarNow]));}static now(){return calendarNow;}};
  const timers=new Map(),timeout=window.setTimeout.bind(window),clear=window.clearTimeout.bind(window);
  Object.defineProperty(window,'calendarTimers',{get:()=>[...timers.values()]});
  window.setTimeout=(callback,ms,...args)=>{const id=timeout(callback,ms>=1000?86400000:ms,...args);timers.set(id,{callback,ms});return id;};
  window.clearTimeout=id=>{timers.delete(id);clear(id);};
  window.calendarRequests=[];window.calendarMode='normal';
  const size=config.size||'full';
  const widgetLayout=size==='full'?{visible:['calendar'],order:['calendar'],stacks:[]}
    :size==='half'?{visible:['calendar','clock','terminal'],order:['calendar','clock','terminal'],stacks:[['calendar','clock']],sizes:{calendar:'half',clock:'half',terminal:'wide'}}
    :{visible:['calendar','clock'],order:['calendar','clock'],stacks:[],sizes:{calendar:size,clock:size==='wide'?'tall':'wide'}};
  const shift=(key,days)=>new NativeDate(NativeDate.parse(key+'T12:00Z')+days*86400000).toISOString().slice(0,10);
  const dateAt=time=>{
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:config.zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new NativeDate(time));
    const p=k=>parts.find(part=>part.type===k).value;return `${p('year')}-${p('month')}-${p('day')}`;
  };
  const eventDays=(first,last)=>Array.from({length:Math.round((NativeDate.parse(last)-NativeDate.parse(first))/86400000)},(_,i)=>shift(first,i));
  const record=(first,last)=>{const entry={first,last,revision:calendarRequests.length+1};calendarRequests.push(entry);return entry;};
  const feed=entry=>['BEGIN:VCALENDAR','VERSION:2.0',...eventDays(entry.first,entry.last).flatMap(date=>[
    'BEGIN:VEVENT',`UID:example-${date}`,`DTSTART;VALUE=DATE:${date.replaceAll('-','')}`,`DTEND;VALUE=DATE:${shift(date,1).replaceAll('-','')}`,`SUMMARY:Example ${date} revision ${entry.revision}`,'END:VEVENT',
  ]),'END:VCALENDAR'].join('\r\n');
  window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
    if(command==='load_initial_config')return{env:{googleClientId:'example.apps.googleusercontent.com',microsoftClientId:'example-microsoft'},settings:{googleCalendarTimeZone:config.zone,calendarViewMode:config.view,icalCalendarUrl:config.provider==='ical'?'https://calendar.example.test/feed.ics':undefined,appScale:config.scale||100,updatePreference:'ignore',widgetLayout}};
    if(command==='load_saved_tokens')return config.provider==='ical'?{}:{[config.provider]:{accessToken:'example-access',expiresAt:NativeDate.UTC(2040,0,1)}};
    if(command==='display_lock_info')return{supported:false,displays:[],binding:null,status:''};
    if(command==='local_spotify_snapshot')return{available:false,controls:{},status:'Open Spotify'};
    if(command==='fetch_icalendar'){
      const headings=[...document.querySelectorAll('.day-heading')].map(n=>n.dataset.date);
      const first=headings[0]||dateAt(calendarNow),last=headings.length?shift(headings.at(-1),1):shift(first,1),entry=record(first,last);
      const text=feed(entry);
      if(config.hold&&entry.revision===1)await new Promise(resolve=>window.releaseCalendar=resolve);
      if(calendarMode==='fail')throw Error('Offline calendar fixture');return text;
    }
    return null;
  }};
  const fetch=window.fetch.bind(window);
  window.fetch=async(input,options={})=>{
    const url=new URL(String(input));
    if(url.hostname==='www.googleapis.com'&&url.pathname.endsWith('/calendarList'))return Response.json({items:[{id:'example',summary:'Example calendar',selected:true}]});
    if(url.hostname==='graph.microsoft.com'&&url.pathname.endsWith('/calendars'))return Response.json({value:[{id:'example',name:'Example calendar',canEdit:true}]});
    if((url.hostname==='www.googleapis.com'&&url.pathname.endsWith('/events'))||(url.hostname==='graph.microsoft.com'&&url.pathname.endsWith('/calendarView'))){
      const first=dateAt(url.searchParams.get('timeMin')||url.searchParams.get('startDateTime'));
      const last=dateAt(url.searchParams.get('timeMax')||url.searchParams.get('endDateTime')),entry=record(first,last);
      if(calendarMode==='fail')throw Error('Offline calendar fixture');
      const entries=eventDays(first,last).map(date=>({id:'example-'+date,summary:`Example ${date} revision ${entry.revision}`,start:{date},end:{date:shift(date,1)}}));
      return config.provider==='microsoft'?Response.json({value:entries.map(e=>({id:e.id,subject:e.summary,isAllDay:true,start:{dateTime:e.start.date+'T00:00:00',timeZone:'UTC'},end:{dateTime:e.end.date+'T00:00:00',timeZone:'UTC'}}))}):Response.json({items:entries});
    }
    return fetch(input,options);
  };
}
