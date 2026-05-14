import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { Issue, RunWorkspaceOwnership, RunWorkspaceOwnershipSchema, WorkspaceInfo, WorkspaceInfoSchema } from "@symphonia/types";
import { nowIso } from "./time.js";

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export type PrepareIssueWorkspaceOptions = {
  runId?: string;
  sourceRepoPath?: string;
  remoteName?: string;
  baseBranch?: string;
  targetRepository?: string | null;
  now?: string;
};

export class WorkspaceManager {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  prepareIssueWorkspace(issue: Issue, options: PrepareIssueWorkspaceOptions = {}): WorkspaceInfo {
    if (options.runId && options.sourceRepoPath) {
      const isolated = this.tryPrepareIsolatedGitWorkspace(issue, {
        ...options,
        runId: options.runId,
        sourceRepoPath: options.sourceRepoPath,
      });
      if (isolated) return isolated;
    }

    const workspaceKey = sanitizeWorkspaceKey(issue.identifier);
    const workspacePath = this.workspacePathForKey(workspaceKey);
    this.assertInsideRoot(workspacePath);

    mkdirSync(this.root, { recursive: true });
    const createdNow = !existsSync(workspacePath);
    mkdirSync(workspacePath, { recursive: true });

    return WorkspaceInfoSchema.parse({
      issueIdentifier: issue.identifier,
      workspaceKey,
      path: workspacePath,
      createdNow,
      exists: true,
      workspaceKind: "directory",
      isolationStatus: "legacy_directory",
      prEligibility: "blocked",
      ownership: options.runId
        ? legacyOwnership({
            runId: options.runId,
            issue,
            workspacePath,
            createdAt: options.now ?? nowIso(),
            remoteName: options.remoteName ?? null,
            baseBranch: options.baseBranch ?? null,
            targetRepository: options.targetRepository ?? null,
            reason: "Workspace was prepared as a directory-only legacy workspace because no git-backed source repository was available.",
          })
        : null,
    });
  }

  getIssueWorkspace(issueIdentifier: string): WorkspaceInfo {
    const workspaceKey = sanitizeWorkspaceKey(issueIdentifier);
    const workspacePath = this.workspacePathForKey(workspaceKey);
    this.assertInsideRoot(workspacePath);

    return WorkspaceInfoSchema.parse({
      issueIdentifier,
      workspaceKey,
      path: workspacePath,
      createdNow: false,
      exists: existsSync(workspacePath),
      workspaceKind: "directory",
      isolationStatus: "legacy_directory",
      prEligibility: "blocked",
      ownership: null,
    });
  }

  listExistingWorkspaces(issueIdentifiers: string[] = []): WorkspaceInfo[] {
    const knownIdentifiers = new Map(issueIdentifiers.map((identifier) => [sanitizeWorkspaceKey(identifier), identifier]));
    if (!existsSync(this.root)) return [];

    return readdirSync(this.root)
      .filter((entry) => {
        const path = this.workspacePathForKey(entry);
        return this.isInsideRoot(path) && statSync(path).isDirectory();
      })
      .map((entry) =>
        WorkspaceInfoSchema.parse({
          issueIdentifier: knownIdentifiers.get(entry) ?? entry,
          workspaceKey: entry,
          path: this.workspacePathForKey(entry),
          createdNow: false,
          exists: true,
          workspaceKind: "directory",
          isolationStatus: "legacy_directory",
          prEligibility: "blocked",
          ownership: null,
        }),
      );
  }

  getBeforeRemoveTarget(issueIdentifier: string): WorkspaceInfo {
    return this.getIssueWorkspace(issueIdentifier);
  }

  private workspacePathForKey(workspaceKey: string): string {
    return resolve(join(this.root, workspaceKey));
  }

  private tryPrepareIsolatedGitWorkspace(issue: Issue, options: Required<Pick<PrepareIssueWorkspaceOptions, "runId" | "sourceRepoPath">> & PrepareIssueWorkspaceOptions): WorkspaceInfo | null {
    const preparedAt = options.now ?? nowIso();
    const remoteName = options.remoteName ?? "origin";
    const baseBranch = options.baseBranch ?? "main";
    const sourceRepoPath = canonicalPath(options.sourceRepoPath);
    const sourceRepoGitRoot = gitValue(sourceRepoPath, ["rev-parse", "--show-toplevel"]);

    if (!sourceRepoGitRoot) return null;

    const sourceGitRoot = canonicalPath(sourceRepoGitRoot);
    const effectiveRoot = this.effectiveRootForGitWorkspace(sourceGitRoot);
    const workspaceKey = sanitizeWorkspaceKey(`${issue.identifier}-${options.runId.slice(0, 8)}`);
    const workspacePath = resolve(join(effectiveRoot, workspaceKey));
    const headBranch = safeBranchName(issue.identifier, options.runId);
    const targetRepository = options.targetRepository ?? null;
    const warnings: string[] = [];

    if (effectiveRoot !== this.root) {
      warnings.push(`Configured workspace root is inside the source checkout; using external worktree root ${effectiveRoot}.`);
    }

    if (existsSync(workspacePath)) {
      throw new WorkspaceError(`Isolated workspace already exists for this run: ${workspacePath}`);
    }

    mkdirSync(effectiveRoot, { recursive: true });
    const baseRef = resolveBaseRef(sourceGitRoot, remoteName, baseBranch);
    const baseCommit = gitValue(sourceGitRoot, ["rev-parse", `${baseRef}^{commit}`]) ?? gitValue(sourceGitRoot, ["rev-parse", "HEAD"]);

    try {
      execFileSync("git", ["worktree", "add", "-b", headBranch, workspacePath, baseRef], {
        cwd: sourceGitRoot,
        stdio: "ignore",
      });
    } catch (error) {
      throw new WorkspaceError(error instanceof Error ? `Failed to create isolated git worktree: ${error.message}` : "Failed to create isolated git worktree.");
    }

    const workspaceGitRoot = gitValue(workspacePath, ["rev-parse", "--show-toplevel"]);
    const remoteUrl = gitValue(workspacePath, ["remote", "get-url", remoteName]);
    const normalizedWorkspacePath = canonicalPath(workspacePath);
    const normalizedWorkspaceGitRoot = workspaceGitRoot ? canonicalPath(workspaceGitRoot) : null;
    const blockers: string[] = [];

    if (!normalizedWorkspaceGitRoot) blockers.push("Workspace git top-level could not be resolved.");
    if (normalizedWorkspaceGitRoot && normalizedWorkspaceGitRoot !== normalizedWorkspacePath) {
      blockers.push("Workspace git top-level does not resolve to the workspace path.");
    }
    if (normalizedWorkspaceGitRoot && normalizedWorkspaceGitRoot === sourceGitRoot) {
      blockers.push("Workspace git top-level resolves to the source checkout.");
    }

    const ownership = RunWorkspaceOwnershipSchema.parse({
      workspaceId: `workspace:${options.runId}`,
      runId: options.runId,
      issueId: issue.id,
      issueKey: issue.identifier,
      sourceRepoPath,
      sourceRepoGitRoot: sourceGitRoot,
      workspacePath: normalizedWorkspacePath,
      workspaceGitRoot: normalizedWorkspaceGitRoot,
      workspaceKind: "git_worktree",
      isolationStatus: blockers.length === 0 ? "isolated" : "invalid",
      prEligibility: blockers.length === 0 ? "eligible" : "blocked",
      baseBranch,
      headBranch,
      baseCommit,
      remoteName,
      remoteUrl: redactRemoteUrl(remoteUrl),
      targetRepository,
      createdAt: preparedAt,
      preparedAt,
      owner: "run",
      metadataVersion: 1,
      blockingReasons: blockers,
      warnings,
    });

    return WorkspaceInfoSchema.parse({
      issueIdentifier: issue.identifier,
      workspaceKey,
      path: normalizedWorkspacePath,
      createdNow: true,
      exists: existsSync(normalizedWorkspacePath),
      workspaceId: ownership.workspaceId,
      workspaceKind: ownership.workspaceKind,
      isolationStatus: ownership.isolationStatus,
      prEligibility: ownership.prEligibility,
      ownership,
    });
  }

  private effectiveRootForGitWorkspace(sourceGitRoot: string): string {
    if (isInsideRoot(sourceGitRoot, this.root) || this.root === sourceGitRoot) {
      const sourceSlug = sanitizeWorkspaceKey(`${basename(sourceGitRoot)}-${hashPath(sourceGitRoot).slice(0, 8)}`);
      return resolve(join(dirname(sourceGitRoot), ".symphonia", "workspaces", sourceSlug));
    }
    return this.root;
  }

  private assertInsideRoot(path: string): void {
    if (!this.isInsideRoot(path)) {
      throw new WorkspaceError(`Workspace path escaped configured root: ${path}`);
    }
  }

  private isInsideRoot(path: string): boolean {
    const absolute = resolve(path);
    const rootWithSeparator = this.root.endsWith(sep) ? this.root : `${this.root}${sep}`;
    return absolute === this.root || absolute.startsWith(rootWithSeparator) || !relative(this.root, absolute).startsWith("..");
  }
}

export function sanitizeWorkspaceKey(identifier: string): string {
  const sanitized = identifier.replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : "workspace";
}

function legacyOwnership(input: {
  runId: string;
  issue: Issue;
  workspacePath: string;
  createdAt: string;
  remoteName: string | null;
  baseBranch: string | null;
  targetRepository: string | null;
  reason: string;
}): RunWorkspaceOwnership {
  return RunWorkspaceOwnershipSchema.parse({
    workspaceId: `workspace:${input.runId}`,
    runId: input.runId,
    issueId: input.issue.id,
    issueKey: input.issue.identifier,
    sourceRepoPath: null,
    sourceRepoGitRoot: null,
    workspacePath: resolve(input.workspacePath),
    workspaceGitRoot: null,
    workspaceKind: "directory",
    isolationStatus: "legacy_directory",
    prEligibility: "blocked",
    baseBranch: input.baseBranch,
    headBranch: null,
    baseCommit: null,
    remoteName: input.remoteName,
    remoteUrl: null,
    targetRepository: input.targetRepository,
    createdAt: input.createdAt,
    preparedAt: input.createdAt,
    owner: "run",
    metadataVersion: 1,
    blockingReasons: [input.reason],
    warnings: [],
  });
}

function resolveBaseRef(sourceGitRoot: string, remoteName: string, baseBranch: string): string {
  if (gitValue(sourceGitRoot, ["rev-parse", "--verify", `${remoteName}/${baseBranch}^{commit}`])) {
    return `${remoteName}/${baseBranch}`;
  }
  if (gitValue(sourceGitRoot, ["rev-parse", "--verify", `${baseBranch}^{commit}`])) {
    return baseBranch;
  }
  return "HEAD";
}

function gitValue(cwd: string, args: string[]): string | null {
  try {
    const output = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function safeBranchName(issueIdentifier: string, runId: string): string {
  const issue = issueIdentifier
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `codex/${issue || "run"}-${runId.slice(0, 8)}`;
}

function redactRemoteUrl(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  return remoteUrl
    .replace(/\/\/([^/@:\s]+):([^/@\s]+)@/u, "//[redacted]@")
    .replace(/\/\/(gh[pousr]_[^/@\s]+)@/u, "//[redacted]@");
}

function hashPath(path: string): string {
  return createHash("sha256").update(resolve(path)).digest("hex");
}

function isInsideRoot(root: string, path: string): boolean {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(path);
  const rootWithSeparator = absoluteRoot.endsWith(sep) ? absoluteRoot : `${absoluteRoot}${sep}`;
  return absolutePath === absoluteRoot || absolutePath.startsWith(rootWithSeparator);
}
