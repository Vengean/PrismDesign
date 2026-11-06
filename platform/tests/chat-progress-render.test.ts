import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../packages/ui/package.json',import.meta.url));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
import {ChatPanel,type ChatState} from '../../packages/ui/src/studio/ChatPanel.js';
const noop=()=>{};
function render(sending:boolean){
 const chat:ChatState={messages:[{role:'ai',content:sending?'中途说明：接着验证构建。':'最终回复：验证已完成。',pending:sending,timestamp:1}],sending,activityText:'中途说明：接着验证构建。',progress:'读取 package.json',activity:[{id:'a',label:'读取 package.json',status:sending?'running':'completed'}],sendMessage:noop,startVerification:noop,fixVerification:noop,cancelCurrent:noop,clearHistory:noop,deleteMessage:noop};
 return renderToStaticMarkup(React.createElement(ChatPanel,{chat,selection:null,comments:[],onEditComment:noop,onRemoveComment:noop,onCommentsSent:noop,commentMode:false,onToggleCommentMode:noop,onRestoreMessage:noop}));
}
test('processing appears only in the pending message without an execution list or bottom panel',()=>{
 const working=render(true);
 assert.ok(!working.includes('<details'));assert.ok(!working.includes('进度记录'));
 assert.equal(working.split('读取 package.json').length-1,1);
 assert.ok(!working.includes('中途说明'));assert.ok(!/<textarea[^>]*disabled/.test(working));
 const completed=render(false);assert.match(completed,/最终回复：验证已完成/);
 assert.ok(!completed.includes('读取 package.json'));assert.ok(!completed.includes('中途说明'));
});
