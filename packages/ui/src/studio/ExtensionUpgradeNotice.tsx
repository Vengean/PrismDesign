import React from 'react';
import {extensionCompatibility,type ExtensionRelease} from './extension-compatibility.js';

const DISMISSED_RELEASE='prism-extension-dismissed-release';
export function ExtensionUpgradeNotice({version,release,onOpenExtensions}:{version?:string;release:ExtensionRelease;onOpenExtensions:()=>void}){
 const state=extensionCompatibility(version,release);
 const key=`${version||'unknown'}:${release.latestVersion}`;
 const [dismissed,setDismissed]=React.useState(()=>{try{return localStorage.getItem(DISMISSED_RELEASE)||'';}catch{return '';}});
 if(!state.update||!state.required&&dismissed===key)return null;
 const dismiss=()=>{setDismissed(key);try{localStorage.setItem(DISMISSED_RELEASE,key);}catch{}};
 return <aside data-extension-upgrade role={state.required?'alert':'status'} className="absolute inset-x-2 top-full z-50 mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-normal leading-5 text-amber-950 shadow-lg">
  <div className="flex items-start gap-2">
   <p className="flex-1">{state.required?'当前插件不兼容，请升级':'插件有新版本，建议升级'}（{state.current} → {release.latestVersion}）</p>
   {!state.required&&<button type="button" aria-label="关闭升级提醒" title="关闭升级提醒" className="shrink-0 rounded px-1 hover:bg-amber-100" onClick={dismiss}>×</button>}
  </div>
  <a className="font-medium underline" href={release.downloadUrl} target="_blank" rel="noreferrer">下载新版插件</a>
  <p>解压后在 <a className="font-medium underline" href="chrome://extensions/" target="_blank" rel="noreferrer" onClick={event=>{event.preventDefault();onOpenExtensions();}}>chrome://extensions</a> 更新或重新加载，再刷新预览页。</p>
 </aside>;
}
