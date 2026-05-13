import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "@symphonia/db";
import { GitHubFetch, LinearFetch } from "@symphonia/core";
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
    expect(providers.some((provider) => provider.id === "claude" && provider.status === "disabled")).toBe(true);
    expect(providers.some((provider) => provider.id === "cursor" && provider.status === "disabled")).toBe(true);

    writeWorkflow({ codexCommand: "definitely-not-a-symphonia-command" });
    daemon.refreshWorkflowStatus();
    const codex = await daemon.getProviderHealth("codex");
    expect(codex.available).toBe(false);

    const claudeHealth = await requestJson<{ provider: { id: string; available: boolean } }>("GET", "/providers/claude/health");
    const cursorHealth = await requestJson<{ provider: { id: string; available: boolean } }>("GET", "/providers/cursor/health");
    expect(claudeHealth.provider.id).toBe("claude");
    expect(cursorHealth.provider.id).toBe("cursor");
  });

  it("reports tracker status and refreshes mock issue cache", async () => {
    const status = daemon.getTrackerStatus();

    expect(status.kind).toBe("mock");
    expect(status.config?.trackerKind).toBe("mock");
    expect(JSON.stringify(status)).not.toContain("apiKey");

    const issues = await daemon.refreshIssueCache();
    expect(issues.some((issue) => issue.identifier === "SYM-1")).toBe(true);
    expect(daemon.getTrackerStatus().issueCount).toBeGreaterThan(0);
  });

  it("reports github status and health without requiring credentials by default", async () => {
    const status = daemon.getGithubStatus();
    const health = await daemon.getGithubHealth();

    expect(status).toMatchObject({ enabled: false, status: "disabled" });
    expect(health).toMatchObject({ enabled: false, healthy: true, error: null });
  });

  it("reports fake github health with redacted token", async () => {
    const created = createDaemonServer(new EventStore(join(directory, "github.sqlite")), {
      workflowPath,
      cwd: directory,
      githubFetch: fakeGitHubFetch(),
    });
    daemon.close();
    daemon = created.daemon;
    writeWorkflow({ githubToken: "github-secret" });

    const health = await daemon.getGithubHealth();
    const status = daemon.getGithubStatus();

    expect(health).toMatchObject({ enabled: true, healthy: true, error: null });
    expect(status).toMatchObject({ enabled: true, status: "healthy" });
    expect(status.config?.tokenConfigured).toBe(true);
    expect(JSON.stringify(status)).not.toContain("github-secret");
  });

  it("reports linear setup errors without exposing secrets", () => {
    writeLinearWorkflow({ apiKey: "$MISSING_LINEAR_API_KEY", teamKey: "ENG" });

    const status = daemon.getTrackerStatus();

    expect(status.status).toBe("invalid_config");
    expect(status.error).toContain("tracker.api_key is required");
    expect(JSON.stringify(status)).not.toContain("MISSING_LINEAR_API_KEY");
  });

  it("refreshes fake linear issues and starts a mock run from a linear card", async () => {
    const linearFetch = fakeLinearFetch({ state: "Todo" });
    const created = createDaemonServer(new EventStore(join(directory, "linear.sqlite")), {
      workflowPath,
      cwd: directory,
      linearFetch,
    });
    daemon.close();
    daemon = created.daemon;
    writeLinearWorkflow();

    const issues = await daemon.refreshIssueCache();
    expect(issues.map((issue) => issue.identifier)).toEqual(["ENG-101"]);
    expect(daemon.getTrackerStatus()).toMatchObject({ kind: "linear", status: "healthy", issueCount: 1 });

    const run = await daemon.startRun("linear-issue-101", "mock");
    await waitForTerminal(run.id, "succeeded");

    expect(run.provider).toBe("mock");
    expect(daemon.getRunPrompt(run.id)).toContain("Linear-backed daemon test");
    expect(daemon.getRunPrompt(run.id)).toContain("https://linear.app/acme/issue/ENG-101");
    const workspaceEvent = getEvents(run.id).find((event) => event.type === "workspace.ready");
    expect(workspaceEvent?.type === "workspace.ready" ? workspaceEvent.workspace.path : "").toContain("ENG-101");
  });

  it("starts the codex provider from a fake linear issue", async () => {
    const created = createDaemonServer(new EventStore(join(directory, "linear-codex.sqlite")), {
      workflowPath,
      cwd: directory,
      linearFetch: fakeLinearFetch({ state: "Todo" }),
    });
    daemon.close();
    daemon = created.daemon;
    writeLinearWorkflow({ codexCommand: fakeCodexCommand("success") });
    await daemon.refreshIssueCache();

    const run = await daemon.startRun("linear-issue-101", "codex");
    await waitForTerminal(run.id, "succeeded");

    expect(run.provider).toBe("codex");
    expect(getEvents(run.id).map((event) => event.type)).toEqual(
      expect.arrayContaining(["provider.started", "codex.thread.started", "codex.turn.started"]),
    );
  });

  it("reconciles running linear issues that become terminal", async () => {
    let linearState = "Todo";
    process.env.SYMPHONIA_MOCK_DELAY_MS = "50";
    const created = createDaemonServer(new EventStore(join(directory, "linear-reconcile.sqlite")), {
      workflowPath,
      cwd: directory,
      linearFetch: fakeLinearFetch({ getState: () => linearState }),
    });
    daemon.close();
    daemon = created.daemon;
    writeLinearWorkflow();
    await daemon.refreshIssueCache();

    const run = await daemon.startRun("linear-issue-101", "mock");
    await waitForEvent(run.id, "agent.message");

    linearState = "Done";
    await daemon.refreshIssueCache({ reconcile: true });
    await waitForTerminal(run.id, "cancelled");

    const events = getEvents(run.id);
    expect(events.some((event) => event.type === "tracker.reconciled" && event.action === "stopped_terminal")).toBe(true);
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
    expect(types).toContain("github.review_artifacts.refreshed");

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

  it("runs the Claude provider against a fake CLI and refreshes artifacts", async () => {
    writeWorkflow({ provider: "claude", claudeCommand: fakeCliCommand("claude-success") });

    const created = await daemon.startRun("issue-frontend-board", "claude");
    await waitForTerminal(created.id, "succeeded");

    const types = getEvents(created.id).map((event) => event.type);
    expect(created.provider).toBe("claude");
    expect(types).toEqual(expect.arrayContaining(["provider.started", "claude.system.init", "claude.result"]));
    expect(types).toContain("github.review_artifacts.refreshed");
    expect(daemon.getReviewArtifacts(created.id)).toMatchObject({ runId: created.id, provider: "claude" });
  });

  it("runs the Cursor provider against a fake CLI and refreshes artifacts", async () => {
    writeWorkflow({ provider: "cursor", cursorCommand: fakeCliCommand("cursor-success") });

    const created = await daemon.startRun("issue-frontend-board", "cursor");
    await waitForTerminal(created.id, "succeeded");

    const types = getEvents(created.id).map((event) => event.type);
    expect(created.provider).toBe("cursor");
    expect(types).toEqual(expect.arrayContaining(["provider.started", "cursor.system.init", "cursor.result"]));
    expect(types).toContain("github.review_artifacts.refreshed");
    expect(daemon.getReviewArtifacts(created.id)).toMatchObject({ runId: created.id, provider: "cursor" });
  });

  it("stops active Claude and Cursor fake CLI runs", async () => {
    writeWorkflow({ provider: "claude", claudeCommand: fakeCliCommand("claude-wait") });
    const claudeRun = await daemon.startRun("issue-frontend-board", "claude");
    await waitForEvent(claudeRun.id, "claude.system.init");
    await daemon.stopRun(claudeRun.id);
    await waitForTerminal(claudeRun.id, "cancelled");

    writeWorkflow({ provider: "cursor", cursorCommand: fakeCliCommand("cursor-wait") });
    const cursorRun = await daemon.startRun("issue-blocked-looking", "cursor");
    await waitForEvent(cursorRun.id, "cursor.system.init");
    await daemon.stopRun(cursorRun.id);
    await waitForTerminal(cursorRun.id, "cancelled");
  });

  it("retries failed Claude and Cursor fake CLI runs with the current workflow", async () => {
    writeWorkflow({ provider: "claude", claudeCommand: fakeCliCommand("claude-error-result") });
    const failedClaude = await daemon.startRun("issue-frontend-board", "claude");
    await waitForTerminal(failedClaude.id, "failed");
    writeWorkflow({ provider: "claude", claudeCommand: fakeCliCommand("claude-success") });
    const retriedClaude = await daemon.retryRun(failedClaude.id);
    await waitForTerminal(retriedClaude.id, "succeeded");

    writeWorkflow({ provider: "cursor", cursorCommand: fakeCliCommand("cursor-error-result") });
    const failedCursor = await daemon.startRun("issue-blocked-looking", "cursor");
    await waitForTerminal(failedCursor.id, "failed");
    writeWorkflow({ provider: "cursor", cursorCommand: fakeCliCommand("cursor-success") });
    const retriedCursor = await daemon.retryRun(failedCursor.id);
    await waitForTerminal(retriedCursor.id, "succeeded");
  });

  it("persists and serves review artifact snapshots through daemon endpoints", async () => {
    const created = await daemon.startRun("issue-frontend-board");

    await waitForEvent(created.id, "github.review_artifacts.refreshed");
    const stored = daemon.getReviewArtifacts(created.id);
    expect(stored).toMatchObject({
      runId: created.id,
      issueIdentifier: "SYM-1",
      trackerKind: "mock",
    });

    const fromEndpoint = await requestJson<{ reviewArtifacts: unknown }>("GET", `/runs/${created.id}/review-artifacts`);
    expect(fromEndpoint.reviewArtifacts).toMatchObject({ runId: created.id });

    const refreshed = await requestJson<{ reviewArtifacts: unknown }>("POST", `/runs/${created.id}/review-artifacts/refresh`);
    expect(refreshed.reviewArtifacts).toMatchObject({ runId: created.id });

    const byIssue = await requestJson<{ reviewArtifacts: unknown }>("GET", `/issues/${created.issueId}/review-artifacts`);
    expect(byIssue.reviewArtifacts).toMatchObject({ runId: created.id });
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

  it("reconstructs active persisted runs on startup and allows manual retry", async () => {
    process.env.SYMPHONIA_MOCK_DELAY_MS = "50";
    const databasePath = join(directory, "restart.sqlite");
    daemon.close();
    daemon = createDaemonServer(new EventStore(databasePath), { workflowPath, cwd: directory }).daemon;

    const created = await daemon.startRun("issue-frontend-board", "mock");
    await waitForEvent(created.id, "agent.message");
    daemon.close();

    daemon = createDaemonServer(new EventStore(databasePath), { workflowPath, cwd: directory }).daemon;
    const recovered = daemon.requireRun(created.id);

    expect(recovered.status).toBe("interrupted");
    expect(recovered.recoveryState).toBe("interrupted_by_restart");
    expect(getEvents(created.id).some((event) => event.type === "run.recovered")).toBe(true);

    const retried = await daemon.retryRun(created.id);
    await waitForTerminal(retried.id, "succeeded");
    expect(daemon.requireRun(created.id).recoveryState).toBe("manually_retried");
  });

  it("leaves terminal persisted runs unchanged on startup", async () => {
    const databasePath = join(directory, "terminal-restart.sqlite");
    daemon.close();
    daemon = createDaemonServer(new EventStore(databasePath), { workflowPath, cwd: directory }).daemon;

    const created = await daemon.startRun("issue-frontend-board", "mock");
    await waitForTerminal(created.id, "succeeded");
    daemon.close();

    daemon = createDaemonServer(new EventStore(databasePath), { workflowPath, cwd: directory }).daemon;

    expect(daemon.requireRun(created.id).status).toBe("succeeded");
    expect(getEvents(created.id).some((event) => event.type === "run.recovered")).toBe(false);
  });

  it("recovers stale pending approvals as non-actionable", async () => {
    const databasePath = join(directory, "approval-restart.sqlite");
    daemon.close();
    daemon = createDaemonServer(new EventStore(databasePath), { workflowPath, cwd: directory }).daemon;
    writeWorkflow({ codexCommand: fakeCodexCommand("approval") });

    const created = await daemon.startRun("issue-frontend-board", "codex");
    await waitForApproval(created.id);
    daemon.close();

    daemon = createDaemonServer(new EventStore(databasePath), { workflowPath, cwd: directory }).daemon;

    expect(daemon.listApprovals(created.id)).toHaveLength(0);
    expect(getEvents(created.id).some((event) => event.type === "approval.recovered")).toBe(true);
    expect(getEvents(created.id).some((event) => event.type === "approval.resolved" && event.resolution === "cancel")).toBe(true);
  });

  it("reports daemon status, workspace inventory, and dry-run cleanup plans", async () => {
    writeWorkflow({ cleanupEnabled: true, cleanupDryRun: true, cleanupAfterMs: 0 });
    mkdirSync(join(directory, "workspaces", "ORPHAN-1"), { recursive: true });
    writeFileSync(join(directory, "workspaces", "ORPHAN-1", "notes.txt"), "stale\n");

    const status = await daemon.getDaemonStatus();
    const inventory = await daemon.refreshWorkspaceInventory();
    const plan = await daemon.createCleanupPlan();
    const result = await daemon.executeCleanup({ planId: plan.id, confirm: "delete workspaces" });

    expect(status.daemonInstanceId).toBeTruthy();
    expect(inventory.workspaces.some((workspace) => workspace.workspaceKey === "ORPHAN-1")).toBe(true);
    expect(plan.dryRun).toBe(true);
    expect(plan.candidates.some((workspace) => workspace.workspaceKey === "ORPHAN-1")).toBe(true);
    expect(result.skipped[0]?.skippedReason).toBe("dry_run");
    expect(existsSync(join(directory, "workspaces", "ORPHAN-1"))).toBe(true);
  });

  it("executes confirmed cleanup only when policy allows it", async () => {
    writeWorkflow({ cleanupEnabled: true, cleanupDryRun: false, cleanupAfterMs: 0 });
    mkdirSync(join(directory, "workspaces", "ORPHAN-2"), { recursive: true });
    writeFileSync(join(directory, "workspaces", "ORPHAN-2", "notes.txt"), "stale\n");

    const plan = await daemon.createCleanupPlan(["ORPHAN-2"]);
    const result = await daemon.executeCleanup({ planId: plan.id, confirm: "delete workspaces" });

    expect(result.deleted.some((workspace) => workspace.workspaceKey === "ORPHAN-2")).toBe(true);
    expect(existsSync(join(directory, "workspaces", "ORPHAN-2"))).toBe(false);
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
  const run = daemon.requireRun(runId);
  throw new Error(
    `Run ${runId} did not reach ${expectedStatus}; status=${run.status}; events=${getEvents(runId)
      .map((event) => `${event.type}${"message" in event ? `:${String(event.message)}` : ""}${"error" in event ? `:${String(event.error)}` : ""}`)
      .join(",")}`,
  );
}

async function waitForEvent(runId: string, eventType: string, minimumCount = 1): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (getEvents(runId).filter((event) => event.type === eventType).length >= minimumCount) return;
    await sleep(20);
  }
  throw new Error(
    `Run ${runId} did not emit ${minimumCount} ${eventType} events; status=${daemon.requireRun(runId).status}; events=${getEvents(runId)
      .map((event) => `${event.type}${"message" in event ? `:${String(event.message)}` : ""}${"error" in event ? `:${String(event.error)}` : ""}`)
      .join(",")}`,
  );
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

async function requestJson<T>(method: "GET" | "POST", path: string): Promise<T> {
  let statusCode = 0;
  let body = "";
  const response = {
    setHeader: () => undefined,
    writeHead: (status: number) => {
      statusCode = status;
      return response;
    },
    end: (chunk?: unknown) => {
      body += chunk === undefined ? "" : String(chunk);
    },
  };
  const request = {
    method,
    url: path,
    async *[Symbol.asyncIterator]() {
      // No body is needed for current test requests.
    },
  };

  await (daemon as unknown as {
    route: (request: unknown, response: unknown) => Promise<void>;
  }).route(request, response);

  expect(statusCode).toBeGreaterThanOrEqual(200);
  expect(statusCode).toBeLessThan(300);
  return JSON.parse(body) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function respondApproval(approvalId: string, decision: "accept" | "acceptForSession" | "decline" | "cancel"): Promise<ApprovalState> {
  return (daemon as unknown as {
    respondApproval: (approvalId: string, decision: "accept" | "acceptForSession" | "decline" | "cancel") => Promise<ApprovalState>;
  }).respondApproval(approvalId, decision);
}

function writeWorkflow(
  options: {
    codexCommand?: string;
    claudeCommand?: string;
    cursorCommand?: string;
    provider?: "mock" | "codex" | "claude" | "cursor";
    githubToken?: string;
    cleanupEnabled?: boolean;
    cleanupDryRun?: boolean;
    cleanupAfterMs?: number;
  } = {},
): void {
  writeFileSync(
    workflowPath,
    `---
provider: ${options.provider ?? "mock"}
tracker:
  kind: mock
workspace:
  root: "./workspaces"
  cleanup:
    enabled: ${options.cleanupEnabled ? "true" : "false"}
    dry_run: ${options.cleanupDryRun === false ? "false" : "true"}
    require_manual_confirmation: true
    delete_terminal_after_ms: ${options.cleanupAfterMs ?? 604800000}
    delete_orphaned_after_ms: ${options.cleanupAfterMs ?? 1209600000}
    delete_interrupted_after_ms: ${options.cleanupAfterMs ?? 1209600000}
    protect_active: true
    protect_recent_runs_ms: 0
    protect_dirty_git: true
${options.githubToken ? `github:
  enabled: true
  endpoint: "https://api.github.test"
  token: ${JSON.stringify(options.githubToken)}
  owner: "agora-creations"
  repo: "symphonia"
  default_base_branch: "main"
  remote_name: "origin"
  read_only: true
  page_size: 5
  max_pages: 2
  write:
    enabled: false
` : ""}codex:
  command: ${JSON.stringify(options.codexCommand ?? "codex app-server")}
  model: "fake-model"
  approval_policy: "on-request"
  turn_sandbox_policy: "workspaceWrite"
  turn_timeout_ms: 2000
  read_timeout_ms: 1000
  stall_timeout_ms: 1000
claude:
  enabled: ${options.claudeCommand || options.provider === "claude" ? "true" : "false"}
  command: ${JSON.stringify(options.claudeCommand ?? "claude")}
  model: "sonnet"
  max_turns: 3
  output_format: "stream-json"
  permission_mode: "default"
  allowed_tools:
    - "Read"
  disallowed_tools:
    - "Bash(rm:*)"
  timeout_ms: 2000
  read_timeout_ms: 1000
  stall_timeout_ms: 1000
cursor:
  enabled: ${options.cursorCommand || options.provider === "cursor" ? "true" : "false"}
  command: ${JSON.stringify(options.cursorCommand ?? "cursor-agent")}
  model: "cursor-test"
  output_format: "stream-json"
  force: false
  timeout_ms: 2000
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

function writeLinearWorkflow(options: { codexCommand?: string; apiKey?: string; teamKey?: string } = {}): void {
  writeFileSync(
    workflowPath,
    `---
provider: mock
tracker:
  kind: linear
  endpoint: "https://api.linear.app/graphql"
  api_key: ${JSON.stringify(options.apiKey ?? "linear-secret")}
  team_key: ${JSON.stringify(options.teamKey ?? "ENG")}
  active_states:
    - "Todo"
    - "In Progress"
  terminal_states:
    - "Done"
    - "Canceled"
  page_size: 5
  max_pages: 2
  read_only: true
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
  before_run: |
    printf "Preparing in $(pwd)\\n"
---
You are working on {{ issue.identifier }}.

Title:
{{ issue.title }}

Description:
{{ issue.description }}

State:
{{ issue.state }}

Labels:
{{ issue.labels }}

Linear URL:
{{ issue.url }}
`,
  );
}

function fakeLinearFetch(options: { state?: string; getState?: () => string }): LinearFetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { query: string };
    const state = options.getState?.() ?? options.state ?? "Todo";
    const node = fakeLinearIssue(state);

    if (body.query.includes("SymphoniaLinearViewer")) {
      return jsonResponse({ data: { viewer: { id: "viewer-1", name: "Linear User", email: "linear@example.com" } } });
    }

    if (body.query.includes("SymphoniaLinearIssues")) {
      return jsonResponse({
        data: {
          issues: {
            nodes: [node],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    }

    if (body.query.includes("SymphoniaLinearIssue")) {
      return jsonResponse({ data: { issue: node } });
    }

    return jsonResponse({
      data: {
        issues: {
          nodes: [node],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });
  };
}

function fakeLinearIssue(state: string) {
  return {
    id: "linear-issue-101",
    identifier: "ENG-101",
    title: "Linear-backed daemon test",
    description: "Use real Linear issue fields in the prompt.",
    priority: 2,
    branchName: "eng-101-linear-backed-daemon-test",
    url: "https://linear.app/acme/issue/ENG-101",
    createdAt: "2026-05-13T08:00:00.000Z",
    updatedAt: "2026-05-13T08:10:00.000Z",
    state: { id: `state-${state}`, name: state, type: state === "Done" ? "completed" : "unstarted" },
    labels: { nodes: [{ name: "Backend" }, { name: "Linear" }] },
    project: { id: "project-1", name: "Orchestration", slugId: "orchestration" },
    team: { id: "team-1", key: "ENG", name: "Engineering" },
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeGitHubFetch(): GitHubFetch {
  return async (input) => {
    if (input.includes("/repos/agora-creations/symphonia")) {
      return jsonResponse({
        id: 1,
        name: "symphonia",
        full_name: "agora-creations/symphonia",
        default_branch: "main",
      });
    }
    return jsonResponse({ message: `Unexpected GitHub URL: ${input}` }, 404);
  };
}

function fakeCodexCommand(mode: string): string {
  const serverPath = join(directory, `fake-codex-${mode}.mjs`);
  writeFileSync(serverPath, fakeServerSource());
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(serverPath)} ${mode}`;
}

function fakeCliCommand(mode: string): string {
  const serverPath = join(directory, `fake-cli-${mode}.mjs`);
  writeFileSync(serverPath, fakeCliSource());
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

function fakeCliSource(): string {
  return `
const mode = process.argv[2] ?? "claude-success";

function write(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

if (mode === "claude-success") {
  write({ type: "system", subtype: "init", session_id: "claude-session-1", model: "sonnet", cwd: process.cwd(), permissionMode: "default" });
  write({ type: "assistant", session_id: "claude-session-1", message: { role: "assistant", content: [{ type: "text", text: "Claude daemon fake message." }] } });
  write({ type: "result", subtype: "success", session_id: "claude-session-1", is_error: false, result: "Claude daemon fake result", num_turns: 1, duration_ms: 25, usage: { input_tokens: 3, output_tokens: 4 } });
  process.exit(0);
}

if (mode === "claude-error-result") {
  write({ type: "system", subtype: "init", session_id: "claude-session-1" });
  write({ type: "result", subtype: "error", session_id: "claude-session-1", is_error: true, result: "Claude fake failure" });
  process.exit(0);
}

if (mode === "claude-wait") {
  write({ type: "system", subtype: "init", session_id: "claude-session-1" });
  setInterval(() => {}, 1000);
}

if (mode === "cursor-success") {
  write({ type: "system", subtype: "init", session_id: "cursor-session-1", request_id: "request-1", model: "cursor-test", cwd: process.cwd(), apiKeySource: "login", permissionMode: "default" });
  write({ type: "assistant", session_id: "cursor-session-1", request_id: "request-1", message: { role: "assistant", content: [{ type: "text", text: "Cursor daemon fake message." }] } });
  write({ type: "result", subtype: "success", session_id: "cursor-session-1", request_id: "request-1", is_error: false, result: "Cursor daemon fake result", duration_ms: 25, duration_api_ms: 20, usage: { input_tokens: 2, output_tokens: 5 } });
  process.exit(0);
}

if (mode === "cursor-error-result") {
  write({ type: "system", subtype: "init", session_id: "cursor-session-1", request_id: "request-1" });
  write({ type: "result", subtype: "error", session_id: "cursor-session-1", request_id: "request-1", is_error: true, result: "Cursor fake failure" });
  process.exit(0);
}

if (mode === "cursor-wait") {
  write({ type: "system", subtype: "init", session_id: "cursor-session-1", request_id: "request-1" });
  setInterval(() => {}, 1000);
}
`;
}
