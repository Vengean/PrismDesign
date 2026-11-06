import RequirementGit from './RequirementGit';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const labels:Record<string,string>={pending:'环境待准备',preparing:'准备中',starting:'启动中',running:'运行中',stopped:'已停止',failed:'启动失败'};
export default function RequirementEnvironment({projectId,requirementId,initialStatus,editor}:{projectId:string;requirementId:string;initialStatus:string;editor:boolean}) {
  const [status,setStatus]=useState(initialStatus);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [health,setHealth]=useState<{agentReady:boolean;phase:string;elapsedSeconds:number;defaultPort?:number;services:{port:number;protocol:string;ready:boolean;page?:boolean;statusCode?:number}[]}>();
  const [ports,setPorts]=useState<number[]>([]);const [selectedPort,setSelectedPort]=useState('');
  const [logsOpen,setLogsOpen]=useState(false);const [logs,setLogs]=useState('');const [branch,setBranch]=useState('');
  useEffect(()=>{
    let active=true;let refreshing=false;
    async function refresh(){if(refreshing)return;refreshing=true;try{const value=await api.getEnvironment(projectId,requirementId);if(active){setStatus(value.status);setBranch(value.branch);setPorts(value.ports);setHealth(value);setSelectedPort(previous=>value.ports.includes(Number(previous))?previous:value.defaultPort?String(value.defaultPort):value.ports.length===1?String(value.ports[0]):'');setError(value.error || '');}}catch(e){if(active)setError((e as Error).message);}finally{refreshing=false;}}
    void refresh();const timer=setInterval(refresh,5000);return()=>{active=false;clearInterval(timer);};
  },[projectId,requirementId]);
  useEffect(()=>{
    if(!logsOpen)return;let active=true;
    async function refresh(){try{const value=await api.getEnvironmentLogs(projectId,requirementId);if(active)setLogs(value.logs || '暂无日志，等待环境启动…');}catch(e){if(active)setLogs((e as Error).message);}}
    void refresh();const timer=setInterval(refresh,3000);return()=>{active=false;clearInterval(timer);};
  },[logsOpen,projectId,requirementId]);
  async function action(action:'start'|'stop'){
    setBusy(true);setError('');try{await api.environmentAction(projectId,requirementId,action);setStatus(action==='start'?'preparing':'stopped');setPorts([]);setSelectedPort('');setHealth(undefined);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function open(kind:'preview'|'ide'){
    // Open synchronously so the browser does not block a window after the async API response.
    const target=window.open('about:blank','_blank');if(target)target.opener=null;
    setBusy(true);setError('');try{const value=await api.openEnvironment(projectId,requirementId,kind,kind==='preview'&&selectedPort?Number(selectedPort):undefined);if(target)target.location.href=value.url;else setError('浏览器拦截了新窗口，请允许此站点弹出窗口后重试。');}catch(e){target?.close();setError((e as Error).message);}finally{setBusy(false);}
  }
  const active=['preparing','starting','running'].includes(status);
  return <div className="mt-3 space-y-3">
    <p className="text-xs text-muted-foreground" role="status">{labels[status] || status}{health&&['preparing','starting'].includes(status)&&` · ${{preparing:'拉取仓库',initializing:'初始化依赖',starting:'等待服务就绪'}[health.phase] || '准备环境'} · ${health.elapsedSeconds} 秒`}</p>
    {health&&['starting','running'].includes(status)&&<p className="text-xs text-muted-foreground">Agent {health.agentReady?'已就绪':'等待就绪'} · {ports.length?`${ports.length} 个 HTTP 服务可用`:'等待 HTTP 服务'}</p>}
    {editor&&health?.services.some(s=>!s.ready)&&<p className="text-xs text-muted-foreground">{health.services.filter(s=>!s.ready).map(s=>`:${s.port} ${s.protocol==='timeout'?'响应超时':s.protocol==='http'?`HTTP ${s.statusCode}，尚未就绪`:s.protocol==='non-http'?'非 HTTP 服务':'无法连接'}`).join('；')}</p>}
    <div className="flex flex-wrap gap-2">
      {ports.length>1&&<select className="rounded-lg border bg-background px-2 text-xs" aria-label="预览服务" value={selectedPort} onChange={e=>setSelectedPort(e.target.value)}><option value="" disabled>请选择预览服务</option>{ports.map(port=><option key={port} value={port}>{health?.services.find(s=>s.port===port)?.page?'页面服务':'HTTP 服务'} :{port}</option>)}</select>}
      {editor&&!active&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>action('start')}>{status==='failed'?'重试启动':'启动环境'}</Button>}
      {editor&&status==='running'&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>action('start')}>重启环境</Button>}
      {editor&&active&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>action('stop')}>停止环境</Button>}
      {['starting','running'].includes(status)&&ports.length>0&&<Button size="sm" disabled={busy||!selectedPort} onClick={()=>open('preview')}>打开预览</Button>}
      {editor&&['starting','running'].includes(status)&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>open('ide')}>VS Code</Button>}
      {editor&&status==='running'&&<RequirementGit projectId={projectId} requirementId={requirementId}/>}
      {editor&&<Button size="sm" variant="ghost" onClick={()=>setLogsOpen(true)}>运行日志</Button>}
    </div>
    {error&&<p className="break-words text-xs text-destructive" role="alert">{error}</p>}
    <Dialog open={logsOpen} onOpenChange={setLogsOpen}><DialogContent className="max-w-4xl"><DialogHeader><DialogTitle>需求运行日志</DialogTitle><DialogDescription className="break-all">{branch || '独立需求环境'} · 每 3 秒更新</DialogDescription></DialogHeader><pre className="max-h-[65dvh] min-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[#171b16] p-4 text-xs leading-6 text-[#d7e1cf]">{logs || '正在读取日志…'}</pre></DialogContent></Dialog>
  </div>;
}
