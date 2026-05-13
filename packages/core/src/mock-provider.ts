import { randomUUID } from "node:crypto";
import { AgentEvent, Issue, Run, RunStatus } from "@symphonia/types";
import { isDesignatedFailureIssue } from "./mock-tracker.js";
import { nowIso } from "./time.js";

export type EmitAgentEvent = (event: AgentEvent) => Promise<void> | void;

export type MockProviderOptions = {
  run: Run;
  issue: Issue;
  attempt: number;
  signal: AbortSignal;
  emit: EmitAgentEvent;
  delayMs?: number;
};

type PlannedEvent =
  | { type: "run.status"; status: RunStatus; message?: string; error?: string }
  | { type: "agent.message"; message: string }
  | { type: "tool.call"; toolName: string; command: string; status: "started" | "completed"; output?: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "artifact"; title: string; content: string };

export class MockRunCancelledError extends Error {
  constructor() {
    super("Mock run was cancelled.");
    this.name = "MockRunCancelledError";
  }
}

export async function runMockAgentProvider(options: MockProviderOptions): Promise<void> {
  const delayMs = options.delayMs ?? 450;
  const plan = buildPlan(options.issue, options.attempt);

  for (const planned of plan) {
    throwIfCancelled(options.signal);
    await sleep(delayMs, options.signal);
    throwIfCancelled(options.signal);
    await options.emit(toAgentEvent(options.run.id, planned));
  }
}

function buildPlan(issue: Issue, attempt: number): PlannedEvent[] {
  const failureRun = isDesignatedFailureIssue(issue.id) && attempt === 1;

  const shared: PlannedEvent[] = [
    { type: "run.status", status: "preparing_workspace", message: "Preparing mock workspace." },
    { type: "run.status", status: "building_prompt", message: "Building task prompt." },
    { type: "run.status", status: "launching_agent", message: "Launching mock agent provider." },
    { type: "run.status", status: "streaming", message: "Mock agent is streaming." },
    { type: "agent.message", message: `Inspecting repository context for ${issue.identifier}.` },
    { type: "tool.call", toolName: "shell", command: "git status --short", status: "completed", output: "mock clean worktree" },
    { type: "agent.message", message: "Implementing the requested local change in the mock workspace." },
    { type: "tool.call", toolName: "shell", command: "pnpm test", status: "completed", output: "mock tests passed" },
    {
      type: "artifact",
      title: "Mock diff",
      content: `diff --git a/${issue.identifier}.md b/${issue.identifier}.md\n+Completed mock implementation for ${issue.title}`,
    },
    { type: "usage", inputTokens: 1440, outputTokens: 860 },
  ];

  if (failureRun) {
    return [
      ...shared,
      { type: "agent.message", message: "Detected a deterministic mock failure for the rework issue." },
      {
        type: "run.status",
        status: "failed",
        message: "Mock provider failed on the first attempt.",
        error: "Deterministic failure for retry validation.",
      },
    ];
  }

  return [
    ...shared,
    { type: "agent.message", message: "Validated the fake loop and prepared final handoff." },
    { type: "run.status", status: "succeeded", message: "Mock run completed successfully." },
  ];
}

function toAgentEvent(runId: string, planned: PlannedEvent): AgentEvent {
  const common = {
    id: randomUUID(),
    runId,
    timestamp: nowIso(),
  };

  switch (planned.type) {
    case "run.status":
      return {
        ...common,
        type: "run.status",
        status: planned.status,
        message: planned.message,
        error: planned.error,
      };
    case "agent.message":
      return {
        ...common,
        type: "agent.message",
        role: "assistant",
        message: planned.message,
      };
    case "tool.call":
      return {
        ...common,
        type: "tool.call",
        toolName: planned.toolName,
        command: planned.command,
        status: planned.status,
        output: planned.output,
      };
    case "usage":
      return {
        ...common,
        type: "usage",
        inputTokens: planned.inputTokens,
        outputTokens: planned.outputTokens,
        totalTokens: planned.inputTokens + planned.outputTokens,
      };
    case "artifact":
      return {
        ...common,
        type: "artifact",
        artifactType: "diff",
        title: planned.title,
        content: planned.content,
      };
  }
}

function sleep(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new MockRunCancelledError());
      },
      { once: true },
    );
  });
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new MockRunCancelledError();
  }
}
