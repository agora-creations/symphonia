import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentEvent, Issue, ReviewArtifactSnapshot, Run } from "@symphonia/types";
import { EventStore } from "../src";

let directory: string;
let store: EventStore;

function event(input: Partial<AgentEvent> & { id: string; runId: string; timestamp: string }): AgentEvent {
  return {
    type: "agent.message",
    role: "assistant",
    message: "Test event",
    ...input,
  } as AgentEvent;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "symphonia-event-store-"));
  store = new EventStore(join(directory, "test.sqlite"));
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("EventStore", () => {
  it("appends and fetches events", () => {
    store.append(event({ id: "event-1", runId: "run-1", timestamp: "2026-05-13T08:00:00.000Z" }));

    expect(store.getEventsForRun("run-1")).toHaveLength(1);
  });

  it("returns events in chronological order", () => {
    store.append(event({ id: "event-2", runId: "run-1", timestamp: "2026-05-13T08:02:00.000Z" }));
    store.append(event({ id: "event-1", runId: "run-1", timestamp: "2026-05-13T08:01:00.000Z" }));

    const events = store.getEventsForRun("run-1");

    expect(events.map((item) => item.id)).toEqual(["event-1", "event-2"]);
  });

  it("does not return events from another run", () => {
    store.append(event({ id: "event-1", runId: "run-1", timestamp: "2026-05-13T08:01:00.000Z" }));
    store.append(event({ id: "event-2", runId: "run-2", timestamp: "2026-05-13T08:01:00.000Z" }));

    const events = store.getEventsForRun("run-1");

    expect(events).toHaveLength(1);
    expect(events[0]?.runId).toBe("run-1");
  });

  it("caches issues by tracker and identifier", () => {
    const fetchedAt = "2026-05-13T08:02:00.000Z";
    store.upsertIssues([issue("ENG-1", "Todo"), issue("ENG-2", "Done")], fetchedAt);

    expect(store.listIssues("linear").map((item) => item.identifier)).toEqual(["ENG-1", "ENG-2"]);
    expect(store.getIssue("issue-ENG-1")?.identifier).toBe("ENG-1");
    expect(store.getIssueByIdentifier("ENG-2")?.state).toBe("Done");
    expect(store.getIssueCacheStats("linear")).toEqual({
      issueCount: 2,
      lastFetchedAt: fetchedAt,
    });

    store.upsertIssues([issue("ENG-1", "In Progress")], "2026-05-13T08:03:00.000Z");
    expect(store.getIssue("issue-ENG-1")?.state).toBe("In Progress");
  });

  it("saves and fetches latest review artifact snapshots", () => {
    const first = reviewArtifactSnapshot("run-1", "ENG-1", "2026-05-13T08:04:00.000Z");
    const second = reviewArtifactSnapshot("run-2", "ENG-1", "2026-05-13T08:05:00.000Z");

    store.saveReviewArtifactSnapshot(first);
    store.saveReviewArtifactSnapshot(second);

    expect(store.getReviewArtifactSnapshot("run-1")).toMatchObject({
      runId: "run-1",
      issueIdentifier: "ENG-1",
      diff: { filesChanged: 1 },
    });
    expect(store.getLatestReviewArtifactSnapshotByIssue("issue-ENG-1")?.runId).toBe("run-2");
    expect(store.getLatestReviewArtifactSnapshotByIdentifier("ENG-1")?.runId).toBe("run-2");

    store.saveReviewArtifactSnapshot({ ...first, error: "refresh failed", lastRefreshedAt: "2026-05-13T08:06:00.000Z" });
    expect(store.getReviewArtifactSnapshot("run-1")?.error).toBe("refresh failed");
  });

  it("saves and fetches durable run records", () => {
    const first = runRecord("run-1", "queued");
    store.saveRun(first);

    expect(store.getRun("run-1")).toMatchObject({
      id: "run-1",
      issueIdentifier: "ENG-1",
      status: "queued",
      recoveryState: "active",
    });

    store.saveRun({
      ...first,
      status: "succeeded",
      endedAt: "2026-05-13T08:03:00.000Z",
      updatedAt: "2026-05-13T08:03:00.000Z",
      recoveryState: "terminal",
    });

    expect(store.listRuns().map((item) => item.id)).toEqual(["run-1"]);
    expect(store.getRun("run-1")).toMatchObject({
      status: "succeeded",
      endedAt: "2026-05-13T08:03:00.000Z",
      recoveryState: "terminal",
    });
  });
});

function issue(identifier: string, state: string): Issue {
  return {
    id: `issue-${identifier}`,
    identifier,
    title: identifier,
    description: "",
    state,
    labels: ["backend"],
    priority: "High",
    createdAt: "2026-05-13T08:00:00.000Z",
    updatedAt: "2026-05-13T08:01:00.000Z",
    url: `https://linear.app/acme/issue/${identifier}`,
    tracker: { kind: "linear", sourceId: `issue-${identifier}`, teamKey: "ENG" },
  };
}

function reviewArtifactSnapshot(runId: string, identifier: string, lastRefreshedAt: string): ReviewArtifactSnapshot {
  return {
    runId,
    issueId: `issue-${identifier}`,
    issueIdentifier: identifier,
    provider: "mock",
    trackerKind: "linear",
    workspace: {
      issueIdentifier: identifier,
      workspaceKey: identifier,
      path: `/tmp/${identifier}`,
      createdNow: false,
      exists: true,
    },
    git: {
      workspacePath: `/tmp/${identifier}`,
      isGitRepo: true,
      remoteUrl: "https://github.com/agora-creations/symphonia.git",
      remoteName: "origin",
      currentBranch: `feature/${identifier}`,
      baseBranch: "main",
      headSha: "0123456789012345678901234567890123456789",
      baseSha: "1123456789012345678901234567890123456789",
      mergeBaseSha: "1123456789012345678901234567890123456789",
      isDirty: true,
      changedFileCount: 1,
      untrackedFileCount: 0,
      stagedFileCount: 0,
      unstagedFileCount: 1,
      lastCheckedAt: lastRefreshedAt,
    },
    pr: null,
    diff: {
      filesChanged: 1,
      additions: 2,
      deletions: 1,
      files: [
        {
          path: "README.md",
          status: "modified",
          additions: 2,
          deletions: 1,
          isBinary: false,
          oldPath: null,
          patch: "@@",
          source: "local",
        },
      ],
    },
    checks: [],
    commitStatus: null,
    workflowRuns: [],
    lastRefreshedAt,
    error: null,
  };
}

function runRecord(id: string, status: Run["status"]): Run {
  return {
    id,
    issueId: "issue-ENG-1",
    issueIdentifier: "ENG-1",
    issueTitle: "Durable run",
    trackerKind: "linear",
    status,
    provider: "mock",
    attempt: 1,
    retryOfRunId: null,
    workspacePath: "/tmp/ENG-1",
    renderedPromptId: null,
    providerMetadata: {},
    startedAt: "2026-05-13T08:00:00.000Z",
    updatedAt: "2026-05-13T08:01:00.000Z",
    endedAt: null,
    lastEventAt: "2026-05-13T08:01:00.000Z",
    terminalReason: null,
    error: null,
    recoveryState: "active",
    recoveredAt: null,
    createdByDaemonInstanceId: "daemon-old",
    lastSeenDaemonInstanceId: "daemon-old",
  };
}
