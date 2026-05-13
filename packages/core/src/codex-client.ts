import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, Interface as ReadlineInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { CodexConfig } from "@symphonia/types";
import { splitCommandLine } from "./command-utils.js";
import {
  CodexProtocolError,
  createNotification,
  createRequest,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  parseJsonRpcLine,
} from "./codex-protocol.js";
import { mapCodexNotificationToEvents, mapCodexServerRequestToApproval } from "./codex-event-mapper.js";
import { ProviderApprovalDecision, ProviderApprovalRequest, ProviderEmitAgentEvent } from "./provider.js";
import { nowIso } from "./time.js";

export type CodexClientOptions = {
  runId: string;
  command: string;
  cwd: string;
  prompt: string;
  codexConfig: CodexConfig;
  signal: AbortSignal;
  emit: ProviderEmitAgentEvent;
  requestApproval?: (request: ProviderApprovalRequest) => Promise<ProviderApprovalDecision>;
};

type PendingResponse = {
  resolve: (value: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readline: ReadlineInterface | null = null;
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingResponse>();
  private readonly approvalIdsByRequestId = new Map<JsonRpcId, string>();
  private terminal: Deferred<void> | null = null;
  private threadId: string | null = null;
  private turnId: string | null = null;
  private closed = false;
  private turnTimer: NodeJS.Timeout | null = null;
  private stallTimer: NodeJS.Timeout | null = null;
  private interruptSent = false;

  async run(options: CodexClientOptions): Promise<void> {
    this.terminal = deferred<void>();
    this.terminal.promise.catch(() => undefined);
    const parsed = splitCommandLine(options.command);
    const child = spawn(parsed.command, parsed.args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.child = child;

    await options.emit({
      id: randomUUID(),
      runId: options.runId,
      type: "provider.started",
      timestamp: nowIso(),
      provider: "codex",
      command: options.command,
      pid: child.pid ?? null,
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    this.readline = createInterface({ input: child.stdout });
    this.readline.on("line", (line) => {
      void this.handleLine(options, line);
    });
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
        void options.emit({
          id: randomUUID(),
          runId: options.runId,
          type: "provider.stderr",
          timestamp: nowIso(),
          provider: "codex",
          message: redact(line),
        });
      }
    });
    child.on("error", (error) => {
      this.rejectAll(new Error(`Codex app-server failed to start: ${error.message}`));
      this.terminal?.reject(error);
    });
    child.on("exit", (code, signal) => {
      if (this.closed) return;
      if (this.terminal) {
        this.terminal.reject(new Error(`Codex app-server exited before turn completion (code ${code ?? "null"}, signal ${signal ?? "null"}).`));
      }
      this.rejectAll(new Error("Codex app-server exited."));
    });

    const abortHandler = () => {
      void this.interrupt().catch(() => undefined);
    };
    options.signal.addEventListener("abort", abortHandler, { once: true });

    try {
      this.armTurnTimeout(options);
      this.resetStallTimeout(options);

      await this.request("initialize", {
        clientInfo: {
          name: "symphonia",
          title: "Symphonia",
          version: "0.3.0",
        },
        capabilities: {
          experimentalApi: true,
        },
      }, options.codexConfig.readTimeoutMs);
      this.notify("initialized", {});

      const threadResponse = await this.request(
        "thread/start",
        buildThreadStartParams(options),
        options.codexConfig.readTimeoutMs,
      );
      const threadResult = readRecord(threadResponse, "result");
      const thread = readRecord(threadResult, "thread");
      this.threadId = readString(thread, "id") ?? null;
      if (this.threadId) {
        await options.emit({
          id: randomUUID(),
          runId: options.runId,
          type: "codex.thread.started",
          timestamp: nowIso(),
          threadId: this.threadId,
          model: readString(threadResult, "model") ?? options.codexConfig.model,
          cwd: options.cwd,
        });
      }

      if (!this.threadId) {
        throw new Error("Codex app-server did not return a thread id.");
      }

      await options.emit({
        id: randomUUID(),
        runId: options.runId,
        type: "run.status",
        timestamp: nowIso(),
        status: "streaming",
        message: "Codex app-server turn is streaming.",
      });

      const turnResponse = await this.request(
        "turn/start",
        buildTurnStartParams(this.threadId, options),
        options.codexConfig.readTimeoutMs,
      );
      const turn = readRecord(readRecord(turnResponse, "result"), "turn");
      this.turnId = readString(turn, "id") ?? null;
      if (this.turnId) {
        await options.emit({
          id: randomUUID(),
          runId: options.runId,
          type: "codex.turn.started",
          timestamp: nowIso(),
          threadId: this.threadId,
          turnId: this.turnId,
          status: readString(turn, "status") ?? "inProgress",
        });
      }

      if (!this.turnId) {
        throw new Error("Codex app-server did not return a turn id.");
      }

      await this.terminal.promise;
    } finally {
      options.signal.removeEventListener("abort", abortHandler);
      this.cleanup();
    }
  }

  async interrupt(): Promise<void> {
    if (this.interruptSent) return;
    this.interruptSent = true;

    if (this.threadId && this.turnId && this.child && !this.child.killed) {
      try {
        await this.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId }, 1500);
      } catch {
        // Fall back to process termination below.
      }
    }

    setTimeout(() => {
      if (this.child && !this.child.killed) this.child.kill("SIGTERM");
    }, 1500).unref();
  }

  private async request(method: string, params: unknown, timeoutMs: number): Promise<JsonRpcResponse> {
    const id = this.nextId;
    this.nextId += 1;
    const responsePromise = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.write(createRequest(id, method, params));
    const response = await responsePromise;
    if (response.error) {
      throw new Error(`${method} failed: ${response.error.message}`);
    }
    return response;
  }

  private notify(method: string, params?: unknown): void {
    this.write(createNotification(method, params));
  }

  private write(message: unknown): void {
    if (!this.child?.stdin.writable) {
      throw new Error("Codex app-server stdin is not writable.");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private async handleLine(options: CodexClientOptions, line: string): Promise<void> {
    this.resetStallTimeout(options);

    let message;
    try {
      message = parseJsonRpcLine(line);
    } catch (error) {
      await options.emit({
        id: randomUUID(),
        runId: options.runId,
        type: "codex.error",
        timestamp: nowIso(),
        message: error instanceof Error ? error.message : "Malformed app-server output.",
        code: "malformed_json",
      });
      this.terminal?.reject(error instanceof Error ? error : new CodexProtocolError("Malformed app-server output."));
      return;
    }

    if (isJsonRpcResponse(message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      pending.resolve(message);
      return;
    }

    if (isJsonRpcRequest(message)) {
      await this.handleServerRequest(options, message);
      return;
    }

    if (isJsonRpcNotification(message)) {
      await this.handleNotification(options, message);
    }
  }

  private async handleServerRequest(options: CodexClientOptions, request: JsonRpcRequest): Promise<void> {
    const approvalEvent = mapCodexServerRequestToApproval({ runId: options.runId }, request);
    if (!approvalEvent || approvalEvent.type !== "approval.requested") {
      this.write({ id: request.id, error: { code: -32601, message: `Unsupported server request: ${request.method}` } });
      return;
    }

    this.approvalIdsByRequestId.set(request.id, approvalEvent.approvalId);
    await options.emit({
      id: randomUUID(),
      runId: options.runId,
      type: "run.status",
      timestamp: nowIso(),
      status: "waiting_for_approval",
      message: "Codex is waiting for approval.",
    });
    await options.emit(approvalEvent);

    const decision = await (options.requestApproval?.({
      approvalId: approvalEvent.approvalId,
      provider: "codex",
      approvalType: approvalEvent.approvalType ?? "unknown",
      threadId: approvalEvent.threadId ?? null,
      turnId: approvalEvent.turnId ?? null,
      itemId: approvalEvent.itemId ?? null,
      prompt: approvalEvent.prompt,
      reason: approvalEvent.reason ?? null,
      command: approvalEvent.command ?? null,
      cwd: approvalEvent.cwd ?? null,
      fileSummary: approvalEvent.fileSummary ?? null,
      availableDecisions: narrowDecisions(approvalEvent.availableDecisions),
      rawRequestId: request.id,
      rawMethod: request.method,
    }) ?? Promise.resolve("cancel"));

    this.write({ id: request.id, result: { decision } });
    await options.emit({
      id: randomUUID(),
      runId: options.runId,
      type: "approval.resolved",
      timestamp: nowIso(),
      approvalId: approvalEvent.approvalId,
      resolution: decision,
    });
    await options.emit({
      id: randomUUID(),
      runId: options.runId,
      type: "run.status",
      timestamp: nowIso(),
      status: "streaming",
      message: "Codex approval resolved; streaming resumed.",
    });
  }

  private async handleNotification(options: CodexClientOptions, notification: { method: string; params?: unknown }): Promise<void> {
    if (notification.method === "serverRequest/resolved") {
      const requestId = readString(readRecord(notification.params, "requestId"), "") ?? readId(readRecord(notification.params, ""));
      if (requestId !== null) {
        const approvalId = this.approvalIdsByRequestId.get(requestId);
        if (approvalId) {
          this.approvalIdsByRequestId.delete(requestId);
        }
      }
    }

    const events = mapCodexNotificationToEvents({ runId: options.runId }, notification);
    for (const event of events) {
      await options.emit(event);
      if (event.type === "codex.turn.completed") {
        this.terminal?.resolve();
      }
    }
  }

  private armTurnTimeout(options: CodexClientOptions): void {
    this.turnTimer = setTimeout(() => {
      this.terminal?.reject(new Error(`Codex turn timed out after ${options.codexConfig.turnTimeoutMs}ms.`));
      void this.interrupt();
    }, options.codexConfig.turnTimeoutMs);
  }

  private resetStallTimeout(options: CodexClientOptions): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => {
      this.terminal?.reject(new Error(`Codex app-server stalled after ${options.codexConfig.stallTimeoutMs}ms without output.`));
      void this.interrupt();
    }, options.codexConfig.stallTimeoutMs);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private cleanup(): void {
    this.closed = true;
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.rejectAll(new Error("Codex client closed."));
    this.readline?.close();
    if (this.child && !this.child.killed) {
      this.child.stdin.end();
      this.child.kill("SIGTERM");
    }
  }
}

function buildThreadStartParams(options: CodexClientOptions): Record<string, unknown> {
  return {
    cwd: options.cwd,
    model: options.codexConfig.model,
    approvalPolicy: options.codexConfig.approvalPolicy,
    approvalsReviewer: "user",
    sandbox: sandboxFromConfig(options.codexConfig.threadSandbox, options.cwd),
    experimentalRawEvents: false,
    persistExtendedHistory: false,
    serviceName: "symphonia",
  };
}

function buildTurnStartParams(threadId: string, options: CodexClientOptions): Record<string, unknown> {
  return {
    threadId,
    input: [{ type: "text", text: options.prompt, text_elements: [] }],
    cwd: options.cwd,
    model: options.codexConfig.model,
    approvalPolicy: options.codexConfig.approvalPolicy,
    approvalsReviewer: "user",
    sandboxPolicy: sandboxFromConfig(options.codexConfig.turnSandboxPolicy, options.cwd),
    responsesapiClientMetadata: {
      symphoniaRunId: options.runId,
    },
  };
}

function sandboxFromConfig(value: string | null, cwd: string): Record<string, unknown> | null {
  if (!value) return null;
  switch (value) {
    case "dangerFullAccess":
    case "danger-full-access":
      return { type: "dangerFullAccess" };
    case "readOnly":
    case "read-only":
      return { type: "readOnly", networkAccess: false };
    case "workspaceWrite":
    case "workspace-write":
      return {
        type: "workspaceWrite",
        writableRoots: [cwd],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
    case "externalSandbox":
    case "external-sandbox":
      return { type: "externalSandbox", networkAccess: "restricted" };
    default:
      return null;
  }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function readRecord(value: unknown, key: string): Record<string, unknown> {
  const candidate = key.length === 0 ? value : isRecord(value) ? value[key] : undefined;
  return isRecord(candidate) ? candidate : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = key.length === 0 ? record : record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readId(record: Record<string, unknown>): JsonRpcId | null {
  const value = record.requestId;
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function narrowDecisions(value: unknown): ProviderApprovalDecision[] {
  if (!Array.isArray(value)) return ["accept", "decline", "cancel"];
  const decisions = value.filter(
    (item): item is ProviderApprovalDecision =>
      item === "accept" || item === "acceptForSession" || item === "decline" || item === "cancel",
  );
  return decisions.length > 0 ? decisions : ["accept", "decline", "cancel"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redact(value: string): string {
  return value.replace(/(api[_-]?key|authorization|token|secret)=\S+/gi, "$1=<redacted>");
}
