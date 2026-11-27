import {test} from 'node:test';import assert from 'node:assert/strict';
import {messageBubbleClass,pendingMessageBoundary,isCancellationNotice} from '../../packages/ui/src/studio/conversation-presentation.js';
test('received user messages have a distinct bubble while Agent messages remain unboxed',()=>{
 assert.notEqual(messageBubbleClass('user',true),messageBubbleClass('user',false));assert.equal(messageBubbleClass('assistant',false),'');assert.equal(messageBubbleClass('ai',false),'');
 assert.ok(isCancellationNotice(JSON.stringify({systemNotice:{type:'run.cancelled',userId:'bob'}})));assert.ok(!isCancellationNotice('invalid'));
});
test('waiting separator follows the first visible pending user message and clears on authoritative acknowledgement',()=>{
 const value:any={restricted:false,active_run:{id:'run-1',status:'running'},agent_read_cursor:0,agent_pending_message:{id:'unloaded',seq:5},messages:[{id:'processing',seq:1,role:'user',run_id:'run-1'},{id:'new-1',seq:6,role:'user',run_id:null},{id:'new-2',seq:7,role:'user',run_id:null}]};
 assert.equal(pendingMessageBoundary(value),'new-1');
 assert.equal(pendingMessageBoundary({...value,agent_pending_message:null}),undefined);
 assert.equal(pendingMessageBoundary({...value,active_run:null}),undefined);
 assert.equal(pendingMessageBoundary({...value,restricted:true}),undefined);
});
