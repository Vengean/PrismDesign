import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type AuthMode = "token" | "ssh";

interface GitAuthFieldsProps {
  authMode: AuthMode;
  onAuthModeChange: (mode: AuthMode) => void;
  gitAccessToken: string;
  onGitAccessTokenChange: (value: string) => void;
  gitSshKey: string;
  onGitSshKeyChange: (value: string) => void;
  gitSshPort: number;
  onGitSshPortChange: (value: number) => void;
}

export default function GitAuthFields({
  authMode,
  onAuthModeChange,
  gitAccessToken,
  onGitAccessTokenChange,
  gitSshKey,
  onGitSshKeyChange,
  gitSshPort,
  onGitSshPortChange,
}: GitAuthFieldsProps) {
  return (
    <div className="space-y-3">
      <Label>Git 认证方式</Label>
      <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
        <button
          type="button"
          className={cn(
            "px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer",
            authMode === "token"
              ? "bg-background shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => onAuthModeChange("token")}
        >
          Access Token
        </button>
        <button
          type="button"
          className={cn(
            "px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer",
            authMode === "ssh"
              ? "bg-background shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => onAuthModeChange("ssh")}
        >
          SSH 私钥
        </button>
      </div>

      {authMode === "token" ? (
        <div className="space-y-2">
          <Input
            type="password"
            value={gitAccessToken}
            onChange={(e) => onGitAccessTokenChange(e.target.value)}
            placeholder="粘贴 Personal Access Token"
          />
          <p className="text-xs text-muted-foreground">
            仓库地址需使用 HTTPS 格式，支持 GitHub / GitLab Token
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <textarea
              value={gitSshKey}
              onChange={(e) => onGitSshKeyChange(e.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
              rows={4}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 resize-y font-mono"
            />
            <p className="text-xs text-muted-foreground">
              仓库地址需使用 SSH 格式（git@...），粘贴完整的私钥内容
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">SSH 端口</Label>
            <Input
              type="number"
              value={gitSshPort}
              onChange={(e) => onGitSshPortChange(parseInt(e.target.value) || 22)}
              placeholder="22"
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              默认 22，部分 GitLab 使用自定义端口
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
