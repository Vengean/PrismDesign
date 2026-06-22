import Docker from "dockerode";
import fs from "fs";
import path from "path";
import os from "os";
import { findWorkspaceById, updateWorkspace } from "./db.js";
import type { Workspace, RepoConfig } from "../types.js";

// Auto-detect container runtime socket: Podman → Docker
function detectSocketPath(): string {
  // Allow explicit override
  if (process.env.CONTAINER_SOCKET) return process.env.CONTAINER_SOCKET;

  const candidates = [
    // Podman Desktop (macOS)
    path.join(os.homedir(), ".local/share/containers/podman/machine/podman.sock"),
    // Podman machine (macOS alternate)
    path.join(os.homedir(), ".config/containers/podman/machine/podman.sock"),
    // Podman rootless (Linux)
    process.env.XDG_RUNTIME_DIR ? `${process.env.XDG_RUNTIME_DIR}/podman/podman.sock` : "",
    // Podman root (Linux)
    "/run/podman/podman.sock",
    // Docker
    "/var/run/docker.sock",
  ].filter(Boolean);

  for (const sock of candidates) {
    if (fs.existsSync(sock)) {
      console.log(`[Container] Using socket: ${sock}`);
      return sock;
    }
  }

  // Fallback
  console.warn("[Container] No container socket found, defaulting to /var/run/docker.sock");
  return "/var/run/docker.sock";
}

const docker = new Docker({ socketPath: detectSocketPath() });
const WORKSPACE_IMAGE = process.env.PRISM_WORKSPACE_IMAGE || "prism-workspace:latest";

function containerName(workspaceId: string) {
  return `prism-ws-${workspaceId}`;
}

// ─── Container lifecycle ───

export async function createAndStartContainer(workspace: Workspace): Promise<{
  containerId: string;
  devPort: number;
  agentPort: number;
  codeServerPort: number;
}> {
  const reposEnv = workspace.repos
    .map((r: RepoConfig) => `${r.name}|${r.url}|${r.branch}`)
    .join(",");

  const container = await docker.createContainer({
    name: containerName(workspace.id),
    Image: WORKSPACE_IMAGE,
    Env: [
      `REPOS=${reposEnv}`,
      `CLAUDE_MD=${workspace.claude_md || ""}`,
      `GIT_ACCESS_TOKEN=${workspace.git_access_token || ""}`,
      `GIT_SSH_KEY=${workspace.git_ssh_key || ""}`,
      `GIT_SSH_PORT=${workspace.git_ssh_port || ""}`,
      `STARTUP_SCRIPT=${workspace.startup_script || ""}`,
      `AGENT_TYPE=${workspace.agent_type || "claude"}`,
      `ANTHROPIC_API_KEY=${workspace.anthropic_api_key || ""}`,
      `ANTHROPIC_MODEL=${workspace.anthropic_model || ""}`,
      `ANTHROPIC_BASE_URL=${workspace.anthropic_base_url || ""}`,
      `HTTPS_PROXY=${workspace.https_proxy || ""}`,
    ],
    ExposedPorts: { "5173/tcp": {}, "8080/tcp": {}, "9527/tcp": {} },
    HostConfig: {
      PortBindings: {
        "5173/tcp": [{ HostPort: "0" }],
        "8080/tcp": [{ HostPort: "0" }],
        "9527/tcp": [{ HostPort: "0" }],
      },
      Binds: [
        `prism-ws-${workspace.id}:/workspace`,
        `prism-home-${workspace.id}:/home/prism`,
      ],
      Memory: 4 * 1024 * 1024 * 1024,
      NanoCpus: 2 * 1e9,
      SecurityOpt: ["no-new-privileges:true"],
    },
  });

  await container.start();

  const info = await container.inspect();
  const ports = info.NetworkSettings.Ports;
  const devPort = parseInt(ports["5173/tcp"]?.[0]?.HostPort || "0");
  const codeServerPort = parseInt(ports["8080/tcp"]?.[0]?.HostPort || "0");
  const agentPort = parseInt(ports["9527/tcp"]?.[0]?.HostPort || "0");

  return { containerId: container.id, devPort, agentPort, codeServerPort };
}

export async function stopContainer(workspaceId: string) {
  try {
    const container = docker.getContainer(containerName(workspaceId));
    try {
      await container.stop({ t: 10 });
    } catch (err: unknown) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code !== 304 && code !== 404) throw err;
    }
    await container.remove({ force: true });
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode !== 404) throw err;
  }
}

export async function removeContainer(workspaceId: string) {
  try {
    const container = docker.getContainer(containerName(workspaceId));
    await container.remove({ force: true });
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode !== 404) throw err;
  }
}

// ─── Docker exec helpers ───

export async function execInContainer(
  workspaceId: string,
  cmd: string[],
  workDir = "/workspace"
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const container = docker.getContainer(containerName(workspaceId));
  const exec = await container.exec({
    Cmd: ["bash", "-c", cmd.join(" ")],
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: workDir,
  });

  return new Promise((resolve, reject) => {
    exec.start({ hijack: true, stdin: false }, (err, stream) => {
      if (err || !stream) return reject(err || new Error("No stream"));

      let stdout = "";
      let stderr = "";

      stream.on("data", (chunk: Buffer) => {
        const type = chunk[0];
        const payload = chunk.subarray(8).toString();
        if (type === 1) stdout += payload;
        else stderr += payload;
      });

      stream.on("end", async () => {
        try {
          const inspected = await exec.inspect();
          resolve({ stdout, stderr, exitCode: inspected.ExitCode ?? 0 });
        } catch {
          resolve({ stdout, stderr, exitCode: 0 });
        }
      });

      stream.on("error", reject);
    });
  });
}

// Run a command using a short-lived container (for when workspace is stopped)
// Uses --entrypoint override so it doesn't run the full entrypoint.sh
export async function execInTempContainer(
  workspaceId: string,
  cmd: string[],
  workDir = "/workspace"
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const tempName = `prism-tmp-${workspaceId.slice(0, 8)}-${Date.now()}`;
  const container = await docker.createContainer({
    name: tempName,
    Image: WORKSPACE_IMAGE,
    Entrypoint: ["bash", "-c"],
    Cmd: [cmd.join(" ")],
    WorkingDir: workDir,
    HostConfig: {
      Binds: [
        `prism-ws-${workspaceId}:/workspace`,
        `prism-home-${workspaceId}:/home/prism`,
      ],
    },
  });

  try {
    await container.start();
    const waitResult = await container.wait();
    const logsBuffer = await container.logs({ stdout: true, stderr: true });

    // Parse multiplexed stream
    const buf = Buffer.isBuffer(logsBuffer) ? logsBuffer : Buffer.from(logsBuffer as string);
    let result = "";
    let offset = 0;
    while (offset + 8 <= buf.length) {
      const size = buf.readUInt32BE(offset + 4);
      offset += 8;
      if (offset + size > buf.length) break;
      result += buf.subarray(offset, offset + size).toString("utf-8");
      offset += size;
    }

    return {
      stdout: result || buf.toString("utf-8"),
      stderr: "",
      exitCode: waitResult.StatusCode,
    };
  } finally {
    try { await container.remove({ force: true }); } catch {}
  }
}

// ─── Git operations (inside container via docker exec) ───

export async function syncWorkspaceRepos(workspaceId: string) {
  const workspace = findWorkspaceById(workspaceId);
  if (!workspace) throw new Error("Workspace not found");

  updateWorkspace(workspaceId, { sync_status: "syncing" });

  try {
    for (const repo of workspace.repos) {
      const repoDir = `/workspace/${repo.name}`;

      // Check if already cloned
      const { exitCode } = await execInContainer(workspaceId, [`test -d "${repoDir}/.git"`]);

      if (exitCode !== 0) {
        // Clone
        let cloneUrl = repo.url;
        if (workspace.git_access_token && cloneUrl.startsWith("https://")) {
          cloneUrl = cloneUrl.replace("https://", `https://oauth2:${workspace.git_access_token}@`);
        }
        const result = await execInContainer(workspaceId, [
          `git clone -b "${repo.branch}" "${cloneUrl}" "${repoDir}"`,
        ]);
        if (result.exitCode !== 0) throw new Error(`Clone failed for ${repo.name}: ${result.stderr}`);
      } else {
        // Pull
        const result = await execInContainer(workspaceId, [`git pull`], repoDir);
        if (result.exitCode !== 0) throw new Error(`Pull failed for ${repo.name}: ${result.stderr}`);
      }
    }

    updateWorkspace(workspaceId, { sync_status: "synced" });
  } catch (err) {
    updateWorkspace(workspaceId, {
      sync_status: "failed",
      error_message: err instanceof Error ? err.message : "Sync failed",
    });
    throw err;
  }
}

export async function getContainerStatus(workspaceId: string): Promise<string> {
  try {
    const container = docker.getContainer(containerName(workspaceId));
    const info = await container.inspect();
    return info.State.Status;
  } catch {
    return "not_found";
  }
}

export async function getContainerLogs(
  workspaceId: string,
  tail = 1000
): Promise<string> {
  try {
    const container = docker.getContainer(containerName(workspaceId));
    const logsBuffer = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
      follow: false,
    });

    // Parse Docker multiplexed stream: each frame has 8-byte header
    const buf = Buffer.isBuffer(logsBuffer) ? logsBuffer : Buffer.from(logsBuffer as string);
    let result = "";
    let offset = 0;
    while (offset + 8 <= buf.length) {
      const size = buf.readUInt32BE(offset + 4);
      offset += 8;
      if (offset + size > buf.length) break;
      result += buf.subarray(offset, offset + size).toString("utf-8");
      offset += size;
    }
    return result || buf.toString("utf-8");
  } catch {
    return "";
  }
}
