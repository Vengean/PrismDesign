import { execSync } from "node:child_process";

export class GitSafety {
  constructor(private projectRoot: string) {}

  /** Check if the project is a git repo */
  isGitRepo(): boolean {
    try {
      execSync("git rev-parse --is-inside-work-tree", {
        cwd: this.projectRoot,
        encoding: "utf-8",
        stdio: "pipe",
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Stash current changes before design edits */
  stash(message?: string): boolean {
    if (!this.isGitRepo()) return false;
    try {
      const label = message || `prism-design-${Date.now()}`;
      execSync(`git stash push -m "${label}"`, {
        cwd: this.projectRoot,
        encoding: "utf-8",
        stdio: "pipe",
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Rollback: restore last stash */
  rollback(): boolean {
    if (!this.isGitRepo()) return false;
    try {
      execSync("git stash pop", {
        cwd: this.projectRoot,
        encoding: "utf-8",
        stdio: "pipe",
      });
      return true;
    } catch {
      // If stash pop fails, do a hard checkout on modified files
      try {
        execSync("git checkout -- .", {
          cwd: this.projectRoot,
          encoding: "utf-8",
          stdio: "pipe",
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  /** Get current git status for context */
  status(): string {
    if (!this.isGitRepo()) return "Not a git repository";
    try {
      return execSync("git status --short", {
        cwd: this.projectRoot,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch {
      return "Unable to get git status";
    }
  }
}
