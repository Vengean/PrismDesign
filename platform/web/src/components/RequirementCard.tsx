import {toast} from '@/components/ui/toast';
import {useState} from 'react';
import {Link} from 'react-router-dom';
import {GitBranch,GitMerge,MoreHorizontal,FolderOpen,Trash2} from 'lucide-react';
import {api,type RequirementSummary,type ReleaseSummary,type ProjectRole} from '@/lib/api';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator} from '@/components/ui/dropdown-menu';
import RequirementEnvironment from './RequirementEnvironment';
import RequirementConversation from './RequirementConversation';
import DeleteRequirementButton from './DeleteRequirementButton';
import WorkspaceFiles from './WorkspaceFiles';
export const workflowLabels:Record<string,string>={developing:'开发中',pending_merge:'待合入',reviewing:'待验收',merged:'已合入',closed:'已关闭',integrating:'集成中',frozen:'已冻结',archived:'已归档',preparing:'分支准备中',failed:'分支创建失败',legacy:'待初始化',ready:'分支就绪',submitted:'待同意',approved:'合入中',partial:'部分合入',conflict:'存在冲突',stale:'申请已失效',rejected:'已退回',external:'远端已合入',needs_confirmation:'需核对远端'};
export default function RequirementCard({projectId,item,role,releases,onChanged}:{projectId:string;item:RequirementSummary;role:ProjectRole;releases:ReleaseSummary[];onChanged:()=>void}){
 const [detailsOpen,setDetailsOpen]=useState(false),[moreOpen,setMoreOpen]=useState(false),[filesOpen,setFilesOpen]=useState(false),[deleteOpen,setDeleteOpen]=useState(false);
 const [dialog,setDialog]=useState<'apply'|'adopt'>(),[releaseId,setReleaseId]=useState(''),[busy,setBusy]=useState(false);
 const editor=role!=='viewer',readonly=['merged','closed'].includes(item.status),release=releases.find(r=>r.id===item.release_id);
 const canManage=role==='admin'||editor&&!readonly&&(item.branch_status==='failed'||!!item.release_id&&item.branch_status==='ready'&&release?.status==='integrating');
 async function act(action:'apply'|'adopt'|'branches/retry'){
  if(busy)return;setBusy(true);
  try{const result=await api.requirementAction(projectId,item.id,action,action==='adopt'?{releaseId}:undefined);toast.success(result.message||(action==='apply'?'代码已 Push，合入申请已提交':'已提交重试'));setDialog(undefined);onChanged();}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}
 }
 return <DropdownMenu modal={false} open={moreOpen} onOpenChange={setMoreOpen}><article className="surface requirement-card">
 <div className="requirement-card-heading"><h2 className="min-w-0 flex-1"><button type="button" className="requirement-title w-full" title={item.title} onClick={()=>setDetailsOpen(true)}>{item.title}</button></h2>{editor&&<DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`需求“${item.title}”的更多操作`} title="更多操作"><MoreHorizontal size={16}/></Button></DropdownMenuTrigger>}</div>
 <div className="mt-2 flex min-w-0 items-center gap-2"><span className="project-badge" data-state={item.status}>{workflowLabels[item.status]||item.status}</span><span className="min-w-0 truncate text-[11px] text-muted-foreground">{release?<Link className="inline-flex max-w-full items-center gap-1 hover:text-foreground" to={`/projects/${projectId}/releases/${release.id}`}><GitBranch size={11} className="shrink-0"/><span className="truncate">{release.name}</span></Link>:'历史需求 · 待关联发布'}</span></div>
 <p className="requirement-description mt-3">{item.description||'暂无需求说明'}</p>
 {item.branch_status!=='ready'&&item.release_id&&<p role="status" className="mt-1 truncate text-[11px] text-muted-foreground" title={editor?item.branch_error:undefined}>{workflowLabels[item.branch_status]}{editor&&item.branch_error?`：${item.branch_error}`:''}</p>}
 <RequirementEnvironment projectId={projectId} requirementId={item.id} initialStatus={item.environment_status} editor={editor} canUseIde={role==='admin'} readOnly={readonly||!!item.release_id&&item.branch_status!=='ready'} primaryActions={<RequirementConversation projectId={projectId} requirementId={item.id} sessionId={item.session_id} title={item.title} editor={editor} readOnly={readonly}/>} renderMoreActions={environmentActions=>editor&&<DropdownMenuContent align="end" sideOffset={6} collisionPadding={12} aria-label="需求操作" className="w-48 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto">
 {environmentActions}
 <DropdownMenuItem onSelect={()=>setFilesOpen(true)}><FolderOpen size={14}/>工作区文件</DropdownMenuItem>
 {canManage&&<DropdownMenuSeparator/>}
 {editor&&!readonly&&item.release_id&&item.branch_status==='ready'&&release?.status==='integrating'&&<DropdownMenuItem onSelect={()=>{setDialog('apply');}}><GitMerge size={14}/>申请合入发布</DropdownMenuItem>}
 {editor&&!readonly&&item.branch_status==='failed'&&<DropdownMenuItem disabled={busy} onSelect={()=>{void act('branches/retry');}}>重试创建分支</DropdownMenuItem>}
 {role==='admin'&&!readonly&&!item.release_id&&<DropdownMenuItem onSelect={()=>{setReleaseId('');setDialog('adopt');}}>关联发布</DropdownMenuItem>}
 {role==='admin'&&<DropdownMenuItem className="text-destructive focus:text-destructive" disabled={busy} onSelect={()=>setDeleteOpen(true)}><Trash2 size={14}/>删除需求</DropdownMenuItem>}
 </DropdownMenuContent>}/>
 <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle className="break-words pr-5 leading-6">{item.title}</DialogTitle><DialogDescription>需求详情</DialogDescription></DialogHeader><div className="space-y-5"><div className="flex flex-wrap items-center gap-2"><span className="project-badge" data-state={item.status}>{workflowLabels[item.status]||item.status}</span>{release&&<Link to={`/projects/${projectId}/releases/${release.id}`} className="text-xs text-muted-foreground hover:underline">所属发布：{release.name}</Link>}</div><section><h3 className="mb-2 text-xs font-medium text-muted-foreground">说明</h3><p className="whitespace-pre-wrap break-words text-sm leading-7">{item.description||'暂无需求说明'}</p></section>{editor&&<section><h3 className="mb-2 text-xs font-medium text-muted-foreground">代码分支</h3><p className="break-all font-mono text-xs">{item.branch_name||'尚未准备'}</p><p className="mt-2 text-xs text-muted-foreground">{workflowLabels[item.branch_status]||item.branch_status}</p>{item.branch_error&&<p className="mt-2 whitespace-pre-wrap break-words text-xs text-destructive">{item.branch_error}</p>}</section>}</div></DialogContent></Dialog>
 {editor&&<WorkspaceFiles projectId={projectId} requirementId={item.id} open={filesOpen} onOpenChange={setFilesOpen} hideTrigger/>}
 {role==='admin'&&<DeleteRequirementButton projectId={projectId} item={item} disabled={busy} onDeleted={onChanged} open={deleteOpen} onOpenChange={setDeleteOpen} hideTrigger/>}

 <Dialog open={!!dialog} onOpenChange={v=>{if(!v&&!busy)setDialog(undefined);}}><DialogContent><DialogHeader><DialogTitle>{dialog==='apply'?'申请合入发布':'关联历史需求'}</DialogTitle><DialogDescription>{dialog==='apply'?`先 Push 全部需求仓库，成功后向“${release?.name||''}”创建合入申请。请先提交修改并结束 Agent 任务；不会自动提交，也不会同步发布分支。`:'将所属发布代码同步到当前需求分支后建立归属，保留原分支和文件。请先启动环境、提交修改并结束 Agent 任务。关联后不能更换发布。'}</DialogDescription></DialogHeader>
 {dialog==='adopt'&&<select aria-label="所属发布" className="rounded-lg border bg-background p-2 text-sm" value={releaseId} onChange={e=>setReleaseId(e.target.value)}><option value="">选择发布</option>{releases.filter(r=>r.status==='integrating'&&r.branch_status==='ready').map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>}

 <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={()=>setDialog(undefined)}>取消</Button><Button disabled={busy||dialog==='adopt'&&!releaseId} onClick={()=>act(dialog!)}>{busy?(dialog==='apply'?'正在 Push 并申请…':'正在同步并关联…'):dialog==='apply'?'Push 并申请合入':'同步并关联'}</Button></div>
 </DialogContent></Dialog></article></DropdownMenu>;
}
