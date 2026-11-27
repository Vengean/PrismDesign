import type {PlatformConversation,PlatformMessage} from '../../../../packages/ui/src/studio/platform-client';
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
  subscriptionStatus(id:string){return request<SubscriptionStatus>(`/projects/${encodeURIComponent(id)}/subscription/status`);},
  openSubscriptionTerminal(id:string){return request<SubscriptionSession>(`/projects/${encodeURIComponent(id)}/subscription/sessions`,{method:'POST'});},
  closeSubscriptionTerminal(id:string,sessionId:string){return request(`/projects/${encodeURIComponent(id)}/subscription/sessions/${encodeURIComponent(sessionId)}`,{method:'DELETE'});},
  logoutSubscription(id:string){return request<SubscriptionStatus>(`/projects/${encodeURIComponent(id)}/subscription/logout`,{method:'POST'});},
  listWorkspaceFiles(projectId:string,requirementId:string,path=''){return request<WorkspaceFileList>(`/projects/${projectId}/requirements/${requirementId}/environment/files?path=${encodeURIComponent(path)}`);},
  async downloadWorkspaceFile(projectId:string,requirementId:string,path:string){
    const token=localStorage.getItem('token');
    const response=await fetch(`${BASE_URL}/projects/${projectId}/requirements/${requirementId}/environment/files/download?path=${encodeURIComponent(path)}`,{headers:token?{Authorization:`Bearer ${token}`}:{},signal:AbortSignal.timeout(60000)});
    if(!response.ok){if(response.status===401){localStorage.removeItem('token');localStorage.removeItem('user');window.location.href=loginLocation(window.location.pathname+window.location.search);}throw Error((await response.json()).error||'文件下载失败');}
    return response.blob();
  },
  getRequirementGit(projectId:string,requirementId:string){return request<{repos:{name:string}[];branch:string;release?:{name:string;branch:string}}>(`/projects/${projectId}/requirements/${requirementId}/environment/git`);},
  getRequirementGitStatus(projectId:string,requirementId:string,repo:string){return request<{dirty:boolean}>(`/projects/${projectId}/requirements/${requirementId}/environment/git/status?repo=${encodeURIComponent(repo)}`);},
  operateRequirementGit(projectId:string,requirementId:string,repo:string,action:'pull'|'push'|'commit',message?:string){return request<{success:boolean;message:string;commit:string}>(`/projects/${projectId}/requirements/${requirementId}/environment/git/${action}`,{method:'POST',body:JSON.stringify({repo,message})});},
  getConversation(projectId:string,requirementId:string,after=0,eventAfter=0,wait=false,liveAfter='',page?:{latest?:boolean;before?:number;sessionId?:string}){return request<Conversation>(`/projects/${projectId}/requirements/${requirementId}/conversation?after=${after}&eventAfter=${eventAfter}&liveAfter=${encodeURIComponent(liveAfter)}${wait?'&wait=1':''}${page?.latest?'&latest=1':''}${page?.before===undefined?'':'&before='+page.before}${page?.sessionId?'&sessionId='+encodeURIComponent(page.sessionId):''}`);},
  sendConversation(projectId:string,requirementId:string,message:string,requestId:string){return request<{id:string}>(`/projects/${projectId}/requirements/${requirementId}/conversation/messages`,{method:'POST',body:JSON.stringify({message,requestId})});},
  cancelConversation(projectId:string,requirementId:string,runId:string){return request(`/projects/${projectId}/requirements/${requirementId}/conversation/runs/${runId}/cancel`,{method:'POST'});},
  getEnvironment(projectId:string,requirementId:string) {
    return request<{status:string;error:string;branch:string;ports:number[];services:{port:number;protocol:string;ready:boolean;page?:boolean;statusCode?:number}[];agentReady:boolean;phase:string;elapsedSeconds:number;defaultPort?:number}>(`/projects/${projectId}/requirements/${requirementId}/environment`);
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
  getProjectMemberCandidates() { return request<{id:string}[]>("/projects/member-candidates"); },
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
  createRequirement(id: string, releaseId:string, data: { title: string; description: string }) {
    return request(`/projects/${encodeURIComponent(id)}/releases/${encodeURIComponent(releaseId)}/requirements`, { method: "POST", body: JSON.stringify(data) });
  },
  getRepositoryBranches(id:string,repo:string){return request<{branches:string[]}>(`/projects/${encodeURIComponent(id)}/repository-branches?repo=${encodeURIComponent(repo)}`);},
  createRelease(id: string, data: { name: string; description: string; baseRefs?:Record<string,string> }) {
    return request(`/projects/${encodeURIComponent(id)}/releases`, { method: "POST", body: JSON.stringify(data) });
  },
  getRelease(projectId:string,releaseId:string){return request<ReleaseDetail>(`/projects/${projectId}/releases/${releaseId}`);},
  deleteRelease(projectId:string,releaseId:string){return request<{message:string}>(`/projects/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(releaseId)}`,{method:'DELETE'});},
  deleteRequirement(projectId:string,requirementId:string){return request<{message:string}>(`/projects/${encodeURIComponent(projectId)}/requirements/${encodeURIComponent(requirementId)}`,{method:'DELETE'});},
  releaseAction(projectId:string,releaseId:string,action:'retry'|'sync'|'freeze'|'unfreeze'){return request<{message:string}>(`/projects/${projectId}/releases/${releaseId}/${action}`,{method:'POST'});},
  requirementAction(projectId:string,id:string,action:'apply'|'sync-release'|'branches/retry'|'adopt',data?:unknown){return request<{id?:string;message?:string;changed?:boolean;releaseBranch?:string;results?:{repo:string;releaseCommit:string;commit:string;changed:boolean}[]}>(`/projects/${projectId}/requirements/${id}/${action}`,{method:'POST',body:JSON.stringify(data||{})});},
  mergeAction(projectId:string,id:string,action:'approve'|'reject'|'confirm-external'|'sync',reason?:string){return request<{message?:string}>(`/projects/${projectId}/merge-requests/${id}/${action}`,{method:'POST',body:JSON.stringify({reason})});},
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
export interface SubscriptionStatus {provider:'codex'|'claude'|'glm';status:'not_logged_in'|'logged_in'|'logging_in'}
export interface SubscriptionSession {id:string;ticket:string;provider:string;command:string}
export interface ProjectConfig {
  repos: { name: string; url: string; branch: string }[];
  gitAuth: {
    mode: "token" | "ssh"; sshPort: number; token?: string; sshKey?: string;
    hasToken?: boolean; hasSshKey?: boolean; credentialRef?: string; requiresUpdate?: boolean;
  };
  model: { provider: string; baseUrl: string; model: string; authMode?: "api-key" | "subscription"; proxyUrl?: string; credentialRef?: string; apiKey?: string; hasApiKey?: boolean };
  initScript: string;
  startupScript: string;
  guidance: string;
  knowledge?:{documents:{path:string;content:string}[];skills:{name:string;content:string}[];mcpServers:Record<string,{type?:'stdio'|'http';command?:string;args?:string[];env?:Record<string,string>;url?:string;headers?:Record<string,string>}>};
}
export interface Project {
  id: string; name: string; description: string; created_by: string; created_at: string;
  access_role: ProjectRole; requirement_count: number; release_count: number;
  agent_sdk?: string;
}
export interface ProjectDetail extends Project {
  release_repositories?: {name:string;branch:string}[];
  config?: ProjectConfig;
  members: { user_id: string; role: ProjectRole; permission_source: "creator" | "platform_admin" | "explicit" }[];
  member_candidates?: { id: string }[];
  requirements: RequirementSummary[];
  releases: ReleaseSummary[];
}

export type ConversationMessage=PlatformMessage;
export type Conversation=PlatformConversation;

export interface RequirementSummary {id:string;title:string;description:string;status:string;environment_status:string;session_id:string;created_by:string;release_id:string|null;branch_name:string;branch_status:string;branch_error:string}
export interface WorkspaceFileList {path:string;items:{name:string;path:string;kind:'file'|'directory';size:number;modifiedAt:string}[];truncated:boolean}
export interface ReleaseSummary {id:string;name:string;description:string;status:string;environment_status:string;created_by:string;branch_name:string;branch_status:string;branch_error:string}
export interface MergeRequest {id:string;requirement_id:string;submitted_by:string;approved_by:string|null;status:string;manifest:string;results:string;reason:string;created_at:string}
export interface ReleaseDetail extends ReleaseSummary {requirements:RequirementSummary[];requests:MergeRequest[];repositories:{repo_name:string;source_ref:string;base_sha:string;head_sha:string;branch_status:string;error:string}[];operation_kind:string;frozen_manifest:string}
