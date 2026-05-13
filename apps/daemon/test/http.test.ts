import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "@symphonia/db";
import { AgentEvent, ApprovalState, WorkflowStatus } from "@symphonia/types";
import { createDaemonServer, SymphoniaDaemon } from "../src/daemon";

let directory: string;
let daemon: SymphoniaDaemon;
let workflowPath: string;
const originalEnv = { ...process.env };

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "symphonia-daemon-"));
  workflowPath = join(directory, "WORKFLOW.md");
  writeWorkflow();
  process.env.SYMPHONIA_MOCK_DELAY_MS = "1";

  const created = createDaemonServer(new EventStore(join(directory, "test.sqlite")), { workflowPath, cwd: directory });
  daemon = created.daemon;
});

afterEach(() => {
  daemon.close();
  rmSync(directory, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe("daemon API", () => {
  it("creates an HTTP server", () => {
    const { server } = createDaemonServer(new EventStore(join(directory, "second.sqlite")));

    expect(server.listening).toBe(false);
    server.close();
  });

  it("reports workflow status and redacted config", () => {
    const status = daemon.refreshWorkflowStatus();

    expect(status.status).toBe("healthy");
    expect(status.effectiveConfigSummary?.trackerKind).toBe("mock");
    expect(JSON.stringify(status.effectiveConfigSummary)).not.toContain("apiKey");
  });

  it("reports provider health without crashing", async () => {
    const providers = await daemon.listProviderHealth();

    expect(providers.some((provider) => provider.id === "mock" && provider.available)).toBe(true);
    expect(providers.some((provider) => provider.id === "codex")).toBe(true);

    writeWorkflow({ codexCommand: "definitely-not-a-symphonia-command" });
    daemon.refreshWorkflowStatus();
    const codex = await daemon.getProviderHealth("codex");
    expect(codex.available).toBe(false);
  });

  it("runs workflow, workspace, prompt, hook, and mock provider events", async () => {
    const created = await daemon.startRun("issue-frontend-board");

    await waitForTerminal(created.id, "succeeded");
    await waitForEvent(created.id, "hook.succeeded", 3);
    const events = getEvents(created.id);
    const types = events.map((event) => event.type);

    expect(types.indexOf("workflow.loaded")).toBeLessThan(types.indexOf("workspace.ready"));
    expect(types.indexOf("workspace.ready")).toBeLessThan(types.indexOf("prompt.rendered"));
    expect(types).toContain("hook.started");
    expect(types).toContain("hook.succeeded");
    expect(types).toContain("agent.message");
    expect(types.at(-1)).toBe("hook.succeeded");

    const workspaceEvent = events.find((event) => event.type === "workspace.ready");
    expect(workspaceEvent?.type === "workspace.ready" ? workspaceEvent.workspace.path : "").toContain("SYM-1");
    expect(existsSync(workspaceEvent?.type === "workspace.ready" ? workspaceEvent.workspace.path : "")).toBe(true);

    const hookEvent = events.find((event) => event.type === "hook.succeeded" && event.hook.stdout.includes("Preparing"));
    expect(hookEvent?.type === "hook.succeeded" ? hookEvent.hook.stdout : "").toContain("Preparing");

    expect(daemon.getRunPrompt(created.id)).toContain("Build Linear-like board columns");

    const workspace = daemon.getWorkspaceInfo("SYM-1");
    expect(workspace.exists).toBe(true);
    expect(daemon.listWorkspaces().some((item) => item.issueIdentifier === "SYM-1")).toBe(true);
  });

  it("reloads invalid workflow status without crashing", async () => {
    writeFileSync(workflowPath, "---\ntracker: [\n---\nPrompt");
    const status: WorkflowStatus = daemon.refreshWorkflowStatus();

    expect(status.status).toBe("invalid");
    expect(status.error).toContain("workflow_yaml_invalid");

    const created = await daemon.startRun("issue-frontend-board");
    await waitForTerminal(created.id, "failed");
    expect(getEvents(created.id).some((event) => event.type === "workflow.invalid")).toBe(true);
  });

  it("keeps stop and retry behavior working", async () => {
    process.env.SYMPHONIA_MOCK_DELAY_MS = "50";
    const created = await daemon.startRun("issue-blocked-looking");

    const stopped = await daemon.stopRun(created.id);
    expect(stopped.status).toBe("cancelled");

    const retried = await daemon.retryRun(created.id);
    expect(retried.status).toBe("queued");
    await waitForTerminal(retried.id, "succeeded");
  });

  it("runs the codex provider against a fake app-server", async () => {
    writeWorkflow({ codexCommand: fakeCodexCommand("success") });

    const created = await daemon.startRun("issue-frontend-board", "codex");

    expect(created.provider).toBe("codex");
    await waitForTerminal(created.id, "succeeded");
    const types = getEvents(created.id).map((event) => event.type);

    expect(types).toEqual(expect.arrayContaining(["provider.started", "codex.thread.started", "codex.turn.started"]));
    expect(types).toContain("codex.assistant.delta");
    expect(types).toContain("codex.turn.completed");
  });

  it("handles codex approval requests through the daemon registry", async () => {
    writeWorkflow({ codexCommand: fakeCodexCommand("approval") });

    const created = await daemon.startRun("issue-frontend-board", "codex");
    await waitForApproval(created.id);

    const pending = daemon.listApprovals(created.id);
    expect(pending[0]?.status).toBe("pending");
    expect(pending[0]?.command).toBe("pnpm test");

    await respondApproval(pending[0]!.approvalId, "accept");
    await waitForTerminal(created.id, "succeeded");

    const approvals = daemon.listApprovals(created.id);
    expect(approvals[0]?.status).toBe("resolved");
    expect(getEvents(created.id).some((event) => event.type === "approval.resolved" && event.resolution === "accept")).toBe(true);
  });

  it("fails codex runs gracefully when the command is unavailable", async () => {
    writeWorkflow({ codexCommand: "definitely-not-a-symphonia-command" });

    const created = await daemon.startRun("issue-frontend-board", "codex");
    await waitForTerminal(created.id, "failed");

    expect(getEvents(created.id).some((event) => event.type === "codex.error")).toBe(true);
  });

  it("interrupts active codex turns when stopped", async () => {
    writeWorkflow({ codexCommand: fakeCodexCommand("wait") });

    const created = await daemon.startRun("issue-frontend-board", "codex");
    await waitForEvent(created.id, "codex.turn.started");

    await daemon.stopRun(created.id);
    await waitForTerminal(created.id, "cancelled");
    await waitForEvent(created.id, "codex.turn.completed");

    expect(getEvents(created.id).some((event) => event.type === "codex.turn.completed" && event.status === "interrupted")).toBe(true);
  });
});

async function waitForTerminal(runId: string, expectedStatus: string): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (daemon.requireRun(runId).status === expectedStatus) return;
    await sleep(20);
  }
  throw new Error(`Run ${runId} did not reach ${expectedStatus}.`);
}

async function waitForEvent(runId: string, eventType: string, minimumCount = 1): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (getEvents(runId).filter((event) => event.type === eventType).length >= minimumCount) return;
    await sleep(20);
  }
  throw new Error(`Run ${runId} did not emit ${minimumCount} ${eventType} events.`);
}

async function waitForApproval(runId: string): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (daemon.listApprovals(runId).some((approval) => approval.status === "pending")) return;
    await sleep(20);
  }
  throw new Error(`Run ${runId} did not create a pending approval.`);
}

function getEvents(runId: string): AgentEvent[] {
  return (daemon as unknown as { eventStore: EventStore }).eventStore.getEventsForRun(runId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function respondApproval(approvalId: string, decision: "accept" | "acceptForSession" | "decline" | "cancel"): Promise<ApprovalState> {
  return (daemon as unknown as {
    respondApproval: (approvalId: string, decision: "accept" | "acceptForSession" | "decline" | "cancel") => Promise<ApprovalState>;
  }).respondApproval(approvalId, decision);
}

function writeWorkflow(options: { codexCommand?: string; provider?: "mock" | "codex" } = {}): void {
  writeFileSync(
    workflowPath,
    `---
provider: ${options.provider ?? "mock"}
tracker:
  kind: mock
workspace:
  root: "./workspaces"
codex:
  command: ${JSON.stringify(options.codexCommand ?? "codex app-server")}
  model: "fake-model"
  approval_policy: "on-request"
  turn_sandbox_policy: "workspaceWrite"
  turn_timeout_ms: 2000
  read_timeout_ms: 1000
  stall_timeout_ms: 1000
hooks:
  timeout_ms: 1000
  after_create: |
    printf "Created in $(pwd)\\n"
  before_run: |
    printf "Preparing in $(pwd)\\n"
  after_run: |
    printf "Finished in $(pwd)\\n"
---
You are working on {{ issue.identifier }}.

Title:
{{ issue.title }}
`,
  );
}

function fakeCodexCommand(mode: string): string {
  const serverPath = join(directory, `fake-codex-${mode}.mjs`);
  writeFileSync(serverPath, fakeServerSource());
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(serverPath)} ${mode}`;
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
  send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "Daemon fake Codex delta." } });
  send({ method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", completedAtMs: Date.now(), item: { type: "agentMessage", id: "item-1", text: "Daemon fake Codex delta.", phase: null, memoryCitation: null } } });
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
  } else if (message.method === "turn/start") {
    send({ id: message.id, result: { turn: turn() } });
    send({ method: "turn/started", params: { threadId: "thread-1", turn: turn() } });
    activeTurn = true;
    if (mode === "approval") {
      send({ id: "approval-1", method: "item/commandExecution/requestApproval", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-command", startedAtMs: Date.now(), approvalId: "approval-1", reason: "Run tests", command: "pnpm test", cwd: message.params.cwd, availableDecisions: ["accept", "acceptForSession", "decline", "cancel"] } });
      return;
    }
    if (mode === "wait") return;
    complete();
  } else if (message.id === "approval-1") {
    complete(message.result?.decision === "accept" ? "completed" : "failed");
  } else if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    if (activeTurn) complete("interrupted");
  }
});
`;
}
