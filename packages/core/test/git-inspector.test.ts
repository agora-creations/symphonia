import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { inspectGitRepository } from "../src/index";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("git inspector", () => {
  it("handles non-git workspaces gracefully", async () => {
    const workspace = tempDir();

    const result = await inspectGitRepository(workspace, { now: "2026-05-13T10:00:00.000Z" });

    expect(result.git).toMatchObject({
      workspacePath: workspace,
      isGitRepo: false,
      changedFileCount: 0,
    });
    expect(result.git.error).toContain("not a git repository");
    expect(result.diff.files).toEqual([]);
  });

  it("detects a clean repository and branch metadata", async () => {
    const workspace = initRepo();

    const result = await inspectGitRepository(workspace, { defaultBaseBranch: "main", now: "2026-05-13T10:00:00.000Z" });

    expect(result.git).toMatchObject({
      isGitRepo: true,
      currentBranch: "main",
      baseBranch: "main",
      isDirty: false,
      changedFileCount: 0,
      untrackedFileCount: 0,
    });
    expect(result.git.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.git.baseSha).toBe(result.git.headSha);
    expect(result.diff.filesChanged).toBe(0);
  });

  it("summarizes modified files with bounded patches", async () => {
    const workspace = initRepo();
    writeFileSync(join(workspace, "README.md"), "hello\nchanged\n");

    const result = await inspectGitRepository(workspace);

    expect(result.git.isDirty).toBe(true);
    expect(result.git.changedFileCount).toBe(1);
    expect(result.git.unstagedFileCount).toBe(1);
    expect(result.diff).toMatchObject({
      filesChanged: 1,
      additions: 1,
      deletions: 0,
    });
    expect(result.diff.files[0]).toMatchObject({
      path: "README.md",
      status: "M",
      source: "local",
    });
    expect(result.diff.files[0]?.patch).toContain("+changed");
  });

  it("counts untracked files without requiring a patch", async () => {
    const workspace = initRepo();
    writeFileSync(join(workspace, "new-file.ts"), "one\ntwo\n");

    const result = await inspectGitRepository(workspace);

    expect(result.git.isDirty).toBe(true);
    expect(result.git.untrackedFileCount).toBe(1);
    expect(result.diff.files[0]).toMatchObject({
      path: "new-file.ts",
      status: "untracked",
      additions: 2,
      deletions: 0,
      patch: null,
    });
  });

  it("detects feature branches and merge base against the local base branch", async () => {
    const workspace = initRepo();
    git(workspace, ["checkout", "-b", "feature/ENG-1"]);
    writeFileSync(join(workspace, "feature.txt"), "feature\n");
    git(workspace, ["add", "feature.txt"]);
    git(workspace, ["commit", "-m", "Add feature"]);

    const result = await inspectGitRepository(workspace, { defaultBaseBranch: "main" });

    expect(result.git.currentBranch).toBe("feature/ENG-1");
    expect(result.git.headSha).not.toBe(result.git.baseSha);
    expect(result.git.mergeBaseSha).toBe(result.git.baseSha);
    expect(result.git.isDirty).toBe(false);
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "symphonia-git-inspector-"));
  tempDirs.push(dir);
  return dir;
}

function initRepo(): string {
  const workspace = tempDir();
  git(workspace, ["init"]);
  git(workspace, ["config", "user.email", "test@example.com"]);
  git(workspace, ["config", "user.name", "Symphonia Test"]);
  git(workspace, ["branch", "-M", "main"]);
  writeFileSync(join(workspace, "README.md"), "hello\n");
  git(workspace, ["add", "README.md"]);
  git(workspace, ["commit", "-m", "Initial commit"]);
  return workspace;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
}
