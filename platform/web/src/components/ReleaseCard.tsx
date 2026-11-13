import {useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowUpRight,GitBranch,MoreHorizontal,Trash2} from 'lucide-react';
import type {ReleaseSummary} from '@/lib/api';
import {Button} from '@/components/ui/button';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import DeleteReleaseButton from './DeleteReleaseButton';
import {workflowLabels} from './RequirementCard';
export default function ReleaseCard({projectId,item,admin,requirementCount,busy,onDeleted}:{projectId:string;item:ReleaseSummary;admin:boolean;requirementCount:number;busy:boolean;onDeleted:()=>void}){
 const [deleteOpen,setDeleteOpen]=useState(false);
 return <article className="surface release-card"><div className="mb-3 flex items-center justify-between gap-2"><span className="project-badge">{workflowLabels[item.status]||item.status}</span>{admin&&<DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`发布“${item.name}”的更多操作`}><MoreHorizontal size={16}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={busy} className="text-destructive focus:text-destructive" onSelect={()=>setDeleteOpen(true)}><Trash2 size={14}/>删除发布</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div><h2 className="truncate text-sm font-semibold"><Link title={item.name} className="hover:text-primary" to={`/projects/${projectId}/releases/${item.id}`}>{item.name}</Link></h2><p className="release-description mt-1.5">{item.description||'暂无发布说明'}</p><div className="release-card-footer"><span className="min-w-0 truncate text-[11px] text-muted-foreground"><GitBranch size={11} className="mr-1 inline"/>{item.branch_status==='ready'?'分支已就绪':item.branch_status==='failed'?'分支创建失败':item.branch_status==='legacy'?'待初始化':'分支准备中'}</span><Button size="sm" variant="ghost" asChild><Link to={`/projects/${projectId}/releases/${item.id}`}>进入发布<ArrowUpRight size={13}/></Link></Button></div>{admin&&<DeleteReleaseButton projectId={projectId} release={item} requirementCount={requirementCount} disabled={busy} onDeleted={onDeleted} open={deleteOpen} onOpenChange={setDeleteOpen} hideTrigger/>}</article>;
}
