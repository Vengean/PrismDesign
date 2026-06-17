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

// ─── Path safety ───

function sanitizePath(p: string): string | null {
  if (!p || p.includes("..") || p.startsWith("/")) return null;
  return p;
}

// ─── File operations ───

// List directory contents
router.get("/:id/git/:repo/files", async (req, res) => {
  const result = requireRunning(req as AuthRequest, req.params.id);
  if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }

  const rawPath = (req.query.path as string) || ".";
  const safePath = sanitizePath(rawPath);
  if (!safePath) { res.status(400).json({ error: "非法路径" }); return; }

  const repoDir = `/workspace/${req.params.repo}`;
  try {
    // Use find for structured output: type, size, name
    const { stdout, exitCode } = await execInContainer(req.params.id, [
      `cd "${repoDir}" && find "${safePath}" -maxdepth 1 -mindepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n' 2>/dev/null | sort -t$'\\t' -k1,1r -k4,4`,
    ]);

    if (exitCode !== 0) {
      res.json({ files: [], path: safePath });
      return;
    }

    const files = stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [typeChar, sizeStr, mtimeStr, ...nameParts] = line.split("\t");
        const name = nameParts.join("\t");
        return {
          name,
          type: typeChar === "d" ? "directory" as const : "file" as const,
          size: parseInt(sizeStr) || 0,
          modified: new Date(parseFloat(mtimeStr) * 1000).toISOString(),
        };
      });

    res.json({ files, path: safePath });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "列出文件失败" });
  }
});

// Read file content
router.get("/:id/git/:repo/file", async (req, res) => {
  const result = requireRunning(req as AuthRequest, req.params.id);
  if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }

  const rawPath = req.query.path as string;
  if (!rawPath) { res.status(400).json({ error: "缺少 path 参数" }); return; }
  const safePath = sanitizePath(rawPath);
  if (!safePath) { res.status(400).json({ error: "非法路径" }); return; }

  const repoDir = `/workspace/${req.params.repo}`;
  try {
    // Check size first (reject > 1MB)
    const { stdout: sizeOut, exitCode: sizeExit } = await execInContainer(req.params.id, [
      `cd "${repoDir}" && stat --format=%s "${safePath}" 2>/dev/null`,
    ]);

    if (sizeExit !== 0) {
      res.status(404).json({ error: "文件不存在" });
      return;
    }

    const size = parseInt(sizeOut.trim());
    if (size > 1024 * 1024) {
      res.status(413).json({ error: "文件过大（超过 1MB）" });
      return;
    }

    // Check if binary
    const { stdout: mimeOut } = await execInContainer(req.params.id, [
      `cd "${repoDir}" && file --mime-type -b "${safePath}"`,
    ]);
    const mime = mimeOut.trim();
    const isText = mime.startsWith("text/") || mime === "application/json" || mime === "application/javascript" || mime === "application/xml" || mime === "inode/x-empty";

    if (!isText) {
      res.status(415).json({ error: `不支持预览的文件类型: ${mime}` });
      return;
    }

    const { stdout: content } = await execInContainer(req.params.id, [
      `cd "${repoDir}" && cat "${safePath}"`,
    ]);

    res.json({ content, path: safePath, size });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "读取文件失败" });
  }
});

// Create/write file (base64 encoded content for safety)
router.post("/:id/git/:repo/file", async (req, res) => {
  const result = requireRunning(req as AuthRequest, req.params.id);
  if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }

  const { path: filePath, content } = req.body;
  if (!filePath) { res.status(400).json({ error: "缺少文件路径" }); return; }
  const safePath = sanitizePath(filePath);
  if (!safePath) { res.status(400).json({ error: "非法路径" }); return; }

  const repoDir = `/workspace/${req.params.repo}`;
  try {
    const b64 = Buffer.from(content || "").toString("base64");
    const { exitCode, stderr } = await execInContainer(req.params.id, [
      `cd "${repoDir}" && mkdir -p "$(dirname "${safePath}")" && echo "${b64}" | base64 -d > "${safePath}"`,
    ]);

    if (exitCode !== 0) {
      res.status(500).json({ error: stderr || "创建文件失败" });
      return;
    }

    res.json({ message: "文件已保存", path: safePath });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "创建文件失败" });
  }
});

// Delete file
router.delete("/:id/git/:repo/file", async (req, res) => {
  const result = requireRunning(req as AuthRequest, req.params.id);
  if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }

  const { path: filePath } = req.body;
  if (!filePath) { res.status(400).json({ error: "缺少文件路径" }); return; }
  const safePath = sanitizePath(filePath);
  if (!safePath) { res.status(400).json({ error: "非法路径" }); return; }

  const repoDir = `/workspace/${req.params.repo}`;
  try {
    const { exitCode, stderr } = await execInContainer(req.params.id, [
      `cd "${repoDir}" && rm -f "${safePath}"`,
    ]);

    if (exitCode !== 0) {
      res.status(500).json({ error: stderr || "删除文件失败" });
      return;
    }

    res.json({ message: "文件已删除" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "删除文件失败" });
  }
});

// ─── Extended Git operations ───

// Git diff
router.get("/:id/git/:repo/diff", async (req, res) => {
  const result = requireRunning(req as AuthRequest, req.params.id);
  if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }

  const repoDir = `/workspace/${req.params.repo}`;
  const filePath = req.query.path as string | undefined;
  try {
    const pathArg = filePath ? ` -- "${filePath}"` : "";
    const { stdout } = await execInContainer(req.params.id, [
      `cd "${repoDir}" && git diff HEAD${pathArg}`,
    ]);

    res.json({ diff: stdout });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "获取 diff 失败" });
  }
});

// Git push
router.post("/:id/git/:repo/push", async (req, res) => {
  const result = requireRunning(req as AuthRequest, req.params.id);
  if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }

  const { remote, branch, force } = req.body || {};
  const repoDir = `/workspace/${req.params.repo}`;
  try {
    const forceFlag = force ? " --force" : "";
    const { stdout, stderr, exitCode } = await execInContainer(req.params.id, [
      `cd "${repoDir}" && git push${forceFlag} ${remote || "origin"} ${branch || "HEAD"}`,
    ]);

    if (exitCode !== 0) {
      res.status(500).json({ error: stderr || "推送失败", stdout, stderr });
      return;
    }

    res.json({ message: "推送成功", stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "推送失败" });
  }
});

// Git pull
router.post("/:id/git/:repo/pull", async (req, res) => {
  const result = requireRunning(req as AuthRequest, req.params.id);
  if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }

  const { remote, branch } = req.body || {};
  const repoDir = `/workspace/${req.params.repo}`;
  try {
    const { stdout, stderr, exitCode } = await execInContainer(req.params.id, [
      `cd "${repoDir}" && git pull ${remote || "origin"} ${branch || ""}`,
    ]);

    if (exitCode !== 0) {
      res.status(500).json({ error: stderr || "拉取失败", stdout, stderr });
      return;
    }

    res.json({ message: "拉取成功", stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "拉取失败" });
  }
});

// Git log
router.get("/:id/git/:repo/log", async (req, res) => {
  const result = checkOwnership(req as AuthRequest, req.params.id);
  if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }

  const { workspace } = result;
  const limit = parseInt(req.query.limit as string) || 20;
  const repoDir = `/workspace/${req.params.repo}`;

  try {
    const exec = workspace.status === "running" ? execInContainer : execInTempContainer;
    const { stdout } = await exec(workspace.id, [
      `cd "${repoDir}" && git log --format='%H|%h|%an|%ae|%at|%s' -n ${limit}`,
    ]);

    const commits = stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, author, email, timestamp, ...msgParts] = line.split("|");
        return {
          hash,
          shortHash,
          author,
          email,
          timestamp: parseInt(timestamp),
          message: msgParts.join("|"),
        };
      });

    res.json({ commits });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "获取提交历史失败" });
  }
});

export default router;
