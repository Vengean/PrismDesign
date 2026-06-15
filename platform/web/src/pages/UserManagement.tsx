import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { Users, Plus, Trash2, RotateCcw, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface UserInfo {
  id: string;
  role: string;
  created_at: string;
}

export default function UserManagement() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [credentialInfo, setCredentialInfo] = useState<{
    id: string;
    password: string;
    title: string;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const data = await api.getUsers();
      setUsers(data);
    } catch (err) {
      console.error("加载用户列表失败:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  async function handleDelete(id: string) {
    try {
      await api.deleteUser(id);
      setDeleteConfirm(null);
      loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    }
  }

  async function handleResetPassword(id: string) {
    try {
      const data = await api.resetPassword(id);
      setCredentialInfo({ id: data.id, password: data.password, title: "密码已重置" });
    } catch (err) {
      alert(err instanceof Error ? err.message : "重置失败");
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users size={24} className="text-primary" />
          <h1 className="text-2xl font-bold">用户管理</h1>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} />
          添加用户
        </Button>
      </div>

      <Card>
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">加载中...</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">暂无用户</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户 ID</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.id}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                      {u.role === "admin" ? "管理员" : "用户"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString("zh-CN")}
                  </TableCell>
                  <TableCell className="text-right">
                    {u.role !== "admin" && (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => handleResetPassword(u.id)}
                          title="重置密码"
                        >
                          <RotateCcw size={15} />
                        </Button>
                        {deleteConfirm === u.id ? (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => handleDelete(u.id)}
                            >
                              确认删除
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setDeleteConfirm(null)}
                            >
                              取消
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteConfirm(u.id)}
                            title="删除用户"
                          >
                            <Trash2 size={15} />
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* 添加用户弹窗 */}
      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id, password) => {
          setCreateOpen(false);
          setCredentialInfo({ id, password, title: "用户创建成功" });
          loadUsers();
        }}
      />

      {/* 凭证展示弹窗 */}
      <CredentialDialog
        info={credentialInfo}
        onClose={() => setCredentialInfo(null)}
      />
    </div>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string, password: string) => void;
}) {
  const [userId, setUserId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api.createUser(userId);
      setUserId("");
      onCreated(data.id, data.password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加用户</DialogTitle>
          <DialogDescription>输入用户 ID，系统将自动生成初始密码。</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-sm bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="new-user-id">用户 ID</Label>
            <Input
              id="new-user-id"
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="请输入用户登录名"
              required
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CredentialDialog({
  info,
  onClose,
}: {
  info: { id: string; password: string; title: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!info) return null;

  function handleCopy() {
    navigator.clipboard.writeText(`用户名: ${info!.id}\n密码: ${info!.password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={!!info} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{info.title}</DialogTitle>
          <DialogDescription>请复制并妥善保管密码，关闭后将无法再次查看。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="p-4 bg-muted rounded-lg font-mono text-sm space-y-1.5">
            <p>
              <span className="text-muted-foreground">用户名：</span>
              <span className="font-semibold">{info.id}</span>
            </p>
            <p>
              <span className="text-muted-foreground">密　码：</span>
              <span className="font-semibold">{info.password}</span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCopy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "已复制" : "复制"}
            </Button>
            <Button onClick={onClose}>确定</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
