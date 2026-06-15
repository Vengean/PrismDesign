import { Router, type Router as RouterType } from "express";
import { findWorkspaceById } from "../services/db.js";
import { execInContainer, execInTempContainer } from "../services/container-manager.js";
import { authenticate } from "../middleware/auth.js";
import type { AuthRequest, Workspace } from "../types.js";

const router: RouterType = Router();

router.use(authenticate);

function checkOwnership(req: AuthRequest, workspaceId: string):
  | { error: string; status: number }
  | { workspace: Workspace } {
  const workspace = findWorkspaceById(workspaceId);
  if (!workspace) return { error: "工作空间不存在", status: 404 };
  if (req.user!.role !== "admin" && workspace.owner_id !== req.user!.userId) {
    return { error: "无权操作", status: 403 };
  }
  return { workspace };
}

function requireRunning(req: AuthRequest, workspaceId: string):
  | { error: string; status: number }
  | { workspace: Workspace } {
  const result = checkOwnership(req, workspaceId);
  if ("error" in result) return result;
  if (result.workspace.status !== "running") {
    return { error: "工作空间未运行", status: 400 };
  }
  return result;
}

// List branches — works even when stopped (uses temp container)
router.get("/:id/git/:repo/branches", async (req, res) => {
  const result = checkOwnership(req as AuthRequest, req.params.id);
  if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }

  const { workspace } = result;
  const repoDir = `/workspace/${req.params.repo}`;

  try {
    const exec = workspace.status === "running" ? execInContainer : execInTempContainer;

    const { stdout: branchOut } = await exec(workspace.id, [
      `cd "${repoDir}" && git branch -a --format='%(refname:short)' 2>/dev/null`,
    ]);

    const branches = branchOut
      .split("\n")
      .map((b) => b.trim())
      .filter((b) => b && !b.includes("HEAD"))
      .map((b) => b.replace(/^origin\//, ""));
    const unique = [...new Set(branches)];

    const { stdout: current } = await exec(workspace.id, [
      `cd "${repoDir}" && git rev-parse --abbrev-ref HEAD`,
    ]);

    res.json({ branches: unique, current: current.trim() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "获取分支失败" });
  }
});

// Checkout branch — requires running container
router.post("/:id/git/:repo/checkout", async (req, res) => {
  const result = requireRunning(req as AuthRequest, req.params.id);
  if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }

  const { branch, create } = req.body;
  if (!branch) { res.status(400).json({ error: "分支名不能为空" }); return; }

  const repoDir = `/workspace/${req.params.repo}`;
  try {
    const cmd = create
      ? `cd "${repoDir}" && git checkout -b "${branch}"`
      : `cd "${repoDir}" && git checkout "${branch}"`;

    const { exitCode, stderr } = await execInContainer(req.params.id, [cmd]);
    if (exitCode !== 0) { res.status(500).json({ error: stderr || "切换分支失败" }); return; }

    res.json({ message: `已切换到分支 ${branch}` });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "切换分支失败" });
  }
});

// Git status — requires running container
router.get("/:id/git/:repo/status", async (req, res) => {
  const result = requireRunning(req as AuthRequest, req.params.id);
  if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }

  const repoDir = `/workspace/${req.params.repo}`;
  try {
    const { stdout } = await execInContainer(req.params.id, [
      `cd "${repoDir}" && git status --porcelain`,
    ]);
    res.json({ status: stdout.trim() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "获取状态失败" });
  }
});

export default router;
