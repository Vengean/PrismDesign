import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safePreviewPath,isPreviewNavigation,previewLoginUrl} from '../src/services/preview-navigation.js';
import {safeLoginNext,loginLocation} from '../web/src/lib/auth-redirect.js';
test('LAN preview redirects to management UI and preserves the authorized target without credentials',()=>{
 const original=process.env.PRISM_PLATFORM_URL;delete process.env.PRISM_PLATFORM_URL;
 try{
  const login=new URL(previewLoginUrl({projectId:'p',requirementId:'r',kind:'preview',servicePort:5173,path:'/dashboard?a=1&b=中文',host:'192.168.1.8:49694',platformOrigin:'http://localhost:5173'}));
  assert.equal(login.origin,'http://192.168.1.8:5173');assert.equal(login.pathname,'/login');
  const next=new URL(login.searchParams.get('next')!,'http://platform');assert.equal(next.pathname,'/preview/continue');assert.equal(next.searchParams.get('project'),'p');assert.equal(next.searchParams.get('requirement'),'r');assert.equal(next.searchParams.get('kind'),'preview');assert.equal(next.searchParams.get('port'),'5173');assert.equal(next.searchParams.get('path'),'/dashboard?a=1&b=%E4%B8%AD%E6%96%87');
  assert.ok(!login.toString().includes('ticket='));
  process.env.PRISM_PLATFORM_URL='https://studio.example';assert.equal(new URL(previewLoginUrl({projectId:'p',requirementId:'r',kind:'ide',path:'/',host:'192.168.1.8:49694'})).origin,'https://studio.example');
 }finally{if(original===undefined)delete process.env.PRISM_PLATFORM_URL;else process.env.PRISM_PLATFORM_URL=original;}
});
test('only browser page navigation redirects; platform APIs retain status responses',()=>{
 const page={method:'GET',headers:{accept:'text/html,application/xhtml+xml'}};
 assert.equal(isPreviewNavigation(page,'/dashboard'),true);assert.equal(isPreviewNavigation(page,'/__prism_open'),true);assert.equal(isPreviewNavigation(page,'/__prism_platform__/conversation'),false);assert.equal(isPreviewNavigation({...page,method:'POST'},'/dashboard'),false);assert.equal(isPreviewNavigation({method:'GET',headers:{accept:'application/json'}},'/'),false);
});
test('login and preview return paths reject external origins, backslashes and header injection',()=>{
 for(const value of ['https://evil.example','//evil.example','/\\evil.example','/\r\nLocation: https://evil.example']){assert.equal(safePreviewPath(value),'/');assert.equal(safeLoginNext(value),'/projects');}
 assert.equal(safeLoginNext('/login?next=/login'),'/projects');assert.equal(safePreviewPath('/nested?q=1'),'/nested?q=1');assert.equal(safeLoginNext('/preview/continue?project=p'),'/preview/continue?project=p');assert.equal(new URL(loginLocation('/projects/p?q=1'),'http://platform').searchParams.get('next'),'/projects/p?q=1');
});
