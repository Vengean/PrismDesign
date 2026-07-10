import { Router, type Router as RouterType } from "express";
import { findWorkspaceById, getWorkspaceAccessLevel } from "../services/db.js";
import {
  getContainerStatus,
  getContainerLogs,
  stopContainer,
  startExistingContainer,
  containerExists,
  createAndStartContainer,
  execInContainer,
} from "../services/container-manager.js";
import { updateWorkspace } from "../services/db.js";
import { authenticate } from "../middleware/auth.js";
import type { AuthRequest } from "../types.js";

const router: RouterType = Router();

router.use(authenticate);

const LOG_SOURCES: Record<string, string> = {
  main: "/var/log/prism/main.log",
  agent: "/var/log/prism/agent.log",
  startup: "/var/log/prism/startup.log",
  "code-server": "/var/log/prism/code-server.log",
};

// Service status
router.get("/:id/services/status", async (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) { res.status(404).json({ error: "工作空间不存在" }); return; }
  const accessLevel = getWorkspaceAccessLevel(req.params.id, authReq.user!.userId, authReq.user!.role);
  if (!accessLevel) { res.status(403).json({ error: "无权访问" }); return; }

  const containerStatus = await getContainerStatus(workspace.id);

  res.json({
    container: containerStatus,
    agentPort: workspace.agent_port || null,
    devPort: workspace.dev_port || null,
    status: workspace.status,
  });
});

// Container logs — supports ?source=main|agent|startup|all
router.get("/:id/services/logs", async (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) { res.status(404).json({ error: "工作空间不存在" }); return; }
  const accessLevel = getWorkspaceAccessLevel(req.params.id, authReq.user!.userId, authReq.user!.role);
  if (!accessLevel) { res.status(403).json({ error: "无权访问" }); return; }

  const source = (req.query.source as string) || "all";
  const tail = parseInt(req.query.tail as string) || 1000;

  if (source === "all") {
    const logs = await getContainerLogs(workspace.id, tail);
    res.json({ logs });
    return;
  }

  const logPath = LOG_SOURCES[source];
  if (!logPath) {
    res.status(400).json({ error: "无效的日志来源" });
    return;
  }

  if (workspace.status !== "running") {
    res.json({ logs: "" });
    return;
  }

  try {
    const { stdout } = await execInContainer(workspace.id, [
      `tail -n ${tail} "${logPath}" 2>/dev/null || echo "暂无日志"`,
    ]);
    res.json({ logs: stdout });
  } catch {
    res.json({ logs: "" });
  }
});

// Restart services
router.post("/:id/services/restart", async (req, res) => {
  const authReq = req as AuthRequest;
  const workspace = findWorkspaceById(req.params.id);

  if (!workspace) { res.status(404).json({ error: "工作空间不存在" }); return; }
  const accessLevel = getWorkspaceAccessLevel(req.params.id, authReq.user!.userId, authReq.user!.role);
  if (!accessLevel || accessLevel === "readonly") { res.status(403).json({ error: "无权操作" }); return; }

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

export default router;
