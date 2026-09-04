import { memo, type FormEvent, useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, Check, ChevronRight, Clock3, Eye, EyeOff, History, LoaderCircle, LockKeyhole, LogOut, Mail, Menu, NotebookPen, Pencil, Plus, Search, ShieldCheck, Sparkles, X } from 'lucide-react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from './components/ui/button'
import { Checkbox } from './components/ui/checkbox'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { api, type Note, type NoteRevision, type User } from './api'

const SESSION_KEY = 'prism-demo-session'
const markdownPlugins = [remarkGfm]
const previewComponents: Components = {
  a: ({ children }) => <span className="text-[#80683e] underline decoration-[#b9aa8d] underline-offset-2">{children}</span>,
  img: ({ alt }) => <span>{alt || '图片'}</span>,
}
const formatDate = (value: string) => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value))
const getNameInitials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase() || '?'
const formatUpdatedAt = (value: string) => {
  const date = new Date(value)
  const elapsed = Date.now() - date.getTime()
  if (elapsed < 60_000) return '刚刚'
  if (elapsed < 24 * 60 * 60_000 && date.getDate() === new Date().getDate()) return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}

type DiffLine = { kind: 'same' | 'add' | 'remove'; value: string }
function buildLineDiff(before: string, after: string): DiffLine[] {
  const left = before.split('\n'); const right = after.split('\n')
  const table = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0))
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  const result: DiffLine[] = []; let i = 0; let j = 0
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) { result.push({ kind: 'same', value: left[i++] }); j++ }
    else if (j < right.length && (i === left.length || table[i][j + 1] >= table[i + 1][j])) result.push({ kind: 'add', value: right[j++] })
    else result.push({ kind: 'remove', value: left[i++] })
  }
  return result
}

function DiffView({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => buildLineDiff(before, after), [before, after])
  return <div className="overflow-x-auto rounded-xl border border-[#e5e2da] bg-white font-mono text-xs leading-6" aria-label="内容差异">
    {lines.map((line, index) => <div key={`${index}-${line.kind}`} className={`grid min-w-[520px] grid-cols-[40px_28px_1fr] px-3 ${line.kind === 'add' ? 'bg-emerald-50 text-emerald-900' : line.kind === 'remove' ? 'bg-red-50 text-red-900' : 'text-[#77736b]'}`}><span className="select-none text-right text-[#aaa69d]">{index + 1}</span><span className="select-none text-center" aria-label={line.kind === 'add' ? '新增' : line.kind === 'remove' ? '删除' : '未变化'}>{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span><span className="whitespace-pre-wrap break-words">{line.value || ' '}</span></div>)}
  </div>
}

type FieldErrors = { name?: string; email?: string; password?: string; confirmPassword?: string; form?: string }

function MarkdownContent({ children, className = '' }: { children: string; className?: string }) {
  return <div className={`markdown-content ${className}`}><Markdown remarkPlugins={markdownPlugins}>{children}</Markdown></div>
}

const MarkdownPreview = memo(function MarkdownPreview({ children }: { children: string }) {
  return <div className="markdown-preview line-clamp-2 text-xs leading-5 text-[#858178]"><Markdown remarkPlugins={markdownPlugins} components={previewComponents}>{children}</Markdown></div>
})

function NotesPage({ user, token, onLogout }: { user: User; token: string; onLogout: () => void }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [mobileListOpen, setMobileListOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [editorMode, setEditorMode] = useState<'edit' | 'preview'>('edit')
  const [isLoadingNotes, setIsLoadingNotes] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [noteError, setNoteError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<NoteRevision[]>([])
  const [selectedRevisionId, setSelectedRevisionId] = useState<number | string | null>(null)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)

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
    setEditorMode('edit')
    setIsCreating(true)
  }

  const openEditNote = (note: Note) => {
    setEditingId(note.id)
    setDraftTitle(note.title)
    setDraftContent(note.content)
    setEditorMode('edit')
    setIsCreating(true)
  }

  const closeNoteEditor = () => {
    setIsCreating(false)
    setEditingId(null)
    setDraftTitle('')
    setDraftContent('')
  }

  const openHistory = async (note: Note) => {
    setHistoryOpen(true); setIsLoadingHistory(true); setHistory([]); setSelectedRevisionId(null); setNoteError('')
    try {
      const result = await api.noteHistory(token, note.id)
      setHistory(result.revisions)
      setSelectedRevisionId(result.revisions.find((revision) => !revision.isCurrent)?.id ?? null)
    } catch (error) { setNoteError(error instanceof Error ? error.message : '读取历史失败，请重试。') }
    finally { setIsLoadingHistory(false) }
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
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#daceb6] text-sm font-semibold text-[#5c4b2f]" aria-label={`${user.name} 的头像`}>{getNameInitials(user.name)}</div>
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
              <button key={note.id} type="button" onClick={() => { setSelectedId(note.id); setMobileListOpen(false) }} className={`group mb-1 w-full rounded-xl px-4 py-3.5 text-left transition-[background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9a7b43]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f8f7f3] motion-reduce:transform-none ${selectedId === note.id ? 'bg-white shadow-[0_3px_14px_rgba(42,40,34,0.07)] ring-1 ring-black/5 hover:bg-black/[0.018] active:bg-black/[0.045]' : 'hover:bg-black/[0.035] active:bg-black/[0.065]'}`}>
                <div className="mb-1.5 flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{note.title}</span><ChevronRight className={`h-4 w-4 shrink-0 ${selectedId === note.id ? 'text-[#9a7b43]' : 'text-transparent group-hover:text-[#aaa69d]'}`} /></div>
                <MarkdownPreview>{note.content}</MarkdownPreview>
                <div className="mt-2.5 flex items-center gap-2 text-[10px] text-[#aaa69d]"><span className="rounded-md bg-[#eeeae1] px-1.5 py-0.5 text-[#817255]">{note.category}</span><span>{formatUpdatedAt(note.updatedAt)}</span></div>
              </button>
            ))}
            {isLoadingNotes && <div className="px-4 py-12 text-center text-sm text-[#99958c]">正在读取笔记...</div>}
            {!isLoadingNotes && !filteredNotes.length && <div className="px-4 py-12 text-center text-sm text-[#99958c]">没有找到相关笔记</div>}
          </div>
        </aside>

        <section className="relative flex min-w-0 flex-1 justify-center bg-[#eeece6] px-5 py-8 sm:px-8 sm:py-10 lg:px-10 xl:px-12 2xl:px-16">
          {selectedNote && <article className="animate-login-in w-full max-w-[1080px] rounded-2xl border border-black/[0.055] bg-[#fffefa] px-6 py-8 shadow-[0_18px_60px_rgba(48,44,35,0.08)] sm:px-12 sm:py-11 lg:px-14">
            <div className="mb-9 flex flex-wrap items-center justify-between gap-3 border-b border-[#ece8de] pb-6"><span className="rounded-full bg-[#f0ebdf] px-3 py-1 text-xs font-medium text-[#80683e]">{selectedNote.category}</span><div className="flex flex-wrap items-center justify-end gap-2"><div className="flex items-center gap-1.5 text-xs text-[#a09b91]"><Clock3 className="h-3.5 w-3.5" />更新于 {formatUpdatedAt(selectedNote.updatedAt)}</div><button type="button" onClick={() => openHistory(selectedNote)} className="flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-[#80683e] transition hover:bg-[#f0ebdf]" aria-label={`查看修改历史：${selectedNote.title}`}><History className="h-3.5 w-3.5" />历史</button><button type="button" onClick={() => openEditNote(selectedNote)} className="flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-[#80683e] transition hover:bg-[#f0ebdf]" aria-label={`编辑笔记：${selectedNote.title}`}><Pencil className="h-3.5 w-3.5" />编辑</button></div></div>
            <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{selectedNote.title}</h2>
            <div className="mt-4 flex items-center gap-2 text-xs text-[#a09b91]"><CalendarDays className="h-3.5 w-3.5" />{formatDate(selectedNote.createdAt)}</div>
            <MarkdownContent className="mt-9 text-[15px] text-[#4e4b44] sm:text-base">{selectedNote.content}</MarkdownContent>
          </article>}
        </section>
      </div>

      {isCreating && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) closeNoteEditor() }}>
        <form onSubmit={saveNote} className="animate-login-in flex h-[calc(100dvh-16px)] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-[#fffefa] p-6 shadow-2xl sm:h-[min(760px,calc(100dvh-48px))] sm:rounded-3xl sm:p-8">
          <div className="mb-6 flex shrink-0 items-center justify-between"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#eee8db] text-[#80683e]"><NotebookPen className="h-5 w-5" /></span><div><h2 className="text-xl font-semibold">{editingId !== null ? '编辑笔记' : '新建笔记'}</h2><p className="text-xs text-[#99958c]">{editingId !== null ? '修改标题和内容' : '记录此刻的想法'}</p></div></div><button type="button" onClick={closeNoteEditor} className="rounded-lg p-2 text-[#99958c] hover:bg-black/5" aria-label="关闭"><X className="h-5 w-5" /></button></div>
          <Label htmlFor="note-title">标题</Label><Input id="note-title" autoFocus value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="给这条笔记起个标题" className="mt-2 h-12 rounded-xl bg-white shadow-none" />
          <Tabs value={editorMode} onValueChange={(value) => setEditorMode(value as 'edit' | 'preview')} className="mt-5 flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3">
              <Label htmlFor="note-content">内容</Label>
              <TabsList className="h-10 rounded-xl bg-[#f0ede6] p-1" aria-label="正文显示模式">
                <TabsTrigger value="edit" className="h-8 rounded-lg px-4 text-xs text-[#77736b] data-[state=active]:bg-[#fffefa] data-[state=active]:text-[#24231f] data-[state=active]:shadow-sm">编辑</TabsTrigger>
                <TabsTrigger value="preview" className="h-8 rounded-lg px-4 text-xs text-[#77736b] data-[state=active]:bg-[#fffefa] data-[state=active]:text-[#24231f] data-[state=active]:shadow-sm">预览</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="edit" className="mt-2 min-h-0 flex-1 flex-col data-[state=active]:flex">
              <textarea id="note-content" value={draftContent} onChange={(e) => setDraftContent(e.target.value)} placeholder="使用 Markdown 开始写下你的想法..." className="min-h-0 w-full flex-1 resize-none rounded-xl border border-input bg-white px-4 py-3 font-mono text-sm leading-6 outline-none transition focus:border-[#aaa18e] focus:ring-2 focus:ring-[#d8d0c0]/50" />
              <p className="mt-2 text-xs text-[#99958c]">支持标题、列表、链接、引用、代码块和表格等 Markdown 语法。</p>
            </TabsContent>
            <TabsContent value="preview" className="mt-2 min-h-0 flex-1 flex-col data-[state=active]:flex">
              <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[#e5e2da] bg-white px-5 py-4">
                {draftContent.trim() ? <MarkdownContent className="text-sm text-[#4e4b44]">{draftContent}</MarkdownContent> : <p className="py-20 text-center text-sm text-[#99958c]">输入内容后，可在这里查看 Markdown 效果。</p>}
              </div>
            </TabsContent>
          </Tabs>
          {noteError && <p role="alert" className="mt-4 text-sm text-red-600">{noteError}</p>}
          <div className="mt-5 flex shrink-0 justify-end gap-3"><Button type="button" variant="outline" onClick={closeNoteEditor} className="rounded-xl">取消</Button><Button type="submit" disabled={isSaving || !draftTitle.trim() || !draftContent.trim()} className="rounded-xl px-5">{isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{isSaving ? '正在保存...' : editingId !== null ? '保存修改' : '保存笔记'}</Button></div>
        </form>
      </div>}
      {historyOpen && selectedNote && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryOpen(false) }}>
        <section role="dialog" aria-modal="true" aria-labelledby="history-title" className="flex h-[calc(100dvh-16px)] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-[#fffefa] shadow-2xl sm:h-[min(760px,calc(100dvh-48px))] sm:rounded-3xl">
          <header className="flex items-center justify-between border-b border-[#e5e2da] px-6 py-5 sm:px-8"><div><p className="text-xs font-medium uppercase tracking-[0.18em] text-[#9a7b43]">Version history</p><h2 id="history-title" className="mt-1 text-xl font-semibold">修改历史</h2></div><button type="button" onClick={() => setHistoryOpen(false)} className="rounded-lg p-2 text-[#77736b] hover:bg-black/5" aria-label="关闭修改历史"><X className="h-5 w-5" /></button></header>
          {isLoadingHistory ? <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[#77736b]"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取历史...</div> : noteError ? <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-red-600" role="alert">{noteError}</div> : history.length <= 1 ? <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[#77736b]">这篇笔记还没有修改记录。保存一次修改后即可在这里对比。</div> : <div className="grid min-h-0 flex-1 md:grid-cols-[240px_1fr]">
            <aside className="border-b border-[#e5e2da] bg-[#f8f7f3] p-3 md:overflow-y-auto md:border-b-0 md:border-r"><p className="px-3 py-2 text-xs text-[#99958c]">选择要与当前版本对比的记录</p>{history.map((revision, index) => <button key={revision.id} type="button" disabled={revision.isCurrent} onClick={() => setSelectedRevisionId(revision.id)} className={`mb-1 w-full rounded-xl px-3 py-3 text-left ${revision.isCurrent ? 'cursor-default text-[#99958c]' : selectedRevisionId === revision.id ? 'bg-white shadow-sm ring-1 ring-black/5' : 'hover:bg-black/[0.035]'}`}><span className="block text-xs font-medium">{revision.isCurrent ? '当前版本' : `历史版本 ${history.length - index}`}</span><span className="mt-1 block text-[10px] text-[#99958c]">{new Date(revision.createdAt).toLocaleString('zh-CN', { hour12: false })}</span></button>)}</aside>
            <div className="min-h-0 overflow-y-auto p-5 sm:p-8">{(() => { const revision = history.find((item) => item.id === selectedRevisionId); if (!revision) return null; return <><div className="mb-6"><p className="mb-2 text-xs font-medium text-[#77736b]">标题差异</p><DiffView before={revision.title} after={selectedNote.title} /></div><div><p className="mb-2 text-xs font-medium text-[#77736b]">正文差异</p><DiffView before={revision.content} after={selectedNote.content} /></div></> })()}</div>
          </div>}
        </section>
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
    <main className="min-h-screen bg-[#f7f7f5] text-[#191919] lg:grid lg:grid-cols-[minmax(380px,0.8fr)_minmax(560px,1.2fr)]">
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
        </div>
      </section>
    </main>
  )
}
