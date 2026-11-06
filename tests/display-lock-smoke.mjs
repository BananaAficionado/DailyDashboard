import {cleanupTestBrowser} from './browser-cleanup.mjs';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:1420';
const output='/tmp/daily-dashboard-v0.5.6-preview';await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'dashboard-design-'));
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9451',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
try {
 await waitForHttp('http://127.0.0.1:9451/json/version');const target=await(await fetch('http://127.0.0.1:9451/json/new?about:blank',{method:'PUT'})).json();const cdp=await connectCdp(target.webSocketDebuggerUrl);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
 const evaluate=async expression=>{const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
 const check=async(expression,message)=>{if(!await evaluate(expression))throw Error(message);};
 const click=async selector=>{for(let i=0;i<80;i++){if(await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`))break;await delay(50);}if(!await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`))throw Error('Missing '+selector+' '+await evaluate('document.body.innerText.slice(0,300)'));await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(100);};
 const select=async value=>{await evaluate(`(()=>{const s=document.querySelector('#dashboard-display');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);await delay(80);};
 const matrix=[[1280,400,75],[1280,400,100],[1280,480,100],[1280,480,200],[1920,600,100],[1920,600,150],[1920,600,200],[1920,720,100],[1920,720,150],[1920,720,200],[2560,800,100],[2560,800,125],[2560,800,150],[2560,800,175],[2560,800,200],[2048,640,100,1.25],[1707,533,100,1.5],[1463,457,100,1.75],[1280,400,100,2]];
 for(const [width,height,scale,dpr=1] of matrix){
  await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});await cdp.send('Page.navigate',{url:`${base}/?mock=1&scale=${scale}`});await delay(300);await click('.rail-settings');await delay(100);
  await check(`(()=>{const r=document.querySelector('.app-shell')?.getBoundingClientRect();return r&&Math.abs(r.left)<1&&Math.abs(r.top)<1&&Math.abs(r.right-innerWidth)<1&&Math.abs(r.bottom-innerHeight)<1})()`,`dashboard should fill the viewport at ${width}x${height}, scale ${scale}, DPR ${dpr}: `+await evaluate(`JSON.stringify({shell:document.querySelector('.app-shell')?.getBoundingClientRect(),width:innerWidth,height:innerHeight})`));
  await check(`(()=>{const p=document.querySelector('.setup-panel'),c=p.querySelector('.settings-content'),s=p.querySelector('#dashboard-display'),r=s?.getBoundingClientRect(),b=c.getBoundingClientRect();return r&&r.width>0&&r.left>=b.left-.5&&r.right<=b.right+.5&&c.scrollWidth<=c.clientWidth+1&&s.options[3].disabled})()`,'monitor selector should fit Settings and disable mirrored output');
  await select('windows:mock-ultrawide');await click('.settings-save');await click('.settings-close-button');await click('.rail-settings');
  await check(`document.querySelector('#dashboard-display').value==='windows:mock-ultrawide'&&document.querySelector('.settings-action-button').disabled`,'saved monitor ID should persist and fullscreen toggle should be disabled');
  if(width===1280&&scale===100){await evaluate(`document.querySelector('.display-lock-setting').scrollIntoView({block:'center'})`);const r=await cdp.send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,`monitor-settings-${width}-${height}.png`),Buffer.from(r.result.data,'base64'));}
  await select('');await click('.settings-save');await check(`!document.querySelector('.settings-action-button').disabled`,'unlock should restore the fullscreen control');
 }
 console.log('PASS edge-to-edge viewport and dedicated display Settings: 19 resolution/scaling combinations, save/reopen and unlock');
 // Exercise actual invoke/save contracts and macOS omission without touching host displays.
 for(const platform of ['windows','macos']){
  const installed=await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`
   window.__settings={updatePreference:'ignore',widgetLayout:{visible:[],order:[],stacks:[]},displayLock:{id:'windows:physical-b',name:'Same model'}};window.__saves=[];window.__missing=false;
   window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{
    if(cmd==='load_initial_config')return {env:{googleClientId:'test'},settings:structuredClone(window.__settings)};
    if(cmd==='display_lock_info')return {supported:${platform==='windows'},displays:window.__missing?[]:[{id:'windows:physical-a',name:'Same model',bounds:{x:0,y:0,width:1920,height:1080}},{id:'windows:physical-b',name:'Same model',bounds:{x:-1280,y:0,width:1280,height:400}}],currentId:'windows:physical-b',binding:window.__settings.displayLock,status:window.__missing?'Selected display is unavailable. Dashboard is hidden until it reconnects.':'Ready'};
    if(cmd==='save_settings'){if(window.__reject)throw Error('Selected display is unavailable');window.__settings=structuredClone(args.settings);window.__saves.push(structuredClone(args.settings));return null;}
    if(cmd==='local_spotify_snapshot')return {available:false,controls:{},status:'Open Spotify'};
    return null;
   }};
  `});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:480,deviceScaleFactor:1,mobile:false});await cdp.send('Page.navigate',{url:base+'/?display-contract='+platform});await delay(400);await click('.rail-settings');
  if(platform==='macos'){
   await check(`!document.querySelector('.display-lock-setting')&&!document.querySelector('.settings-action-button').disabled`,'macOS must omit the Windows-only control and keep normal fullscreen');
  }else{
   await check(`document.querySelector('#dashboard-display').value==='windows:physical-b'`,'duplicate model names must retain physical identity');
   await select('windows:physical-a');await evaluate('window.__reject=true');await click('.settings-save');await click('.settings-close-button');await click('.rail-settings');await check(`document.querySelector('#dashboard-display').value==='windows:physical-b'`,'failed native validation must not change the selected binding');
   await evaluate('window.__reject=false;window.__missing=true');await delay(2200);await check(`document.querySelector('#dashboard-display').selectedOptions[0].textContent.includes('disconnected')`,'missing target must stay selected without fallback');
   await evaluate(`window.__settings.displayLock=null;window.dispatchEvent(new Event('dashboard-display-unlocked'))`);await delay(180);await check(`!document.querySelector('.setup-panel')`,'tray recovery closes stale Settings draft');await click('.rail-settings');await check(`document.querySelector('#dashboard-display').value===''`,'tray recovery reloads the persisted unlocked preference');
  }
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:installed.result.identifier});
 }
 console.log('PASS Windows identity/validation/recovery contracts and macOS feature omission');await cdp.close();
}finally{await cleanupTestBrowser(chrome,profile);}
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
