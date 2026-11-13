import {toast} from '@/components/ui/toast';
import {useRef,useState} from 'react';
import {Trash2} from 'lucide-react';
import {api,type ReleaseSummary} from '@/lib/api';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {useDeletionCountdown} from './useDeletionCountdown';

export default function DeleteReleaseButton({projectId,release,requirementCount,disabled,onDeleted,open:controlledOpen,onOpenChange,hideTrigger=false}:{projectId:string;release:ReleaseSummary;requirementCount:number;disabled?:boolean;onDeleted:()=>void;open?:boolean;onOpenChange?:(open:boolean)=>void;hideTrigger?:boolean}){
 const [internalOpen,setInternalOpen]=useState(false),[busy,setBusy]=useState(false);
 const open=controlledOpen??internalOpen,setOpen=onOpenChange??setInternalOpen;
 const pending=useRef(false);
 const remaining=useDeletionCountdown(open);
 const blocked=release.branch_status==='preparing'?'发布分支正在准备中，请完成后再删除。':'';
 async function remove(){
  if(pending.current||blocked||remaining>0)return;
  pending.current=true;setBusy(true);
  try{await api.deleteRelease(projectId,release.id);setOpen(false);onDeleted();}
  catch(e){toast.error((e as Error).message);}
  finally{pending.current=false;setBusy(false);}
 }
 return <>{!hideTrigger&&<Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={disabled||busy} onClick={()=>{setOpen(true);}}><Trash2 size={14}/>删除发布</Button>}
 <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent><DialogHeader><DialogTitle>删除发布“{release.name}”</DialogTitle><DialogDescription>将永久删除此发布及其关联的 {requirementCount} 个需求、聊天记录和合入申请，并销毁需求容器、源码卷及附件。未推送的修改会丢失；远端 Git 分支和已推送代码保留。请先结束所有 Agent 任务及 Git 操作，此操作无法撤销。</DialogDescription></DialogHeader>
 {blocked&&<p role="status" className="text-sm text-muted-foreground">{blocked}</p>}
 <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={()=>setOpen(false)}>取消</Button><Button variant="destructive" disabled={busy||!!blocked||remaining>0} onClick={()=>{void remove();}}>{busy?'正在删除…':remaining>0?`确认删除（${remaining}s）`:'确认删除'}</Button></div></DialogContent></Dialog></>;
}
