import { Router, type Router as RouterType, type Response } from "express";
import crypto from "node:crypto";
import { authenticate } from "../middleware/auth.js";
import { getDb, findUserById } from "../services/db.js";
import { createProject, defaultProjectAccess, emptyConfig, projectConfig, projectMembers, projectRole, storeProjectConfig, type ProjectConfig, type ProjectRole } from "../services/projects.js";
import type { AuthRequest } from "../types.js";

const router: RouterType = Router();
router.use(authenticate);
const roles = ["viewer", "editor", "admin"];
function text(value: unknown, max = 20000): value is string {
  return typeof value === "string" && value.length <= max;
}
function validConfig(value: unknown): value is ProjectConfig {
  if (!value || typeof value !== "object") return false;
  const c = value as ProjectConfig;
  // Git credential inputs are extracted before storing project settings.
  const allowed = ["repos","gitAuth","model","initScript","startupScript","guidance"];
  if (Object.keys(c).some(k => !allowed.includes(k))) return false;
  if (!Array.isArray(c.repos) || c.repos.length > 30) return false;
  const a = c.gitAuth;
  if (!a || !["token","ssh"].includes(a.mode) || !Number.isInteger(a.sshPort) || a.sshPort < 1 || a.sshPort > 65535 ||
    Object.keys(a).some(k => !["mode","sshPort","token","sshKey","hasToken","hasSshKey","credentialRef","requiresUpdate"].includes(k)) ||
    (a.token !== undefined && !text(a.token,10000)) || (a.sshKey !== undefined && !text(a.sshKey,30000)) ||
    (a.credentialRef !== undefined && !text(a.credentialRef,200))) return false;
  const names = new Set<string>();
  for (const r of c.repos) {
    if (!r || !text(r.name,80) || !/^[a-zA-Z0-9_-]+$/.test(r.name) || names.has(r.name) ||
      !text(r.url,2000) || !r.url.trim() || !text(r.branch,200) || !r.branch.trim() ||
      Object.keys(r).some(k => !["name","url","branch"].includes(k))) return false;
    if (/^[a-z]+:\/\//i.test(r.url)) {
      try { const u = new URL(r.url); if (u.username || u.password || u.search || u.hash) return false; } catch { return false; }
    }
    if (a.mode === "token" && !/^https:\/\//i.test(r.url)) return false;
    if (a.mode === "ssh" && !/^(ssh:\/\/|[^\s@/]+@[^\s:/]+:)/i.test(r.url)) return false;
    names.add(r.name);
  }
  if (!c.model || Object.keys(c.model).some(k => !["provider","baseUrl","model","credentialRef","apiKey","hasApiKey"].includes(k)) ||
    !["","claude","glm"].includes(c.model.provider) || !text(c.model.baseUrl,2000) || !text(c.model.model,200) ||
    (c.model.apiKey !== undefined && !text(c.model.apiKey,10000)) ||
    (c.model.credentialRef !== undefined && !text(c.model.credentialRef,200))) return false;
  if (c.model.provider && (!c.model.baseUrl.trim() || !c.model.model.trim())) return false;
  if (c.model.baseUrl) {
    try { const u = new URL(c.model.baseUrl); if (!["http:","https:"].includes(u.protocol) || u.username || u.password || u.search || u.hash) return false; } catch { return false; }
  }
  return text(c.initScript) && text(c.startupScript) && text(c.guidance);
}
function access(req: AuthRequest, res: Response, minimum: ProjectRole = "viewer") {
  const role = projectRole(String(req.params.id), req.user!.userId);
  if (!role) { res.status(404).json({ error: "项目不存在或无权访问" }); return undefined; }
  if (roles.indexOf(role) < roles.indexOf(minimum)) {
    res.status(403).json({ error: "项目权限不足" }); return undefined;
  }
  return role;
}

router.get("/", (req: AuthRequest, res) => {
  const limit = req.query.limit === undefined ? 12 : Number(req.query.limit);
  const query = String(req.query.q || "").trim();
  if (!Number.isInteger(limit) || limit < 1 || limit > 60 || query.length > 2000) {
    res.status(400).json({error:"分页或搜索参数无效"}); return;
  }
  let cursor: [string,string] | undefined;
  if (req.query.cursor !== undefined) {
    try {
      if (typeof req.query.cursor !== "string" || req.query.cursor.length > 1000) throw new Error();
      const value = JSON.parse(Buffer.from(req.query.cursor,"base64url").toString("utf8"));
      if (!Array.isArray(value) || value.length !== 2 || value.some(v => typeof v !== "string" || !v || v.length > 200)) throw new Error();
      cursor = value as [string,string];
    } catch {res.status(400).json({error:"分页游标无效"}); return;}
  }
  const conditions = ["(u.role='admin' OR p.created_by=u.id OR m.user_id IS NOT NULL)"];
  const args: (string|number)[] = [req.user!.userId];
  if (query) {conditions.push("(instr(lower(p.name),lower(?))>0 OR instr(lower(p.description),lower(?))>0)"); args.push(query,query);}
  if (cursor) {conditions.push("(p.created_at<? OR (p.created_at=? AND p.id<?))");args.push(cursor[0],cursor[0],cursor[1]);}
  const rows = getDb().prepare(`SELECT p.*,
    CASE WHEN u.role='admin' OR p.created_by=u.id THEN 'admin' ELSE m.role END AS access_role,
    (SELECT json_extract(c.config,'$.model.provider') FROM project_configs c WHERE c.project_id=p.id) AS agent_sdk,
    (SELECT count(*) FROM requirements r WHERE r.project_id=p.id) AS requirement_count,
    (SELECT count(*) FROM releases r WHERE r.project_id=p.id) AS release_count
    FROM projects p JOIN users u ON u.id=?
    LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=u.id
    WHERE ${conditions.join(" AND ")} ORDER BY p.created_at DESC,p.id DESC LIMIT ?`)
    .all(...args,limit+1) as {id:string;created_at:string}[];
  const hasMore = rows.length > limit;
  const items = rows.slice(0,limit);
  const last = items.at(-1);
  res.json({items,nextCursor:hasMore && last ? Buffer.from(JSON.stringify([last.created_at,last.id])).toString("base64url") : null});
});
router.post("/", (req: AuthRequest, res) => {
  if (req.user!.role !== "admin") { res.status(403).json({ error: "仅开发者可以创建项目" }); return; }
  const { name, description = "", members = [], config = emptyConfig } = req.body ?? {};
  if (!text(name,120) || !name.trim() || !text(description) || !validConfig(config) || !Array.isArray(members) || members.length > 200) {
    res.status(400).json({ error: "项目配置无效，请检查仓库地址、认证方式和端口" }); return;
  }
  const ids = new Set<string>();
  for (const m of members) {
    if (!m || typeof m.userId !== "string" || !roles.includes(m.role) || ids.has(m.userId) || !findUserById(m.userId)) {
      res.status(400).json({ error: "成员不存在、重复或角色无效" }); return;
    }
    ids.add(m.userId);
  }
  try {
    const id = createProject(name.trim(), description, req.user!.userId, members, config);
    res.status(201).json({ id });
  } catch { res.status(400).json({ error: "项目创建失败，请检查 Git 认证及模型供应商配置" }); }
});
router.get("/:id", (req: AuthRequest, res) => {
  const role = access(req,res); if (!role) return;
  const id = String(req.params.id);
  const project = getDb().prepare("SELECT * FROM projects WHERE id=?").get(id) as object;
  const config = projectConfig(id);
  res.json({ ...project, access_role: role,
    ...(role === "admin" ? { config } : {}),
    members: projectMembers(id),
    ...(role === "admin" ? { member_candidates: getDb().prepare(
      "SELECT id FROM users WHERE role!='admin' AND id!=(SELECT created_by FROM projects WHERE id=?) ORDER BY id"
    ).all(id) } : {}),
    requirements: getDb().prepare(`SELECT r.*,s.id AS session_id FROM requirements r
      JOIN project_sessions s ON s.requirement_id=r.id WHERE r.project_id=? ORDER BY r.created_at DESC,r.id`).all(id),
    releases: getDb().prepare("SELECT * FROM releases WHERE project_id=? ORDER BY created_at DESC,id").all(id),
  });
});
router.put("/:id/config", (req: AuthRequest, res) => {
  if (!access(req,res,"admin")) return;
  if (!validConfig(req.body)) { res.status(400).json({ error: "配置无效，请检查仓库地址、认证方式和端口" }); return; }
  const id = String(req.params.id);
  try {
  getDb().transaction(() => {
    const config = storeProjectConfig(id,req.body,projectConfig(id));
    getDb().prepare("UPDATE project_configs SET config=? WHERE project_id=?").run(JSON.stringify(config),id);
    getDb().prepare("DELETE FROM project_git_credentials WHERE project_id=? AND id IS NOT ?").run(id,config.gitAuth.credentialRef ?? null);
    getDb().prepare("DELETE FROM project_model_credentials WHERE project_id=? AND id IS NOT ?").run(id,config.model.credentialRef ?? null);
  })();
  res.json({message:"项目配置已保存"});
  } catch { res.status(400).json({ error: "配置保存失败，请检查 Git 认证及模型供应商配置" }); }
});
router.put("/:id/members/:userId", (req: AuthRequest, res) => {
  if (!access(req,res,"admin")) return;
  const id = String(req.params.id), userId = String(req.params.userId), role = req.body?.role;
  if (!roles.includes(role) || !findUserById(userId)) { res.status(400).json({ error: "用户或角色无效" }); return; }
  if (defaultProjectAccess(id,userId)) { res.status(409).json({ error: "创建者和平台管理员默认拥有管理权限，无需添加且不能在项目内降权" }); return; }
  getDb().prepare(`INSERT INTO project_members(project_id,user_id,role) VALUES(?,?,?)
    ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role`).run(id,userId,role);
  res.json({ message: "成员已更新" });
});
router.delete("/:id/members/:userId", (req: AuthRequest, res) => {
  if (!access(req,res,"admin")) return;
  const id = String(req.params.id), userId = String(req.params.userId);
  if (defaultProjectAccess(id,userId)) { res.status(409).json({ error: "创建者和平台管理员的默认权限不能在项目内移除" }); return; }
  getDb().prepare("DELETE FROM project_members WHERE project_id=? AND user_id=?").run(id,userId);
  res.json({ message: "成员已移除" });
});
router.post("/:id/requirements", (req: AuthRequest, res) => {
  if (!access(req,res,"editor")) return;
  const { title, description = "", acceptance = "" } = req.body ?? {};
  if (!text(title,200) || !title.trim() || !text(description) || !text(acceptance)) {
    res.status(400).json({ error: "需求内容无效" }); return;
  }
  const projectId = String(req.params.id), id = crypto.randomUUID(), sessionId = crypto.randomUUID();
  getDb().transaction(() => {
    getDb().prepare(`INSERT INTO requirements(id,project_id,title,description,acceptance,created_by)
      VALUES(?,?,?,?,?,?)`).run(id,projectId,title.trim(),description,acceptance,req.user!.userId);
    getDb().prepare("INSERT INTO project_sessions(id,requirement_id) VALUES(?,?)").run(sessionId,id);
  })();
  res.status(201).json({ id, session_id: sessionId, environment_status: "pending" });
});
router.post("/:id/releases", (req: AuthRequest, res) => {
  if (!access(req,res,"admin")) return;
  const { name, description = "" } = req.body ?? {};
  if (!text(name,120) || !name.trim() || !text(description)) { res.status(400).json({ error: "发布内容无效" }); return; }
  const id = crypto.randomUUID(), projectId = String(req.params.id);
  getDb().prepare("INSERT INTO releases(id,project_id,name,description,created_by) VALUES(?,?,?,?,?)")
    .run(id,projectId,name.trim(),description,req.user!.userId);
  res.status(201).json({ id, environment_status: "pending" });
});
export default router;
