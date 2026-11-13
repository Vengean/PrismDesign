import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import {PlatformClient,type PlatformConversation,type PlatformContext,type PlatformRequest} from '../../packages/ui/src/studio/platform-client.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'prism-history-'));
process.env.PRISM_DATA_DIR=root;process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='fixture';
const {getDb,createUser}=await import('../src/services/db.js');
const {initProjectTables,createProject,emptyConfig}=await import('../src/services/projects.js');
const {initConversationTables,readConversation,readConversationForRole}=await import('../src/services/conversations.js');
const {handlePreviewClient}=await import('../src/services/preview-client.js');
const {default:routes}=await import('../src/routes/conversations.js');
const {signToken}=await import('../src/middleware/auth.js');
await initProjectTables();await initConversationTables();await createUser('viewer','fixture');
const projectId=await createProject('History','','owner',[{userId:'viewer',role:'viewer'}],emptyConfig),id=crypto.randomUUID(),sessionId=crypto.randomUUID();
await getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,projectId,'History','','','owner');
await getDb().prepare('INSERT INTO project_sessions(id,requirement_id) VALUES(?,?)').run(sessionId,id);
await getDb().transaction(async()=>{
 for(let i=1;i<=25;i++){await getDb().prepare("INSERT INTO conversation_runs(id,requirement_id,session_id,user_id,request_id,status,cancel_supported) VALUES(?,?,?,?,?,'succeeded',1)").run('run-'+i,id,sessionId,'owner','request-'+i);await getDb().prepare("INSERT INTO conversation_events(session_id,run_id,type,data) VALUES(?,?,'run.finished',?)").run(sessionId,'run-'+i,JSON.stringify({runId:'run-'+i,status:'succeeded'}));}
 for(let i=1;i<=205;i++)await getDb().prepare('INSERT INTO conversation_messages(id,session_id,run_id,role,user_id,body,mentions) VALUES(?,?,?,?,?,?,?)').run('m'+i,sessionId,i<=2?'run-1':null,i%2?'user':'assistant',i%2?'owner':null,'Message '+i,JSON.stringify(i===10?['owner']:i===185?['owner-extra']:[]));
})();
after(async()=>{await getDb().close();fs.rmSync(root,{recursive:true,force:true});});
const context:PlatformContext={protocol:1,projectId,requirementId:id,sessionId,projectName:'History',title:'History',userId:'owner',role:'admin'};
async function snapshot(query:URLSearchParams){return await readConversationForRole(id,'admin',Number(query.get('after')||0),Number(query.get('eventAfter')||0),{latest:query.get('latest')==='1',before:query.has('before')?Number(query.get('before')):undefined,userId:'owner'}) as PlatformConversation;}

test('latest and backward pages are bounded, chronological and complete; older run details and mentions remain available',async()=>{
 const latest=await readConversation(id,0,0,{latest:true,userId:'owner'});
 assert.deepEqual(latest.messages.map(message=>message.seq),Array.from({length:50},(_,i)=>i+156));assert.equal(latest.next_message_cursor,205);assert.equal(latest.oldest_message_cursor,156);assert.equal(latest.has_more_history,true);assert.deepEqual(latest.latest_mention,{id:'m10',seq:10});assert.equal(latest.current_messages.length,2);assert.ok(!latest.runs.some(run=>run.id==='run-1'));
 let page=latest;const sequences=latest.messages.map(message=>message.seq);
 while(page.has_more_history){page=await readConversation(id,0,0,{before:page.oldest_message_cursor});assert.ok(page.messages.length<=50);sequences.unshift(...page.messages.map(message=>message.seq));}
 assert.deepEqual(sequences,Array.from({length:205},(_,i)=>i+1));assert.equal(new Set(sequences).size,205);assert.ok(page.runs.some(run=>run.id==='run-1'));assert.equal(page.oldest_message_cursor,1);
 await assert.rejects(()=>readConversation(id,0,0,{before:-1}),/游标/);
 const restricted=await readConversationForRole(id,'viewer',0,0,{latest:true,userId:'viewer'});assert.deepEqual(restricted.messages,[]);assert.ok(!('latest_mention' in restricted));
});

test('active work outside the latest page retains its status and cancellation metadata',async()=>{
 await getDb().prepare("UPDATE conversation_runs SET status='running' WHERE id='run-1'").run();
 try{const latest=await readConversation(id,0,0,{latest:true});assert.equal(latest.active_run?.id,'run-1');assert.equal(latest.runs.find(run=>run.id==='run-1')?.cancel_supported,1);assert.equal(latest.messages.length,50);assert.ok(!latest.current_messages.some(message=>message.run_id==='run-1'));}
 finally{await getDb().prepare("UPDATE conversation_runs SET status='succeeded' WHERE id='run-1'").run();}
});

test('management and preview endpoints validate history cursors, session ownership and viewer permissions',async()=>{
 const app=express();app.use('/api/projects/:id/requirements/:requirementId/conversation',routes);
 const management=http.createServer(app),preview=http.createServer((req,res)=>{void handlePreviewClient(req,res,id,String(req.headers['x-user']||'owner'));});
 await Promise.all([new Promise<void>(resolve=>management.listen(0,'127.0.0.1',resolve)),new Promise<void>(resolve=>preview.listen(0,'127.0.0.1',resolve))]);
 const base=(server:http.Server)=>`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{for(const surface of ['management','preview']){
  const url=surface==='management'?base(management)+`/api/projects/${projectId}/requirements/${id}/conversation`:base(preview)+'/__prism_platform__/conversation';
  const request=(query:string,user='owner')=>fetch(url+'?sessionId='+sessionId+'&'+query,{headers:surface==='management'?{Authorization:`Bearer ${signToken({userId:user,role:'user'})}`}:{'x-user':user}});
  const latest=await (await request('latest=1')).json();assert.equal(latest.messages.length,50);assert.equal(latest.messages[0].seq,156);
  const older=await (await request('before=156')).json();assert.equal(older.messages.length,50);assert.equal(older.messages.at(-1).seq,155);
  assert.equal((await request('before=-1')).status,400);assert.equal((await request('latest=1&before=10')).status,400);assert.equal((await request('before=10&after=2')).status,400);assert.equal((await request('latest=1','viewer')).status,403);
 }}finally{management.closeAllConnections();preview.closeAllConnections();await Promise.all([new Promise(resolve=>management.close(resolve)),new Promise(resolve=>preview.close(resolve))]);}
});

test('loading older history does not rewind live cursors or overwrite concurrent updates; duplicate loads are coalesced',async()=>{
 const paths:string[]=[];let release=()=>{};let block=true;
 const request:PlatformRequest=async<T>(path)=>{paths.push(path);const query=new URL(path,'http://fixture').searchParams,value=await snapshot(query);if(query.has('before')&&block){block=false;await new Promise<void>(resolve=>{release=resolve;});}return value as T;};
 const client=new PlatformClient(context,request),initial=await client.sync();assert.ok(paths[0].includes('latest=1'));assert.equal(initial.messages.length,50);
 const pending=client.loadOlder(),duplicate=client.loadOlder();assert.equal(pending,duplicate);while(!paths.some(path=>path.includes('before=')))await new Promise(resolve=>setTimeout(resolve,1));await new Promise(resolve=>setImmediate(resolve));
 await getDb().prepare("INSERT INTO conversation_messages(id,session_id,role,user_id,body) VALUES(?,?,'user','owner',?)").run('m206',sessionId,'Concurrent new message');
 await getDb().prepare("UPDATE conversation_messages SET body='Updated while history loads' WHERE id='m205'").run();
 await getDb().prepare("UPDATE conversation_messages SET body='Fresh older task update' WHERE id='m120'").run();
 const live=await readConversationForRole(id,'admin',205,25) as PlatformConversation,olderUpdate=await getDb().prepare("SELECT * FROM conversation_messages WHERE id='m120'").get();
 client.apply({...live,current_messages:[...live.current_messages,olderUpdate]});assert.ok(!client.snapshot()?.messages.some(message=>message.id==='m120'));release();const history=await pending;assert.equal(history.messages.find(message=>message.id==='m120')?.body,'Fresh older task update');
 assert.equal(client.cursor().after,206);assert.equal(history.messages.find(message=>message.id==='m205')?.body,'Updated while history loads');assert.ok(history.messages.some(message=>message.id==='m206'));assert.equal(history.messages.length,101);assert.equal(paths.filter(path=>path.includes('before=')).length,1);
 await client.sync();assert.ok(paths.at(-1)?.includes('after=206'));assert.ok(!paths.at(-1)?.includes('latest=1'));
 while(client.snapshot()?.has_more_history)await client.loadOlder();assert.equal(client.snapshot()?.messages.length,206);assert.equal(new Set(client.snapshot()?.messages.map(message=>message.id)).size,206);assert.equal(client.cursor().after,206);
});

test('an older-page response cannot restore message contents after access was restricted',async()=>{
 let release=()=>{};let started=()=>{};const pendingStarted=new Promise<void>(resolve=>{started=resolve;});
 const client=new PlatformClient(context,async<T>(path)=>{const query=new URL(path,'http://fixture').searchParams,value=await snapshot(query);if(query.has('before')){started();await new Promise<void>(resolve=>{release=resolve;});}return value as T;});
 await client.sync();const pending=client.loadOlder();await pendingStarted;client.apply({...client.snapshot()!,restricted:true,messages:[],current_messages:[],events:[],runs:[]});release();const value=await pending;assert.equal(value.restricted,true);assert.deepEqual(value.messages,[]);assert.equal(value.has_more_history,false);
});
