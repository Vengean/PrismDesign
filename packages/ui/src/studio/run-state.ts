export const isRunWorking=(status?:string)=>!!status&&['queued','running','cancelling'].includes(status);
// Keep terminal diagnostics in the assistant bubble even after partial output.
export function runMessageBody(body:string,run?:{status:string;error?:string}){
 const error=run?.error;
 if(!error||!['failed','interrupted'].includes(run!.status)||body.includes(error))return body;
 return body?`${body}\n\n${error}`:error;
}
export function connectionMessage(error:unknown){
 const message=error instanceof Error?error.message:String(error||'');
 return /[\u4e00-\u9fff]/.test(message)?message.split(/[\r\n]/)[0].slice(0,300):'暂时无法连接平台服务，请检查网络或重新打开预览页面。';
}
