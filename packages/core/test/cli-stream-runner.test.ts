import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentEvent } from "@symphonia/types";
import { runCliStream } from "../src/index";

let directory: string;
let scriptPath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "symphonia-cli-runner-"));
  scriptPath = join(directory, "fake-cli.mjs");
  writeFileSync(scriptPath, fakeCliSource());
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("CLI stream runner", () => {
  it("parses successful NDJSON streams", async () => {
    const received: unknown[] = [];
    const events: AgentEvent[] = [];

    const result = await runCliStream({
      provider: "claude",
      runId: "run-1",
      commandLine: process.execPath,
      args: [scriptPath, "success"],
      cwd: directory,
      input: "prompt",
      outputFormat: "stream-json",
      timeoutMs: 1000,
      stallTimeoutMs: 1000,
      readTimeoutMs: 1000,
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      onJson: (value) => received.push(value),
    });

    expect(result.exitCode).toBe(0);
    expect(received).toHaveLength(2);
    expect(events.some((event) => event.type === "provider.started" && event.provider === "claude")).toBe(true);
  });

  it("captures stderr diagnostics", async () => {
    const events: AgentEvent[] = [];

    await runCliStream({
      provider: "cursor",
      runId: "run-1",
      commandLine: process.execPath,
      args: [scriptPath, "stderr"],
      cwd: directory,
      input: "prompt",
      outputFormat: "stream-json",
      timeoutMs: 1000,
      stallTimeoutMs: 1000,
      readTimeoutMs: 1000,
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      onJson: () => undefined,
    });

    expect(events.some((event) => event.type === "provider.stderr" && event.message.includes("diagnostic"))).toBe(true);
  });

  it("fails malformed JSON without crashing", async () => {
    const malformed: string[] = [];

    await expect(
      runCliStream({
        provider: "claude",
        runId: "run-1",
        commandLine: process.execPath,
        args: [scriptPath, "malformed"],
        cwd: directory,
        input: "prompt",
        outputFormat: "stream-json",
        timeoutMs: 1000,
        stallTimeoutMs: 1000,
        readTimeoutMs: 1000,
        signal: new AbortController().signal,
        emit: () => undefined,
        onJson: () => undefined,
        onMalformedJson: (line) => malformed.push(line),
      }),
    ).rejects.toMatchObject({ code: "malformed_json" });

    expect(malformed[0]).toContain("{bad");
  });

  it("fails nonzero exits", async () => {
    await expect(
      runCliStream({
        provider: "cursor",
        runId: "run-1",
        commandLine: process.execPath,
        args: [scriptPath, "nonzero"],
        cwd: directory,
        input: "prompt",
        outputFormat: "stream-json",
        timeoutMs: 1000,
        stallTimeoutMs: 1000,
        readTimeoutMs: 1000,
        signal: new AbortController().signal,
        emit: () => undefined,
        onJson: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "nonzero_exit" });
  });

  it("fails when the process produces no output before read timeout", async () => {
    await expect(
      runCliStream({
        provider: "claude",
        runId: "run-1",
        commandLine: process.execPath,
        args: [scriptPath, "silent"],
        cwd: directory,
        input: "prompt",
        outputFormat: "stream-json",
        timeoutMs: 1000,
        stallTimeoutMs: 1000,
        readTimeoutMs: 20,
        signal: new AbortController().signal,
        emit: () => undefined,
        onJson: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "read_timeout" });
  });

  it("aborts and cleans up active processes", async () => {
    const controller = new AbortController();
    const run = runCliStream({
      provider: "cursor",
      runId: "run-1",
      commandLine: process.execPath,
      args: [scriptPath, "wait"],
      cwd: directory,
      input: "prompt",
      outputFormat: "stream-json",
      timeoutMs: 1000,
      stallTimeoutMs: 1000,
      readTimeoutMs: 1000,
      signal: controller.signal,
      emit: () => undefined,
      onJson: () => undefined,
    });

    controller.abort();
    await expect(run).rejects.toMatchObject({ code: "aborted" });
  });

  it("truncates large text lines", async () => {
    const lines: string[] = [];

    await runCliStream({
      provider: "claude",
      runId: "run-1",
      commandLine: process.execPath,
      args: [scriptPath, "large"],
      cwd: directory,
      input: "prompt",
      outputFormat: "text",
      timeoutMs: 1000,
      stallTimeoutMs: 1000,
      readTimeoutMs: 1000,
      maxLineLength: 20,
      signal: new AbortController().signal,
      emit: () => undefined,
      onJson: () => undefined,
      onText: (line) => lines.push(line),
    });

    expect(lines[0]).toContain("[truncated");
  });
});

function fakeCliSource(): string {
  return `
const mode = process.argv[2] ?? "success";

function write(value) {
  process.stdout.write(JSON.stringify(value) + "\\n");
}

if (mode === "success") {
  write({ type: "system", subtype: "init", session_id: "session-1" });
  write({ type: "result", subtype: "success", is_error: false, result: "done" });
  process.exit(0);
}

if (mode === "stderr") {
  process.stderr.write("provider diagnostic\\n");
  write({ type: "result", subtype: "success", is_error: false, result: "done" });
  process.exit(0);
}

if (mode === "malformed") {
  process.stdout.write("{bad json\\n");
  process.exit(0);
}

if (mode === "nonzero") {
  write({ type: "system", subtype: "init", session_id: "session-1" });
  process.exit(2);
}

if (mode === "silent") {
  setTimeout(() => process.exit(0), 200);
}

if (mode === "wait") {
  write({ type: "system", subtype: "init", session_id: "session-1" });
  setInterval(() => {}, 1000);
}

if (mode === "large") {
  process.stdout.write("x".repeat(100) + "\\n");
  process.exit(0);
}
`;
}
