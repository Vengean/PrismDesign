// Platform-only extension: authentication stays in the preview page's HttpOnly
// cookie. The service worker never connects to an Agent or stores Agent tokens.
const visitedTabs=new Set<number>();
const panelPorts=new Set<chrome.runtime.Port>();
function isWebPage(url?:string){return !!url&&/^https?:/i.test(url);}
async function ensureContentScript(tabId:number){
 try{if(await chrome.tabs.sendMessage(tabId,{type:'PING'}))return;}catch{}
 await chrome.scripting.executeScript({target:{tabId},files:['content.js']}).catch(()=>{});
}
async function prepareTab(tab:chrome.tabs.Tab){
 if(tab.id===undefined||!isWebPage(tab.url))return;
 visitedTabs.add(tab.id);await ensureContentScript(tab.id);
}
const clearLegacyCredentials=()=>chrome.storage.local.remove(['agentUrl','agentToken','agentPermissions']);
chrome.runtime.onInstalled.addListener(async()=>{
 await clearLegacyCredentials();
 const tabs=await chrome.tabs.query({url:['http://*/*','https://*/*']});
 await Promise.all(tabs.map(prepareTab));
});
chrome.runtime.onStartup.addListener(()=>{void clearLegacyCredentials();});
chrome.tabs.onRemoved.addListener(tabId=>visitedTabs.delete(tabId));
chrome.tabs.onActivated.addListener(async({tabId})=>{if(!panelPorts.size)return;const tab=await chrome.tabs.get(tabId).catch(()=>undefined);if(tab)await prepareTab(tab);});
chrome.tabs.onUpdated.addListener(async(tabId,change,tab)=>{if(panelPorts.size&&change.status==='complete'&&tab.active)await prepareTab(tab);});
// Request open synchronously, while Chrome's user gesture is still valid.
chrome.action.onClicked.addListener(tab=>{
 if(tab.id===undefined)return;
 void chrome.sidePanel.open({tabId:tab.id}).catch(()=>{});void prepareTab(tab);
});
chrome.runtime.onConnect.addListener(port=>{
 if(port.name!=='prism-sidepanel')return;
 panelPorts.add(port);
 void chrome.tabs.query({active:true,lastFocusedWindow:true}).then(tabs=>tabs[0]&&prepareTab(tabs[0]));
 port.onDisconnect.addListener(()=>{
  panelPorts.delete(port);if(panelPorts.size)return;
  for(const tabId of visitedTabs){
   void chrome.tabs.sendMessage(tabId,{type:'STOP_COMMENT_MODE'}).catch(()=>{});
   void chrome.tabs.sendMessage(tabId,{type:'HIDE_TOOLBAR'}).catch(()=>{});
  }
  visitedTabs.clear();
 });
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(message?.type!=='PRISM_PLATFORM_OPEN'||sender.tab?.id===undefined)return;
 const tabId=sender.tab.id;
 const opening=chrome.sidePanel.open({tabId});visitedTabs.add(tabId);
 opening.then(()=>respond({success:true})).catch(()=>respond({success:false}));return true;
});
