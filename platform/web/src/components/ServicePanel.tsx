import { useState } from "react";
import { api, type Workspace } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Copy, Check, RotateCcw, ScrollText, Loader2 } from "lucide-react";

interface ServicePanelProps {
  workspace: Workspace;
  onRefresh: () => void;
}

const LOG_TABS = [
  { key: "all", label: "全部" },
  { key: "main", label: "主进程" },
  { key: "agent", label: "Agent" },
  { key: "startup", label: "启动脚本" },
] as const;

type LogSource = (typeof LOG_TABS)[number]["key"];

export default function ServicePanel({ workspace, onRefresh }: ServicePanelProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logSource, setLogSource] = useState<LogSource>("all");
  const [restarting, setRestarting] = useState(false);

  const hostname = window.location.hostname;

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  async function loadLogs(source: LogSource) {
    setLogsLoading(true);
    try {
      const data = await api.getServiceLogs(workspace.id, source);
      setLogs(data.logs);
    } catch {
      setLogs("获取日志失败");
    } finally {
      setLogsLoading(false);
    }
  }

  function handleOpenLogs() {
    setLogsOpen(true);
    loadLogs(logSource);
  }

  function handleSwitchTab(source: LogSource) {
    setLogSource(source);
    loadLogs(source);
  }

  async function handleRestart() {
    setRestarting(true);
    try {
      await api.restartServices(workspace.id);
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "重启失败");
    } finally {
      setRestarting(false);
    }
  }

  if (workspace.status !== "running") return null;

  return (
    <>
      <div className="mt-3 p-4 rounded-lg bg-muted/50 border border-dashed space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">服务信息</span>
          <Badge variant="default">运行中</Badge>
        </div>

        {workspace.agent_port ? (
          <ServiceAddress
            label="Agent"
            address={`${hostname}:${workspace.agent_port}`}
            copied={copied === "agent"}
            onCopy={() => copyToClipboard(`${hostname}:${workspace.agent_port}`, "agent")}
          />
        ) : null}

        {workspace.dev_port ? (
          <ServiceAddress
            label="Dev Server"
            address={`http://${hostname}:${workspace.dev_port}`}
            copied={copied === "dev"}
            onCopy={() => copyToClipboard(`http://${hostname}:${workspace.dev_port}`, "dev")}
          />
        ) : null}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={handleRestart} disabled={restarting}>
            {restarting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            重启
          </Button>
          <Button variant="outline" size="sm" onClick={handleOpenLogs}>
            <ScrollText size={14} />
            查看日志
          </Button>
        </div>
      </div>

      {/* Logs dialog */}
      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>容器日志 — {workspace.name}</DialogTitle>
          </DialogHeader>

          {/* Log source tabs */}
          <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
            {LOG_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer",
                  logSource === tab.key
                    ? "bg-background shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => handleSwitchTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto">
            {logsLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 size={16} className="animate-spin mr-2" />
                加载中...
              </div>
            ) : (
              <pre className="text-xs font-mono bg-[#1e1e1e] text-[#d4d4d4] p-4 rounded-lg overflow-auto max-h-[55vh] whitespace-pre-wrap break-all">
                {logs || "暂无日志"}
              </pre>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLogsOpen(false)}>
              关闭
            </Button>
            <Button variant="outline" onClick={() => loadLogs(logSource)} disabled={logsLoading}>
              <RotateCcw size={14} />
              刷新
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ServiceAddress({
  label,
  address,
  copied,
  onCopy,
}: {
  label: string;
  address: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div>
        <span className="text-muted-foreground">{label}：</span>
        <code className="ml-1 px-1.5 py-0.5 bg-background rounded text-xs font-mono border">
          {address}
        </code>
      </div>
      <Button variant="ghost" size="icon" className="size-7" onClick={onCopy} title="复制地址">
        {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
      </Button>
    </div>
  );
}
