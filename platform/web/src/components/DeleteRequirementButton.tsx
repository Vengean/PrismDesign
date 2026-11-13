import {toast} from '@/components/ui/toast';
import {useRef,useState} from 'react';
import {Trash2} from 'lucide-react';
import {api,type RequirementSummary} from '@/lib/api';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {useDeletionCountdown} from './useDeletionCountdown';

export default function DeleteRequirementButton({projectId,item,disabled,onDeleted,open:controlledOpen,onOpenChange,hideTrigger=false}:{projectId:string;item:RequirementSummary;disabled?:boolean;onDeleted:()=>void;open?:boolean;onOpenChange?:(open:boolean)=>void;hideTrigger?:boolean}){
 const [internalOpen,setInternalOpen]=useState(false),[busy,setBusy]=useState(false);
 const open=controlledOpen??internalOpen,setOpen=onOpenChange??setInternalOpen;
 const pending=useRef(false),preparing=item.branch_status==='preparing';
 const remaining=useDeletionCountdown(open);
 async function remove(){
  if(pending.current||preparing||remaining>0)return;
  pending.current=true;setBusy(true);
  try{await api.deleteRequirement(projectId,item.id);setOpen(false);onDeleted();}
  catch(e){toast.error((e as Error).message);}
  finally{pending.current=false;setBusy(false);}
 }
 return <>{!hideTrigger&&<Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={disabled||busy} onClick={()=>{setOpen(true);}}><Trash2 size={14}/>删除需求</Button>}
 <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent><DialogHeader><DialogTitle>删除需求“{item.title}”</DialogTitle><DialogDescription>将永久删除需求、聊天记录、合入申请及其工作区，未推送的代码和附件也会丢失。远端 Git 分支和已合入的代码保留。请先结束 Agent 任务及 Git 操作，此操作无法撤销。</DialogDescription></DialogHeader>
 {preparing&&<p role="status" className="text-sm text-muted-foreground">需求分支正在准备中，请完成后再删除。</p>}
 <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={()=>setOpen(false)}>取消</Button><Button variant="destructive" disabled={busy||preparing||remaining>0} onClick={()=>{void remove();}}>{busy?'正在删除…':remaining>0?`确认删除需求（${remaining}s）`:'确认删除需求'}</Button></div></DialogContent></Dialog></>;
}
