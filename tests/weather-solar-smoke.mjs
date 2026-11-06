import {cleanupTestBrowser} from './browser-cleanup.mjs';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const base=process.argv[2] || 'http://127.0.0.1:1420', output='/tmp/daily-dashboard-weather-solar';
await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'dashboard-design-'));
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9453',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
try {
 await waitForHttp('http://127.0.0.1:9453/json/version');
 const target=await(await fetch('http://127.0.0.1:9453/json/new?about:blank',{method:'PUT'})).json();
 const cdp=await connectCdp(target.webSocketDebuggerUrl);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
 const evaluate=async expression=>{const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
 const check=async (expression,message)=>{if(!await evaluate(expression))throw Error(message);};
 const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(120);};
 const screenshot=async name=>{const r=await cdp.send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,name+'.png'),Buffer.from(r.result.data,'base64'));};

 await cdp.send('Emulation.setTimezoneOverride',{timezoneId:'America/Los_Angeles'});
 const phases=[['sunrise','07:30',8],['day','12:00',74.4615],['sunset','17:15',152],['night','22:00',null]];
 let count=0;
 for(const [width,height,scale,dpr] of [[1280,480,100,1],[1280,480,200,1],[1920,600,150,1],[2560,800,200,1],[1280,400,100,2]])for(const size of ['half','tall','wide','full'])for(const [phase,time,expectedX] of phases){
   await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});
   await cdp.send('Page.navigate',{url:`${base}/?mock=1&widget=weather&widgetSize=${size}&scale=${scale}&weatherTime=${encodeURIComponent('2026-07-07T'+time+':00+10:00')}`});
   for(let attempt=0;attempt<80;attempt++){
     if(await evaluate(`Boolean(document.querySelector('.solar-sun'))`))break;
     await delay(25);
   }
   const result=await evaluate(`(()=>{const panel=document.querySelector('.weather-panel'),arc=panel.querySelector('.sunrise-arc'),sun=arc?.querySelector('.solar-sun'),transform=sun?.transform.baseVal.getItem(0).matrix;return{phase:panel.dataset.solarPhase,arcPhase:arc?.dataset.solarPhase,x:transform?.e,y:transform?.f,below:sun?.classList.contains('below-horizon'),night:Number(panel.style.getPropertyValue('--weather-night')),time:panel.querySelector('.solar-time')?.textContent,background:getComputedStyle(panel).backgroundImage};})()`);
   if(result.phase!==phase||result.arcPhase!==phase||!result.time.includes('7:30')||!result.background.includes('gradient'))throw Error('Solar state/time-zone rendering '+JSON.stringify({width,height,scale,size,phase,result}));
   if(expectedX!==null&&Math.abs(result.x-expectedX)>.1)throw Error('Incorrect sun position '+JSON.stringify(result));
   if(phase==='night'&&(!result.below||result.y<=24||result.night!==1))throw Error('Night must dim and put the sun below the horizon');
   if(phase==='day'&&(result.below||result.night!==0))throw Error('Day must restore full brightness');
   await evaluate(`document.querySelector('.sunrise-card').scrollIntoView({block:'nearest'})`);
   if(width===1280&&height===480&&scale===100&&size==='full')await screenshot(phase);
   await click('[title="Next forecast day"]');
   await check(`!document.querySelector('.solar-sun')&&document.querySelector('.weather-panel').dataset.solarPhase==='${phase}'`,'Future forecast must not show a current sun or alter current atmosphere');
   count++;
 }
 console.log('PASS solar marker, sunrise/sunset/night atmosphere, remote time zone and future-day handling: '+count+' state/size/display combinations');
 await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.weatherClockTicks=[];const interval=window.setInterval;window.setInterval=(callback,ms,...args)=>{if(ms===30000)window.weatherClockTicks.push(callback);return interval(callback,ms,...args);};`});
 await cdp.send('Page.navigate',{url:base+'/?mock=1&widget=weather&widgetSize=full'});
 for(let attempt=0;attempt<80;attempt++){if(await evaluate(`Boolean(document.querySelector('.solar-sun'))`))break;await delay(25);}
 for(const [phase,time] of [['sunrise','07:30'],['sunset','17:15'],['night','22:00']]){
   await evaluate(`(()=>{const url=new URL(location.href);url.searchParams.set('weatherTime','2026-07-07T${time}:00+10:00');history.replaceState(null,'',url);window.weatherClockTicks.forEach(tick=>tick());})()`);
   await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   await check(`document.querySelector('.weather-panel').dataset.solarPhase==='${phase}'&&document.querySelector('.sunrise-arc').dataset.solarPhase==='${phase}'`,'Solar clock must update without reloading');
 }
 console.log('PASS live solar clock updates without reloading');
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
