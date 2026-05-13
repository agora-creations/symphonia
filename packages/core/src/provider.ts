import {
  AgentEvent,
  ClaudeConfig,
  CodexConfig,
  CursorConfig,
  Issue,
  ProviderHealth,
  ProviderId,
  Run,
  WorkflowConfig,
} from "@symphonia/types";

export type ProviderEmitAgentEvent = (event: AgentEvent) => Promise<void> | void;

export type ProviderRunContext = {
  run: Run;
  issue: Issue;
  attempt: number;
  workspacePath: string;
  renderedPrompt: string;
  workflowConfig: WorkflowConfig;
  codexConfig: CodexConfig;
  claudeConfig: ClaudeConfig;
  cursorConfig: CursorConfig;
  signal: AbortSignal;
  emit: ProviderEmitAgentEvent;
  requestApproval?: (request: ProviderApprovalRequest) => Promise<ProviderApprovalDecision>;
};

export type ProviderApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type ProviderApprovalRequest = {
  approvalId: string;
  provider: ProviderId;
  approvalType: "command" | "file_change" | "unknown";
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  prompt: string;
  reason: string | null;
  command: string | null;
  cwd: string | null;
  fileSummary: string | null;
  availableDecisions: ProviderApprovalDecision[];
  rawRequestId: string | number;
  rawMethod: string;
};

export type AgentProvider = {
  id: ProviderId;
  displayName: string;
  health(config?: CodexConfig | ClaudeConfig | CursorConfig): Promise<ProviderHealth>;
  start(context: ProviderRunContext): Promise<void>;
};

export const mockProviderHealth: ProviderHealth = {
  id: "mock",
  displayName: "Mock provider",
  available: true,
  command: null,
  enabled: true,
  configured: true,
  model: null,
  status: "available",
  version: "built-in",
  error: null,
  hint: "Deterministic local mock provider for tests and demos.",
  lastCheckedAt: null,
  config: { builtIn: true },
};
