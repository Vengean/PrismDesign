import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import path from "path";
import type { Workspace, WorkspaceRow } from "../types.js";

const DATA_DIR = process.env.PRISM_DATA_DIR || "./data";
const DB_PATH = path.join(DATA_DIR, "platform.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
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

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      repos TEXT NOT NULL DEFAULT '[]',
      claude_md TEXT NOT NULL DEFAULT '',
      startup_script TEXT NOT NULL DEFAULT '',
      git_access_token TEXT NOT NULL DEFAULT '',
      git_ssh_key TEXT NOT NULL DEFAULT '',
      git_ssh_port INTEGER NOT NULL DEFAULT 22,
      agent_type TEXT NOT NULL DEFAULT 'claude',
      anthropic_api_key TEXT NOT NULL DEFAULT '',
      anthropic_base_url TEXT NOT NULL DEFAULT '',
      anthropic_model TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'stopped',
      sync_status TEXT NOT NULL DEFAULT 'none',
      dev_port INTEGER,
      agent_port INTEGER,
      container_id TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrations for existing databases
  migrate();
}

function migrate() {
  const columns = db.pragma("table_info(workspaces)") as { name: string }[];
  const colNames = columns.map((c) => c.name);

  if (colNames.length > 0 && !colNames.includes("git_ssh_key")) {
    db.exec(`ALTER TABLE workspaces ADD COLUMN git_ssh_key TEXT NOT NULL DEFAULT ''`);
  }
  if (colNames.length > 0 && !colNames.includes("git_ssh_port")) {
    db.exec(`ALTER TABLE workspaces ADD COLUMN git_ssh_port INTEGER NOT NULL DEFAULT 22`);
  }
  if (colNames.length > 0 && !colNames.includes("agent_type")) {
    db.exec(`ALTER TABLE workspaces ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'claude'`);
  }
  for (const col of ["anthropic_api_key", "anthropic_base_url", "anthropic_model"]) {
    if (colNames.length > 0 && !colNames.includes(col)) {
      db.exec(`ALTER TABLE workspaces ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
    }
  }
  if (colNames.length > 0 && !colNames.includes("code_server_port")) {
    db.exec(`ALTER TABLE workspaces ADD COLUMN code_server_port INTEGER`);
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

// ─── Workspace helpers ───

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    ...row,
    repos: JSON.parse(row.repos),
    dev_port: row.dev_port ?? undefined,
    agent_port: row.agent_port ?? undefined,
    code_server_port: row.code_server_port ?? undefined,
    container_id: row.container_id ?? undefined,
    error_message: row.error_message ?? undefined,
  } as Workspace;
}

export function listWorkspaces(ownerId?: string, isAdmin = false): Workspace[] {
  const rows = isAdmin
    ? getDb().prepare("SELECT * FROM workspaces ORDER BY updated_at DESC").all()
    : getDb()
        .prepare("SELECT * FROM workspaces WHERE owner_id = ? ORDER BY updated_at DESC")
        .all(ownerId!);
  return (rows as WorkspaceRow[]).map(rowToWorkspace);
}

export function findWorkspaceById(id: string): Workspace | undefined {
  const row = getDb().prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as
    | WorkspaceRow
    | undefined;
  return row ? rowToWorkspace(row) : undefined;
}

export function createWorkspace(data: {
  name: string;
  ownerId: string;
  repos: string;
  claudeMd: string;
  startupScript: string;
  gitAccessToken: string;
  gitSshKey: string;
  gitSshPort: number;
  agentType: string;
  anthropicApiKey: string;
  anthropicBaseUrl: string;
  anthropicModel: string;
}): string {
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO workspaces (id, name, owner_id, repos, claude_md, startup_script, git_access_token, git_ssh_key, git_ssh_port, agent_type, anthropic_api_key, anthropic_base_url, anthropic_model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, data.name, data.ownerId, data.repos, data.claudeMd, data.startupScript, data.gitAccessToken, data.gitSshKey, data.gitSshPort, data.agentType, data.anthropicApiKey, data.anthropicBaseUrl, data.anthropicModel);
  return id;
}

export function updateWorkspace(
  id: string,
  fields: Partial<
    Pick<
      Workspace,
      | "name"
      | "repos"
      | "claude_md"
      | "startup_script"
      | "git_access_token"
      | "git_ssh_key"
      | "git_ssh_port"
      | "agent_type"
      | "anthropic_api_key"
      | "anthropic_base_url"
      | "anthropic_model"
      | "status"
      | "sync_status"
      | "dev_port"
      | "agent_port"
      | "code_server_port"
      | "container_id"
      | "error_message"
    >
  >
) {
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const dbKey = key === "repos" ? "repos" : key;
    sets.push(`${dbKey} = ?`);
    values.push(key === "repos" ? JSON.stringify(value) : value);
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  values.push(id);

  getDb()
    .prepare(`UPDATE workspaces SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values);
}

export function deleteWorkspace(id: string) {
  getDb().prepare("DELETE FROM workspaces WHERE id = ?").run(id);
}
