import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conversationError} from '../src/services/conversation-errors.js';
test('service faults return actionable messages without Node stacks',()=>{
 assert.match(conversationError('TypeError: fetch failed\n at internal/fetch',true),/服务连接异常.*重启需求环境/);
 assert.match(conversationError('aborted',true),/服务连接异常.*重启需求环境/);
 assert.match(conversationError('401 Unauthorized',false),/模型服务鉴权失败/);
 assert.match(conversationError('429 rate limit',false),/额度不足/);
 assert.match(conversationError('socket timeout',true),/重启需求环境/);
 assert.equal(conversationError('项目缺少启动脚本\n at eval:5:17',false),'项目缺少启动脚本');
 assert.ok(!conversationError('Error: unknown\n at eval:5:17',false).includes('eval'));
});
test('legacy eval stacks yield the actual error message rather than eval line or source code',()=>{
 const raw=`[eval]:5\nif(!token)throw Error('Agent 尚未准备完成，请稍后重试');\n ^\nError: Agent 尚未准备完成，请稍后重试\n at eval:5:17\nNode.js v22.22.3`;
 assert.equal(conversationError(raw,false),'Agent 尚未准备完成，请稍后重试');
});
