import {loginLocation} from "./auth-redirect";
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

  if (res.status === 401 && url!=="/auth/login") {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = loginLocation(window.location.pathname+window.location.search+window.location.hash);
    throw new Error("Unauthorized");
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data as T;
}

export const api = {
  getRequirementGit(projectId:string,requirementId:string){return request<{repos:{name:string}[];branch:string}>(`/projects/${projectId}/requirements/${requirementId}/environment/git`);},
  getRequirementGitStatus(projectId:string,requirementId:string,repo:string){return request<{dirty:boolean}>(`/projects/${projectId}/requirements/${requirementId}/environment/git/status?repo=${encodeURIComponent(repo)}`);},
  operateRequirementGit(projectId:string,requirementId:string,repo:string,action:'pull'|'push'|'commit',message?:string){return request<{success:boolean;message:string;commit:string}>(`/projects/${projectId}/requirements/${requirementId}/environment/git/${action}`,{method:'POST',body:JSON.stringify({repo,message})});},
  getConversation(projectId:string,requirementId:string,after=0,eventAfter=0){return request<Conversation>(`/projects/${projectId}/requirements/${requirementId}/conversation?after=${after}&eventAfter=${eventAfter}`);},
  sendConversation(projectId:string,requirementId:string,message:string,requestId:string){return request<{id:string}>(`/projects/${projectId}/requirements/${requirementId}/conversation/messages`,{method:'POST',body:JSON.stringify({message,requestId})});},
  cancelConversation(projectId:string,requirementId:string,runId:string){return request(`/projects/${projectId}/requirements/${requirementId}/conversation/runs/${runId}/cancel`,{method:'POST'});},
  getEnvironment(projectId:string,requirementId:string) {
    return request<{status:string;error:string;branch:string;ports:number[]}>(`/projects/${projectId}/requirements/${requirementId}/environment`);
  },
  environmentAction(projectId:string,requirementId:string,action:"start"|"stop") {
    return request(`/projects/${projectId}/requirements/${requirementId}/environment/${action}`,{method:"POST"});
  },
  getEnvironmentLogs(projectId:string,requirementId:string) {
    return request<{logs:string}>(`/projects/${projectId}/requirements/${requirementId}/environment/logs`);
  },
  openEnvironment(projectId:string,requirementId:string,kind:"preview"|"ide",port?:number) {
    return request<{url:string}>(`/projects/${encodeURIComponent(projectId)}/requirements/${encodeURIComponent(requirementId)}/environment/open-${kind}`,{method:"POST",body:JSON.stringify({port})});
  },
  getProjects(options: {q?:string;cursor?:string;limit?:number} = {}, signal?:AbortSignal) {
    const params = new URLSearchParams({limit:String(options.limit || 12)});
    if(options.q)params.set("q",options.q);
    if(options.cursor)params.set("cursor",options.cursor);
    return request<{items:Project[];nextCursor:string|null}>(`/projects?${params}`,{signal});
  },
  getProject(id: string) { return request<ProjectDetail>(`/projects/${encodeURIComponent(id)}`); },
  createProject(data: { name: string; description: string; members: { userId: string; role: ProjectRole }[]; config: ProjectConfig }) {
    return request<{ id: string }>("/projects", { method: "POST", body: JSON.stringify(data) });
  },
  saveProjectConfig(id: string, config: ProjectConfig) {
    return request<{ message: string }>(`/projects/${encodeURIComponent(id)}/config`, { method: "PUT", body: JSON.stringify(config) });
  },
  setProjectMember(id: string, userId: string, role: ProjectRole) {
    return request(`/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: "PUT", body: JSON.stringify({ role }) });
  },
  removeProjectMember(id: string, userId: string) {
    return request(`/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
  },
  createRequirement(id: string, data: { title: string; description: string; acceptance: string }) {
    return request(`/projects/${encodeURIComponent(id)}/requirements`, { method: "POST", body: JSON.stringify(data) });
  },
  createRelease(id: string, data: { name: string; description: string }) {
    return request(`/projects/${encodeURIComponent(id)}/releases`, { method: "POST", body: JSON.stringify(data) });
  },
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


};

export type ProjectRole = "viewer" | "editor" | "admin";
export interface ProjectConfig {
  repos: { name: string; url: string; branch: string }[];
  gitAuth: {
    mode: "token" | "ssh"; sshPort: number; token?: string; sshKey?: string;
    hasToken?: boolean; hasSshKey?: boolean; credentialRef?: string; requiresUpdate?: boolean;
  };
  model: { provider: string; baseUrl: string; model: string; credentialRef?: string; apiKey?: string; hasApiKey?: boolean };
  initScript: string;
  startupScript: string;
  guidance: string;
}
export interface Project {
  id: string; name: string; description: string; created_by: string; created_at: string;
  access_role: ProjectRole; requirement_count: number; release_count: number;
  agent_sdk?: string;
}
export interface ProjectDetail extends Project {
  config?: ProjectConfig;
  members: { user_id: string; role: ProjectRole; permission_source: "creator" | "platform_admin" | "explicit" }[];
  member_candidates?: { id: string }[];
  requirements: { id: string; title: string; description: string; acceptance: string; status: string; environment_status: string; session_id: string; created_by: string }[];
  releases: { id: string; name: string; description: string; status: string; environment_status: string; created_by: string }[];
}

export interface ConversationMessage {id:string;seq:number;role:'user'|'assistant';body:string;user_id:string|null;run_id:string;}
export interface Conversation {
 session_id:string;restricted:boolean;messages:ConversationMessage[];current_messages:ConversationMessage[];
 runs:{id:string;status:string;user_id:string;error?:string;cancel_supported?:number}[];
 active_run:{id:string;status:string;user_id:string}|null;
 events:{seq:number;type:string;data:Record<string,unknown>}[];
 next_message_cursor:number;next_event_cursor:number;
}
