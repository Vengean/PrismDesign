import {toast} from '@/components/ui/toast';
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export default function ChangePassword() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }

    if (newPassword.length < 6) {
      setError("密码长度不能少于 6 位");
      return;
    }

    setLoading(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      toast.success("密码修改成功");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-container mx-auto max-w-xl">
      <h1 className="page-heading mb-3">账号安全</h1><p className="page-caption mb-8">管理你的登录密码。</p>

      <Card className="rounded-xl border bg-white shadow-none">
        <CardHeader>
          <CardTitle>更新密码</CardTitle>
          <CardDescription>请输入当前密码和新密码</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="form-stack">
            {error && (
              <div className="p-3 text-sm bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
                {error}
              </div>
            )}

            <div className="form-field">
              <Label htmlFor="old-password">当前密码</Label>
              <Input
                id="old-password"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="请输入当前密码"
                required
              />
            </div>

            <div className="form-field">
              <Label htmlFor="new-password">新密码</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 6 位"
                required
                minLength={6}
              />
            </div>

            <div className="form-field">
              <Label htmlFor="confirm-password">确认新密码</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入新密码"
                required
                minLength={6}
              />
            </div>

            <Button type="submit" className="w-full rounded-md" disabled={loading}>
              {loading ? "修改中..." : "确认修改"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
