import assert from 'node:assert/strict';
import {loadStoredTokens,tokenKeys} from '../src/tokenStorage.ts';
const token={accessToken:'example-access',refreshToken:'example-refresh',expiresAt:1900000000000};
function fixture(values={}) { const data=new Map(Object.entries(values));return {data,getItem:k=>data.get(k)??null,removeItem:k=>data.delete(k)}; }
{
 const legacy=fixture({[tokenKeys.google]:JSON.stringify(token)});const saved={};const calls=[];
 const result=await loadStoredTokens(async(command,args)=>{calls.push(command);if(command==='load_saved_tokens')return saved;saved[args.provider]=args.token;},legacy);
 assert.deepEqual(result.google,token);assert.deepEqual(saved.google,token);assert.equal(legacy.data.size,0);assert.deepEqual(calls,['load_saved_tokens','save_saved_token']);
}
{
 const legacy=fixture({[tokenKeys.google]:JSON.stringify(token)});
 await assert.rejects(loadStoredTokens(async command=>{if(command==='load_saved_tokens')return {};throw Error('Credential store locked');},legacy),/locked/);
 assert.equal(legacy.getItem(tokenKeys.google),JSON.stringify(token),'a failed migration must preserve the legacy token');
}
{
 const legacy=fixture({[tokenKeys.google]:JSON.stringify({...token,accessToken:'stale'}),[tokenKeys.spotify]:'not JSON',[tokenKeys.microsoft]:JSON.stringify({accessToken:'invalid'})});
 const result=await loadStoredTokens(async command=>{assert.equal(command,'load_saved_tokens');return {google:token};},legacy);
 assert.deepEqual(result.google,token);assert.equal(result.microsoft,null);assert.equal(result.spotify,null);assert.equal(legacy.data.size,0);
}
{
 const legacy=fixture({[tokenKeys.google]:JSON.stringify(token)});
 await assert.rejects(loadStoredTokens(async()=>{throw Error('Credential file authentication failed');},legacy));
 assert.equal(legacy.data.size,1,'vault read errors must not discard old tokens');
}
console.log('Token storage migration checks passed.');
