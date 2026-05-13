import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });

export const TrackerKindSchema = z.enum(["mock", "linear"]);
export type TrackerKind = z.infer<typeof TrackerKindSchema>;

export const IssueStateSchema = z.string().min(1);
export type IssueState = z.infer<typeof IssueStateSchema>;

export const IssuePrioritySchema = z.enum(["No priority", "Low", "Medium", "High", "Urgent"]);
export type IssuePriority = z.infer<typeof IssuePrioritySchema>;

export const IssueTrackerMetadataSchema = z.object({
  kind: TrackerKindSchema,
  sourceId: z.string().min(1).nullable().optional(),
  teamId: z.string().min(1).nullable().optional(),
  teamKey: z.string().min(1).nullable().optional(),
  teamName: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  projectName: z.string().min(1).nullable().optional(),
  projectSlug: z.string().min(1).nullable().optional(),
  stateId: z.string().min(1).nullable().optional(),
});
export type IssueTrackerMetadata = z.infer<typeof IssueTrackerMetadataSchema>;

export const IssueSchema = z.object({
  id: z.string().min(1),
  identifier: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  state: IssueStateSchema,
  labels: z.array(z.string()),
  priority: IssuePrioritySchema,
  branchName: z.string().min(1).nullable().optional(),
  blockedBy: z.array(z.string().min(1)).optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  url: z.string().url(),
  tracker: IssueTrackerMetadataSchema.optional(),
  lastFetchedAt: isoDateTime.nullable().optional(),
});
export type Issue = z.infer<typeof IssueSchema>;

export const RunStatusSchema = z.enum([
  "idle",
  "queued",
  "preparing_workspace",
  "building_prompt",
  "launching_agent",
  "streaming",
  "waiting_for_approval",
  "succeeded",
  "failed",
  "timed_out",
  "stalled",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const ProviderIdSchema = z.enum(["mock", "codex", "claude", "cursor"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const terminalRunStatuses: readonly RunStatus[] = [
  "succeeded",
  "failed",
  "timed_out",
  "stalled",
  "cancelled",
];

export function isTerminalRunStatus(status: RunStatus): boolean {
  return terminalRunStatuses.includes(status);
}

export const RunSchema = z.object({
  id: z.string().min(1),
  issueId: z.string().min(1),
  issueIdentifier: z.string().min(1),
  status: RunStatusSchema,
  provider: ProviderIdSchema,
  startedAt: isoDateTime.nullable(),
  endedAt: isoDateTime.nullable(),
  error: z.string().nullable(),
});
export type Run = z.infer<typeof RunSchema>;

const BaseAgentEventSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  timestamp: isoDateTime,
});

export const RunStatusEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("run.status"),
  status: RunStatusSchema,
  message: z.string().optional(),
  error: z.string().optional(),
});

export const AgentMessageEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("agent.message"),
  role: z.enum(["system", "assistant"]),
  message: z.string().min(1),
});

export const ToolCallEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("tool.call"),
  toolName: z.string().min(1),
  command: z.string().optional(),
  status: z.enum(["started", "completed", "failed"]),
  output: z.string().optional(),
});

export const ApprovalDecisionSchema = z.enum(["accept", "acceptForSession", "decline", "cancel", "approved", "rejected"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ApprovalTypeSchema = z.enum(["command", "file_change", "unknown"]);
export type ApprovalType = z.infer<typeof ApprovalTypeSchema>;

export const ApprovalRequestedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("approval.requested"),
  approvalId: z.string().min(1),
  prompt: z.string().min(1),
  approvalType: ApprovalTypeSchema.optional(),
  threadId: z.string().min(1).nullable().optional(),
  turnId: z.string().min(1).nullable().optional(),
  itemId: z.string().min(1).nullable().optional(),
  reason: z.string().nullable().optional(),
  command: z.string().nullable().optional(),
  cwd: z.string().nullable().optional(),
  fileSummary: z.string().nullable().optional(),
  availableDecisions: z.array(ApprovalDecisionSchema).optional(),
});

export const ApprovalResolvedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("approval.resolved"),
  approvalId: z.string().min(1),
  resolution: ApprovalDecisionSchema,
});

export const UsageEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("usage"),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export const ArtifactEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("artifact"),
  artifactType: z.enum(["diff", "log", "file"]),
  title: z.string().min(1),
  content: z.string(),
});

export const TrackerWriteConfigSchema = z.object({
  enabled: z.boolean(),
  commentOnRunStart: z.boolean(),
  commentOnRunComplete: z.boolean(),
  moveToStateOnStart: z.string().min(1).nullable(),
  moveToStateOnSuccess: z.string().min(1).nullable(),
  moveToStateOnFailure: z.string().min(1).nullable(),
});
export type TrackerWriteConfig = z.infer<typeof TrackerWriteConfigSchema>;

export const TrackerConfigSchema = z.object({
  kind: TrackerKindSchema,
  endpoint: z.string().min(1).nullable(),
  apiKey: z.string().min(1).nullable(),
  teamKey: z.string().min(1).nullable(),
  teamId: z.string().min(1).nullable(),
  projectSlug: z.string().min(1).nullable(),
  projectId: z.string().min(1).nullable(),
  allowWorkspaceWide: z.boolean(),
  activeStates: z.array(z.string().min(1)),
  terminalStates: z.array(z.string().min(1)),
  includeArchived: z.boolean(),
  pageSize: z.number().int().positive(),
  maxPages: z.number().int().positive(),
  pollIntervalMs: z.number().int().positive().nullable(),
  readOnly: z.boolean(),
  write: TrackerWriteConfigSchema,
});
export type TrackerConfig = z.infer<typeof TrackerConfigSchema>;

export const PollingConfigSchema = z.object({
  intervalMs: z.number().int().positive(),
});
export type PollingConfig = z.infer<typeof PollingConfigSchema>;

export const WorkspaceConfigSchema = z.object({
  root: z.string().min(1),
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export const HookNameSchema = z.enum(["afterCreate", "beforeRun", "afterRun", "beforeRemove"]);
export type HookName = z.infer<typeof HookNameSchema>;

export const HookStatusSchema = z.enum(["skipped", "running", "succeeded", "failed", "timed_out"]);
export type HookStatus = z.infer<typeof HookStatusSchema>;

export const HooksConfigSchema = z.object({
  afterCreate: z.string().min(1).nullable(),
  beforeRun: z.string().min(1).nullable(),
  afterRun: z.string().min(1).nullable(),
  beforeRemove: z.string().min(1).nullable(),
  timeoutMs: z.number().int().positive(),
});
export type HooksConfig = z.infer<typeof HooksConfigSchema>;

export const AgentConfigSchema = z.object({
  maxConcurrentAgents: z.number().int().positive(),
  maxTurns: z.number().int().positive(),
  maxRetryBackoffMs: z.number().int().nonnegative(),
  maxConcurrentAgentsByState: z.record(z.string(), z.number().int().positive()),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const CodexConfigSchema = z.object({
  command: z.string().min(1),
  model: z.string().min(1).nullable(),
  approvalPolicy: z.string().min(1).nullable(),
  threadSandbox: z.string().min(1).nullable(),
  turnSandboxPolicy: z.string().min(1).nullable(),
  turnTimeoutMs: z.number().int().positive(),
  readTimeoutMs: z.number().int().positive(),
  stallTimeoutMs: z.number().int().positive(),
});
export type CodexConfig = z.infer<typeof CodexConfigSchema>;

const ProviderEnvSchema = z.record(z.string(), z.string());
const CliOutputFormatSchema = z.enum(["text", "json", "stream-json"]);

export const ClaudeConfigSchema = z.object({
  enabled: z.boolean(),
  command: z.string().min(1),
  model: z.string().min(1).nullable(),
  maxTurns: z.number().int().positive(),
  outputFormat: CliOutputFormatSchema,
  permissionMode: z.string().min(1).nullable(),
  allowedTools: z.array(z.string().min(1)),
  disallowedTools: z.array(z.string().min(1)),
  appendSystemPrompt: z.string().min(1).nullable(),
  extraArgs: z.array(z.string().min(1)),
  env: ProviderEnvSchema,
  redactedEnvKeys: z.array(z.string().min(1)),
  healthCheckCommand: z.string().min(1).nullable(),
  timeoutMs: z.number().int().positive(),
  stallTimeoutMs: z.number().int().positive(),
  readTimeoutMs: z.number().int().positive(),
  cwdBehavior: z.enum(["workspace"]),
});
export type ClaudeConfig = z.infer<typeof ClaudeConfigSchema>;

export const CursorConfigSchema = z.object({
  enabled: z.boolean(),
  command: z.string().min(1),
  model: z.string().min(1).nullable(),
  outputFormat: CliOutputFormatSchema,
  force: z.boolean(),
  extraArgs: z.array(z.string().min(1)),
  env: ProviderEnvSchema,
  redactedEnvKeys: z.array(z.string().min(1)),
  healthCheckCommand: z.string().min(1).nullable(),
  timeoutMs: z.number().int().positive(),
  stallTimeoutMs: z.number().int().positive(),
  readTimeoutMs: z.number().int().positive(),
  cwdBehavior: z.enum(["workspace"]),
});
export type CursorConfig = z.infer<typeof CursorConfigSchema>;

export const GitHubWriteConfigSchema = z.object({
  enabled: z.boolean(),
  allowPush: z.boolean(),
  allowCreatePr: z.boolean(),
  allowUpdatePr: z.boolean(),
  allowComment: z.boolean(),
  allowRequestReviewers: z.boolean(),
  draftPrByDefault: z.boolean(),
  prTitleTemplate: z.string(),
  prBodyTemplate: z.string(),
});
export type GitHubWriteConfig = z.infer<typeof GitHubWriteConfigSchema>;

export const GitHubConfigSchema = z.object({
  enabled: z.boolean(),
  endpoint: z.string().min(1),
  token: z.string().min(1).nullable(),
  owner: z.string().min(1).nullable(),
  repo: z.string().min(1).nullable(),
  defaultBaseBranch: z.string().min(1),
  remoteName: z.string().min(1),
  readOnly: z.boolean(),
  write: GitHubWriteConfigSchema,
  pageSize: z.number().int().positive(),
  maxPages: z.number().int().positive(),
});
export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;

export const WorkflowConfigSchema = z.object({
  provider: ProviderIdSchema,
  tracker: TrackerConfigSchema,
  polling: PollingConfigSchema,
  workspace: WorkspaceConfigSchema,
  hooks: HooksConfigSchema,
  agent: AgentConfigSchema,
  codex: CodexConfigSchema,
  claude: ClaudeConfigSchema,
  cursor: CursorConfigSchema,
  github: GitHubConfigSchema,
});
export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;

export const WorkflowDefinitionSchema = z.object({
  config: z.record(z.string(), z.unknown()),
  promptTemplate: z.string(),
  workflowPath: z.string().min(1),
  loadedAt: isoDateTime,
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

export const WorkflowConfigSummarySchema = z.object({
  defaultProvider: ProviderIdSchema,
  trackerKind: TrackerKindSchema,
  endpoint: z.string().min(1).nullable(),
  teamKey: z.string().min(1).nullable(),
  teamId: z.string().min(1).nullable(),
  projectSlug: z.string().min(1).nullable(),
  projectId: z.string().min(1).nullable(),
  allowWorkspaceWide: z.boolean(),
  activeStates: z.array(z.string().min(1)),
  terminalStates: z.array(z.string().min(1)),
  includeArchived: z.boolean(),
  pageSize: z.number().int().positive(),
  maxPages: z.number().int().positive(),
  pollIntervalMs: z.number().int().positive().nullable(),
  readOnly: z.boolean(),
  writeEnabled: z.boolean(),
  workspaceRoot: z.string().min(1),
  maxConcurrentAgents: z.number().int().positive(),
  maxTurns: z.number().int().positive(),
  hookTimeoutMs: z.number().int().positive(),
  codexCommand: z.string().min(1),
  codexModel: z.string().min(1).nullable(),
  providers: z.object({
    mock: z.object({
      enabled: z.boolean(),
      displayName: z.string().min(1),
    }),
    codex: z.object({
      enabled: z.boolean(),
      command: z.string().min(1),
      model: z.string().min(1).nullable(),
    }),
    claude: z.object({
      enabled: z.boolean(),
      command: z.string().min(1),
      model: z.string().min(1).nullable(),
      outputFormat: CliOutputFormatSchema,
      permissionMode: z.string().min(1).nullable(),
      allowedTools: z.array(z.string().min(1)),
      disallowedTools: z.array(z.string().min(1)),
      appendSystemPromptConfigured: z.boolean(),
      extraArgs: z.array(z.string().min(1)),
      envKeys: z.array(z.string().min(1)),
      redactedEnvKeys: z.array(z.string().min(1)),
      timeoutMs: z.number().int().positive(),
      stallTimeoutMs: z.number().int().positive(),
      readTimeoutMs: z.number().int().positive(),
    }),
    cursor: z.object({
      enabled: z.boolean(),
      command: z.string().min(1),
      model: z.string().min(1).nullable(),
      outputFormat: CliOutputFormatSchema,
      force: z.boolean(),
      extraArgs: z.array(z.string().min(1)),
      envKeys: z.array(z.string().min(1)),
      redactedEnvKeys: z.array(z.string().min(1)),
      timeoutMs: z.number().int().positive(),
      stallTimeoutMs: z.number().int().positive(),
      readTimeoutMs: z.number().int().positive(),
    }),
  }),
  github: z.object({
    enabled: z.boolean(),
    endpoint: z.string().min(1),
    owner: z.string().min(1).nullable(),
    repo: z.string().min(1).nullable(),
    defaultBaseBranch: z.string().min(1),
    remoteName: z.string().min(1),
    readOnly: z.boolean(),
    writeEnabled: z.boolean(),
    allowCreatePr: z.boolean(),
    tokenConfigured: z.boolean(),
    pageSize: z.number().int().positive(),
    maxPages: z.number().int().positive(),
  }),
});
export type WorkflowConfigSummary = z.infer<typeof WorkflowConfigSummarySchema>;

export const WorkflowStatusSchema = z.object({
  status: z.enum(["healthy", "missing", "invalid"]),
  workflowPath: z.string().min(1).nullable(),
  loadedAt: isoDateTime.nullable(),
  error: z.string().nullable(),
  effectiveConfigSummary: WorkflowConfigSummarySchema.nullable(),
});
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const WorkspaceInfoSchema = z.object({
  issueIdentifier: z.string().min(1),
  workspaceKey: z.string().min(1),
  path: z.string().min(1),
  createdNow: z.boolean(),
  exists: z.boolean(),
});
export type WorkspaceInfo = z.infer<typeof WorkspaceInfoSchema>;

export const HookRunSchema = z.object({
  hookName: HookNameSchema,
  status: HookStatusSchema,
  command: z.string().min(1).nullable(),
  cwd: z.string().min(1),
  startedAt: isoDateTime.nullable(),
  endedAt: isoDateTime.nullable(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  error: z.string().nullable(),
});
export type HookRun = z.infer<typeof HookRunSchema>;

export const WorkflowLoadedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("workflow.loaded"),
  workflowPath: z.string().min(1),
  loadedAt: isoDateTime,
  configSummary: WorkflowConfigSummarySchema,
});

export const WorkflowInvalidEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("workflow.invalid"),
  workflowPath: z.string().min(1).nullable(),
  code: z.string().min(1),
  error: z.string().min(1),
});

export const WorkspaceReadyEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("workspace.ready"),
  workspace: WorkspaceInfoSchema,
});

export const HookStartedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("hook.started"),
  hook: HookRunSchema,
});

export const HookSucceededEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("hook.succeeded"),
  hook: HookRunSchema,
});

export const HookFailedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("hook.failed"),
  hook: HookRunSchema,
});

export const HookTimedOutEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("hook.timed_out"),
  hook: HookRunSchema,
});

export const PromptRenderedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("prompt.rendered"),
  prompt: z.string(),
});

export const ProviderStartedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("provider.started"),
  provider: ProviderIdSchema,
  command: z.string().min(1),
  pid: z.number().int().positive().nullable(),
});

export const ProviderStderrEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("provider.stderr"),
  provider: ProviderIdSchema,
  message: z.string().min(1),
});

export const GitRepositoryStateSchema = z.object({
  workspacePath: z.string().min(1),
  isGitRepo: z.boolean(),
  remoteUrl: z.string().nullable(),
  remoteName: z.string().min(1),
  currentBranch: z.string().min(1).nullable(),
  baseBranch: z.string().min(1).nullable(),
  headSha: z.string().min(1).nullable(),
  baseSha: z.string().min(1).nullable(),
  mergeBaseSha: z.string().min(1).nullable(),
  isDirty: z.boolean(),
  changedFileCount: z.number().int().nonnegative(),
  untrackedFileCount: z.number().int().nonnegative(),
  stagedFileCount: z.number().int().nonnegative(),
  unstagedFileCount: z.number().int().nonnegative(),
  lastCheckedAt: isoDateTime,
  error: z.string().nullable().optional(),
});
export type GitRepositoryState = z.infer<typeof GitRepositoryStateSchema>;

export const ChangedFileSchema = z.object({
  path: z.string().min(1),
  status: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  isBinary: z.boolean(),
  oldPath: z.string().min(1).nullable(),
  patch: z.string().nullable(),
  source: z.enum(["local", "github_pr", "github_compare"]),
});
export type ChangedFile = z.infer<typeof ChangedFileSchema>;

export const DiffSummarySchema = z.object({
  filesChanged: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  files: z.array(ChangedFileSchema),
});
export type DiffSummary = z.infer<typeof DiffSummarySchema>;

export const PullRequestSummarySchema = z.object({
  id: z.number().int().nonnegative(),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string().url(),
  state: z.string().min(1),
  draft: z.boolean(),
  merged: z.boolean(),
  mergeable: z.boolean().nullable(),
  baseBranch: z.string().min(1),
  headBranch: z.string().min(1),
  headSha: z.string().min(1).nullable(),
  baseSha: z.string().min(1).nullable(),
  author: z.string().min(1).nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type PullRequestSummary = z.infer<typeof PullRequestSummarySchema>;

export const CheckRunSummarySchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1),
  status: z.string().min(1).nullable(),
  conclusion: z.string().nullable(),
  startedAt: isoDateTime.nullable(),
  completedAt: isoDateTime.nullable(),
  url: z.string().url().nullable(),
  detailsUrl: z.string().url().nullable(),
  appName: z.string().min(1).nullable(),
});
export type CheckRunSummary = z.infer<typeof CheckRunSummarySchema>;

export const CommitStatusItemSchema = z.object({
  id: z.number().int().nonnegative().nullable(),
  context: z.string().min(1),
  state: z.string().min(1),
  description: z.string().nullable(),
  targetUrl: z.string().url().nullable(),
  createdAt: isoDateTime.nullable(),
  updatedAt: isoDateTime.nullable(),
});
export type CommitStatusItem = z.infer<typeof CommitStatusItemSchema>;

export const CommitStatusSummarySchema = z.object({
  state: z.string().min(1),
  totalCount: z.number().int().nonnegative(),
  statuses: z.array(CommitStatusItemSchema),
  sha: z.string().min(1).nullable(),
});
export type CommitStatusSummary = z.infer<typeof CommitStatusSummarySchema>;

export const WorkflowRunSummarySchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1),
  status: z.string().min(1).nullable(),
  conclusion: z.string().nullable(),
  event: z.string().min(1).nullable(),
  branch: z.string().min(1).nullable(),
  headSha: z.string().min(1).nullable(),
  url: z.string().url().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  runStartedAt: isoDateTime.nullable(),
});
export type WorkflowRunSummary = z.infer<typeof WorkflowRunSummarySchema>;

export const ReviewArtifactSnapshotSchema = z.object({
  runId: z.string().min(1),
  issueId: z.string().min(1),
  issueIdentifier: z.string().min(1),
  provider: ProviderIdSchema,
  trackerKind: TrackerKindSchema,
  workspace: WorkspaceInfoSchema.nullable(),
  git: GitRepositoryStateSchema,
  pr: PullRequestSummarySchema.nullable(),
  diff: DiffSummarySchema,
  checks: z.array(CheckRunSummarySchema),
  commitStatus: CommitStatusSummarySchema.nullable(),
  workflowRuns: z.array(WorkflowRunSummarySchema),
  lastRefreshedAt: isoDateTime,
  error: z.string().nullable(),
});
export type ReviewArtifactSnapshot = z.infer<typeof ReviewArtifactSnapshotSchema>;

export const GitHubHealthCheckedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.health.checked"),
  healthy: z.boolean(),
  status: z.string().min(1),
  message: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
});

export const GitHubRepoDetectedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.repo.detected"),
  git: GitRepositoryStateSchema,
});

export const GitStatusCheckedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("git.status.checked"),
  git: GitRepositoryStateSchema,
});

export const GitDiffGeneratedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("git.diff.generated"),
  diff: DiffSummarySchema,
});

export const GitHubPrFoundEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.pr.found"),
  pr: PullRequestSummarySchema,
});

export const GitHubPrNotFoundEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.pr.not_found"),
  branch: z.string().min(1).nullable(),
  message: z.string().min(1),
});

export const GitHubPrCreatedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.pr.created"),
  pr: PullRequestSummarySchema,
});

export const GitHubPrFilesFetchedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.pr.files.fetched"),
  fileCount: z.number().int().nonnegative(),
});

export const GitHubStatusFetchedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.status.fetched"),
  commitStatus: CommitStatusSummarySchema,
});

export const GitHubChecksFetchedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.checks.fetched"),
  checkCount: z.number().int().nonnegative(),
});

export const GitHubWorkflowRunsFetchedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.workflow_runs.fetched"),
  workflowRunCount: z.number().int().nonnegative(),
});

export const GitHubReviewArtifactsRefreshedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.review_artifacts.refreshed"),
  snapshot: ReviewArtifactSnapshotSchema,
});

export const GitHubErrorEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.error"),
  operation: z.string().min(1),
  message: z.string().min(1),
  status: z.number().int().positive().nullable().optional(),
});

export const TrackerSyncEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("tracker.sync"),
  tracker: TrackerKindSchema,
  status: z.enum(["started", "succeeded", "failed", "stale"]),
  issueCount: z.number().int().nonnegative().optional(),
  message: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
});

export const TrackerReconciledEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("tracker.reconciled"),
  tracker: TrackerKindSchema,
  issueId: z.string().min(1),
  identifier: z.string().min(1),
  previousState: z.string().min(1).nullable(),
  currentState: z.string().min(1),
  action: z.enum(["kept_running", "stopped_terminal", "stopped_inactive"]),
  message: z.string().min(1),
});

export const CodexThreadStartedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("codex.thread.started"),
  threadId: z.string().min(1),
  model: z.string().min(1).nullable().optional(),
  cwd: z.string().min(1).nullable().optional(),
});

export const CodexTurnStartedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("codex.turn.started"),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  status: z.string().min(1),
});

export const CodexTurnCompletedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("codex.turn.completed"),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  status: z.string().min(1),
  error: z.string().nullable().optional(),
});

export const CodexItemStartedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("codex.item.started"),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  itemId: z.string().min(1),
  itemType: z.string().min(1),
  summary: z.string(),
});

export const CodexItemCompletedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("codex.item.completed"),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  itemId: z.string().min(1),
  itemType: z.string().min(1),
  summary: z.string(),
});

export const CodexAssistantDeltaEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("codex.assistant.delta"),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  itemId: z.string().min(1),
  delta: z.string(),
});

export const CodexUsageEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("codex.usage"),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export const CodexErrorEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("codex.error"),
  message: z.string().min(1),
  code: z.union([z.string(), z.number()]).nullable().optional(),
});

export const ClaudeSystemInitEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("claude.system.init"),
  sessionId: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  cwd: z.string().min(1).nullable(),
  permissionMode: z.string().min(1).nullable(),
});

export const ClaudeAssistantMessageEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("claude.assistant.message"),
  sessionId: z.string().min(1).nullable(),
  message: z.string(),
});

export const ClaudeUserMessageEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("claude.user.message"),
  sessionId: z.string().min(1).nullable(),
  message: z.string(),
});

export const ClaudeToolUseEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("claude.tool.use"),
  sessionId: z.string().min(1).nullable(),
  toolName: z.string().min(1),
  toolUseId: z.string().min(1).nullable(),
  input: z.string(),
});

export const ClaudeToolResultEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("claude.tool.result"),
  sessionId: z.string().min(1).nullable(),
  toolUseId: z.string().min(1).nullable(),
  status: z.string().min(1).nullable(),
  content: z.string(),
});

export const ClaudeResultEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("claude.result"),
  sessionId: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  result: z.string(),
  isError: z.boolean(),
  numTurns: z.number().int().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  totalCostUsd: z.number().nonnegative().nullable(),
});

export const ClaudeUsageEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("claude.usage"),
  sessionId: z.string().min(1).nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
});

export const ClaudeErrorEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("claude.error"),
  sessionId: z.string().min(1).nullable(),
  message: z.string().min(1),
  code: z.union([z.string(), z.number()]).nullable().optional(),
});

export const CursorSystemInitEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("cursor.system.init"),
  sessionId: z.string().min(1).nullable(),
  requestId: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  cwd: z.string().min(1).nullable(),
  permissionMode: z.string().min(1).nullable(),
  apiKeySource: z.string().min(1).nullable(),
});

export const CursorAssistantDeltaEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("cursor.assistant.delta"),
  sessionId: z.string().min(1).nullable(),
  requestId: z.string().min(1).nullable(),
  delta: z.string(),
});

export const CursorAssistantMessageEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("cursor.assistant.message"),
  sessionId: z.string().min(1).nullable(),
  requestId: z.string().min(1).nullable(),
  message: z.string(),
});

export const CursorToolCallEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("cursor.tool.call"),
  sessionId: z.string().min(1).nullable(),
  requestId: z.string().min(1).nullable(),
  callId: z.string().min(1).nullable(),
  toolName: z.string().min(1),
  status: z.enum(["started", "completed", "failed"]),
  input: z.string(),
});

export const CursorToolResultEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("cursor.tool.result"),
  sessionId: z.string().min(1).nullable(),
  requestId: z.string().min(1).nullable(),
  callId: z.string().min(1).nullable(),
  status: z.string().min(1).nullable(),
  content: z.string(),
});

export const CursorResultEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("cursor.result"),
  sessionId: z.string().min(1).nullable(),
  requestId: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  result: z.string(),
  isError: z.boolean(),
  durationMs: z.number().int().nonnegative().nullable(),
  durationApiMs: z.number().int().nonnegative().nullable(),
});

export const CursorUsageEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("cursor.usage"),
  sessionId: z.string().min(1).nullable(),
  requestId: z.string().min(1).nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
});

export const CursorErrorEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("cursor.error"),
  sessionId: z.string().min(1).nullable(),
  requestId: z.string().min(1).nullable(),
  message: z.string().min(1),
  code: z.union([z.string(), z.number()]).nullable().optional(),
});

export const AgentEventSchema = z.discriminatedUnion("type", [
  RunStatusEventSchema,
  AgentMessageEventSchema,
  ToolCallEventSchema,
  ApprovalRequestedEventSchema,
  ApprovalResolvedEventSchema,
  UsageEventSchema,
  ArtifactEventSchema,
  WorkflowLoadedEventSchema,
  WorkflowInvalidEventSchema,
  WorkspaceReadyEventSchema,
  HookStartedEventSchema,
  HookSucceededEventSchema,
  HookFailedEventSchema,
  HookTimedOutEventSchema,
  PromptRenderedEventSchema,
  ProviderStartedEventSchema,
  ProviderStderrEventSchema,
  GitHubHealthCheckedEventSchema,
  GitHubRepoDetectedEventSchema,
  GitStatusCheckedEventSchema,
  GitDiffGeneratedEventSchema,
  GitHubPrFoundEventSchema,
  GitHubPrNotFoundEventSchema,
  GitHubPrCreatedEventSchema,
  GitHubPrFilesFetchedEventSchema,
  GitHubStatusFetchedEventSchema,
  GitHubChecksFetchedEventSchema,
  GitHubWorkflowRunsFetchedEventSchema,
  GitHubReviewArtifactsRefreshedEventSchema,
  GitHubErrorEventSchema,
  TrackerSyncEventSchema,
  TrackerReconciledEventSchema,
  CodexThreadStartedEventSchema,
  CodexTurnStartedEventSchema,
  CodexTurnCompletedEventSchema,
  CodexItemStartedEventSchema,
  CodexItemCompletedEventSchema,
  CodexAssistantDeltaEventSchema,
  CodexUsageEventSchema,
  CodexErrorEventSchema,
  ClaudeSystemInitEventSchema,
  ClaudeAssistantMessageEventSchema,
  ClaudeUserMessageEventSchema,
  ClaudeToolUseEventSchema,
  ClaudeToolResultEventSchema,
  ClaudeResultEventSchema,
  ClaudeUsageEventSchema,
  ClaudeErrorEventSchema,
  CursorSystemInitEventSchema,
  CursorAssistantDeltaEventSchema,
  CursorAssistantMessageEventSchema,
  CursorToolCallEventSchema,
  CursorToolResultEventSchema,
  CursorResultEventSchema,
  CursorUsageEventSchema,
  CursorErrorEventSchema,
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const StartRunRequestSchema = z.object({
  issueId: z.string().min(1),
  provider: ProviderIdSchema.optional(),
});
export type StartRunRequest = z.infer<typeof StartRunRequestSchema>;

export const ApprovalResponseRequestSchema = z.object({
  decision: ApprovalDecisionSchema,
});
export type ApprovalResponseRequest = z.infer<typeof ApprovalResponseRequestSchema>;

export const IssuesResponseSchema = z.object({
  issues: z.array(IssueSchema),
});
export type IssuesResponse = z.infer<typeof IssuesResponseSchema>;

export const TrackerStatusSchema = z.object({
  kind: TrackerKindSchema,
  displayName: z.string().min(1),
  status: z.enum(["healthy", "invalid_config", "unavailable", "stale", "unknown"]),
  config: WorkflowConfigSummarySchema.nullable(),
  lastSyncAt: isoDateTime.nullable(),
  issueCount: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type TrackerStatus = z.infer<typeof TrackerStatusSchema>;

export const TrackerHealthSchema = z.object({
  kind: TrackerKindSchema,
  displayName: z.string().min(1),
  healthy: z.boolean(),
  checkedAt: isoDateTime,
  error: z.string().nullable(),
});
export type TrackerHealth = z.infer<typeof TrackerHealthSchema>;

export const TrackerStatusResponseSchema = z.object({
  tracker: TrackerStatusSchema,
});
export type TrackerStatusResponse = z.infer<typeof TrackerStatusResponseSchema>;

export const TrackerHealthResponseSchema = z.object({
  tracker: TrackerHealthSchema,
});
export type TrackerHealthResponse = z.infer<typeof TrackerHealthResponseSchema>;

export const GitHubStatusSchema = z.object({
  enabled: z.boolean(),
  status: z.enum(["disabled", "healthy", "invalid_config", "unavailable", "stale", "unknown"]),
  config: WorkflowConfigSummarySchema.shape.github.nullable(),
  lastCheckedAt: isoDateTime.nullable(),
  lastArtifactRefreshAt: isoDateTime.nullable(),
  error: z.string().nullable(),
});
export type GitHubStatus = z.infer<typeof GitHubStatusSchema>;

export const GitHubHealthSchema = z.object({
  enabled: z.boolean(),
  healthy: z.boolean(),
  checkedAt: isoDateTime,
  error: z.string().nullable(),
  rateLimit: z
    .object({
      limit: z.number().int().nonnegative().nullable(),
      remaining: z.number().int().nonnegative().nullable(),
      resetAt: isoDateTime.nullable(),
      retryAfterSeconds: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
});
export type GitHubHealth = z.infer<typeof GitHubHealthSchema>;

export const GitHubStatusResponseSchema = z.object({
  github: GitHubStatusSchema,
});
export type GitHubStatusResponse = z.infer<typeof GitHubStatusResponseSchema>;

export const GitHubHealthResponseSchema = z.object({
  github: GitHubHealthSchema,
});
export type GitHubHealthResponse = z.infer<typeof GitHubHealthResponseSchema>;

export const ReviewArtifactResponseSchema = z.object({
  reviewArtifacts: ReviewArtifactSnapshotSchema.nullable(),
});
export type ReviewArtifactResponse = z.infer<typeof ReviewArtifactResponseSchema>;

export const RunsResponseSchema = z.object({
  runs: z.array(RunSchema),
});
export type RunsResponse = z.infer<typeof RunsResponseSchema>;

export const RunResponseSchema = z.object({
  run: RunSchema,
});
export type RunResponse = z.infer<typeof RunResponseSchema>;

export const EventsResponseSchema = z.object({
  events: z.array(AgentEventSchema),
});
export type EventsResponse = z.infer<typeof EventsResponseSchema>;

export const ProviderHealthSchema = z.object({
  id: ProviderIdSchema,
  displayName: z.string().min(1),
  enabled: z.boolean().optional(),
  configured: z.boolean().optional(),
  available: z.boolean(),
  command: z.string().min(1).nullable(),
  model: z.string().min(1).nullable().optional(),
  status: z.enum(["enabled", "disabled", "available", "unavailable", "invalid_config", "unknown"]).optional(),
  version: z.string().nullable(),
  error: z.string().nullable(),
  hint: z.string().nullable(),
  lastCheckedAt: isoDateTime.nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

export const ProvidersResponseSchema = z.object({
  providers: z.array(ProviderHealthSchema),
});
export type ProvidersResponse = z.infer<typeof ProvidersResponseSchema>;

export const ProviderHealthResponseSchema = z.object({
  provider: ProviderHealthSchema,
});
export type ProviderHealthResponse = z.infer<typeof ProviderHealthResponseSchema>;

export const ApprovalStateSchema = z.object({
  approvalId: z.string().min(1),
  runId: z.string().min(1),
  provider: ProviderIdSchema,
  approvalType: ApprovalTypeSchema,
  status: z.enum(["pending", "resolved"]),
  prompt: z.string().min(1),
  threadId: z.string().min(1).nullable(),
  turnId: z.string().min(1).nullable(),
  itemId: z.string().min(1).nullable(),
  reason: z.string().nullable(),
  command: z.string().nullable(),
  cwd: z.string().nullable(),
  fileSummary: z.string().nullable(),
  availableDecisions: z.array(ApprovalDecisionSchema),
  decision: ApprovalDecisionSchema.nullable(),
  requestedAt: isoDateTime,
  resolvedAt: isoDateTime.nullable(),
});
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;

export const ApprovalsResponseSchema = z.object({
  approvals: z.array(ApprovalStateSchema),
});
export type ApprovalsResponse = z.infer<typeof ApprovalsResponseSchema>;

export const WorkflowStatusResponseSchema = z.object({
  workflow: WorkflowStatusSchema,
});
export type WorkflowStatusResponse = z.infer<typeof WorkflowStatusResponseSchema>;

export const WorkflowConfigResponseSchema = z.object({
  config: WorkflowConfigSummarySchema.nullable(),
});
export type WorkflowConfigResponse = z.infer<typeof WorkflowConfigResponseSchema>;

export const WorkspacesResponseSchema = z.object({
  workspaces: z.array(WorkspaceInfoSchema),
});
export type WorkspacesResponse = z.infer<typeof WorkspacesResponseSchema>;

export const WorkspaceResponseSchema = z.object({
  workspace: WorkspaceInfoSchema,
});
export type WorkspaceResponse = z.infer<typeof WorkspaceResponseSchema>;

export const PromptResponseSchema = z.object({
  prompt: z.string().nullable(),
});
export type PromptResponse = z.infer<typeof PromptResponseSchema>;

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  timestamp: isoDateTime,
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
