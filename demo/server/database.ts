import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(serverDir, 'data')
mkdirSync(dataDir, { recursive: true })

export const db = new Database(process.env.PRISM_DB_PATH || path.join(dataDir, 'prism-demo.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '随笔',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS note_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_note_revisions_note_created ON note_revisions(note_id, created_at DESC);
`)

const demoEmail = 'demo@prism.cn'
let demoUser = db.prepare('SELECT id FROM users WHERE email = ?').get(demoEmail) as { id: number } | undefined

if (!demoUser) {
  const result = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
    .run(demoEmail, bcrypt.hashSync('Prism2026', 12), '林墨')
  demoUser = { id: Number(result.lastInsertRowid) }
}

const noteCount = db.prepare('SELECT COUNT(*) AS count FROM notes WHERE user_id = ?').get(demoUser.id) as { count: number }
if (noteCount.count === 0) {
  const seedNotes = [
    ['Q3 产品灵感清单', '产品思考', '最近在梳理下一季度的产品方向，有几个值得继续探索的想法：\n\n1. 让信息组织更自然，而不是要求用户先建立复杂的分类体系。\n2. 首页应该优先呈现“最近在想什么”，而不是冷冰冰的数据。\n3. 把协作融入内容本身，减少在不同工具之间来回切换。\n\n下一步：和设计团队一起完成低保真原型，并邀请 5 位用户参与快速测试。', '2026-08-07T10:32:00+08:00'],
    ['设计评审会议记录', '会议', '本次评审主要讨论了新版工作台的信息层级。\n\n结论：\n• 保留左侧主导航，减少顶部操作项。\n• 项目卡片突出状态和最后更新时间。\n• 空状态需要给出明确的下一步指引。\n\n待办：周五前更新交互稿，下周一进行第二轮评审。', '2026-08-06T16:45:00+08:00'],
    ['京都旅行准备', '生活', '秋季京都旅行备忘。\n\n想去的地方：哲学之道、南禅寺、京都御苑、宇治。尽量避开热门时段，每天只安排两个主要目的地。\n\n需要提前预订：酒店、岚山小火车、怀石料理。', '2026-08-04T12:00:00+08:00'],
    ['关于慢思考', '阅读', '真正重要的判断，往往需要给自己留出足够的空白。\n\n不是每一个问题都需要立刻得到答案。有时候，把问题准确地写下来，就已经完成了一半。好的笔记不是仓库，而是思考发生的地方。', '2026-08-02T12:00:00+08:00'],
  ]
  const insert = db.prepare('INSERT INTO notes (user_id, title, category, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
  const seed = db.transaction(() => seedNotes.forEach(([title, category, content, date]) => insert.run(demoUser!.id, title, category, content, date, date)))
  seed()
}
