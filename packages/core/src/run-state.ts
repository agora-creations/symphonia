import { AgentEvent, isTerminalRunStatus, Run, RunStatus } from "@symphonia/types";

export function createQueuedRun(input: {
  id: string;
  issueId: string;
  issueIdentifier: string;
  provider?: string;
  timestamp: string;
}): Run {
  return {
    id: input.id,
    issueId: input.issueId,
    issueIdentifier: input.issueIdentifier,
    status: "queued",
    provider: input.provider ?? "mock",
    startedAt: input.timestamp,
    endedAt: null,
    error: null,
  };
}

export function canStartRunForIssue(runs: Run[], issueId: string): boolean {
  return !runs.some((run) => run.issueId === issueId && !isTerminalRunStatus(run.status));
}

export function applyRunEvent(run: Run, event: AgentEvent): Run {
  if (event.type !== "run.status") {
    return run;
  }

  return applyRunStatus(run, event.status, event.timestamp, event.error);
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
    endedAt,
    error: error ?? (status === "failed" ? run.error : null),
  };
}

export function createRetryRun(input: {
  previousRun: Run;
  id: string;
  timestamp: string;
}): Run {
  if (!isTerminalRunStatus(input.previousRun.status)) {
    throw new Error("Only terminal runs can be retried.");
  }

  return createQueuedRun({
    id: input.id,
    issueId: input.previousRun.issueId,
    issueIdentifier: input.previousRun.issueIdentifier,
    provider: input.previousRun.provider,
    timestamp: input.timestamp,
  });
}
