import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'

if (process.env.PRISM_FIXTURE_MODE !== 'true') throw new Error('Fixture MCP is disabled. Set PRISM_FIXTURE_MODE=true only in development or test environments.')

const projectRoot = path.resolve(process.env.PRISM_PROJECT_ROOT || process.cwd())
const databasePath = path.resolve(process.env.PRISM_DB_PATH || path.join(projectRoot, 'server/data/prism-demo.db'))
if (!databasePath.startsWith(`${projectRoot}${path.sep}`)) throw new Error('PRISM_DB_PATH must stay inside PRISM_PROJECT_ROOT')

const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(`
  CREATE TABLE IF NOT EXISTS fixture_records (
    verification_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('user', 'note')),
    entity_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (verification_id, entity_type, entity_id)
  )
`)

const server = new McpServer({ name: 'demo-fixtures', version: '0.1.0' })
const result = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value })
const annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
const verificationId = z.string().min(3).max(100).regex(/^[a-zA-Z0-9_-]+$/)

function recordFixture(runId, type, id) {
  db.prepare('INSERT OR IGNORE INTO fixture_records (verification_id, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?)')
    .run(runId, type, id, new Date().toISOString())
}

function cleanup(runId) {
  const records = db.prepare('SELECT entity_type AS type, entity_id AS id FROM fixture_records WHERE verification_id = ? ORDER BY CASE entity_type WHEN \'note\' THEN 0 ELSE 1 END').all(runId)
  const remove = db.transaction(() => {
    let notes = 0
    let users = 0
    for (const record of records) {
      if (record.type === 'note') notes += db.prepare('DELETE FROM notes WHERE id = ?').run(record.id).changes
      if (record.type === 'user') users += db.prepare('DELETE FROM users WHERE id = ?').run(record.id).changes
    }
    db.prepare('DELETE FROM fixture_records WHERE verification_id = ?').run(runId)
    return { notes, users }
  })
  return remove()
}

server.registerTool('fixtures_create_user', {
  description: 'Create an isolated login user for one browser verification. Explicit emails must end in .test and are never allowed to replace application users.',
  inputSchema: {
    verificationId,
    email: z.string().email().endsWith('.test').optional(),
    password: z.string().min(8).max(100),
    name: z.string().min(1).max(80).default('自动化测试用户'),
  },
  annotations,
}, async ({ verificationId: runId, email, password, name }) => {
  const generatedEmail = email || `${runId.toLowerCase()}-${randomBytes(4).toString('hex')}@prism.test`
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(generatedEmail)
  if (existing) throw new Error('Fixture email already exists; choose a unique .test address')
  const inserted = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run(generatedEmail, bcrypt.hashSync(password, 10), name)
  const userId = Number(inserted.lastInsertRowid)
  recordFixture(runId, 'user', userId)
  return result({ userId, email: generatedEmail, name })
})

server.registerTool('fixtures_create_note', {
  description: 'Create a note owned by a fixture user from the same verification.',
  inputSchema: {
    verificationId,
    userId: z.number().int().positive(),
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(20_000),
    category: z.string().min(1).max(50).default('测试'),
  },
  annotations,
}, async ({ verificationId: runId, userId, title, content, category }) => {
  const owned = db.prepare("SELECT 1 FROM fixture_records WHERE verification_id = ? AND entity_type = 'user' AND entity_id = ?").get(runId, userId)
  if (!owned) throw new Error('userId is not owned by this verification')
  const now = new Date().toISOString()
  const inserted = db.prepare('INSERT INTO notes (user_id, title, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(userId, title, content, category, now, now)
  const noteId = Number(inserted.lastInsertRowid)
  recordFixture(runId, 'note', noteId)
  return result({ noteId, userId, title, category })
})

server.registerTool('fixtures_get_user', {
  description: 'Inspect a fixture user without exposing its password hash.',
  inputSchema: { verificationId, userId: z.number().int().positive() },
  annotations: { ...annotations, readOnlyHint: true },
}, async ({ verificationId: runId, userId }) => {
  const user = db.prepare("SELECT users.id, users.email, users.name FROM users JOIN fixture_records ON fixture_records.entity_id = users.id AND fixture_records.entity_type = 'user' WHERE fixture_records.verification_id = ? AND users.id = ?").get(runId, userId)
  return result({ user: user || null })
})

server.registerTool('fixtures_get_note', {
  description: 'Inspect a note created by this verification for a database assertion.',
  inputSchema: { verificationId, noteId: z.number().int().positive() },
  annotations: { ...annotations, readOnlyHint: true },
}, async ({ verificationId: runId, noteId }) => {
  const note = db.prepare("SELECT notes.id, notes.user_id AS userId, notes.title, notes.content, notes.category, notes.updated_at AS updatedAt FROM notes JOIN fixture_records ON fixture_records.entity_id = notes.id AND fixture_records.entity_type = 'note' WHERE fixture_records.verification_id = ? AND notes.id = ?").get(runId, noteId)
  return result({ note: note || null })
})

server.registerTool('fixtures_cleanup_run', {
  description: 'Delete only users and notes created by one verification. Call this in cleanup even when browser verification fails.',
  inputSchema: { verificationId },
  annotations: { ...annotations, destructiveHint: true },
}, async ({ verificationId: runId }) => result({ verificationId: runId, deleted: cleanup(runId) }))

const shutdown = async () => { db.close(); await server.close(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
await server.connect(new StdioServerTransport())
