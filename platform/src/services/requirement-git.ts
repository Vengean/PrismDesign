import {projectConfig} from './projects.js';
import {requirement,execRuntime,redactRuntimeText,withGitOperation} from './requirement-runtime.js';

// Arguments are passed as JSON and argv; repository names never become shell code.
export const gitOperationScript=String.raw`
(()=>{
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const input=JSON.parse(process.argv[1]);
const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'/tmp/prism-askpass',GIT_OPTIONAL_LOCKS:'0'};
if(process.env.GIT_SSH_KEY)env.GIT_SSH_COMMAND='ssh -i '+process.env.HOME+'/.ssh/id_prism -p '+(process.env.GIT_SSH_PORT||22)+' -o BatchMode=yes -o StrictHostKeyChecking=accept-new';
const root=fs.realpathSync(input.root||'/workspace'),cwd=fs.realpathSync(path.join(root,input.repo));
if(!cwd.startsWith(root+path.sep))throw Error('仓库目录无效');
function git(args){return execFileSync('git',['-c','core.hooksPath=/dev/null','-C',cwd,...args],{env,encoding:'utf8',timeout:60000,maxBuffer:512*1024,stdio:['ignore','pipe','pipe']}).trim();}
try{
 if(git(['branch','--show-current'])!==input.branch)throw Error('当前工作区不在需求分支，操作已取消');
 const dirty=git(['status','--porcelain','-z']);
 if(input.action==='status'){console.log(JSON.stringify({success:true,message:'仓库状态已更新',dirty:!!dirty}));return;}
 if(input.action==='commit'){
  if(typeof input.message!=='string'||!input.message.trim()||input.message.trim().length>500)throw Error('请填写 1–500 字的提交说明');
  if(!dirty)throw Error('当前仓库没有需要提交的修改');
  git(['add','--all','--','.']);git(['commit','-m',input.message.trim()]);
  console.log(JSON.stringify({success:true,message:'代码已提交，可继续 Pull / Push',commit:git(['rev-parse','HEAD'])}));return;
 }
 if(dirty)throw Error('当前仓库有未提交修改，请点击“提交代码”后继续同步');
 let message;
 if(input.action==='pull'){
  git(['fetch','--no-tags','origin',input.branch]);
  git(['merge','--ff-only','FETCH_HEAD']);message='Pull 完成，需求分支已同步';
 }else if(input.action==='push'){
  git(['push','--porcelain','origin','HEAD:refs/heads/'+input.branch]);message='Push 完成，需求分支已推送';
 }else throw Error('不支持的 Git 操作');
 console.log(JSON.stringify({success:true,message,commit:git(['rev-parse','HEAD'])}));
}catch(error){
 const detail=String(error.stderr||error.message||'');let message;
 if(!error.stderr&&/[\u4e00-\u9fff]/.test(error.message))message=error.message;
 else if(/couldn.t find remote ref|remote ref does not exist/i.test(detail))message='远端尚无此需求分支，请先 Push 创建远端分支';
 else if(/non-fast-forward|fetch first|rejected|Not possible to fast-forward|divergent/i.test(detail))message='本地与远端分支存在分叉，操作已停止。请先处理提交差异后重试';
 else if(/Authentication|Permission denied|could not read Username|403|401/i.test(detail))message='Git 鉴权失败，请检查项目凭证与仓库读写权限，更新后重启环境';
 else if(error.code==='ETIMEDOUT')message='Git 操作超时，请检查代码平台网络后重试';
 else if(input.action==='commit')message='代码提交失败，请检查是否存在未解决的冲突，以及 Git 提交身份是否配置正确';
 else message='Git 操作失败，请检查仓库地址、网络和权限后重试';
 console.log(JSON.stringify({success:false,message}));process.exitCode=1;
}
})();
`;
export async function operateRequirementGit(id:string,repo:string,action:'pull'|'push'|'commit'|'status',message?:string){
 const r=requirement(id),config=projectConfig(r.project_id);
 if(!/^[a-zA-Z0-9_-]+$/.test(repo)||!config.repos.some(item=>item.name===repo))throw Error('仓库不存在');
 if(action==='commit'&&(typeof message!=='string'||!message.trim()||message.trim().length>500))throw Error('请填写 1–500 字的提交说明');
 const execute=async()=>{
  const result=await execRuntime(id,['node','-e',gitOperationScript,JSON.stringify({repo,branch:`prism/requirement-${id}`,action,message})],0);
  try{const value=JSON.parse(redactRuntimeText(id,result.text));if(typeof value.success!=='boolean'||typeof value.message!=='string')throw Error();return value as {success:boolean;message:string;commit?:string;dirty?:boolean};}catch{throw Error('无法获取 Git 操作结果，请确认需求环境正在运行');}
 };
 return action==='status'?execute():withGitOperation(id,execute);
}
