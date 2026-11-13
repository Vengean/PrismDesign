import {PlatformDatabase,mysqlConfig} from "./database.js";
import {initializeMysqlSchema} from "./mysql-schema.js";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "node:fs";

const DATA_DIR = process.env.PRISM_DATA_DIR || "./data";
const DB_PATH = path.join(DATA_DIR, "platform.db");

let db: PlatformDatabase;

export function getDb(): PlatformDatabase {
  if (!db) {
    if(!['dev','sit'].includes(process.env.PRISM_MODE||'dev'))throw Error('PRISM_MODE 只支持 dev 或 sit');
    fs.mkdirSync(DATA_DIR,{recursive:true});
    db = new PlatformDatabase({...(process.env.PRISM_MODE==='sit'?{mysql:mysqlConfig()}:{sqlite:DB_PATH}),initialize:async()=>{
      if(db.dialect==='mysql'){await initializeMysqlSchema(db);}else await initTables();
      await ensureAdmin();
    }});
  }
  return db;
}

async function initTables() {
  (await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

  `));
  (await db.exec(`CREATE TABLE IF NOT EXISTS legacy_resource_cleanup (
    workspace_id TEXT PRIMARY KEY, container_id TEXT, last_error TEXT
  )`));
  const legacy = (await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspaces'").get());
  if (legacy) {
    const columns = (await db.pragma("table_info(workspaces)")) as {name:string}[];
    const container = columns.some(c => c.name === "container_id") ? "container_id" : "NULL";
    (await db.transaction(async () => {
      (await db.exec(`INSERT OR IGNORE INTO legacy_resource_cleanup(workspace_id,container_id) SELECT id,${container} FROM workspaces`));
      (await db.exec("DROP TABLE IF EXISTS workspace_shares; DROP TABLE workspaces;"));
    })());
    // Remove retired rows and plaintext legacy credentials from free pages and WAL.
    (await db.exec("VACUUM"));
    (await db.pragma("wal_checkpoint(TRUNCATE)"));
  }
}

async function ensureAdmin() {
  const adminId = process.env.ADMIN_USER || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

  const existing = (await db.prepare("SELECT id FROM users WHERE id = ?").get(adminId));
  if (!existing) {
    if(process.env.PRISM_MODE==='sit'&&!process.env.ADMIN_PASSWORD)throw Error('请在 .env.sit.local 配置 SIT 管理员初始密码 ADMIN_PASSWORD');
    const hash = bcrypt.hashSync(adminPassword, 10);
    (await db.prepare("INSERT INTO users (id, password_hash, role) VALUES (?, ?, 'admin')").run(
      adminId,
      hash
    ));
    console.log(`Admin user "${adminId}" created.`);
  }
}

// ─── User helpers ───

export async function findUserById(id: string) {
  return (await getDb().prepare("SELECT * FROM users WHERE id = ?").get(id)) as
    | { id: string; password_hash: string; role: string; created_at: string }
    | undefined;
}

export async function listUsers() {
  return (await getDb()
    .prepare("SELECT id, role, created_at FROM users ORDER BY created_at DESC")
    .all()) as { id: string; role: string; created_at: string }[];
}

export async function createUser(id: string, passwordHash: string) {
  (await getDb().prepare("INSERT INTO users (id, password_hash) VALUES (?, ?)").run(id, passwordHash));
}

export async function deleteUser(id: string) {
  (await getDb().prepare("DELETE FROM users WHERE id = ?").run(id));
}

export async function updatePassword(id: string, passwordHash: string) {
  (await getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id));
}
