import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConnectionLogger} from '../../packages/ui/src/studio/connection-diagnostics.js';

test('connection failures and recovery details remain available in the DevTools console',context=>{
 context.mock.timers.enable({apis:['Date'],now:1000});
 const warnings:any[][]=[],info:any[][]=[];
 const log=createConnectionLogger({warn:(...args)=>warnings.push(args),info:(...args)=>info.push(args)});
 log.recovered('realtime');assert.equal(info.length,0);
 log.failed('realtime','WebSocket 连接关闭 (1006)',30000);
 context.mock.timers.tick(1000);log.recovered('realtime');log.recovered('realtime');
 assert.equal(warnings.length,1);assert.equal(info.length,1);
 assert.equal(warnings[0][0],'[Prism Studio] Connection failed');
 assert.deepEqual(warnings[0][1],{source:'realtime',at:new Date(1000).toISOString(),message:'WebSocket 连接关闭 (1006)',durationMs:30000});
 assert.deepEqual(info[0][1],{source:'realtime',at:new Date(2000).toISOString(),failedAt:new Date(1000).toISOString(),recoveryMs:1000,previousError:'WebSocket 连接关闭 (1006)'});
});

test('retries retain the first failure time and context failures recover independently',context=>{
 context.mock.timers.enable({apis:['Date'],now:1000});
 const warnings:any[][]=[],info:any[][]=[];
 const log=createConnectionLogger({warn:(...args)=>warnings.push(args),info:(...args)=>info.push(args)});
 log.failed('realtime','first failure',10);
 context.mock.timers.tick(100);log.failed('context','/context HTTP 401');
 context.mock.timers.tick(100);log.failed('realtime','latest failure',20);
 context.mock.timers.tick(800);log.recovered('realtime');
 assert.equal(info[0][1].recoveryMs,1000);assert.equal(info[0][1].previousError,'latest failure');
 context.mock.timers.tick(200);log.recovered('context');assert.equal(info[1][1].recoveryMs,1100);
 assert.equal(warnings.length,3);assert.ok(!('durationMs' in warnings[1][1]));
});
