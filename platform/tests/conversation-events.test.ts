import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type {ServerResponse} from 'node:http';
import {waitForConversation,conversationEvents} from '../src/services/conversation-events.js';

test('an idle conversation releases its long poll after 20 seconds without a connection error',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});
 const response=Object.assign(new EventEmitter(),{destroyed:false}) as unknown as ServerResponse;
 let finished=false;
 const waiting=waitForConversation('idle-heartbeat',response,()=>false).then(()=>{finished=true;});
 assert.equal(conversationEvents.listenerCount('idle-heartbeat'),1);
 context.mock.timers.tick(19999);await Promise.resolve();assert.equal(finished,false);
 context.mock.timers.tick(1);await waiting;
 assert.equal(finished,true);assert.equal(conversationEvents.listenerCount('idle-heartbeat'),0);assert.equal(response.listenerCount('close'),0);
});
