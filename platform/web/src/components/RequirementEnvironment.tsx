import {toast} from '@/components/ui/toast';
import {DropdownMenuItem} from '@/components/ui/dropdown-menu';
import RequirementGit from './RequirementGit';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const labels:Record<string,string>={pending:'环境待准备',preparing:'准备中',starting:'启动中',running:'运行中',stopped:'已停止',failed:'启动失败'};
export default function RequirementEnvironment({projectId,requirementId,initialStatus,editor,canUseIde=false,readOnly=false,renderMoreActions,primaryActions}:{projectId:string;requirementId:string;initialStatus:string;editor:boolean;canUseIde?:boolean;readOnly?:boolean;renderMoreActions:(actions:ReactNode)=>ReactNode;primaryActions?:ReactNode}) {
  const [status,setStatus]=useState(initialStatus);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [health,setHealth]=useState<{agentReady:boolean;phase:string;elapsedSeconds:number;defaultPort?:number;services:{port:number;protocol:string;ready:boolean;page?:boolean;statusCode?:number}[]}>();
  const [ports,setPorts]=useState<number[]>([]);const [selectedPort,setSelectedPort]=useState('');
  const [statusOpen,setStatusOpen]=useState(false);
  const [gitOpen,setGitOpen]=useState(false);
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
    setBusy(true);setError('');try{await api.environmentAction(projectId,requirementId,action);setStatus(action==='start'?'preparing':'stopped');toast.success(action==='start'?'已提交启动请求':'服务已停止');setPorts([]);setSelectedPort('');setHealth(undefined);}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}
  }
  async function open(kind:'preview'|'ide'){
    // Open synchronously so the browser does not block a window after the async API response.
    const target=window.open('about:blank','_blank');if(target)target.opener=null;
    setBusy(true);setError('');try{const value=await api.openEnvironment(projectId,requirementId,kind,kind==='preview'&&selectedPort?Number(selectedPort):undefined);if(target)target.location.href=value.url;else toast.error('浏览器拦截了新窗口，请允许此站点弹出窗口后重试。');}catch(e){target?.close();toast.error((e as Error).message);}finally{setBusy(false);}
  }
  const active=['preparing','starting','running'].includes(status);
  return <div className="requirement-environment">
    <div className="environment-status" role="status"><span className="environment-dot" data-status={status}/><p title={error||undefined}>{labels[status]||status}{health&&['preparing','starting'].includes(status)?` · ${health.elapsedSeconds} 秒`:health&&status==='running'?` · Agent ${health.agentReady?'已就绪':'等待就绪'}${ports.length?` · ${ports.length} 个服务`:''}`:''}</p></div>
    {error&&<p className="mt-1 truncate text-[11px] text-destructive" title={error} role="alert">{error}</p>}
    <div className="requirement-actions">
      {primaryActions}
      {ports.length>1&&<select className="h-7 rounded-md border bg-background px-2 text-xs" aria-label="预览服务" value={selectedPort} onChange={e=>setSelectedPort(e.target.value)}><option value="" disabled>选择服务</option>{ports.map(port=><option key={port} value={port}>:{port}</option>)}</select>}
      {editor&&!readOnly&&!active&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>action('start')}>{status==='failed'?'重试启动':'启动服务'}</Button>}
      {['starting','running'].includes(status)&&ports.length>0&&<Button size="sm" variant="outline" disabled={busy||!selectedPort} onClick={()=>open('preview')}>打开预览</Button>}
    </div>
    {renderMoreActions(<>
      {editor&&!readOnly&&status==='running'&&<DropdownMenuItem disabled={busy} onSelect={()=>{void action('start');}}>重启服务</DropdownMenuItem>}
      {editor&&active&&<DropdownMenuItem disabled={busy} onSelect={()=>{void action('stop');}}>停止服务</DropdownMenuItem>}
      {canUseIde&&!readOnly&&<DropdownMenuItem disabled={busy} onSelect={()=>{void open('ide');}}>VS Code</DropdownMenuItem>}
      {editor&&!readOnly&&!['preparing','starting'].includes(status)&&<DropdownMenuItem onSelect={()=>setGitOpen(true)}>Git 操作</DropdownMenuItem>}
      {editor&&<DropdownMenuItem onSelect={()=>setStatusOpen(true)}>环境详情</DropdownMenuItem>}
      {editor&&<DropdownMenuItem onSelect={()=>setLogsOpen(true)}>运行日志</DropdownMenuItem>}
    </>)}
    {editor&&!readOnly&&<RequirementGit projectId={projectId} requirementId={requirementId} open={gitOpen} onOpenChange={setGitOpen} hideTrigger/>}
    <Dialog open={statusOpen} onOpenChange={setStatusOpen}><DialogContent><DialogHeader><DialogTitle>环境详情</DialogTitle><DialogDescription className="break-all">{branch||'独立需求环境'}</DialogDescription></DialogHeader><div className="space-y-3 text-sm"><p>{labels[status]||status}{health&&` · Agent ${health.agentReady?'已就绪':'等待就绪'}`}</p>{health&&['preparing','starting'].includes(status)&&<p className="text-xs text-muted-foreground">{health.phase} · {health.elapsedSeconds} 秒</p>}{health?.services.map(service=><p key={service.port} className="text-xs text-muted-foreground">:{service.port} · {service.ready?'已就绪':service.protocol==='timeout'?'响应超时':service.protocol==='http'?`HTTP ${service.statusCode}，尚未就绪`:service.protocol==='non-http'?'非 HTTP 服务':'无法连接'}</p>)}{error&&<p className="whitespace-pre-wrap break-words text-xs text-destructive">{error}</p>}</div></DialogContent></Dialog>
    <Dialog open={logsOpen} onOpenChange={setLogsOpen}><DialogContent className="max-w-4xl"><DialogHeader><DialogTitle>需求运行日志</DialogTitle><DialogDescription className="break-all">{branch || '独立需求环境'} · 每 3 秒更新</DialogDescription></DialogHeader><pre className="max-h-[65dvh] min-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[#171b16] p-4 text-xs leading-6 text-[#d7e1cf]">{logs || '正在读取日志…'}</pre></DialogContent></Dialog>
  </div>;
}
