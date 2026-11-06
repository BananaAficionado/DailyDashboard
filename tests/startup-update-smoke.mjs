import {cleanupTestBrowser} from './browser-cleanup.mjs';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:1420';
const output='/tmp/daily-dashboard-startup-updates';await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'dashboard-design-'));
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9454',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
try {
 await waitForHttp('http://127.0.0.1:9454/json/version');const target=await(await fetch('http://127.0.0.1:9454/json/new?about:blank',{method:'PUT'})).json();const cdp=await connectCdp(target.webSocketDebuggerUrl);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
 const evaluate=async expression=>{const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
 const check=async(expression,message)=>{if(!await evaluate(expression))throw Error(message);};
 const click=async selector=>{for(let i=0;i<80;i++){if(await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`))break;await delay(50);}if(!await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`))throw Error('Missing '+selector+' '+await evaluate('document.body.innerText.slice(0,300)'));await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(100);};
 const select=async value=>{await evaluate(`(()=>{const s=document.querySelector('#dashboard-display');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);await delay(80);};

 for(const scenario of ['windows-progress','windows-error','macos-download','notify']){
  const installed=await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`
   window.__calls=[];window.__polls=0;window.__config={updatePreference:'${scenario==='notify'?'notify':scenario==='macos-download'?'auto-download':'auto-install'}',startupUpdatePolicyVersion:2,widgetLayout:{visible:[],order:[],stacks:[]}};
   window.__update={version:'V99.0.0',name:'Update',notes:'Release notes',releaseUrl:'https://github.com/BananaAficionado/DailyDashboard/releases/tag/V99.0.0',assetUrl:'https://api.github.com/repos/BananaAficionado/DailyDashboard/releases/assets/123',assetName:'Daily.Dashboard_99.0.0_x64-setup.exe',assetDigest:'sha256:'+ 'a'.repeat(64),prerelease:false};
   window.__TAURI_INTERNALS__={invoke:async(command,args)=>{window.__calls.push({command,args});
    if(command==='load_initial_config')return{env:{googleClientId:'test'},settings:structuredClone(window.__config)};
    if(command==='startup_update_status'){window.__polls++;return{busy:${scenario==='windows-progress'}&&window.__polls<3,finished:${scenario!=='windows-progress'}||window.__polls>=3,message:'${scenario==='windows-error'?'Startup update: GitHub release check returned HTTP 503.':scenario==='macos-download'?'Update is downloaded and verified. Install manually on macOS.':'Startup update is downloaded and verified.'}',canAutoInstall:${scenario!=='macos-download'},availableUpdate:${scenario==='windows-error'?'null':'window.__update'},downloadedUpdate:${scenario==='windows-error'?'null':"{path:'/cache/updates/setup.exe',assetName:'setup.exe'}"}};}
    if(command==='save_settings'){window.__config=structuredClone(args.settings);return null;}
    if(command==='check_for_updates')return window.__update;
    if(command==='check_for_rollback')return{...window.__update,version:'V0.5.10'};
    if(command==='download_update')return{path:'/cache/updates/setup.exe',assetName:'setup.exe'};
    return null;
   }};
  `});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:400,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate',{url:base+'/?startup-test='+scenario});
  await click('.rail-settings');await click('[aria-controls="settings-updates"]');await delay(1700);
  await check(`!window.__calls.some(call=>['check_for_updates','download_update','install_update'].includes(call.command))`,'frontend must not duplicate the native startup pipeline');
  await check(`!Array.from(document.querySelectorAll('#settings-updates button')).find(button=>button.textContent==='Check now').disabled`,'terminal startup status must release manual controls');
  if(scenario==='windows-progress'){
   await check(`window.__polls>=3&&document.querySelector('.update-status').textContent.includes('verified')`,'startup status polling must reach completion');
   await check(`Array.from(document.querySelectorAll('#settings-updates button')).some(button=>button.textContent==='Install now')`,'native startup download must become available in Settings');
   await evaluate(`Array.from(document.querySelectorAll('#settings-updates button')).find(button=>button.textContent==='Check now').click()`);await delay(150);
   await check(`window.__calls.some(call=>call.command==='check_for_updates'&&call.args.githubToken==null)&&!window.__calls.some(call=>call.command==='install_update')`,'manual public check requires no credentials and does not install');
   await evaluate(`(()=>{document.querySelector('.private-update-access').open=true;const input=document.querySelector('.private-update-access input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'fake-private-token');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(80);
   await evaluate(`Array.from(document.querySelectorAll('#settings-updates button')).find(button=>button.textContent==='Check now').click()`);await delay(150);
   await check(`window.__calls.some(call=>call.command==='check_for_updates'&&call.args.githubToken==='fake-private-token')`,'private releases must retain optional token routing');
   await evaluate(`Array.from(document.querySelectorAll('#settings-updates button')).find(button=>button.textContent==='Find previous release').click()`);await delay(120);
   await evaluate(`Array.from(document.querySelectorAll('#settings-updates button')).find(button=>button.textContent==='Rollback to V0.5.10').click()`);await delay(120);
   await check(`window.__calls.some(call=>call.command==='install_update'&&call.args.pauseAutoUpdates===true&&call.args.installOnReboot===false)`,'rollback must pause automatic startup installation');
  }else if(scenario==='macos-download'){
   await check(`document.querySelector('#settings-updates option[value="auto-install"]').disabled&&!Array.from(document.querySelectorAll('#settings-updates button')).some(button=>button.textContent==='Install now'||button.textContent==='Install next reboot')`,'macOS must omit unsupported installation controls');
  }else if(scenario==='notify'){
   await click('.settings-close-button');
   await check(`document.querySelector('.update-notice')?.textContent.includes('V99.0.0')`, 'notification-only updates must announce the available release outside Settings');
  }else{
   await check(`document.querySelector('.update-status').textContent.includes('HTTP 503')`,'public repository errors should explain the failed request');
  }
  const image=await cdp.send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,scenario+'.png'),Buffer.from(image.result.data,'base64'));
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:installed.result.identifier});
 }
 console.log('PASS native startup status/controls, no duplicate frontend updater, anonymous manual checks and visible update notification, rollback pause and macOS installation omission');
 await cdp.close();
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
