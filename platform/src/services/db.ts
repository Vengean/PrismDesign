import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "node:fs";

const DATA_DIR = process.env.PRISM_DATA_DIR || "./data";
const DB_PATH = path.join(DATA_DIR, "platform.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DATA_DIR,{recursive:true});
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("secure_delete = ON");
    initTables();
    ensureAdmin();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

  `);
  db.exec(`CREATE TABLE IF NOT EXISTS legacy_resource_cleanup (
    workspace_id TEXT PRIMARY KEY, container_id TEXT, last_error TEXT
  )`);
  const legacy = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspaces'").get();
  if (legacy) {
    const columns = db.pragma("table_info(workspaces)") as {name:string}[];
    const container = columns.some(c => c.name === "container_id") ? "container_id" : "NULL";
    db.transaction(() => {
      db.exec(`INSERT OR IGNORE INTO legacy_resource_cleanup(workspace_id,container_id) SELECT id,${container} FROM workspaces`);
      db.exec("DROP TABLE IF EXISTS workspace_shares; DROP TABLE workspaces;");
    })();
    // Remove retired rows and plaintext legacy credentials from free pages and WAL.
    db.exec("VACUUM");
    db.pragma("wal_checkpoint(TRUNCATE)");
  }
}

function ensureAdmin() {
  const adminId = process.env.ADMIN_USER || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(adminId);
  if (!existing) {
    const hash = bcrypt.hashSync(adminPassword, 10);
    db.prepare("INSERT INTO users (id, password_hash, role) VALUES (?, ?, 'admin')").run(
      adminId,
      hash
    );
    console.log(`Admin user "${adminId}" created.`);
  }
}

// ─── User helpers ───

export function findUserById(id: string) {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | { id: string; password_hash: string; role: string; created_at: string }
    | undefined;
}

export function listUsers() {
  return getDb()
    .prepare("SELECT id, role, created_at FROM users ORDER BY created_at DESC")
    .all() as { id: string; role: string; created_at: string }[];
}

export function createUser(id: string, passwordHash: string) {
  getDb().prepare("INSERT INTO users (id, password_hash) VALUES (?, ?)").run(id, passwordHash);
}

export function deleteUser(id: string) {
  getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
}

export function updatePassword(id: string, passwordHash: string) {
  getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
}
