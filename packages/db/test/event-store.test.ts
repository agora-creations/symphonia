import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentEvent, Issue } from "@symphonia/types";
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
