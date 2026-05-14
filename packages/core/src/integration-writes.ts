import { randomUUID } from "node:crypto";
import { AuthResolvedCredential } from "./auth-manager.js";
import { GitHubClientError, GitHubRestClient } from "./github-client.js";
import { inspectGitRepository } from "./git-inspector.js";
import { LinearGraphqlClient } from "./linear-client.js";
import { PromptTemplateError } from "./prompt-template.js";
import { nowIso } from "./time.js";
import {
  GitHubPrCreateResult,
  GitHubPrCreateResultSchema,
  IntegrationWriteExecutionRequest,
  IntegrationWritePolicy,
  IntegrationWritePolicySchema,
  IntegrationWritePreview,
  IntegrationWritePreviewSchema,
  IntegrationWriteResult,
  IntegrationWriteResultSchema,
  Issue,
  LinearCommentResultSchema,
  ReviewArtifactSnapshot,
  Run,
  WorkflowConfig,
} from "@symphonia/types";

export const githubPrConfirmationPhrase = "CREATE GITHUB PR";
export const linearCommentConfirmationPhrase = "POST LINEAR COMMENT";
const previewTtlMs = 15 * 60 * 1000;
const runMarkerPrefix = "<!-- symphonia-run-id:";

export type GitHubPrPreviewOptions = {
  run: Run;
  issue: Issue;
  workflowConfig: WorkflowConfig;
  reviewArtifacts: ReviewArtifactSnapshot | null;
  credential: AuthResolvedCredential | null;
  githubClient: GitHubRestClient | null;
  titleOverride?: string | null;
  bodyOverride?: string | null;
  draftOverride?: boolean | null;
  baseBranchOverride?: string | null;
  now?: string;
};

export type LinearCommentPreviewOptions = {
  run: Run;
  issue: Issue;
  workflowConfig: WorkflowConfig;
  credential: AuthResolvedCredential | null;
  bodyOverride?: string | null;
  now?: string;
};

export type GitHubPrExecuteOptions = {
  preview: IntegrationWritePreview;
  request: IntegrationWriteExecutionRequest;
  workflowConfig: WorkflowConfig;
  credential: AuthResolvedCredential | null;
  githubClient: GitHubRestClient | null;
  existingResult?: IntegrationWriteResult | null;
  now?: string;
};

export type LinearCommentExecuteOptions = {
  preview: IntegrationWritePreview;
  request: IntegrationWriteExecutionRequest;
  workflowConfig: WorkflowConfig;
  credential: AuthResolvedCredential | null;
  linearClient: LinearGraphqlClient | null;
  existingResult?: IntegrationWriteResult | null;
  now?: string;
};

export function githubWritePolicy(config: WorkflowConfig["github"]): IntegrationWritePolicy {
  return IntegrationWritePolicySchema.parse({
    provider: "github",
    enabled: config.write.enabled,
    readOnly: config.readOnly,
    requireConfirmation: config.write.requireConfirmation,
    allowAutomatic: config.write.allowAutomatic,
    allowedKinds: [
      ...(config.write.allowCreatePr ? ["github_pr_create" as const] : []),
      ...(config.write.allowPush ? ["github_branch_push" as const] : []),
      ...(config.write.allowComment ? ["github_issue_comment" as const] : []),
    ],
    protectedBranches: config.write.protectedBranches,
    confirmationPhrase: config.write.confirmationPhrase || githubPrConfirmationPhrase,
    maxBodyLength: config.write.maxBodyLength,
    maxTitleLength: config.write.maxTitleLength,
  });
}

export function linearWritePolicy(config: WorkflowConfig["tracker"]): IntegrationWritePolicy {
  return IntegrationWritePolicySchema.parse({
    provider: "linear",
    enabled: config.write.enabled,
    readOnly: config.readOnly,
    requireConfirmation: config.write.requireConfirmation,
    allowAutomatic: config.write.allowAutomatic,
    allowedKinds: [
      ...(config.write.allowComments ? ["linear_comment_create" as const] : []),
      ...(config.write.allowStateTransitions ? ["linear_status_update" as const] : []),
    ],
    protectedBranches: [],
    confirmationPhrase: config.write.confirmationPhrase || linearCommentConfirmationPhrase,
    maxBodyLength: config.write.maxBodyLength,
    maxTitleLength: null,
  });
}

export async function buildGitHubPrPreview(options: GitHubPrPreviewOptions): Promise<IntegrationWritePreview> {
  const createdAt = options.now ?? nowIso();
  const config = options.workflowConfig.github;
  const policy = githubWritePolicy(config);
  const credentialSource = options.credential?.source ?? "unavailable";
  const git =
    options.reviewArtifacts?.git ??
    (options.run.workspacePath
      ? (await inspectGitRepository(options.run.workspacePath, {
          remoteName: config.remoteName,
          defaultBaseBranch: config.defaultBaseBranch,
        })).git
      : null);
  const diff = options.reviewArtifacts?.diff ?? {
    filesChanged: 0,
    additions: 0,
    deletions: 0,
    files: [],
  };
  const branch = git?.currentBranch ?? null;
  const baseBranch = options.baseBranchOverride ?? git?.baseBranch ?? config.defaultBaseBranch;
  const headSha = git?.headSha ?? null;
  const existingPr = options.reviewArtifacts?.pr ?? (branch && options.githubClient ? (await findPr(options.githubClient, branch)) : null);
  const warnings: string[] = [];
  const blockers: string[] = [];

  if (!config.enabled) blockers.push("GitHub integration is disabled.");
  if (config.readOnly) blockers.push("GitHub read_only is true.");
  if (!config.write.enabled) blockers.push("GitHub writes are disabled.");
  if (!config.write.allowCreatePr) blockers.push("GitHub PR creation is disabled.");
  if (!options.credential) blockers.push("GitHub credentials are unavailable.");
  if (!config.owner || !config.repo) blockers.push("GitHub owner/repo is not configured.");
  if (!options.run.workspacePath) blockers.push("Run workspace is unavailable.");
  if (!git?.isGitRepo) blockers.push(git?.error ?? "Workspace is not a git repository.");
  if (!branch) blockers.push("Current branch is unavailable.");
  if (branch && isProtectedBranch(branch, config.write.protectedBranches)) blockers.push(`Branch ${branch} is protected and cannot be used as a PR head.`);
  if (branch && branch === baseBranch) blockers.push(`Current branch ${branch} is the base branch; create a throwaway branch first.`);
  if (!headSha) blockers.push("Git head SHA is unavailable.");
  if (existingPr) blockers.push(`Existing PR #${existingPr.number} already exists for ${branch}.`);
  if (!config.write.allowPush && branch && !existingPr) {
    warnings.push("Symphonia will not push branches. The branch must already exist on GitHub before PR creation.");
  }
  if (git?.isDirty) warnings.push("Workspace has local uncommitted or untracked changes.");
  if (diff.filesChanged === 0) warnings.push("No changed files were detected in review artifacts.");

  let title = options.titleOverride ?? "";
  let body = options.bodyOverride ?? "";
  try {
    title ||= renderWriteTemplate(config.write.prTitleTemplate, templateContext(options.run, options.issue, options.reviewArtifacts, options.workflowConfig));
    body ||= renderWriteTemplate(config.write.prBodyTemplate, templateContext(options.run, options.issue, options.reviewArtifacts, options.workflowConfig));
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : "Failed to render GitHub PR template.");
  }
  if (!body.includes(runMarker(options.run.id))) {
    body = `${body.trim()}\n\n${runMarker(options.run.id)}`.trim();
  }
  if (title.length > config.write.maxTitleLength) blockers.push(`PR title exceeds ${config.write.maxTitleLength} characters.`);
  if (body.length > config.write.maxBodyLength) blockers.push(`PR body exceeds ${config.write.maxBodyLength} characters.`);

  const preview = IntegrationWritePreviewSchema.parse({
    id: `github-pr-${options.run.id}-${randomUUID()}`,
    provider: "github",
    kind: "github_pr_create",
    runId: options.run.id,
    issueId: options.issue.id,
    issueIdentifier: options.issue.identifier,
    status: blockers.length > 0 ? "blocked" : "pending_confirmation",
    title: "GitHub draft pull request",
    summary: `Draft PR for ${options.issue.identifier}`,
    bodyPreview: body,
    target: {
      provider: "github",
      owner: config.owner,
      repo: config.repo,
      issueId: options.issue.id,
      issueIdentifier: options.issue.identifier,
      branch,
      baseBranch,
      url: existingPr?.url ?? null,
    },
    credentialSource,
    requiredPermissions: ["Pull requests: write"],
    warnings,
    blockers,
    confirmationRequired: policy.requireConfirmation,
    confirmationPhrase: policy.confirmationPhrase,
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + previewTtlMs).toISOString(),
    githubPr: {
      runId: options.run.id,
      owner: config.owner,
      repo: config.repo,
      baseBranch,
      headBranch: branch,
      headSha,
      title,
      body,
      draft: options.draftOverride ?? config.write.draftPrByDefault,
      existingPr,
      changedFilesSummary: diff,
      blockers,
      warnings,
    },
    githubBranchPush: null,
    linearComment: null,
  });

  return preview;
}

export function buildLinearCommentPreview(options: LinearCommentPreviewOptions): IntegrationWritePreview {
  const createdAt = options.now ?? nowIso();
  const config = options.workflowConfig.tracker;
  const policy = linearWritePolicy(config);
  const credentialSource = options.credential?.source ?? "unavailable";
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (config.kind !== "linear") blockers.push("Tracker is not Linear.");
  if (config.readOnly) blockers.push("Linear tracker read_only is true.");
  if (!config.write.enabled) blockers.push("Linear writes are disabled.");
  if (!config.write.allowComments) blockers.push("Linear comments are disabled.");
  if (config.write.allowStateTransitions) warnings.push("Linear state transitions are configured but remain unused by this action.");
  if (!options.credential) blockers.push("Linear credentials are unavailable.");
  if (!options.issue.id) blockers.push("Linear issue id is unavailable.");

  let body = options.bodyOverride ?? "";
  try {
    body ||= renderWriteTemplate(config.write.runCommentTemplate, templateContext(options.run, options.issue, null, options.workflowConfig));
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : "Failed to render Linear comment template.");
  }
  const marker = runMarker(options.run.id);
  if (!body.includes(marker)) {
    body = `${body.trim()}\n\n${marker}`.trim();
  }
  if (body.length > config.write.maxBodyLength) blockers.push(`Linear comment exceeds ${config.write.maxBodyLength} characters.`);

  return IntegrationWritePreviewSchema.parse({
    id: `linear-comment-${options.run.id}-${randomUUID()}`,
    provider: "linear",
    kind: "linear_comment_create",
    runId: options.run.id,
    issueId: options.issue.id,
    issueIdentifier: options.issue.identifier,
    status: blockers.length > 0 ? "blocked" : "pending_confirmation",
    title: "Linear run comment",
    summary: `Comment for ${options.issue.identifier}`,
    bodyPreview: body,
    target: {
      provider: "linear",
      issueId: options.issue.id,
      issueIdentifier: options.issue.identifier,
      url: options.issue.url,
    },
    credentialSource,
    requiredPermissions: ["Linear commentCreate"],
    warnings,
    blockers,
    confirmationRequired: policy.requireConfirmation,
    confirmationPhrase: policy.confirmationPhrase,
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + previewTtlMs).toISOString(),
    githubPr: null,
    githubBranchPush: null,
    linearComment: {
      runId: options.run.id,
      issueId: options.issue.id,
      issueIdentifier: options.issue.identifier,
      issueUrl: options.issue.url,
      body,
      existingCommentHint: null,
      duplicateMarker: marker,
      blockers,
      warnings,
    },
  });
}

export async function executeGitHubPrCreate(options: GitHubPrExecuteOptions): Promise<IntegrationWriteResult> {
  const preview = ensureExecutablePreview(options.preview, options.request, "github_pr_create", "github");
  if (options.existingResult) return options.existingResult;

  const details = preview.githubPr;
  const errors: string[] = [];
  if (!details) errors.push("Preview does not include GitHub PR details.");
  if (!options.githubClient) errors.push("GitHub client is unavailable.");
  if (!options.credential) errors.push("GitHub credentials are unavailable.");
  if (options.workflowConfig.github.readOnly || !options.workflowConfig.github.write.enabled || !options.workflowConfig.github.write.allowCreatePr) {
    errors.push("GitHub PR creation is disabled by workflow configuration.");
  }
  if (details?.headBranch && isProtectedBranch(details.headBranch, options.workflowConfig.github.write.protectedBranches)) {
    errors.push(`Branch ${details.headBranch} is protected.`);
  }
  if (details?.headBranch && options.githubClient) {
    const existing = await findPr(options.githubClient, details.headBranch);
    if (existing) errors.push(`Existing PR #${existing.number} already exists for ${details.headBranch}.`);
  }
  if (errors.length > 0) return failedResult(preview, errors, options.now);
  if (options.request.dryRun) return dryRunResult(preview, options.now);

  try {
    const pr = await options.githubClient!.createPullRequest({
      title: details!.title,
      body: details!.body,
      head: details!.headBranch!,
      base: details!.baseBranch,
      draft: details!.draft,
      writeEnabled: true,
      allowCreatePr: true,
    });
    const githubPr: GitHubPrCreateResult = GitHubPrCreateResultSchema.parse({
      number: pr.number,
      id: pr.id,
      url: pr.url,
      state: pr.state,
      draft: pr.draft,
      title: pr.title,
      baseBranch: pr.baseBranch,
      headBranch: pr.headBranch,
      createdAt: pr.createdAt,
    });
    return IntegrationWriteResultSchema.parse({
      id: `write-result-${randomUUID()}`,
      previewId: preview.id,
      provider: "github",
      kind: "github_pr_create",
      status: "succeeded",
      target: { ...preview.target, url: pr.url },
      externalUrl: pr.url,
      externalId: String(pr.number),
      warnings: preview.warnings,
      errors: [],
      executedAt: options.now ?? nowIso(),
      redactedRequestSummary: {
        runId: preview.runId,
        title: details!.title,
        base: details!.baseBranch,
        head: details!.headBranch,
        draft: details!.draft,
        credentialSource: options.credential!.source,
      },
      redactedResponseSummary: { number: pr.number, url: pr.url, state: pr.state, draft: pr.draft },
      githubPr,
      linearComment: null,
    });
  } catch (error) {
    const message = error instanceof GitHubClientError ? `${error.message}${error.status ? ` (HTTP ${error.status})` : ""}` : error instanceof Error ? error.message : "GitHub PR creation failed.";
    return failedResult(preview, [message], options.now);
  }
}

export async function executeLinearCommentCreate(options: LinearCommentExecuteOptions): Promise<IntegrationWriteResult> {
  const preview = ensureExecutablePreview(options.preview, options.request, "linear_comment_create", "linear");
  if (options.existingResult) return options.existingResult;

  const details = preview.linearComment;
  const errors: string[] = [];
  if (!details) errors.push("Preview does not include Linear comment details.");
  if (!options.linearClient) errors.push("Linear client is unavailable.");
  if (!options.credential) errors.push("Linear credentials are unavailable.");
  if (options.workflowConfig.tracker.readOnly || !options.workflowConfig.tracker.write.enabled || !options.workflowConfig.tracker.write.allowComments) {
    errors.push("Linear comments are disabled by workflow configuration.");
  }
  if (options.workflowConfig.tracker.write.allowStateTransitions) {
    errors.push("Linear state transitions are not supported by this action.");
  }
  if (errors.length > 0) return failedResult(preview, errors, options.now);
  if (options.request.dryRun) return dryRunResult(preview, options.now);

  try {
    const comment = await options.linearClient!.createComment(details!.issueId!, details!.body);
    const createdAt = comment.createdAt ?? options.now ?? nowIso();
    const linearComment = LinearCommentResultSchema.parse({
      id: comment.id,
      url: comment.url,
      bodyPreview: truncate(details!.body, 800),
      createdAt,
    });
    return IntegrationWriteResultSchema.parse({
      id: `write-result-${randomUUID()}`,
      previewId: preview.id,
      provider: "linear",
      kind: "linear_comment_create",
      status: "succeeded",
      target: { ...preview.target, url: comment.url ?? preview.target.url },
      externalUrl: comment.url,
      externalId: comment.id,
      warnings: preview.warnings,
      errors: [],
      executedAt: options.now ?? nowIso(),
      redactedRequestSummary: {
        runId: preview.runId,
        issueIdentifier: details!.issueIdentifier,
        marker: details!.duplicateMarker,
        credentialSource: options.credential!.source,
      },
      redactedResponseSummary: { id: comment.id, url: comment.url },
      githubPr: null,
      linearComment,
    });
  } catch (error) {
    return failedResult(preview, [error instanceof Error ? error.message : "Linear comment creation failed."], options.now);
  }
}

function ensureExecutablePreview(
  preview: IntegrationWritePreview,
  request: IntegrationWriteExecutionRequest,
  expectedKind: IntegrationWritePreview["kind"],
  expectedProvider: IntegrationWritePreview["provider"],
): IntegrationWritePreview {
  if (preview.provider !== expectedProvider || preview.kind !== expectedKind) {
    throw new Error("Preview kind/provider mismatch.");
  }
  if (preview.blockers.length > 0) {
    throw new Error(`Write is blocked: ${preview.blockers.join("; ")}`);
  }
  if (Date.parse(preview.expiresAt) < Date.now()) {
    throw new Error("Write preview has expired.");
  }
  if (preview.confirmationRequired && request.confirmation !== preview.confirmationPhrase) {
    throw new Error(`Confirmation phrase must be: ${preview.confirmationPhrase}`);
  }
  return preview;
}

export function validateIntegrationWriteExecution(
  preview: IntegrationWritePreview,
  request: IntegrationWriteExecutionRequest,
  expectedKind: IntegrationWritePreview["kind"],
  expectedProvider: IntegrationWritePreview["provider"],
): void {
  ensureExecutablePreview(preview, request, expectedKind, expectedProvider);
}

async function findPr(client: GitHubRestClient, branch: string) {
  const existing = await client.listPullRequests({ headBranch: branch, state: "open" });
  return existing[0] ?? null;
}

function failedResult(preview: IntegrationWritePreview, errors: string[], now?: string): IntegrationWriteResult {
  return IntegrationWriteResultSchema.parse({
    id: `write-result-${randomUUID()}`,
    previewId: preview.id,
    provider: preview.provider,
    kind: preview.kind,
    status: "failed",
    target: preview.target,
    externalUrl: null,
    externalId: null,
    warnings: preview.warnings,
    errors,
    executedAt: now ?? nowIso(),
    redactedRequestSummary: { previewId: preview.id, runId: preview.runId, credentialSource: preview.credentialSource },
    redactedResponseSummary: { errors },
    githubPr: null,
    linearComment: null,
  });
}

function dryRunResult(preview: IntegrationWritePreview, now?: string): IntegrationWriteResult {
  return IntegrationWriteResultSchema.parse({
    id: `write-result-${randomUUID()}`,
    previewId: preview.id,
    provider: preview.provider,
    kind: preview.kind,
    status: "cancelled",
    target: preview.target,
    externalUrl: null,
    externalId: null,
    warnings: preview.warnings,
    errors: ["Dry run requested; no external write executed."],
    executedAt: now ?? nowIso(),
    redactedRequestSummary: { previewId: preview.id, runId: preview.runId, dryRun: true, credentialSource: preview.credentialSource },
    redactedResponseSummary: { dryRun: true },
    githubPr: null,
    linearComment: null,
  });
}

function templateContext(
  run: Run,
  issue: Issue,
  reviewArtifacts: ReviewArtifactSnapshot | null,
  workflowConfig: WorkflowConfig,
): Record<string, unknown> {
  return {
    issue,
    run: {
      ...run,
      summary: run.terminalReason ?? run.error ?? run.status,
    },
    provider: { id: run.provider },
    tracker: { kind: workflowConfig.tracker.kind },
    workspace: { path: run.workspacePath },
    git: reviewArtifacts?.git ?? null,
    reviewArtifacts,
    github: {
      owner: workflowConfig.github.owner,
      repo: workflowConfig.github.repo,
      pr: reviewArtifacts?.pr ?? null,
    },
  };
}

function renderWriteTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression: string) => {
    const path = expression.trim();
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(path)) {
      throw new PromptTemplateError(`Unsupported template expression: ${path}.`);
    }
    const value = readPath(context, path);
    if (value === undefined) throw new PromptTemplateError(`Unknown template variable: ${path}.`);
    return stringify(value);
  });
}

function readPath(context: Record<string, unknown>, path: string): unknown {
  let current: unknown = context;
  for (const part of path.split(".")) {
    if (!isRecord(current) || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(stringify).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function runMarker(runId: string): string {
  return `${runMarkerPrefix} ${runId} -->`;
}

function isProtectedBranch(branch: string, protectedBranches: string[]): boolean {
  return protectedBranches.some((candidate) => candidate.toLowerCase() === branch.toLowerCase());
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 15))}\n... truncated ...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
