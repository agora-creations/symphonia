import { randomUUID } from "node:crypto";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import {
  applyRunEvent,
  canStartRunForIssue,
  codexProvider,
  createQueuedRun,
  createRetryRun,
  getMockIssue,
  mockProviderHealth,
  getWorkflowStatus,
  createLinearTrackerAdapter,
  isIssueActive,
  isIssueTerminal,
  LinearFetch,
  linearTrackerAdapter,
  listMockIssues,
  loadWorkflowRuntime,
  mockTrackerAdapter,
  MockRunCancelledError,
  nowIso,
  PromptTemplateError,
  renderPromptTemplate,
  runCodexAgentProvider,
  runMockAgentProvider,
  runHook,
  WorkflowError,
  WorkflowRuntime,
  WorkspaceError,
  WorkspaceManager,
} from "@symphonia/core";
import { EventStore } from "@symphonia/db";
import {
  ApprovalResponseRequestSchema,
  ApprovalState,
  AgentEvent,
  AgentEventSchema,
  HookName,
  HookRun,
  Issue,
  isTerminalRunStatus,
  ProviderHealth,
  ProviderId,
  Run,
  RunSchema,
  StartRunRequestSchema,
  TrackerHealth,
  TrackerKind,
  TrackerStatus,
  WorkflowConfigSummary,
  WorkflowStatus,
  WorkspaceInfo,
} from "@symphonia/types";

type RunRecord = {
  run: Run;
  issue: Issue;
  controller: AbortController;
  attempt: number;
  prompt: string | null;
  workspace: WorkspaceInfo | null;
  workflowSummary: WorkflowConfigSummary | null;
  providerStarted: boolean;
};

type ApprovalRecord = ApprovalState & {
  resolve?: (decision: "accept" | "acceptForSession" | "decline" | "cancel") => void;
};

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

const defaultPort = 4100;

export type SymphoniaDaemonOptions = {
  workflowPath?: string;
  cwd?: string;
  linearFetch?: LinearFetch;
};

export class SymphoniaDaemon {
  private readonly runs = new Map<string, RunRecord>();
  private readonly subscribers = new Map<string, Set<ServerResponse>>();
  private readonly workspaces = new Map<string, WorkspaceInfo>();
  private readonly approvals = new Map<string, ApprovalRecord>();
  private workflowRuntime: WorkflowRuntime | null = null;
  private trackerLastSyncAt: string | null = null;
  private trackerLastError: string | null = null;
  private trackerPollingTimer: NodeJS.Timeout | null = null;
  private trackerPollingIntervalMs: number | null = null;

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
    if (this.trackerPollingTimer) {
      clearInterval(this.trackerPollingTimer);
      this.trackerPollingTimer = null;
      this.trackerPollingIntervalMs = null;
    }

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

      if (request.method === "GET" && path === "/providers") {
        return sendJson(response, 200, { providers: await this.listProviderHealth() });
      }

      if (request.method === "GET" && path === "/tracker/status") {
        return sendJson(response, 200, { tracker: this.getTrackerStatus() });
      }

      if (request.method === "GET" && path === "/tracker/health") {
        return sendJson(response, 200, { tracker: await this.getTrackerHealth() });
      }

      const providerHealthMatch = path.match(/^\/providers\/(mock|codex)\/health$/);
      if (request.method === "GET" && providerHealthMatch) {
        return sendJson(response, 200, { provider: await this.getProviderHealth(providerHealthMatch[1]! as ProviderId) });
      }

      if (request.method === "POST" && path === "/workflow/reload") {
        this.workflowRuntime = null;
        return sendJson(response, 200, { workflow: this.refreshWorkflowStatus() });
      }

      if (request.method === "GET" && path === "/issues") {
        return sendJson(response, 200, { issues: await this.listIssues() });
      }

      if (request.method === "POST" && path === "/issues/refresh") {
        return sendJson(response, 200, { issues: await this.refreshIssueCache({ reconcile: true }) });
      }

      const issueByIdentifierMatch = path.match(/^\/issues\/by-identifier\/([^/]+)$/);
      if (request.method === "GET" && issueByIdentifierMatch) {
        const issue = await this.resolveIssue(decodeURIComponent(issueByIdentifierMatch[1]!));
        return sendJson(response, 200, { issue });
      }

      const issueMatch = path.match(/^\/issues\/([^/]+)$/);
      if (request.method === "GET" && issueMatch) {
        const issue = await this.resolveIssue(decodeURIComponent(issueMatch[1]!));
        return sendJson(response, 200, { issue });
      }

      if (request.method === "GET" && path === "/runs") {
        return sendJson(response, 200, { runs: this.listRuns() });
      }

      if (request.method === "GET" && path === "/approvals") {
        return sendJson(response, 200, { approvals: this.listApprovals() });
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
        const run = await this.startRun(body.issueId, body.provider);
        return sendJson(response, 201, { run });
      }

      const runApprovalsMatch = path.match(/^\/runs\/([^/]+)\/approvals$/);
      if (request.method === "GET" && runApprovalsMatch) {
        this.requireRun(runApprovalsMatch[1]!);
        return sendJson(response, 200, { approvals: this.listApprovals(runApprovalsMatch[1]!) });
      }

      const approvalResponseMatch = path.match(/^\/approvals\/([^/]+)\/respond$/);
      if (request.method === "POST" && approvalResponseMatch) {
        const body = ApprovalResponseRequestSchema.parse(await readJsonBody(request));
        return sendJson(response, 200, {
          approval: await this.respondApproval(decodeURIComponent(approvalResponseMatch[1]!), body.decision),
        });
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

  async startRun(issueId: string, requestedProvider?: ProviderId): Promise<Run> {
    let runtime: WorkflowRuntime | null = null;
    try {
      runtime = this.loadWorkflowRuntime();
    } catch {
      runtime = null;
    }
    const fallbackIssue = getMockIssue(issueId);
    const issue = runtime ? await this.resolveIssue(issueId, runtime) : fallbackIssue;
    if (!issue) {
      throw new ApiError(404, `Unknown issue: ${issueId}`);
    }

    if (!canStartRunForIssue(this.listRuns(), issue.id)) {
      throw new ApiError(409, "A run is already active for this issue.");
    }

    if (runtime && isIssueTerminal(issue, runtime.config.tracker)) {
      throw new ApiError(409, `Issue ${issue.identifier} is terminal in tracker state ${issue.state}.`);
    }

    const timestamp = nowIso();
    const provider = requestedProvider ?? runtime?.config.provider ?? this.getDefaultProvider();
    const run = createQueuedRun({
      id: randomUUID(),
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      provider,
      timestamp,
    });
    const attempt = this.countRunsForIssue(issue.id) + 1;
    const record: RunRecord = {
      run,
      issue,
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
    const runtime = this.loadWorkflowRuntime();

    if (!isTerminalRunStatus(previousRun.status)) {
      throw new ApiError(409, "Only terminal runs can be retried.");
    }

    if (!canStartRunForIssue(this.listRuns(), previousRun.issueId)) {
      throw new ApiError(409, "A run is already active for this issue.");
    }

    const issue = await this.resolveIssue(previousRun.issueId, runtime);
    if (isIssueTerminal(issue, runtime.config.tracker)) {
      throw new ApiError(409, `Issue ${issue.identifier} is terminal in tracker state ${issue.state}.`);
    }

    const timestamp = nowIso();
    const run = createRetryRun({ previousRun, id: randomUUID(), timestamp });
    const record: RunRecord = {
      run,
      issue,
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

    this.cancelPendingApprovalsForRun(runId);
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
    const issue = record.issue;

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
      if (record.run.provider === "codex") {
        await runCodexAgentProvider({
          run: record.run,
          issue,
          attempt: record.attempt,
          workspacePath: workspace.path,
          renderedPrompt: prompt,
          workflowConfig: runtime.config,
          codexConfig: runtime.config.codex,
          signal: record.controller.signal,
          emit: (event) => this.emit(record, event),
          requestApproval: (request) => this.requestApproval(record, request),
        });
      } else {
        await runMockAgentProvider({
          run: record.run,
          issue,
          attempt: record.attempt,
          signal: record.controller.signal,
          delayMs: Number(process.env.SYMPHONIA_MOCK_DELAY_MS ?? 450),
          emit: (event) => this.emit(record, event),
        });
      }
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
    this.ensureTrackerPolling(runtime);
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
      this.ensureTrackerPolling(this.workflowRuntime);
    } else {
      this.workflowRuntime = null;
      this.ensureTrackerPolling(null);
    }

    return status;
  }

  async listIssues(): Promise<Issue[]> {
    const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();

    if (runtime.config.tracker.kind === "mock") {
      const fetched = await mockTrackerAdapter.fetchIssues(this.trackerContext(runtime));
      this.eventStore.upsertIssues(fetched.issues, fetched.fetchedAt);
      this.trackerLastSyncAt = fetched.fetchedAt;
      this.trackerLastError = null;
      return fetched.issues;
    }

    return this.eventStore.listIssues(runtime.config.tracker.kind);
  }

  async refreshIssueCache(options: { reconcile?: boolean } = {}): Promise<Issue[]> {
    const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
    const adapter = this.trackerAdapter(runtime.config.tracker.kind);

    try {
      const fetched = await adapter.fetchIssues(this.trackerContext(runtime));
      this.eventStore.upsertIssues(fetched.issues, fetched.fetchedAt);
      this.trackerLastSyncAt = fetched.fetchedAt;
      this.trackerLastError = fetched.diagnostics.join("\n") || null;
      if (options.reconcile) {
        await this.reconcileRunningIssues(runtime, fetched.issues);
      }
      return fetched.issues;
    } catch (error) {
      this.trackerLastError = error instanceof Error ? error.message : "Issue refresh failed.";
      if (runtime.config.tracker.kind === "mock") return listMockIssues();
      return this.eventStore.listIssues(runtime.config.tracker.kind);
    }
  }

  async resolveIssue(issueIdOrIdentifier: string, runtime = this.workflowRuntime ?? this.loadWorkflowRuntime()): Promise<Issue> {
    const cached =
      this.eventStore.getIssue(issueIdOrIdentifier) ?? this.eventStore.getIssueByIdentifier(issueIdOrIdentifier);
    if (cached?.tracker?.kind === runtime.config.tracker.kind) return cached;

    try {
      const issue = await this.trackerAdapter(runtime.config.tracker.kind).fetchIssue(
        this.trackerContext(runtime),
        issueIdOrIdentifier,
      );
      if (issue) {
        this.eventStore.upsertIssues([issue], issue.lastFetchedAt ?? nowIso());
        return issue;
      }
    } catch (error) {
      if (cached) return cached;
      this.trackerLastError = error instanceof Error ? error.message : "Issue lookup failed.";
      throw error;
    }

    if (cached) return cached;
    throw new ApiError(404, `Unknown issue: ${issueIdOrIdentifier}`);
  }

  getTrackerStatus(): TrackerStatus {
    try {
      const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
      const stats = this.eventStore.getIssueCacheStats(runtime.config.tracker.kind);
      const hasError = Boolean(this.trackerLastError);
      const status = hasError
        ? stats.lastFetchedAt
          ? "stale"
          : "unavailable"
        : runtime.config.tracker.kind === "linear" && !stats.lastFetchedAt
          ? "unknown"
          : "healthy";

      return {
        kind: runtime.config.tracker.kind,
        displayName: this.trackerAdapter(runtime.config.tracker.kind).displayName,
        status,
        config: runtime.summary,
        lastSyncAt: this.trackerLastSyncAt ?? stats.lastFetchedAt,
        issueCount: stats.issueCount,
        error: this.trackerLastError,
      };
    } catch (error) {
      return {
        kind: "linear",
        displayName: "Linear",
        status: "invalid_config",
        config: null,
        lastSyncAt: this.trackerLastSyncAt,
        issueCount: 0,
        error: error instanceof Error ? error.message : "Tracker configuration is invalid.",
      };
    }
  }

  async getTrackerHealth(): Promise<TrackerHealth> {
    try {
      const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
      return this.trackerAdapter(runtime.config.tracker.kind).health(this.trackerContext(runtime));
    } catch (error) {
      return {
        kind: "linear",
        displayName: "Linear",
        healthy: false,
        checkedAt: nowIso(),
        error: error instanceof Error ? error.message : "Tracker configuration is invalid.",
      };
    }
  }

  listWorkspaces(): WorkspaceInfo[] {
    const known = [...this.workspaces.values()];
    try {
      const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
      const issues = this.eventStore.listIssues(runtime.config.tracker.kind);
      const identifiers = issues.length > 0 ? issues.map((issue) => issue.identifier) : listMockIssues().map((issue) => issue.identifier);
      const listed = new WorkspaceManager(runtime.config.workspace.root).listExistingWorkspaces(
        identifiers,
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
    const issue = this.eventStore.getIssueByIdentifier(issueIdentifier) ?? this.eventStore.getIssue(issueIdentifier);
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

  async listProviderHealth(): Promise<ProviderHealth[]> {
    return [mockProviderHealth, await this.getProviderHealth("codex")];
  }

  async getProviderHealth(providerId: ProviderId): Promise<ProviderHealth> {
    if (providerId === "mock") return mockProviderHealth;
    return codexProvider.health(this.getCodexConfigForHealth());
  }

  listApprovals(runId?: string): ApprovalState[] {
    return [...this.approvals.values()]
      .filter((approval) => !runId || approval.runId === runId)
      .map((approval) => this.serializeApproval(approval))
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  private requestApproval(
    record: RunRecord,
    request: {
      approvalId: string;
      provider: ProviderId;
      approvalType: ApprovalState["approvalType"];
      threadId: string | null;
      turnId: string | null;
      itemId: string | null;
      prompt: string;
      reason: string | null;
      command: string | null;
      cwd: string | null;
      fileSummary: string | null;
      availableDecisions: Array<"accept" | "acceptForSession" | "decline" | "cancel">;
    },
  ): Promise<"accept" | "acceptForSession" | "decline" | "cancel"> {
    if (record.controller.signal.aborted) return Promise.resolve("cancel");

    return new Promise((resolve) => {
      const approval: ApprovalRecord = {
        approvalId: request.approvalId,
        runId: record.run.id,
        provider: request.provider,
        approvalType: request.approvalType,
        status: "pending",
        prompt: request.prompt,
        threadId: request.threadId,
        turnId: request.turnId,
        itemId: request.itemId,
        reason: request.reason,
        command: request.command,
        cwd: request.cwd,
        fileSummary: request.fileSummary,
        availableDecisions: request.availableDecisions,
        decision: null,
        requestedAt: nowIso(),
        resolvedAt: null,
        resolve,
      };
      this.approvals.set(request.approvalId, approval);

      record.controller.signal.addEventListener(
        "abort",
        () => {
          void this.resolveApproval(request.approvalId, "cancel");
        },
        { once: true },
      );
    });
  }

  private async respondApproval(approvalId: string, decision: ApprovalState["decision"]): Promise<ApprovalState> {
    if (decision !== "accept" && decision !== "acceptForSession" && decision !== "decline" && decision !== "cancel") {
      throw new ApiError(400, `Unsupported approval decision: ${decision ?? "null"}`);
    }
    const resolved = await this.resolveApproval(approvalId, decision);
    if (!resolved) throw new ApiError(404, `Unknown approval: ${approvalId}`);
    return resolved;
  }

  private async resolveApproval(
    approvalId: string,
    decision: "accept" | "acceptForSession" | "decline" | "cancel",
  ): Promise<ApprovalState | null> {
    const approval = this.approvals.get(approvalId);
    if (!approval) return null;
    if (approval.status === "resolved") {
      return this.serializeApproval(approval);
    }

    approval.status = "resolved";
    approval.decision = decision;
    approval.resolvedAt = nowIso();
    const resolve = approval.resolve;
    approval.resolve = undefined;
    resolve?.(decision);
    return this.serializeApproval(approval);
  }

  private serializeApproval(approval: ApprovalRecord): ApprovalState {
    return {
      approvalId: approval.approvalId,
      runId: approval.runId,
      provider: approval.provider,
      approvalType: approval.approvalType,
      status: approval.status,
      prompt: approval.prompt,
      threadId: approval.threadId,
      turnId: approval.turnId,
      itemId: approval.itemId,
      reason: approval.reason,
      command: approval.command,
      cwd: approval.cwd,
      fileSummary: approval.fileSummary,
      availableDecisions: approval.availableDecisions,
      decision: approval.decision,
      requestedAt: approval.requestedAt,
      resolvedAt: approval.resolvedAt,
    };
  }

  private cancelPendingApprovalsForRun(runId: string): void {
    for (const approval of this.approvals.values()) {
      if (approval.runId === runId && approval.status === "pending") {
        void this.resolveApproval(approval.approvalId, "cancel");
      }
    }
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

  private getDefaultProvider(): ProviderId {
    const envProvider = process.env.SYMPHONIA_PROVIDER;
    if (envProvider === "mock" || envProvider === "codex") return envProvider;

    try {
      const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
      return runtime.config.provider;
    } catch {
      return "mock";
    }
  }

  private trackerAdapter(kind: TrackerKind) {
    if (kind !== "linear") return mockTrackerAdapter;
    return this.options.linearFetch ? createLinearTrackerAdapter({ fetch: this.options.linearFetch }) : linearTrackerAdapter;
  }

  private trackerContext(runtime: WorkflowRuntime, signal?: AbortSignal) {
    return {
      workflowConfig: runtime.config,
      trackerConfig: runtime.config.tracker,
      signal,
    };
  }

  private ensureTrackerPolling(runtime: WorkflowRuntime | null): void {
    const nextInterval = runtime
      ? runtime.config.tracker.pollIntervalMs ?? runtime.config.polling.intervalMs
      : null;

    if (this.trackerPollingIntervalMs === nextInterval) return;

    if (this.trackerPollingTimer) {
      clearInterval(this.trackerPollingTimer);
      this.trackerPollingTimer = null;
    }

    this.trackerPollingIntervalMs = nextInterval;
    if (!nextInterval) return;

    this.trackerPollingTimer = setInterval(() => {
      void this.refreshIssueCache({ reconcile: true });
    }, nextInterval);
  }

  private async reconcileRunningIssues(runtime: WorkflowRuntime, fetchedIssues: Issue[]): Promise<void> {
    const fetchedById = new Map(fetchedIssues.map((issue) => [issue.id, issue]));

    for (const record of this.runs.values()) {
      if (isTerminalRunStatus(record.run.status)) continue;

      const currentIssue =
        fetchedById.get(record.run.issueId) ??
        this.eventStore.getIssue(record.run.issueId) ??
        this.eventStore.getIssueByIdentifier(record.run.issueIdentifier);
      if (!currentIssue) continue;

      const terminal = isIssueTerminal(currentIssue, runtime.config.tracker);
      const active = isIssueActive(currentIssue, runtime.config.tracker);
      if (!terminal && active) {
        record.issue = currentIssue;
        continue;
      }

      const action = terminal ? "stopped_terminal" : "stopped_inactive";
      const message = terminal
        ? `Tracker state ${currentIssue.state} is terminal; run interrupted.`
        : `Tracker state ${currentIssue.state} is no longer active; run interrupted.`;

      this.cancelPendingApprovalsForRun(record.run.id);
      record.controller.abort();
      await this.emit(record, {
        id: randomUUID(),
        runId: record.run.id,
        type: "tracker.reconciled",
        timestamp: nowIso(),
        tracker: runtime.config.tracker.kind,
        issueId: currentIssue.id,
        identifier: currentIssue.identifier,
        previousState: record.issue.state,
        currentState: currentIssue.state,
        action,
        message,
      });
      await this.emit(record, {
        id: randomUUID(),
        runId: record.run.id,
        type: "run.status",
        timestamp: nowIso(),
        status: "cancelled",
        message,
      });
      record.issue = currentIssue;
    }
  }

  private getCodexConfigForHealth() {
    try {
      const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
      return runtime.config.codex;
    } catch {
      return {
        command: process.env.SYMPHONIA_CODEX_COMMAND ?? "codex app-server",
        model: null,
        approvalPolicy: null,
        threadSandbox: null,
        turnSandboxPolicy: null,
        turnTimeoutMs: 3600000,
        readTimeoutMs: 5000,
        stallTimeoutMs: 300000,
      };
    }
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
