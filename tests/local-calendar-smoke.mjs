import {cleanupTestBrowser} from './browser-cleanup.mjs';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const base=process.argv[2] || 'http://127.0.0.1:1420', output='/tmp/daily-dashboard-v0.5.5-preview';
await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'dashboard-design-'));
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9450',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
try {
 await waitForHttp('http://127.0.0.1:9450/json/version');
 const target=await(await fetch('http://127.0.0.1:9450/json/new?about:blank',{method:'PUT'})).json();
 const cdp=await connectCdp(target.webSocketDebuggerUrl);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
 const evaluate=async expression=>{const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
 const check=async (expression,message)=>{if(!await evaluate(expression))throw Error(message);};
 const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(120);};
 const screenshot=async name=>{const r=await cdp.send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,name+'.png'),Buffer.from(r.result.data,'base64'));};
 for(const [width,height,scale,dpr] of [[1280,480,100,1],[1280,480,200,1],[2560,800,200,1],[1280,400,100,2]]) for(const size of ['half','tall','wide','full']) {
  await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});
  await cdp.send('Page.navigate',{url:`${base}/?mock=1&widget=calendar&widgetSize=${size}&scale=${scale}&calendarStress=1&calendarView=work`});
  for(let attempt=0;attempt<100;attempt++){if(await evaluate(`Boolean(document.querySelector('.timed-event'))`))break;await delay(50);}
  const point=await evaluate(`(()=>{const n=document.querySelector('.timed-event'),r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await delay(300);
  await check(`(()=>{const p=document.querySelector('.calendar-hover-preview'),r=p?.getBoundingClientRect(),c=document.querySelector('.calendar-timeline').getBoundingClientRect(),b=document.querySelector('.calendar-hover-backdrop');return r&&r.left>=c.left-.5&&r.right<=c.right+.5&&r.top>=c.top-.5&&r.bottom<=c.bottom+.5&&b&&getComputedStyle(b).pointerEvents==='none'&&!p.contains(document.activeElement)&&!document.querySelector('.calendar-event-dialog')})()`,'hover preview missing, clipped, or stole focus');
  await screenshot(`calendar-${width}-${height}-${scale}-${dpr}-${size}`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await delay(220);await check(`!document.querySelector('.calendar-hover-preview')`,'pointer exit should close preview');
  await evaluate(`document.querySelector('.timed-event').focus()`);await delay(260);await check(`Boolean(document.querySelector('.calendar-hover-preview'))`,'keyboard focus preview');
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await check(`!document.querySelector('.calendar-hover-preview')`,'Escape preview dismissal');
  await click('.timed-event');await check(`Boolean(document.querySelector('.calendar-event-dialog'))`,'click should pin detail dialog');
 }
 console.log('PASS calendar hover containment, dimming, keyboard/Escape and pinned details: 16 size/display combinations');
 // Exercise actual app routing with a mocked native transport, rather than mock-mode command shortcuts.
 for(const mode of ['local','auto','api']) for(const available of [true,false]) {
  const script=await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`
   window.isTauri=true;window.bridgeCalls=[];window.apiCalls=[];
   localStorage.setItem('daily-dashboard.spotify-token',JSON.stringify({accessToken:'test',expiresAt:Date.now()+3600000}));
   window.testSnapshot={available:${available},provider:'connector',title:'Local Test Track',artist:'Test Artist',album:'Test Album',uri:'spotify:track:6rqhFgbbKwnb9MLmUQDhG6',artworkUrl:'',durationMs:180000,progressMs:42000,isPlaying:true,shuffle:false,repeat:0,liked:false,volumePercent:50,controls:{toggle:true,previous:true,next:true,seek:true,volume:true,shuffle:true,repeat:true,save:true},status:'Local Spotify · Connected'};
   window.__TAURI_INTERNALS__={invoke:async(command,args)=>{window.bridgeCalls.push({command,args});if(command==='load_initial_config')return{env:{googleClientId:'test',spotifyClientId:'test'},settings:{updatePreference:'ignore',spotifyControlMode:'${mode}',widgetLayout:{mode:'thirds',visible:['spotify'],order:['spotify'],sizes:{spotify:'half'},stacks:[]}}};if(command==='local_spotify_snapshot')return structuredClone(window.testSnapshot);if(command==='local_spotify_command'){const s=window.testSnapshot,v=args.value;switch(args.action){case'save':s.liked=v===1;break;case'shuffle':s.shuffle=v===1;break;case'repeat':s.repeat=v;break;case'toggle':s.isPlaying=v===1;break;case'seek':s.progressMs=v;break;case'volume':s.volumePercent=v;break;}return null;}return null;}};
   const originalFetch=window.fetch;window.fetch=(url,options)=>{if(String(url).includes('api.spotify.com')){window.apiCalls.push(String(url));return Promise.resolve(new Response(null,{status:204}));}return originalFetch(url,options);};
  `});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:480,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate',{url:base+'/?bridge-test='+mode+available});await delay(650);
  if(mode==='local'||mode==='auto'&&available)await check('window.apiCalls.length===0',mode+' must not use Web API when local');
  if(mode==='api')await check(`!window.bridgeCalls.some(c=>c.command==='local_spotify_snapshot')`,'API mode must not probe local');
  if(mode!=='api'&&available){
   await click('[aria-label="Favourite"]');await delay(500);await check(`document.querySelector('[aria-label="Favourite"]').getAttribute('aria-pressed')==='true'`,'local Like acknowledgement updates UI');
   await click('.shuffle-button');await delay(500);await check(`document.querySelector('.shuffle-button').getAttribute('aria-pressed')==='true'`,'local Shuffle');
   await click('.repeat-button');await delay(500);await check(`document.querySelector('.repeat-button').getAttribute('aria-pressed')==='true'`,'local Repeat');
   await check(`window.bridgeCalls.filter(c=>c.command==='local_spotify_command').every(c=>c.args.expectedUri==='spotify:track:6rqhFgbbKwnb9MLmUQDhG6')&&window.apiCalls.length===0`,'native commands must retain track identity and not fall back to API');
   await evaluate(`document.querySelector('.scrubber').focus()`);
   for(let i=0;i<8;i++) await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});
   await delay(700);
   await check(`window.bridgeCalls.filter(c=>c.command==='local_spotify_command'&&c.args.action==='seek').length===1`,'slider changes should coalesce into one native command');
   // Native session lacks Like/volume: controls must reflect capabilities on next poll.
   await evaluate(`window.testSnapshot.controls.save=false;window.testSnapshot.controls.volume=false`);await delay(2200);
   await check(`document.querySelector('[aria-label="Favourite"]').disabled&&document.querySelector('.volume-control button').disabled`,'unsupported native controls disabled');
   await screenshot('spotify-native-'+mode);
  }
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:script.result.identifier});
 }
 console.log('PASS actual local/auto/API routing, connector Like/Shuffle/Repeat and native capability states');
 await cdp.close();
} finally {await cleanupTestBrowser(chrome,profile);}
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
