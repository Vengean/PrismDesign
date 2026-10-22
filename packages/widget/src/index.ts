import {mountPlatformWidget} from './platform.js';
const platformNonce=typeof document!=='undefined'?(document.currentScript as HTMLScriptElement|null)?.nonce||'':'';
export interface PrismWidgetOptions {
 position?:'bottom-right'|'bottom-left';
 locale?:'zh'|'en';
 /** @deprecated Platform previews manage authentication automatically. */
 agentUrl?:string;agentToken?:string;accessTokenRequired?:boolean;
}
let initialized=false;
export function init(_options?:PrismWidgetOptions){
 if(initialized)return;initialized=true;mountPlatformWidget(platformNonce);
}
if(typeof window!=='undefined'&&document.querySelector('meta[name="prism-platform"]')){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init(),{once:true});else init();
}
