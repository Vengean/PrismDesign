import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type RepoConfig } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import GitAuthFields from "@/components/GitAuthFields";
import { ArrowLeft, Plus, Trash2, FolderGit2 } from "lucide-react";

const emptyRepo = (): RepoConfig => ({ name: "", url: "", branch: "main" });

export default function CreateWorkspace() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [authMode, setAuthMode] = useState<"token" | "ssh">("token");
  const [gitAccessToken, setGitAccessToken] = useState("");
  const [gitSshKey, setGitSshKey] = useState("");
  const [gitSshPort, setGitSshPort] = useState(22);
  const [repos, setRepos] = useState<RepoConfig[]>([emptyRepo()]);
  const [claudeMd, setClaudeMd] = useState("");
  const [startupScript, setStartupScript] = useState("");
  const [agentType, setAgentType] = useState<"claude" | "glm">("claude");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("");
  const [autoSync, setAutoSync] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function updateRepo(index: number, field: keyof RepoConfig, value: string) {
    setRepos((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function addRepo() {
    setRepos((prev) => [...prev, emptyRepo()]);
  }

  function removeRepo(index: number) {
    if (repos.length <= 1) return;
    setRepos((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("请输入工作空间名称");
      return;
    }

    for (let i = 0; i < repos.length; i++) {
      const r = repos[i];
      if (!r.name.trim() || !r.url.trim() || !r.branch.trim()) {
        setError(`仓库 ${i + 1} 的名称、URL 和分支不能为空`);
        return;
      }
    }

    setLoading(true);
    try {
      await api.createWorkspace({
        name: name.trim(),
        repos,
        claudeMd,
        startupScript,
        gitAccessToken,
        gitSshKey,
        gitSshPort,
        agentType,
        anthropicApiKey,
        anthropicBaseUrl,
        anthropicModel,
        autoSync,
      });
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate("/dashboard")}>
          <ArrowLeft size={18} />
        </Button>
        <FolderGit2 size={24} className="text-primary" />
        <h1 className="text-2xl font-bold">创建工作空间</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-3 text-sm bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
            {error}
          </div>
        )}

        {/* Basic info */}
        <Card>
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ws-name">工作空间名称 *</Label>
              <Input
                id="ws-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：my-project"
                required
              />
            </div>
            <GitAuthFields
              authMode={authMode}
              onAuthModeChange={setAuthMode}
              gitAccessToken={gitAccessToken}
              onGitAccessTokenChange={setGitAccessToken}
              gitSshKey={gitSshKey}
              onGitSshKeyChange={setGitSshKey}
              gitSshPort={gitSshPort}
              onGitSshPortChange={setGitSshPort}
            />
          </CardContent>
        </Card>

        {/* Repos */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Git 仓库</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addRepo}>
                <Plus size={14} />
                添加仓库
              </Button>
            </div>
            <CardDescription>配置需要 clone 的 Git 仓库</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {repos.map((repo, index) => (
              <div key={index}>
                {index > 0 && <Separator className="mb-4" />}
                <div className="flex items-start gap-3">
                  <div className="flex-1 space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">目录名 *</Label>
                        <Input
                          value={repo.name}
                          onChange={(e) => updateRepo(index, "name", e.target.value)}
                          placeholder="frontend"
                        />
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label className="text-xs">仓库 URL *</Label>
                        <Input
                          value={repo.url}
                          onChange={(e) => updateRepo(index, "url", e.target.value)}
                          placeholder="https://github.com/user/repo.git"
                        />
                      </div>
                    </div>
                    <div className="w-1/3 space-y-1.5">
                      <Label className="text-xs">默认分支 *</Label>
                      <Input
                        value={repo.branch}
                        onChange={(e) => updateRepo(index, "branch", e.target.value)}
                        placeholder="main"
                      />
                    </div>
                  </div>
                  {repos.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 mt-6 text-muted-foreground hover:text-destructive"
                      onClick={() => removeRepo(index)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* CLAUDE.md */}
        <Card>
          <CardHeader>
            <CardTitle>CLAUDE.md</CardTitle>
            <CardDescription>Agent 的项目说明文档（可选）</CardDescription>
          </CardHeader>
          <CardContent>
            <textarea
              value={claudeMd}
              onChange={(e) => setClaudeMd(e.target.value)}
              placeholder="# 项目说明&#10;&#10;在这里描述项目结构、编码规范等..."
              rows={6}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 resize-y font-mono"
            />
          </CardContent>
        </Card>

        {/* Startup script */}
        <Card>
          <CardHeader>
            <CardTitle>启动脚本</CardTitle>
            <CardDescription>容器启动后执行的自定义脚本（可选，5 分钟超时）</CardDescription>
          </CardHeader>
          <CardContent>
            <textarea
              value={startupScript}
              onChange={(e) => setStartupScript(e.target.value)}
              placeholder="#!/bin/bash&#10;cd /workspace/frontend&#10;pnpm install&#10;pnpm dev &"
              rows={4}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 resize-y font-mono"
            />
          </CardContent>
        </Card>

        {/* Agent config */}
        <Card>
          <CardHeader>
            <CardTitle>Agent 配置</CardTitle>
            <CardDescription>AI 代码修改服务的模型配置</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Agent 类型</Label>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="agentType"
                    value="claude"
                    checked={agentType === "claude"}
                    onChange={() => setAgentType("claude")}
                    className="accent-primary"
                  />
                  <span className="text-sm">Claude Agent SDK</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="agentType"
                    value="glm"
                    checked={agentType === "glm"}
                    onChange={() => setAgentType("glm")}
                    className="accent-primary"
                  />
                  <span className="text-sm">GLM Agent</span>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {agentType === "claude"
                  ? "使用 Claude Agent SDK，支持 Claude 系列模型及 LiteLLM 代理"
                  : "使用智谱 GLM Agent，原生支持 GLM 系列模型"}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-key">API Key *</Label>
              <Input
                id="api-key"
                type="password"
                value={anthropicApiKey}
                onChange={(e) => setAnthropicApiKey(e.target.value)}
                placeholder={agentType === "claude" ? "sk-ant-..." : "智谱 API Key"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="base-url">Base URL</Label>
              <Input
                id="base-url"
                value={anthropicBaseUrl}
                onChange={(e) => setAnthropicBaseUrl(e.target.value)}
                placeholder={agentType === "claude" ? "https://api.anthropic.com（留空使用默认）" : "https://open.bigmodel.cn/api/paas/v4（留空使用默认）"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">模型</Label>
              <Input
                id="model"
                value={anthropicModel}
                onChange={(e) => setAnthropicModel(e.target.value)}
                placeholder={agentType === "claude" ? "claude-sonnet-4-20250514（留空使用默认）" : "glm-4-plus（留空使用默认）"}
              />
            </div>
          </CardContent>
        </Card>

        {/* Options */}
        <Card>
          <CardContent className="pt-6">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => setAutoSync(e.target.checked)}
                className="size-4 rounded border-input accent-primary"
              />
              <div>
                <p className="text-sm font-medium">创建后自动同步代码</p>
                <p className="text-xs text-muted-foreground">勾选后将自动 clone 所有仓库</p>
              </div>
            </label>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => navigate("/dashboard")}>
            取消
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "创建中..." : "创建工作空间"}
          </Button>
        </div>
      </form>
    </div>
  );
}
