import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {remarkMentions} from './message-identity.js';
// Network and progress updates must not reparse unchanged history.
export const MessageMarkdown = React.memo(function MessageMarkdown({content,mentions='[]',currentUserId}:{content:string;mentions?:string;currentUserId?:string}) {
  return <Markdown remarkPlugins={[remarkGfm,[remarkMentions,{ids:JSON.parse(mentions)}]]} components={{a:({href,children})=>href?.startsWith('#prism-mention-')?<span data-mention-user={decodeURIComponent(href.slice(15))} className={decodeURIComponent(href.slice(15))===currentUserId?'rounded bg-amber-100 px-1 text-amber-900':'rounded bg-blue-50 px-1 text-blue-700'}>{children}</span>:<a href={href}>{children}</a>}}>{content}</Markdown>;
});
