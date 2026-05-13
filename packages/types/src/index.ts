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

export const AgentEventSchema = z.discriminatedUnion("type", [
  RunStatusEventSchema,
  AgentMessageEventSchema,
  ToolCallEventSchema,
  ApprovalRequestedEventSchema,
  ApprovalResolvedEventSchema,
  UsageEventSchema,
  ArtifactEventSchema,
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

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  timestamp: isoDateTime,
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
