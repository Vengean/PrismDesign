import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, Check, ChevronRight, Clock3, Eye, EyeOff, FileText, LoaderCircle, LockKeyhole, LogOut, Mail, Menu, NotebookPen, Pencil, Plus, Search, ShieldCheck, Sparkles, X } from 'lucide-react'
import { Button } from './components/ui/button'
import { Checkbox } from './components/ui/checkbox'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import { api, type Note, type User } from './api'

const SESSION_KEY = 'prism-demo-session'
const formatDate = (value: string) => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value))
const formatUpdatedAt = (value: string) => {
  const date = new Date(value)
  const elapsed = Date.now() - date.getTime()
  if (elapsed < 60_000) return '刚刚'
  if (elapsed < 24 * 60 * 60_000 && date.getDate() === new Date().getDate()) return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}

type FieldErrors = { name?: string; email?: string; password?: string; confirmPassword?: string; form?: string }

function NotesPage({ user, token, onLogout }: { user: User; token: string; onLogout: () => void }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [mobileListOpen, setMobileListOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [isLoadingNotes, setIsLoadingNotes] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [noteError, setNoteError] = useState('')

  useEffect(() => {
    api.notes(token).then(({ notes: loadedNotes }) => {
      setNotes(loadedNotes)
      setSelectedId(loadedNotes[0]?.id ?? null)
    }).catch((error: Error) => setNoteError(error.message)).finally(() => setIsLoadingNotes(false))
  }, [token])

  const filteredNotes = useMemo(() => notes.filter((note) => `${note.title}${note.content}${note.category}`.toLowerCase().includes(query.toLowerCase())), [notes, query])
  const selectedNote = notes.find((note) => note.id === selectedId) ?? notes[0]

  const openCreateNote = () => {
    setEditingId(null)
    setDraftTitle('')
    setDraftContent('')
    setIsCreating(true)
  }

  const openEditNote = (note: Note) => {
    setEditingId(note.id)
    setDraftTitle(note.title)
    setDraftContent(note.content)
    setIsCreating(true)
  }

  const closeNoteEditor = () => {
    setIsCreating(false)
    setEditingId(null)
    setDraftTitle('')
    setDraftContent('')
  }

  const saveNote = async (event: FormEvent) => {
    event.preventDefault()
    if (!draftTitle.trim() || !draftContent.trim()) return
    setIsSaving(true)
    setNoteError('')
    try {
      if (editingId !== null) {
        const { note } = await api.updateNote(token, editingId, { title: draftTitle.trim(), content: draftContent.trim() })
        setNotes((current) => current.map((item) => item.id === editingId ? note : item))
        closeNoteEditor()
        return
      }
      const { note } = await api.createNote(token, { title: draftTitle.trim(), content: draftContent.trim() })
      setNotes((current) => [note, ...current])
      setSelectedId(note.id)
      closeNoteEditor()
      setMobileListOpen(false)
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : '保存失败，请重试。')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f3ef] text-[#24231f]">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[#dedbd2] bg-[#f8f7f3]/95 px-4 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setMobileListOpen((v) => !v)} className="rounded-lg p-2 hover:bg-black/5 md:hidden" aria-label="打开笔记列表"><Menu className="h-5 w-5" /></button>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#20201e] text-white"><Sparkles className="h-4 w-4 text-[#efd49c]" /></span>
          <div><p className="text-sm font-semibold tracking-wide">PRISM</p><p className="text-[10px] text-[#99958c]">我的灵感空间</p></div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block"><p className="text-xs font-medium">{user.name}</p><p className="text-[10px] text-[#99958c]">{user.email}</p></div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#daceb6] text-sm font-semibold text-[#5c4b2f]">林</div>
          <button type="button" onClick={onLogout} className="rounded-lg p-2 text-[#77736b] transition hover:bg-black/5 hover:text-black" aria-label="退出登录"><LogOut className="h-4 w-4" /></button>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-4rem)] w-full">
        <aside className={`${mobileListOpen ? 'fixed inset-x-0 bottom-0 top-16 z-20 flex' : 'hidden'} w-full flex-col border-r border-[#dedbd2] bg-[#f8f7f3] md:flex md:w-[350px] md:shrink-0 xl:w-[380px]`}>
          <div className="border-b border-[#e5e2da] p-5">
            <div className="mb-5 flex items-end justify-between"><div><p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-[#9a7b43]">Workspace</p><h1 className="text-2xl font-semibold tracking-tight">我的笔记</h1></div><span className="text-xs text-[#99958c]">{notes.length} 篇</span></div>
            <Button onClick={openCreateNote} className="mb-4 h-10 w-full rounded-xl bg-[#24231f] shadow-sm"><Plus className="h-4 w-4" />新建笔记</Button>
            <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#aaa69d]" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索笔记..." className="h-10 rounded-xl border-[#ddd9cf] bg-white pl-9 shadow-none" /></div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {filteredNotes.map((note) => (
              <button key={note.id} type="button" onClick={() => { setSelectedId(note.id); setMobileListOpen(false) }} className={`group mb-1 w-full rounded-xl px-4 py-3.5 text-left transition ${selectedId === note.id ? 'bg-white shadow-[0_3px_14px_rgba(42,40,34,0.07)] ring-1 ring-black/5' : 'hover:bg-black/[0.035]'}`}>
                <div className="mb-1.5 flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{note.title}</span><ChevronRight className={`h-4 w-4 shrink-0 ${selectedId === note.id ? 'text-[#9a7b43]' : 'text-transparent group-hover:text-[#aaa69d]'}`} /></div>
                <p className="line-clamp-2 text-xs leading-5 text-[#858178]">{note.content.replaceAll('\n', ' ')}</p>
                <div className="mt-2.5 flex items-center gap-2 text-[10px] text-[#aaa69d]"><span className="rounded-md bg-[#eeeae1] px-1.5 py-0.5 text-[#817255]">{note.category}</span><span>{formatUpdatedAt(note.updatedAt)}</span></div>
              </button>
            ))}
            {isLoadingNotes && <div className="px-4 py-12 text-center text-sm text-[#99958c]">正在读取笔记...</div>}
            {!isLoadingNotes && !filteredNotes.length && <div className="px-4 py-12 text-center text-sm text-[#99958c]">没有找到相关笔记</div>}
          </div>
        </aside>

        <section className="relative flex min-w-0 flex-1 justify-center bg-[#eeece6] px-5 py-8 sm:px-8 sm:py-10 lg:px-10 xl:px-12 2xl:px-16">
          {selectedNote && <article className="animate-login-in w-full max-w-[1080px] rounded-2xl border border-black/[0.055] bg-[#fffefa] px-6 py-8 shadow-[0_18px_60px_rgba(48,44,35,0.08)] sm:px-12 sm:py-11 lg:px-14">
            <div className="mb-9 flex items-center justify-between border-b border-[#ece8de] pb-6"><span className="rounded-full bg-[#f0ebdf] px-3 py-1 text-xs font-medium text-[#80683e]">{selectedNote.category}</span><div className="flex items-center gap-3"><div className="flex items-center gap-1.5 text-xs text-[#a09b91]"><Clock3 className="h-3.5 w-3.5" />更新于 {formatUpdatedAt(selectedNote.updatedAt)}</div><button type="button" onClick={() => openEditNote(selectedNote)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#80683e] transition hover:bg-[#f0ebdf]" aria-label={`编辑笔记：${selectedNote.title}`}><Pencil className="h-3.5 w-3.5" />编辑</button></div></div>
            <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{selectedNote.title}</h2>
            <div className="mt-4 flex items-center gap-2 text-xs text-[#a09b91]"><CalendarDays className="h-3.5 w-3.5" />{formatDate(selectedNote.createdAt)}</div>
            <div className="mt-9 whitespace-pre-wrap text-[15px] leading-8 text-[#4e4b44] sm:text-base">{selectedNote.content}</div>
          </article>}
        </section>
      </div>

      {isCreating && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) closeNoteEditor() }}>
        <form onSubmit={saveNote} className="animate-login-in w-full max-w-2xl rounded-t-3xl bg-[#fffefa] p-6 shadow-2xl sm:rounded-3xl sm:p-8">
          <div className="mb-7 flex items-center justify-between"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#eee8db] text-[#80683e]"><NotebookPen className="h-5 w-5" /></span><div><h2 className="text-xl font-semibold">{editingId !== null ? '编辑笔记' : '新建笔记'}</h2><p className="text-xs text-[#99958c]">{editingId !== null ? '修改标题和内容' : '记录此刻的想法'}</p></div></div><button type="button" onClick={closeNoteEditor} className="rounded-lg p-2 text-[#99958c] hover:bg-black/5" aria-label="关闭"><X className="h-5 w-5" /></button></div>
          <Label htmlFor="note-title">标题</Label><Input id="note-title" autoFocus value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="给这条笔记起个标题" className="mt-2 h-12 rounded-xl bg-white shadow-none" />
          <Label htmlFor="note-content" className="mt-5 block">内容</Label><textarea id="note-content" value={draftContent} onChange={(e) => setDraftContent(e.target.value)} placeholder="开始写下你的想法..." className="mt-2 min-h-52 w-full resize-none rounded-xl border border-input bg-white px-4 py-3 text-sm leading-6 outline-none transition focus:border-[#aaa18e] focus:ring-2 focus:ring-[#d8d0c0]/50" />
          {noteError && <p role="alert" className="mt-4 text-sm text-red-600">{noteError}</p>}
          <div className="mt-6 flex justify-end gap-3"><Button type="button" variant="outline" onClick={closeNoteEditor} className="rounded-xl">取消</Button><Button type="submit" disabled={isSaving || !draftTitle.trim() || !draftContent.trim()} className="rounded-xl px-5">{isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{isSaving ? '正在保存...' : editingId !== null ? '保存修改' : '保存笔记'}</Button></div>
        </form>
      </div>}
    </main>
  )
}

export default function App() {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [isLoading, setIsLoading] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState('')
  const [initialToken] = useState(() => localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || '')
  const [isRestoringSession, setIsRestoringSession] = useState(Boolean(initialToken))

  useEffect(() => {
    if (!initialToken) return
    api.session(initialToken).then(({ user: savedUser }) => {
      setToken(initialToken)
      setUser(savedUser)
    }).catch(() => {
      localStorage.removeItem(SESSION_KEY)
      sessionStorage.removeItem(SESSION_KEY)
    }).finally(() => setIsRestoringSession(false))
  }, [initialToken])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors: FieldErrors = {}
    if (authMode === 'register' && name.trim().length < 2) nextErrors.name = '用户名至少需要 2 个字符'
    if (!email.trim()) nextErrors.email = '请输入邮箱地址'
    else if (!/^\S+@\S+\.\S+$/.test(email)) nextErrors.email = '请输入有效的邮箱地址'
    if (!password) nextErrors.password = '请输入密码'
    else if (authMode === 'register' && password.length < 8) nextErrors.password = '密码至少需要 8 个字符'
    if (authMode === 'register' && password !== confirmPassword) nextErrors.confirmPassword = '两次输入的密码不一致'
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return }
    setIsLoading(true); setErrors({})
    try {
      const result = authMode === 'register'
        ? await api.register({ name: name.trim(), email: email.trim(), password })
        : await api.login(email, password)
      const storage = rememberMe ? localStorage : sessionStorage
      storage.setItem(SESSION_KEY, result.token)
      setToken(result.token)
      setUser(result.user)
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : '登录失败，请重试。' })
    } finally {
      setIsLoading(false)
    }
  }

  const switchAuthMode = () => {
    setAuthMode((mode) => mode === 'login' ? 'register' : 'login')
    setName('')
    setPassword('')
    setConfirmPassword('')
    setShowPassword(false)
    setErrors({})
  }

  const handleLogout = async () => {
    await api.logout(token).catch(() => undefined)
    localStorage.removeItem(SESSION_KEY)
    sessionStorage.removeItem(SESSION_KEY)
    setToken('')
    setUser(null)
  }

  if (isRestoringSession) return <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5]"><LoaderCircle className="h-6 w-6 animate-spin text-[#80683e]" /></main>
  if (user && token) return <NotesPage user={user} token={token} onLogout={handleLogout} />

  return (
    <main className="min-h-screen bg-[#f7f7f5] text-[#191919] lg:grid lg:grid-cols-[minmax(420px,0.92fr)_minmax(560px,1.08fr)]">
      <section className="relative hidden min-h-screen overflow-hidden bg-[#171717] p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div className="absolute inset-0 opacity-70 [background-image:radial-gradient(circle_at_80%_20%,rgba(244,210,132,0.18),transparent_30%),radial-gradient(circle_at_10%_90%,rgba(255,255,255,0.10),transparent_27%)]" /><div className="absolute inset-0 opacity-[0.055] [background-image:linear-gradient(rgba(255,255,255,0.9)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.9)_1px,transparent_1px)] [background-size:48px_48px]" />
        <div className="relative z-10 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 backdrop-blur"><Sparkles className="h-5 w-5 text-[#efd49c]" /></div><span className="text-lg font-semibold tracking-wide">PRISM · 棱镜</span></div>
        <div className="relative z-10 max-w-xl"><div className="mb-8 flex items-center gap-3 text-sm text-white/55"><span className="h-px w-10 bg-[#efd49c]" />为灵感而生的工作空间</div><h2 className="text-5xl font-semibold leading-[1.12] tracking-[-0.04em] xl:text-6xl">让每一个想法，<br />折射出更多可能。</h2><p className="mt-7 max-w-lg text-base leading-8 text-white/55">随时记录、整理与回顾你的灵感，让思考清晰沉淀，让好点子不会错过。</p></div>
        <div className="relative z-10 flex items-center justify-between text-xs text-white/35"><span>© 2026 Prism Studio</span><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> 企业级安全保护</span></div>
      </section>
      <section className="relative flex min-h-screen items-center justify-center px-6 py-10 sm:px-12">
        <div className="absolute left-6 top-6 flex items-center gap-2 lg:hidden"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#171717] text-white"><Sparkles className="h-4 w-4" /></span><span className="font-semibold">PRISM</span></div>
        <div className="w-full max-w-[430px] animate-login-in">
          <div className="mb-9"><p className="mb-3 text-sm font-medium text-[#9a7b43]">{authMode === 'login' ? '欢迎回来' : '加入 PRISM'}</p><h1 className="text-4xl font-semibold tracking-[-0.035em]">{authMode === 'login' ? '登录你的账户' : '创建你的账户'}</h1><p className="mt-3 text-sm text-[#777]">{authMode === 'login' ? '输入账号信息，继续进入你的笔记空间。' : '创建账户，开始记录与整理你的灵感。'}</p></div>
          <form onSubmit={handleSubmit} noValidate><div className="space-y-5">
            {authMode === 'register' && <div className="space-y-2"><Label htmlFor="name">用户名</Label><Input id="name" value={name} onChange={(e) => { setName(e.target.value); setErrors((old) => ({ ...old, name: undefined, form: undefined })) }} placeholder="例如：vengeanliu" autoComplete="name" aria-invalid={Boolean(errors.name)} className="h-12 rounded-xl bg-white shadow-none" />{errors.name && <p className="text-xs text-red-600">{errors.name}</p>}</div>}
            <div className="space-y-2"><Label htmlFor="email">邮箱地址</Label><div className="relative"><Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#999]" /><Input id="email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErrors((old) => ({ ...old, email: undefined, form: undefined })) }} placeholder="name@company.com" autoComplete="email" aria-invalid={Boolean(errors.email)} className="h-12 rounded-xl bg-white pl-10 shadow-none" /></div>{errors.email && <p className="text-xs text-red-600">{errors.email}</p>}</div>
            <div className="space-y-2"><div className="flex items-center justify-between"><Label htmlFor="password">密码</Label>{authMode === 'login' && <button type="button" className="text-xs font-medium text-[#80683e]" onClick={() => setErrors({ form: '演示环境暂不支持找回密码，请使用体验账号登录。' })}>忘记密码？</button>}</div><div className="relative"><LockKeyhole className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#999]" /><Input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => { setPassword(e.target.value); setErrors((old) => ({ ...old, password: undefined, confirmPassword: undefined, form: undefined })) }} placeholder={authMode === 'register' ? '至少 8 个字符' : '请输入密码'} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} className="h-12 rounded-xl bg-white px-10 shadow-none" /><button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? '隐藏密码' : '显示密码'} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#999]">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>{errors.password && <p className="text-xs text-red-600">{errors.password}</p>}</div>
            {authMode === 'register' && <div className="space-y-2"><Label htmlFor="confirm-password">确认密码</Label><div className="relative"><LockKeyhole className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#999]" /><Input id="confirm-password" type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setErrors((old) => ({ ...old, confirmPassword: undefined, form: undefined })) }} placeholder="再次输入密码" autoComplete="new-password" aria-invalid={Boolean(errors.confirmPassword)} className="h-12 rounded-xl bg-white pl-10 shadow-none" /></div>{errors.confirmPassword && <p className="text-xs text-red-600">{errors.confirmPassword}</p>}</div>}
          </div><div className="my-5 flex items-center gap-2.5"><Checkbox id="remember" checked={rememberMe} onCheckedChange={(checked) => setRememberMe(checked === true)} /><Label htmlFor="remember" className="cursor-pointer text-sm font-normal text-[#666]">记住我的登录状态</Label></div>
          {errors.form && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errors.form}</div>}
          <Button type="submit" disabled={isLoading} className="group h-12 w-full rounded-xl text-sm shadow-[0_8px_22px_rgba(0,0,0,0.14)]">{isLoading ? <><LoaderCircle className="h-4 w-4 animate-spin" />{authMode === 'login' ? '正在验证...' : '正在创建...'}</> : <>{authMode === 'login' ? '登录' : '创建账户'}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></>}</Button></form>
          <p className="mt-6 text-center text-sm text-[#777]">{authMode === 'login' ? '还没有账户？' : '已经有账户？'}<button type="button" onClick={switchAuthMode} className="ml-1.5 font-medium text-[#80683e] hover:underline">{authMode === 'login' ? '立即注册' : '返回登录'}</button></p>
          {authMode === 'login' && <div className="mt-7 rounded-xl border border-[#e5dfd2] bg-[#fbf8f1] px-4 py-3 text-xs text-[#756b58]"><div className="mb-1 flex items-center gap-2 font-medium"><FileText className="h-3.5 w-3.5" />体验账号</div><p>demo@prism.cn · Prism2026</p></div>}
        </div>
      </section>
    </main>
  )
}
