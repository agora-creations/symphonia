import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentEvent } from "@symphonia/types";
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
});
