import { randomUUID } from "node:crypto";
import {
  AgentEvent,
  ChangedFile,
  DiffSummary,
  DiffSummarySchema,
  GitHubHealth,
  Issue,
  ReviewArtifactSnapshot,
  ReviewArtifactSnapshotSchema,
  Run,
  WorkspaceInfo,
  WorkflowConfig,
} from "@symphonia/types";
import {
  createGitHubClient,
  GitHubClientError,
  GitHubFetch,
  GitHubRestClient,
} from "./github-client.js";
import { inspectGitRepository } from "./git-inspector.js";
import { nowIso } from "./time.js";

export type ReviewArtifactRefreshOptions = {
  run: Run;
  issue: Issue;
  workspace: WorkspaceInfo | null;
  workflowConfig: WorkflowConfig;
  githubFetch?: GitHubFetch;
  githubClient?: GitHubRestClient | null;
  signal?: AbortSignal;
};

export type ReviewArtifactRefreshResult = {
  snapshot: ReviewArtifactSnapshot;
  events: AgentEvent[];
  health: GitHubHealth | null;
};

export async function refreshReviewArtifacts(
  options: ReviewArtifactRefreshOptions,
): Promise<ReviewArtifactRefreshResult> {
  const refreshedAt = nowIso();
  const events: AgentEvent[] = [];
  const config = options.workflowConfig.github;
  const workspacePath = options.workspace?.path ?? options.workflowConfig.workspace.root;
  const local = await inspectGitRepository(workspacePath, {
    remoteName: config.remoteName,
    defaultBaseBranch: config.defaultBaseBranch,
  });

  events.push(
    event(options.run.id, "github.repo.detected", refreshedAt, { git: local.git }),
    event(options.run.id, "git.status.checked", refreshedAt, { git: local.git }),
    event(options.run.id, "git.diff.generated", refreshedAt, { diff: local.diff }),
  );

  let pr = null;
  let commitStatus = null;
  let checks: ReviewArtifactSnapshot["checks"] = [];
  let workflowRuns: ReviewArtifactSnapshot["workflowRuns"] = [];
  let diff = local.diff;
  let error: string | null = null;
  let health: GitHubHealth | null = null;

  if (!config.enabled) {
    const snapshot = makeSnapshot(options, local.git, pr, diff, checks, commitStatus, workflowRuns, refreshedAt, null);
    events.push(event(options.run.id, "github.review_artifacts.refreshed", refreshedAt, { snapshot }));
    return { snapshot, events, health };
  }

  const client = options.githubClient ?? createGitHubClient(config, options.githubFetch);
  if (!client) {
    error = config.token ? "GitHub owner/repo is not configured; local artifacts only." : "GitHub token is not configured; local artifacts only.";
    health = {
      enabled: true,
      healthy: false,
      checkedAt: refreshedAt,
      error,
      rateLimit: null,
    };
    events.push(
      event(options.run.id, "github.health.checked", refreshedAt, {
        healthy: false,
        status: "unavailable",
        error,
      }),
    );
    const snapshot = makeSnapshot(options, local.git, pr, diff, checks, commitStatus, workflowRuns, refreshedAt, error);
    events.push(event(options.run.id, "github.review_artifacts.refreshed", refreshedAt, { snapshot }));
    return { snapshot, events, health };
  }

  try {
    health = await client.healthCheck(options.signal);
    events.push(
      event(options.run.id, "github.health.checked", refreshedAt, {
        healthy: true,
        status: "healthy",
        message: "GitHub repository is reachable.",
      }),
    );

    const branch = local.git.currentBranch;
    const prs = branch ? await client.listPullRequests({ headBranch: branch, state: "all", signal: options.signal }) : [];
    pr = prs[0] ?? null;
    if (pr) {
      events.push(event(options.run.id, "github.pr.found", refreshedAt, { pr }));
      const prFiles = await client.listPullRequestFiles(pr.number, options.signal);
      events.push(event(options.run.id, "github.pr.files.fetched", refreshedAt, { fileCount: prFiles.length }));
      diff = combineDiffSummaries(local.diff, {
        filesChanged: prFiles.length,
        additions: prFiles.reduce((total, file) => total + file.additions, 0),
        deletions: prFiles.reduce((total, file) => total + file.deletions, 0),
        files: prFiles,
      });
    } else {
      events.push(
        event(options.run.id, "github.pr.not_found", refreshedAt, {
          branch,
          message: branch ? `No GitHub PR found for branch ${branch}.` : "No current branch available for PR lookup.",
        }),
      );
    }

    const ref = pr?.headSha ?? local.git.headSha;
    if (ref) {
      commitStatus = await client.getCombinedCommitStatus(ref, options.signal);
      events.push(event(options.run.id, "github.status.fetched", refreshedAt, { commitStatus }));

      checks = await client.listCheckRunsForRef(ref, options.signal);
      events.push(event(options.run.id, "github.checks.fetched", refreshedAt, { checkCount: checks.length }));

      workflowRuns = await client.listWorkflowRuns({ headSha: ref, branch, signal: options.signal });
      events.push(
        event(options.run.id, "github.workflow_runs.fetched", refreshedAt, {
          workflowRunCount: workflowRuns.length,
        }),
      );
    }
  } catch (caught) {
    const normalized = normalizeGithubRefreshError(caught);
    error = normalized.message;
    events.push(
      event(options.run.id, "github.error", refreshedAt, {
        operation: normalized.operation,
        message: normalized.message,
        status: normalized.status,
      }),
    );
    if (!health) {
      health = {
        enabled: true,
        healthy: false,
        checkedAt: refreshedAt,
        error,
        rateLimit: caught instanceof GitHubClientError ? caught.rateLimit : null,
      };
    }
  }

  const snapshot = makeSnapshot(options, local.git, pr, diff, checks, commitStatus, workflowRuns, refreshedAt, error);
  events.push(event(options.run.id, "github.review_artifacts.refreshed", refreshedAt, { snapshot }));
  return { snapshot, events, health };
}

function makeSnapshot(
  options: ReviewArtifactRefreshOptions,
  git: ReviewArtifactSnapshot["git"],
  pr: ReviewArtifactSnapshot["pr"],
  diff: DiffSummary,
  checks: ReviewArtifactSnapshot["checks"],
  commitStatus: ReviewArtifactSnapshot["commitStatus"],
  workflowRuns: ReviewArtifactSnapshot["workflowRuns"],
  refreshedAt: string,
  error: string | null,
): ReviewArtifactSnapshot {
  return ReviewArtifactSnapshotSchema.parse({
    runId: options.run.id,
    issueId: options.run.issueId,
    issueIdentifier: options.run.issueIdentifier,
    provider: options.run.provider,
    trackerKind: options.issue.tracker?.kind ?? options.workflowConfig.tracker.kind,
    workspace: options.workspace,
    git,
    pr,
    diff,
    checks,
    commitStatus,
    workflowRuns,
    lastRefreshedAt: refreshedAt,
    error,
  });
}

function combineDiffSummaries(local: DiffSummary, remote: DiffSummary): DiffSummary {
  const files = [...local.files, ...remote.files].slice(0, 200);
  return DiffSummarySchema.parse({
    filesChanged: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    files,
  });
}

function event<T extends AgentEvent["type"]>(
  runId: string,
  type: T,
  timestamp: string,
  payload: Omit<Extract<AgentEvent, { type: T }>, "id" | "runId" | "timestamp" | "type">,
): Extract<AgentEvent, { type: T }> {
  return {
    id: randomUUID(),
    runId,
    timestamp,
    type,
    ...payload,
  } as Extract<AgentEvent, { type: T }>;
}

function normalizeGithubRefreshError(error: unknown): { operation: string; message: string; status: number | null } {
  if (error instanceof GitHubClientError) {
    return {
      operation: error.code,
      message: error.message,
      status: error.status,
    };
  }
  return {
    operation: "refresh",
    message: error instanceof Error ? error.message : "GitHub review artifact refresh failed.",
    status: null,
  };
}

export function hasGithubWriteAccess(config: WorkflowConfig["github"]): boolean {
  return Boolean(!config.readOnly && config.write.enabled);
}

export function canCreatePr(config: WorkflowConfig["github"]): boolean {
  return hasGithubWriteAccess(config) && config.write.allowCreatePr;
}

export function changedFilesBySource(files: ChangedFile[], source: ChangedFile["source"]): ChangedFile[] {
  return files.filter((file) => file.source === source);
}
