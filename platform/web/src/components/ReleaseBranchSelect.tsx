import {useEffect,useState} from 'react';
import {api} from '@/lib/api';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
const referenceOption=':reference';
const branchRef=(branch:string)=>branch.startsWith('refs/heads/')?branch:`refs/heads/${branch}`;
export default function ReleaseBranchSelect({projectId,repo,value,onChange,onReadyChange,disabled=false}:{projectId:string;repo:{name:string;url?:string;branch:string};value:string;onChange:(value:string)=>void;onReadyChange:(repo:string,ready:boolean)=>void;disabled?:boolean}){
 const [branches,setBranches]=useState<string[]>(),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0),[custom,setCustom]=useState(false);
 useEffect(()=>{let active=true;setLoading(true);setError('');setBranches(undefined);
  api.getRepositoryBranches(projectId,repo.name).then(result=>{if(active)setBranches(result.branches);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[projectId,repo.name,repo.url,reload]);
 useEffect(()=>{if(custom||!branches||branches.some(branch=>branchRef(branch)===value))return;const fallback=branches.some(branch=>branchRef(branch)===branchRef(repo.branch))?branchRef(repo.branch):'';if(value!==fallback)onChange(fallback);},[branches,custom,repo.branch,value,onChange]);
 const ready=custom?!!value.trim():!loading&&!!branches?.some(branch=>branchRef(branch)===value);
 useEffect(()=>{onReadyChange(repo.name,ready);},[repo.name,ready,onReadyChange]);
 return <div className="form-field-group"><label className="form-field"><span>{repo.name} 来源分支</span><select aria-label={`${repo.name} 来源分支`} className="h-8 w-full rounded-md border bg-background px-3 text-xs" disabled={disabled||loading} value={custom?referenceOption:ready?value:''} onChange={e=>{const reference=e.target.value===referenceOption;setCustom(reference);onChange(reference?'':e.target.value);}}>
 <option value="" disabled>{loading?'正在读取远端分支…':error?'分支读取失败':branches?.length?'请选择已有分支':'暂无远端分支'}</option>
 {branches?.map(branch=><option key={branch} value={branchRef(branch)}>{branch}</option>)}<option value={referenceOption}>使用标签或提交 SHA…</option>
 </select></label>
 {custom?<Input aria-label={`${repo.name} 标签或提交 SHA`} required maxLength={200} placeholder="标签名或完整提交 SHA" value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}/>:<p className="text-xs leading-6 text-muted-foreground">从所选分支的最新提交创建发布，创建时固定代码版本。</p>}
 {error&&<div className="flex items-center justify-between gap-3"><p role="alert" className="text-xs text-destructive">{error}</p><Button type="button" variant="ghost" size="sm" disabled={disabled||loading} onClick={()=>setReload(n=>n+1)}>重新加载</Button></div>}
 {!loading&&!error&&branches?.length===0&&!custom&&<p className="text-xs text-muted-foreground">仓库还没有分支，请先向远端推送代码。</p>}
 </div>;
}
