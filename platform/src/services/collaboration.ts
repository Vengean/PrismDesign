import crypto from 'node:crypto';
export interface PendingQuestion {id:string;userId:string;question:string;messageIds:string[]}
export function messageMentions(text:string,members:string[]){return members.filter(id=>new RegExp('@'+id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[\\s，。！？、:：;；,!?()（）])','u').test(text));}
export function collaborationReply(raw:string,members:string[],inputIds:string[],previous:PendingQuestion[]){
 const match=raw.match(/<prism-collaboration>\s*([\s\S]*?)\s*<\/prism-collaboration>/);
 let body=raw.replace(/<prism-collaboration>[\s\S]*?(?:<\/prism-collaboration>|$)/g,'').trim(),decision='reply';
 let mentions=messageMentions(body,members),questions=[...previous];
 if(match)try{
  const value=JSON.parse(match[1]);
  if(['execute','ask','reply','wait'].includes(value.action))decision=value.action;
  if(Array.isArray(value.resolvedQuestionIds))questions=questions.filter(item=>!value.resolvedQuestionIds.includes(item.id));
  if(Array.isArray(value.questions))for(const item of value.questions){
   if(!members.includes(item?.userId)||typeof item.question!=='string'||!item.question.trim())continue;
   const question=item.question.trim().slice(0,2000);
   if(!questions.some(old=>old.userId===item.userId&&old.question===question))questions.push({id:crypto.randomUUID(),userId:item.userId,question,messageIds:Array.isArray(item.messageIds)?item.messageIds.filter((id:unknown)=>typeof id==='string'&&inputIds.includes(id)):inputIds});
   mentions.push(item.userId);
   if(!body.includes(question))body+='\n\n@'+item.userId+' '+question;
  }
  if(Array.isArray(value.mentions))mentions.push(...value.mentions.filter((id:unknown)=>typeof id==='string'&&members.includes(id)));
 }catch{/* Plain replies remain readable; malformed control data never starts another task. */}
 mentions=[...new Set(mentions)];questions=questions.filter(item=>members.includes(item.userId));
 const missing=mentions.filter(id=>!messageMentions(body,[id]).length);
 if(missing.length)body=missing.map(id=>'@'+id).join(' ')+'\n\n'+body;
 return {body,decision,mentions,questions};
}
export function collaborationInstructions(members:string[],questions:PendingQuestion[]){return `你正在一个多人协作群聊中。以下用户 ID 均为当前有编辑权限的成员：${JSON.stringify(members)}。
每轮先完整阅读本批未读消息及未解决问题，自主判断是否需要执行修改、合并需求、回复、询问或等待。不要把每句话当作任务，也不要逐条机械执行。若只是讨论/确认，无需调用修改工具；信息明确时可直接执行。相互矛盾的要求须先澄清。某事项缺信息时可以先处理其他独立、明确的事项。
需要具体成员确认时，在回复中使用 @用户ID 并提出具体问题；不要编造成员。被指定成员以外的转述不能自动代替其明确确认。取消的任务不能自行重启。历史记录仅作上下文，当前执行依据是本批消息和已确认的未解决事项。运行期间新增消息不属于本批，由下一轮处理。
未解决的问题：${JSON.stringify(questions)}
完成后正常输出给群聊看的 Markdown 回复，并在末尾附一个隐藏控制块（不可省略）：
<prism-collaboration>{"action":"execute或ask或reply或wait","mentions":["真实用户ID"],"questions":[{"userId":"需要答复的人","question":"具体问题","messageIds":["对应输入消息ID"]}],"resolvedQuestionIds":["已解决问题ID"]}</prism-collaboration>
控制块必须是合法 JSON。没有新问题/提及时相应数组为空；只有明确解决了旧问题才列 resolvedQuestionIds。已读不代表完成，仍未解决的旧问题须保留。不要循环自问自答，也不要回复不存在的新消息。`;}
