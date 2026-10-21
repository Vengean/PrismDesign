import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

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
  hasSavedToken?: boolean;
  hasSavedSshKey?: boolean;
  hideModeSelector?: boolean;
  requireCredentials?: boolean;
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
  hasSavedToken = false,
  hasSavedSshKey = false,
  hideModeSelector = false,
  requireCredentials = false,
}: GitAuthFieldsProps) {
  return (
    <Tabs value={authMode} onValueChange={mode => {
      if (mode === "token" || mode === "ssh") onAuthModeChange(mode);
    }} className="space-y-3">
      {!hideModeSelector && <>
        <TabsList aria-label="Git 认证方式">
          <TabsTrigger value="token">Token</TabsTrigger>
          <TabsTrigger value="ssh">SSH</TabsTrigger>
        </TabsList>
      </>}
      <TabsContent value="token" className="space-y-2">
          <Label>访问令牌{requireCredentials && !hasSavedToken && <span className="text-destructive"> *</span>}</Label>
          <Input
            type="password"
            required={requireCredentials && !hasSavedToken}
            aria-label="Git Access Token"
            autoComplete="new-password"
            value={gitAccessToken}
            onChange={(e) => onGitAccessTokenChange(e.target.value)}
            placeholder={hasSavedToken ? "已保存，留空保留原 Token" : "粘贴 Personal Access Token"}
          />
          <p className="text-xs text-muted-foreground">
            仓库地址需使用 HTTPS 格式，支持 GitHub / GitLab Token
          </p>
      </TabsContent>
      <TabsContent value="ssh" className="space-y-3">
          <div className="space-y-2">
            <Label>SSH 私钥{requireCredentials && !hasSavedSshKey && <span className="text-destructive"> *</span>}</Label>
            <textarea
              required={requireCredentials && !hasSavedSshKey}
              aria-label="Git SSH 私钥"
              value={gitSshKey}
              onChange={(e) => onGitSshKeyChange(e.target.value)}
              placeholder={hasSavedSshKey ? "已保存，留空保留原私钥" : "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
              rows={4}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 resize-y font-mono"
            />
            <p className="text-xs text-muted-foreground">
              仓库地址需使用 SSH 格式（git@...），粘贴完整的私钥内容
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">SSH 端口{requireCredentials && <span className="text-destructive"> *</span>}</Label>
            <Input
              type="number"
              required={requireCredentials}
              aria-label="Git SSH 端口"
              min={1}
              max={65535}
              value={gitSshPort}
              onChange={(e) => onGitSshPortChange(parseInt(e.target.value) || 22)}
              placeholder="22"
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              默认 22，部分 GitLab 使用自定义端口
            </p>
          </div>
      </TabsContent>
    </Tabs>
  );
}
