import { useState, useEffect } from "react";
import { api, type Workspace } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GitBranch, Plus, Check, X, Loader2 } from "lucide-react";

interface BranchSelectorProps {
  workspace: Workspace;
  onBranchChanged: () => void;
}

interface RepoBranch {
  repoName: string;
  branches: string[];
  current: string;
  loading: boolean;
}

export default function BranchSelector({ workspace, onBranchChanged }: BranchSelectorProps) {
  const [repos, setRepos] = useState<RepoBranch[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState("");

  useEffect(() => {
    if (workspace.sync_status === "none") return;

    const initial: RepoBranch[] = workspace.repos.map((r) => ({
      repoName: r.name,
      branches: [r.branch],
      current: r.branch,
      loading: true,
    }));
    setRepos(initial);

    workspace.repos.forEach((repo, index) => {
      api
        .getBranches(workspace.id, repo.name)
        .then((data) => {
          setRepos((prev) =>
            prev.map((s, i) =>
              i === index
                ? { ...s, branches: data.branches, current: data.current, loading: false }
                : s
            )
          );
        })
        .catch(() => {
          setRepos((prev) =>
            prev.map((s, i) => (i === index ? { ...s, loading: false } : s))
          );
        });
    });
  }, [workspace.id, workspace.sync_status, workspace.status]);

  async function handleSwitch(repoName: string, branch: string) {
    setSwitching(repoName);
    setError(null);
    try {
      await api.checkout(workspace.id, repoName, branch);
      onBranchChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换分支失败");
    } finally {
      setSwitching(null);
    }
  }

  async function handleCreate(repoName: string) {
    if (!newBranchName.trim()) {
      setError("请输入分支名");
      return;
    }
    setSwitching(repoName);
    setError(null);
    try {
      await api.checkout(workspace.id, repoName, newBranchName.trim(), true, baseBranch || undefined);
      setCreating(null);
      setNewBranchName("");
      setBaseBranch("");
      onBranchChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "新建分支失败");
    } finally {
      setSwitching(null);
    }
  }

  if (workspace.sync_status === "none" || repos.length === 0) return null;

  return (
    <div className="flex items-center gap-3">
      {repos.map((repo) => (
        <div key={repo.repoName} className="flex items-center gap-1.5">
          {repo.loading ? (
            <Loader2 size={13} className="animate-spin text-muted-foreground" />
          ) : creating === repo.repoName ? (
            /* New branch creation */
            <>
              <GitBranch size={13} className="text-muted-foreground shrink-0" />
              {repos.length > 1 && <span className="text-xs text-muted-foreground">{repo.repoName}</span>}
              <select
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                className="h-7 w-28 rounded border border-input bg-transparent px-1.5 text-xs"
              >
                {repo.branches.map((b) => (
                  <option key={b} value={b}>
                    {b} {b === repo.current ? "(当前)" : ""}
                  </option>
                ))}
              </select>
              <Input
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="新分支名"
                className="h-7 w-32 text-xs"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate(repo.repoName);
                  if (e.key === "Escape") { setCreating(null); setNewBranchName(""); setError(null); }
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                disabled={switching === repo.repoName}
                onClick={() => handleCreate(repo.repoName)}
              >
                {switching === repo.repoName ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => { setCreating(null); setNewBranchName(""); setError(null); }}
              >
                <X size={12} />
              </Button>
            </>
          ) : (
            /* Branch select */
            <>
              <GitBranch size={13} className="text-muted-foreground shrink-0" />
              {repos.length > 1 && <span className="text-xs text-muted-foreground">{repo.repoName}</span>}
              <select
                value={repo.current}
                disabled={switching === repo.repoName}
                onChange={(e) => handleSwitch(repo.repoName, e.target.value)}
                className="h-7 max-w-40 rounded border border-input bg-transparent px-1.5 text-xs disabled:opacity-50"
              >
                {repo.branches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              {switching === repo.repoName && (
                <Loader2 size={13} className="animate-spin text-muted-foreground" />
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                title="新建分支"
                onClick={() => {
                  setCreating(repo.repoName);
                  setBaseBranch(repo.current);
                  setNewBranchName("");
                  setError(null);
                }}
              >
                <Plus size={12} />
              </Button>
            </>
          )}
        </div>
      ))}
      {error && (
        <span className="text-xs text-destructive">{error}</span>
      )}
    </div>
  );
}
