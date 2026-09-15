import { useState, useEffect, useCallback } from "react";
import { api, type WorkspaceShare } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Trash2, UserPlus, Users, Eye, Pencil } from "lucide-react";

interface ShareDialogProps {
  workspaceId: string;
  workspaceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ShareDialog({ workspaceId, workspaceName, open, onOpenChange }: ShareDialogProps) {
  const [shares, setShares] = useState<WorkspaceShare[]>([]);
  const [loading, setLoading] = useState(false);
  const [inputUser, setInputUser] = useState("");
  const [selectedPermission, setSelectedPermission] = useState<"readonly" | "edit">("readonly");
  const [adding, setAdding] = useState(false);

  const loadShares = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const data = await api.getShares(workspaceId);
      setShares(data);
    } catch (err) {
      console.error("加载分享信息失败:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, open]);

  useEffect(() => {
    loadShares();
  }, [loadShares]);

  async function handleAdd() {
    const userId = inputUser.trim();
    if (!userId) return;
    setAdding(true);
    try {
      await api.addShare(workspaceId, userId, selectedPermission);
      setInputUser("");
      await loadShares();
    } catch (err) {
      alert(err instanceof Error ? err.message : "分享失败");
    } finally {
      setAdding(false);
    }
  }

  async function handleUpdatePermission(shareId: string, permission: "readonly" | "edit") {
    try {
      await api.updateShare(workspaceId, shareId, permission);
      setShares((prev) =>
        prev.map((s) => (s.id === shareId ? { ...s, permission } : s))
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "更新权限失败");
    }
  }

  async function handleRemove(shareId: string) {
    try {
      await api.removeShare(workspaceId, shareId);
      await loadShares();
    } catch (err) {
      alert(err instanceof Error ? err.message : "取消分享失败");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users size={18} />
            分享工作空间
          </DialogTitle>
          <DialogDescription>
            管理「{workspaceName}」的分享设置
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 size={20} className="animate-spin mr-2" />
            加载中...
          </div>
        ) : (
          <div className="space-y-4">
            {/* Add share — always visible */}
            <div className="flex items-center gap-2">
              <Input
                className="flex-1"
                placeholder="输入用户名"
                value={inputUser}
                onChange={(e) => setInputUser(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
              <Select value={selectedPermission} onValueChange={(v) => setSelectedPermission(v as "readonly" | "edit")}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="readonly">只读</SelectItem>
                  <SelectItem value="edit">编辑</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" onClick={handleAdd} disabled={!inputUser.trim() || adding}>
                {adding ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              </Button>
            </div>

            {/* Share list */}
            {shares.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-6">
                暂未分享给任何用户
              </div>
            ) : (
              <div className="space-y-2">
                {shares.map((share) => (
                  <div
                    key={share.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-muted/30"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="size-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary shrink-0">
                        {share.user_id[0].toUpperCase()}
                      </div>
                      <span className="text-sm font-medium truncate">{share.user_id}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Select
                        value={share.permission}
                        onValueChange={(v) => handleUpdatePermission(share.id, v as "readonly" | "edit")}
                      >
                        <SelectTrigger className="w-24 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="readonly">
                            <span className="flex items-center gap-1.5">
                              <Eye size={12} />
                              只读
                            </span>
                          </SelectItem>
                          <SelectItem value="edit">
                            <span className="flex items-center gap-1.5">
                              <Pencil size={12} />
                              编辑
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemove(share.id)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              只读权限：可查看工作空间，敏感信息（密钥、Token）将被掩码显示。
              编辑权限：可操作工作空间（启动、停止、修改配置等）。
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
