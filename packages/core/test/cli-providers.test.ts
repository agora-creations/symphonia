import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentEvent, Issue, ProviderId, Run, WorkflowConfig } from "@symphonia/types";
import {
  checkClaudeHealth,
  checkCursorHealth,
  MockRunCancelledError,
  resolveWorkflowConfig,
  runClaudeAgentProvider,
  runCursorAgentProvider,
} from "../src/index";

let directory: string;
let scriptPath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "symphonia-cli-providers-"));
  scriptPath = join(directory, "fake-provider.mjs");
  writeFileSync(scriptPath, fakeProviderSource());
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("Claude provider", () => {
  it("reports health using a fake command", async () => {
    const config = workflowConfig("claude", "claude-success").claude;
    const health = await checkClaudeHealth({
      ...config,
      healthCheckCommand: `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} version`,
    });

    expect(health.available).toBe(true);
    expect(health.version).toContain("fake-provider");
  });

  it("reports unavailable health when command is missing", async () => {
    const health = await checkClaudeHealth({
      ...workflowConfig("claude", "claude-success").claude,
      command: "definitely-not-a-symphonia-claude",
    });

    expect(health.available).toBe(false);
  });

  it("maps fake stream events and succeeds", async () => {
    const events: AgentEvent[] = [];
    await runClaudeAgentProvider(context("claude", "claude-success", events));

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "provider.started",
        "claude.system.init",
        "claude.assistant.message",
        "claude.tool.use",
        "claude.tool.result",
        "claude.result",
        "claude.usage",
        "run.status",
      ]),
    );
    expect(events.some((event) => event.type === "claude.result" && event.totalCostUsd === 0.01)).toBe(true);
  });

  it("surfaces Claude error results", async () => {
    const events: AgentEvent[] = [];
    await expect(runClaudeAgentProvider(context("claude", "claude-error-result", events))).rejects.toThrow(
      "Claude Code returned an error result",
    );

    expect(events.some((event) => event.type === "claude.result" && event.isError)).toBe(true);
    expect(events.some((event) => event.type === "claude.error")).toBe(true);
  });

  it("surfaces nonzero exits", async () => {
    const events: AgentEvent[] = [];
    await expect(runClaudeAgentProvider(context("claude", "claude-nonzero", events))).rejects.toThrow(
      "Provider command exited with code",
    );
    expect(events.some((event) => event.type === "claude.error")).toBe(true);
  });

  it("cancels an active fake Claude process", async () => {
    const events: AgentEvent[] = [];
    const controller = new AbortController();
    const running = runClaudeAgentProvider(context("claude", "claude-wait", events, controller));

    await waitForEvent(events, "claude.system.init");
    controller.abort();
    await expect(running).rejects.toBeInstanceOf(MockRunCancelledError);
  });
});

describe("Cursor provider", () => {
  it("reports health using a fake command", async () => {
    const config = workflowConfig("cursor", "cursor-success").cursor;
    const health = await checkCursorHealth({
      ...config,
      healthCheckCommand: `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} version`,
    });

    expect(health.available).toBe(true);
    expect(health.version).toContain("fake-provider");
  });

  it("reports unavailable health when command is missing", async () => {
    const health = await checkCursorHealth({
      ...workflowConfig("cursor", "cursor-success").cursor,
      command: "definitely-not-a-symphonia-cursor",
    });

    expect(health.available).toBe(false);
  });

  it("maps fake stream events and succeeds", async () => {
    const events: AgentEvent[] = [];
    await runCursorAgentProvider(context("cursor", "cursor-success", events));

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "provider.started",
        "cursor.system.init",
        "cursor.assistant.delta",
        "cursor.assistant.message",
        "cursor.tool.call",
        "cursor.tool.result",
        "cursor.result",
        "cursor.usage",
        "run.status",
      ]),
    );
    expect(events.some((event) => event.type === "cursor.result" && event.requestId === "request-1")).toBe(true);
  });

  it("surfaces Cursor error results and nonzero exits", async () => {
    const errorEvents: AgentEvent[] = [];
    await expect(runCursorAgentProvider(context("cursor", "cursor-error-result", errorEvents))).rejects.toThrow(
      "Cursor Agent returned an error result",
    );
    expect(errorEvents.some((event) => event.type === "cursor.result" && event.isError)).toBe(true);

    const nonzeroEvents: AgentEvent[] = [];
    await expect(runCursorAgentProvider(context("cursor", "cursor-nonzero", nonzeroEvents))).rejects.toThrow(
      "Provider command exited with code",
    );
    expect(nonzeroEvents.some((event) => event.type === "cursor.error")).toBe(true);
  });

  it("cancels an active fake Cursor process", async () => {
    const events: AgentEvent[] = [];
    const controller = new AbortController();
    const running = runCursorAgentProvider(context("cursor", "cursor-wait", events, controller));

    await waitForEvent(events, "cursor.system.init");
    controller.abort();
    await expect(running).rejects.toBeInstanceOf(MockRunCancelledError);
  });
});

function context(provider: Extract<ProviderId, "claude" | "cursor">, mode: string, events: AgentEvent[], controller = new AbortController()) {
  const config = workflowConfig(provider, mode);
  return {
    run: run(provider),
    issue: issue(),
    attempt: 1,
    workspacePath: directory,
    renderedPrompt: "Implement the fake issue.",
    workflowConfig: config,
    codexConfig: config.codex,
    claudeConfig: config.claude,
    cursorConfig: config.cursor,
    signal: controller.signal,
    emit: (event: AgentEvent) => events.push(event),
  };
}

function workflowConfig(provider: Extract<ProviderId, "claude" | "cursor">, mode: string): WorkflowConfig {
  return resolveWorkflowConfig({
    config: {
      provider,
      tracker: { kind: "mock" },
      claude: {
        enabled: provider === "claude",
        command: `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} ${mode}`,
        model: "sonnet",
        max_turns: 3,
        output_format: "stream-json",
        permission_mode: "default",
        allowed_tools: ["Read"],
        disallowed_tools: ["Bash(rm:*)"],
        timeout_ms: 1000,
        stall_timeout_ms: 1000,
        read_timeout_ms: 1000,
      },
      cursor: {
        enabled: provider === "cursor",
        command: `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} ${mode}`,
        model: "cursor-test",
        output_format: "stream-json",
        force: false,
        timeout_ms: 1000,
        stall_timeout_ms: 1000,
        read_timeout_ms: 1000,
      },
    },
    promptTemplate: "Work on {{ issue.identifier }}.",
    workflowPath: join(directory, "WORKFLOW.md"),
    loadedAt: "2026-05-13T08:00:00.000Z",
  });
}

function run(provider: ProviderId): Run {
  return {
    id: `run-${provider}`,
    issueId: "issue-1",
    issueIdentifier: "SYM-1",
    status: "queued",
    provider,
    startedAt: null,
    endedAt: null,
    error: null,
  };
}

function issue(): Issue {
  return {
    id: "issue-1",
    identifier: "SYM-1",
    title: "Fake issue",
    description: "Exercise CLI providers.",
    state: "Todo",
    labels: ["provider"],
    priority: "Medium",
    createdAt: "2026-05-13T08:00:00.000Z",
    updatedAt: "2026-05-13T08:00:00.000Z",
    url: "https://mock.local/issues/SYM-1",
  };
}

async function waitForEvent(events: AgentEvent[], type: AgentEvent["type"]): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (events.some((event) => event.type === type)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${type}.`);
}

function fakeProviderSource(): string {
  return `
const mode = process.argv[2] ?? "claude-success";

function write(value) {
  process.stdout.write(JSON.stringify(value) + "\\n");
}

if (mode === "version") {
  process.stdout.write("fake-provider 1.0.0\\n");
  process.exit(0);
}

if (mode === "claude-success") {
  write({ type: "system", subtype: "init", session_id: "claude-session-1", model: "sonnet", cwd: process.cwd(), permissionMode: "default" });
  write({ type: "assistant", session_id: "claude-session-1", message: { role: "assistant", content: [{ type: "text", text: "I will inspect the repo." }, { type: "tool_use", id: "tool-1", name: "Read", input: { path: "README.md" } }] } });
  write({ type: "user", session_id: "claude-session-1", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "README contents", status: "success" }] } });
  write({ type: "result", subtype: "success", session_id: "claude-session-1", is_error: false, result: "Claude done", num_turns: 2, duration_ms: 123, total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 12 } });
  process.exit(0);
}

if (mode === "claude-error-result") {
  write({ type: "system", subtype: "init", session_id: "claude-session-1" });
  write({ type: "result", subtype: "error", session_id: "claude-session-1", is_error: true, result: "Permission denied" });
  process.exit(0);
}

if (mode === "claude-nonzero") {
  write({ type: "system", subtype: "init", session_id: "claude-session-1" });
  process.stderr.write("Claude failed\\n");
  process.exit(2);
}

if (mode === "claude-wait") {
  write({ type: "system", subtype: "init", session_id: "claude-session-1" });
  setInterval(() => {}, 1000);
}

if (mode === "cursor-success") {
  write({ type: "system", subtype: "init", session_id: "cursor-session-1", request_id: "request-1", model: "cursor-test", cwd: process.cwd(), apiKeySource: "login", permissionMode: "default" });
  write({ type: "assistant", session_id: "cursor-session-1", request_id: "request-1", message: { role: "assistant", content: [{ type: "text", text: "Cursor " }] } });
  write({ type: "assistant", session_id: "cursor-session-1", request_id: "request-1", message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
  write({ type: "tool_call", subtype: "started", call_id: "call-1", tool_call: { readToolCall: { args: { path: "README.md" } } }, session_id: "cursor-session-1", request_id: "request-1" });
  write({ type: "tool_call", subtype: "completed", call_id: "call-1", tool_call: { readToolCall: { args: { path: "README.md" }, result: { success: { totalLines: 4 } } } }, session_id: "cursor-session-1", request_id: "request-1" });
  write({ type: "result", subtype: "success", session_id: "cursor-session-1", request_id: "request-1", is_error: false, result: "Cursor done", duration_ms: 234, duration_api_ms: 200, usage: { input_tokens: 5, output_tokens: 8 } });
  process.exit(0);
}

if (mode === "cursor-error-result") {
  write({ type: "system", subtype: "init", session_id: "cursor-session-1", request_id: "request-1" });
  write({ type: "result", subtype: "error", session_id: "cursor-session-1", request_id: "request-1", is_error: true, result: "Cursor failed" });
  process.exit(0);
}

if (mode === "cursor-nonzero") {
  write({ type: "system", subtype: "init", session_id: "cursor-session-1", request_id: "request-1" });
  process.stderr.write("Cursor failed\\n");
  process.exit(2);
}

if (mode === "cursor-wait") {
  write({ type: "system", subtype: "init", session_id: "cursor-session-1", request_id: "request-1" });
  setInterval(() => {}, 1000);
}
`;
}
