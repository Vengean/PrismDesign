export function conversationError(raw:string,interrupted:boolean){
 let message:string;
 if(/401|invalid.?api.?key|unauthori[sz]ed|authentication/i.test(raw))message='模型服务鉴权失败，请检查项目中的模型凭证配置。';
 else if(/403|forbidden/i.test(raw))message='模型服务拒绝访问，请检查模型权限和服务配置。';
 else if(/429|rate.?limit|quota/i.test(raw))message='模型服务请求过于频繁或额度不足，请稍后重试并检查模型服务额度。';
 else if(/fetch failed|ECONNREFUSED|ECONNRESET|socket|websocket|aborted|terminated|premature close|连接执行失败/i.test(raw))message='Agent 或模型服务连接异常，请检查需求环境及模型服务。';
 else if(/timeout|timed out|超时/i.test(raw))message='Agent 服务响应超时，请检查需求环境和模型服务。';
 else {
  const lines=raw.split(/[\r\n]/).map(line=>line.trim());
  const errorLine=lines.find(line=>/^[\w.]*Error(?: \[[^\]]+\])?:/.test(line)&&/[\u4e00-\u9fff]/.test(line));
  const readable=errorLine?.replace(/^[\w.]*Error(?: \[[^\]]+\])?:\s*/,'')||lines.find(line=>/[\u4e00-\u9fff]/.test(line)&&!/^((if|const|let|var|throw)\b|at\b|.*\bthrow\s+Error\s*\()/.test(line));
  message=readable?.slice(0,300)||'Agent 执行异常，请查看环境日志后重试。';
 }
 if(interrupted&&!message.includes('重启'))message+=' 本轮任务已中断，请重启需求环境后继续；源码和历史对话会保留。';
 return message;
}
