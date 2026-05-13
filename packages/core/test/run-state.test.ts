import { describe, expect, it } from "vitest";
import { applyRunStatus, canStartRunForIssue, createQueuedRun, createRetryRun } from "../src";

const timestamp = "2026-05-13T08:00:00.000Z";

describe("run state transitions", () => {
  it("starts a queued run", () => {
    const run = createQueuedRun({
      id: "run-1",
      issueId: "issue-1",
      issueIdentifier: "SYM-1",
      timestamp,
    });

    expect(run.status).toBe("queued");
    expect(run.startedAt).toBe(timestamp);
  });

  it("prevents concurrent starts for the same issue", () => {
    const run = createQueuedRun({
      id: "run-1",
      issueId: "issue-1",
      issueIdentifier: "SYM-1",
      timestamp,
    });

    expect(canStartRunForIssue([run], "issue-1")).toBe(false);
    expect(canStartRunForIssue([applyRunStatus(run, "succeeded", timestamp)], "issue-1")).toBe(true);
  });

  it("marks a run succeeded", () => {
    const run = createQueuedRun({
      id: "run-1",
      issueId: "issue-1",
      issueIdentifier: "SYM-1",
      timestamp,
    });

    const next = applyRunStatus(run, "succeeded", "2026-05-13T08:01:00.000Z");
    expect(next.status).toBe("succeeded");
    expect(next.endedAt).toBe("2026-05-13T08:01:00.000Z");
  });

  it("marks a run failed with an error", () => {
    const run = createQueuedRun({
      id: "run-1",
      issueId: "issue-1",
      issueIdentifier: "SYM-1",
      timestamp,
    });

    const next = applyRunStatus(run, "failed", "2026-05-13T08:01:00.000Z", "Mock failure");
    expect(next.status).toBe("failed");
    expect(next.error).toBe("Mock failure");
  });

  it("marks a run cancelled", () => {
    const run = createQueuedRun({
      id: "run-1",
      issueId: "issue-1",
      issueIdentifier: "SYM-1",
      timestamp,
    });

    const next = applyRunStatus(run, "cancelled", "2026-05-13T08:01:00.000Z");
    expect(next.status).toBe("cancelled");
    expect(next.endedAt).toBe("2026-05-13T08:01:00.000Z");
  });

  it("creates a retry run from a terminal run", () => {
    const run = applyRunStatus(
      createQueuedRun({
        id: "run-1",
        issueId: "issue-1",
        issueIdentifier: "SYM-1",
        timestamp,
      }),
      "failed",
      "2026-05-13T08:01:00.000Z",
      "Mock failure",
    );

    const retry = createRetryRun({
      previousRun: run,
      id: "run-2",
      timestamp: "2026-05-13T08:02:00.000Z",
    });

    expect(retry.id).toBe("run-2");
    expect(retry.issueId).toBe(run.issueId);
    expect(retry.status).toBe("queued");
  });
});
