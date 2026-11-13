import React from 'react';
import Markdown,{defaultUrlTransform} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {remarkMentions} from './message-identity.js';
import {workspaceFilePath} from './workspace-file-path.js';
// Network and progress updates must not reparse unchanged history.
export const MessageMarkdown = React.memo(function MessageMarkdown({content,mentions='[]',currentUserId,onWorkspaceDownload}:{content:string;mentions?:string;currentUserId?:string;onWorkspaceDownload?:(path:string)=>void}) {
  return <Markdown urlTransform={url=>onWorkspaceDownload&&workspaceFilePath(url)!==undefined?url:defaultUrlTransform(url)} remarkPlugins={[remarkGfm,[remarkMentions,{ids:JSON.parse(mentions)}]]} components={{a:({href,children})=>href?.startsWith('#prism-mention-')?<span data-mention-user={decodeURIComponent(href.slice(15))} className={decodeURIComponent(href.slice(15))===currentUserId?'rounded bg-amber-100 px-1 text-amber-900':'rounded bg-blue-50 px-1 text-blue-700'}>{children}</span>:<a href={href} onClick={event=>{const path=workspaceFilePath(href);if(onWorkspaceDownload&&path!==undefined){event.preventDefault();onWorkspaceDownload(path);}}}>{children}</a>}}>{content}</Markdown>;
});
