import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db.js";
import type { AgentRuntimeConfig } from "./agent-runtime.js";

export type ProjectRole = "viewer" | "editor" | "admin";
export interface GitAuthConfig {
  mode: "none" | "token" | "ssh";
  sshPort: number;
  token?: string;
  sshKey?: string;
  hasToken?: boolean;
  hasSshKey?: boolean;
  credentialRef?: string;
  requiresUpdate?: boolean;
}
export interface ProjectConfig {
  repos: { name: string; url: string; branch: string }[];
  gitAuth: GitAuthConfig;
  model: { provider: string; baseUrl: string; model: string; credentialRef?: string; apiKey?: string; hasApiKey?: boolean };
  initScript: string;
  startupScript: string;
  guidance: string;
}
export const emptyConfig: ProjectConfig = {
  repos: [], gitAuth: { mode: "token", sshPort: 22 }, model: { provider: "", baseUrl: "", model: "" },
  initScript: "", startupScript: "", guidance: "",
};

export function initProjectTables() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('viewer','editor','admin')),
      PRIMARY KEY(project_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS project_configs (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      config TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_git_credentials (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      encrypted_value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS project_model_credentials (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      encrypted_value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL, description TEXT NOT NULL, acceptance TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'developing', environment_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS project_sessions (
      id TEXT PRIMARY KEY, requirement_id TEXT NOT NULL UNIQUE REFERENCES requirements(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS releases (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'integrating', environment_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_releases_project ON releases(project_id,created_at);
  `);
  // Retain only the current project settings; detach existing requirements/releases first.
  if (getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_config_versions'").get()) {
    getDb().transaction(() => {
      getDb().exec(`INSERT OR IGNORE INTO project_configs(project_id,config)
        SELECT v.project_id,v.config FROM project_config_versions v
        WHERE v.version=(SELECT max(version) FROM project_config_versions WHERE project_id=v.project_id)`);
      for (const table of ['requirements','releases']) {
        const columns=getDb().pragma(`table_info(${table})`) as {name:string}[];
        if(columns.some(c=>c.name==='config_version_id'))getDb().exec(`ALTER TABLE ${table} DROP COLUMN config_version_id`);
      }
      getDb().exec('DROP TABLE project_config_versions');
      for(const [table,field] of [['project_git_credentials','gitAuth'],['project_model_credentials','model']]) {
        getDb().exec(`DELETE FROM ${table} WHERE NOT EXISTS (SELECT 1 FROM project_configs c WHERE c.project_id=${table}.project_id AND json_extract(c.config,'$.${field}.credentialRef')=${table}.id)`);
      }
    })();
  }
}

export function projectRole(projectId: string, userId: string): ProjectRole | undefined {
  return (getDb().prepare(`SELECT CASE WHEN u.role='admin' OR p.created_by=u.id THEN 'admin' ELSE m.role END AS role
    FROM projects p JOIN users u ON u.id=?
    LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=u.id WHERE p.id=?`)
    .get(userId, projectId) as { role: ProjectRole | null } | undefined)?.role ?? undefined;
}

export function defaultProjectAccess(projectId: string, userId: string): boolean {
  return !!getDb().prepare(`SELECT 1 FROM projects p JOIN users u ON u.id=?
    WHERE p.id=? AND (p.created_by=u.id OR u.role='admin')`).get(userId, projectId);
}

export function projectMembers(projectId: string) {
  return getDb().prepare(`SELECT u.id AS user_id,
    CASE WHEN u.role='admin' OR p.created_by=u.id THEN 'admin' ELSE m.role END AS role,
    CASE WHEN p.created_by=u.id THEN 'creator' WHEN u.role='admin' THEN 'platform_admin' ELSE 'explicit' END AS permission_source
    FROM projects p CROSS JOIN users u
    LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=u.id
    WHERE p.id=? AND (u.role='admin' OR p.created_by=u.id OR m.user_id IS NOT NULL)
    ORDER BY CASE WHEN p.created_by=u.id THEN 0 WHEN u.role='admin' THEN 1 ELSE 2 END,u.id`)
    .all(projectId);
}

export function projectConfig(projectId: string): ProjectConfig {
  const row = getDb().prepare("SELECT config FROM project_configs WHERE project_id=?").get(projectId) as {config:string}|undefined;
  if(!row)throw new Error('项目配置不存在');
  return normalizeProjectConfig(JSON.parse(row.config));
}

/** Normalize older project configuration fields. */
export function normalizeProjectConfig(raw: Omit<Partial<ProjectConfig>, "repos"> & {
  repos?: { name: string; url: string; branch: string; gitAuth?: GitAuthConfig; credentialRef?: string }[];
  installCommand?: string;
  previewPort?: number;
  additionalPorts?: number[];
  services?: { directory: string; command: string; port: number }[];
}): ProjectConfig {
  const legacyServices = raw.services || [];
  const quote = (s: string) => "'" + s.replace(/'/g,"'\\''") + "'";
  const commands = legacyServices.map(s => {
    const directory = path.posix.resolve("/workspace",s.directory || ".");
    return `(cd ${quote(directory)} && ${s.command})`;
  });
  const migratedStartup = [raw.startupScript || "",...(commands.length > 1
    ? [...commands.map(command => `${command} &`),"wait -n"] : commands)].filter(Boolean).join("\n");
  const privateRepos = (raw.repos || []).filter(r => r.gitAuth && r.gitAuth.mode !== "none");
  const first = privateRepos[0];
  const different = privateRepos.some(r => r.credentialRef !== first?.credentialRef || r.gitAuth?.mode !== first?.gitAuth?.mode || r.gitAuth?.sshPort !== first?.gitAuth?.sshPort);
  const inheritedAuth: GitAuthConfig = first ? (different
    ? { mode: first.gitAuth!.mode, sshPort: first.gitAuth!.sshPort, requiresUpdate: true }
    : { ...first.gitAuth!, credentialRef: first.credentialRef }) : { mode: "none",sshPort: 22 };
  const {supplierId: _legacySupplier, ...model} = (raw.model || emptyConfig.model) as ProjectConfig["model"] & {supplierId?:string};
  const provider = model.provider === "zhipu" ? "glm" : model.provider === "anthropic" ? "claude" : model.provider;
  return {
    repos: (raw.repos || []).map(({name,url,branch}) => ({name,url,branch})),
    gitAuth: (raw.gitAuth || inheritedAuth).mode === "none"
      ? {mode:"token",sshPort:22,...((raw.repos || []).length ? {requiresUpdate:true} : {})}
      : raw.gitAuth || inheritedAuth,
    model: { ...model,provider },
    initScript: raw.initScript ?? raw.installCommand ?? "",
    startupScript: raw.services ? migratedStartup : raw.startupScript || "",
    guidance: raw.guidance || "",
  };
}

function credentialKey(): Buffer {
  // Keep the encryption key outside SQLite; preserve it alongside persistent platform data.
  const keyPath = path.join(process.env.PRISM_DATA_DIR || "./data", "credentials.key");
  try { fs.writeFileSync(keyPath, crypto.randomBytes(32), { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const key = fs.readFileSync(keyPath);
  if (key.length !== 32) throw new Error("平台凭证加密密钥无效");
  return key;
}

/** Call inside the project configuration transaction. */
export function storeProjectConfig(projectId: string, config: ProjectConfig, previous?: ProjectConfig): ProjectConfig {
  const { apiKey, credentialRef: _requestedRef, hasApiKey: _hasApiKey, ...model } = config.model;
  const sameSupplier = model.provider === previous?.model.provider && model.baseUrl === previous?.model.baseUrl;
  let modelRef = sameSupplier ? previous?.model.credentialRef : undefined;
  if (apiKey) {
    modelRef = previous?.model.credentialRef || crypto.randomUUID();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm",credentialKey(),iv);
    cipher.setAAD(Buffer.from(`${projectId}:model:${modelRef}`));
    const encrypted = Buffer.concat([cipher.update(apiKey,"utf8"),cipher.final()]);
    getDb().prepare("INSERT INTO project_model_credentials(id,project_id,encrypted_value) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_value=excluded.encrypted_value")
      .run(modelRef,projectId,Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString("base64"));
  }
  const savedModelKey = modelRef && getDb().prepare("SELECT 1 FROM project_model_credentials WHERE id=? AND project_id=?").get(modelRef,projectId);
  if (model.provider && !savedModelKey) throw new Error("请填写项目模型凭证");
  config = {...config,model:{...model,...(modelRef ? {credentialRef:modelRef,hasApiKey:!!savedModelKey} : {})}};
  const auth = config.gitAuth;
  if (auth.mode === "none") throw new Error("请选择 Token 或 SSH 认证");
  const secret = auth.mode === "token" ? auth.token : auth.sshKey;
  if (!secret && config.repos.length === 0 && !previous?.gitAuth.credentialRef) {
    return {...config,gitAuth:{mode:auth.mode,sshPort:auth.sshPort}};
  }
  let ref: string;
  if (secret) {
    ref = previous?.gitAuth.credentialRef || crypto.randomUUID();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm",credentialKey(),iv);
    cipher.setAAD(Buffer.from(`${projectId}:${ref}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ mode: auth.mode, secret }),"utf8"),cipher.final()]);
    const encrypted = Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString("base64");
    getDb().prepare("INSERT INTO project_git_credentials(id,project_id,encrypted_value) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_value=excluded.encrypted_value").run(ref,projectId,encrypted);
  } else {
    if (previous?.gitAuth.mode !== auth.mode || !previous.gitAuth.credentialRef || previous.gitAuth.requiresUpdate) throw new Error("请填写项目 Git Token 或 SSH 私钥");
    ref = previous.gitAuth.credentialRef;
  }
  return { ...config, gitAuth: {
    mode: auth.mode,sshPort: auth.sshPort,credentialRef: ref,
    hasToken: auth.mode === "token",hasSshKey: auth.mode === "ssh",
  } };
}

export function resolveProjectModelCredential(projectId: string, ref: string): string {
  const row = getDb().prepare("SELECT encrypted_value FROM project_model_credentials WHERE id=? AND project_id=?")
    .get(ref,projectId) as {encrypted_value:string} | undefined;
  if (!row) throw new Error("模型凭证不存在");
  const value = Buffer.from(row.encrypted_value,"base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm",credentialKey(),value.subarray(0,12));
  decipher.setAAD(Buffer.from(`${projectId}:model:${ref}`));
  decipher.setAuthTag(value.subarray(12,28));
  return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString("utf8");
}

/** Resolve the current SDK and credentials at environment startup. */
export function resolveProjectAgentRuntime(projectId: string): AgentRuntimeConfig {
  const config = projectConfig(projectId);
  const provider = config.model.provider || "claude";
  if (provider !== "claude" && provider !== "glm") throw new Error("不支持的 Agent SDK");
  if (!config.model.credentialRef) throw new Error("请先配置 Agent SDK 凭证");
  return { provider,apiKey:resolveProjectModelCredential(projectId,config.model.credentialRef),
    baseUrl:config.model.baseUrl,model:config.model.model };
}

/** Internal runtime use only; never expose decrypted credentials in HTTP responses. */
export function resolveProjectGitCredential(projectId: string, ref: string) {
  const row = getDb().prepare("SELECT encrypted_value FROM project_git_credentials WHERE id=? AND project_id=?")
    .get(ref,projectId) as { encrypted_value: string } | undefined;
  if (!row) throw new Error("仓库凭证不存在");
  const value = Buffer.from(row.encrypted_value,"base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm",credentialKey(),value.subarray(0,12));
  decipher.setAAD(Buffer.from(`${projectId}:${ref}`));
  decipher.setAuthTag(value.subarray(12,28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString("utf8")) as {
    mode: "token" | "ssh"; secret: string;
  };
}

export function createProject(name: string, description: string, creator: string,
  members: { userId: string; role: ProjectRole }[], config: ProjectConfig) {
  const db = getDb();
  return db.transaction(() => {
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO projects(id,name,description,created_by) VALUES(?,?,?,?)").run(id,name,description,creator);
    const insert = db.prepare("INSERT INTO project_members(project_id,user_id,role) VALUES(?,?,?)");
    insert.run(id,creator,"admin");
    for (const member of members) if (!defaultProjectAccess(id,member.userId)) insert.run(id,member.userId,member.role);
    db.prepare("INSERT INTO project_configs(project_id,config) VALUES(?,?)")
      .run(id,JSON.stringify(storeProjectConfig(id,config)));
    return id;
  })();
}
