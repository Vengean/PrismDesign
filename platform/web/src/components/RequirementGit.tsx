import {useEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowUp,GitBranch,GitCommitHorizontal} from 'lucide-react';
import {api} from '@/lib/api';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
export default function RequirementGit({projectId,requirementId}:{projectId:string;requirementId:string}){
 const [open,setOpen]=useState(false),[repos,setRepos]=useState<{name:string}[]>([]),[repo,setRepo]=useState(''),[branch,setBranch]=useState('');
 const [busy,setBusy]=useState<'pull'|'push'|'commit'|undefined>(),[loading,setLoading]=useState(false),[error,setError]=useState(''),[result,setResult]=useState('');
 const [dirty,setDirty]=useState(false),[checking,setChecking]=useState(false),[commitOpen,setCommitOpen]=useState(false),[message,setMessage]=useState('');
 const pending=useRef(false);
 useEffect(()=>{if(!open)return;let active=true;setLoading(true);setError('');api.getRequirementGit(projectId,requirementId).then(value=>{if(active){setRepos(value.repos);setRepo(current=>value.repos.some(item=>item.name===current)?current:value.repos[0]?.name||'');setBranch(value.branch);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[open,projectId,requirementId]);
 useEffect(()=>{if(!open||!repo||busy)return;let active=true;setChecking(true);api.getRequirementGitStatus(projectId,requirementId,repo).then(value=>{if(active)setDirty(value.dirty);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setChecking(false);});return()=>{active=false;};},[open,repo,busy,projectId,requirementId]);
 async function operate(action:'pull'|'push'|'commit'){
  if(pending.current||!repo)return;pending.current=true;setBusy(action);setError('');setResult('');
  try{const value=await api.operateRequirementGit(projectId,requirementId,repo,action,action==='commit'?message:undefined);if(action==='commit'){setCommitOpen(false);setMessage('');setDirty(false);}setResult(`${repo}：${value.message} · ${value.commit.slice(0,12)}`);}catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(undefined);}
 }
 return <><Button size="sm" variant="outline" onClick={()=>setOpen(true)}><GitBranch size={14}/>Pull / Push</Button>
 <Dialog open={open} onOpenChange={value=>{if(!pending.current)setOpen(value);}}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>同步需求代码</DialogTitle><DialogDescription>仅操作当前需求分支。Pull 只允许快进，Push 不强制覆盖远端。</DialogDescription></DialogHeader>
 <div className="space-y-4"><p className="break-all rounded-lg bg-muted p-3 font-mono text-xs">{branch||'正在读取需求分支…'}</p>
 <label className="block space-y-2 text-sm"><span>仓库</span><select aria-label="Git 仓库" className="w-full rounded-lg border bg-background p-2" value={repo} disabled={loading||!!busy} onChange={e=>{setRepo(e.target.value);setError('');setResult('');setCommitOpen(false);setMessage('');setDirty(false);}}>{repos.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
 <p className="text-xs leading-6 text-muted-foreground">请先启动需求环境。存在未提交修改时，可在此提交当前仓库的全部修改；首次同步先 Push 创建远端需求分支。操作期间会关闭 VS Code 连接并暂停发送 Agent 消息，完成后可重新打开。</p>
 {busy&&<p role="status" className="text-sm">正在 {busy==='pull'?'拉取':busy==='push'?'推送':'提交'} {repo}，请稍候…</p>}
 {dirty&&!busy&&<div className="flex items-center justify-between gap-2 rounded-lg bg-muted p-3 text-sm"><span>当前仓库有未提交修改</span><Button size="sm" variant="outline" onClick={()=>setCommitOpen(true)}><GitCommitHorizontal size={14}/>提交代码</Button></div>}
 {commitOpen&&<form className="space-y-3 rounded-lg border p-3" onSubmit={e=>{e.preventDefault();void operate('commit');}}><label className="block space-y-2 text-sm"><span>提交说明 <span className="text-destructive">*</span></span><textarea aria-label="提交说明" placeholder="描述本次代码修改" maxLength={500} disabled={!!busy} className="min-h-20 w-full resize-y rounded-lg border bg-background p-2" value={message} onChange={e=>setMessage(e.target.value)}/></label><p className="text-xs text-muted-foreground">将提交所选仓库全部已跟踪修改和未被 Git 忽略的新文件，仅创建本地提交。</p><div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={!!busy} onClick={()=>setCommitOpen(false)}>取消</Button><Button type="submit" disabled={!!busy||!message.trim()}>提交代码</Button></div></form>}
 {error&&<p role="alert" className="break-words text-sm text-destructive">{error}</p>}{result&&<p role="status" className="break-words text-sm">{result}</p>}
 <div className="flex justify-end gap-2"><Button variant="outline" disabled={loading||checking||!!busy||!repo||dirty} onClick={()=>operate('pull')}><ArrowDown size={14}/>Pull 拉取</Button><Button disabled={loading||checking||!!busy||!repo||dirty} onClick={()=>operate('push')}><ArrowUp size={14}/>Push 推送</Button></div></div>
 </DialogContent></Dialog></>;
}
