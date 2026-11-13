import {toast} from '@/components/ui/toast';
import {useEffect,useRef,useState} from 'react';
import {Download,Folder,FolderOpen,RefreshCw,ArrowUp} from 'lucide-react';
import {api,type WorkspaceFileList} from '@/lib/api';
import {saveAttachment} from '../../../../packages/ui/src/studio/attachment-client';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';

export default function WorkspaceFiles({projectId,requirementId,open:controlledOpen,onOpenChange,hideTrigger=false}:{projectId:string;requirementId:string;open?:boolean;onOpenChange?:(open:boolean)=>void;hideTrigger?:boolean}){
 const [internalOpen,setInternalOpen]=useState(false),[path,setPath]=useState(''),[value,setValue]=useState<WorkspaceFileList>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[downloading,setDownloading]=useState(''),[reload,setReload]=useState(0);
 const open=controlledOpen??internalOpen,setOpen=onOpenChange??setInternalOpen;
 const sequence=useRef(0);
 useEffect(()=>{if(!open)return;const current=++sequence.current;let alive=true;setLoading(true);setError('');setValue(undefined);
  api.listWorkspaceFiles(projectId,requirementId,path).then(result=>{if(alive&&current===sequence.current)setValue(result);}).catch(error=>{if(alive)setError(error.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};
 },[open,path,reload,projectId,requirementId]);
 async function download(file:WorkspaceFileList['items'][number]){setDownloading(file.path);setError('');try{saveAttachment(await api.downloadWorkspaceFile(projectId,requirementId,file.path),file.name);}catch(error){toast.error((error as Error).message);}finally{setDownloading('');}}
 return <>{!hideTrigger&&<Button size="sm" variant="outline" onClick={()=>setOpen(true)}><FolderOpen size={14}/>工作区文件</Button>}<Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>工作区文件</DialogTitle><DialogDescription>浏览并下载 Agent 保存在工作区中的文件，单个文件最大 50 MB。服务停止后也可下载；正在写入的文件请稍后刷新。</DialogDescription></DialogHeader>
 <div className="flex min-w-0 items-center gap-2"><Button size="sm" variant="outline" disabled={!path||loading} onClick={()=>setPath(path.split('/').slice(0,-1).join('/'))}><ArrowUp size={14}/>上一级</Button><code className="min-w-0 flex-1 break-all text-xs">/workspace/{path}</code><Button aria-label="刷新文件" size="icon" variant="ghost" disabled={loading} onClick={()=>setReload(n=>n+1)}><RefreshCw size={14}/></Button></div>
 {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
 <div className="max-h-[55dvh] min-h-40 space-y-1 overflow-auto">{loading?<p role="status" className="p-4 text-sm">正在读取文件…</p>:value?.items.map(file=><div key={file.path} className="flex items-center gap-2 rounded-lg border p-2">{file.kind==='directory'?<><Folder size={16} className="shrink-0"/><button className="min-w-0 flex-1 break-all text-left text-sm hover:underline" onClick={()=>setPath(file.path)}>{file.name}</button></>:<><span className="min-w-0 flex-1 break-all text-sm">{file.name}<span className="ml-2 text-xs text-muted-foreground">{file.size<1024?`${file.size} B`:file.size<1048576?`${(file.size/1024).toFixed(1)} KB`:`${(file.size/1048576).toFixed(1)} MB`}</span></span><Button aria-label={`下载 ${file.name}`} size="sm" variant="outline" disabled={!!downloading||file.size>50*1048576} onClick={()=>{void download(file);}}><Download size={14}/>{downloading===file.path?'下载中…':'下载'}</Button></>}</div>)}{!loading&&value&&!value.items.length&&<p className="p-4 text-sm text-muted-foreground">此文件夹还没有文件。</p>}</div>
 {value?.truncated&&<p className="text-xs text-muted-foreground">此目录仅显示前 500 项，请进入具体文件夹查找。</p>}
 </DialogContent></Dialog></>;
}
