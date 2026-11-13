export function workspaceFilePath(href:string|undefined){
 if(!href)return undefined;
 const prefix=href.startsWith('sandbox:/workspace/')?'sandbox:/workspace/':'/workspace/';
 if(!href.startsWith(prefix))return undefined;
 try{const path=decodeURIComponent(href.slice(prefix.length));if(!path||/[\x00-\x1f\\]/.test(path)||path.split('/').some(part=>['..','.','.git','.prism'].includes(part)))return undefined;return path;}catch{return undefined;}
}
