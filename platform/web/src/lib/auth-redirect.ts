export function safeLoginNext(value:string|null|undefined){
 if(!value||!value.startsWith('/')||value.startsWith('//')||/[\\\r\n]/.test(value))return '/projects';
 try{const url=new URL(value,'http://platform');if(url.origin!=='http://platform'||url.pathname==='/login')return '/projects';return url.pathname+url.search+url.hash;}catch{return '/projects';}
}
export function loginLocation(next:string){return '/login?'+new URLSearchParams({next:safeLoginNext(next)});}
