import {containerEngine} from './requirement-runtime.js';
import {projectConfig,resolveProjectGitCredential} from './projects.js';
export interface ReleaseGitJob {action:'branches'|'resolve'|'create'|'head'|'contains'|'merge';url:string;branch:string;source?:string;sha?:string;sourceBranch?:string;expectedTarget?:string;message?:string}
export interface ReleaseGitResult {sha:string;branches?:string[];alreadyMerged?:boolean;conflict?:boolean;conflicts?:string[]}
export type ReleaseGitRunner=(projectId:string,job:ReleaseGitJob)=>Promise<ReleaseGitResult>;
// Also executed against temporary local bare repositories in integration tests.
export const releaseGitProgram=String.raw`
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const input=JSON.parse(process.argv[1]),cwd=fs.mkdtempSync(path.join(os.tmpdir(),'prism-release-'));
const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1'};
function git(...args){return execFileSync('git',['-c','core.hooksPath=/dev/null','-c','user.name=Prism Studio Agent','-c','user.email=agent@prism-studio.dev','-C',cwd,...args],{env,encoding:'utf8',timeout:60000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']}).trim();}
function valid(value){if(typeof value!=='string'||!value||value.length>200||value.startsWith('-')||/[\s\x00-\x1f~^:?*\[\\]/.test(value))throw Error('分支、标签或提交标识无效');return value;}
function head(branch){const line=git('ls-remote','--heads','origin','refs/heads/'+valid(branch));return line.split(/\s/)[0]||'';}
function fetch(ref){git('fetch','--no-tags','origin',valid(ref));return git('rev-parse','FETCH_HEAD^{commit}');}
function contains(source,target){try{git('merge-base','--is-ancestor',source,target);return true;}catch(e){if(e.status===1)return false;throw e;}}
try{
 if(env.GIT_ACCESS_TOKEN){const ask=path.join(cwd,'askpass.sh');fs.writeFileSync(ask,'#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "x-access-token";; *) printf "%s\\n" "$GIT_ACCESS_TOKEN";; esac\n',{mode:0o700});env.GIT_ASKPASS=ask;}
 if(env.GIT_SSH_KEY){const key=path.join(cwd,'key');fs.writeFileSync(key,env.GIT_SSH_KEY.replace(/\r\n?/g,'\n').trim()+'\n',{mode:0o600});env.GIT_SSH_COMMAND='ssh -i '+key+' -p '+(env.GIT_SSH_PORT||22)+' -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new';}
 git('init');git('remote','add','origin',input.url);valid(input.branch);
 let result;
 if(input.action==='branches'){const lines=git('ls-remote','--heads','origin');result={sha:'',branches:lines.split('\n').filter(Boolean).map(line=>line.split('\t')[1]).filter(ref=>ref&&ref.startsWith('refs/heads/')).map(ref=>ref.slice('refs/heads/'.length)).sort()};}
 else if(input.action==='resolve')result={sha:fetch(input.source)};
 else if(input.action==='head'){const sha=head(input.branch);if(!sha)throw Error('远端分支不存在，请重试创建分支或检查仓库');result={sha};}
 else if(input.action==='create'){
  if(!/^[a-f0-9]{40,64}$/.test(input.sha||''))throw Error('代码基线无效');
  const existing=head(input.branch);
  if(existing&&existing!==input.sha)throw Error('远端已存在不同版本的同名分支，未覆盖');
  if(!existing){fetch(input.sha);git('push','--porcelain','--force-with-lease=refs/heads/'+input.branch+':','origin',input.sha+':refs/heads/'+input.branch);}
  result={sha:head(input.branch)};if(result.sha!==input.sha)throw Error('远端分支校验失败');
 }else{
  const target=fetch('refs/heads/'+input.branch);if(!/^[a-f0-9]{40,64}$/.test(input.sha||''))throw Error('申请的提交无效');
  // Source may have been deleted after an external normal merge. Fetching the
  // target already includes that source commit; do not require a source ref.
  let known=true;try{git('cat-file','-e',input.sha+'^{commit}');}catch{known=false;}
  if(known&&contains(input.sha,target))result={sha:target,alreadyMerged:true};
  else if(input.action==='contains')result={sha:target,alreadyMerged:false};
  else{
   if(input.expectedTarget&&input.expectedTarget!==target)throw Error('发布分支已更新，请重新同步状态后再同意合入');
   if(head(input.sourceBranch)!==input.sha)throw Error('需求分支已更新，请重新申请合入');
   if(fetch('refs/heads/'+input.sourceBranch)!==input.sha)throw Error('需求分支已更新，请重新申请合入');
   git('checkout','--detach',target);
   try{git('merge','--no-ff','--no-edit','-m',input.message||'Merge requirement',input.sha);}catch(error){
    const conflicts=git('diff','--name-only','--diff-filter=U').split('\n').filter(Boolean);
    if(conflicts.length){result={sha:target,conflict:true,conflicts};}else throw error;
   }
   if(!result){const sha=git('rev-parse','HEAD');if(!contains(target,sha))throw Error('合入结果未保留发布历史');
    git('push','--porcelain','--force-with-lease=refs/heads/'+input.branch+':'+target,'origin',sha+':refs/heads/'+input.branch);result={sha};}
  }
 }
 console.log(JSON.stringify({success:true,...result}));
}catch(error){const raw=String(error.stderr||error.message||'');let message;
 if(!error.stderr&&/[\u4e00-\u9fff]/.test(error.message))message=error.message;
 else if(/incorrect passphrase|passphrase required|encrypted private key/i.test(raw))message='SSH 私钥需要口令，当前非交互环境无法解锁，请配置专用的无口令私钥';
 else if(/Load key .*invalid format|error in libcrypto|not a private key|invalid key/i.test(raw))message='SSH 私钥格式无法解析，请检查是否粘贴了完整私钥内容';
 else if(/Authentication|Permission denied|403|401|could not read Username/i.test(raw))message='仓库鉴权失败，请检查 Git 凭证与分支写权限';
 else if(/stale info|rejected|non-fast-forward/i.test(raw))message='远端分支已变化，未覆盖任何提交，请同步状态后重试';
 else message='Git 分支操作失败，请检查仓库地址、引用及网络后重试';
 console.log(JSON.stringify({success:false,error:message}));process.exitCode=1;
}finally{fs.rmSync(cwd,{recursive:true,force:true});}
`;
export const runReleaseGit:ReleaseGitRunner=async(projectId,job)=>{
 const config=await projectConfig(projectId);if(!config.gitAuth.credentialRef)throw Error('请先配置项目 Git 凭证');
 const auth=await resolveProjectGitCredential(projectId,config.gitAuth.credentialRef);
 const container=await containerEngine(180000).createContainer({Image:process.env.PRISM_WORKSPACE_IMAGE||'prism-workspace:latest',Entrypoint:['node'],Cmd:['-e',releaseGitProgram,JSON.stringify(job)],WorkingDir:'/tmp',Env:[`GIT_ACCESS_TOKEN=${auth.mode==='token'?auth.secret:''}`,`GIT_SSH_KEY=${auth.mode==='ssh'?auth.secret:''}`,`GIT_SSH_PORT=${config.gitAuth.sshPort}`],Labels:{'prism.git-helper':'true'},HostConfig:{Memory:256*1024*1024,PidsLimit:64,CapDrop:['ALL'],SecurityOpt:['no-new-privileges']}});
 const timer=setTimeout(()=>{void container.kill().catch(()=>{});},180000);
 try{
  await container.start();await container.wait();const raw=await container.logs({stdout:true,stderr:true,tail:10});
  let text='';
  // Logs are Docker multiplexed frames, not plaintext. Never forward raw logs.
  const bytes=Buffer.isBuffer(raw)?raw:Buffer.from(raw as any);let offset=0;
  while(offset+8<=bytes.length){const size=bytes.readUInt32BE(offset+4);if(offset+8+size>bytes.length)break;if(bytes[offset]===1)text+=bytes.subarray(offset+8,offset+8+size).toString();offset+=8+size;}
  const result=JSON.parse(text.trim().split('\n').at(-1)||'{}');if(!result.success)throw Error(result.error||'Git 操作未返回有效结果');return result;
 }finally{clearTimeout(timer);await container.remove({force:true}).catch(()=>{});}
};
