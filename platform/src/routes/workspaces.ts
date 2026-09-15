import { Router, type Router as RouterType } from "express";
import {
  listWorkspaces,
  findWorkspaceById,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace as deleteWorkspaceFromDb,
  getWorkspaceAccessLevel,
  listWorkspaceShares,
  addWorkspaceShare,
  updateWorkspaceShare,
  removeWorkspaceShare,
  listSharedWorkspaces,
  findUserById,
} from "../services/db.js";
import {
  createAndStartContainer,
  startExistingContainer,
  stopContainer,
  destroyContainer,
  syncWorkspaceRepos,
  getContainerStatus,
  containerExists,
} from "../services/container-manager.js";
import { authenticate } from "../middleware/auth.js";
import type { AuthRequest, Workspace, SharePermission, WorkspaceAccessLevel } from "../types.js";

// Mask a secret string: show first 4 and last 4 chars
function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return value.slice(0, 4) + "••••••••" + value.slice(-4);
}

// Mask sensitive fields for readonly users
function maskWorkspace(ws: Workspace): Workspace {
  return {
    ...ws,
    git_access_token: maskSecret(ws.git_access_token),
    git_ssh_key: ws.git_ssh_key ? "••••••••" : "",
    anthropic_api_key: maskSecret(ws.anthropic_api_key),
    https_proxy: maskSecret(ws.https_proxy),
  };
}

// Reconcile DB status with actual container status
async function reconcileStatus(workspace: Workspace): Promise<Workspace> {
  if (workspace.status !== "running" && workspace.status !== "starting") return workspace;

  const containerStatus = await getContainerStatus(workspace.id);

  // Container stopped/exited/gone but DB says running — mark as stopped (keep ports for restart)
  if (containerStatus === "not_found" || containerStatus === "exited" || containerStatus === "stopped" || containerStatus === "dead") {
    updateWorkspace(workspace.id, { status: "stopped" });
    return { ...workspace, status: "stopped" };
  }

  return workspace;
}

async function reconcileAll(workspaces: Workspace[]): Promise<Workspace[]> {
  return Promise.all(workspaces.map(reconcileStatus));
}

const router: RouterType = Router();

router.use(authenticate);

// List workspaces (own + shared)
router.get("/", async (req, res) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user!.userId;
  const isAdmin = authReq.user!.role === "admin";
  const ownWorkspaces = listWorkspaces(userId, isAdmin);

  // Add access_level to own workspaces
  const ownWithAccess = ownWorkspaces.map((ws) => ({
    ...ws,
    access_level: (isAdmin ? "admin" : "owner") as WorkspaceAccessLevel,
  }));

  // Get shared workspaces (non-admin only, admin already sees all)
  let sharedWithAccess: (Workspace & { access_level: WorkspaceAccessLevel })[] = [];
  if (!isAdmin) {
    const sharedWorkspaces = listSharedWorkspaces(userId);
    const ownIds = new Set(ownWorkspaces.map((w) => w.id));
    sharedWithAccess = sharedWorkspaces
      .filter((ws) => !ownIds.has(ws.id))
      .map((ws) => ({
        ...ws,
        access_level: ws.share_permission as WorkspaceAccessLevel,
      }));
    // Mask sensitive fields for readonly shared workspaces
    sharedWithAccess = sharedWithAccess.map((ws) =>
      ws.access_level === "readonly" ? { ...maskWorkspace(ws), access_level: ws.access_level } : ws
    );
  }

  const all = [...ownWithAccess, ...sharedWithAccess];
  res.json(await reconcileAll(all));
});

// Create workspace — creates container + starts + syncs repos
router.post("/", async (req, res) => {
  const authReq = req as AuthRequest;
  const { name, repos, claudeMd, startupScript, gitAccessToken, gitSshKey, gitSshPort, agentType, anthropicApiKey, anthropicBaseUrl, anthropicModel, httpsProxy } = req.body;

  if (!name?.trim()) {
    res.status(400).json({ error: "工作空间名称不能为空" });
    return;
  }

  if (!repos || !Array.isArray(repos) || repos.length === 0) {
    res.status(400).json({ error: "至少需要配置一个 Git 仓库" });
    return;
  }

  for (const repo of repos) {
    if (!repo.name?.trim() || !repo.url?.trim() || !repo.branch?.trim()) {
      res.status(400).json({ error: "仓库名称、URL 和分支不能为空" });
      return;
    }
  }

  let id: string;
  try {
    id = createWorkspace({
      name: name.trim(),
      ownerId: authReq.user!.userId,
      repos: JSON.stringify(repos),
      claudeMd: claudeMd || "",
      startupScript: startupScript || "",
      gitAccessToken: gitAccessToken || "",
      gitSshKey: gitSshKey || "",
      gitSshPort: parseInt(gitSshPort) || 22,
      agentType: agentType || "claude",
      anthropicApiKey: anthropicApiKey || "",
      anthropicBaseUrl: anthropicBaseUrl || "",
      anthropicModel: anthropicModel || "",
      httpsProxy: httpsProxy || "",
    });
  } catch (err) {
    console.error("Create workspace error:", err, "user:", JSON.stringify(authReq.user));
    res.status(500).json({ error: "创建工作空间失败，请重新登录后重试" });
    return;
  }

  // Create container + start + sync in background
  const workspace = findWorkspaceById(id)!;
  updateWorkspace(id, { status: "starting", error_message: "" });
  res.status(201).json(findWorkspaceById(id));

  // Background: create container → sync repos → running
  (async () => {
    try {
      const { containerId, devPort, agentPort, codeServerPort } = await createAndStartContainer(workspace);
      updateWorkspace(id, { container_id: containerId, dev_port: devPort, agent_port: agentPort, code_server_port: codeServerPort });

      // Wait for entrypoint to set up SSH/git
      await new Promise((r) => setTimeout(r, 2000));

      // Sync repos
      await syncWorkspaceRepos(id);

      updateWorkspace(id, { status: "running" });
    } catch (err) {
      console.error(`Workspace ${id} setup failed:`, err);
      updateWorkspace(id, {
        status: "error",
        error_message: err instanceof Error ? err.message : "工作空间初始化失败",
      });
    }
  })();
});

// Get workspace
router.get("/:id", async (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  const accessLevel = getWorkspaceAccessLevel(req.params.id, authReq.user!.userId, authReq.user!.role);
  if (!accessLevel) {
    res.status(403).json({ error: "无权访问" });
    return;
  }

  let result = await reconcileStatus(workspace);
  if (accessLevel === "readonly") {
    result = maskWorkspace(result);
  }
  res.json({ ...result, access_level: accessLevel });
});

// Update workspace — recreates container if env-affecting settings change
router.put("/:id", async (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  const accessLevel = getWorkspaceAccessLevel(req.params.id, authReq.user!.userId, authReq.user!.role);
  if (!accessLevel || accessLevel === "readonly") {
    res.status(403).json({ error: "无权操作" });
    return;
  }

  const { name, repos, claudeMd, startupScript, gitAccessToken, gitSshKey, gitSshPort, agentType, anthropicApiKey, anthropicBaseUrl, anthropicModel, httpsProxy } = req.body;

  // Check if container-env-affecting fields changed
  const envFields = { gitAccessToken, gitSshKey, gitSshPort, agentType, anthropicApiKey, anthropicBaseUrl, anthropicModel, httpsProxy, claudeMd, startupScript };
  const oldEnv = {
    gitAccessToken: workspace.git_access_token, gitSshKey: workspace.git_ssh_key,
    gitSshPort: workspace.git_ssh_port, agentType: workspace.agent_type,
    anthropicApiKey: workspace.anthropic_api_key, anthropicBaseUrl: workspace.anthropic_base_url,
    anthropicModel: workspace.anthropic_model, httpsProxy: workspace.https_proxy,
    claudeMd: workspace.claude_md, startupScript: workspace.startup_script,
  };
  const envChanged = Object.entries(envFields).some(
    ([key, val]) => val !== undefined && String(val) !== String(oldEnv[key as keyof typeof oldEnv])
  );

  updateWorkspace(req.params.id, {
    ...(name !== undefined && { name }),
    ...(repos !== undefined && { repos }),
    ...(claudeMd !== undefined && { claude_md: claudeMd }),
    ...(startupScript !== undefined && { startup_script: startupScript }),
    ...(gitAccessToken !== undefined && { git_access_token: gitAccessToken }),
    ...(gitSshKey !== undefined && { git_ssh_key: gitSshKey }),
    ...(gitSshPort !== undefined && { git_ssh_port: parseInt(gitSshPort) || 22 }),
    ...(agentType !== undefined && { agent_type: agentType }),
    ...(anthropicApiKey !== undefined && { anthropic_api_key: anthropicApiKey }),
    ...(anthropicBaseUrl !== undefined && { anthropic_base_url: anthropicBaseUrl }),
    ...(anthropicModel !== undefined && { anthropic_model: anthropicModel }),
    ...(httpsProxy !== undefined && { https_proxy: httpsProxy }),
  });

  // Recreate container if env-affecting settings changed and container exists
  if (envChanged) {
    const exists = await containerExists(req.params.id);
    if (exists) {
      const wasRunning = workspace.status === "running";
      try {
        await destroyContainer(req.params.id);
        const updated = findWorkspaceById(req.params.id)!;
        const result = await createAndStartContainer(updated);
        updateWorkspace(req.params.id, {
          container_id: result.containerId,
          dev_port: result.devPort,
          agent_port: result.agentPort,
          code_server_port: result.codeServerPort,
          status: wasRunning ? "running" : "stopped",
        });
        // If it wasn't running before, stop the newly created container
        if (!wasRunning) {
          await stopContainer(req.params.id);
        }
      } catch (err) {
        console.error("Failed to recreate container after settings update:", err);
        updateWorkspace(req.params.id, {
          status: "error",
          error_message: "配置已保存，但容器重建失败: " + (err instanceof Error ? err.message : "未知错误"),
        });
      }
    }
  }

  res.json(findWorkspaceById(req.params.id));
});

// Delete workspace — owner/admin only
router.delete("/:id", async (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  const accessLevel = getWorkspaceAccessLevel(req.params.id, authReq.user!.userId, authReq.user!.role);
  if (accessLevel !== "owner" && accessLevel !== "admin") {
    res.status(403).json({ error: "无权操作" });
    return;
  }

  try {
    await destroyContainer(workspace.id);
  } catch (err) {
    console.error("Failed to destroy container:", err);
  }

  deleteWorkspaceFromDb(req.params.id);
  res.json({ message: "工作空间已删除" });
});

// Sync repos (pull latest) — requires running container
router.post("/:id/sync", async (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  const accessLevel = getWorkspaceAccessLevel(req.params.id, authReq.user!.userId, authReq.user!.role);
  if (!accessLevel || accessLevel === "readonly") {
    res.status(403).json({ error: "无权操作" });
    return;
  }

  if (workspace.status !== "running") {
    res.status(400).json({ error: "请先启动工作空间" });
    return;
  }

  // Sync in background
  syncWorkspaceRepos(workspace.id).catch((err) => {
    console.error(`Sync failed for workspace ${workspace.id}:`, err);
  });

  res.json({ message: "同步已开始" });
});

// Start workspace — start existing container, recreate if missing
router.post("/:id/start", async (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  const accessLevel = getWorkspaceAccessLevel(req.params.id, authReq.user!.userId, authReq.user!.role);
  if (!accessLevel || accessLevel === "readonly") {
    res.status(403).json({ error: "无权操作" });
    return;
  }

  if (workspace.status === "running" || workspace.status === "starting") {
    res.status(400).json({ error: "工作空间已在运行中" });
    return;
  }

  updateWorkspace(workspace.id, { status: "starting", error_message: "" });

  try {
    let result: { containerId: string; devPort: number; agentPort: number; codeServerPort: number };

    const exists = await containerExists(workspace.id);
    if (exists) {
      // Container exists (stopped), just start it
      result = await startExistingContainer(workspace.id);
    } else {
      // Container was lost (manual deletion, host reboot, etc.), recreate
      result = await createAndStartContainer(workspace);
    }

    updateWorkspace(workspace.id, {
      status: "running",
      container_id: result.containerId,
      dev_port: result.devPort,
      agent_port: result.agentPort,
      code_server_port: result.codeServerPort,
    });

    res.json(findWorkspaceById(workspace.id));
  } catch (err) {
    updateWorkspace(workspace.id, {
      status: "error",
      error_message: err instanceof Error ? err.message : "启动失败",
    });
    res.status(500).json({ error: err instanceof Error ? err.message : "启动失败" });
  }
});

// Stop workspace — stop container, keep it for later restart
router.post("/:id/stop", async (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  const accessLevel = getWorkspaceAccessLevel(req.params.id, authReq.user!.userId, authReq.user!.role);
  if (!accessLevel || accessLevel === "readonly") {
    res.status(403).json({ error: "无权操作" });
    return;
  }

  try {
    await stopContainer(workspace.id);
    updateWorkspace(workspace.id, { status: "stopped" });
    res.json(findWorkspaceById(workspace.id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "停止失败" });
  }
});

// Restart workspace — stop + start existing container
router.post("/:id/restart", async (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  const accessLevel = getWorkspaceAccessLevel(req.params.id, authReq.user!.userId, authReq.user!.role);
  if (!accessLevel || accessLevel === "readonly") {
    res.status(403).json({ error: "无权操作" });
    return;
  }

  try {
    await stopContainer(workspace.id);

    let result: { containerId: string; devPort: number; agentPort: number; codeServerPort: number };
    const exists = await containerExists(workspace.id);
    if (exists) {
      result = await startExistingContainer(workspace.id);
    } else {
      result = await createAndStartContainer(workspace);
    }

    updateWorkspace(workspace.id, {
      status: "running",
      container_id: result.containerId,
      dev_port: result.devPort,
      agent_port: result.agentPort,
      code_server_port: result.codeServerPort,
    });
    res.json(findWorkspaceById(workspace.id));
  } catch (err) {
    updateWorkspace(workspace.id, {
      status: "error",
      error_message: err instanceof Error ? err.message : "重启失败",
    });
    res.status(500).json({ error: err instanceof Error ? err.message : "重启失败" });
  }
});

// ─── Sharing endpoints ───

// List shares for a workspace
router.get("/:id/shares", (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  const accessLevel = getWorkspaceAccessLevel(req.params.id, authReq.user!.userId, authReq.user!.role);
  if (!accessLevel) {
    res.status(403).json({ error: "无权访问" });
    return;
  }

  const shares = listWorkspaceShares(req.params.id);
  res.json(shares);
});

// Add a share
router.post("/:id/shares", (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  // Only owner/admin can share
  const accessLevel = getWorkspaceAccessLevel(req.params.id, authReq.user!.userId, authReq.user!.role);
  if (accessLevel !== "owner" && accessLevel !== "admin") {
    res.status(403).json({ error: "只有创建者可以分享工作空间" });
    return;
  }

  const { userId, permission } = req.body as { userId: string; permission: SharePermission };
  if (!userId?.trim()) {
    res.status(400).json({ error: "用户 ID 不能为空" });
    return;
  }
  if (permission !== "readonly" && permission !== "edit") {
    res.status(400).json({ error: "权限类型无效" });
    return;
  }
  if (userId === workspace.owner_id) {
    res.status(400).json({ error: "不能分享给自己" });
    return;
  }

  // Check user exists
  const targetUser = findUserById(userId);
  if (!targetUser) {
    res.status(404).json({ error: "用户不存在" });
    return;
  }

  try {
    const share = addWorkspaceShare(req.params.id, userId, permission);
    res.status(201).json(share);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("UNIQUE")) {
      res.status(409).json({ error: "该用户已被分享" });
    } else {
      res.status(500).json({ error: "分享失败" });
    }
  }
});

// Update share permission
router.put("/:id/shares/:shareId", (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  const accessLevel = getWorkspaceAccessLevel(req.params.id, authReq.user!.userId, authReq.user!.role);
  if (accessLevel !== "owner" && accessLevel !== "admin") {
    res.status(403).json({ error: "无权操作" });
    return;
  }

  const { permission } = req.body as { permission: SharePermission };
  if (permission !== "readonly" && permission !== "edit") {
    res.status(400).json({ error: "权限类型无效" });
    return;
  }

  updateWorkspaceShare(req.params.shareId, permission);
  res.json({ message: "权限已更新" });
});

// Remove share
router.delete("/:id/shares/:shareId", (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  const accessLevel = getWorkspaceAccessLevel(req.params.id, authReq.user!.userId, authReq.user!.role);
  if (accessLevel !== "owner" && accessLevel !== "admin") {
    res.status(403).json({ error: "无权操作" });
    return;
  }

  removeWorkspaceShare(req.params.shareId);
  res.json({ message: "已取消分享" });
});

export default router;
