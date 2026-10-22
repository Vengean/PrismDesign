import {useEffect,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {Loader2} from 'lucide-react';
import {api} from '@/lib/api';
import {Button} from '@/components/ui/button';
export default function PreviewContinue(){
 const [params]=useSearchParams();const [error,setError]=useState(''),[retry,setRetry]=useState(0);
 const project=params.get('project')||'',requirement=params.get('requirement')||'',kind=params.get('kind')||'',port=params.get('port'),path=params.get('path')||'/';
 useEffect(()=>{
  let active=true;
  if(!project||!requirement||!['preview','ide'].includes(kind)||(port!==null&&(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535))){setError('预览目标无效，请从项目需求页面重新打开。');return;}
  setError('');
  void api.openEnvironment(project,requirement,kind as 'preview'|'ide',port?Number(port):undefined).then(({url})=>{
   if(!active)return;
   const target=new URL(url);if(!['http:','https:'].includes(target.protocol))throw Error('平台返回了无效的预览地址');
   // The gateway validates this path before redirecting; no JWT is sent to it.
   target.searchParams.set('path',path);window.location.replace(target.toString());
  }).catch(e=>{if(active)setError(e instanceof Error?e.message:'无法打开预览，请稍后重试');});
  return()=>{active=false;};
 },[project,requirement,kind,port,path,retry]);
 return <div className="mx-auto flex min-h-72 max-w-lg flex-col items-center justify-center gap-4 px-5 text-center">{error?<><p role="alert" className="text-sm text-destructive">{error}</p><div className="flex gap-3"><Button variant="outline" onClick={()=>setRetry(value=>value+1)}>重试</Button><Button asChild><Link to={project?`/projects/${encodeURIComponent(project)}`:'/projects'}>返回项目</Link></Button></div></>:<><Loader2 className="h-5 w-5 animate-spin"/><p role="status" className="text-sm text-muted-foreground">正在恢复预览…</p></>}</div>;
}
