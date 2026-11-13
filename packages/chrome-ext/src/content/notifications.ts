// The background owns notification delivery. This script only announces a
// preview and reports whether its embedded conversation is actually visible.
const platform=()=>!!document.querySelector('meta[name="prism-platform"]');
const announce=()=>{if(platform())void chrome.runtime.sendMessage({type:'PRISM_NOTIFICATION_DISCOVER'}).catch(()=>{});};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',announce,{once:true});else announce();
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
 if(message?.type==='PRISM_NOTIFICATION_PAGE_STATE'){
  const viewport=document.getElementById('prism-studio-widget')?.shadowRoot?.querySelector<HTMLElement>('[data-chat-viewport]');
  const rect=viewport?.getBoundingClientRect();
  respond({reading:platform()&&document.visibilityState==='visible'&&!!viewport&&!!rect&&rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight&&viewport.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})});
 }
 if(message?.type==='PRISM_NOTIFICATION_OPEN_CHAT'&&platform()){
  const deadline=Date.now()+5000;
  const open=()=>{const button=document.getElementById('prism-studio-widget')?.shadowRoot?.querySelector<HTMLElement>('.prism-fab');if(button)button.click();else if(Date.now()<deadline)setTimeout(open,100);};
  open();respond({success:true});
 }
});
