import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LegacyProvider} from '../../packages/agent/src/providers/legacy-provider.js';
test('legacy SDK emits text updates and cancellation closes only the requesting client',async()=>{
 let complete:()=>void=()=>{};const closed:string[]=[];const events:any[]=[];
 const provider=new LegacyProvider('claude','fixture',async(_client,_message,progress,text)=>{progress?.('read');text?.('partial');await new Promise<void>(r=>complete=r);return {success:true,message:'done',filesModified:[]};},()=>{throw Error('must not close all sessions');},id=>{closed.push(id);complete();});
 const controller=new AbortController();const run=provider.run('client-A','run-A','hello',e=>events.push(e),controller.signal);controller.abort();await assert.rejects(run);
 assert.deepEqual(closed,['client-A']);assert.ok(events.some(e=>e.type==='message.delta'&&e.delta==='partial'));assert.equal(provider.capabilities.cancel,true);
 provider.clearSession('client-B');assert.deepEqual(closed,['client-A','client-B']);
});
