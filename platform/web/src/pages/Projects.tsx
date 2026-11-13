import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Project, type ProjectConfig, type ProjectRole } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {FormField} from '@/components/ui/form-field';
import GitAuthFields from "@/components/GitAuthFields";
import { Folder, Plus, Search, Sparkles, X } from "lucide-react";

export const roleLabels: Record<ProjectRole,string> = { viewer: "查看者", editor: "开发者", admin: "项目管理员" };
export const initialConfig: ProjectConfig = {
  repos: [], gitAuth: { mode: "token",sshPort: 22 }, model: { provider: "claude", baseUrl: "", model: "" },
  initScript: "", startupScript: "", guidance: "",
};
export const fieldClass = "w-full rounded-md border bg-white px-3 py-2 text-xs font-normal transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
export const Field=FormField;

export default function Projects() {
  const {user} = useAuth();
  const [projects,setProjects] = useState<Project[]>([]);
  const [query,setQuery] = useState("");
  const [search,setSearch] = useState("");
  const [nextCursor,setNextCursor] = useState<string|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const sentinel = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController|null>(null);
  const requestId = useRef(0);
  const fetching = useRef(false);
  useEffect(() => {const timer = setTimeout(() => setSearch(query.trim()),300);return () => clearTimeout(timer);},[query]);
  const loadPage = useCallback(async (cursor?:string,reset=false) => {
    if(fetching.current&&!reset)return;
    controller.current?.abort();
    const abort = new AbortController();controller.current = abort;
    const current = ++requestId.current;
    fetching.current=true;setLoading(true);setError("");
    if(reset){setProjects([]);setNextCursor(null);}
    try {
      const page = await api.getProjects({q:search,cursor,limit:12},abort.signal);
      if(abort.signal.aborted||current!==requestId.current)return;
      setProjects(items => reset ? page.items : [...items,...page.items.filter(p => !items.some(item => item.id===p.id))]);
      setNextCursor(page.nextCursor);
    }catch(e){if(!abort.signal.aborted&&current===requestId.current)setError((e as Error).message);}
    finally{if(current===requestId.current){fetching.current=false;setLoading(false);}}
  },[search]);
  useEffect(() => {
    void loadPage(undefined,true);
    return () => {controller.current?.abort();requestId.current+=1;fetching.current=false;};
  },[loadPage]);
  useEffect(() => {
    if(!nextCursor||loading||error||!sentinel.current||typeof IntersectionObserver==="undefined")return;
    const observer = new IntersectionObserver(entries => {if(entries.some(entry => entry.isIntersecting))void loadPage(nextCursor);},{rootMargin:"350px"});
    observer.observe(sentinel.current);return () => observer.disconnect();
  },[nextCursor,loading,error,loadPage]);
  return <div className="page-container">
    <div className="page-title-row"><div><h1 className="page-heading">项目</h1><p className="page-caption">管理需求、代码集成与团队协作。</p></div>{user&&<Button asChild><Link to="/projects/create" aria-label="新建项目"><Plus size={14}/>新建项目</Link></Button>}</div>
    <div className="mb-5 flex items-center gap-3"><label className="search-field min-w-0 w-full sm:max-w-xs"><Search size={14} className="shrink-0 text-muted-foreground"/><input aria-label="搜索项目" placeholder="搜索项目…" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button type="button" className="search-clear" aria-label="清空搜索" onClick={()=>setQuery('')}><X size={13}/></button>}</label><span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">{projects.length} 个项目{nextCursor?' +':''}</span></div>
    {error&&<div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-destructive/15 bg-destructive/5 p-4 text-sm text-destructive">{error}<Button variant="ghost" onClick={() => void loadPage(nextCursor||undefined,projects.length===0)}>重试</Button></div>}
    {projects.length>0&&<div className="project-masonry">{projects.map(p=><Link key={p.id} to={`/projects/${p.id}`} aria-label={`打开项目 ${p.name}`} className="project-tile"><div className="mb-3 flex items-center justify-between gap-3"><div className="project-icon"><Folder size={16}/></div><span className="project-badge">{p.access_role==='viewer'?'可查看':'可编辑'}</span></div><h2 className="truncate text-sm font-semibold" title={p.name}>{p.name}</h2><p className="mt-1.5 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-[21px] text-muted-foreground">{p.description||'暂无项目描述'}</p><div className="mt-auto flex items-center gap-4 border-t pt-3 text-[11px] text-muted-foreground"><span>{p.requirement_count} 个需求</span><span>{p.release_count} 个发布</span>{p.agent_sdk&&<span className="ml-auto">{p.agent_sdk==='glm'?'GLM':'Claude'}</span>}</div></Link>)}</div>}
    {loading&&(projects.length===0?<div role="status" aria-label="正在加载项目" className="project-skeleton-grid">{[0,1,2].map(i => <div key={i} className="surface h-[216px] animate-pulse p-6"><div className="mb-6 size-11 rounded-xl bg-muted" /><div className="mb-3 h-4 w-1/2 rounded bg-muted" /><div className="h-3 w-4/5 rounded bg-muted" /></div>)}</div>:<p role="status" className="py-5 text-center text-xs text-muted-foreground">正在加载更多项目…</p>)}
    {!loading&&!error&&projects.length===0&&<div className="empty-panel"><span className="mb-4 flex size-14 items-center justify-center rounded-lg bg-[#f1f1f6]"><Sparkles size={24} strokeWidth={1.5} className="text-[#8d8fa3]" /></span><h2 className="text-lg font-medium">{search?"没有找到相关项目":"暂无项目"}</h2><p className="mt-2 max-w-sm text-sm leading-7 text-muted-foreground">{search?"换个关键词，或清空搜索试试。":user?"创建项目、邀请伙伴，一起把想法推进到下一步。":"加入项目后，就可以在这里查看需求和协作进展。"}</p>{search?<Button className="mt-6" variant="outline" onClick={() => setQuery("")}>清空搜索</Button>:user&&<Button asChild className="mt-6 rounded-md px-6"><Link to="/projects/create"><Plus size={15} />创建第一个项目</Link></Button>}</div>}
    <div ref={sentinel} className="h-px" aria-hidden="true" />
    {!loading&&!error&&nextCursor&&typeof IntersectionObserver==="undefined"&&<Button className="mx-auto mt-5 flex" variant="outline" onClick={() => void loadPage(nextCursor)}>加载更多</Button>}
  </div>;
}

export function ConfigFields({ value, onChange }: { value: ProjectConfig; onChange: (v: ProjectConfig) => void }) {
  const patch = (v: Partial<ProjectConfig>) => onChange({ ...value,...v });
  const patchAuth = (changes: Partial<ProjectConfig['gitAuth']>) => patch({gitAuth: {...value.gitAuth,...changes}});
  return <div className="settings-form">
    <section id="repositories" className="form-section"><div className="form-section-header"><div className="flex items-center justify-between"><h3 className="font-medium">代码仓库</h3><Button type="button" variant="outline" size="sm" onClick={() => patch({ repos: [...value.repos,{ name: "",url: "",branch: "main" }] })}>添加仓库</Button></div>
      <p className="text-xs text-muted-foreground">所有仓库共用下方的 Git 认证。创建发布时选择代码基线，需求基于所属发布的最新代码创建独立分支。</p></div>
      {value.repos.length === 0 && <p className="text-sm text-muted-foreground">可先创建项目，之后补充仓库配置。</p>}
      {value.repos.map((r,i) => <div key={i} className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
        <Field label="仓库目录名称" hint="代码在 /workspace 下的目录名，例如 frontend、backend。"><Input required pattern="[a-zA-Z0-9_-]+" value={r.name} onChange={e => patch({ repos: value.repos.map((x,n) => n === i ? { ...x,name: e.target.value } : x) })} /></Field>
        <Field label="基础分支" hint="创建发布时默认选择的来源分支，例如 main 或 develop。"><Input required value={r.branch} onChange={e => patch({ repos: value.repos.map((x,n) => n === i ? { ...x,branch: e.target.value } : x) })} /></Field>
        <Field label="仓库地址"><Input required placeholder="https://git.example.com/team/app.git" value={r.url} onChange={e => patch({ repos: value.repos.map((x,n) => n === i ? { ...x,url: e.target.value } : x) })} /></Field>
        <Button className="justify-self-start self-end" type="button" variant="ghost" size="sm" onClick={() => patch({ repos: value.repos.filter((_,n) => n !== i) })}>移除仓库</Button>
      </div>)}</section>
    <section id="git-auth" className="form-section"><h3 className="font-medium">Git 认证</h3>
      {value.gitAuth.requiresUpdate && <p role="alert" className="text-sm text-destructive">原仓库使用了不同的认证配置，请填写一份可访问所有仓库的认证信息。</p>}
      <GitAuthFields
        authMode={value.gitAuth.mode} onAuthModeChange={mode => patchAuth({mode,token:"",sshKey:""})}
        gitAccessToken={value.gitAuth.token || ""} onGitAccessTokenChange={token => patchAuth({token})}
        gitSshKey={value.gitAuth.sshKey || ""} onGitSshKeyChange={sshKey => patchAuth({sshKey})}
        gitSshPort={value.gitAuth.sshPort} onGitSshPortChange={sshPort => patchAuth({sshPort})}
        hasSavedToken={value.gitAuth.hasToken} hasSavedSshKey={value.gitAuth.hasSshKey}
        requireCredentials
      />
    </section>
    <section id="agent-settings" className="form-section"><h3 className="font-medium">Agent 配置</h3><div className="grid gap-4 sm:grid-cols-2">
      <Field label="Agent SDK"><select required className={fieldClass} value={value.model.provider || "claude"} onChange={e => patch({model:{...value.model,provider:e.target.value,hasApiKey:false,apiKey:""}})}><option value="claude">Claude Agent SDK</option><option value="glm">GLM SDK</option></select></Field>
      <Field label="服务地址"><Input required type="url" value={value.model.baseUrl} placeholder="填写所选 SDK 对应的服务地址或企业代理地址" onChange={e => patch({model:{...value.model,baseUrl:e.target.value,hasApiKey:false}})} /></Field>
      <Field label="模型名称"><Input required value={value.model.model} placeholder="填写服务端提供的模型名称" onChange={e => patch({model:{...value.model,model:e.target.value}})} /></Field>
      <Field label="模型凭证"><Input type="password" autoComplete="new-password" required={!value.model.hasApiKey} value={value.model.apiKey || ""} placeholder={value.model.hasApiKey ? "已保存，留空保留原凭证" : "填写本项目的 API Key"} onChange={e => patch({model:{...value.model,apiKey:e.target.value}})} /></Field>
      </div>
    </section>
    <section id="environment" className="form-section"><div className="form-section-header"><h3 className="font-medium">环境启动</h3>
      <p className="text-sm text-muted-foreground">每个仓库按仓库目录名称放入当前需求的 /workspace 下。脚本在 /workspace 执行，使用 cd 或 --dir 进入对应仓库，无需单独配置工作目录。</p></div>
      <Field label="初始化脚本（Bash）" hint="首次准备环境时执行，用于安装依赖、代码生成或初始化测试数据；也可手动重跑。"><textarea className={`${fieldClass} min-h-28 font-mono`} placeholder={'pnpm --dir frontend install\npnpm --dir backend install'} value={value.initScript} onChange={e => patch({ initScript: e.target.value })} /></Field>
      <Field label="启动脚本（Bash）" hint="每次启动环境时执行，统一启动前后端；Web 程序应监听 0.0.0.0。多个程序需在后台启动并等待，避免脚本提前退出。"><textarea className={`${fieldClass} min-h-36 font-mono`} placeholder={'pnpm --dir frontend dev --host 0.0.0.0 &\npnpm --dir backend dev &\nwait -n'} value={value.startupScript} onChange={e => patch({ startupScript: e.target.value })} /></Field>
    </section>
    <Field label="项目说明" hint="工作区没有 CLAUDE.md 时用于创建该文件；已有文件会保留，不随重启覆盖。"><textarea placeholder="告诉 Agent 项目架构、编码规范和测试要求。" className={`${fieldClass} min-h-28`} value={value.guidance} onChange={e => patch({ guidance: e.target.value })} /></Field>
  </div>;
}

export function CreateProject() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [name,setName] = useState(""); const [description,setDescription] = useState("");
  const [config,setConfig] = useState<ProjectConfig>(initialConfig);
  const [members,setMembers] = useState<{ userId: string; role: ProjectRole }[]>([]);
  const [users,setUsers] = useState<{ id: string }[]>([]);
  const [error,setError] = useState(""); const [saving,setSaving] = useState(false);
  useEffect(() => { api.getProjectMemberCandidates().then(setUsers).catch(e => setError(e.message)); },[]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError("");
    try { const result = await api.createProject({ name,description,config,members }); navigate(`/projects/${result.id}`); }
    catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  if (!user) return null;
  return <div className="page-container">
    <div className="page-title-row"><div><h1 className="page-heading">新建项目</h1><p className="page-caption">配置代码、环境与协作成员。</p></div></div>
    <div className="grid items-start gap-8 lg:grid-cols-[200px_minmax(0,1fr)] xl:gap-14">
      <aside className="project-toc hidden lg:block"><nav aria-label="项目配置章节" className="space-y-2">{[["basics","01","基本信息"],["repositories","02","代码与认证"],["agent-settings","03","Agent 配置"],["environment","04","运行环境"]].map(([anchor,n,label]) => <a key={anchor} href={`#${anchor}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><span className="text-[10px] text-[#a0a1ad]">{n}</span>{label}</a>)}</nav><div className="mt-8 rounded-lg bg-[#f4f4f8] p-4"><Sparkles size={18} className="mb-2 text-[#8d8fa3]" /><p className="text-xs leading-6 text-[#878895]">在项目中配置代码仓库、Agent 和运行环境。</p></div></aside>
      <form onSubmit={submit} className="min-w-0 space-y-6">
        <section id="basics" className="surface form-section p-5 sm:p-7"><div className="form-section-header"><h2 className="text-base font-semibold">基本信息</h2><p className="mt-1 text-xs text-muted-foreground">让伙伴一眼了解这个项目。</p></div><Field label="项目名称"><Input required maxLength={120} placeholder="给项目起个名字" value={name} onChange={e => setName(e.target.value)} /></Field><Field label="项目描述"><textarea rows={3} className={fieldClass} placeholder="这个项目要解决什么问题？" value={description} onChange={e => setDescription(e.target.value)} /></Field></section>
        <section className="surface form-section p-5 sm:p-7"><div className="form-section-header"><div className="flex items-center justify-between"><h2 className="text-base font-semibold">项目成员</h2><Button type="button" size="sm" variant="outline" className="rounded-md" disabled={members.length >= users.filter(u => u.id !== user?.id).length} onClick={() => setMembers([...members,{userId:"",role:"viewer"}])}><Plus size={13} />添加成员</Button></div><p className="text-xs leading-6 text-muted-foreground">查看者可浏览预览和结果；开发者可创建发布、需求和修改代码；项目管理员可维护配置和管理成员。</p></div>
          {members.length===0&&<p className="rounded-xl bg-[#f6f6f9] px-4 py-3 text-xs text-[#91929f]">可以先创建项目，之后再邀请伙伴。</p>}
          {members.map((m,i) => <div key={i} className="grid items-end gap-3 rounded-xl bg-[#f8f8fa] p-3 sm:grid-cols-[1fr_1fr_auto]"><Field label="用户"><select required className={fieldClass} value={m.userId} onChange={e => setMembers(members.map((x,n) => n===i?{...x,userId:e.target.value}:x))}><option value="">选择用户</option>{users.filter(u => u.id!==user?.id&&!members.some((x,n) => n!==i&&x.userId===u.id)).map(u => <option key={u.id}>{u.id}</option>)}</select></Field><Field label="角色"><select className={fieldClass} value={m.role} onChange={e => setMembers(members.map((x,n) => n===i?{...x,role:e.target.value as ProjectRole}:x))}>{Object.entries(roleLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></Field><Button type="button" variant="ghost" size="sm" onClick={() => setMembers(members.filter((_,n) => n!==i))}>移除</Button></div>)}</section>
        <ConfigFields value={config} onChange={setConfig} />
        {error&&<p role="alert" className="rounded-xl bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
        <div className="flex items-center justify-end gap-3 border-t pt-6"><Button type="button" variant="outline" className="min-w-24 rounded-xl" disabled={saving} onClick={() => navigate("/projects")}>取消</Button><Button className="min-w-28 rounded-xl px-6" disabled={saving}>{saving?"正在创建…":"创建项目"}</Button></div>
      </form>
    </div>
  </div>;
}
