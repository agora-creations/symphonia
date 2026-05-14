import { AgentEvent, isTerminalRunStatus, ProviderId, Run, RunStatus } from "@symphonia/types";

export function createQueuedRun(input: {
  id: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle?: string | null;
  trackerKind?: Run["trackerKind"];
  provider?: ProviderId;
  attempt?: number;
  retryOfRunId?: string | null;
  timestamp: string;
  daemonInstanceId?: string | null;
}): Run {
  return {
    id: input.id,
    issueId: input.issueId,
    issueIdentifier: input.issueIdentifier,
    issueTitle: input.issueTitle ?? null,
    trackerKind: input.trackerKind ?? "linear",
    status: "queued",
    provider: input.provider ?? "codex",
    attempt: input.attempt ?? 1,
    retryOfRunId: input.retryOfRunId ?? null,
    workspacePath: null,
    renderedPromptId: null,
    providerMetadata: {},
    startedAt: input.timestamp,
    updatedAt: input.timestamp,
    endedAt: null,
    lastEventAt: null,
    terminalReason: null,
    error: null,
    recoveryState: "active",
    recoveredAt: null,
    createdByDaemonInstanceId: input.daemonInstanceId ?? null,
    lastSeenDaemonInstanceId: input.daemonInstanceId ?? null,
  };
}

export function canStartRunForIssue(runs: Run[], issueId: string): boolean {
  return !runs.some((run) => run.issueId === issueId && !isTerminalRunStatus(run.status));
}

export function applyRunEvent(run: Run, event: AgentEvent): Run {
  if (event.type === "run.status") {
    return applyRunStatus(run, event.status, event.timestamp, event.error);
  }

  const base = {
    ...run,
    updatedAt: event.timestamp,
    lastEventAt: event.timestamp,
  };

  if (event.type === "workspace.ready") {
    return { ...base, workspacePath: event.workspace.path };
  }

  if (event.type === "prompt.rendered") {
    return { ...base, renderedPromptId: event.id };
  }

  if (event.type === "codex.thread.started") {
    return { ...base, providerMetadata: { ...run.providerMetadata, threadId: event.threadId } };
  }

  if (event.type === "codex.turn.started") {
    return { ...base, providerMetadata: { ...run.providerMetadata, turnId: event.turnId } };
  }

  if ("sessionId" in event && typeof event.sessionId === "string" && event.sessionId.length > 0) {
    return { ...base, providerMetadata: { ...run.providerMetadata, sessionId: event.sessionId } };
  }

  if ("requestId" in event && typeof event.requestId === "string" && event.requestId.length > 0) {
    return { ...base, providerMetadata: { ...run.providerMetadata, requestId: event.requestId } };
  }

  return base;
}

export function applyRunStatus(
  run: Run,
  status: RunStatus,
  timestamp: string,
  error?: string,
): Run {
  const endedAt = isTerminalRunStatus(status) ? timestamp : run.endedAt;

  return {
    ...run,
    status,
    updatedAt: timestamp,
    lastEventAt: timestamp,
    endedAt,
    terminalReason: isTerminalRunStatus(status) ? error ?? status : run.terminalReason,
    recoveryState: isTerminalRunStatus(status) ? run.recoveryState === "interrupted_by_restart" ? "interrupted_by_restart" : "terminal" : "active",
    error: error ?? (status === "failed" || status === "interrupted" || status === "orphaned" ? run.error : null),
  };
}

export function createRetryRun(input: {
  previousRun: Run;
  id: string;
  timestamp: string;
  daemonInstanceId?: string | null;
}): Run {
  if (!isTerminalRunStatus(input.previousRun.status)) {
    throw new Error("Only terminal runs can be retried.");
  }

  return createQueuedRun({
    id: input.id,
    issueId: input.previousRun.issueId,
    issueIdentifier: input.previousRun.issueIdentifier,
    issueTitle: input.previousRun.issueTitle,
    trackerKind: input.previousRun.trackerKind,
    provider: input.previousRun.provider,
    attempt: input.previousRun.attempt + 1,
    retryOfRunId: input.previousRun.id,
    timestamp: input.timestamp,
    daemonInstanceId: input.daemonInstanceId ?? input.previousRun.lastSeenDaemonInstanceId,
  });
}
