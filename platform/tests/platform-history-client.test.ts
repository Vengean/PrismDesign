import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PlatformClient,type PlatformContext,type PlatformRequest} from '../../packages/ui/src/studio/platform-client.js';
const context:PlatformContext={protocol:1,sessionId:'s',projectId:'p',requirementId:'r',userId:'owner',role:'editor',projectName:'P',title:'R'};
test('restored access reloads full history instead of keeping a cleared cache with an old cursor',async()=>{
 const paths:string[]=[];let restricted=false;
 const request:PlatformRequest=async<T>(path)=>{paths.push(path);return {session_id:'s',restricted,messages:restricted?[]:[{id:'old',seq:1,body:'old history',role:'user'},{id:'new',seq:2,body:'new history',role:'assistant'}],current_messages:[],events:[],runs:[],active_run:null,next_message_cursor:2,next_event_cursor:8} as T;};
 const client=new PlatformClient(context,request);assert.equal((await client.sync()).messages.length,2);restricted=true;assert.equal((await client.sync()).messages.length,0);restricted=false;assert.equal((await client.sync()).messages.length,2);assert.match(paths[2],/after=0&eventAfter=0/);
});
test('polling and post-send refresh share a pending sync rather than applying out-of-order snapshots',async()=>{
 let count=0,release:()=>void=()=>{};
 const request:PlatformRequest=async<T>()=>{count++;await new Promise<void>(resolve=>{release=resolve;});return {session_id:'s',restricted:false,messages:[],current_messages:[],events:[],runs:[],active_run:null,next_message_cursor:0,next_event_cursor:0} as T;};
 const client=new PlatformClient(context,request);const a=client.sync(),b=client.sync();assert.equal(count,1);release();assert.deepEqual(await a,await b);
});
