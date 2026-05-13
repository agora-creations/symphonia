import {
  AgentEvent,
  ApprovalResponseRequest,
  ApprovalState,
  ApprovalsResponseSchema,
  DaemonStatus,
  DaemonStatusResponseSchema,
  EventsResponseSchema,
  GitHubHealth,
  GitHubHealthResponseSchema,
  GitHubStatus,
  GitHubStatusResponseSchema,
  HealthResponseSchema,
  IssuesResponseSchema,
  ProviderHealth,
  ProviderHealthResponseSchema,
  ProviderId,
  ProvidersResponseSchema,
  ReviewArtifactResponseSchema,
  ReviewArtifactSnapshot,
  Run,
  RunResponseSchema,
  RunsResponseSchema,
  PromptResponseSchema,
  WorkflowConfigResponseSchema,
  TrackerHealth,
  TrackerHealthResponseSchema,
  TrackerStatus,
  TrackerStatusResponseSchema,
  WorkflowStatus,
  WorkflowStatusResponseSchema,
  WorkspaceCleanupExecuteRequest,
  WorkspaceCleanupExecuteResponseSchema,
  WorkspaceCleanupPlan,
  WorkspaceCleanupPlanResponseSchema,
  WorkspaceCleanupResult,
  WorkspaceInfo,
  WorkspaceInventory,
  WorkspaceInventoryItem,
  WorkspaceInventoryResponseSchema,
  WorkspaceResponseSchema,
  WorkspacesResponseSchema,
} from "@symphonia/types";

export const DAEMON_URL = process.env.NEXT_PUBLIC_DAEMON_URL ?? "http://localhost:4100";

export async function getHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${DAEMON_URL}/healthz`, { cache: "no-store" });
    if (!response.ok) return false;
    HealthResponseSchema.parse(await response.json());
    return true;
  } catch {
    return false;
  }
}

export async function getIssues() {
  const response = await request("/issues");
  return IssuesResponseSchema.parse(response).issues;
}

export async function refreshIssues() {
  const response = await request("/issues/refresh", { method: "POST" });
  return IssuesResponseSchema.parse(response).issues;
}

export async function getTrackerStatus(): Promise<TrackerStatus> {
  const response = await request("/tracker/status");
  return TrackerStatusResponseSchema.parse(response).tracker;
}

export async function getTrackerHealth(): Promise<TrackerHealth> {
  const response = await request("/tracker/health");
  return TrackerHealthResponseSchema.parse(response).tracker;
}

export async function getGithubStatus(): Promise<GitHubStatus> {
  const response = await request("/github/status");
  return GitHubStatusResponseSchema.parse(response).github;
}

export async function getGithubHealth(): Promise<GitHubHealth> {
  const response = await request("/github/health");
  return GitHubHealthResponseSchema.parse(response).github;
}

export async function getRuns(): Promise<Run[]> {
  const response = await request("/runs");
  return RunsResponseSchema.parse(response).runs;
}

export async function getDaemonStatus(): Promise<DaemonStatus> {
  const response = await request("/daemon/status");
  return DaemonStatusResponseSchema.parse(response).daemon;
}

export async function getRunEvents(runId: string): Promise<AgentEvent[]> {
  const response = await request(`/runs/${runId}/events`);
  return EventsResponseSchema.parse(response).events;
}

export async function getRunPrompt(runId: string): Promise<string | null> {
  const response = await request(`/runs/${runId}/prompt`);
  return PromptResponseSchema.parse(response).prompt;
}

export async function getReviewArtifacts(runId: string): Promise<ReviewArtifactSnapshot | null> {
  const response = await request(`/runs/${runId}/review-artifacts`);
  return ReviewArtifactResponseSchema.parse(response).reviewArtifacts;
}

export async function refreshReviewArtifacts(runId: string): Promise<ReviewArtifactSnapshot | null> {
  const response = await request(`/runs/${runId}/review-artifacts/refresh`, { method: "POST" });
  return ReviewArtifactResponseSchema.parse(response).reviewArtifacts;
}

export async function getWorkflowStatus(): Promise<WorkflowStatus> {
  const response = await request("/workflow/status");
  return WorkflowStatusResponseSchema.parse(response).workflow;
}

export async function reloadWorkflow(): Promise<WorkflowStatus> {
  const response = await request("/workflow/reload", { method: "POST" });
  return WorkflowStatusResponseSchema.parse(response).workflow;
}

export async function getWorkflowConfig() {
  const response = await request("/workflow/config");
  return WorkflowConfigResponseSchema.parse(response).config;
}

export async function getWorkspaces(): Promise<WorkspaceInventoryItem[]> {
  const response = await request("/workspaces");
  return WorkspacesResponseSchema.parse(response).workspaces;
}

export async function getWorkspaceInventory(): Promise<WorkspaceInventory> {
  const response = await request("/workspaces");
  return WorkspacesResponseSchema.parse(response).inventory;
}

export async function refreshWorkspaceInventory(): Promise<WorkspaceInventory> {
  const response = await request("/workspaces/refresh", { method: "POST" });
  return WorkspaceInventoryResponseSchema.parse(response).inventory;
}

export async function getWorkspace(issueIdentifier: string): Promise<WorkspaceInfo> {
  const response = await request(`/workspaces/${encodeURIComponent(issueIdentifier)}`);
  const workspace = WorkspaceResponseSchema.parse(response).workspace;
  return "createdNow" in workspace
    ? workspace
    : {
        issueIdentifier: workspace.issueIdentifier,
        workspaceKey: workspace.workspaceKey,
        path: workspace.path,
        createdNow: false,
        exists: workspace.exists,
      };
}

export async function getWorkspaceCleanupPlan(): Promise<WorkspaceCleanupPlan> {
  const response = await request("/workspaces/cleanup/plan");
  return WorkspaceCleanupPlanResponseSchema.parse(response).plan;
}

export async function executeWorkspaceCleanup(input: WorkspaceCleanupExecuteRequest): Promise<WorkspaceCleanupResult> {
  const response = await request("/workspaces/cleanup/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return WorkspaceCleanupExecuteResponseSchema.parse(response).result;
}

export async function getProviders(): Promise<ProviderHealth[]> {
  const response = await request("/providers");
  return ProvidersResponseSchema.parse(response).providers;
}

export async function getProviderHealth(provider: ProviderId): Promise<ProviderHealth> {
  const response = await request(`/providers/${provider}/health`);
  return ProviderHealthResponseSchema.parse(response).provider;
}

export async function getRunApprovals(runId: string): Promise<ApprovalState[]> {
  const response = await request(`/runs/${runId}/approvals`);
  return ApprovalsResponseSchema.parse(response).approvals;
}

export async function respondApproval(approvalId: string, decision: ApprovalResponseRequest["decision"]): Promise<ApprovalState> {
  const response = await request(`/approvals/${encodeURIComponent(approvalId)}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  return (response as { approval: ApprovalState }).approval;
}

export async function startRun(issueId: string, provider?: ProviderId): Promise<Run> {
  const response = await request("/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ issueId, provider }),
  });
  return RunResponseSchema.parse(response).run;
}

export async function stopRun(runId: string): Promise<Run> {
  const response = await request(`/runs/${runId}/stop`, { method: "POST" });
  return RunResponseSchema.parse(response).run;
}

export async function retryRun(runId: string): Promise<Run> {
  const response = await request(`/runs/${runId}/retry`, { method: "POST" });
  return RunResponseSchema.parse(response).run;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${DAEMON_URL}${path}`, {
    ...init,
    cache: "no-store",
  });

  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload
        ? String(payload.error)
        : `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return payload;
}
