import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { localCommandValue, localMediaItem, normalizeSpotifyMode } from '../src/spotifyLocal.ts';
const template = await readFile(new URL('../integrations/spotify/daily-dashboard-bridge.js', import.meta.url), 'utf8');
assert.equal(normalizeSpotifyMode(undefined), 'auto'); assert.equal(normalizeSpotifyMode('local'), 'local');
assert.equal(localMediaItem({title:'Native',artist:'Artist',album:'Album',uri:'',durationMs:10,artworkUrl:''}).id, '');
assert.equal(localMediaItem({title:''}), null);
assert.equal(localCommandValue('toggle',undefined,{is_playing:true},false),0);
assert.equal(localCommandValue('save',undefined,{is_playing:false},false),1);
assert.equal(localCommandValue('repeat',undefined,{is_playing:true,repeat_state:2},false),0);
let called = false;
await vm.runInNewContext(template, { fetch(){called=true;} }); assert.equal(called,false,'unpaired template is inactive');
const uri='spotify:track:6rqhFgbbKwnb9MLmUQDhG6';
const state={playing:true,liked:false,shuffle:false,repeat:0,volume:.5,progress:100}; const calls=[];
const player={data:{item:{uri,metadata:{title:'Example',artist_name:'Artist',album_title:'Album',image_url:'spotify:image:abc'}}},
  getDuration:()=>10000,getProgress:()=>state.progress,isPlaying:()=>state.playing,getHeart:()=>state.liked,getShuffle:()=>state.shuffle,getRepeat:()=>state.repeat,getVolume:()=>state.volume,
  play:()=>{state.playing=true;calls.push('play');},pause:()=>{state.playing=false;calls.push('pause');},next:()=>calls.push('next'),back:()=>calls.push('back'),
  setHeart:v=>{state.liked=v;calls.push('save');},setShuffle:v=>{state.shuffle=v;calls.push('shuffle');},setRepeat:v=>{state.repeat=v;calls.push('repeat');},
  setVolume:v=>{state.volume=v;calls.push('volume');},seek:v=>{state.progress=v;calls.push('seek');}};
const command=(id,action,value,expectedUri=uri)=>({id,action,value,expectedUri,expiresAt:Date.now()+4000});
const batches=[[
  command(1,'save',1),command(2,'shuffle',1),command(3,'repeat',2),command(4,'toggle',0),command(5,'seek',5000),command(6,'volume',70),
  command(7,'save',0,'spotify:track:0000000000000000000000'),command(8,'eval',1),{...command(9,'next'),expiresAt:0},command(1,'save',0)
],[]];
const polls=[]; let complete;
const finished=new Promise(resolve=>complete=resolve);
vm.runInNewContext(template.replace('__DASHBOARD_PAIRING_TOKEN__','private-test-key'),{
  Spicetify:{Player:player},AbortSignal,Date, setTimeout:(fn)=>setTimeout(fn,0),
  fetch:async (url,options)=>{
    assert.equal(url,'http://127.0.0.1:47691/poll');polls.push(JSON.parse(options.body));
    if(polls.length===3){complete();return new Promise(()=>{});}
    return {ok:true,json:async()=>({commands:batches.shift()})};
  }
});
await Promise.race([finished,new Promise((_,reject)=>setTimeout(()=>reject(Error('connector timed out')),3000))]);
assert.deepEqual(calls,['save','shuffle','repeat','pause','seek','volume']);
assert.equal(polls[0].snapshot.artworkUrl,'https://i.scdn.co/image/abc');
assert.equal(polls[0].snapshot.controls.save,true);
assert.equal(polls[1].snapshot.liked,true); assert.equal(polls[1].snapshot.shuffle,true); assert.equal(polls[1].snapshot.repeat,2);
assert.deepEqual(polls[1].acknowledgements.map(a=>a.ok),[true,true,true,true,true,true,false,false,false,false]);
assert.equal(polls[2].acknowledgements.length,0,'acknowledgements cleared only after successful poll');
console.log('Local Spotify model, connector confirmations, track-change/expiry/duplicate guards passed');
