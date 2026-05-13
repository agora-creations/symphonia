import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });

export const IssueStateSchema = z.enum(["Todo", "In Progress", "Human Review", "Rework", "Done"]);
export type IssueState = z.infer<typeof IssueStateSchema>;

export const IssuePrioritySchema = z.enum(["No priority", "Low", "Medium", "High", "Urgent"]);
export type IssuePriority = z.infer<typeof IssuePrioritySchema>;

export const IssueSchema = z.object({
  id: z.string().min(1),
  identifier: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  state: IssueStateSchema,
  labels: z.array(z.string()),
  priority: IssuePrioritySchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  url: z.string().url(),
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
  provider: z.string().min(1),
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

export const ApprovalRequestedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("approval.requested"),
  approvalId: z.string().min(1),
  prompt: z.string().min(1),
});

export const ApprovalResolvedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("approval.resolved"),
  approvalId: z.string().min(1),
  resolution: z.enum(["approved", "rejected"]),
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

export const TrackerKindSchema = z.enum(["mock", "linear"]);
export type TrackerKind = z.infer<typeof TrackerKindSchema>;

export const TrackerConfigSchema = z.object({
  kind: TrackerKindSchema,
  endpoint: z.string().min(1).nullable(),
  apiKey: z.string().min(1).nullable(),
  projectSlug: z.string().min(1).nullable(),
  activeStates: z.array(z.string().min(1)),
  terminalStates: z.array(z.string().min(1)),
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
  approvalPolicy: z.string().min(1).nullable(),
  threadSandbox: z.string().min(1).nullable(),
  turnSandboxPolicy: z.string().min(1).nullable(),
  turnTimeoutMs: z.number().int().positive(),
  readTimeoutMs: z.number().int().positive(),
  stallTimeoutMs: z.number().int().positive(),
});
export type CodexConfig = z.infer<typeof CodexConfigSchema>;

export const WorkflowConfigSchema = z.object({
  tracker: TrackerConfigSchema,
  polling: PollingConfigSchema,
  workspace: WorkspaceConfigSchema,
  hooks: HooksConfigSchema,
  agent: AgentConfigSchema,
  codex: CodexConfigSchema,
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
  trackerKind: TrackerKindSchema,
  endpoint: z.string().min(1).nullable(),
  projectSlug: z.string().min(1).nullable(),
  activeStates: z.array(z.string().min(1)),
  terminalStates: z.array(z.string().min(1)),
  workspaceRoot: z.string().min(1),
  maxConcurrentAgents: z.number().int().positive(),
  maxTurns: z.number().int().positive(),
  hookTimeoutMs: z.number().int().positive(),
  codexCommand: z.string().min(1),
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
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const StartRunRequestSchema = z.object({
  issueId: z.string().min(1),
});
export type StartRunRequest = z.infer<typeof StartRunRequestSchema>;

export const IssuesResponseSchema = z.object({
  issues: z.array(IssueSchema),
});
export type IssuesResponse = z.infer<typeof IssuesResponseSchema>;

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
