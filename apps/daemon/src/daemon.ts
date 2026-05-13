import { randomUUID } from "node:crypto";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import {
  applyRunEvent,
  canStartRunForIssue,
  createQueuedRun,
  createRetryRun,
  getMockIssue,
  getMockIssueByIdentifier,
  getWorkflowStatus,
  listMockIssues,
  loadWorkflowRuntime,
  MockRunCancelledError,
  nowIso,
  PromptTemplateError,
  renderPromptTemplate,
  runMockAgentProvider,
  runHook,
  WorkflowError,
  WorkflowRuntime,
  WorkspaceError,
  WorkspaceManager,
} from "@symphonia/core";
import { EventStore } from "@symphonia/db";
import {
  AgentEvent,
  AgentEventSchema,
  HookName,
  HookRun,
  isTerminalRunStatus,
  Run,
  RunSchema,
  StartRunRequestSchema,
  WorkflowConfigSummary,
  WorkflowStatus,
  WorkspaceInfo,
} from "@symphonia/types";

type RunRecord = {
  run: Run;
  controller: AbortController;
  attempt: number;
  prompt: string | null;
  workspace: WorkspaceInfo | null;
  workflowSummary: WorkflowConfigSummary | null;
  providerStarted: boolean;
};

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

const defaultPort = 4100;

export type SymphoniaDaemonOptions = {
  workflowPath?: string;
  cwd?: string;
};

export class SymphoniaDaemon {
  private readonly runs = new Map<string, RunRecord>();
  private readonly subscribers = new Map<string, Set<ServerResponse>>();
  private readonly workspaces = new Map<string, WorkspaceInfo>();
  private workflowRuntime: WorkflowRuntime | null = null;

  constructor(
    private readonly eventStore: EventStore,
    private readonly options: SymphoniaDaemonOptions = {},
  ) {}

  createHttpServer(): Server {
    return createServer((request, response) => {
      void this.route(request, response);
    });
  }

  close(): void {
    for (const record of this.runs.values()) {
      record.controller.abort();
    }

    for (const clients of this.subscribers.values()) {
      for (const client of clients) {
        client.end();
      }
    }

    this.eventStore.close();
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    setCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname;

    try {
      if (request.method === "GET" && path === "/healthz") {
        return sendJson(response, 200, { ok: true, service: "symphonia-daemon", timestamp: nowIso() });
      }

      if (request.method === "GET" && path === "/workflow/status") {
        return sendJson(response, 200, { workflow: this.refreshWorkflowStatus() });
      }

      if (request.method === "GET" && path === "/workflow/config") {
        const status = this.refreshWorkflowStatus();
        return sendJson(response, 200, { config: status.effectiveConfigSummary });
      }

      if (request.method === "POST" && path === "/workflow/reload") {
        this.workflowRuntime = null;
        return sendJson(response, 200, { workflow: this.refreshWorkflowStatus() });
      }

      if (request.method === "GET" && path === "/issues") {
        return sendJson(response, 200, { issues: listMockIssues() });
      }

      if (request.method === "GET" && path === "/runs") {
        return sendJson(response, 200, { runs: this.listRuns() });
      }

      if (request.method === "GET" && path === "/workspaces") {
        return sendJson(response, 200, { workspaces: this.listWorkspaces() });
      }

      const workspaceMatch = path.match(/^\/workspaces\/([^/]+)$/);
      if (request.method === "GET" && workspaceMatch) {
        return sendJson(response, 200, { workspace: this.getWorkspaceInfo(decodeURIComponent(workspaceMatch[1]!)) });
      }

      if (request.method === "POST" && path === "/runs") {
        const body = StartRunRequestSchema.parse(await readJsonBody(request));
        const run = await this.startRun(body.issueId);
        return sendJson(response, 201, { run });
      }

      const runEventsStreamMatch = path.match(/^\/runs\/([^/]+)\/events\/stream$/);
      if (request.method === "GET" && runEventsStreamMatch) {
        return this.streamRunEvents(runEventsStreamMatch[1]!, request, response);
      }

      const runEventsMatch = path.match(/^\/runs\/([^/]+)\/events$/);
      if (request.method === "GET" && runEventsMatch) {
        const runId = runEventsMatch[1]!;
        this.requireRun(runId);
        return sendJson(response, 200, { events: this.eventStore.getEventsForRun(runId) });
      }

      const runPromptMatch = path.match(/^\/runs\/([^/]+)\/prompt$/);
      if (request.method === "GET" && runPromptMatch) {
        const runId = runPromptMatch[1]!;
        this.requireRun(runId);
        return sendJson(response, 200, { prompt: this.getRunPrompt(runId) });
      }

      const stopMatch = path.match(/^\/runs\/([^/]+)\/stop$/);
      if (request.method === "POST" && stopMatch) {
        const run = await this.stopRun(stopMatch[1]!);
        return sendJson(response, 200, { run });
      }

      const retryMatch = path.match(/^\/runs\/([^/]+)\/retry$/);
      if (request.method === "POST" && retryMatch) {
        const run = await this.retryRun(retryMatch[1]!);
        return sendJson(response, 201, { run });
      }

      const runMatch = path.match(/^\/runs\/([^/]+)$/);
      if (request.method === "GET" && runMatch) {
        return sendJson(response, 200, { run: this.requireRun(runMatch[1]!) });
      }

      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const apiError = normalizeError(error);
      return sendJson(response, apiError.status, { error: apiError.message });
    }
  }

  async startRun(issueId: string): Promise<Run> {
    const issue = getMockIssue(issueId);
    if (!issue) {
      throw new ApiError(404, `Unknown issue: ${issueId}`);
    }

    if (!canStartRunForIssue(this.listRuns(), issueId)) {
      throw new ApiError(409, "A run is already active for this issue.");
    }

    const timestamp = nowIso();
    const run = createQueuedRun({
      id: randomUUID(),
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      timestamp,
    });
    const attempt = this.countRunsForIssue(issue.id) + 1;
    const record: RunRecord = {
      run,
      controller: new AbortController(),
      attempt,
      prompt: null,
      workspace: null,
      workflowSummary: null,
      providerStarted: false,
    };
    this.runs.set(run.id, record);

    await this.emit(record, {
      id: randomUUID(),
      runId: run.id,
      type: "run.status",
      timestamp,
      status: "queued",
      message: "Run queued.",
    });

    void this.runLifecycle(record);
    return record.run;
  }

  async retryRun(runId: string): Promise<Run> {
    const previousRun = this.requireRun(runId);

    if (!isTerminalRunStatus(previousRun.status)) {
      throw new ApiError(409, "Only terminal runs can be retried.");
    }

    if (!canStartRunForIssue(this.listRuns(), previousRun.issueId)) {
      throw new ApiError(409, "A run is already active for this issue.");
    }

    const issue = getMockIssue(previousRun.issueId);
    if (!issue) {
      throw new ApiError(404, `Unknown issue: ${previousRun.issueId}`);
    }

    const timestamp = nowIso();
    const run = createRetryRun({ previousRun, id: randomUUID(), timestamp });
    const record: RunRecord = {
      run,
      controller: new AbortController(),
      attempt: this.countRunsForIssue(issue.id) + 1,
      prompt: null,
      workspace: null,
      workflowSummary: null,
      providerStarted: false,
    };
    this.runs.set(run.id, record);

    await this.emit(record, {
      id: randomUUID(),
      runId: run.id,
      type: "run.status",
      timestamp,
      status: "queued",
      message: `Retry queued from ${previousRun.id}.`,
    });

    void this.runLifecycle(record);
    return record.run;
  }

  async stopRun(runId: string): Promise<Run> {
    const record = this.requireRecord(runId);

    if (isTerminalRunStatus(record.run.status)) {
      return record.run;
    }

    record.controller.abort();
    await this.emit(record, {
      id: randomUUID(),
      runId,
      type: "run.status",
      timestamp: nowIso(),
      status: "cancelled",
      message: "Run cancelled by user.",
    });

    return record.run;
  }

  private async runLifecycle(record: RunRecord): Promise<void> {
    const issue = getMockIssue(record.run.issueId);
    if (!issue) {
      return;
    }

    try {
      if (record.controller.signal.aborted) return;
      const runtime = this.loadWorkflowRuntime();
      record.workflowSummary = runtime.summary;

      await this.emit(record, {
        id: randomUUID(),
        runId: record.run.id,
        type: "workflow.loaded",
        timestamp: nowIso(),
        workflowPath: runtime.definition.workflowPath,
        loadedAt: runtime.definition.loadedAt,
        configSummary: runtime.summary,
      });

      await this.emit(record, {
        id: randomUUID(),
        runId: record.run.id,
        type: "run.status",
        timestamp: nowIso(),
        status: "preparing_workspace",
        message: "Preparing workflow workspace.",
      });

      const workspaceManager = new WorkspaceManager(runtime.config.workspace.root);
      const workspace = workspaceManager.prepareIssueWorkspace(issue);
      record.workspace = workspace;
      this.workspaces.set(issue.identifier, workspace);
      if (record.controller.signal.aborted) return;

      await this.emit(record, {
        id: randomUUID(),
        runId: record.run.id,
        type: "workspace.ready",
        timestamp: nowIso(),
        workspace,
      });

      await this.emit(record, {
        id: randomUUID(),
        runId: record.run.id,
        type: "run.status",
        timestamp: nowIso(),
        status: "building_prompt",
        message: "Rendering prompt from WORKFLOW.md.",
      });

      const prompt = renderPromptTemplate(runtime.definition.promptTemplate, {
        issue,
        attempt: record.attempt > 1 ? record.attempt : null,
        workflow: runtime.summary,
      });
      record.prompt = prompt;
      if (record.controller.signal.aborted) return;

      await this.emit(record, {
        id: randomUUID(),
        runId: record.run.id,
        type: "prompt.rendered",
        timestamp: nowIso(),
        prompt,
      });

      if (workspace.createdNow) {
        const afterCreateOk = await this.executeHook(record, "afterCreate", runtime.config.hooks.afterCreate, workspace, true);
        if (!afterCreateOk) return;
      }

      const beforeRunOk = await this.executeHook(record, "beforeRun", runtime.config.hooks.beforeRun, workspace, true);
      if (!beforeRunOk) return;
      if (record.controller.signal.aborted) return;

      record.providerStarted = true;
      await runMockAgentProvider({
        run: record.run,
        issue,
        attempt: record.attempt,
        signal: record.controller.signal,
        delayMs: Number(process.env.SYMPHONIA_MOCK_DELAY_MS ?? 450),
        emit: (event) => this.emit(record, event),
      });
    } catch (error) {
      if (error instanceof MockRunCancelledError || record.controller.signal.aborted) {
        return;
      }

      if (error instanceof WorkflowError) {
        await this.emit(record, {
          id: randomUUID(),
          runId: record.run.id,
          type: "workflow.invalid",
          timestamp: nowIso(),
          workflowPath: error.workflowPath ?? null,
          code: error.code,
          error: error.message,
        });
      }

      await this.emit(record, {
        id: randomUUID(),
        runId: record.run.id,
        type: "run.status",
        timestamp: nowIso(),
        status: "failed",
        message: lifecycleFailureMessage(error),
        error: error instanceof Error ? error.message : "Unknown run failure.",
      });
    } finally {
      if (record.providerStarted && record.workspace) {
        try {
          const runtime = this.workflowRuntime;
          if (runtime) {
            await this.executeHook(record, "afterRun", runtime.config.hooks.afterRun, record.workspace, false, false);
          }
        } catch {
          // after_run failures are emitted as hook events and must not replace the provider terminal state.
        }
      }
    }
  }

  private loadWorkflowRuntime(): WorkflowRuntime {
    const runtime = loadWorkflowRuntime({
      workflowPath: this.options.workflowPath ?? process.env.SYMPHONIA_WORKFLOW_PATH,
      cwd: this.options.cwd ?? process.cwd(),
    });
    this.workflowRuntime = runtime;
    return runtime;
  }

  refreshWorkflowStatus(): WorkflowStatus {
    const status = getWorkflowStatus({
      workflowPath: this.options.workflowPath ?? process.env.SYMPHONIA_WORKFLOW_PATH,
      cwd: this.options.cwd ?? process.cwd(),
    });

    if (status.status === "healthy") {
      this.workflowRuntime = loadWorkflowRuntime({
        workflowPath: this.options.workflowPath ?? process.env.SYMPHONIA_WORKFLOW_PATH,
        cwd: this.options.cwd ?? process.cwd(),
      });
    } else {
      this.workflowRuntime = null;
    }

    return status;
  }

  listWorkspaces(): WorkspaceInfo[] {
    const known = [...this.workspaces.values()];
    try {
      const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
      const listed = new WorkspaceManager(runtime.config.workspace.root).listExistingWorkspaces(
        listMockIssues().map((issue) => issue.identifier),
      );
      const byKey = new Map<string, WorkspaceInfo>();
      for (const workspace of [...listed, ...known]) {
        byKey.set(workspace.workspaceKey, workspace);
      }
      return [...byKey.values()].sort((a, b) => a.issueIdentifier.localeCompare(b.issueIdentifier));
    } catch {
      return known.sort((a, b) => a.issueIdentifier.localeCompare(b.issueIdentifier));
    }
  }

  getWorkspaceInfo(issueIdentifier: string): WorkspaceInfo {
    const issue = getMockIssueByIdentifier(issueIdentifier) ?? getMockIssue(issueIdentifier);
    const normalizedIdentifier = issue?.identifier ?? issueIdentifier;
    const cached = this.workspaces.get(normalizedIdentifier);
    if (cached) return cached;

    const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
    return new WorkspaceManager(runtime.config.workspace.root).getIssueWorkspace(normalizedIdentifier);
  }

  getRunPrompt(runId: string): string | null {
    const record = this.requireRecord(runId);
    if (record.prompt) return record.prompt;

    const promptEvent = this.eventStore
      .getEventsForRun(runId)
      .filter((event) => event.type === "prompt.rendered")
      .at(-1);

    return promptEvent?.type === "prompt.rendered" ? promptEvent.prompt : null;
  }

  private async executeHook(
    record: RunRecord,
    hookName: HookName,
    command: string | null,
    workspace: WorkspaceInfo,
    abortOnFailure: boolean,
    respectAbort = true,
  ): Promise<boolean> {
    if (!command) return true;
    if (respectAbort && record.controller.signal.aborted) return false;

    await this.emit(record, {
      id: randomUUID(),
      runId: record.run.id,
      type: "hook.started",
      timestamp: nowIso(),
      hook: makeHookRun(hookName, "running", command, workspace.path),
    });

    const hook = await runHook({
      hookName,
      command,
      cwd: workspace.path,
      timeoutMs: this.workflowRuntime?.config.hooks.timeoutMs ?? 60000,
      signal: respectAbort ? record.controller.signal : undefined,
    });

    const eventType: "hook.succeeded" | "hook.timed_out" | "hook.failed" =
      hook.status === "succeeded" ? "hook.succeeded" : hook.status === "timed_out" ? "hook.timed_out" : "hook.failed";

    await this.emit(record, {
      id: randomUUID(),
      runId: record.run.id,
      type: eventType,
      timestamp: nowIso(),
      hook,
    });

    if (record.controller.signal.aborted) {
      return false;
    }

    if (abortOnFailure && hook.status !== "succeeded") {
      await this.emit(record, {
        id: randomUUID(),
        runId: record.run.id,
        type: "run.status",
        timestamp: nowIso(),
        status: hook.status === "timed_out" ? "timed_out" : "failed",
        message: `${hookName} hook failed before mock provider start.`,
        error: hook.error ?? `${hookName} hook did not succeed.`,
      });
      return false;
    }

    return true;
  }

  private async emit(record: RunRecord, event: AgentEvent): Promise<void> {
    const parsed = AgentEventSchema.parse(event);

    if (isTerminalRunStatus(record.run.status) && parsed.type === "run.status") {
      return;
    }

    this.eventStore.append(parsed);
    record.run = RunSchema.parse(applyRunEvent(record.run, parsed));
    this.broadcast(parsed);
  }

  private streamRunEvents(runId: string, request: IncomingMessage, response: ServerResponse): void {
    this.requireRun(runId);

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(": connected\n\n");

    for (const event of this.eventStore.getEventsForRun(runId)) {
      writeSseEvent(response, event);
    }

    const clients = this.subscribers.get(runId) ?? new Set<ServerResponse>();
    clients.add(response);
    this.subscribers.set(runId, clients);

    const heartbeat = setInterval(() => {
      response.write(": heartbeat\n\n");
    }, 15_000);

    request.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(response);
      if (clients.size === 0) {
        this.subscribers.delete(runId);
      }
    });
  }

  private broadcast(event: AgentEvent): void {
    const clients = this.subscribers.get(event.runId);
    if (!clients) return;

    for (const client of clients) {
      writeSseEvent(client, event);
    }
  }

  listRuns(): Run[] {
    return [...this.runs.values()]
      .map((record) => record.run)
      .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  }

  private countRunsForIssue(issueId: string): number {
    return this.listRuns().filter((run) => run.issueId === issueId).length;
  }

  private requireRecord(runId: string): RunRecord {
    const record = this.runs.get(runId);
    if (!record) {
      throw new ApiError(404, `Unknown run: ${runId}`);
    }
    return record;
  }

  requireRun(runId: string): Run {
    return this.requireRecord(runId).run;
  }
}

export function createDaemonServer(
  eventStore = new EventStore(),
  options: SymphoniaDaemonOptions = {},
): { daemon: SymphoniaDaemon; server: Server } {
  const daemon = new SymphoniaDaemon(eventStore, options);
  return { daemon, server: daemon.createHttpServer() };
}

export function startDaemon(port = Number(process.env.SYMPHONIA_DAEMON_PORT ?? defaultPort)): Server {
  const { daemon, server } = createDaemonServer();
  server.listen(port, () => {
    console.log(`Symphonia daemon listening on http://localhost:${port}`);
  });

  const shutdown = () => {
    daemon.close();
    server.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return server;
}

export function isDaemonEntrypoint(metaUrl: string): boolean {
  return metaUrl === pathToFileURL(process.argv[1] ?? "").href;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function lifecycleFailureMessage(error: unknown): string {
  if (error instanceof WorkflowError) return "Workflow configuration is invalid.";
  if (error instanceof WorkspaceError) return "Workspace preparation failed.";
  if (error instanceof PromptTemplateError) return "Prompt rendering failed.";
  return "Run lifecycle failed.";
}

function makeHookRun(
  hookName: HookName,
  status: HookRun["status"],
  command: string,
  cwd: string,
): HookRun {
  const timestamp = nowIso();
  return {
    hookName,
    status,
    command,
    cwd,
    startedAt: timestamp,
    endedAt: null,
    exitCode: null,
    stdout: "",
    stderr: "",
    error: null,
  };
}

function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof Error) {
    return new ApiError(400, error.message);
  }

  return new ApiError(500, "Unknown error");
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response: ServerResponse, status: number, body: JsonValue): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeSseEvent(response: ServerResponse, event: AgentEvent): void {
  response.write(`event: agent-event\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}
