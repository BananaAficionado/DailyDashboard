import { cleanupTestBrowser } from "./browser-cleanup.mjs";
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = process.argv[2] || 'http://127.0.0.1:1420';
const output = '/tmp/daily-dashboard-widget-matrix';
const enabledWidgets=['calendar','spotify','clock','weather','aircraft','terminal'];
const widgets=process.env.MATRIX_WIDGETS ? process.env.MATRIX_WIDGETS.split(',') : enabledWidgets;
if(!widgets.length||widgets.some(widget=>!enabledWidgets.includes(widget)))throw new Error('Choose enabled widget names for MATRIX_WIDGETS');
await mkdir(output, {recursive:true});
const profile = await mkdtemp(join(tmpdir(), 'dashboard-matrix-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9448',`--user-data-dir=${profile}`,'about:blank'], {stdio:'ignore'});
const matrix = [[1280,400,75], [1280,400,100], [1280,480,100], [1280,480,200],
  [1920,600,100], [1920,600,150], [1920,600,200], [1920,720,100], [1920,720,150], [1920,720,200],
  [2560,800,100], [2560,800,125], [2560,800,150], [2560,800,175], [2560,800,200],
  [2048,640,100,1.25], [1707,533,100,1.5], [1463,457,100,1.75], [1280,400,100,2]];
let count = 0;
try {
  await waitForHttp('http://127.0.0.1:9448/json/version');
  const target = await (await fetch('http://127.0.0.1:9448/json/new?about:blank',{method:'PUT'})).json();
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const configurations = process.env.MATRIX_QUICK ? [matrix[2], matrix[3], matrix[6], matrix[14], matrix[18]] : matrix;
  for (const [width,height,scale,dpr=1] of configurations) {
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});
    for (const widget of widgets) for (const size of ['half','tall','wide','full']) {
      const label = `${width}x${height}-${scale}-dpr${dpr}-${widget}-${size}`;
      await cdp.send('Page.navigate',{url:`${base}/?mock=1&widget=${widget}&widgetSize=${size}&scale=${scale}&calendarStress=1`});
      await cdp.send("Input.dispatchMouseEvent", {type:"mouseMoved",x:1,y:1});
      await waitForWidget(widget, size, scale);
      const result = await evaluate(`(() => {
        const slot=document.querySelector('[data-widget="${widget}"]'); const r=slot?.getBoundingClientRect();
        const header=slot?.querySelector('.topbar,.spotify-header,.clock-widget-header,.weather-header,.aircraft-header,.terminal-header');
        const buttons=[...(header?.querySelectorAll('button,select')||[])].filter(node=>node.getClientRects().length);
        const metrics={slot:r?.toJSON(),header:header?.getBoundingClientRect().toJSON(),buttons:buttons.map(button=>({title:button.title||button.textContent,rect:button.getBoundingClientRect().toJSON()}))};
        if (!r || !slot.classList.contains('widget-size-${size}') || r.left<-.5 || r.top<-.5 || r.right>innerWidth+1 || r.bottom>innerHeight+1 || slot.scrollWidth>slot.clientWidth+1) return {error:'widget frame containment',metrics};
        if (!buttons.every(button=>{const b=button.getBoundingClientRect();return b.width>0 && b.left>=r.left-1 && b.right<=r.right+1 && b.top>=r.top-1 && b.bottom<=r.bottom+1;})) return {error:'header control containment',metrics};
        const mapControls=[...slot.querySelectorAll('.map-controls button,.aircraft-map-toolbar button')];
        for(const button of mapControls){const rect=button.getBoundingClientRect(),map=button.closest('.interactive-map,.aircraft-map-wrap').getBoundingClientRect();if(rect.left<map.left-1||rect.right>map.right+1||rect.top<map.top-1||rect.bottom>map.bottom+1)return {error:'map control clipping',control:button.title||button.textContent,rect:rect.toJSON(),map:map.toJSON(),metrics};}
        if ('${widget}'==='calendar') {
          const timeline=slot.querySelector('.calendar-timeline'), grid=slot.querySelector('.time-grid'), g=grid.getBoundingClientRect();
          const columns=[...grid.querySelectorAll('.day-column')], headers=[...slot.querySelectorAll('.day-heading')];
          if(!columns.every((column,index)=>{const c=column.getBoundingClientRect(),h=headers[index].getBoundingClientRect();return Math.abs(c.left-h.left)<1&&Math.abs(c.right-h.right)<1;}))return {error:'date and event columns misaligned',metrics};
          if(!headers.every(header=>{const h=header.getBoundingClientRect();return [...header.children].every(node=>{const r=node.getBoundingClientRect();return r.top>=h.top-.5&&r.bottom<=h.bottom+.5;});}))return {error:'date label clipping',metrics};
          const allDay=slot.querySelector('.all-day-row').getBoundingClientRect();
          for(const button of slot.querySelectorAll('.event-pill')){const a=button.getBoundingClientRect();if(a.width<.5||a.top<allDay.top-.5||a.bottom>allDay.bottom+.5)return {error:'all-day event hidden',metrics};}
          for(const cell of slot.querySelectorAll('.all-day-cell')){const pills=[...cell.querySelectorAll('.event-pill')].map(node=>node.getBoundingClientRect());if(!pills.every((r,i)=>pills.slice(i+1).every(o=>r.right<=o.left+.3||o.right<=r.left+.3||r.bottom<=o.top+.3||o.bottom<=r.top+.3)))return {error:'all-day overlap',metrics};}
          const required=['opening','overlap-a','overlap-b','short','midday','adjacent-a','adjacent-b','evening','six-pm','long'];
          if (timeline.dataset.startHour!=='9'||timeline.dataset.endHour!=='18'||g.height<15||timeline.scrollHeight>timeline.clientHeight+1) return {error:'9am–6pm fit',metrics,grid:g.toJSON(),timeline:[timeline.clientHeight,timeline.scrollHeight]};
          for (const id of required) {
            const event=grid.querySelector('[data-event-id="mock:stress-'+id+'"]'); const e=event?.getBoundingClientRect();
            if (!e||e.width<.5||e.height<1||e.top<g.top-.5||e.bottom>g.bottom+.5) return {error:'missing or clipped meeting '+id,metrics,event:e?.toJSON(),grid:g.toJSON()};
            const hit=document.elementFromPoint(e.x+e.width/2,e.y+e.height/2);
            if (!(hit===event||event.contains(hit))) return {error:'obstructed meeting '+id,hit:hit?.outerHTML.slice(0,150),metrics};
          }
          for (const column of grid.querySelectorAll('.day-column')) {
            const events=[...column.querySelectorAll('.timed-event')].map(node=>node.getBoundingClientRect());
            if (!events.every((e,i)=>events.slice(i+1).every(o=>e.right<=o.left+.3||o.right<=e.left+.3||e.bottom<=o.top+.3||o.bottom<=e.top+.3))) return {error:'meeting overlap',metrics};
          }
          const first=slot.querySelector('.time-label.first').getBoundingClientRect(), last=slot.querySelector('.time-label.last').getBoundingClientRect();
          if(first.top<g.top-.5||last.bottom>g.bottom+.5||first.bottom>last.top+.5) return {error:'workday labels clipped',metrics,grid:g.toJSON()};
        }
        return {pass:true};
      })()`);
      if (!result?.pass) { await screenshot(label+'-failure'); throw new Error(label+' '+JSON.stringify(result)); }
      if (widget==='calendar') {
        await click('.calendar-workday-footer button');
        if(!await evaluate(`document.querySelector('.calendar-timeline').dataset.endHour==='24'&&Boolean(document.querySelector('[data-event-id="mock:stress-outside"]'))`)) throw new Error(label+' full-day access failed');
        await setCalendarView('work');
        const work=await evaluate(`(() => {const calendar=document.querySelector('[data-widget=calendar]'),timeline=calendar.querySelector('.calendar-timeline'),headers=[...calendar.querySelectorAll('.day-heading')],grid=calendar.querySelector('.time-grid').getBoundingClientRect();return {pass:headers.map(node=>node.dataset.weekday).join(',')==='1,2,3,4,5'&&timeline.dataset.startHour==='9'&&timeline.dataset.endHour==='18'&&!calendar.querySelector('.calendar-workday-footer button')&&!calendar.querySelector('[data-event-id="mock:stress-six-pm"]')&&!calendar.querySelector('[data-event-id="mock:stress-outside"]')&&[...calendar.querySelectorAll('.timed-event')].every(node=>{const r=node.getBoundingClientRect();return r.top>=grid.top-.5&&r.bottom<=grid.bottom+.5;}),days:headers.map(node=>node.dataset.date)};})()`);
        if(!work.pass){await screenshot(label+'-work-failure');throw new Error(label+' Work mode '+JSON.stringify(work));}
        await screenshot(label+'-work');
        if(width===1280&&height===480&&scale===100&&size==='full'){
          await click('.rail-settings');await click('.settings-nav button[aria-controls="settings-calendar"]');
          if(!await evaluate(`document.querySelector('.calendar-display-summary select').value==='work'`))throw new Error('Work mode is not reflected in Settings');
          await click('.settings-close-button');await click('.topbar button[title="Hide Calendar"]');await click('.rail-button[title="Calendar"]');
          if(!await evaluate(`document.querySelector('.calendar-timeline').dataset.workMode==='true'&&document.querySelectorAll('.day-heading').length===5`))throw new Error('Work mode did not survive reopening calendar');
        }
        const firstDate=work.days[0];await click('.topbar button[title="Next"]');
        const nextDate=await evaluate(`document.querySelector('.day-heading').dataset.date`);
        if((Date.parse(nextDate)-Date.parse(firstDate))/86400000!==7)throw new Error(label+' Work navigation must advance one week');
        await click('.topbar button[title="Previous"]');
        await setCalendarView('week');
        if(await evaluate(`document.querySelector('.calendar-timeline').dataset.endHour==='24'`))await click('.calendar-workday-footer button');
      }
      if (widget==='spotify') {
        const controlsFit=await evaluate(`(() => {const panel=document.querySelector('.spotify-panel'),p=panel.getBoundingClientRect(),buttons=[...panel.querySelectorAll('.player-controls button')].map(n=>n.getBoundingClientRect());return buttons.length===7&&buttons.every((r,i)=>r.width>0&&r.left>=p.left-.5&&r.right<=p.right+.5&&r.top>=p.top-.5&&r.bottom<=p.bottom+.5&&buttons.slice(i+1).every(o=>r.right<=o.left+.5||o.right<=r.left+.5));})()`);
        if(!controlsFit){await screenshot(label+'-controls-failure');throw new Error(label+' seven Spotify controls overlap or clip');}

        const artGeometry=await evaluate(`(() => {const panel=document.querySelector('.spotify-panel'),cover=panel.querySelector('.cover-wrap').getBoundingClientRect(),p=panel.getBoundingClientRect(),scrubber=panel.querySelector('.scrubber').getBoundingClientRect();return {pass:cover.top>=p.top-1&&cover.bottom<=scrubber.top+1&&cover.right<=p.right+1,cover:cover.toJSON(),scrubber:scrubber.toJSON()};})()`);
        if(!artGeometry.pass){await screenshot(label+'-art-overlap');throw new Error(label+' album art '+JSON.stringify(artGeometry));}
        await click('.album-art-toggle');
        const music=await evaluate(`(() => {const panel=document.querySelector('[data-widget=spotify] .spotify-panel'),p=panel.getBoundingClientRect(); const items=[...panel.querySelectorAll('.track-copy,.scrubber,.time-row,.player-controls')].map(node=>node.getBoundingClientRect());return {pass:panel.classList.contains('without-art')&&!panel.querySelector('.cover-wrap')&&items.every(rect=>rect.top>=p.top-1&&rect.bottom<=p.bottom+1)&&items.every((rect,i)=>items.slice(i+1).every(next=>rect.bottom<=next.top+1)),items:items.map(r=>r.toJSON()),panel:p.toJSON()};})()`);
        if(!music.pass){await screenshot(label+'-no-art-failure');throw new Error(label+' no-art '+JSON.stringify(music));}
        await screenshot(label+'-no-art');
        await click('.album-art-toggle');
        if(!await evaluate(`Boolean(document.querySelector('.spotify-panel.with-art .cover-wrap'))`)) throw new Error(label+' art did not restore');
      }
      if(widget==='weather') {
        const weather=await evaluate(`(() => {const panel=document.querySelector('.weather-panel'),content=panel.querySelector('.weather-content'),header=panel.querySelector('.weather-header'),before=header.getBoundingClientRect().top;content.scrollTop=9999;const after=header.getBoundingClientRect().top;content.scrollTop=0;const labels=[...panel.querySelectorAll('.weather-graph-time-axis span')].filter(node=>node.getClientRects().length).map(node=>node.getBoundingClientRect());const readable=labels.every((r,i)=>labels.slice(i+1).every(o=>r.right<=o.left+.3||o.right<=r.left+.3));const cards=[...panel.querySelectorAll('.weather-metric')];const cardsFit=cards.length===4&&cards.every(card=>{const c=card.getBoundingClientRect();return card.scrollWidth<=card.clientWidth+1&&[...card.querySelectorAll('h3,strong,p,.metric-subtitle,.uv-spectrum,.sunrise-arc')].every(node=>{const n=node.getBoundingClientRect();return n.left>=c.left-.5&&n.right<=c.right+.5&&n.top>=c.top-.5&&n.bottom<=c.bottom+.5;});});const graph=panel.querySelector('.weather-day-graph');return {pass:cardsFit&&graph.getClientRects().length>0&&readable&&Math.abs(before-after)<.5&&content.scrollWidth<=content.clientWidth+1&&panel.scrollHeight<=panel.clientHeight+1,cardsFit,readable,headerMovement:before-after,cardBounds:cards.map(card=>({bounds:card.getBoundingClientRect().toJSON(),children:[...card.querySelectorAll('h3,strong,p,.metric-subtitle,.uv-spectrum,.sunrise-arc')].map(node=>({class:node.className,text:node.textContent,rect:node.getBoundingClientRect().toJSON()}))})),content:[content.clientWidth,content.scrollWidth],panel:[panel.clientHeight,panel.scrollHeight]};})()`);
        if(!weather.pass){await screenshot(label+'-content-failure');throw new Error(label+' weather content '+JSON.stringify(weather));}
        await screenshot(label);
        await evaluate(`document.querySelector('.weather-day-graph').scrollIntoView({block:'start'})`);
        for(const fraction of [0,.5,1]){
          const point=await evaluate(`(()=>{const r=document.querySelector('.weather-day-graph').getBoundingClientRect();return{x:r.left+Math.max(.5,Math.min(r.width-.5,r.width*${fraction})),y:r.top+12}})()`);
          await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
          await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          const expected=Math.round(fraction*23);
          const readout=await evaluate(`(()=>{const graph=document.querySelector('.weather-day-graph'),g=graph.getBoundingClientRect(),readout=graph.querySelector('.weather-graph-readout'),r=readout?.getBoundingClientRect(),line=graph.querySelector('.weather-graph-crosshair')?.getBoundingClientRect(),content=graph.closest('.weather-content').getBoundingClientRect();return{pass:readout?.dataset.hourIndex==='${expected}'&&readout.textContent.includes('${12+Math.round(Math.sin(expected/24*Math.PI)*8)}°C')&&readout.textContent.includes('${expected%4===0?64:expected%3===0?35:8}%')&&r.left>=g.left-.5&&r.right<=g.right+.5&&r.top>=content.top-.5&&r.bottom<=content.bottom+.5&&Math.abs(line.left-(g.left+g.width*${expected}/23))<1.5,readout:r?.toJSON(),graph:g.toJSON(),content:content.toJSON()};})()`);
          if(!readout.pass){await screenshot(label+'-hover-failure');throw new Error(label+' graph hover '+JSON.stringify(readout));}
        }
        await screenshot(label+'-hover');
        await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        if(!await evaluate(`!document.querySelector('.weather-graph-readout')`))throw new Error(label+' graph hover did not dismiss');
        await evaluate(`document.querySelector('.weather-day-graph').focus()`);
        for(const [key,index] of [['Home',0],['End',23],['ArrowLeft',22]]){
          await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key});
          if(!await evaluate(`document.querySelector('.weather-graph-readout')?.dataset.hourIndex==='${index}'`))throw new Error(label+' graph keyboard '+key);
        }
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
        if(!await evaluate(`!document.querySelector('.weather-graph-readout')`))throw new Error(label+' graph Escape dismissal');
        await evaluate(`document.querySelector('.weather-day-graph').blur()`);
        await click('.forecast-controls button:last-child');
        if(!await evaluate(`document.querySelectorAll('.five-day-forecast .forecast-day').length===5&&getComputedStyle(document.querySelector('.five-day-forecast')).display!=='none'`))throw new Error(label+' five-day overview not visible');
        await screenshot(label+'-five-days');
        await click('.weather-rain-history-toggle');
        if(!await evaluate(`Boolean(document.querySelector('.rain-history-1h'))&&document.querySelector('.weather-content').scrollTop===0`))throw new Error(label+' rainfall hour mode');
        await click('.weather-rain-history-toggle');
        if(!await evaluate(`document.querySelectorAll('.rain-history-24h .rain-history-column').length===24`))throw new Error(label+' rainfall 24h mode');
        await screenshot(label+'-rain');
        await click('.weather-rain-history-toggle');
        await click('.forecast-controls button:last-child');
        await click('.weather-radar-toggle');
        const radar=await evaluate(`(() => {const page=document.querySelector('.weather-radar-page'),map=page?.querySelector('.interactive-map'),p=page?.getBoundingClientRect(),m=map?.getBoundingClientRect();const legend=page.querySelector('.radar-map-legend').getBoundingClientRect(),controls=map.querySelector('.map-controls').getBoundingClientRect();return {pass:p&&m&&m.height>10&&legend.left>=m.left-.5&&legend.top>=m.top-.5&&legend.right<=m.right+.5&&legend.bottom<=m.bottom+.5&&(legend.right<=controls.left||legend.bottom<=controls.top||legend.top>=controls.bottom)&&m.top>=p.top-.5&&m.bottom<=p.bottom+.5&&[...map.querySelectorAll('.map-controls button')].every(node=>{const r=node.getBoundingClientRect();return r.top>=m.top-.5&&r.bottom<=m.bottom+.5;}),map:m?.toJSON(),page:p?.toJSON()};})()`);
        if(!radar.pass){await screenshot(label+'-radar-failure');throw new Error(label+' radar '+JSON.stringify(radar));}
        await screenshot(label+'-radar');
        const playbackTitle=await evaluate(`document.querySelector('.radar-playback').title`);
        await click('.radar-playback');
        if(!await evaluate(`document.querySelector('.radar-playback').title!==${JSON.stringify(playbackTitle)}`))throw new Error(label+' radar playback toggle');
        await click('.weather-radar-toggle');
      }
      if (widget==='calendar'||widget==='spotify'||((width===1280&&scale===100)||(width===2560&&scale===200))) await screenshot(label);
      if(widget==='spotify') for(const state of ['idle','disconnected']){
        await cdp.send('Page.navigate',{url:`${base}/?mock=1&widget=spotify&widgetSize=${size}&scale=${scale}&musicState=${state}`});
        await cdp.send("Input.dispatchMouseEvent", {type:"mouseMoved",x:1,y:1});
        await waitForWidget(widget, size, scale);
        const empty = await evaluate(`(() => {const slot=document.querySelector('[data-widget=spotify]');if(!slot)return false;const s=slot.getBoundingClientRect();return !slot.querySelector('.cover-wrap')&&[...slot.querySelectorAll('.track-copy,.spotify-connect-button')].every(node=>{const r=node.getBoundingClientRect();return r.top>=s.top-1&&r.bottom<=s.bottom+1;});})()`);
        if(!empty){await screenshot(label+'-'+state+'-failure');throw new Error(label+' '+state+' empty music layout');}
      }
      if(widget==='weather')for(const state of ['loading','setup']){
        await cdp.send('Page.navigate',{url:`${base}/?mock=1&widget=weather&widgetSize=${size}&scale=${scale}&weatherState=${state}`});
        await waitForWidget(widget,size,scale);
        if(!await evaluate(`Boolean(document.querySelector('.weather-setup'))&&Boolean(document.querySelector('.weather-header button[title="Hide Weather"]'))&&document.querySelector('.weather-content').scrollWidth<=document.querySelector('.weather-content').clientWidth+1`)){await screenshot(label+'-'+state+'-failure');throw new Error(label+' '+state+' weather layout');}
      }
      count++;
    }
    console.log(`PASS ${width}x${height} / ${scale}% / DPR ${dpr}: ${widgets.length} widgets × four sizes; Work calendar, weather views and music modes`);
  }
  console.log(`Widget matrix passed: ${count} widget/size/display combinations.`);
  await cdp.close();
  async function setCalendarView(mode){
    await evaluate(`(() => {const select=document.querySelector('.calendar-view-select');if(getComputedStyle(select).display!=='none'){select.value='${mode}';select.dispatchEvent(new Event('change',{bubbles:true}));}else{[...document.querySelectorAll('.segmented button')].find(button=>button.textContent.trim()==='${mode[0].toUpperCase()+mode.slice(1)}').click();}})()`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  }
  async function waitForWidget(widget,size,scale){
    for(let attempt=0;attempt<80;attempt++){
      if(await evaluate(`Boolean(document.querySelector('[data-widget="${widget}"].widget-size-${size}'))&&Boolean(document.querySelector('.app-scale-${scale}'))`)){
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');return;
      }
      await delay(25);
    }
    throw new Error(`${widget}/${size}/${scale} did not become ready`);
  }
  async function evaluate(expression){const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw new Error(r.result.exceptionDetails.text);return r.result.result.value;}
  async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');}
  async function screenshot(name){const r=await cdp.send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,name+'.png'),Buffer.from(r.result.data,'base64'));}
}finally{await cleanupTestBrowser(chrome, profile);}

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
