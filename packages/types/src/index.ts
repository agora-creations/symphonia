import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });

export const TrackerKindSchema = z.enum(["linear"]);
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

export const IssueAssigneeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).nullable().optional(),
  email: z.string().email().nullable().optional(),
});
export type IssueAssignee = z.infer<typeof IssueAssigneeSchema>;

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
  assignee: IssueAssigneeSchema.nullable().optional(),
  lastFetchedAt: isoDateTime.nullable().optional(),
});
export type Issue = z.infer<typeof IssueSchema>;

export const RunStatusSchema = z.enum([
  "idle",
  "queued",
  "preparing_workspace",
  "building_prompt",
  "launching_agent",
  "running",
  "streaming",
  "waiting_for_approval",
  "succeeded",
  "failed",
  "timed_out",
  "stalled",
  "cancelled",
  "interrupted",
  "orphaned",
  "recovered",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RecoveryStateSchema = z.enum([
  "none",
  "active",
  "terminal",
  "orphaned_on_startup",
  "interrupted_by_restart",
  "manually_retried",
  "cleanup_candidate",
  "cleanup_protected",
]);
export type RecoveryState = z.infer<typeof RecoveryStateSchema>;

export const ProviderIdSchema = z.enum(["codex", "claude", "cursor"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const terminalRunStatuses: readonly RunStatus[] = [
  "succeeded",
  "failed",
  "timed_out",
  "stalled",
  "cancelled",
  "interrupted",
  "orphaned",
  "recovered",
];

export function isTerminalRunStatus(status: RunStatus): boolean {
  return terminalRunStatuses.includes(status);
}

export const RunSchema = z.object({
  id: z.string().min(1),
  issueId: z.string().min(1),
  issueIdentifier: z.string().min(1),
  issueTitle: z.string().nullable().default(null),
  trackerKind: TrackerKindSchema.default("linear"),
  status: RunStatusSchema,
  provider: ProviderIdSchema,
  attempt: z.number().int().positive().default(1),
  retryOfRunId: z.string().min(1).nullable().default(null),
  workspacePath: z.string().min(1).nullable().default(null),
  renderedPromptId: z.string().min(1).nullable().default(null),
  providerMetadata: z.record(z.string(), z.unknown()).default({}),
  startedAt: isoDateTime.nullable(),
  updatedAt: isoDateTime.nullable().default(null),
  endedAt: isoDateTime.nullable(),
  lastEventAt: isoDateTime.nullable().default(null),
  terminalReason: z.string().nullable().default(null),
  error: z.string().nullable(),
  recoveryState: RecoveryStateSchema.default("none"),
  recoveredAt: isoDateTime.nullable().default(null),
  createdByDaemonInstanceId: z.string().min(1).nullable().default(null),
  lastSeenDaemonInstanceId: z.string().min(1).nullable().default(null),
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

export const RunRecoveredEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("run.recovered"),
  previousStatus: RunStatusSchema,
  newStatus: RunStatusSchema,
  previousDaemonInstanceId: z.string().min(1).nullable(),
  currentDaemonInstanceId: z.string().min(1),
  recoveredAt: isoDateTime,
  reason: z.literal("daemon_startup_recovery"),
  retryAvailable: z.boolean(),
});

export const ApprovalRecoveredEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("approval.recovered"),
  approvalId: z.string().min(1),
  previousStatus: z.literal("pending"),
  newStatus: z.literal("stale"),
  previousDaemonInstanceId: z.string().min(1).nullable(),
  currentDaemonInstanceId: z.string().min(1),
  recoveredAt: isoDateTime,
  reason: z.literal("daemon_startup_recovery"),
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
  requireConfirmation: z.boolean().default(true),
  allowAutomatic: z.boolean().default(false),
  allowComments: z.boolean().default(false),
  allowStateTransitions: z.boolean().default(false),
  commentOnRunStart: z.boolean(),
  commentOnRunComplete: z.boolean(),
  moveToStateOnStart: z.string().min(1).nullable(),
  moveToStateOnSuccess: z.string().min(1).nullable(),
  moveToStateOnFailure: z.string().min(1).nullable(),
  runCommentTemplate: z.string().default("Symphonia run update for {{ issue.identifier }}."),
  confirmationPhrase: z.string().min(1).default("POST LINEAR COMMENT"),
  maxBodyLength: z.number().int().positive().default(12_000),
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

const defaultWorkspaceCleanupPolicy = {
  enabled: false,
  dryRun: true,
  requireManualConfirmation: true,
  deleteTerminalAfterMs: 604_800_000,
  deleteOrphanedAfterMs: 1_209_600_000,
  deleteInterruptedAfterMs: 1_209_600_000,
  maxWorkspaceAgeMs: null,
  maxTotalBytes: null,
  protectActive: true,
  protectRecentRunsMs: 86_400_000,
  protectDirtyGit: true,
  includeTerminalStates: ["Done", "Closed", "Cancelled", "Canceled", "Duplicate"],
  excludeIdentifiers: [],
  includeIdentifiers: [],
};

export const WorkspaceCleanupPolicySchema = z.object({
  enabled: z.boolean(),
  dryRun: z.boolean(),
  requireManualConfirmation: z.boolean(),
  deleteTerminalAfterMs: z.number().int().nonnegative().nullable(),
  deleteOrphanedAfterMs: z.number().int().nonnegative().nullable(),
  deleteInterruptedAfterMs: z.number().int().nonnegative().nullable(),
  maxWorkspaceAgeMs: z.number().int().nonnegative().nullable(),
  maxTotalBytes: z.number().int().nonnegative().nullable(),
  protectActive: z.boolean(),
  protectRecentRunsMs: z.number().int().nonnegative(),
  protectDirtyGit: z.boolean(),
  includeTerminalStates: z.array(z.string().min(1)),
  excludeIdentifiers: z.array(z.string().min(1)),
  includeIdentifiers: z.array(z.string().min(1)),
});
export type WorkspaceCleanupPolicy = z.infer<typeof WorkspaceCleanupPolicySchema>;

export const WorkspaceConfigSchema = z.object({
  root: z.string().min(1),
  cleanup: WorkspaceCleanupPolicySchema.default(defaultWorkspaceCleanupPolicy),
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
  requireConfirmation: z.boolean().default(true),
  allowAutomatic: z.boolean().default(false),
  allowPush: z.boolean(),
  allowCreatePr: z.boolean(),
  allowUpdatePr: z.boolean(),
  allowComment: z.boolean(),
  allowRequestReviewers: z.boolean(),
  draftPrByDefault: z.boolean(),
  protectedBranches: z.array(z.string().min(1)).default(["main", "master", "production"]),
  confirmationPhrase: z.string().min(1).default("CREATE GITHUB PR"),
  maxTitleLength: z.number().int().positive().default(240),
  maxBodyLength: z.number().int().positive().default(60_000),
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

export const AuthProviderIdSchema = z.enum(["github", "linear"]);
export type AuthProviderId = z.infer<typeof AuthProviderIdSchema>;

export const AuthMethodSchema = z.enum([
  "oauth_device",
  "oauth_loopback",
  "oauth_pkce",
  "manual_token",
  "env_token",
  "unavailable",
]);
export type AuthMethod = z.infer<typeof AuthMethodSchema>;

export const AuthConnectionStatusSchema = z.enum([
  "disconnected",
  "connecting",
  "pending_user",
  "connected",
  "refreshing",
  "expired",
  "revoked",
  "failed",
  "unavailable",
]);
export type AuthConnectionStatus = z.infer<typeof AuthConnectionStatusSchema>;

export const TokenStorageKindSchema = z.enum([
  "os_keychain",
  "electron_safe_storage",
  "encrypted_local_file",
  "env",
  "memory",
  "none",
]);
export type TokenStorageKind = z.infer<typeof TokenStorageKindSchema>;

export const AuthCredentialSourceSchema = z.enum(["connected", "env", "manual", "unavailable"]);
export type AuthCredentialSource = z.infer<typeof AuthCredentialSourceSchema>;

export const IntegrationAuthConnectionSchema = z.object({
  id: z.string().min(1),
  provider: AuthProviderIdSchema,
  method: AuthMethodSchema,
  status: AuthConnectionStatusSchema,
  accountLabel: z.string().min(1).nullable(),
  accountId: z.string().min(1).nullable(),
  workspaceLabel: z.string().min(1).nullable(),
  workspaceId: z.string().min(1).nullable(),
  scopes: z.array(z.string().min(1)),
  permissions: z.array(z.string().min(1)),
  tokenStorage: TokenStorageKindSchema,
  tokenExpiresAt: isoDateTime.nullable(),
  refreshTokenExpiresAt: isoDateTime.nullable(),
  connectedAt: isoDateTime.nullable(),
  lastValidatedAt: isoDateTime.nullable(),
  lastError: z.string().min(1).nullable(),
  redactedSource: z.string().min(1),
  credentialSource: AuthCredentialSourceSchema,
  refreshSupported: z.boolean(),
  envTokenPresent: z.boolean().default(false),
  clientIdConfigured: z.boolean().default(false),
  clientSecretConfigured: z.boolean().default(false),
});
export type IntegrationAuthConnection = z.infer<typeof IntegrationAuthConnectionSchema>;

export const AuthRedirectModeSchema = z.enum(["device", "loopback", "manual", "none"]);
export type AuthRedirectMode = z.infer<typeof AuthRedirectModeSchema>;

export const AuthStartRequestSchema = z.object({
  provider: AuthProviderIdSchema,
  method: AuthMethodSchema,
  requestedScopes: z.array(z.string().min(1)).default([]),
  redirectMode: AuthRedirectModeSchema.default("none"),
  repositoryPath: z.string().min(1).nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type AuthStartRequest = z.infer<typeof AuthStartRequestSchema>;

export const AuthStartResultSchema = z.object({
  authSessionId: z.string().min(1),
  provider: AuthProviderIdSchema,
  method: AuthMethodSchema,
  status: AuthConnectionStatusSchema,
  authorizationUrl: z.string().url().nullable(),
  verificationUri: z.string().url().nullable(),
  userCode: z.string().min(1).nullable(),
  expiresAt: isoDateTime.nullable(),
  pollIntervalMs: z.number().int().positive().nullable(),
  instructions: z.array(z.string().min(1)),
});
export type AuthStartResult = z.infer<typeof AuthStartResultSchema>;

export const AuthPollResultSchema = z.object({
  authSessionId: z.string().min(1),
  status: AuthConnectionStatusSchema,
  connection: IntegrationAuthConnectionSchema.nullable(),
  error: z.string().min(1).nullable(),
});
export type AuthPollResult = z.infer<typeof AuthPollResultSchema>;

export const AuthCallbackResultSchema = z.object({
  provider: AuthProviderIdSchema,
  status: AuthConnectionStatusSchema,
  connection: IntegrationAuthConnectionSchema.nullable(),
  error: z.string().min(1).nullable(),
});
export type AuthCallbackResult = z.infer<typeof AuthCallbackResultSchema>;

export const AuthDisconnectRequestSchema = z.object({
  provider: AuthProviderIdSchema,
  deleteStoredToken: z.boolean().default(true),
  revokeRemoteTokenIfSupported: z.boolean().default(false),
});
export type AuthDisconnectRequest = z.infer<typeof AuthDisconnectRequestSchema>;

export const AuthValidationResultSchema = z.object({
  provider: AuthProviderIdSchema,
  status: AuthConnectionStatusSchema,
  account: z
    .object({
      id: z.string().min(1).nullable(),
      label: z.string().min(1).nullable(),
      workspaceId: z.string().min(1).nullable(),
      workspaceLabel: z.string().min(1).nullable(),
    })
    .nullable(),
  scopes: z.array(z.string().min(1)),
  permissions: z.array(z.string().min(1)),
  expiresAt: isoDateTime.nullable(),
  error: z.string().min(1).nullable(),
  credentialSource: AuthCredentialSourceSchema,
  redactedSource: z.string().min(1),
});
export type AuthValidationResult = z.infer<typeof AuthValidationResultSchema>;

export const AuthStatusSchema = z.object({
  providers: z.array(IntegrationAuthConnectionSchema),
  storage: z.object({
    kind: TokenStorageKindSchema,
    available: z.boolean(),
  }),
});
export type AuthStatus = z.infer<typeof AuthStatusSchema>;

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
  write: z
    .object({
      enabled: z.boolean(),
      requireConfirmation: z.boolean(),
      allowAutomatic: z.boolean(),
      allowComments: z.boolean(),
      allowStateTransitions: z.boolean(),
      commentOnRunStart: z.boolean(),
      commentOnRunComplete: z.boolean(),
    })
    .default({
      enabled: false,
      requireConfirmation: true,
      allowAutomatic: false,
      allowComments: false,
      allowStateTransitions: false,
      commentOnRunStart: false,
      commentOnRunComplete: false,
    }),
  workspaceRoot: z.string().min(1),
  workspaceCleanup: z.object({
    enabled: z.boolean(),
    dryRun: z.boolean(),
    requireManualConfirmation: z.boolean(),
    protectActive: z.boolean(),
    protectRecentRunsMs: z.number().int().nonnegative(),
    protectDirtyGit: z.boolean(),
    deleteTerminalAfterMs: z.number().int().nonnegative().nullable(),
    deleteOrphanedAfterMs: z.number().int().nonnegative().nullable(),
    deleteInterruptedAfterMs: z.number().int().nonnegative().nullable(),
    maxWorkspaceAgeMs: z.number().int().nonnegative().nullable(),
    maxTotalBytes: z.number().int().nonnegative().nullable(),
    includeTerminalStates: z.array(z.string().min(1)),
    excludeIdentifiers: z.array(z.string().min(1)),
    includeIdentifiers: z.array(z.string().min(1)),
  }).default(defaultWorkspaceCleanupPolicy),
  maxConcurrentAgents: z.number().int().positive(),
  maxTurns: z.number().int().positive(),
  hookTimeoutMs: z.number().int().positive(),
  codexCommand: z.string().min(1),
  codexModel: z.string().min(1).nullable(),
  providers: z.object({
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
    allowPush: z.boolean().default(false),
    allowComment: z.boolean().default(false),
    draftPrByDefault: z.boolean().default(true),
    requireConfirmation: z.boolean().default(true),
    protectedBranches: z.array(z.string().min(1)).default(["main", "master", "production"]),
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

export const WorkspaceKindSchema = z.enum(["directory", "git_worktree", "git_clone"]);
export type WorkspaceKind = z.infer<typeof WorkspaceKindSchema>;

export const WorkspaceIsolationStatusSchema = z.enum(["isolated", "legacy_directory", "invalid", "missing", "ambiguous"]);
export type WorkspaceIsolationStatus = z.infer<typeof WorkspaceIsolationStatusSchema>;

export const WorkspacePrEligibilitySchema = z.enum(["eligible", "blocked"]);
export type WorkspacePrEligibility = z.infer<typeof WorkspacePrEligibilitySchema>;

export const RunWorkspaceOwnershipSchema = z.object({
  workspaceId: z.string().min(1),
  runId: z.string().min(1),
  issueId: z.string().min(1),
  issueKey: z.string().min(1),
  sourceRepoPath: z.string().min(1).nullable(),
  sourceRepoGitRoot: z.string().min(1).nullable(),
  workspacePath: z.string().min(1),
  workspaceGitRoot: z.string().min(1).nullable(),
  workspaceKind: WorkspaceKindSchema,
  isolationStatus: WorkspaceIsolationStatusSchema,
  prEligibility: WorkspacePrEligibilitySchema,
  baseBranch: z.string().min(1).nullable(),
  headBranch: z.string().min(1).nullable(),
  baseCommit: z.string().min(1).nullable(),
  remoteName: z.string().min(1).nullable(),
  remoteUrl: z.string().min(1).nullable(),
  targetRepository: z.string().min(1).nullable(),
  createdAt: isoDateTime,
  preparedAt: isoDateTime,
  owner: z.literal("run"),
  metadataVersion: z.literal(1),
  blockingReasons: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
});
export type RunWorkspaceOwnership = z.infer<typeof RunWorkspaceOwnershipSchema>;

export const WorkspaceValidationResultSchema = z.object({
  workspaceId: z.string().min(1).nullable(),
  runId: z.string().min(1).nullable(),
  workspacePath: z.string().min(1).nullable(),
  exists: z.boolean(),
  isGitRepository: z.boolean(),
  gitTopLevel: z.string().min(1).nullable(),
  resolvesToMainCheckout: z.boolean(),
  isInsideSourceCheckout: z.boolean(),
  belongsToRun: z.boolean(),
  matchesExpectedRepo: z.boolean(),
  hasOwnershipMetadata: z.boolean(),
  canBeUsedForProviderRun: z.boolean(),
  canBeUsedForPrWrite: z.boolean(),
  workspaceKind: WorkspaceKindSchema.nullable(),
  isolationStatus: WorkspaceIsolationStatusSchema,
  prEligibility: WorkspacePrEligibilitySchema,
  blockingReasons: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
});
export type WorkspaceValidationResult = z.infer<typeof WorkspaceValidationResultSchema>;

export const WorkspaceInfoSchema = z.object({
  issueIdentifier: z.string().min(1),
  workspaceKey: z.string().min(1),
  path: z.string().min(1),
  createdNow: z.boolean(),
  exists: z.boolean(),
  workspaceId: z.string().min(1).nullable().default(null),
  workspaceKind: WorkspaceKindSchema.default("directory"),
  isolationStatus: WorkspaceIsolationStatusSchema.default("legacy_directory"),
  prEligibility: WorkspacePrEligibilitySchema.default("blocked"),
  ownership: RunWorkspaceOwnershipSchema.nullable().default(null),
});
export type WorkspaceInfo = z.infer<typeof WorkspaceInfoSchema>;

export const WorkspaceInventoryItemSchema = z.object({
  issueIdentifier: z.string().min(1),
  workspaceKey: z.string().min(1),
  path: z.string().min(1),
  exists: z.boolean(),
  lastModifiedAt: isoDateTime.nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  isGitRepo: z.boolean().nullable(),
  isDirtyGit: z.boolean().nullable(),
  latestRunId: z.string().min(1).nullable(),
  latestRunStatus: RunStatusSchema.nullable(),
  trackerState: z.string().min(1).nullable(),
  active: z.boolean(),
  recent: z.boolean(),
  terminalIssue: z.boolean(),
  noMatchingIssue: z.boolean(),
  orphanedRun: z.boolean(),
  protected: z.boolean(),
  cleanupCandidate: z.boolean(),
  reasons: z.array(z.string().min(1)),
  lastCheckedAt: isoDateTime,
});
export type WorkspaceInventoryItem = z.infer<typeof WorkspaceInventoryItemSchema>;

export const WorkspaceInventorySchema = z.object({
  root: z.string().min(1),
  generatedAt: isoDateTime,
  workspaces: z.array(WorkspaceInventoryItemSchema),
  counts: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    protected: z.number().int().nonnegative(),
    candidates: z.number().int().nonnegative(),
  }),
});
export type WorkspaceInventory = z.infer<typeof WorkspaceInventorySchema>;

export const CleanupPlanItemSchema = z.object({
  issueIdentifier: z.string().min(1),
  workspaceKey: z.string().min(1),
  path: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().nullable(),
  reasons: z.array(z.string().min(1)),
  protectionReasons: z.array(z.string().min(1)),
});
export type CleanupPlanItem = z.infer<typeof CleanupPlanItemSchema>;

export const WorkspaceCleanupPlanSchema = z.object({
  id: z.string().min(1),
  generatedAt: isoDateTime,
  root: z.string().min(1),
  enabled: z.boolean(),
  dryRun: z.boolean(),
  requireManualConfirmation: z.boolean(),
  candidates: z.array(CleanupPlanItemSchema),
  protected: z.array(CleanupPlanItemSchema),
  estimatedBytesToDelete: z.number().int().nonnegative().nullable(),
  warnings: z.array(z.string().min(1)),
});
export type WorkspaceCleanupPlan = z.infer<typeof WorkspaceCleanupPlanSchema>;

export const WorkspaceCleanupResultSchema = z.object({
  startedAt: isoDateTime,
  completedAt: isoDateTime,
  dryRun: z.boolean(),
  deleted: z.array(CleanupPlanItemSchema),
  skipped: z.array(CleanupPlanItemSchema.extend({ skippedReason: z.string().min(1) })),
  errors: z.array(z.object({ workspaceKey: z.string().min(1), path: z.string().min(1), error: z.string().min(1) })),
  bytesFreed: z.number().int().nonnegative().nullable(),
});
export type WorkspaceCleanupResult = z.infer<typeof WorkspaceCleanupResultSchema>;

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

export const WorkspaceOwnershipRecordedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("workspace.ownership.recorded"),
  ownership: RunWorkspaceOwnershipSchema,
});

export const WorkspaceCleanupPlannedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("workspace.cleanup.planned"),
  plan: WorkspaceCleanupPlanSchema,
});

export const WorkspaceCleanupStartedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("workspace.cleanup.started"),
  workspaceKey: z.string().min(1),
  path: z.string().min(1),
});

export const WorkspaceCleanupSkippedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("workspace.cleanup.skipped"),
  workspaceKey: z.string().min(1),
  path: z.string().min(1),
  reason: z.string().min(1),
});

export const WorkspaceCleanupDeletedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("workspace.cleanup.deleted"),
  workspaceKey: z.string().min(1),
  path: z.string().min(1),
  bytesFreed: z.number().int().nonnegative().nullable(),
});

export const WorkspaceCleanupFailedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("workspace.cleanup.failed"),
  workspaceKey: z.string().min(1),
  path: z.string().min(1),
  error: z.string().min(1),
});

export const WorkspaceCleanupCompletedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("workspace.cleanup.completed"),
  result: WorkspaceCleanupResultSchema,
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

export const AuthStartedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("auth.started"),
  provider: AuthProviderIdSchema,
  method: AuthMethodSchema,
  authSessionId: z.string().min(1),
});

export const AuthPendingUserEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("auth.pending_user"),
  provider: AuthProviderIdSchema,
  method: AuthMethodSchema,
  authSessionId: z.string().min(1),
  verificationUri: z.string().url().nullable(),
});

export const AuthConnectedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("auth.connected"),
  connection: IntegrationAuthConnectionSchema,
});

export const AuthRefreshedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("auth.refreshed"),
  connection: IntegrationAuthConnectionSchema,
});

export const AuthFailedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("auth.failed"),
  provider: AuthProviderIdSchema,
  method: AuthMethodSchema,
  authSessionId: z.string().min(1).nullable(),
  error: z.string().min(1),
});

export const AuthDisconnectedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("auth.disconnected"),
  provider: AuthProviderIdSchema,
  deleteStoredToken: z.boolean(),
});

export const AuthRevokedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("auth.revoked"),
  provider: AuthProviderIdSchema,
});

export const AuthValidationSucceededEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("auth.validation_succeeded"),
  result: AuthValidationResultSchema,
});

export const AuthValidationFailedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("auth.validation_failed"),
  provider: AuthProviderIdSchema,
  error: z.string().min(1),
  credentialSource: AuthCredentialSourceSchema,
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

export const IntegrationWriteProviderSchema = z.enum(["github", "linear"]);
export type IntegrationWriteProvider = z.infer<typeof IntegrationWriteProviderSchema>;

export const IntegrationWriteKindSchema = z.enum([
  "github_pr_create",
  "github_branch_push",
  "github_issue_comment",
  "linear_comment_create",
  "linear_status_update",
]);
export type IntegrationWriteKind = z.infer<typeof IntegrationWriteKindSchema>;

export const IntegrationWriteStatusSchema = z.enum([
  "previewed",
  "blocked",
  "pending_confirmation",
  "executing",
  "succeeded",
  "failed",
  "cancelled",
]);
export type IntegrationWriteStatus = z.infer<typeof IntegrationWriteStatusSchema>;

export const IntegrationWriteTargetSchema = z.object({
  provider: IntegrationWriteProviderSchema,
  owner: z.string().min(1).nullable().default(null),
  repo: z.string().min(1).nullable().default(null),
  issueId: z.string().min(1).nullable().default(null),
  issueIdentifier: z.string().min(1).nullable().default(null),
  branch: z.string().min(1).nullable().default(null),
  baseBranch: z.string().min(1).nullable().default(null),
  url: z.string().url().nullable().default(null),
});
export type IntegrationWriteTarget = z.infer<typeof IntegrationWriteTargetSchema>;

export const IntegrationWritePolicySchema = z.object({
  provider: IntegrationWriteProviderSchema,
  enabled: z.boolean(),
  readOnly: z.boolean(),
  requireConfirmation: z.boolean(),
  allowAutomatic: z.boolean(),
  allowedKinds: z.array(IntegrationWriteKindSchema),
  protectedBranches: z.array(z.string().min(1)),
  confirmationPhrase: z.string().min(1),
  maxBodyLength: z.number().int().positive(),
  maxTitleLength: z.number().int().positive().nullable(),
});
export type IntegrationWritePolicy = z.infer<typeof IntegrationWritePolicySchema>;

const IntegrationWriteBaseSchema = z.object({
  id: z.string().min(1),
  provider: IntegrationWriteProviderSchema,
  kind: IntegrationWriteKindSchema,
  runId: z.string().min(1),
  issueId: z.string().min(1).nullable(),
  issueIdentifier: z.string().min(1).nullable(),
  status: IntegrationWriteStatusSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  bodyPreview: z.string(),
  target: IntegrationWriteTargetSchema,
  credentialSource: AuthCredentialSourceSchema,
  requiredPermissions: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
  blockers: z.array(z.string().min(1)),
  confirmationRequired: z.boolean(),
  confirmationPhrase: z.string().min(1),
  createdAt: isoDateTime,
  expiresAt: isoDateTime,
});

export const GitHubPrCreatePreviewSchema = z.object({
  runId: z.string().min(1),
  owner: z.string().min(1).nullable(),
  repo: z.string().min(1).nullable(),
  baseBranch: z.string().min(1),
  headBranch: z.string().min(1).nullable(),
  headSha: z.string().min(1).nullable(),
  title: z.string().min(1),
  body: z.string(),
  draft: z.boolean(),
  existingPr: PullRequestSummarySchema.nullable(),
  changedFilesSummary: DiffSummarySchema,
  blockers: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
});
export type GitHubPrCreatePreview = z.infer<typeof GitHubPrCreatePreviewSchema>;

export const GitHubPrCreateResultSchema = z.object({
  number: z.number().int().positive(),
  id: z.number().int().nonnegative(),
  url: z.string().url(),
  state: z.string().min(1),
  draft: z.boolean(),
  title: z.string(),
  baseBranch: z.string().min(1),
  headBranch: z.string().min(1),
  createdAt: isoDateTime,
});
export type GitHubPrCreateResult = z.infer<typeof GitHubPrCreateResultSchema>;

export const GitHubBranchPushPreviewSchema = z.object({
  runId: z.string().min(1),
  workspacePath: z.string().min(1).nullable(),
  remoteName: z.string().min(1),
  branch: z.string().min(1).nullable(),
  headSha: z.string().min(1).nullable(),
  upstreamExists: z.boolean().nullable(),
  remoteBranchExists: z.boolean().nullable(),
  protectedBranch: z.boolean(),
  commandPreview: z.array(z.string().min(1)),
  blockers: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
});
export type GitHubBranchPushPreview = z.infer<typeof GitHubBranchPushPreviewSchema>;

export const LinearCommentPrStateSchema = z.object({
  prNumber: z.number().int().positive().nullable(),
  prUrl: z.string().url().nullable(),
  state: z.enum(["open", "closed", "merged", "unavailable", "unknown"]),
  isDraft: z.boolean().nullable(),
  mergedAt: isoDateTime.nullable(),
  closedAt: isoDateTime.nullable(),
  title: z.string().min(1).nullable(),
  headBranch: z.string().min(1).nullable(),
  baseBranch: z.string().min(1).nullable(),
  targetRepository: z.string().min(1).nullable(),
  verifiedAt: isoDateTime,
  source: z.enum(["local_record", "live_github", "both"]),
  blockingReasons: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
});
export type LinearCommentPrState = z.infer<typeof LinearCommentPrStateSchema>;

export const LinearCommentIntentSchema = z.enum([
  "draft_pr_ready_for_review",
  "pr_ready_for_review",
  "pr_merged",
  "pr_closed_unmerged",
  "unavailable",
]);
export type LinearCommentIntent = z.infer<typeof LinearCommentIntentSchema>;

export const LinearCommentPreviewSchema = z.object({
  runId: z.string().min(1),
  issueId: z.string().min(1).nullable(),
  issueIdentifier: z.string().min(1).nullable(),
  issueUrl: z.string().url().nullable(),
  body: z.string(),
  prState: LinearCommentPrStateSchema.nullable().default(null),
  commentIntent: LinearCommentIntentSchema.default("unavailable"),
  existingCommentHint: z.string().min(1).nullable(),
  duplicateMarker: z.string().min(1),
  blockers: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
});
export type LinearCommentPreview = z.infer<typeof LinearCommentPreviewSchema>;

export const LinearStatusUpdatePreviewSchema = z.object({
  runId: z.string().min(1),
  issueId: z.string().min(1).nullable(),
  issueIdentifier: z.string().min(1).nullable(),
  issueUrl: z.string().url().nullable(),
  currentStatus: z.string().min(1).nullable(),
  proposedStatus: z.string().min(1).nullable(),
  finalRunState: RunStatusSchema,
  blockers: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
});
export type LinearStatusUpdatePreview = z.infer<typeof LinearStatusUpdatePreviewSchema>;

export const LinearCommentResultSchema = z.object({
  id: z.string().min(1),
  url: z.string().url().nullable(),
  bodyPreview: z.string(),
  createdAt: isoDateTime,
});
export type LinearCommentResult = z.infer<typeof LinearCommentResultSchema>;

export const IntegrationWritePreviewSchema = IntegrationWriteBaseSchema.extend({
  githubPr: GitHubPrCreatePreviewSchema.nullable().default(null),
  githubBranchPush: GitHubBranchPushPreviewSchema.nullable().default(null),
  linearComment: LinearCommentPreviewSchema.nullable().default(null),
});
export type IntegrationWritePreview = z.infer<typeof IntegrationWritePreviewSchema>;

export const WriteActionPreviewStatusSchema = z.enum([
  "preview_available",
  "blocked",
  "unavailable",
  "read_only",
  "evidence_missing",
]);
export type WriteActionPreviewStatus = z.infer<typeof WriteActionPreviewStatusSchema>;

export const WriteActionPreviewAuditSchema = z.object({
  runId: z.string().min(1),
  issueId: z.string().min(1).nullable(),
  kind: IntegrationWriteKindSchema,
  targetSystem: IntegrationWriteProviderSchema,
  targetIdentifier: z.string().min(1).nullable(),
  payloadHash: z.string().min(1),
  writePayloadHash: z.string().min(1).nullable().default(null),
  previewStateHash: z.string().min(1).nullable().default(null),
  approvalEvidenceHash: z.string().min(1).nullable().default(null),
  approvalEvidenceSource: z.string().min(1),
  reviewArtifactSource: z.string().min(1).nullable(),
  generatedAt: isoDateTime,
  generatedBy: z.string().min(1).nullable(),
  idempotencyKey: z.string().min(1),
  status: z.literal("previewed"),
  externalWriteId: z.null(),
});
export type WriteActionPreviewAudit = z.infer<typeof WriteActionPreviewAuditSchema>;

export const WriteActionPreviewPayloadSchema = z.object({
  githubPr: GitHubPrCreatePreviewSchema.nullable().default(null),
  linearComment: LinearCommentPreviewSchema.nullable().default(null),
  linearStatusUpdate: LinearStatusUpdatePreviewSchema.nullable().default(null),
});
export type WriteActionPreviewPayload = z.infer<typeof WriteActionPreviewPayloadSchema>;

export const WriteActionPreviewContractSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  issueId: z.string().min(1).nullable(),
  issueIdentifier: z.string().min(1).nullable(),
  kind: IntegrationWriteKindSchema,
  targetSystem: IntegrationWriteProviderSchema,
  targetLabel: z.string().min(1),
  status: WriteActionPreviewStatusSchema,
  title: z.string().min(1),
  bodyPreview: z.string(),
  targetRepository: z.string().min(1).nullable(),
  targetBranch: z.string().min(1).nullable(),
  baseBranch: z.string().min(1).nullable(),
  changedFiles: z.array(ChangedFileSchema),
  reviewArtifactId: z.string().min(1).nullable(),
  reviewArtifactPath: z.string().min(1).nullable(),
  approvalEvidenceId: z.string().min(1),
  approvalEvidenceSource: z.string().min(1),
  requiredPermissions: z.array(z.string().min(1)),
  confirmationRequired: z.boolean(),
  confirmationPhrase: z.string().min(1),
  confirmationPrompt: z.string().min(1),
  blockingReasons: z.array(z.string().min(1)),
  riskWarnings: z.array(z.string().min(1)),
  idempotencyKey: z.string().min(1),
  payloadHash: z.string().min(1),
  writePayloadHash: z.string().min(1).nullable().default(null),
  previewStateHash: z.string().min(1).nullable().default(null),
  approvalEvidenceHash: z.string().min(1).nullable().default(null),
  payloadCanonicalVersion: z.number().int().positive().default(1),
  payloadHashInputsVersion: z.number().int().positive().default(1),
  previewStateHashInputsVersion: z.number().int().positive().default(1),
  hashAlgorithm: z.literal("sha256").default("sha256"),
  generatedAt: isoDateTime,
  expiresAt: isoDateTime.nullable(),
  dryRunOnly: z.literal(true),
  payload: WriteActionPreviewPayloadSchema,
  audit: WriteActionPreviewAuditSchema,
});
export type WriteActionPreviewContract = z.infer<typeof WriteActionPreviewContractSchema>;

export const PayloadHashVerificationResultSchema = z.object({
  status: z.enum(["matched", "mismatched", "missing_preview"]),
  expectedPayloadHash: z.string().min(1).nullable(),
  receivedPayloadHash: z.string().min(1).nullable(),
});
export type PayloadHashVerificationResult = z.infer<typeof PayloadHashVerificationResultSchema>;

export const IdempotencyResultSchema = z.object({
  status: z.enum(["new", "already_executed", "in_progress", "retry_allowed", "conflict"]),
  idempotencyKey: z.string().min(1),
  existingExecutionRecordId: z.string().min(1).nullable(),
  existingExternalUrl: z.string().url().nullable(),
  blockingReason: z.string().min(1).nullable(),
});
export type IdempotencyResult = z.infer<typeof IdempotencyResultSchema>;

export const GitHubPrExecutionRequestSchema = z.object({
  runId: z.string().min(1),
  previewId: z.string().min(1),
  actionKind: z.literal("github_pr_create"),
  payloadHash: z.string().min(1),
  idempotencyKey: z.string().min(1),
  confirmationText: z.string().min(1),
  targetRepository: z.string().min(1),
  baseBranch: z.string().min(1),
  headBranch: z.string().min(1),
  draft: z.literal(true),
});
export type GitHubPrExecutionRequest = z.infer<typeof GitHubPrExecutionRequestSchema>;

export const GitHubPrPreflightStatusSchema = z.enum(["passed", "blocked", "warning", "unavailable"]);
export type GitHubPrPreflightStatus = z.infer<typeof GitHubPrPreflightStatusSchema>;

export const GitHubPrPreflightWorkspaceSchema = z.object({
  path: z.string().min(1).nullable(),
  exists: z.boolean(),
  isGitRepository: z.boolean(),
  isIsolatedRunWorkspace: z.boolean(),
  belongsToRun: z.boolean(),
  isMainCheckout: z.boolean(),
  gitTopLevel: z.string().min(1).nullable(),
  workspaceKind: WorkspaceKindSchema.nullable().default(null),
  isolationStatus: WorkspaceIsolationStatusSchema.default("missing"),
  prEligibility: WorkspacePrEligibilitySchema.default("blocked"),
  hasOwnershipMetadata: z.boolean().default(false),
  ownershipMetadataVersion: z.number().int().positive().nullable().default(null),
  workspaceId: z.string().min(1).nullable().default(null),
});
export type GitHubPrPreflightWorkspace = z.infer<typeof GitHubPrPreflightWorkspaceSchema>;

export const GitHubPrPreflightRepositorySchema = z.object({
  expectedOwner: z.string().min(1).nullable(),
  expectedName: z.string().min(1).nullable(),
  remoteUrl: z.string().min(1).nullable(),
  matchesTarget: z.boolean(),
});
export type GitHubPrPreflightRepository = z.infer<typeof GitHubPrPreflightRepositorySchema>;

export const GitHubPrPreflightBranchesSchema = z.object({
  baseBranch: z.string().min(1).nullable(),
  headBranch: z.string().min(1).nullable(),
  baseIsProtectedOrDefault: z.boolean(),
  headExistsLocal: z.boolean().nullable(),
  headExistsRemote: z.boolean().nullable(),
  headOwnedByExecution: z.boolean(),
  headSafe: z.boolean(),
});
export type GitHubPrPreflightBranches = z.infer<typeof GitHubPrPreflightBranchesSchema>;

export const GitHubPrPreflightDiffSchema = z.object({
  liveChangedFiles: z.array(ChangedFileSchema),
  evidenceChangedFiles: z.array(ChangedFileSchema),
  matchedFiles: z.array(z.string().min(1)),
  missingFromLiveDiff: z.array(z.string().min(1)),
  extraInLiveDiff: z.array(z.string().min(1)),
  hasUnrelatedDirtyFiles: z.boolean(),
  matchesApprovalEvidence: z.boolean(),
});
export type GitHubPrPreflightDiff = z.infer<typeof GitHubPrPreflightDiffSchema>;

export const GitHubPrPreflightReviewArtifactSchema = z.object({
  status: z.enum(["ready", "missing", "error", "unavailable"]),
  identifier: z.string().min(1).nullable(),
  path: z.string().min(1).nullable(),
});
export type GitHubPrPreflightReviewArtifact = z.infer<typeof GitHubPrPreflightReviewArtifactSchema>;

export const GitHubPrPreflightPreviewSchema = z.object({
  payloadHash: z.string().min(1).nullable(),
  expectedPayloadHash: z.string().min(1).nullable(),
  writePayloadHash: z.string().min(1).nullable().default(null),
  expectedWritePayloadHash: z.string().min(1).nullable().default(null),
  previewStateHash: z.string().min(1).nullable().default(null),
  matches: z.boolean(),
});
export type GitHubPrPreflightPreview = z.infer<typeof GitHubPrPreflightPreviewSchema>;

export const GitHubPrPreflightRemoteStateSchema = z.object({
  existingBranch: z.boolean().nullable(),
  existingPr: PullRequestSummarySchema.nullable(),
  existingPrUrl: z.string().url().nullable(),
  idempotencyMatch: z.boolean(),
  ambiguous: z.boolean(),
});
export type GitHubPrPreflightRemoteState = z.infer<typeof GitHubPrPreflightRemoteStateSchema>;

export const GitHubPrPreflightWriteModeSchema = z.object({
  githubMode: z.enum(["read_only", "disabled", "manual_enabled", "enabled", "unavailable", "blocked"]),
  allowPush: z.boolean(),
  allowPrCreate: z.boolean(),
});
export type GitHubPrPreflightWriteMode = z.infer<typeof GitHubPrPreflightWriteModeSchema>;

export const GitHubPrBranchFreshnessStatusSchema = z.enum(["fresh", "stale_no_overlap", "stale_overlap", "unknown"]);
export type GitHubPrBranchFreshnessStatus = z.infer<typeof GitHubPrBranchFreshnessStatusSchema>;

export const GitHubPrBranchFreshnessSchema = z.object({
  status: GitHubPrBranchFreshnessStatusSchema,
  baseBranch: z.string().min(1).nullable(),
  storedBaseCommit: z.string().min(1).nullable(),
  currentRemoteBaseCommit: z.string().min(1).nullable(),
  baseHasAdvanced: z.boolean().nullable(),
  upstreamChangedFiles: z.array(z.string().min(1)),
  approvalChangedFiles: z.array(z.string().min(1)),
  overlappingChangedFiles: z.array(z.string().min(1)),
  checkedAt: isoDateTime,
  blockingReasons: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
});
export type GitHubPrBranchFreshness = z.infer<typeof GitHubPrBranchFreshnessSchema>;

export const GitHubPrPreflightResultSchema = z.object({
  runId: z.string().min(1),
  previewId: z.string().min(1).nullable(),
  actionKind: z.literal("github_pr_create"),
  status: GitHubPrPreflightStatusSchema,
  canExecute: z.boolean(),
  workspace: GitHubPrPreflightWorkspaceSchema,
  repository: GitHubPrPreflightRepositorySchema,
  branches: GitHubPrPreflightBranchesSchema,
  diff: GitHubPrPreflightDiffSchema,
  reviewArtifact: GitHubPrPreflightReviewArtifactSchema,
  preview: GitHubPrPreflightPreviewSchema,
  remoteState: GitHubPrPreflightRemoteStateSchema,
  writeMode: GitHubPrPreflightWriteModeSchema,
  branchFreshness: GitHubPrBranchFreshnessSchema,
  blockingReasons: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
  requiredConfirmation: z.string().min(1).nullable(),
  checkedAt: isoDateTime,
});
export type GitHubPrPreflightResult = z.infer<typeof GitHubPrPreflightResultSchema>;

export const GitHubPrPreflightResponseSchema = z.object({
  preflight: GitHubPrPreflightResultSchema,
});
export type GitHubPrPreflightResponse = z.infer<typeof GitHubPrPreflightResponseSchema>;

export const WriteExecutionStatusSchema = z.enum([
  "pending",
  "in_progress",
  "succeeded",
  "blocked",
  "failed",
  "already_executed",
]);
export type WriteExecutionStatus = z.infer<typeof WriteExecutionStatusSchema>;

export const LocalExecutableWriteKindSchema = z.enum(["github_pr_create", "linear_comment_create"]);
export type LocalExecutableWriteKind = z.infer<typeof LocalExecutableWriteKindSchema>;

export const LocalWriteApprovalRecordSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  issueId: z.string().min(1).nullable(),
  issueIdentifier: z.string().min(1).nullable(),
  kind: LocalExecutableWriteKindSchema,
  targetSystem: IntegrationWriteProviderSchema,
  targetRepository: z.string().min(1).nullable().default(null),
  baseBranch: z.string().min(1).nullable().default(null),
  headBranch: z.string().min(1).nullable().default(null),
  targetIssueId: z.string().min(1).nullable().default(null),
  targetIssueIdentifier: z.string().min(1).nullable().default(null),
  githubPrNumber: z.number().int().positive().nullable().default(null),
  githubPrUrl: z.string().url().nullable().default(null),
  payloadHash: z.string().min(1),
  approvalEvidenceSource: z.string().min(1),
  reviewArtifactSource: z.string().min(1).nullable(),
  changedFiles: z.array(ChangedFileSchema),
  title: z.string().min(1),
  bodySummary: z.string(),
  confirmationType: z.literal("typed_phrase"),
  confirmationPhrase: z.string().min(1),
  approvedAt: isoDateTime,
  status: z.literal("approved"),
  idempotencyKey: z.string().min(1),
});
export type LocalWriteApprovalRecord = z.infer<typeof LocalWriteApprovalRecordSchema>;

export const LocalWriteExecutionRecordSchema = z.object({
  recordType: z.literal("local_write_execution"),
  id: z.string().min(1),
  approvalRecordId: z.string().min(1),
  runId: z.string().min(1),
  issueId: z.string().min(1).nullable(),
  issueIdentifier: z.string().min(1).nullable(),
  previewId: z.string().min(1),
  kind: LocalExecutableWriteKindSchema,
  targetSystem: IntegrationWriteProviderSchema,
  targetRepository: z.string().min(1).nullable().default(null),
  baseBranch: z.string().min(1).nullable().default(null),
  headBranch: z.string().min(1).nullable().default(null),
  targetIssueId: z.string().min(1).nullable().default(null),
  targetIssueIdentifier: z.string().min(1).nullable().default(null),
  payloadHash: z.string().min(1),
  idempotencyKey: z.string().min(1),
  status: WriteExecutionStatusSchema,
  approvalRecord: LocalWriteApprovalRecordSchema,
  startedAt: isoDateTime,
  completedAt: isoDateTime.nullable(),
  externalWriteId: z.string().min(1).nullable(),
  githubPrNumber: z.number().int().positive().nullable(),
  githubPrUrl: z.string().url().nullable(),
  linearCommentId: z.string().min(1).nullable().default(null),
  linearCommentUrl: z.string().url().nullable().default(null),
  errorSummary: z.string().min(1).nullable(),
  blockingReasons: z.array(z.string().min(1)),
});
export type LocalWriteExecutionRecord = z.infer<typeof LocalWriteExecutionRecordSchema>;

export const GitHubPrExecutionStatusSchema = z.enum(["succeeded", "blocked", "failed", "already_executed"]);
export type GitHubPrExecutionStatus = z.infer<typeof GitHubPrExecutionStatusSchema>;

export const GitHubPrExecutionResponseSchema = z.object({
  status: GitHubPrExecutionStatusSchema,
  runId: z.string().min(1),
  previewId: z.string().min(1),
  approvalRecordId: z.string().min(1).nullable(),
  executionRecordId: z.string().min(1).nullable(),
  idempotencyKey: z.string().min(1),
  githubPrNumber: z.number().int().positive().nullable(),
  githubPrUrl: z.string().url().nullable(),
  headBranch: z.string().min(1).nullable(),
  baseBranch: z.string().min(1).nullable(),
  blockingReasons: z.array(z.string().min(1)),
  errorSummary: z.string().min(1).nullable(),
  payloadHashVerification: PayloadHashVerificationResultSchema,
  idempotency: IdempotencyResultSchema,
  approvalRecord: LocalWriteApprovalRecordSchema.nullable(),
  executionRecord: LocalWriteExecutionRecordSchema.nullable(),
  preflight: GitHubPrPreflightResultSchema.nullable().default(null),
  createdAt: isoDateTime.nullable(),
  completedAt: isoDateTime.nullable(),
});
export type GitHubPrExecutionResponse = z.infer<typeof GitHubPrExecutionResponseSchema>;

export const GitHubPrExecutionResultResponseSchema = z.object({
  result: GitHubPrExecutionResponseSchema,
});
export type GitHubPrExecutionResultResponse = z.infer<typeof GitHubPrExecutionResultResponseSchema>;

export const LinearCommentExecutionRequestSchema = z.object({
  runId: z.string().min(1),
  previewId: z.string().min(1),
  actionKind: z.literal("linear_comment_create"),
  payloadHash: z.string().min(1),
  idempotencyKey: z.string().min(1),
  confirmationText: z.string().min(1),
  targetIssueId: z.string().min(1),
  targetIssueIdentifier: z.string().min(1),
  commentBody: z.string(),
});
export type LinearCommentExecutionRequest = z.infer<typeof LinearCommentExecutionRequestSchema>;

export const LinearCommentExecutionStatusSchema = z.enum(["succeeded", "blocked", "failed", "already_executed"]);
export type LinearCommentExecutionStatus = z.infer<typeof LinearCommentExecutionStatusSchema>;

export const LinearCommentExecutionResponseSchema = z.object({
  status: LinearCommentExecutionStatusSchema,
  runId: z.string().min(1),
  previewId: z.string().min(1),
  approvalRecordId: z.string().min(1).nullable(),
  executionRecordId: z.string().min(1).nullable(),
  idempotencyKey: z.string().min(1),
  linearCommentId: z.string().min(1).nullable(),
  linearCommentUrl: z.string().url().nullable(),
  targetIssueId: z.string().min(1).nullable(),
  targetIssueIdentifier: z.string().min(1).nullable(),
  blockingReasons: z.array(z.string().min(1)),
  errorSummary: z.string().min(1).nullable(),
  payloadHashVerification: PayloadHashVerificationResultSchema,
  idempotency: IdempotencyResultSchema,
  approvalRecord: LocalWriteApprovalRecordSchema.nullable(),
  executionRecord: LocalWriteExecutionRecordSchema.nullable(),
  createdAt: isoDateTime.nullable(),
  completedAt: isoDateTime.nullable(),
});
export type LinearCommentExecutionResponse = z.infer<typeof LinearCommentExecutionResponseSchema>;

export const LinearCommentExecutionResultResponseSchema = z.object({
  result: LinearCommentExecutionResponseSchema,
});
export type LinearCommentExecutionResultResponse = z.infer<typeof LinearCommentExecutionResultResponseSchema>;

export const IntegrationWriteExecutionRequestSchema = z.object({
  previewId: z.string().min(1),
  confirmation: z.string().nullable().default(null),
  dryRun: z.boolean().default(false),
  idempotencyKey: z.string().min(1).nullable().default(null),
});
export type IntegrationWriteExecutionRequest = z.infer<typeof IntegrationWriteExecutionRequestSchema>;

export const IntegrationWriteResultSchema = z.object({
  id: z.string().min(1),
  previewId: z.string().min(1),
  provider: IntegrationWriteProviderSchema,
  kind: IntegrationWriteKindSchema,
  status: IntegrationWriteStatusSchema,
  target: IntegrationWriteTargetSchema,
  externalUrl: z.string().url().nullable(),
  externalId: z.string().min(1).nullable(),
  warnings: z.array(z.string().min(1)),
  errors: z.array(z.string().min(1)),
  executedAt: isoDateTime,
  redactedRequestSummary: z.record(z.string(), z.unknown()),
  redactedResponseSummary: z.record(z.string(), z.unknown()),
  githubPr: GitHubPrCreateResultSchema.nullable().default(null),
  linearComment: LinearCommentResultSchema.nullable().default(null),
});
export type IntegrationWriteResult = z.infer<typeof IntegrationWriteResultSchema>;

export const HarnessGradeSchema = z.enum(["A", "B", "C", "D", "F"]);
export type HarnessGrade = z.infer<typeof HarnessGradeSchema>;

export const HarnessCategoryStatusSchema = z.enum(["strong", "partial", "missing", "risky", "unknown"]);
export type HarnessCategoryStatus = z.infer<typeof HarnessCategoryStatusSchema>;

export const HarnessFindingSeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export type HarnessFindingSeverity = z.infer<typeof HarnessFindingSeveritySchema>;

export const HarnessFindingStatusSchema = z.enum(["present", "missing", "weak", "risky", "unknown"]);
export type HarnessFindingStatus = z.infer<typeof HarnessFindingStatusSchema>;

export const HarnessRecommendationPrioritySchema = z.enum(["low", "medium", "high"]);
export type HarnessRecommendationPriority = z.infer<typeof HarnessRecommendationPrioritySchema>;

export const HarnessRiskLevelSchema = z.enum(["low", "medium", "high"]);
export type HarnessRiskLevel = z.infer<typeof HarnessRiskLevelSchema>;

export const HarnessArtifactKindSchema = z.enum([
  "AGENTS.md",
  "WORKFLOW.md",
  "doc",
  "script",
  "skill",
  "config",
  "checklist",
]);
export type HarnessArtifactKind = z.infer<typeof HarnessArtifactKindSchema>;

export const HarnessArtifactActionSchema = z.enum(["create", "update", "skip", "manual"]);
export type HarnessArtifactAction = z.infer<typeof HarnessArtifactActionSchema>;

export const HarnessEvidenceSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  filePath: z.string().min(1).nullable().default(null),
  lineNumber: z.number().int().positive().nullable().default(null),
});
export type HarnessEvidence = z.infer<typeof HarnessEvidenceSchema>;

export const HarnessDetectedFileSchema = z.object({
  path: z.string().min(1),
  kind: z.string().min(1),
  exists: z.boolean(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  hash: z.string().min(1).nullable().default(null),
  summary: z.string(),
});
export type HarnessDetectedFile = z.infer<typeof HarnessDetectedFileSchema>;

export const HarnessValidationCommandSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  command: z.string().min(1),
  source: z.enum(["package.json", "makefile", "script", "ci", "inferred"]),
  filePath: z.string().min(1).nullable(),
});
export type HarnessValidationCommand = z.infer<typeof HarnessValidationCommandSchema>;

export const HarnessRepositoryMetadataSchema = z.object({
  isGitRepository: z.boolean(),
  gitDirty: z.boolean().nullable(),
  gitBranch: z.string().min(1).nullable(),
  gitRemote: z.string().min(1).nullable(),
  packageManager: z.string().min(1).nullable(),
  languages: z.array(z.string().min(1)),
  frameworks: z.array(z.string().min(1)),
  validationCommands: z.array(HarnessValidationCommandSchema),
});
export type HarnessRepositoryMetadata = z.infer<typeof HarnessRepositoryMetadataSchema>;

export const HarnessScanLimitsSchema = z.object({
  maxFiles: z.number().int().positive(),
  maxBytes: z.number().int().positive(),
  maxFileSizeBytes: z.number().int().positive(),
  filesScanned: z.number().int().nonnegative(),
  bytesRead: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type HarnessScanLimits = z.infer<typeof HarnessScanLimitsSchema>;

export const HarnessArtifactPreviewSchema = z.object({
  id: z.string().min(1),
  kind: HarnessArtifactKindSchema,
  path: z.string().min(1),
  action: HarnessArtifactActionSchema,
  existingContentHash: z.string().min(1).nullable(),
  proposedContent: z.string(),
  diff: z.string(),
  warnings: z.array(z.string().min(1)),
  requiresConfirmation: z.boolean(),
});
export type HarnessArtifactPreview = z.infer<typeof HarnessArtifactPreviewSchema>;

export const HarnessProposedArtifactSchema = HarnessArtifactPreviewSchema.pick({
  kind: true,
  path: true,
  action: true,
});
export type HarnessProposedArtifact = z.infer<typeof HarnessProposedArtifactSchema>;

export const HarnessRecommendationSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1),
  priority: HarnessRecommendationPrioritySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  rationale: z.string().min(1),
  proposedArtifacts: z.array(HarnessProposedArtifactSchema),
  manualSteps: z.array(z.string().min(1)),
  riskLevel: HarnessRiskLevelSchema,
  appliesAutomatically: z.boolean(),
});
export type HarnessRecommendation = z.infer<typeof HarnessRecommendationSchema>;

export const HarnessFindingSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1),
  severity: HarnessFindingSeveritySchema,
  status: HarnessFindingStatusSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  evidence: z.array(HarnessEvidenceSchema),
  filePath: z.string().min(1).nullable(),
  lineNumber: z.number().int().positive().nullable(),
  recommendationIds: z.array(z.string().min(1)),
});
export type HarnessFinding = z.infer<typeof HarnessFindingSchema>;

export const HarnessCategorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  score: z.number().nonnegative(),
  max: z.number().positive(),
  status: HarnessCategoryStatusSchema,
  summary: z.string().min(1),
  evidence: z.array(HarnessEvidenceSchema),
  findings: z.array(z.string().min(1)),
  recommendations: z.array(z.string().min(1)),
});
export type HarnessCategory = z.infer<typeof HarnessCategorySchema>;

export const HarnessCategoryScoreSchema = z.object({
  score: z.number().nonnegative(),
  max: z.number().positive(),
  percentage: z.number().min(0).max(100),
  grade: HarnessGradeSchema,
  status: HarnessCategoryStatusSchema,
});
export type HarnessCategoryScore = z.infer<typeof HarnessCategoryScoreSchema>;

export const HarnessScoreSchema = z.object({
  overall: z.number().nonnegative(),
  max: z.number().positive(),
  percentage: z.number().min(0).max(100),
  grade: HarnessGradeSchema,
  categoryScores: z.record(z.string(), HarnessCategoryScoreSchema),
});
export type HarnessScore = z.infer<typeof HarnessScoreSchema>;

export const HarnessScanRequestSchema = z.object({
  repositoryPath: z.string().min(1),
  includeGitStatus: z.boolean().default(true),
  includeDocs: z.boolean().default(true),
  includeScripts: z.boolean().default(true),
  includePackageMetadata: z.boolean().default(true),
  includeWorkflow: z.boolean().default(true),
  includeAgentsMd: z.boolean().default(true),
  includeCi: z.boolean().default(true),
  includeSecurity: z.boolean().default(true),
  includeAccessibility: z.boolean().default(true),
  includeGeneratedPreviews: z.boolean().default(false),
});
export type HarnessScanRequest = z.infer<typeof HarnessScanRequestSchema>;

export const HarnessScanResultSchema = z.object({
  id: z.string().min(1),
  repositoryPath: z.string().min(1),
  scannedAt: isoDateTime,
  score: HarnessScoreSchema,
  grade: HarnessGradeSchema,
  categories: z.array(HarnessCategorySchema),
  findings: z.array(HarnessFindingSchema),
  recommendations: z.array(HarnessRecommendationSchema),
  detectedFiles: z.array(HarnessDetectedFileSchema),
  generatedPreviews: z.array(HarnessArtifactPreviewSchema),
  warnings: z.array(z.string().min(1)),
  errors: z.array(z.string().min(1)),
  metadata: HarnessRepositoryMetadataSchema,
  limits: HarnessScanLimitsSchema,
});
export type HarnessScanResult = z.infer<typeof HarnessScanResultSchema>;

export const HarnessApplyRequestSchema = z.object({
  repositoryPath: z.string().min(1),
  artifactIds: z.array(z.string().min(1)).min(1),
  confirmation: z.string().nullable().default(null),
  dryRun: z.boolean().default(true),
});
export type HarnessApplyRequest = z.infer<typeof HarnessApplyRequestSchema>;

export const HarnessApplyItemSchema = z.object({
  artifactId: z.string().min(1),
  path: z.string().min(1),
  action: HarnessArtifactActionSchema,
  message: z.string().min(1),
});
export type HarnessApplyItem = z.infer<typeof HarnessApplyItemSchema>;

export const HarnessApplyFailureSchema = HarnessApplyItemSchema.extend({
  error: z.string().min(1),
});
export type HarnessApplyFailure = z.infer<typeof HarnessApplyFailureSchema>;

export const HarnessBackupSchema = z.object({
  artifactId: z.string().min(1),
  path: z.string().min(1),
  backupPath: z.string().min(1),
});
export type HarnessBackup = z.infer<typeof HarnessBackupSchema>;

export const HarnessApplyResultSchema = z.object({
  applied: z.array(HarnessApplyItemSchema),
  skipped: z.array(HarnessApplyItemSchema),
  failed: z.array(HarnessApplyFailureSchema),
  backups: z.array(HarnessBackupSchema),
  events: z.array(z.string().min(1)),
  nextScanSuggested: z.boolean(),
});
export type HarnessApplyResult = z.infer<typeof HarnessApplyResultSchema>;

export const HarnessStatusSchema = z.object({
  available: z.boolean(),
  currentRepositoryPath: z.string().min(1).nullable(),
  latestScanId: z.string().min(1).nullable(),
  latestScanAt: isoDateTime.nullable(),
  latestGrade: HarnessGradeSchema.nullable(),
});
export type HarnessStatus = z.infer<typeof HarnessStatusSchema>;

export const HarnessPreviewRequestSchema = z.object({
  scanId: z.string().min(1),
});
export type HarnessPreviewRequest = z.infer<typeof HarnessPreviewRequestSchema>;

export const HarnessScanStartedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("harness.scan.started"),
  scanId: z.string().min(1),
  repositoryPath: z.string().min(1),
});

export const HarnessScanCompletedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("harness.scan.completed"),
  scanId: z.string().min(1),
  repositoryPath: z.string().min(1),
  score: HarnessScoreSchema,
});

export const HarnessScanFailedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("harness.scan.failed"),
  scanId: z.string().min(1),
  repositoryPath: z.string().min(1),
  error: z.string().min(1),
});

export const HarnessRecommendationGeneratedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("harness.recommendation.generated"),
  scanId: z.string().min(1),
  recommendation: HarnessRecommendationSchema,
});

export const HarnessArtifactPreviewedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("harness.artifact.previewed"),
  scanId: z.string().min(1),
  artifact: HarnessArtifactPreviewSchema,
});

export const HarnessArtifactAppliedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("harness.artifact.applied"),
  scanId: z.string().min(1).nullable(),
  artifactId: z.string().min(1),
  path: z.string().min(1),
});

export const HarnessArtifactSkippedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("harness.artifact.skipped"),
  scanId: z.string().min(1).nullable(),
  artifactId: z.string().min(1),
  path: z.string().min(1),
  reason: z.string().min(1),
});

export const HarnessArtifactFailedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("harness.artifact.failed"),
  scanId: z.string().min(1).nullable(),
  artifactId: z.string().min(1),
  path: z.string().min(1),
  error: z.string().min(1),
});

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

export const IntegrationWritePreviewedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("integration.write.previewed"),
  preview: IntegrationWritePreviewSchema,
});

export const IntegrationWriteBlockedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("integration.write.blocked"),
  preview: IntegrationWritePreviewSchema,
});

export const IntegrationWriteConfirmationRequiredEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("integration.write.confirmation_required"),
  previewId: z.string().min(1),
  provider: IntegrationWriteProviderSchema,
  kind: IntegrationWriteKindSchema,
});

export const IntegrationWriteStartedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("integration.write.started"),
  previewId: z.string().min(1),
  provider: IntegrationWriteProviderSchema,
  kind: IntegrationWriteKindSchema,
  target: IntegrationWriteTargetSchema,
});

export const IntegrationWriteSucceededEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("integration.write.succeeded"),
  result: IntegrationWriteResultSchema,
});

export const IntegrationWriteFailedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("integration.write.failed"),
  previewId: z.string().min(1),
  provider: IntegrationWriteProviderSchema,
  kind: IntegrationWriteKindSchema,
  error: z.string().min(1),
});

export const IntegrationWriteCancelledEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("integration.write.cancelled"),
  previewId: z.string().min(1),
  provider: IntegrationWriteProviderSchema,
  kind: IntegrationWriteKindSchema,
  reason: z.string().min(1),
});

export const GitHubPrPreviewedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.pr.previewed"),
  preview: GitHubPrCreatePreviewSchema,
});

export const GitHubPrCreateFailedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.pr.create_failed"),
  previewId: z.string().min(1),
  error: z.string().min(1),
  status: z.number().int().positive().nullable().optional(),
});

export const GitHubBranchPushPreviewedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.branch.push.previewed"),
  preview: GitHubBranchPushPreviewSchema,
});

export const GitHubBranchPushStartedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.branch.push_started"),
  previewId: z.string().min(1),
  branch: z.string().min(1),
});

export const GitHubBranchPushSucceededEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.branch.push_succeeded"),
  previewId: z.string().min(1),
  branch: z.string().min(1),
  headSha: z.string().min(1).nullable(),
});

export const GitHubBranchPushFailedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("github.branch.push_failed"),
  previewId: z.string().min(1),
  branch: z.string().min(1).nullable(),
  error: z.string().min(1),
});

export const LinearCommentPreviewedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("linear.comment.previewed"),
  preview: LinearCommentPreviewSchema,
});

export const LinearCommentCreatedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("linear.comment.created"),
  result: LinearCommentResultSchema,
});

export const LinearCommentCreateFailedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("linear.comment.create_failed"),
  previewId: z.string().min(1),
  error: z.string().min(1),
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
  RunRecoveredEventSchema,
  AgentMessageEventSchema,
  ToolCallEventSchema,
  ApprovalRequestedEventSchema,
  ApprovalResolvedEventSchema,
  ApprovalRecoveredEventSchema,
  UsageEventSchema,
  ArtifactEventSchema,
  WorkflowLoadedEventSchema,
  WorkflowInvalidEventSchema,
  WorkspaceReadyEventSchema,
  WorkspaceOwnershipRecordedEventSchema,
  WorkspaceCleanupPlannedEventSchema,
  WorkspaceCleanupStartedEventSchema,
  WorkspaceCleanupSkippedEventSchema,
  WorkspaceCleanupDeletedEventSchema,
  WorkspaceCleanupFailedEventSchema,
  WorkspaceCleanupCompletedEventSchema,
  HookStartedEventSchema,
  HookSucceededEventSchema,
  HookFailedEventSchema,
  HookTimedOutEventSchema,
  PromptRenderedEventSchema,
  ProviderStartedEventSchema,
  ProviderStderrEventSchema,
  AuthStartedEventSchema,
  AuthPendingUserEventSchema,
  AuthConnectedEventSchema,
  AuthRefreshedEventSchema,
  AuthFailedEventSchema,
  AuthDisconnectedEventSchema,
  AuthRevokedEventSchema,
  AuthValidationSucceededEventSchema,
  AuthValidationFailedEventSchema,
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
  IntegrationWritePreviewedEventSchema,
  IntegrationWriteBlockedEventSchema,
  IntegrationWriteConfirmationRequiredEventSchema,
  IntegrationWriteStartedEventSchema,
  IntegrationWriteSucceededEventSchema,
  IntegrationWriteFailedEventSchema,
  IntegrationWriteCancelledEventSchema,
  GitHubPrPreviewedEventSchema,
  GitHubPrCreateFailedEventSchema,
  GitHubBranchPushPreviewedEventSchema,
  GitHubBranchPushStartedEventSchema,
  GitHubBranchPushSucceededEventSchema,
  GitHubBranchPushFailedEventSchema,
  LinearCommentPreviewedEventSchema,
  LinearCommentCreatedEventSchema,
  LinearCommentCreateFailedEventSchema,
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
  HarnessScanStartedEventSchema,
  HarnessScanCompletedEventSchema,
  HarnessScanFailedEventSchema,
  HarnessRecommendationGeneratedEventSchema,
  HarnessArtifactPreviewedEventSchema,
  HarnessArtifactAppliedEventSchema,
  HarnessArtifactSkippedEventSchema,
  HarnessArtifactFailedEventSchema,
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

export const AuthStatusResponseSchema = z.object({
  auth: AuthStatusSchema,
});
export type AuthStatusResponse = z.infer<typeof AuthStatusResponseSchema>;

export const AuthConnectionsResponseSchema = z.object({
  connections: z.array(IntegrationAuthConnectionSchema),
});
export type AuthConnectionsResponse = z.infer<typeof AuthConnectionsResponseSchema>;

export const AuthConnectionResponseSchema = z.object({
  connection: IntegrationAuthConnectionSchema,
});
export type AuthConnectionResponse = z.infer<typeof AuthConnectionResponseSchema>;

export const AuthStartResponseSchema = z.object({
  result: AuthStartResultSchema,
});
export type AuthStartResponse = z.infer<typeof AuthStartResponseSchema>;

export const AuthPollResponseSchema = z.object({
  result: AuthPollResultSchema,
});
export type AuthPollResponse = z.infer<typeof AuthPollResponseSchema>;

export const AuthCallbackResponseSchema = z.object({
  result: AuthCallbackResultSchema,
});
export type AuthCallbackResponse = z.infer<typeof AuthCallbackResponseSchema>;

export const AuthValidationResponseSchema = z.object({
  result: AuthValidationResultSchema,
});
export type AuthValidationResponse = z.infer<typeof AuthValidationResponseSchema>;

export const ReviewArtifactResponseSchema = z.object({
  reviewArtifacts: ReviewArtifactSnapshotSchema.nullable(),
});
export type ReviewArtifactResponse = z.infer<typeof ReviewArtifactResponseSchema>;

export const WritesStatusSchema = z.object({
  github: IntegrationWritePolicySchema,
  linear: IntegrationWritePolicySchema,
});
export type WritesStatus = z.infer<typeof WritesStatusSchema>;

export const WritesStatusResponseSchema = z.object({
  writes: WritesStatusSchema,
});
export type WritesStatusResponse = z.infer<typeof WritesStatusResponseSchema>;

export const WriteActionAvailabilityStatusSchema = z.enum([
  "enabled",
  "gated",
  "manual_enabled",
  "read_only",
  "disabled",
  "unavailable",
  "blocked",
]);
export type WriteActionAvailabilityStatus = z.infer<typeof WriteActionAvailabilityStatusSchema>;

export const WriteActionAvailabilitySchema = z.object({
  provider: IntegrationWriteProviderSchema,
  kind: IntegrationWriteKindSchema,
  label: z.string().min(1),
  status: WriteActionAvailabilityStatusSchema,
  reasons: z.array(z.string().min(1)),
  evidenceRequired: z.array(z.string().min(1)),
});
export type WriteActionAvailability = z.infer<typeof WriteActionAvailabilitySchema>;

export const IntegrationWriteActionsResponseSchema = z.object({
  writeActions: z.array(z.union([IntegrationWritePreviewSchema, IntegrationWriteResultSchema, LocalWriteExecutionRecordSchema])),
  availability: z.array(WriteActionAvailabilitySchema).default([]),
  previews: z.array(WriteActionPreviewContractSchema).default([]),
});
export type IntegrationWriteActionsResponse = z.infer<typeof IntegrationWriteActionsResponseSchema>;

export const IntegrationWritePreviewResponseSchema = z.object({
  preview: IntegrationWritePreviewSchema,
});
export type IntegrationWritePreviewResponse = z.infer<typeof IntegrationWritePreviewResponseSchema>;

export const IntegrationWriteResultResponseSchema = z.object({
  result: IntegrationWriteResultSchema,
});
export type IntegrationWriteResultResponse = z.infer<typeof IntegrationWriteResultResponseSchema>;

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

export const DaemonStatusSchema = z.object({
  daemonInstanceId: z.string().min(1),
  startedAt: isoDateTime,
  recoveredAt: isoDateTime.nullable(),
  recoveredRunsCount: z.number().int().nonnegative(),
  orphanedRunsCount: z.number().int().nonnegative(),
  activeRunsCount: z.number().int().nonnegative(),
  dbPath: z.string().min(1),
  workspaceRoot: z.string().min(1).nullable(),
  workflowStatus: z.enum(["healthy", "missing", "invalid"]),
  trackerStatus: z.enum(["healthy", "invalid_config", "unavailable", "stale", "unknown"]),
  providerSummary: z.array(ProviderHealthSchema.pick({ id: true, enabled: true, available: true, status: true })),
});
export type DaemonStatus = z.infer<typeof DaemonStatusSchema>;

export const DaemonStatusResponseSchema = z.object({
  daemon: DaemonStatusSchema,
});
export type DaemonStatusResponse = z.infer<typeof DaemonStatusResponseSchema>;

export const ConnectedOnboardingStateSchema = z.enum([
  "daemon_unavailable",
  "daemon_ready",
  "needs_repo",
  "repo_ready",
  "needs_linear",
  "linear_ready",
  "needs_github",
  "github_ready",
  "needs_provider",
  "provider_ready",
  "needs_issue_scope",
  "board_ready",
  "issue_selected",
  "workspace_preparing",
  "workspace_ready",
  "run_starting",
  "run_active",
  "evidence_streaming",
  "review_ready",
  "completed",
  "failed",
  "needs_attention",
]);
export type ConnectedOnboardingState = z.infer<typeof ConnectedOnboardingStateSchema>;

const ConnectedReadinessStatusSchema = z.enum([
  "ready",
  "healthy",
  "missing",
  "missing_auth",
  "invalid",
  "invalid_config",
  "disabled",
  "unavailable",
  "stale",
  "unknown",
  "empty",
  "blocked",
]);

export const ConnectedNextActionSchema = z.object({
  kind: z.enum([
    "start_daemon",
    "choose_repo",
    "configure_workflow",
    "connect_linear",
    "refresh_issues",
    "validate_github",
    "check_provider",
    "review_write_permissions",
    "open_board",
    "select_issue",
    "run_with_codex",
    "watch_run",
    "review_artifact",
    "completed",
    "needs_attention",
  ]),
  label: z.string().min(1),
  href: z.string().min(1).nullable().default(null),
});
export type ConnectedNextAction = z.infer<typeof ConnectedNextActionSchema>;

export const ConnectedGoldenPathStatusSchema = z.object({
  mode: z.literal("connected"),
  generatedAt: isoDateTime,
  onboardingState: ConnectedOnboardingStateSchema,
  daemon: z.object({
    status: z.literal("healthy"),
    instanceId: z.string().min(1),
    startedAt: isoDateTime,
    activeRunsCount: z.number().int().nonnegative(),
    recoveredRunsCount: z.number().int().nonnegative(),
  }),
  repository: z.object({
    status: ConnectedReadinessStatusSchema,
    path: z.string().min(1).nullable(),
    workflowPath: z.string().min(1).nullable(),
    workflowStatus: WorkflowStatusSchema.shape.status,
    error: z.string().nullable(),
  }),
  workspace: z.object({
    status: ConnectedReadinessStatusSchema,
    path: z.string().min(1).nullable(),
    exists: z.boolean().nullable(),
  }),
  linear: z.object({
    status: ConnectedReadinessStatusSchema,
    authStatus: AuthConnectionStatusSchema,
    credentialSource: AuthCredentialSourceSchema,
    issueCount: z.number().int().nonnegative(),
    issueScope: z.string().min(1),
    lastSyncAt: isoDateTime.nullable(),
    error: z.string().nullable(),
  }),
  github: z.object({
    status: ConnectedReadinessStatusSchema,
    authStatus: AuthConnectionStatusSchema,
    credentialSource: AuthCredentialSourceSchema,
    enabled: z.boolean(),
    repository: z.string().min(1).nullable(),
    lastCheckedAt: isoDateTime.nullable(),
    error: z.string().nullable(),
  }),
  provider: z.object({
    kind: ProviderIdSchema,
    status: ConnectedReadinessStatusSchema,
    command: z.string().min(1).nullable(),
    available: z.boolean(),
    error: z.string().nullable(),
    hint: z.string().nullable(),
  }),
  eventStore: z.object({
    status: z.literal("ready"),
    databasePath: z.string().min(1),
  }),
  board: z.object({
    status: ConnectedReadinessStatusSchema,
    issueCount: z.number().int().nonnegative(),
    issueScope: z.string().min(1),
    lastSyncAt: isoDateTime.nullable(),
  }),
  activeRun: z
    .object({
      id: z.string().min(1),
      issueIdentifier: z.string().min(1),
      provider: ProviderIdSchema,
      status: RunStatusSchema,
    })
    .nullable(),
  reviewArtifact: z.object({
    status: ConnectedReadinessStatusSchema,
    runId: z.string().min(1).nullable(),
    issueIdentifier: z.string().min(1).nullable(),
    lastRefreshedAt: isoDateTime.nullable(),
    error: z.string().nullable(),
  }),
  writes: z.object({
    github: z.enum(["disabled", "read_only", "gated", "enabled"]),
    linear: z.enum(["disabled", "read_only", "gated", "enabled"]),
  }),
  nextAction: ConnectedNextActionSchema,
  blockingReasons: z.array(z.string().min(1)),
});
export type ConnectedGoldenPathStatus = z.infer<typeof ConnectedGoldenPathStatusSchema>;

export const ConnectedGoldenPathStatusResponseSchema = z.object({
  connected: ConnectedGoldenPathStatusSchema,
});
export type ConnectedGoldenPathStatusResponse = z.infer<typeof ConnectedGoldenPathStatusResponseSchema>;

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

export const FileSummarySourceSchema = z.enum([
  "approval_event",
  "review_artifact",
  "diff_event",
  "empty",
  "unavailable",
]);
export type FileSummarySource = z.infer<typeof FileSummarySourceSchema>;

export const ReviewArtifactEvidenceStatusSchema = z.enum(["ready", "missing", "error", "unavailable"]);
export type ReviewArtifactEvidenceStatus = z.infer<typeof ReviewArtifactEvidenceStatusSchema>;

export const HookOutputSummarySchema = z.object({
  hookName: HookNameSchema,
  status: HookStatusSchema,
  command: z.string().min(1).nullable(),
  cwd: z.string().min(1),
  exitCode: z.number().int().nullable(),
  stdoutPreview: z.string(),
  stderrPreview: z.string(),
  error: z.string().nullable(),
});
export type HookOutputSummary = z.infer<typeof HookOutputSummarySchema>;

export const RunEvidenceSummarySchema = z.object({
  eventCount: z.number().int().nonnegative(),
  providerEventCount: z.number().int().nonnegative(),
  approvalCount: z.number().int().nonnegative(),
  pendingApprovalCount: z.number().int().nonnegative(),
  hookCount: z.number().int().nonnegative(),
  failedHookCount: z.number().int().nonnegative(),
  providerErrorCount: z.number().int().nonnegative(),
  lastEventAt: isoDateTime.nullable(),
});
export type RunEvidenceSummary = z.infer<typeof RunEvidenceSummarySchema>;

export const RunApprovalEvidenceSchema = z.object({
  run: RunSchema,
  issue: IssueSchema.nullable(),
  workspacePath: z.string().min(1).nullable(),
  provider: ProviderIdSchema,
  finalRunState: RunStatusSchema,
  changedFiles: z.array(ChangedFileSchema),
  fileSummary: z.string().min(1).nullable(),
  fileSummarySource: FileSummarySourceSchema,
  evidenceSummary: RunEvidenceSummarySchema,
  hookOutputSummary: z.array(HookOutputSummarySchema),
  reviewArtifactStatus: ReviewArtifactEvidenceStatusSchema,
  reviewArtifactIdentifier: z.string().min(1).nullable(),
  reviewArtifactPath: z.string().min(1).nullable(),
  reviewArtifact: ReviewArtifactSnapshotSchema.nullable(),
  writeActionAvailability: z.array(WriteActionAvailabilitySchema),
  missingEvidenceReasons: z.array(z.string().min(1)),
  approvals: z.array(ApprovalStateSchema),
});
export type RunApprovalEvidence = z.infer<typeof RunApprovalEvidenceSchema>;

export const RunApprovalEvidenceResponseSchema = z.object({
  approvalEvidence: RunApprovalEvidenceSchema,
});
export type RunApprovalEvidenceResponse = z.infer<typeof RunApprovalEvidenceResponseSchema>;

export const WorkflowStatusResponseSchema = z.object({
  workflow: WorkflowStatusSchema,
});
export type WorkflowStatusResponse = z.infer<typeof WorkflowStatusResponseSchema>;

export const WorkflowConfigResponseSchema = z.object({
  config: WorkflowConfigSummarySchema.nullable(),
});
export type WorkflowConfigResponse = z.infer<typeof WorkflowConfigResponseSchema>;

export const WorkspacesResponseSchema = z.object({
  workspaces: z.array(WorkspaceInventoryItemSchema),
  inventory: WorkspaceInventorySchema,
});
export type WorkspacesResponse = z.infer<typeof WorkspacesResponseSchema>;

export const WorkspaceResponseSchema = z.object({
  workspace: z.union([WorkspaceInfoSchema, WorkspaceInventoryItemSchema]),
});
export type WorkspaceResponse = z.infer<typeof WorkspaceResponseSchema>;

export const WorkspaceInventoryResponseSchema = z.object({
  inventory: WorkspaceInventorySchema,
});
export type WorkspaceInventoryResponse = z.infer<typeof WorkspaceInventoryResponseSchema>;

export const WorkspaceCleanupPlanResponseSchema = z.object({
  plan: WorkspaceCleanupPlanSchema,
});
export type WorkspaceCleanupPlanResponse = z.infer<typeof WorkspaceCleanupPlanResponseSchema>;

export const WorkspaceCleanupExecuteRequestSchema = z.object({
  planId: z.string().min(1).optional(),
  identifiers: z.array(z.string().min(1)).optional(),
  confirm: z.string().min(1).optional(),
});
export type WorkspaceCleanupExecuteRequest = z.infer<typeof WorkspaceCleanupExecuteRequestSchema>;

export const WorkspaceCleanupExecuteResponseSchema = z.object({
  result: WorkspaceCleanupResultSchema,
});
export type WorkspaceCleanupExecuteResponse = z.infer<typeof WorkspaceCleanupExecuteResponseSchema>;

export const PromptResponseSchema = z.object({
  prompt: z.string().nullable(),
});
export type PromptResponse = z.infer<typeof PromptResponseSchema>;

export const HarnessStatusResponseSchema = z.object({
  harness: HarnessStatusSchema,
});
export type HarnessStatusResponse = z.infer<typeof HarnessStatusResponseSchema>;

export const HarnessScanResponseSchema = z.object({
  scan: HarnessScanResultSchema,
});
export type HarnessScanResponse = z.infer<typeof HarnessScanResponseSchema>;

export const HarnessScanHistoryResponseSchema = z.object({
  scans: z.array(HarnessScanResultSchema),
});
export type HarnessScanHistoryResponse = z.infer<typeof HarnessScanHistoryResponseSchema>;

export const HarnessPreviewResponseSchema = z.object({
  scan: HarnessScanResultSchema,
  previews: z.array(HarnessArtifactPreviewSchema),
});
export type HarnessPreviewResponse = z.infer<typeof HarnessPreviewResponseSchema>;

export const HarnessApplyResponseSchema = z.object({
  result: HarnessApplyResultSchema,
});
export type HarnessApplyResponse = z.infer<typeof HarnessApplyResponseSchema>;

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  timestamp: isoDateTime,
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
