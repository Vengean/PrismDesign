import { isValidElement, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Project, type ProjectConfig, type ProjectRole } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import GitAuthFields from "@/components/GitAuthFields";
import { Code2, Folder, GitBranch, Layers, Plus, Search, Sparkles, X } from "lucide-react";

export const roleLabels: Record<ProjectRole,string> = { viewer: "查看者", editor: "编辑者", admin: "开发者 / 管理员" };
export const initialConfig: ProjectConfig = {
  repos: [], gitAuth: { mode: "token",sshPort: 22 }, model: { provider: "claude", baseUrl: "", model: "" },
  initScript: "", startupScript: "", guidance: "",
};
export const fieldClass = "w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm font-normal transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const required = isValidElement<{ required?: boolean }>(children) && children.props.required;
  return <label className="field-label"><span>{label}{required && <><span aria-hidden="true" className="ml-1 text-destructive">*</span><span className="sr-only">（必填）</span></>}</span>{children}{hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}</label>;
}

export default function Projects() {
  const {isAdmin} = useAuth();
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
  const icons = [Code2,Layers,Folder,GitBranch];
  const tones = [{background:"#edf2e7",color:"#738365"},{background:"#f3eee6",color:"#a28a65"},{background:"#eaf0f2",color:"#718b97"},{background:"#f0edf4",color:"#9380a3"}];
  return <div className="page-container">
    <h1 className="sr-only">项目列表</h1>
    <div className="mb-7 flex items-center gap-3"><label className="search-field min-w-0 flex-1 sm:max-w-sm"><Search size={15} className="shrink-0 text-muted-foreground" /><input aria-label="搜索项目" placeholder="搜索项目" value={query} onChange={e => setQuery(e.target.value)} />{query&&<button type="button" className="search-clear" aria-label="清空搜索" onClick={() => setQuery("")}><X size={14} /></button>}</label>{isAdmin&&<Button asChild size="icon" className="ml-auto size-11 shrink-0 rounded-full"><Link to="/projects/create" aria-label="新建项目" title="新建项目"><Plus size={20} /></Link></Button>}</div>
    {error&&<div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-destructive/15 bg-destructive/5 p-4 text-sm text-destructive">{error}<Button variant="ghost" onClick={() => void loadPage(nextCursor||undefined,projects.length===0)}>重试</Button></div>}
    {projects.length>0&&<div className="project-masonry">{projects.map(p => {
      const index = [...p.id].reduce((a,c) => a+c.charCodeAt(0),0)%tones.length;const Icon=icons[index];
      return <Link key={p.id} to={`/projects/${p.id}`} aria-label={`打开项目 ${p.name}`} className="project-tile"><div className="project-icon mb-6" style={tones[index]}><Icon size={22} strokeWidth={1.5} /></div><h2 className="mb-2 break-words text-[17px] font-semibold tracking-tight">{p.name}</h2><p className="line-clamp-6 whitespace-pre-wrap break-words text-[13px] leading-7 text-muted-foreground">{p.description||"项目已准备好，下一步从一个新需求开始。"}</p><div className="mt-5 flex flex-wrap gap-2"><span className="project-badge"><span className="size-1 rounded-full bg-[#9aa78c]" />{p.access_role==="viewer"?"可查看":"可编辑"}</span>{p.agent_sdk&&<span className="project-badge">{p.agent_sdk==="glm"?"GLM SDK":"Claude SDK"}</span>}</div><div className="mt-6 flex gap-3 border-t border-[#f0f1eb] pt-4 text-[11px] text-[#969b8e]"><span>{p.requirement_count} 个需求</span><span>{p.release_count} 个发布</span></div></Link>;
    })}</div>}
    {loading&&(projects.length===0?<div role="status" aria-label="正在加载项目" className="project-skeleton-grid">{[0,1,2].map(i => <div key={i} className="surface h-56 animate-pulse p-6"><div className="mb-6 size-11 rounded-xl bg-muted" /><div className="mb-3 h-4 w-1/2 rounded bg-muted" /><div className="h-3 w-4/5 rounded bg-muted" /></div>)}</div>:<p role="status" className="py-5 text-center text-xs text-muted-foreground">正在加载更多项目…</p>)}
    {!loading&&!error&&projects.length===0&&<div className="empty-panel"><span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#edf2e7]"><Sparkles size={24} strokeWidth={1.5} className="text-[#8a9a77]" /></span><h2 className="text-lg font-medium">{search?"没有找到相关项目":"你的下一次创造，从这里开始"}</h2><p className="mt-2 max-w-sm text-sm leading-7 text-muted-foreground">{search?"换个关键词，或清空搜索试试。":isAdmin?"创建项目、邀请伙伴，一起把想法推进到下一步。":"加入项目后，就可以在这里查看需求和协作进展。"}</p>{search?<Button className="mt-6" variant="outline" onClick={() => setQuery("")}>清空搜索</Button>:isAdmin&&<Button asChild className="mt-6 rounded-full px-6"><Link to="/projects/create"><Plus size={15} />创建第一个项目</Link></Button>}</div>}
    <div ref={sentinel} className="h-px" aria-hidden="true" />
    {!loading&&!error&&nextCursor&&typeof IntersectionObserver==="undefined"&&<Button className="mx-auto mt-5 flex" variant="outline" onClick={() => void loadPage(nextCursor)}>加载更多</Button>}
  </div>;
}

export function ConfigFields({ value, onChange }: { value: ProjectConfig; onChange: (v: ProjectConfig) => void }) {
  const patch = (v: Partial<ProjectConfig>) => onChange({ ...value,...v });
  const patchAuth = (changes: Partial<ProjectConfig['gitAuth']>) => patch({gitAuth: {...value.gitAuth,...changes}});
  return <div className="settings-form">
    <section id="repositories" className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-medium">代码仓库</h3><Button type="button" variant="outline" size="sm" onClick={() => patch({ repos: [...value.repos,{ name: "",url: "",branch: "main" }] })}>添加仓库</Button></div>
      <p className="text-xs text-muted-foreground">所有仓库共用下方的 Git 认证。创建需求时从各仓库主干分支创建独立需求分支，代码自动放入当前需求工作空间。</p>
      {value.repos.length === 0 && <p className="text-sm text-muted-foreground">可先创建项目，之后补充仓库配置。</p>}
      {value.repos.map((r,i) => <div key={i} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
        <Field label="仓库目录名称" hint="代码在 /workspace 下的目录名，例如 frontend、backend。"><Input required pattern="[a-zA-Z0-9_-]+" value={r.name} onChange={e => patch({ repos: value.repos.map((x,n) => n === i ? { ...x,name: e.target.value } : x) })} /></Field>
        <Field label="基础分支" hint="需求开发的起点，例如 main 或 develop。"><Input required value={r.branch} onChange={e => patch({ repos: value.repos.map((x,n) => n === i ? { ...x,branch: e.target.value } : x) })} /></Field>
        <Field label="仓库地址"><Input required placeholder="https://git.example.com/team/app.git" value={r.url} onChange={e => patch({ repos: value.repos.map((x,n) => n === i ? { ...x,url: e.target.value } : x) })} /></Field>
        <Button className="justify-self-start" type="button" variant="ghost" size="sm" onClick={() => patch({ repos: value.repos.filter((_,n) => n !== i) })}>移除仓库</Button>
      </div>)}</section>
    <section id="git-auth" className="space-y-3"><h3 className="font-medium">Git 认证</h3>
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
    <section id="agent-settings" className="space-y-3"><h3 className="font-medium">Agent 配置</h3><div className="grid gap-3 sm:grid-cols-2">
      <Field label="Agent SDK"><select required className={fieldClass} value={value.model.provider || "claude"} onChange={e => patch({model:{...value.model,provider:e.target.value,hasApiKey:false,apiKey:""}})}><option value="claude">Claude Agent SDK</option><option value="glm">GLM SDK</option></select></Field>
      <Field label="服务地址"><Input required type="url" value={value.model.baseUrl} placeholder="填写所选 SDK 对应的服务地址或企业代理地址" onChange={e => patch({model:{...value.model,baseUrl:e.target.value,hasApiKey:false}})} /></Field>
      <Field label="模型名称"><Input required value={value.model.model} placeholder="填写服务端提供的模型名称" onChange={e => patch({model:{...value.model,model:e.target.value}})} /></Field>
      <Field label="模型凭证"><Input type="password" autoComplete="new-password" required={!value.model.hasApiKey} value={value.model.apiKey || ""} placeholder={value.model.hasApiKey ? "已保存，留空保留原凭证" : "填写本项目的 API Key"} onChange={e => patch({model:{...value.model,apiKey:e.target.value}})} /></Field>
      </div>
    </section>
    <section id="environment" className="space-y-3"><h3 className="font-medium">环境启动</h3>
      <p className="text-sm text-muted-foreground">每个仓库按仓库目录名称放入当前需求的 /workspace 下。脚本在 /workspace 执行，使用 cd 或 --dir 进入对应仓库，无需单独配置工作目录。</p>
      <Field label="初始化脚本（Bash）" hint="首次准备环境时执行，用于安装依赖、代码生成或初始化测试数据；也可手动重跑。"><textarea className={`${fieldClass} min-h-28 font-mono`} placeholder={'pnpm --dir frontend install\npnpm --dir backend install'} value={value.initScript} onChange={e => patch({ initScript: e.target.value })} /></Field>
      <Field label="启动脚本（Bash）" hint="每次启动环境时执行，统一启动前后端；Web 程序应监听 0.0.0.0。多个程序需在后台启动并等待，避免脚本提前退出。"><textarea className={`${fieldClass} min-h-36 font-mono`} placeholder={'pnpm --dir frontend dev --host 0.0.0.0 &\npnpm --dir backend dev &\nwait -n'} value={value.startupScript} onChange={e => patch({ startupScript: e.target.value })} /></Field>
    </section>
    <Field label="项目说明"><textarea placeholder="告诉 Agent 项目架构、编码规范和测试要求。" className={`${fieldClass} min-h-28`} value={value.guidance} onChange={e => patch({ guidance: e.target.value })} /></Field>
  </div>;
}

export function CreateProject() {
  const navigate = useNavigate();
  const { isAdmin, user } = useAuth();
  const [name,setName] = useState(""); const [description,setDescription] = useState("");
  const [config,setConfig] = useState<ProjectConfig>(initialConfig);
  const [members,setMembers] = useState<{ userId: string; role: ProjectRole }[]>([]);
  const [users,setUsers] = useState<{ id: string; role: string }[]>([]);
  const [error,setError] = useState(""); const [saving,setSaving] = useState(false);
  useEffect(() => { if (isAdmin) api.getUsers().then(setUsers).catch(e => setError(e.message)); },[isAdmin]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError("");
    try { const result = await api.createProject({ name,description,config,members }); navigate(`/projects/${result.id}`); }
    catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  if (!isAdmin) return <div className="page-container"><p>仅开发者可以创建项目。</p></div>;
  return <div className="page-container">
    <h1 className="sr-only">新建项目</h1>
    <div className="grid items-start gap-8 lg:grid-cols-[200px_minmax(0,1fr)] xl:gap-14">
      <aside className="project-toc hidden lg:block"><nav aria-label="项目配置章节" className="space-y-2">{[["basics","01","基本信息"],["repositories","02","代码与认证"],["agent-settings","03","Agent 配置"],["environment","04","运行环境"]].map(([anchor,n,label]) => <a key={anchor} href={`#${anchor}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><span className="text-[10px] text-[#adb5a4]">{n}</span>{label}</a>)}</nav><div className="mt-8 rounded-2xl bg-[#eef2e7] p-4"><Sparkles size={18} className="mb-2 text-[#8d9e79]" /><p className="text-xs leading-6 text-[#7d896e]">清晰的项目说明和验收标准，会让 Agent 更好地理解你的想法。</p></div></aside>
      <form onSubmit={submit} className="min-w-0 space-y-6">
        <section id="basics" className="surface space-y-5 p-5 sm:p-7"><div><h2 className="text-base font-semibold">基本信息</h2><p className="mt-1 text-xs text-muted-foreground">让伙伴一眼了解这个项目。</p></div><Field label="项目名称"><Input required maxLength={120} placeholder="给项目起个名字" value={name} onChange={e => setName(e.target.value)} /></Field><Field label="项目描述"><textarea rows={3} className={fieldClass} placeholder="这个项目要解决什么问题？" value={description} onChange={e => setDescription(e.target.value)} /></Field></section>
        <section className="surface space-y-4 p-5 sm:p-7"><div className="flex items-center justify-between"><h2 className="text-base font-semibold">一起协作的伙伴</h2><Button type="button" size="sm" variant="outline" className="rounded-full" disabled={members.length >= users.filter(u => u.id !== user?.id && u.role !== "admin").length} onClick={() => setMembers([...members,{userId:"",role:"viewer"}])}><Plus size={13} />添加成员</Button></div><p className="text-xs leading-6 text-muted-foreground">查看者可浏览预览和结果；编辑者可创建需求和修改代码；管理员可维护配置和发布。</p>
          {members.length===0&&<p className="rounded-xl bg-[#f6f8f1] px-4 py-3 text-xs text-[#8e9781]">可以先创建项目，之后再邀请伙伴。</p>}
          {members.map((m,i) => <div key={i} className="grid items-end gap-3 rounded-xl bg-[#f8f9f5] p-3 sm:grid-cols-[1fr_1fr_auto]"><Field label="用户"><select required className={fieldClass} value={m.userId} onChange={e => setMembers(members.map((x,n) => n===i?{...x,userId:e.target.value}:x))}><option value="">选择用户</option>{users.filter(u => u.id!==user?.id&&u.role!=="admin"&&!members.some((x,n) => n!==i&&x.userId===u.id)).map(u => <option key={u.id}>{u.id}</option>)}</select></Field><Field label="角色"><select className={fieldClass} value={m.role} onChange={e => setMembers(members.map((x,n) => n===i?{...x,role:e.target.value as ProjectRole}:x))}>{Object.entries(roleLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></Field><Button type="button" variant="ghost" size="sm" onClick={() => setMembers(members.filter((_,n) => n!==i))}>移除</Button></div>)}</section>
        <ConfigFields value={config} onChange={setConfig} />
        {error&&<p role="alert" className="rounded-xl bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
        <div className="flex items-center justify-end gap-3 border-t pt-6"><Button type="button" variant="outline" className="min-w-24 rounded-xl" disabled={saving} onClick={() => navigate("/projects")}>取消</Button><Button className="min-w-28 rounded-xl px-6" disabled={saving}>{saving?"正在创建…":"创建项目"}</Button></div>
      </form>
    </div>
  </div>;
}
