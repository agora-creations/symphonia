import { describe, expect, it } from "vitest";
import { AgentEventSchema, IssueSchema, RunSchema } from "../src/index";

const timestamp = "2026-05-13T08:00:00.000Z";

describe("shared schemas", () => {
  it("parses a valid issue", () => {
    const issue = IssueSchema.parse({
      id: "issue-1",
      identifier: "SYM-1",
      title: "Build board",
      description: "Render mock issues.",
      state: "Todo",
      labels: ["frontend"],
      priority: "High",
      createdAt: timestamp,
      updatedAt: timestamp,
      url: "https://mock.local/issues/SYM-1",
    });

    expect(issue.identifier).toBe("SYM-1");
  });

  it("parses a valid run", () => {
    const run = RunSchema.parse({
      id: "run-1",
      issueId: "issue-1",
      issueIdentifier: "SYM-1",
      status: "queued",
      provider: "mock",
      startedAt: timestamp,
      endedAt: null,
      error: null,
    });

    expect(run.status).toBe("queued");
  });

  it("parses several valid agent events", () => {
    const events = [
      {
        id: "event-1",
        runId: "run-1",
        type: "run.status",
        timestamp,
        status: "streaming",
      },
      {
        id: "event-2",
        runId: "run-1",
        type: "agent.message",
        timestamp,
        role: "assistant",
        message: "Inspecting repository.",
      },
      {
        id: "event-3",
        runId: "run-1",
        type: "tool.call",
        timestamp,
        toolName: "shell",
        command: "pnpm test",
        status: "completed",
      },
      {
        id: "event-4",
        runId: "run-1",
        type: "usage",
        timestamp,
        inputTokens: 120,
        outputTokens: 80,
        totalTokens: 200,
      },
      {
        id: "event-5",
        runId: "run-1",
        type: "artifact",
        timestamp,
        artifactType: "diff",
        title: "Mock diff",
        content: "+ added",
      },
    ];

    expect(events.map((event) => AgentEventSchema.parse(event))).toHaveLength(5);
  });

  it("rejects invalid event payloads", () => {
    expect(() =>
      AgentEventSchema.parse({
        id: "event-bad",
        runId: "run-1",
        type: "tool.call",
        timestamp,
        toolName: "shell",
        status: "not-a-status",
      }),
    ).toThrow();
  });
});
