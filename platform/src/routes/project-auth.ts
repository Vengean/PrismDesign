import {Router,type Router as RouterType} from 'express';
import type http from 'node:http';
import {WebSocketServer} from 'ws';
import {authenticate} from '../middleware/auth.js';
import type {AuthRequest} from '../types.js';
import {projectAuth} from '../services/project-auth.js';

export function projectAuthRoutes(service=projectAuth):RouterType{
 const router=Router();router.use(authenticate);
 const run=(action:(req:AuthRequest)=>Promise<unknown>)=>async(req:AuthRequest,res:any)=>{
  res.setHeader('Cache-Control','no-store');
  try{res.json(await action(req));}
  catch(error){const message=(error as Error).message;
   const known=/仅项目管理员|请先|正在进行|未结束|已更改|不支持|连接已过期|清理失败|退出登录失败/.test(message);
   res.status(message.includes('仅项目管理员')?403:known?409:503).json({error:known?message:'订阅登录环境不可用，请检查容器引擎和工作镜像'});
  }
 };
 router.get('/:id/subscription/status',run(req=>service.status(String(req.params.id),req.user!.userId)));
 router.post('/:id/subscription/sessions',run(req=>service.start(String(req.params.id),req.user!.userId)));
 router.delete('/:id/subscription/sessions/:sessionId',run(async req=>{await service.stop(String(req.params.id),String(req.params.sessionId),req.user!.userId);return {closed:true};}));
 router.post('/:id/subscription/logout',run(req=>service.logout(String(req.params.id),req.user!.userId)));
 return router;
}

export function attachProjectAuthWebSocket(server:http.Server,service=projectAuth){
 const sockets=new WebSocketServer({noServer:true,maxPayload:32768,perMessageDeflate:false});
 server.on('upgrade',(req,socket,head)=>{
  try{
   const url=new URL(req.url||'/','http://localhost');
   const match=url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/subscription\/sessions\/([a-f0-9-]+)\/terminal$/);
   if(!match||!req.headers.origin||new URL(req.headers.origin).host!==req.headers.host){socket.destroy();return;}
   const ticket=url.searchParams.get('ticket')||'';
   if(!/^[a-f0-9]{64}$/.test(ticket)){socket.destroy();return;}
   sockets.handleUpgrade(req,socket,head,ws=>{
    void service.attach(match[1],match[2],ticket,ws).catch(()=>{if(ws.readyState===1)ws.send(JSON.stringify({type:'error',message:'终端连接已失效，请关闭后重新打开'}));ws.close();});
   });
  }catch{socket.destroy();}
 });
 return sockets;
}
