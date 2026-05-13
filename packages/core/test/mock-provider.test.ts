import { describe, expect, it } from "vitest";
import { listMockIssues, runMockAgentProvider } from "../src";
import { createQueuedRun } from "../src/run-state";

const timestamp = "2026-05-13T08:00:00.000Z";

describe("mock provider", () => {
  it("emits a successful timeline for normal issues", async () => {
    const issue = listMockIssues().find((item) => item.id === "issue-frontend-board");
    expect(issue).toBeDefined();

    const run = createQueuedRun({
      id: "run-1",
      issueId: issue!.id,
      issueIdentifier: issue!.identifier,
      timestamp,
    });
    const events: string[] = [];

    await runMockAgentProvider({
      run,
      issue: issue!,
      attempt: 1,
      signal: new AbortController().signal,
      delayMs: 0,
      emit: (event) => {
        events.push(event.type === "run.status" ? event.status : event.type);
      },
    });

    expect(events).toContain("succeeded");
    expect(events).toContain("artifact");
  });

  it("fails the designated rework issue on first attempt and succeeds on retry", async () => {
    const issue = listMockIssues().find((item) => item.id === "issue-rework-failing-run");
    expect(issue).toBeDefined();

    const firstRun = createQueuedRun({
      id: "run-1",
      issueId: issue!.id,
      issueIdentifier: issue!.identifier,
      timestamp,
    });
    const firstEvents: string[] = [];

    await runMockAgentProvider({
      run: firstRun,
      issue: issue!,
      attempt: 1,
      signal: new AbortController().signal,
      delayMs: 0,
      emit: (event) => {
        if (event.type === "run.status") firstEvents.push(event.status);
      },
    });

    const retryRun = createQueuedRun({
      id: "run-2",
      issueId: issue!.id,
      issueIdentifier: issue!.identifier,
      timestamp,
    });
    const retryEvents: string[] = [];

    await runMockAgentProvider({
      run: retryRun,
      issue: issue!,
      attempt: 2,
      signal: new AbortController().signal,
      delayMs: 0,
      emit: (event) => {
        if (event.type === "run.status") retryEvents.push(event.status);
      },
    });

    expect(firstEvents).toContain("failed");
    expect(retryEvents).toContain("succeeded");
  });
});
