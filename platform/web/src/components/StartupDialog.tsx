import { useState, useEffect } from "react";
import { api, type Workspace } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { GitBranch, Loader2 } from "lucide-react";

interface StartupDialogProps {
  workspace: Workspace | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: () => void;
}

interface RepoBranchState {
  repoName: string;
  branches: string[];
  current: string;
  selected: string;
  newBranch: string;
  isNew: boolean;
  loading: boolean;
}

export default function StartupDialog({
  workspace,
  open,
  onOpenChange,
  onStarted,
}: StartupDialogProps) {
  const [repoStates, setRepoStates] = useState<RepoBranchState[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !workspace) return;

    setError("");
    setStarting(false);

    // Load branches for each repo (uses temp container, workspace stays stopped)
    const states: RepoBranchState[] = workspace.repos.map((r) => ({
      repoName: r.name,
      branches: [r.branch],
      current: r.branch,
      selected: r.branch,
      newBranch: "",
      isNew: false,
      loading: true,
    }));
    setRepoStates(states);

    workspace.repos.forEach((repo, index) => {
      api
        .getBranches(workspace.id, repo.name)
        .then((data) => {
          setRepoStates((prev) =>
            prev.map((s, i) =>
              i === index
                ? { ...s, branches: data.branches, current: data.current, selected: data.current, loading: false }
                : s
            )
          );
        })
        .catch(() => {
          setRepoStates((prev) =>
            prev.map((s, i) => (i === index ? { ...s, loading: false } : s))
          );
        });
    });
  }, [open, workspace]);

  function updateRepoState(index: number, updates: Partial<RepoBranchState>) {
    setRepoStates((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...updates } : s))
    );
  }

  async function handleStart() {
    if (!workspace) return;
    setError("");
    setStarting(true);

    try {
      // Start workspace first
      await api.startWorkspace(workspace.id);

      // Wait for container to be ready
      await new Promise((r) => setTimeout(r, 2000));

      // Checkout branches if changed
      for (const repo of repoStates) {
        const targetBranch = repo.isNew ? repo.newBranch : repo.selected;
        if (!targetBranch) {
          setError(`请为 ${repo.repoName} 选择或输入分支`);
          setStarting(false);
          return;
        }

        if (targetBranch !== repo.current || repo.isNew) {
          await api.checkout(workspace.id, repo.repoName, targetBranch, repo.isNew);
        }
      }

      onStarted();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动失败");
      setStarting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>启动工作空间</DialogTitle>
          <DialogDescription>选择每个仓库的工作分支</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-3 text-sm bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {repoStates.map((repo, index) => (
            <div key={repo.repoName} className="space-y-2">
              <div className="flex items-center gap-2">
                <GitBranch size={14} className="text-muted-foreground" />
                <Label className="font-medium">{repo.repoName}</Label>
                {repo.loading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
              </div>

              {repo.loading ? (
                <div className="text-sm text-muted-foreground">加载分支列表...</div>
              ) : (
                <div className="space-y-2">
                  <select
                    value={repo.isNew ? "__new__" : repo.selected}
                    onChange={(e) => {
                      if (e.target.value === "__new__") {
                        updateRepoState(index, { isNew: true });
                      } else {
                        updateRepoState(index, { selected: e.target.value, isNew: false });
                      }
                    }}
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {repo.branches.map((b) => (
                      <option key={b} value={b}>
                        {b} {b === repo.current ? "（当前）" : ""}
                      </option>
                    ))}
                    <option value="__new__">+ 新建分支</option>
                  </select>

                  {repo.isNew && (
                    <Input
                      value={repo.newBranch}
                      onChange={(e) => updateRepoState(index, { newBranch: e.target.value })}
                      placeholder="输入新分支名"
                      autoFocus
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={starting}>
            取消
          </Button>
          <Button onClick={handleStart} disabled={starting || repoStates.some((r) => r.loading)}>
            {starting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                启动中...
              </>
            ) : (
              "确认启动"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
