import {EventEmitter} from 'node:events';
import {getDb} from './db.js';
export const workspaceEvents=new EventEmitter().setMaxListeners(0);
export function activeWorkspaceRun(requirementId:string):{id:string;status:string;user_id:string}|undefined {
 if(!getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversation_runs'").get())return;
 return getDb().prepare("SELECT id,status,user_id FROM conversation_runs WHERE requirement_id=? AND status IN ('queued','running','cancelling','interrupted')").get(requirementId) as {id:string;status:string;user_id:string}|undefined;
}
export function assertWorkspaceIdle(id:string){const run=activeWorkspaceRun(id);if(run)throw new Error(run.status==='interrupted'?'任务已中断，请先重启需求环境后继续':'Agent 正在处理此需求，请等待任务结束');}

export function assertRuntimeChangeAllowed(id:string){const run=activeWorkspaceRun(id);if(run && run.status!=='interrupted')throw new Error('Agent 正在处理此需求，请先取消任务并等待结束');}
export function releaseInterruptedRun(id:string){if(activeWorkspaceRun(id)?.status==='interrupted')getDb().prepare("UPDATE conversation_runs SET status='failed',error='环境已重启或停止，中断任务已终止；可重新发送消息',updated_at=datetime('now') WHERE requirement_id=? AND status='interrupted'").run(id);}
