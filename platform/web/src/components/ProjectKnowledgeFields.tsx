import {useState} from 'react';
import type {ProjectConfig} from '@/lib/api';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
type Knowledge=NonNullable<ProjectConfig['knowledge']>;
const empty:Knowledge={documents:[],skills:[],mcpServers:{}};
export default function ProjectKnowledgeFields({value,onChange}:{value?:Knowledge;onChange:(value:Knowledge)=>void}){
 const k=value||empty;const [mcp,setMcp]=useState(()=>JSON.stringify(k.mcpServers,null,2));
 return <section className="form-section space-y-4"><h3 className="font-medium">项目共享配置（.global）</h3><p className="text-xs text-muted-foreground">同一项目的需求容器通过 .global 只读共享说明、文档、Skill 和 MCP。仓库自己的配置保留并优先；Agent 可在需求工作区自主配置本地能力。下次启动需求环境时同步。</p>
  <div className="space-y-3"><div className="flex items-center justify-between"><span className="text-sm">共享文档</span><Button type="button" variant="outline" size="sm" onClick={()=>onChange({...k,documents:[...k.documents,{path:'',content:''}]})}>添加文档</Button></div>
   {k.documents.map((doc,i)=><div key={i} className="space-y-2 rounded border p-3"><Input aria-label={`文档路径 ${i+1}`} required pattern="([a-zA-Z0-9_-]+/)*[a-zA-Z0-9_-]+\.md" placeholder="architecture.md" value={doc.path} onChange={e=>onChange({...k,documents:k.documents.map((d,n)=>n===i?{...d,path:e.target.value}:d)})}/><textarea aria-label={`文档内容 ${i+1}`} className="min-h-28 w-full rounded border p-2 text-sm" maxLength={60000} value={doc.content} onChange={e=>onChange({...k,documents:k.documents.map((d,n)=>n===i?{...d,content:e.target.value}:d)})}/><Button type="button" size="sm" variant="ghost" onClick={()=>onChange({...k,documents:k.documents.filter((_,n)=>n!==i)})}>移除文档</Button></div>)}
  </div>
  <div className="space-y-3"><div className="flex items-center justify-between"><span className="text-sm">共享 Skill</span><Button type="button" variant="outline" size="sm" onClick={()=>onChange({...k,skills:[...k.skills,{name:'',content:''}]})}>添加 Skill</Button></div>
   {k.skills.map((skill,i)=><div key={i} className="space-y-2 rounded border p-3"><Input aria-label={`Skill 名称 ${i+1}`} required pattern="[a-zA-Z0-9_-]+" placeholder="data-analysis" value={skill.name} onChange={e=>onChange({...k,skills:k.skills.map((s,n)=>n===i?{...s,name:e.target.value}:s)})}/><textarea aria-label={`SKILL.md 内容 ${i+1}`} className="min-h-28 w-full rounded border p-2 text-sm" maxLength={60000} placeholder="填写 SKILL.md，包含用途、步骤和约束" value={skill.content} onChange={e=>onChange({...k,skills:k.skills.map((s,n)=>n===i?{...s,content:e.target.value}:s)})}/><Button type="button" size="sm" variant="ghost" onClick={()=>onChange({...k,skills:k.skills.filter((_,n)=>n!==i)})}>移除 Skill</Button></div>)}
  </div>
  <label className="block space-y-2 text-sm"><span>共享 MCP 服务（JSON）</span><textarea aria-label="共享 MCP 服务" className="min-h-28 w-full rounded border p-2 font-mono text-xs" value={mcp} placeholder={'{"service":{"type":"http","url":"https://example.com/mcp"}}'} onChange={e=>{setMcp(e.target.value);try{const servers=JSON.parse(e.target.value);if(!servers||Array.isArray(servers)||typeof servers!=='object')throw Error();e.target.setCustomValidity('');onChange({...k,mcpServers:servers});}catch{e.target.setCustomValidity('请输入有效的 MCP 配置 JSON 对象');}}}/><span className="block text-xs text-muted-foreground">支持 stdio 的 command、args、env，以及 HTTP 的 type、url、headers。服务使用 project_ 前缀，与仓库 MCP 分开。</span></label>
 </section>;
}
