import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname,relative} from 'node:path';
import {cleanupTestBrowser} from './browser-cleanup.mjs';

const config=JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json',import.meta.url),'utf8'));
const policy=Object.entries(config.app.security.csp).map(([name,value])=>`${name} ${Array.isArray(value)?value.join(' '):value}`).join('; ');
const dist=resolve('dist');
await access(join(dist,'index.html'));
const server=createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',policy);
  if(req.url==='/safe.js'){res.setHeader('Content-Type','text/javascript');res.end('window.trustedScriptLoaded=true;');return;}
  const url=new URL(req.url,'http://127.0.0.1');
  const file=resolve(dist,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(relative(dist,file).startsWith('..')){res.writeHead(403).end();return;}
  try{
    const bytes=await readFile(file);
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');
    res.end(bytes);
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(join(tmpdir(),'dashboard-design-'));
const executable=process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
let cdp;
try{
  let port;
  for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await delay(100);}}
  assert.ok(port,'Chrome did not start');
  const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  cdp=await connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.securityViolations=[];document.addEventListener('securitypolicyviolation',e=>window.securityViolations.push(e.effectiveDirective));`});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:480,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?mock=1`});
  for(let i=0;i<100;i++){if(await evaluate('Boolean(document.querySelector(".spotify-panel .track-copy"))'))break;await delay(100);}
  assert.equal(await evaluate('document.querySelectorAll(".widget-slot").length'),3,'dashboard must render under production CSP');
  const result=await evaluate(`(async()=>{
    const safe=document.createElement('script');safe.src='/safe.js';await new Promise(resolve=>{safe.onload=resolve;safe.onerror=resolve;document.head.append(safe)});
    const inline=document.createElement('script');inline.textContent='window.untrustedScriptLoaded=true';document.head.append(inline);
    const external=document.createElement('script');external.src='https://example.com/untrusted.js';await new Promise(resolve=>{external.onload=resolve;external.onerror=resolve;document.head.append(external)});
    let externalFetchBlocked=false;try{await fetch('https://example.com/collect')}catch{externalFetchBlocked=true}
    const img=new Image();img.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';const dataImageLoaded=await new Promise(resolve=>{img.onload=()=>resolve(true);img.onerror=()=>resolve(false)});
    await new Promise(resolve=>setTimeout(resolve,100));
    return {trusted:window.trustedScriptLoaded===true,untrusted:window.untrustedScriptLoaded===true,externalFetchBlocked,dataImageLoaded,violations:window.securityViolations};
  })()`);
  assert.equal(result.trusted,true,'bundled self-hosted JavaScript must load');
  assert.equal(result.untrusted,false,'injected inline JavaScript must be blocked');
  assert.equal(result.externalFetchBlocked,true,'unknown network destinations must be blocked');
  assert.equal(result.dataImageLoaded,true,'local album artwork must remain usable');
  assert.ok(result.violations.some(x=>x.startsWith('script-src')));
  assert.ok(result.violations.includes('connect-src'));
  console.log('Production CSP checks passed: dashboard renders; injected scripts and unknown connections are blocked.');
}finally{
  if(cdp)cdp.close();
  await cleanupTestBrowser(chrome,profile);
  await new Promise(resolve=>server.close(resolve));
}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function evaluate(expression){const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;}
async function connect(url){
 const ws=new WebSocket(url);const pending=new Map();let id=0;
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.id&&pending.has(r.id)){const p=pending.get(r.id);pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result);}});
 return {send(method,params={}){const next=++id;return new Promise((resolve,reject)=>{pending.set(next,{resolve,reject});ws.send(JSON.stringify({id:next,method,params}));});},close(){ws.close();}};
}
