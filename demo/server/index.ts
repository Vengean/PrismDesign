import express, { type NextFunction, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { db } from './database.js'

type AuthRequest = Request & { user?: { id: number; email: string; name: string }; token?: string }

const app = express()
const port = Number(process.env.PRISM_API_PORT || 3001)
app.use(express.json({ limit: '1mb' }))

const cleanExpiredSessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
const findSession = db.prepare(`
  SELECT users.id, users.email, users.name
  FROM sessions JOIN users ON users.id = sessions.user_id
  WHERE sessions.token = ? AND sessions.expires_at > ?
`)

function createSession(user: { id: number; email: string; name: string }) {
  cleanExpiredSessions.run(new Date().toISOString())
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expiresAt)
  return { token, user: { id: user.id, email: user.email, name: user.name } }
}

function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.header('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const user = token ? findSession.get(token, new Date().toISOString()) as AuthRequest['user'] : undefined
  if (!user) return res.status(401).json({ message: '登录状态已失效，请重新登录。' })
  req.user = user
  req.token = token
  next()
}

app.get('/api/health', (_req, res) => res.json({ ok: true, database: 'sqlite' }))

app.post('/api/auth/register', (req, res) => {
  const name = String(req.body?.name || '').trim()
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')

  if (name.length < 2 || name.length > 40) return res.status(400).json({ message: '用户名需为 2 至 40 个字符。' })
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return res.status(400).json({ message: '请输入有效的邮箱地址。' })
  if (password.length < 8 || password.length > 128) return res.status(400).json({ message: '密码需为 8 至 128 个字符。' })
  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existingUser) return res.status(409).json({ message: '该邮箱已注册，请直接登录。' })

  const result = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
    .run(email, bcrypt.hashSync(password, 12), name)
  res.status(201).json(createSession({ id: Number(result.lastInsertRowid), email, name }))
})

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const user = db.prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?').get(email) as { id: number; email: string; name: string; password_hash: string } | undefined
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ message: '邮箱或密码不正确，请使用页面中的体验账号。' })

  res.json(createSession(user))
})

app.get('/api/auth/session', requireAuth, (req: AuthRequest, res) => res.json({ user: req.user }))
app.post('/api/auth/logout', requireAuth, (req: AuthRequest, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token)
  res.status(204).end()
})

app.get('/api/notes', requireAuth, (req: AuthRequest, res) => {
  const query = String(req.query.q || '').trim()
  const notes = query
    ? db.prepare(`SELECT id, title, content, category, created_at AS createdAt, updated_at AS updatedAt FROM notes WHERE user_id = ? AND (title LIKE ? OR content LIKE ? OR category LIKE ?) ORDER BY updated_at DESC`).all(req.user!.id, `%${query}%`, `%${query}%`, `%${query}%`)
    : db.prepare('SELECT id, title, content, category, created_at AS createdAt, updated_at AS updatedAt FROM notes WHERE user_id = ? ORDER BY updated_at DESC').all(req.user!.id)
  res.json({ notes })
})

app.post('/api/notes', requireAuth, (req: AuthRequest, res) => {
  const title = String(req.body?.title || '').trim()
  const content = String(req.body?.content || '').trim()
  const category = String(req.body?.category || '随笔').trim() || '随笔'
  if (!title || !content) return res.status(400).json({ message: '标题和内容不能为空。' })
  const now = new Date().toISOString()
  const result = db.prepare('INSERT INTO notes (user_id, title, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(req.user!.id, title, content, category, now, now)
  const note = db.prepare('SELECT id, title, content, category, created_at AS createdAt, updated_at AS updatedAt FROM notes WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, req.user!.id)
  res.status(201).json({ note })
})

app.put('/api/notes/:id', requireAuth, (req: AuthRequest, res) => {
  const id = Number(req.params.id)
  const title = String(req.body?.title || '').trim()
  const content = String(req.body?.content || '').trim()
  if (!Number.isInteger(id) || !title || !content) return res.status(400).json({ message: '笔记参数无效。' })
  const result = db.prepare('UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(title, content, new Date().toISOString(), id, req.user!.id)
  if (!result.changes) return res.status(404).json({ message: '笔记不存在。' })
  const note = db.prepare('SELECT id, title, content, category, created_at AS createdAt, updated_at AS updatedAt FROM notes WHERE id = ? AND user_id = ?').get(id, req.user!.id)
  res.json({ note })
})

app.use((_req, res) => res.status(404).json({ message: '接口不存在。' }))
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  void _next
  console.error(error)
  res.status(500).json({ message: '服务器暂时不可用，请稍后重试。' })
})

app.listen(port, '0.0.0.0', () => console.log(`[Prism Demo API] http://127.0.0.1:${port}`))
