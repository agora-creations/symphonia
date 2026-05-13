import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentEvent, CodexConfig } from "@symphonia/types";
import { checkCodexCommandHealth, CodexAppServerClient, mapCodexNotificationToEvents } from "../src/index";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("codex app-server event mapping", () => {
  it("maps known notifications and ignores unknown notifications", () => {
    const events = mapCodexNotificationToEvents(
      { runId: "run-1" },
      {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          delta: "hello",
        },
      },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "codex.assistant.delta", delta: "hello" });
    expect(mapCodexNotificationToEvents({ runId: "run-1" }, { method: "unknown/event", params: {} })).toEqual([]);
  });
});

describe("codex app-server stdio client", () => {
  it("runs initialize, thread/start, turn/start, deltas, usage, and terminal success", async () => {
    const { events } = await runFakeCodex("success");

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "provider.started",
        "codex.thread.started",
        "codex.turn.started",
        "codex.item.started",
        "codex.assistant.delta",
        "codex.item.completed",
        "codex.usage",
        "codex.turn.completed",
        "run.status",
      ]),
    );
    expect(events.some((event) => event.type === "run.status" && event.status === "succeeded")).toBe(true);
  });

  it("handles approval requests and sends the selected decision", async () => {
    const decisions: string[] = [];
    const { events } = await runFakeCodex("approval", async (request) => {
      decisions.push(request.approvalId);
      return "accept";
    });

    expect(decisions).toEqual(["approval-1"]);
    expect(events.some((event) => event.type === "approval.requested" && event.command === "pnpm test")).toBe(true);
    expect(events.some((event) => event.type === "approval.resolved" && event.resolution === "accept")).toBe(true);
    expect(events.some((event) => event.type === "run.status" && event.status === "succeeded")).toBe(true);
  });

  it("fails cleanly on JSON-RPC errors", async () => {
    await expect(runFakeCodex("error")).rejects.toThrow("turn/start failed");
  });

  it("fails cleanly on malformed JSON without crashing", async () => {
    const events: AgentEvent[] = [];

    await expect(runFakeCodex("malformed", undefined, events)).rejects.toThrow();
    expect(events.some((event) => event.type === "codex.error" && event.code === "malformed_json")).toBe(true);
  });

  it("interrupts active turns on abort", async () => {
    const controller = new AbortController();
    const { promise, events } = runFakeCodexWithController("wait", controller);

    await waitForEvent(events, "codex.turn.started");
    controller.abort();
    await promise;

    expect(events.some((event) => event.type === "codex.turn.completed" && event.status === "interrupted")).toBe(true);
    expect(events.some((event) => event.type === "run.status" && event.status === "cancelled")).toBe(true);
  });

  it("reports unavailable commands without throwing", async () => {
    const health = await checkCodexCommandHealth("definitely-not-a-real-symphonia-command", 200);

    expect(health.available).toBe(false);
    expect(health.error).toBeTruthy();
  });
});

async function runFakeCodex(
  mode: string,
  requestApproval?: Parameters<CodexAppServerClient["run"]>[0]["requestApproval"],
  events: AgentEvent[] = [],
): Promise<{ events: AgentEvent[] }> {
  const controller = new AbortController();
  const { promise } = runFakeCodexWithController(mode, controller, requestApproval, events);
  await promise;
  return { events };
}

function runFakeCodexWithController(
  mode: string,
  controller: AbortController,
  requestApproval?: Parameters<CodexAppServerClient["run"]>[0]["requestApproval"],
  events: AgentEvent[] = [],
): { promise: Promise<void>; events: AgentEvent[] } {
  const directory = mkdtempSync(join(tmpdir(), "symphonia-codex-client-"));
  tempRoots.push(directory);
  const serverPath = join(directory, "fake-app-server.mjs");
  writeFileSync(serverPath, fakeServerSource());

  const client = new CodexAppServerClient();
  const promise = client.run({
    runId: "run-1",
    command: `${quote(process.execPath)} ${quote(serverPath)} ${mode}`,
    cwd: directory,
    prompt: "Work on SYM-1",
    codexConfig: codexConfig(`${quote(process.execPath)} ${quote(serverPath)} ${mode}`),
    signal: controller.signal,
    emit: (event) => {
      events.push(event);
    },
    requestApproval,
  });

  return { promise, events };
}

function codexConfig(command: string): CodexConfig {
  return {
    command,
    model: "fake-model",
    approvalPolicy: "on-request",
    threadSandbox: null,
    turnSandboxPolicy: "workspaceWrite",
    turnTimeoutMs: 2000,
    readTimeoutMs: 1000,
    stallTimeoutMs: 1000,
  };
}

async function waitForEvent(events: AgentEvent[], type: AgentEvent["type"]): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (events.some((event) => event.type === type)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${type}.`);
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function fakeServerSource(): string {
  return `
import readline from "node:readline";

const mode = process.argv[2] ?? "success";
const rl = readline.createInterface({ input: process.stdin });
let activeTurn = false;

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

function turn(status = "inProgress") {
  return { id: "turn-1", items: [], itemsView: "summary", status, error: null, startedAt: 1, completedAt: status === "inProgress" ? null : 2, durationMs: status === "inProgress" ? null : 10 };
}

function complete(status = "completed") {
  send({ method: "item/started", params: { threadId: "thread-1", turnId: "turn-1", startedAtMs: Date.now(), item: { type: "agentMessage", id: "item-1", text: "", phase: null, memoryCitation: null } } });
  send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "Hello from fake Codex." } });
  send({ method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", completedAtMs: Date.now(), item: { type: "agentMessage", id: "item-1", text: "Hello from fake Codex.", phase: null, memoryCitation: null } } });
  send({ method: "thread/tokenUsage/updated", params: { threadId: "thread-1", turnId: "turn-1", tokenUsage: { total: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 0, reasoningOutputTokens: 0 }, last: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 0, reasoningOutputTokens: 0 }, modelContextWindow: 128000 } } });
  send({ method: "turn/completed", params: { threadId: "thread-1", turn: turn(status) } });
  setTimeout(() => process.exit(0), 5);
}

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "fake-codex", codexHome: "/tmp/fake-codex", platformFamily: "unix", platformOs: "macos" } });
  } else if (message.method === "initialized") {
  } else if (message.method === "thread/start") {
    send({ id: message.id, result: { thread: { id: "thread-1", turns: [] }, model: "fake-model", modelProvider: "fake", serviceTier: null, cwd: message.params.cwd, instructionSources: [], approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }, permissionProfile: null, activePermissionProfile: null, reasoningEffort: null } });
    send({ method: "thread/started", params: { thread: { id: "thread-1", turns: [] } } });
  } else if (message.method === "turn/start") {
    if (mode === "error") {
      send({ id: message.id, error: { code: -32000, message: "fake turn failure" } });
      return;
    }
    send({ id: message.id, result: { turn: turn() } });
    send({ method: "turn/started", params: { threadId: "thread-1", turn: turn() } });
    activeTurn = true;
    if (mode === "malformed") {
      process.stdout.write("{not-json\\n");
      return;
    }
    if (mode === "approval") {
      send({ id: "approval-1", method: "item/commandExecution/requestApproval", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-command", startedAtMs: Date.now(), approvalId: "approval-1", reason: "Run tests", command: "pnpm test", cwd: message.params.cwd, availableDecisions: ["accept", "acceptForSession", "decline", "cancel"] } });
      return;
    }
    if (mode === "wait") return;
    complete();
  } else if (message.id === "approval-1") {
    if (message.result?.decision !== "accept") {
      send({ method: "turn/completed", params: { threadId: "thread-1", turn: { ...turn("failed"), error: { message: "approval was not accepted" } } } });
      return;
    }
    send({ method: "serverRequest/resolved", params: { requestId: "approval-1" } });
    complete();
  } else if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    if (activeTurn) complete("interrupted");
  }
});
`;
}
