import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  ChangedFile,
  ChangedFileSchema,
  DiffSummary,
  DiffSummarySchema,
  GitRepositoryState,
  GitRepositoryStateSchema,
} from "@symphonia/types";
import { nowIso } from "./time.js";

const execFileAsync = promisify(execFile);
const defaultTimeoutMs = 5000;
const maxPatchBytesPerFile = 24_000;
const maxPatchBytesTotal = 120_000;

export type GitInspectorOptions = {
  remoteName?: string;
  defaultBaseBranch?: string;
  timeoutMs?: number;
  now?: string;
};

type GitCommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  error: string | null;
};

type PorcelainFile = {
  path: string;
  oldPath: string | null;
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
};

export type GitInspectionResult = {
  git: GitRepositoryState;
  diff: DiffSummary;
};

export async function inspectGitRepository(
  workspacePath: string,
  options: GitInspectorOptions = {},
): Promise<GitInspectionResult> {
  const checkedAt = options.now ?? nowIso();
  const root = resolve(workspacePath);
  const remoteName = options.remoteName ?? "origin";
  const baseBranch = options.defaultBaseBranch ?? "main";
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;

  if (!existsSync(root)) {
    return emptyInspection(root, remoteName, baseBranch, checkedAt, "Workspace path does not exist.");
  }

  const inside = await git(root, ["rev-parse", "--is-inside-work-tree"], timeoutMs);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    return emptyInspection(root, remoteName, baseBranch, checkedAt, inside.error ?? "Workspace is not a git repository.");
  }

  const [remoteUrl, currentBranch, headSha, baseSha, statusResult] = await Promise.all([
    gitValue(root, ["remote", "get-url", remoteName], timeoutMs),
    gitValue(root, ["branch", "--show-current"], timeoutMs),
    gitValue(root, ["rev-parse", "HEAD"], timeoutMs),
    resolveBaseSha(root, remoteName, baseBranch, timeoutMs),
    git(root, ["status", "--porcelain=v1"], timeoutMs),
  ]);
  const mergeBaseSha =
    headSha && baseSha
      ? ((await gitValue(root, ["merge-base", "HEAD", `${remoteName}/${baseBranch}`], timeoutMs)) ??
        (await gitValue(root, ["merge-base", "HEAD", baseBranch], timeoutMs)))
      : null;
  const porcelain = parsePorcelain(statusResult.ok ? statusResult.stdout.trimEnd() : "");
  const numstat = await gitValue(root, ["diff", "--numstat", "HEAD", "--"], timeoutMs, "");
  const stats = parseNumstat(numstat ?? "");
  const files = await buildChangedFiles(root, porcelain, stats, timeoutMs);
  const diff = DiffSummarySchema.parse({
    filesChanged: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    files,
  });

  const gitState = GitRepositoryStateSchema.parse({
    workspacePath: root,
    isGitRepo: true,
    remoteUrl: redactRemoteUrl(remoteUrl),
    remoteName,
    currentBranch: currentBranch || null,
    baseBranch,
    headSha,
    baseSha,
    mergeBaseSha,
    isDirty: files.length > 0,
    changedFileCount: files.length,
    untrackedFileCount: porcelain.filter((file) => file.untracked).length,
    stagedFileCount: porcelain.filter((file) => file.staged).length,
    unstagedFileCount: porcelain.filter((file) => file.unstaged).length,
    lastCheckedAt: checkedAt,
  });

  return { git: gitState, diff };
}

function emptyInspection(
  workspacePath: string,
  remoteName: string,
  baseBranch: string,
  checkedAt: string,
  error: string,
): GitInspectionResult {
  return {
    git: GitRepositoryStateSchema.parse({
      workspacePath,
      isGitRepo: false,
      remoteUrl: null,
      remoteName,
      currentBranch: null,
      baseBranch,
      headSha: null,
      baseSha: null,
      mergeBaseSha: null,
      isDirty: false,
      changedFileCount: 0,
      untrackedFileCount: 0,
      stagedFileCount: 0,
      unstagedFileCount: 0,
      lastCheckedAt: checkedAt,
      error,
    }),
    diff: DiffSummarySchema.parse({
      filesChanged: 0,
      additions: 0,
      deletions: 0,
      files: [],
    }),
  };
}

async function buildChangedFiles(
  cwd: string,
  porcelain: PorcelainFile[],
  stats: Map<string, { additions: number; deletions: number; isBinary: boolean }>,
  timeoutMs: number,
): Promise<ChangedFile[]> {
  let patchBudget = maxPatchBytesTotal;
  const files: ChangedFile[] = [];

  for (const file of porcelain) {
    const stat = stats.get(file.path) ?? stats.get(file.oldPath ?? "") ?? untrackedStats(cwd, file);
    let patch: string | null = null;

    if (!file.untracked && patchBudget > 0) {
      const result = await git(cwd, ["diff", "--patch", "HEAD", "--", file.path], timeoutMs);
      if (result.ok && result.stdout.trim().length > 0) {
        patch = truncate(result.stdout, Math.min(maxPatchBytesPerFile, patchBudget));
        patchBudget -= Buffer.byteLength(patch);
      }
    }

    files.push(
      ChangedFileSchema.parse({
        path: file.path,
        status: file.status,
        additions: stat.additions,
        deletions: stat.deletions,
        isBinary: stat.isBinary,
        oldPath: file.oldPath,
        patch,
        source: "local",
      }),
    );
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function parsePorcelain(output: string): PorcelainFile[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const x = line[0] ?? " ";
      const y = line[1] ?? " ";
      const rawPath = line.slice(3);
      const renamed = rawPath.includes(" -> ") ? rawPath.split(" -> ") : null;
      const path = unquotePath(renamed ? renamed[1]! : rawPath);
      const oldPath = renamed ? unquotePath(renamed[0]!) : null;
      const untracked = x === "?" && y === "?";
      const status = untracked ? "untracked" : x !== " " ? x : y;
      return {
        path,
        oldPath,
        status,
        staged: !untracked && x !== " ",
        unstaged: !untracked && y !== " ",
        untracked,
      };
    });
}

function parseNumstat(output: string): Map<string, { additions: number; deletions: number; isBinary: boolean }> {
  const stats = new Map<string, { additions: number; deletions: number; isBinary: boolean }>();
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const [added, deleted, ...pathParts] = line.split("\t");
    const path = pathParts.join("\t");
    if (!path) continue;
    const isBinary = added === "-" || deleted === "-";
    stats.set(path, {
      additions: isBinary ? 0 : Number.parseInt(added ?? "0", 10),
      deletions: isBinary ? 0 : Number.parseInt(deleted ?? "0", 10),
      isBinary,
    });
  }
  return stats;
}

function untrackedStats(cwd: string, file: PorcelainFile): { additions: number; deletions: number; isBinary: boolean } {
  const path = resolve(cwd, file.path);
  if (!file.untracked || !existsSync(path) || !statSync(path).isFile()) {
    return { additions: 0, deletions: 0, isBinary: false };
  }

  const contents = readFileSync(path);
  const isBinary = contents.includes(0);
  if (isBinary) return { additions: 0, deletions: 0, isBinary: true };
  const text = contents.toString("utf8");
  return {
    additions: text.length === 0 ? 0 : text.split(/\r?\n/).filter((line, index, lines) => line.length > 0 || index < lines.length - 1).length,
    deletions: 0,
    isBinary: false,
  };
}

async function resolveBaseSha(
  cwd: string,
  remoteName: string,
  baseBranch: string,
  timeoutMs: number,
): Promise<string | null> {
  return (
    (await gitValue(cwd, ["rev-parse", `${remoteName}/${baseBranch}`], timeoutMs)) ??
    (await gitValue(cwd, ["rev-parse", baseBranch], timeoutMs))
  );
}

async function gitValue(cwd: string, args: string[], timeoutMs: number, fallback: string | null = null): Promise<string | null> {
  const result = await git(cwd, args, timeoutMs);
  if (!result.ok) return fallback;
  const value = result.stdout.trim();
  return value.length > 0 ? value : fallback;
}

async function git(cwd: string, args: string[], timeoutMs: number): Promise<GitCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    return {
      ok: true,
      stdout: String(stdout),
      stderr: String(stderr),
      error: null,
    };
  } catch (error) {
    const failure = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    return {
      ok: false,
      stdout: String(failure.stdout ?? ""),
      stderr: String(failure.stderr ?? ""),
      error: String(failure.stderr || failure.message || "git command failed").trim(),
    };
  }
}

function redactRemoteUrl(url: string | null): string | null {
  if (!url) return null;
  return url.replace(/(https?:\/\/)([^/@\s]+)@/i, "$1");
}

function unquotePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
  try {
    return JSON.parse(trimmed) as string;
  } catch {
    return trimmed.slice(1, -1);
  }
}

function truncate(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let sliced = value.slice(0, maxBytes);
  while (Buffer.byteLength(sliced) > maxBytes) {
    sliced = sliced.slice(0, -1);
  }
  return `${sliced}\n[diff truncated]`;
}
