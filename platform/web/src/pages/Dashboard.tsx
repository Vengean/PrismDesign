import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Workspace } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import StartupDialog from "@/components/StartupDialog";
import ServicePanel from "@/components/ServicePanel";
import {
  FolderGit2,
  Plus,
  Play,
  Square,
  Trash2,
  RefreshCw,
  Loader2,
  AlertCircle,
  GitBranch,
  Settings,
} from "lucide-react";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  stopped: { label: "已停止", variant: "secondary" },
  syncing: { label: "同步中", variant: "outline" },
  starting: { label: "启动中", variant: "outline" },
  running: { label: "运行中", variant: "default" },
  error: { label: "错误", variant: "destructive" },
};

const SYNC_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  none: { label: "未同步", variant: "secondary" },
  syncing: { label: "同步中", variant: "outline" },
  synced: { label: "已同步", variant: "default" },
  failed: { label: "同步失败", variant: "destructive" },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [startupTarget, setStartupTarget] = useState<Workspace | null>(null);

  const loadWorkspaces = useCallback(async () => {
    try {
      const data = await api.getWorkspaces();
      setWorkspaces(data);
    } catch (err) {
      console.error("加载工作空间失败:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkspaces();
    // Poll every 5s for status updates
    const timer = window.setInterval(loadWorkspaces, 5000);
    return () => window.clearInterval(timer);
  }, [loadWorkspaces]);

  async function handleAction(id: string, action: () => Promise<unknown>) {
    setActionLoading(id);
    try {
      await action();
      await loadWorkspaces();
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作失败");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setActionLoading(deleteTarget.id);
    try {
      await api.deleteWorkspace(deleteTarget.id);
      setDeleteTarget(null);
      await loadWorkspaces();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FolderGit2 size={24} className="text-primary" />
          <h1 className="text-2xl font-bold">工作空间</h1>
        </div>
        <Button onClick={() => navigate("/workspace/create")}>
          <Plus size={16} />
          创建工作空间
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 size={20} className="animate-spin mr-2" />
          加载中...
        </div>
      ) : workspaces.length === 0 ? (
        <Card>
          <CardContent className="py-16">
            <div className="text-center text-muted-foreground">
              <FolderGit2 size={48} className="mx-auto mb-4 opacity-30" />
              <p className="text-lg mb-2">暂无工作空间</p>
              <p className="text-sm mb-4">创建一个工作空间来开始使用 AI 修改代码</p>
              <Button onClick={() => navigate("/workspace/create")}>
                <Plus size={16} />
                创建工作空间
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {workspaces.map((ws) => {
            const status = STATUS_MAP[ws.status] || STATUS_MAP.stopped;
            const syncStatus = SYNC_STATUS_MAP[ws.sync_status] || SYNC_STATUS_MAP.none;
            const isLoading = actionLoading === ws.id;

            return (
              <Card key={ws.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    {/* Left: info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3
                          className="text-base font-semibold truncate cursor-pointer hover:text-primary transition-colors"
                          onClick={() => navigate(`/workspace/${ws.id}`)}
                        >
                          {ws.name}
                        </h3>
                        <Badge variant="outline">
                          {ws.agent_type === "glm" ? "GLM" : "Claude"}
                        </Badge>
                        <Badge variant={status.variant}>{status.label}</Badge>
                        <Badge variant={syncStatus.variant}>{syncStatus.label}</Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <GitBranch size={14} />
                          {ws.repos.length} 个仓库
                        </span>
                        <span>
                          创建于 {new Date(ws.created_at).toLocaleDateString("zh-CN")}
                        </span>
                        {ws.error_message && (
                          <span className="flex items-center gap-1 text-destructive">
                            <AlertCircle size={14} />
                            {ws.error_message}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: actions */}
                    <div className="flex items-center gap-2 ml-4">
                      {ws.status === "stopped" || ws.status === "error" ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isLoading}
                            onClick={() => handleAction(ws.id, () => api.syncWorkspace(ws.id))}
                          >
                            <RefreshCw size={14} className={ws.sync_status === "syncing" ? "animate-spin" : ""} />
                            同步
                          </Button>
                          <Button
                            size="sm"
                            disabled={isLoading}
                            onClick={() => setStartupTarget(ws)}
                          >
                            <Play size={14} />
                            启动
                          </Button>
                        </>
                      ) : ws.status === "running" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isLoading}
                          onClick={() => handleAction(ws.id, () => api.stopWorkspace(ws.id))}
                        >
                          <Square size={14} />
                          停止
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground"
                        onClick={() => navigate(`/workspace/${ws.id}/settings`)}
                        title="设置"
                      >
                        <Settings size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        disabled={isLoading || ws.status === "running" || ws.status === "starting"}
                        onClick={() => setDeleteTarget(ws)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </div>
                  <ServicePanel workspace={ws} onRefresh={loadWorkspaces} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除工作空间「{deleteTarget?.name}」吗？此操作将同时删除容器和数据卷，不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={!!actionLoading}>
              {actionLoading ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Startup dialog */}
      <StartupDialog
        workspace={startupTarget}
        open={!!startupTarget}
        onOpenChange={(open) => { if (!open) setStartupTarget(null); }}
        onStarted={loadWorkspaces}
      />
    </div>
  );
}
