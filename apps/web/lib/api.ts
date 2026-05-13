import {
  AgentEvent,
  EventsResponseSchema,
  HealthResponseSchema,
  IssuesResponseSchema,
  Run,
  RunResponseSchema,
  RunsResponseSchema,
  PromptResponseSchema,
  WorkflowConfigResponseSchema,
  WorkflowStatus,
  WorkflowStatusResponseSchema,
  WorkspaceInfo,
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

export async function getRuns(): Promise<Run[]> {
  const response = await request("/runs");
  return RunsResponseSchema.parse(response).runs;
}

export async function getRunEvents(runId: string): Promise<AgentEvent[]> {
  const response = await request(`/runs/${runId}/events`);
  return EventsResponseSchema.parse(response).events;
}

export async function getRunPrompt(runId: string): Promise<string | null> {
  const response = await request(`/runs/${runId}/prompt`);
  return PromptResponseSchema.parse(response).prompt;
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

export async function getWorkspaces(): Promise<WorkspaceInfo[]> {
  const response = await request("/workspaces");
  return WorkspacesResponseSchema.parse(response).workspaces;
}

export async function getWorkspace(issueIdentifier: string): Promise<WorkspaceInfo> {
  const response = await request(`/workspaces/${encodeURIComponent(issueIdentifier)}`);
  return WorkspaceResponseSchema.parse(response).workspace;
}

export async function startRun(issueId: string): Promise<Run> {
  const response = await request("/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ issueId }),
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
