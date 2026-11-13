const http=require('node:http');
const fs=require('node:fs');
const {WebSocketServer,WebSocket}=require('/prism-agent/node_modules/ws');
const token='fixture-agent-private-token';const active=new Map();const clients=new Map();const browserResults=new Map();
function broadcast(clientId,type,data){for(const [ws,id] of clients)if(id===clientId&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type,data}));}
const server=http.createServer(async(req,res)=>{
 if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401);res.end('{}');return;}
 const reply=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
 if(req.url==='/api/status')return reply({status:'running',agent:{capabilities:{cancel:true,browserTesting:true}}});
 if(req.url==='/api/session')return reply({success:true});
 if(req.method==='DELETE'&&req.url.startsWith('/api/runs/')){active.get(decodeURIComponent(req.url.slice('/api/runs/'.length)))?.finish(true);return reply({success:true});}
 if(req.url!=='/api/chat'){res.writeHead(404);return reply({});}
 let body='';for await(const b of req)body+=b;const input=JSON.parse(body),runId=input.runId,clientId=req.headers['x-client-id'];
 if(input.capabilities?.browserInteraction){
  broadcast(clientId,'run.started',{runId});
  const requestId='browser-fixture-'+runId;
  const pending=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('browser fixture timed out')),5000);browserResults.set(requestId,value=>{clearTimeout(timer);resolve(value);});});
  broadcast(clientId,'browser:command',{requestId,action:'observe'});
  const value=await pending;
  const verification={id:'verify-'+runId,status:value.success?'passed':'failed',goal:'Browser relay fixture',proposedChecks:['bound page observed'],summary:'browser relay returned'};
  broadcast(clientId,'verification.updated',verification);broadcast(clientId,'test-run.updated',{id:'test-'+runId,verificationId:verification.id,status:verification.status,cases:[{id:'case-1',title:'bound page observed',assertion:'observed expected page',status:verification.status,evidenceIds:[]}],evidence:[],steps:[],cleanup:[]});
  return reply({success:value.success,message:'browser relay complete',verification,filesModified:[]});
 }
 broadcast(clientId,'run.started',{runId});broadcast(clientId,'message.delta',{runId,delta:'你好，正在处理'});broadcast(clientId,'tool.started',{runId,toolCallId:'fixture-tool',tool:'Write',label:'写入测试文件'});
 const finish=cancelled=>{
  if(!active.has(runId))return;active.delete(runId);
  if(!cancelled)fs.writeFileSync('/workspace/app/agent-edit.txt','fixture source edit');
  const result={success:true,cancelled,message:cancelled?'已取消':'处理完成 ✅',filesModified:cancelled?[]:['app/agent-edit.txt']};
  broadcast(clientId,cancelled?'run.cancelled':'run.completed',{runId,result});reply(result);
 };
 let hold=input.message.endsWith('fixture-hold-run');try{hold=JSON.parse(input.message.split('[本批未读消息]\n').at(-1)).some(post=>post.text==='fixture-hold-run');}catch{}
 active.set(runId,{finish});if(!hold)setTimeout(()=>finish(false),150);
});
const wss=new WebSocketServer({server,path:'/ws'});wss.on('connection',(ws,req)=>{
 if(!(req.headers['sec-websocket-protocol']||'').split(',').map(x=>x.trim()).includes(token))return ws.close(1008);
 ws.on('message',raw=>{try{const value=JSON.parse(String(raw));if(value.type==='browser:result'){const pending=browserResults.get(value.data.requestId);if(pending){browserResults.delete(value.data.requestId);pending(value.data);}}}catch{}});
 clients.set(ws,new URL(req.url,'http://fixture').searchParams.get('clientId'));ws.on('close',()=>clients.delete(ws));
});
server.listen(9527,'0.0.0.0',()=>console.log('__PRISM_AGENT_TOKEN__='+token));
