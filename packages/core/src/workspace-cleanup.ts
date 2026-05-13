import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  Issue,
  isTerminalRunStatus,
  Run,
  WorkspaceCleanupPlan,
  WorkspaceCleanupPlanSchema,
  WorkspaceCleanupPolicy,
  WorkspaceInventory,
  WorkspaceInventoryItem,
  WorkspaceInventoryItemSchema,
  WorkspaceInventorySchema,
} from "@symphonia/types";
import { inspectGitRepository } from "./git-inspector.js";
import { nowIso } from "./time.js";
import { sanitizeWorkspaceKey } from "./workspace-manager.js";

export type BuildWorkspaceInventoryOptions = {
  workspaceRoot: string;
  runs: Run[];
  issues: Issue[];
  cleanupPolicy: WorkspaceCleanupPolicy;
  now?: string;
  inspectGit?: boolean;
};

export type CleanupPlanOptions = {
  id: string;
  now?: string;
  selectedIdentifiers?: string[];
};

export async function buildWorkspaceInventory(options: BuildWorkspaceInventoryOptions): Promise<WorkspaceInventory> {
  const generatedAt = options.now ?? nowIso();
  const root = resolve(options.workspaceRoot);
  const runByKey = latestRunByWorkspaceKey(options.runs);
  const issueByKey = new Map(options.issues.map((issue) => [sanitizeWorkspaceKey(issue.identifier), issue]));
  const workspaces: WorkspaceInventoryItem[] = [];

  if (!existsSync(root)) {
    return WorkspaceInventorySchema.parse({
      root,
      generatedAt,
      workspaces: [],
      counts: { total: 0, active: 0, protected: 0, candidates: 0 },
    });
  }

  for (const entry of readdirSync(root).sort()) {
    const path = resolve(join(root, entry));
    const relativePath = relative(root, path);
    if (!isInsideRoot(root, path) || relativePath === "" || relativePath.startsWith("..")) continue;

    const lstats = lstatSync(path);
    if (!lstats.isDirectory()) continue;

    const run = runByKey.get(entry) ?? null;
    const issue = issueByKey.get(entry) ?? null;
    const lastModifiedAt = lstats.mtime.toISOString();
    const ageMs = Date.parse(generatedAt) - Date.parse(lastModifiedAt);
    const runAgeMs = run?.updatedAt ? Date.parse(generatedAt) - Date.parse(run.updatedAt) : null;
    const active = Boolean(run && !isTerminalRunStatus(run.status));
    const recent = Boolean(runAgeMs !== null && runAgeMs >= 0 && runAgeMs < options.cleanupPolicy.protectRecentRunsMs);
    const terminalIssue = Boolean(
      issue &&
        options.cleanupPolicy.includeTerminalStates.some(
          (state) => state.toLowerCase() === issue.state.toLowerCase(),
        ),
    );
    const orphanedRun = Boolean(
      run &&
        (run.status === "orphaned" ||
          run.status === "interrupted" ||
          run.recoveryState === "orphaned_on_startup" ||
          run.recoveryState === "interrupted_by_restart"),
    );
    const noMatchingIssue = !issue && !run;
    const git = options.inspectGit === false ? null : await inspectGitRepository(path, { timeoutMs: 1500, now: generatedAt });
    const isDirtyGit = git?.git.isGitRepo ? git.git.isDirty : null;
    const reasons = [
      active ? "active" : null,
      recent ? "recent" : null,
      terminalIssue ? "terminal_issue" : null,
      noMatchingIssue ? "no_matching_issue" : null,
      orphanedRun ? "orphaned_run" : null,
      isDirtyGit ? "dirty_git" : null,
      ageMs >= 0 ? `age_ms:${ageMs}` : null,
    ].filter((reason): reason is string => Boolean(reason));
    const protectedWorkspace =
      (options.cleanupPolicy.protectActive && active) ||
      recent ||
      (options.cleanupPolicy.protectDirtyGit && Boolean(isDirtyGit));
    const cleanupCandidate = (terminalIssue || noMatchingIssue || orphanedRun) && !protectedWorkspace;

    workspaces.push(
      WorkspaceInventoryItemSchema.parse({
        issueIdentifier: run?.issueIdentifier ?? issue?.identifier ?? entry,
        workspaceKey: entry,
        path,
        exists: true,
        lastModifiedAt,
        sizeBytes: estimateDirectorySize(path),
        isGitRepo: git?.git.isGitRepo ?? null,
        isDirtyGit,
        latestRunId: run?.id ?? null,
        latestRunStatus: run?.status ?? null,
        trackerState: issue?.state ?? null,
        active,
        recent,
        terminalIssue,
        noMatchingIssue,
        orphanedRun,
        protected: protectedWorkspace,
        cleanupCandidate,
        reasons,
        lastCheckedAt: generatedAt,
      }),
    );
  }

  return WorkspaceInventorySchema.parse({
    root,
    generatedAt,
    workspaces,
    counts: {
      total: workspaces.length,
      active: workspaces.filter((workspace) => workspace.active).length,
      protected: workspaces.filter((workspace) => workspace.protected).length,
      candidates: workspaces.filter((workspace) => workspace.cleanupCandidate).length,
    },
  });
}

export function planWorkspaceCleanup(
  inventory: WorkspaceInventory,
  policy: WorkspaceCleanupPolicy,
  options: CleanupPlanOptions,
): WorkspaceCleanupPlan {
  const generatedAt = options.now ?? nowIso();
  const selected = new Set((options.selectedIdentifiers ?? []).map((identifier) => identifier.toLowerCase()));
  const candidates: WorkspaceCleanupPlan["candidates"] = [];
  const protectedItems: WorkspaceCleanupPlan["protected"] = [];
  const warnings: string[] = [];

  if (!policy.enabled) warnings.push("cleanup_disabled");
  if (policy.dryRun) warnings.push("dry_run");
  if (policy.requireManualConfirmation) warnings.push("manual_confirmation_required");

  for (const workspace of inventory.workspaces) {
    const candidateReasons = candidateReasonsForWorkspace(workspace, policy, generatedAt, selected);
    const protectionReasons = protectionReasonsForWorkspace(workspace, policy);
    const item = {
      issueIdentifier: workspace.issueIdentifier,
      workspaceKey: workspace.workspaceKey,
      path: workspace.path,
      sizeBytes: workspace.sizeBytes,
      reasons: candidateReasons,
      protectionReasons,
    };

    if (!policy.enabled) {
      protectedItems.push({ ...item, protectionReasons: unique([...protectionReasons, "cleanup_disabled"]) });
      continue;
    }

    if (candidateReasons.length > 0 && protectionReasons.length === 0) {
      candidates.push(item);
    } else {
      protectedItems.push(item);
    }
  }

  const estimated = candidates.some((item) => item.sizeBytes === null)
    ? null
    : candidates.reduce((total, item) => total + (item.sizeBytes ?? 0), 0);

  return WorkspaceCleanupPlanSchema.parse({
    id: options.id,
    generatedAt,
    root: inventory.root,
    enabled: policy.enabled,
    dryRun: policy.dryRun,
    requireManualConfirmation: policy.requireManualConfirmation,
    candidates,
    protected: protectedItems,
    estimatedBytesToDelete: estimated,
    warnings: unique(warnings),
  });
}

export function isInsideWorkspaceRoot(root: string, path: string): boolean {
  return isInsideRoot(resolve(root), resolve(path));
}

function latestRunByWorkspaceKey(runs: Run[]): Map<string, Run> {
  const byKey = new Map<string, Run>();
  const sorted = [...runs].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
  for (const run of sorted) {
    const key = sanitizeWorkspaceKey(run.issueIdentifier);
    if (!byKey.has(key)) byKey.set(key, run);
  }
  return byKey;
}

function candidateReasonsForWorkspace(
  workspace: WorkspaceInventoryItem,
  policy: WorkspaceCleanupPolicy,
  now: string,
  selected: Set<string>,
): string[] {
  const reasons: string[] = [];
  const ageMs = workspace.lastModifiedAt ? Date.parse(now) - Date.parse(workspace.lastModifiedAt) : null;
  const selectedManually =
    selected.has(workspace.issueIdentifier.toLowerCase()) || selected.has(workspace.workspaceKey.toLowerCase());
  if (selectedManually) reasons.push("manual_selection");
  if (workspace.terminalIssue && isOldEnough(ageMs, policy.deleteTerminalAfterMs)) reasons.push("terminal_issue_old_enough");
  if (workspace.noMatchingIssue && isOldEnough(ageMs, policy.deleteOrphanedAfterMs)) reasons.push("orphaned_workspace_old_enough");
  if (workspace.orphanedRun && isOldEnough(ageMs, policy.deleteInterruptedAfterMs)) reasons.push("interrupted_run_old_enough");
  if (isOldEnough(ageMs, policy.maxWorkspaceAgeMs)) reasons.push("max_age_exceeded");
  if (workspace.noMatchingIssue) reasons.push("no_matching_issue");
  return unique(reasons);
}

function protectionReasonsForWorkspace(workspace: WorkspaceInventoryItem, policy: WorkspaceCleanupPolicy): string[] {
  const reasons: string[] = [];
  if (policy.protectActive && workspace.active) reasons.push("active_run");
  if (workspace.recent) reasons.push("recent_run");
  if (policy.protectDirtyGit && workspace.isDirtyGit) reasons.push("dirty_git");
  if (policy.excludeIdentifiers.some((identifier) => sameIdentifier(identifier, workspace))) reasons.push("explicit_exclude");
  if (workspace.path === resolve(workspace.path, "..")) reasons.push("outside_workspace_root");
  if (!workspace.trackerState && !workspace.latestRunId && !workspace.noMatchingIssue) reasons.push("unknown_state");
  return unique(reasons);
}

function sameIdentifier(identifier: string, workspace: WorkspaceInventoryItem): boolean {
  const normalized = identifier.toLowerCase();
  return normalized === workspace.issueIdentifier.toLowerCase() || normalized === workspace.workspaceKey.toLowerCase();
}

function isOldEnough(ageMs: number | null, thresholdMs: number | null): boolean {
  return ageMs !== null && thresholdMs !== null && ageMs >= thresholdMs;
}

function estimateDirectorySize(path: string): number | null {
  try {
    let total = 0;
    for (const entry of readdirSync(path)) {
      const child = join(path, entry);
      const stats = lstatSync(child);
      if (stats.isSymbolicLink()) {
        total += stats.size;
      } else if (stats.isDirectory()) {
        total += estimateDirectorySize(child) ?? 0;
      } else {
        total += stats.size;
      }
    }
    return total;
  } catch {
    return null;
  }
}

function isInsideRoot(root: string, path: string): boolean {
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;
  return path === root || path.startsWith(rootWithSeparator);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
