// Offline preflight for the real container sandbox, before accepting Agent work.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');

if(process.argv[2]==='--worker'){
 const root=process.argv[3],outside=process.argv[4];
 if(fs.readFileSync(path.join(root,'read.txt'),'utf8')!=='readable')throw Error('Workspace read failed');
 if(fs.readFileSync(path.join(root,'edit.txt'),'utf8')!=='after\n')throw Error('Workspace patch failed');
 try{fs.writeFileSync(outside,'forbidden');throw Error('Outside workspace write unexpectedly allowed');}
 catch(error){if(!['EACCES','EPERM','EROFS'].includes(error.code))throw error;}
 fs.writeFileSync(path.join(root,'passed'),'ok');
}else{
 let root,outside;
 try{
  root=fs.mkdtempSync('/workspace/.prism-sandbox-check-');
  outside=fs.mkdtempSync(path.join(os.homedir(),'.prism-sandbox-check-'));
  const outsideFile=path.join(outside,'outside.txt');fs.writeFileSync(outsideFile,'original');
  fs.writeFileSync(path.join(root,'read.txt'),'readable');
  const create='*** Begin Patch\n*** Add File: edit.txt\n+before\n*** End Patch';
  const update='*** Begin Patch\n*** Update File: edit.txt\n@@\n-before\n+after\n*** End Patch';
  // Match the CLI's shell tool; avoid introducing Node's nested process runner
  // into the sandbox probe. All paths and patches are positional arguments.
  execFileSync('codex',['-c','sandbox_mode="workspace-write"','sandbox','--','bash','-c','set -e; cd "$1"; apply_patch "$2"; apply_patch "$3"; "$4" "$5" --worker "$1" "$6"','probe',root,create,update,process.execPath,__filename,outsideFile],{cwd:'/workspace',timeout:20000,stdio:['ignore','pipe','pipe']});
  if(fs.readFileSync(path.join(root,'passed'),'utf8')!=='ok'||fs.readFileSync(outsideFile,'utf8')!=='original')throw Error('Sandbox verification did not complete');
  console.log('[Codex] 沙箱读取、补丁编辑与工作区边界检查通过');
 }catch(error){
  const detail=error.stderr?.toString().trim()||error.message;
  console.error(`[Codex] 执行环境检查失败：${detail}`);
  console.error('请检查宿主机沙箱策略、镜像中的 apply_patch 和卷权限；修复后重建需求环境。');
  process.exitCode=1;
 }finally{
  if(root)fs.rmSync(root,{recursive:true,force:true});
  if(outside)fs.rmSync(outside,{recursive:true,force:true});
 }
}
