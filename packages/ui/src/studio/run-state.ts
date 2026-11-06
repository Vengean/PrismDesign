export const isRunWorking=(status?:string)=>!!status&&['queued','running','cancelling'].includes(status);
// Keep terminal diagnostics in the assistant bubble even after partial output.
export function runMessageBody(body:string,run?:{status:string;error?:string}){
 const error=run?.error;
 if(!error||!['failed','interrupted'].includes(run!.status)||body.includes(error))return body;
 return body?`${body}\n\n${error}`:error;
}
export function connectionMessage(error:unknown){
 const message=(error instanceof Error?error.message:String(error||'')).split(/[\r\n]/)[0].slice(0,240);
 if(/[\u4e00-\u9fff]/.test(message))return message;
 // Retain the actual failure for the connection tooltip. Hiding every English
 // browser error behind the same text made timeouts and closed tabs indistinguishable.
 const reason=/timeout|timed out/i.test(message)?'平台请求超时':/receiving end|message (?:port|channel)|context invalidated/i.test(message)?'插件与当前页面通信中断':'暂时无法连接平台服务，请检查网络或重新打开预览页面';
 return message?`${reason}（${message}）`:reason+'。';
}
