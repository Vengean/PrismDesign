export interface ExtensionRelease {latestVersion:string;minVersion:string;downloadUrl:string}
function parts(version?:string){return version&&/^\d+(?:\.\d+){2,3}$/.test(version)?version.split('.').map(Number):undefined;}
export function compareExtensionVersions(a:string,b:string){const left=parts(a),right=parts(b);if(!left||!right)throw Error('插件版本格式无效');for(let i=0;i<4;i++){const delta=(left[i]||0)-(right[i]||0);if(delta)return Math.sign(delta);}return 0;}
export function extensionCompatibility(version:string|undefined,release:ExtensionRelease){
 if(!parts(version))return {required:true,update:true,current:'未知'};
 return {required:compareExtensionVersions(version!,release.minVersion)<0,update:compareExtensionVersions(version!,release.latestVersion)<0,current:version!};
}
