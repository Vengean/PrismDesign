import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file:string,context:Record<string,unknown>){const exports:any={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,{exports,...context});return exports;}
test('chat scrolls to the latest messages when a hidden widget opens, including reopening',()=>{
 let resize=()=>{},disconnected=false;
 const {observeChatViewport}=load('../../packages/ui/src/studio/chat-viewport.ts',{ResizeObserver:class{constructor(callback:()=>void){resize=callback;}observe(){}disconnect(){disconnected=true;}}});
 const element={clientHeight:0,clientWidth:0,offsetWidth:0,scrollHeight:1000,scrollTop:0};
 const stop=observeChatViewport(element,()=>{});assert.equal(element.scrollTop,0);
 element.clientHeight=400;element.clientWidth=380;element.offsetWidth=392;resize();assert.equal(element.scrollTop,1000);
 element.scrollTop=200;resize();assert.equal(element.scrollTop,200,'ordinary size updates must not steal the reading position');
 element.clientHeight=0;element.clientWidth=0;resize();element.scrollHeight=1500;element.clientHeight=400;element.clientWidth=380;resize();assert.equal(element.scrollTop,1500);
 stop();assert.equal(disconnected,true);
});
test('Widget restores open/closed state after refresh and retains extension-first clicks',()=>{
 const values=new Map<string,string>();
 class Element{className='';innerHTML='';textContent='';style:any={setProperty(){}};onclick?:()=>void;children:Element[]=[];classList={add:()=>{},remove:()=>{}};addEventListener(){};appendChild(el:Element){this.children.push(el);}remove(){}}
 const mq={matches:false,addEventListener(){},removeEventListener(){}};
 const {createPanel}=load('../../packages/widget/src/panel.ts',{document:{createElement:()=>new Element()},window:{matchMedia:()=>mq,innerHeight:800,addEventListener(){},removeEventListener(){}},localStorage:{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value)},requestAnimationFrame:(callback:()=>void)=>callback(),require:(name:string)=>name.includes('icons')?{ICON_CLOSE:'close',ICON_PRISM:'logo'}:{t:()=> 'Prism Studio'}});
 const shadow=()=>new Element();let root=shadow(),panel=createPanel(root);assert.equal(panel.isVisible(),false);panel.show();panel.destroy();panel=createPanel(shadow());assert.equal(panel.isVisible(),true);
 panel.hide();panel.destroy();panel=createPanel(shadow());assert.equal(panel.isVisible(),false);
 let extensionRequested=false;root=shadow();panel=createPanel(root,'bottom-right',()=>{extensionRequested=true;return true;});
 root.children.find((el:Element)=>el.className.includes('prism-container'))!.children.find((el:Element)=>el.className==='prism-fab')!.onclick!();assert.equal(extensionRequested,true);assert.equal(panel.isVisible(),false);
 panel.show();assert.equal(panel.isVisible(),true,'a failed extension open can still show the Widget fallback');
});

test('mobile sheet follows the visual viewport and closes through its backdrop',()=>{
 const listeners=new Map<string,()=>void>(), properties=new Map<string,string>();
 class Element{className='';innerHTML='';textContent='';style:any={setProperty:(key:string,value:string)=>properties.set(key,value)};onclick?:()=>void;children:Element[]=[];classes=new Set<string>();classList={add:(name:string)=>this.classes.add(name),remove:(name:string)=>this.classes.delete(name)};addEventListener(){}appendChild(el:Element){this.children.push(el);}remove(){}}
 let breakpointChanged=()=>{};const mq={matches:true,addEventListener:(_name:string,callback:()=>void)=>{breakpointChanged=callback;},removeEventListener(){}};
 const viewport={width:375,height:780,offsetLeft:0,offsetTop:0,addEventListener:(name:string,callback:()=>void)=>listeners.set(name,callback),removeEventListener:(name:string)=>listeners.delete(name)};
 const {createPanel}=load('../../packages/widget/src/panel.ts',{document:{createElement:()=>new Element()},window:{innerHeight:800,visualViewport:viewport,matchMedia:()=>mq,addEventListener(){},removeEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},require:(name:string)=>name.includes('icons')?{ICON_CLOSE:'close',ICON_PRISM:'logo'}:{t:()=> 'Prism Studio'}});
 const root=Object.assign(new Element(),{host:new Element()}),panel=createPanel(root);assert.equal(root.host.classes.has('prism-mobile'),true);assert.equal(root.children.filter(el=>el.className.includes('prism-container')).length,1);panel.show();
 const backdrop=root.children.find(el=>el.className==='prism-backdrop')!;
 assert.equal(backdrop.classes.has('open'),true);
 viewport.height=430;listeners.get('resize')!();
 assert.equal(properties.get('--prism-viewport-height'),'430px');assert.equal(properties.get('--prism-viewport-width'),'375px');
 viewport.offsetLeft=12;viewport.offsetTop=8;listeners.get('scroll')!();assert.equal(properties.get('--prism-viewport-left'),'12px');assert.equal(properties.get('--prism-viewport-top'),'8px');
 backdrop.onclick!();assert.equal(panel.isVisible(),false);assert.equal(backdrop.classes.has('open'),false);
 const container=root.children.find(el=>el.className.includes('prism-container'))!;
 assert.equal(container.children.filter(el=>el.className==='prism-fab').length,1);
 mq.matches=false;breakpointChanged();assert.equal(root.host.classes.has('prism-mobile'),false);
 mq.matches=true;breakpointChanged();assert.equal(root.host.classes.has('prism-mobile'),true);
 container.children.find(el=>el.className==='prism-fab')!.onclick!();assert.equal(panel.isVisible(),true);
 panel.destroy();assert.equal(listeners.size,0);
});
test('Widget mounts outside body and enters the browser top layer',()=>{
 let parent:any,topLayer=false,observed:any;
 class Element{ id='';className='';style={setProperty(){}};attrs=new Set<string>();classList={add(){},remove(){}};appendChild(child:any){parent=this;return child;}setAttribute(key:string){this.attrs.add(key);}hasAttribute(key:string){return this.attrs.has(key);}removeAttribute(key:string){this.attrs.delete(key);}showPopover(){topLayer=true;}attachShadow(){return {appendChild(){},querySelectorAll:()=>[],querySelector:()=>null};}}
 const html=new Element(),body=new Element();
 const {mountPlatformWidget}=load('../../packages/widget/src/platform-ui.tsx',{
  React:{createElement(){}},
  document:{getElementById:()=>null,createElement:()=>new Element(),documentElement:html,body},
  window:{addEventListener(){},postMessage(){}},location:{origin:'https://preview.example'},setInterval:()=>1,
  MutationObserver:class{constructor(_callback:any){}observe(target:any){observed=target;}},
  require:(name:string)=>{
   if(name==='react-dom/client')return {createRoot:()=>({render(){}})};
   if(name==='react')return {createElement(){}};
   if(name.includes('studio.css'))return {default:':root{}'};
   if(name.includes('platform-shell'))return {PLATFORM_SHELL_CSS:''};
   if(name.includes('panel.js'))return {createPanel:()=>({getBody:()=>new Element(),onVisibilityChange(){}})};
   if(name.includes('platform-annotations'))return {createPageAnnotations:()=>({})};
   if(name.includes('platform-client'))return {requestId:()=> 'n'};
   return {};
  }
 });
 mountPlatformWidget();assert.equal(parent,html);assert.notEqual(parent,body);assert.equal(topLayer,true);assert.equal(observed,html);
});
