import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, type Workspace } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Loader2,
  Settings,
  MonitorPlay,
  ExternalLink,
  AlertCircle,
} from "lucide-react";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  stopped: { label: "已停止", variant: "secondary" },
  syncing: { label: "同步中", variant: "outline" },
  starting: { label: "启动中", variant: "outline" },
  running: { label: "运行中", variant: "default" },
  error: { label: "错误", variant: "destructive" },
};

export default function WorkspaceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);

  const loadWorkspace = useCallback(async () => {
    if (!id) return;
    try {
      const ws = await api.getWorkspace(id);
      setWorkspace(ws);
    } catch (err) {
      console.error("加载工作空间失败:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!workspace || workspace.status === "stopped" || workspace.status === "error") return;
    const timer = window.setInterval(loadWorkspace, 10000);
    return () => window.clearInterval(timer);
  }, [workspace?.status, loadWorkspace]);

  if (loading || !workspace) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 size={20} className="animate-spin mr-2" />
        加载中...
      </div>
    );
  }

  const status = STATUS_MAP[workspace.status] || STATUS_MAP.stopped;
  const isRunning = workspace.status === "running";
  const hostname = window.location.hostname;

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-2 border-b bg-background shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate("/dashboard")}>
            <ArrowLeft size={16} />
          </Button>
          <h1 className="text-lg font-semibold">{workspace.name}</h1>
          <Badge variant={status.variant}>{status.label}</Badge>
          <Badge variant="outline">
            {workspace.agent_type === "glm" ? "GLM" : "Claude"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && workspace.code_server_port && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`https://${hostname}:${workspace.code_server_port}`, "_blank")}
            >
              <MonitorPlay size={14} />
              新窗口打开
              <ExternalLink size={12} />
            </Button>
          )}
          {isRunning && workspace.dev_port && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`http://${hostname}:${workspace.dev_port}`, "_blank")}
            >
              预览
              <ExternalLink size={12} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => navigate(`/workspace/${workspace.id}/settings`)}
          >
            <Settings size={16} />
          </Button>
        </div>
      </div>

      {/* Content */}
      {!isRunning ? (
        <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-3">
          <AlertCircle size={48} className="opacity-20" />
          <p>工作空间未运行，请先启动工作空间</p>
          <Button onClick={() => navigate("/dashboard")}>返回仪表盘</Button>
        </div>
      ) : workspace.code_server_port ? (
        <iframe
          src={`https://${hostname}:${workspace.code_server_port}`}
          className="flex-1 w-full border-0"
          title="VS Code Web"
        />
      ) : (
        <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-3">
          <MonitorPlay size={48} className="opacity-20" />
          <p>Code Server 未就绪，请稍后刷新</p>
          <Button variant="outline" onClick={loadWorkspace}>
            刷新状态
          </Button>
        </div>
      )}
    </div>
  );
}
