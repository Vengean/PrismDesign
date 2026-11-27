import React from 'react';
import Markdown,{defaultUrlTransform,type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {remarkMentions} from './message-identity.js';
import {remarkCjkStrong} from './remark-cjk-strong.js';
import {workspaceFilePath} from './workspace-file-path.js';
function WorkspaceImage({path,alt,load}:{path:string;alt?:string;load?:(path:string)=>Promise<Blob>}){
 const [url,setUrl]=React.useState(''),[error,setError]=React.useState('');
 React.useEffect(()=>{let active=true,objectUrl='';setUrl('');setError('');
  if(!load){setError('请通过下载原图查看');return;}
  void load(path).then(blob=>{if(active){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}}).catch(e=>{if(active)setError(e.message||'图片加载失败');});
  return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[path,load]);
 if(error)return <span role="alert" className="text-xs text-muted-foreground">{alt||'生成图片'}：{error}</span>;
 return url?<a href={url} target="_blank" rel="noreferrer"><img src={url} alt={alt||'生成图片'} className="my-2 h-auto max-w-full rounded border"/></a>:<span role="status">正在加载图片…</span>;
}
// Network and progress updates must not reparse unchanged history.
export const MessageMarkdown = React.memo(function MessageMarkdown({content,mentions='[]',currentUserId,onWorkspaceDownload,loadWorkspaceImage}:{content:string;mentions?:string;currentUserId?:string;onWorkspaceDownload?:(path:string)=>void;loadWorkspaceImage?:(path:string)=>Promise<Blob>}) {
  const components=React.useMemo<Components>(()=>({
    img:({src,alt})=>{
      const path=workspaceFilePath(typeof src==='string'?src:undefined);
      return path!==undefined?<WorkspaceImage path={path} alt={alt} load={loadWorkspaceImage}/>:<img src={src} alt={alt} loading="lazy"/>;
    },
    a:({href,children})=>href?.startsWith('#prism-mention-')
      ?<span data-mention-user={decodeURIComponent(href.slice(15))} className={decodeURIComponent(href.slice(15))===currentUserId?'rounded bg-amber-100 px-1 text-amber-900':'rounded bg-blue-50 px-1 text-blue-700'}>{children}</span>
      :<a href={href} onClick={event=>{const path=workspaceFilePath(href);if(onWorkspaceDownload&&path!==undefined){event.preventDefault();onWorkspaceDownload(path);}}}>{children}</a>,
  }),[loadWorkspaceImage,onWorkspaceDownload,currentUserId]);
  return <Markdown urlTransform={url=>(onWorkspaceDownload||loadWorkspaceImage)&&workspaceFilePath(url)!==undefined?url:defaultUrlTransform(url)} remarkPlugins={[remarkGfm,remarkCjkStrong,[remarkMentions,{ids:JSON.parse(mentions)}]]} components={components}>{content}</Markdown>;

});
