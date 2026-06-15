const BASE_URL = "/api";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options?.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data as T;
}

export const api = {
  login(username: string, password: string) {
    return request<{ token: string; user: { id: string; role: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },

  changePassword(oldPassword: string, newPassword: string) {
    return request<{ message: string }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ oldPassword, newPassword }),
    });
  },

  getUsers() {
    return request<{ id: string; role: string; created_at: string }[]>("/users");
  },

  createUser(id: string) {
    return request<{ id: string; password: string }>("/users", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
  },

  deleteUser(id: string) {
    return request<{ message: string }>(`/users/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  resetPassword(id: string) {
    return request<{ id: string; password: string }>(
      `/users/${encodeURIComponent(id)}/reset-password`,
      { method: "POST" }
    );
  },

  // Workspaces
  getWorkspaces() {
    return request<Workspace[]>("/workspaces");
  },

  getWorkspace(id: string) {
    return request<Workspace>(`/workspaces/${id}`);
  },

  createWorkspace(data: CreateWorkspacePayload) {
    return request<Workspace>("/workspaces", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  updateWorkspace(id: string, data: Partial<CreateWorkspacePayload>) {
    return request<Workspace>(`/workspaces/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  deleteWorkspace(id: string) {
    return request<{ message: string }>(`/workspaces/${id}`, { method: "DELETE" });
  },

  syncWorkspace(id: string) {
    return request<{ message: string }>(`/workspaces/${id}/sync`, { method: "POST" });
  },

  startWorkspace(id: string) {
    return request<Workspace>(`/workspaces/${id}/start`, { method: "POST" });
  },

  stopWorkspace(id: string) {
    return request<Workspace>(`/workspaces/${id}/stop`, { method: "POST" });
  },

  restartWorkspace(id: string) {
    return request<Workspace>(`/workspaces/${id}/restart`, { method: "POST" });
  },

  // Git
  getBranches(workspaceId: string, repo: string) {
    return request<{ branches: string[]; current: string }>(
      `/workspaces/${workspaceId}/git/${encodeURIComponent(repo)}/branches`
    );
  },

  checkout(workspaceId: string, repo: string, branch: string, create = false) {
    return request<{ message: string }>(
      `/workspaces/${workspaceId}/git/${encodeURIComponent(repo)}/checkout`,
      { method: "POST", body: JSON.stringify({ branch, create }) }
    );
  },

  // Services
  getServiceStatus(id: string) {
    return request<{ container: string; agentPort: number | null; devPort: number | null; status: string }>(
      `/workspaces/${id}/services/status`
    );
  },

  getServiceLogs(id: string, source = "all", tail = 1000) {
    return request<{ logs: string }>(`/workspaces/${id}/services/logs?source=${source}&tail=${tail}`);
  },

  restartServices(id: string) {
    return request<Workspace>(`/workspaces/${id}/services/restart`, { method: "POST" });
  },
};

export interface RepoConfig {
  name: string;
  url: string;
  branch: string;
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

export interface CreateWorkspacePayload {
  name: string;
  repos: RepoConfig[];
  claudeMd?: string;
  startupScript?: string;
  gitAccessToken?: string;
  gitSshKey?: string;
  gitSshPort?: number;
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  anthropicModel?: string;
  autoSync?: boolean;
}
