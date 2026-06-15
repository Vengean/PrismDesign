import type { Request } from "express";

export interface User {
  id: string;
  password_hash: string;
  role: "admin" | "user";
  created_at: string;
}

export interface JwtPayload {
  userId: string;
  role: "admin" | "user";
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export interface RepoConfig {
  name: string;
  url: string;
  branch: string;
  currentBranch?: string;
}

export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  repos: RepoConfig[];
  claude_md: string;
  startup_script: string;
  git_access_token: string;
  git_ssh_key: string;
  git_ssh_port: number;
  anthropic_api_key: string;
  anthropic_base_url: string;
  anthropic_model: string;
  status: "stopped" | "syncing" | "starting" | "running" | "error";
  sync_status: "none" | "syncing" | "synced" | "failed";
  dev_port?: number;
  agent_port?: number;
  container_id?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

// DB row — repos stored as JSON string
export interface WorkspaceRow {
  id: string;
  name: string;
  owner_id: string;
  repos: string;
  claude_md: string;
  startup_script: string;
  git_access_token: string;
  git_ssh_key: string;
  git_ssh_port: number;
  anthropic_api_key: string;
  anthropic_base_url: string;
  anthropic_model: string;
  status: string;
  sync_status: string;
  dev_port: number | null;
  agent_port: number | null;
  container_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
