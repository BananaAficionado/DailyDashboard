import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Monitor, RefreshCcw } from 'lucide-react';
export type DisplayBinding = { id: string; name: string };
export type DisplayLockInfo = {
  supported: boolean; displays: {id: string; name: string; bounds: {x: number; y: number; width: number; height: number}; blockedReason?: string | null}[];
  currentId?: string | null; binding?: DisplayBinding | null; status: string;
};
export async function readDisplayLockInfo(): Promise<DisplayLockInfo> {
  const params = new URLSearchParams(location.search);
  if (params.has('mock')) return {supported: params.get('platform') !== 'macos', displays: [
    {id:'windows:mock-ultrawide',name:'Dashboard display',bounds:{x:1920,y:0,width:1280,height:400}},
    {id:'windows:mock-main',name:'Main display',bounds:{x:0,y:0,width:1920,height:1080}},
    {id:'windows:mock-mirror',name:'Mirrored display',bounds:{x:0,y:0,width:1920,height:1080},blockedReason:'Mirrored display'},
  ],currentId:'windows:mock-ultrawide',binding:null,status:'Monitor lock is off'};
  return invoke<DisplayLockInfo>('display_lock_info');
}
export function DisplayLockSetting({ value, onChange, onSupported }: {value?: DisplayBinding | null; onChange: (binding: DisplayBinding | null) => void; onSupported: (supported: boolean) => void}) {
  const [info,setInfo] = useState<DisplayLockInfo | null>(null);
  const [error,setError] = useState('');
  useEffect(() => {
    let active=true;
    const refresh=()=>readDisplayLockInfo().then(result=>{if(active){setInfo(result);onSupported(result.supported);setError('');}}).catch(()=>{if(active)setError('Could not refresh displays. Try again.');});
    void refresh(); const timer=window.setInterval(refresh,2000);
    return ()=>{active=false;window.clearInterval(timer);};
  }, []);
  if (!info?.supported) return null; // Windows-only controls are omitted on macOS.
  const connected=info.displays.some(display=>display.id===value?.id);
  const pick=(id:string)=>{const display=info.displays.find(display=>display.id===id);onChange(display ? {id:display.id,name:display.name} : null);};
  const current=info.displays.find(display=>display.id===info.currentId&&!display.blockedReason);
  return <div className="display-lock-setting">
    <div className="display-lock-heading"><strong><Monitor size={16}/> Dedicated display</strong><button className="icon-button" aria-label="Refresh displays" title="Refresh displays" onClick={()=>readDisplayLockInfo().then(setInfo).catch(()=>setError('Could not refresh displays. Try again.'))}><RefreshCcw size={15}/></button></div>
    <label htmlFor="dashboard-display">Lock Dashboard to a screen</label>
    <select id="dashboard-display" value={value?.id || ''} onChange={event=>pick(event.target.value)}>
      <option value="">Off · normal window</option>
      {value&&!connected?<option value={value.id}>{value.name} · disconnected</option>:null}
      {info.displays.map((display,index)=><option key={`${display.id}-${index}`} value={display.id} disabled={Boolean(display.blockedReason)}>{display.name} · {display.bounds.width} × {display.bounds.height}{display.blockedReason ? ' · unavailable (mirrored or unidentified)' : ''}</option>)}
    </select>
    <div className="display-lock-actions"><button disabled={!current} onClick={()=>current&&pick(current.id)}>Use current screen</button></div>
    <p className="setup-note">Move Dashboard to the desired screen and choose Use current screen, or select a display above. Save to apply. Locked mode fills the chosen screen and hides Dashboard if it disconnects or is mirrored. If recovery fails for 10 seconds, a prompt offers to open unlocked. You can also use the Windows tray menu, the Start menu’s Recover display shortcut, or relaunch with --unlock-display. Relaunching with a missing screen offers recovery immediately.</p>
    <p className="display-lock-status" role="status">{error || info.status}</p>
  </div>;
}
