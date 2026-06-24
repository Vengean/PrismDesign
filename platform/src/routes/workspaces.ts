import { Router, type Router as RouterType } from "express";
import {
  listWorkspaces,
  findWorkspaceById,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace as deleteWorkspaceFromDb,
} from "../services/db.js";
import {
  createAndStartContainer,
  stopContainer,
  removeContainer,
  syncWorkspaceRepos,
  getContainerStatus,
} from "../services/container-manager.js";
import { authenticate } from "../middleware/auth.js";
import type { AuthRequest, Workspace } from "../types.js";

// Reconcile DB status with actual container status
async function reconcileStatus(workspace: Workspace): Promise<Workspace> {
  if (workspace.status !== "running" && workspace.status !== "starting") return workspace;

  const containerStatus = await getContainerStatus(workspace.id);

  // Container is gone or stopped but DB says running
  if (containerStatus === "not_found" || containerStatus === "exited" || containerStatus === "stopped" || containerStatus === "dead") {
    updateWorkspace(workspace.id, {
      status: "stopped",
      container_id: "",
      dev_port: 0,
      agent_port: 0,
      code_server_port: 0,
    });
    return { ...workspace, status: "stopped", container_id: "", dev_port: 0, agent_port: 0, code_server_port: 0 };
  }

  return workspace;
}

async function reconcileAll(workspaces: Workspace[]): Promise<Workspace[]> {
  return Promise.all(workspaces.map(reconcileStatus));
}

const router: RouterType = Router();

router.use(authenticate);

// List workspaces
router.get("/", async (req, res) => {
  const authReq = req as AuthRequest;
  const isAdmin = authReq.user!.role === "admin";
  const workspaces = listWorkspaces(authReq.user!.userId, isAdmin);
  res.json(await reconcileAll(workspaces));
});

// Create workspace
router.post("/", (req, res) => {
  const authReq = req as AuthRequest;
  const { name, repos, claudeMd, startupScript, gitAccessToken, gitSshKey, gitSshPort, agentType, anthropicApiKey, anthropicBaseUrl, anthropicModel, httpsProxy, autoSync } = req.body;

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

  try {
    const id = createWorkspace({
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

    const workspace = findWorkspaceById(id);

    // Auto sync in background if requested
    if (autoSync) {
      syncWorkspace(id).catch((err) => {
        console.error(`Auto sync failed for workspace ${id}:`, err);
      });
    }

    res.status(201).json(workspace);
  } catch (err) {
    console.error("Create workspace error:", err, "user:", JSON.stringify(authReq.user));
    res.status(500).json({ error: "创建工作空间失败，请重新登录后重试" });
  }
});

// Get workspace
router.get("/:id", async (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  if (authReq.user!.role !== "admin" && workspace.owner_id !== authReq.user!.userId) {
    res.status(403).json({ error: "无权访问" });
    return;
  }

  res.json(await reconcileStatus(workspace));
});

// Update workspace
router.put("/:id", (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  if (authReq.user!.role !== "admin" && workspace.owner_id !== authReq.user!.userId) {
    res.status(403).json({ error: "无权操作" });
    return;
  }

  const { name, repos, claudeMd, startupScript, gitAccessToken, gitSshKey, gitSshPort, agentType, anthropicApiKey, anthropicBaseUrl, anthropicModel, httpsProxy } = req.body;

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

  res.json(findWorkspaceById(req.params.id));
});

// Delete workspace
router.delete("/:id", async (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  if (authReq.user!.role !== "admin" && workspace.owner_id !== authReq.user!.userId) {
    res.status(403).json({ error: "无权操作" });
    return;
  }

  try {
    await removeContainer(workspace.id);
  } catch (err) {
    console.error("Failed to remove container:", err);
  }

  deleteWorkspaceFromDb(req.params.id);
  res.json({ message: "工作空间已删除" });
});

// Sync repos
router.post("/:id/sync", async (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  if (authReq.user!.role !== "admin" && workspace.owner_id !== authReq.user!.userId) {
    res.status(403).json({ error: "无权操作" });
    return;
  }

  if (workspace.sync_status === "synced") {
    res.json({ message: "代码已同步" });
    return;
  }

  syncWorkspace(workspace.id).catch((err) => {
    console.error(`Sync failed for workspace ${workspace.id}:`, err);
  });

  res.json({ message: "同步已开始" });
});

// Start workspace
router.post("/:id/start", async (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  if (authReq.user!.role !== "admin" && workspace.owner_id !== authReq.user!.userId) {
    res.status(403).json({ error: "无权操作" });
    return;
  }

  if (workspace.status === "running" || workspace.status === "starting") {
    res.status(400).json({ error: "工作空间已在运行中" });
    return;
  }

  updateWorkspace(workspace.id, { status: "starting", error_message: "" });

  try {
    // Remove old container if exists
    await removeContainer(workspace.id);

    const { containerId, devPort, agentPort, codeServerPort } = await createAndStartContainer(workspace);
    updateWorkspace(workspace.id, {
      status: "running",
      container_id: containerId,
      dev_port: devPort,
      agent_port: agentPort,
      code_server_port: codeServerPort,
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

// Stop workspace
router.post("/:id/stop", async (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  if (authReq.user!.role !== "admin" && workspace.owner_id !== authReq.user!.userId) {
    res.status(403).json({ error: "无权操作" });
    return;
  }

  try {
    await stopContainer(workspace.id);
    updateWorkspace(workspace.id, {
      status: "stopped",
      container_id: "",
      dev_port: 0,
      agent_port: 0,
      code_server_port: 0,
    });
    res.json(findWorkspaceById(workspace.id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "停止失败" });
  }
});

// Restart workspace
router.post("/:id/restart", async (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) {
    res.status(404).json({ error: "工作空间不存在" });
    return;
  }

  if (authReq.user!.role !== "admin" && workspace.owner_id !== authReq.user!.userId) {
    res.status(403).json({ error: "无权操作" });
    return;
  }

  try {
    await stopContainer(workspace.id);
    const { containerId, devPort, agentPort, codeServerPort } = await createAndStartContainer(workspace);
    updateWorkspace(workspace.id, {
      status: "running",
      container_id: containerId,
      dev_port: devPort,
      agent_port: agentPort,
      code_server_port: codeServerPort,
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

// Sync needs a running container for docker exec git operations
async function syncWorkspace(workspaceId: string) {
  const workspace = findWorkspaceById(workspaceId);
  if (!workspace) return;

  try {
    let needsTempContainer = workspace.status !== "running";

    if (needsTempContainer) {
      await removeContainer(workspaceId);
      const { containerId } = await createAndStartContainer(workspace);
      updateWorkspace(workspaceId, { container_id: containerId });
      // Wait for entrypoint to set up SSH
      await new Promise((r) => setTimeout(r, 2000));
    }

    await syncWorkspaceRepos(workspaceId);

    if (needsTempContainer) {
      await stopContainer(workspaceId);
      updateWorkspace(workspaceId, {
        status: "stopped",
        container_id: "",
        dev_port: 0,
        agent_port: 0,
        code_server_port: 0,
      });
    }
  } catch (err) {
    try { await removeContainer(workspaceId); } catch {}
    updateWorkspace(workspaceId, {
      status: "stopped",
      sync_status: "failed",
      container_id: "",
      code_server_port: 0,
      error_message: err instanceof Error ? err.message : "同步失败",
    });
  }
}

export default router;
