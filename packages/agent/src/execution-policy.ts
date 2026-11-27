import fs from 'node:fs';
import path from 'node:path';

/** The container is the tenant boundary; keep the model's workspace sandbox. */
export function executionPolicy(root:string,readOnly=false,env:NodeJS.ProcessEnv=process.env){
 const writable=!readOnly&&env.PRISM_PERMISSION_FILESYSTEM!=='read-only';
 const directories:string[]=[];
 if(writable&&env.PRISM_RUNTIME_CONTAINER==='true'){
  for(const directory of ['.codex','.agents','.claude'].map(name=>path.join(root,name))){
   fs.mkdirSync(directory,{recursive:true});
   const actual=fs.realpathSync(directory);
   if(!actual.startsWith(fs.realpathSync(root)+path.sep))throw Error('项目配置目录不能指向工作区外');
   directories.push(actual);
  }
  // Codex stores CLI configuration together with its project-scoped login.
  // This root belongs only to the current project's mounted auth volume.
  if(env.CODEX_HOME){
   fs.mkdirSync(env.CODEX_HOME,{recursive:true,mode:0o700});
   try{fs.accessSync(env.CODEX_HOME,fs.constants.W_OK);directories.push(fs.realpathSync(env.CODEX_HOME));}catch{}
  }
 }
 return {sandboxMode:writable?'workspace-write' as const:'read-only' as const,
  approvalPolicy:env.PRISM_RUNTIME_CONTAINER==='true'||env.PRISM_PERMISSION_COMMANDS==='workspace'?'never' as const:'on-request' as const,
  networkAccessEnabled:!readOnly&&env.PRISM_PERMISSION_NETWORK==='true',additionalDirectories:directories};
}
