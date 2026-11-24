import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conversationError} from '../src/services/conversation-errors.js';
test('sandbox and missing patch command failures name the environment repair',()=>{
 assert.match(conversationError("bwrap: Can't mount devpts on /newroot/dev/pts: Permission denied",false),/沙箱启动失败.*SELinux.*重建容器/);
 assert.match(conversationError('bash: apply_patch: command not found',false),/缺少 apply_patch.*更新工作区镜像/);
});
test('service faults return actionable messages without Node stacks',()=>{
 assert.match(conversationError('TypeError: fetch failed\n at internal/fetch',true),/服务连接异常.*重启需求环境/);
 assert.match(conversationError('aborted',true),/服务连接异常.*重启需求环境/);
 assert.match(conversationError('401 Unauthorized',false),/模型服务鉴权失败/);
 assert.match(conversationError('429 rate limit',false),/额度不足/);
 assert.match(conversationError('socket timeout',true),/重启需求环境/);
 assert.equal(conversationError('项目缺少启动脚本\n at eval:5:17',false),'项目缺少启动脚本');
 assert.ok(!conversationError('Error: unknown\n at eval:5:17',false).includes('eval'));
});
test('unsupported model IDs produce an actionable message without exposing protocol JSON',()=>{
 const raw=JSON.stringify({detail:"The 'GPT-6.2-Sol' model is not supported when using Codex with a ChatGPT account.",error:{code:'model_not_found'}});
 const message=conversationError(raw,false);
 assert.match(message,/GPT-6.2-Sol/);assert.match(message,/区分大小写/);assert.match(message,/认证模式/);
 assert.ok(!message.includes('detail'));assert.ok(!message.includes('model_not_found'));
 assert.match(conversationError('Unknown model',false),/模型不可用/);
});
test('invalid MCP transport names the configuration failure instead of a generic execution error',()=>{
 assert.match(conversationError('Codex Exec exited with code 1: Error loading config.toml: invalid transport\nin `mcp_servers.node_repl`',false),/Codex 配置加载失败.*MCP.*command 或 url/);
});
test('legacy eval stacks yield the actual error message rather than eval line or source code',()=>{
 const raw=`[eval]:5\nif(!token)throw Error('Agent 尚未准备完成，请稍后重试');\n ^\nError: Agent 尚未准备完成，请稍后重试\n at eval:5:17\nNode.js v22.22.3`;
 assert.equal(conversationError(raw,false),'Agent 尚未准备完成，请稍后重试');
});
