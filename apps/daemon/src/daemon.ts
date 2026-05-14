import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, realpathSync, rmSync } from "node:fs";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  applyRunEvent,
  applyHarnessArtifacts,
  AuthFetch,
  AuthManager,
  buildWorkspaceInventory,
  canStartRunForIssue,
  claudeProvider,
  codexProvider,
  createDefaultAuthManager,
  createQueuedRun,
  createGitHubClient,
  createRetryRun,
  cursorProvider,
  getWorkflowStatus,
  createLinearTrackerAdapter,
  GitHubFetch,
  HarnessApplyError,
  HarnessScannerError,
  isIssueActive,
  isIssueTerminal,
  LinearFetch,
  linearTrackerAdapter,
  loadWorkflowRuntime,
  nowIso,
  planWorkspaceCleanup,
  ProviderRunCancelledError,
  PromptTemplateError,
  refreshReviewArtifacts,
  renderPromptTemplate,
  runClaudeAgentProvider,
  runCodexAgentProvider,
  runCursorAgentProvider,
  runHook,
  scanHarnessRepository,
  WorkflowError,
  WorkflowRuntime,
  WorkspaceError,
  WorkspaceManager,
  isInsideWorkspaceRoot,
} from "@symphonia/core";
import { EventStore } from "@symphonia/db";
import {
  ApprovalResponseRequestSchema,
  ApprovalState,
  AgentEvent,
  AgentEventSchema,
  AuthCallbackResult,
  AuthConnectionStatus,
  AuthMethod,
  AuthPollResult,
  AuthProviderId,
  AuthProviderIdSchema,
  AuthValidationResult,
  DaemonStatus,
  HookName,
  HookRun,
  Issue,
  isTerminalRunStatus,
  ProviderHealth,
  ProviderId,
  GitHubHealth,
  GitHubStatus,
  HarnessApplyRequestSchema,
  HarnessApplyResult,
  HarnessPreviewRequestSchema,
  HarnessScanRequestSchema,
  HarnessScanResult,
  HarnessStatus,
  ReviewArtifactSnapshot,
  Run,
  RunSchema,
  StartRunRequestSchema,
  TrackerHealth,
  TrackerKind,
  TrackerStatus,
  WorkspaceCleanupExecuteRequestSchema,
  WorkspaceCleanupExecuteRequest,
  WorkspaceCleanupPlan,
  WorkspaceCleanupResult,
  WorkflowConfigSummary,
  WorkflowStatus,
  WorkspaceInfo,
  WorkspaceInventory,
} from "@symphonia/types";
import {
  AuthDisconnectRequestSchema,
  AuthStartRequestSchema,
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
  githubFetch?: GitHubFetch;
  authFetch?: AuthFetch;
  authManager?: AuthManager;
};

export class SymphoniaDaemon {
  private readonly runs = new Map<string, RunRecord>();
  private readonly daemonInstanceId = randomUUID();
  private readonly startedAt = nowIso();
  private readonly subscribers = new Map<string, Set<ServerResponse>>();
  private readonly workspaces = new Map<string, WorkspaceInfo>();
  private readonly approvals = new Map<string, ApprovalRecord>();
  private workflowRuntime: WorkflowRuntime | null = null;
  private trackerLastSyncAt: string | null = null;
  private trackerLastError: string | null = null;
  private trackerPollingTimer: NodeJS.Timeout | null = null;
  private trackerPollingIntervalMs: number | null = null;
  private githubLastCheckedAt: string | null = null;
  private githubLastArtifactRefreshAt: string | null = null;
  private githubLastError: string | null = null;
  private githubLastHealth: GitHubHealth | null = null;
  private readonly artifactRefreshes = new Set<string>();
  private recoveredAt: string | null = null;
  private recoveredRunsCount = 0;
  private orphanedRunsCount = 0;
  private latestWorkspaceInventory: WorkspaceInventory | null = null;
  private latestCleanupPlan: WorkspaceCleanupPlan | null = null;
  private readonly authManager: AuthManager;
  private closed = false;

  constructor(
    private readonly eventStore: EventStore,
    private readonly options: SymphoniaDaemonOptions = {},
  ) {
    this.authManager = options.authManager ?? createDefaultAuthManager({ fetch: options.authFetch });
    this.reconstructPersistedRuns();
  }

  createHttpServer(): Server {
    return createServer((request, response) => {
      void this.route(request, response);
    });
  }

  private reconstructPersistedRuns(): void {
    const recoveredAt = nowIso();
    const persistedRuns = this.eventStore.listRuns();
    let recovered = 0;
    let orphaned = 0;

    for (const persisted of persistedRuns) {
      const previousDaemonInstanceId = persisted.lastSeenDaemonInstanceId ?? persisted.createdByDaemonInstanceId;
      let run = RunSchema.parse({
        ...persisted,
        lastSeenDaemonInstanceId: this.daemonInstanceId,
      });

      if (!isTerminalRunStatus(run.status) && run.createdByDaemonInstanceId !== this.daemonInstanceId) {
        const previousStatus = run.status;
        const recoveryState = previousStatus === "queued" ? "orphaned_on_startup" : "interrupted_by_restart";
        const newStatus = previousStatus === "queued" ? "orphaned" : "interrupted";

        const recoveryEvent = AgentEventSchema.parse({
          id: randomUUID(),
          runId: run.id,
          type: "run.recovered",
          timestamp: recoveredAt,
          previousStatus,
          newStatus,
          previousDaemonInstanceId,
          currentDaemonInstanceId: this.daemonInstanceId,
          recoveredAt,
          reason: "daemon_startup_recovery",
          retryAvailable: true,
        });
        this.eventStore.append(recoveryEvent);

        for (const approvalId of this.findPendingApprovalIds(run.id)) {
          this.eventStore.append(
            AgentEventSchema.parse({
              id: randomUUID(),
              runId: run.id,
              type: "approval.recovered",
              timestamp: recoveredAt,
              approvalId,
              previousStatus: "pending",
              newStatus: "stale",
              previousDaemonInstanceId,
              currentDaemonInstanceId: this.daemonInstanceId,
              recoveredAt,
              reason: "daemon_startup_recovery",
            }),
          );
          this.eventStore.append(
            AgentEventSchema.parse({
              id: randomUUID(),
              runId: run.id,
              type: "approval.resolved",
              timestamp: recoveredAt,
              approvalId,
              resolution: "cancel",
            }),
          );
        }

        const statusEvent = AgentEventSchema.parse({
          id: randomUUID(),
          runId: run.id,
          type: "run.status",
          timestamp: recoveredAt,
          status: newStatus,
          message: "Run was interrupted by daemon startup recovery.",
          error: "daemon_startup_recovery",
        });
        this.eventStore.append(statusEvent);
        run = RunSchema.parse({
          ...applyRunEvent(run, statusEvent),
          recoveryState,
          recoveredAt,
          endedAt: recoveredAt,
          terminalReason: "daemon_startup_recovery",
          error: "daemon_startup_recovery",
          lastSeenDaemonInstanceId: this.daemonInstanceId,
        });
        recovered += 1;
        if (newStatus === "orphaned") orphaned += 1;
      }

      this.eventStore.saveRun(run);
      const record = this.recordFromPersistedRun(run);
      this.runs.set(run.id, record);
      if (run.workspacePath) {
        this.workspaces.set(run.issueIdentifier, {
          issueIdentifier: run.issueIdentifier,
          workspaceKey: basename(run.workspacePath),
          path: run.workspacePath,
          createdNow: false,
          exists: true,
        });
      }
    }

    if (recovered > 0) {
      this.recoveredAt = recoveredAt;
      this.recoveredRunsCount = recovered;
      this.orphanedRunsCount = orphaned;
    }
  }

  private recordFromPersistedRun(run: Run): RunRecord {
    return {
      run,
      issue: this.issueForRun(run),
      controller: new AbortController(),
      attempt: run.attempt,
      prompt: this.getPersistedRunPrompt(run.id),
      workspace: run.workspacePath
        ? {
            issueIdentifier: run.issueIdentifier,
            workspaceKey: basename(run.workspacePath),
            path: run.workspacePath,
            createdNow: false,
            exists: true,
          }
        : null,
      workflowSummary: null,
      providerStarted: false,
    };
  }

  private issueForRun(run: Run): Issue {
    return (
      this.eventStore.getIssue(run.issueId) ??
      this.eventStore.getIssueByIdentifier(run.issueIdentifier) ?? {
        id: run.issueId,
        identifier: run.issueIdentifier,
        title: run.issueTitle ?? run.issueIdentifier,
        description: "",
        state: "Recovered",
        labels: [],
        priority: "No priority",
        createdAt: run.startedAt ?? nowIso(),
        updatedAt: run.updatedAt ?? nowIso(),
        url: "http://localhost/recovered-run",
        tracker: { kind: run.trackerKind, sourceId: run.issueId },
      }
    );
  }

  private findPendingApprovalIds(runId: string): string[] {
    const pending = new Set<string>();
    for (const event of this.eventStore.getEventsForRun(runId)) {
      if (event.type === "approval.requested") pending.add(event.approvalId);
      if (event.type === "approval.resolved") pending.delete(event.approvalId);
    }
    return [...pending];
  }

  close(): void {
    this.closed = true;
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

      if (request.method === "GET" && path === "/github/status") {
        return sendJson(response, 200, { github: this.getGithubStatus() });
      }

      if (request.method === "GET" && path === "/github/health") {
        return sendJson(response, 200, { github: await this.getGithubHealth() });
      }

      if (request.method === "GET" && path === "/auth/status") {
        return sendJson(response, 200, { auth: this.authManager.getStatus() });
      }

      if (request.method === "GET" && path === "/auth/connections") {
        return sendJson(response, 200, { connections: this.authManager.getConnections() });
      }

      const authConnectionMatch = path.match(/^\/auth\/(github|linear)$/);
      if (request.method === "GET" && authConnectionMatch) {
        const provider = parseAuthProvider(authConnectionMatch[1]!);
        return sendJson(response, 200, { connection: this.authManager.getConnection(provider) });
      }

      const authStartMatch = path.match(/^\/auth\/(github|linear)\/start$/);
      if (request.method === "POST" && authStartMatch) {
        const provider = parseAuthProvider(authStartMatch[1]!);
        const body = AuthStartRequestSchema.parse({ ...objectBody(await readJsonBody(request)), provider });
        const result = await this.authManager.startAuth(body);
        this.appendAuthStartEvents(result.authSessionId, result.provider, result.method, result.status, result.verificationUri);
        return sendJson(response, 200, { result });
      }

      const authPollMatch = path.match(/^\/auth\/(github|linear)\/poll\/([^/]+)$/);
      if (request.method === "GET" && authPollMatch) {
        const provider = parseAuthProvider(authPollMatch[1]!);
        const result = await this.authManager.pollAuth(provider, decodeURIComponent(authPollMatch[2]!));
        this.appendAuthPollEvents(provider, result);
        return sendJson(response, 200, { result });
      }

      const authCallbackMatch = path.match(/^\/auth\/(github|linear)\/callback$/);
      if (request.method === "GET" && authCallbackMatch) {
        const provider = parseAuthProvider(authCallbackMatch[1]!);
        const result = await this.authManager.completeCallback(provider, {
          code: url.searchParams.get("code") ?? undefined,
          state: url.searchParams.get("state") ?? undefined,
          error: url.searchParams.get("error") ?? undefined,
        });
        this.appendAuthCallbackEvents(provider, result);
        return sendHtml(
          response,
          200,
          `<html><body><h1>Symphonia ${provider} auth</h1><p>${escapeHtml(result.error ?? result.status)}</p><p>You can return to Symphonia.</p></body></html>`,
        );
      }

      if (request.method === "POST" && authCallbackMatch) {
        const provider = parseAuthProvider(authCallbackMatch[1]!);
        const result = await this.authManager.completeCallback(provider, await readJsonBody(request));
        this.appendAuthCallbackEvents(provider, result);
        return sendJson(response, 200, { result });
      }

      const authRefreshMatch = path.match(/^\/auth\/(github|linear)\/refresh$/);
      if (request.method === "POST" && authRefreshMatch) {
        const provider = parseAuthProvider(authRefreshMatch[1]!);
        const result = await this.authManager.refreshConnection(provider);
        this.appendAuthValidationEvent(result, result.status === "connected" ? "auth.refreshed" : null);
        return sendJson(response, 200, { result });
      }

      const authValidateMatch = path.match(/^\/auth\/(github|linear)\/validate$/);
      if (request.method === "POST" && authValidateMatch) {
        const provider = parseAuthProvider(authValidateMatch[1]!);
        const result = await this.authManager.validateConnection(provider);
        this.appendAuthValidationEvent(result);
        return sendJson(response, 200, { result });
      }

      const authDisconnectMatch = path.match(/^\/auth\/(github|linear)\/disconnect$/);
      if (request.method === "POST" && authDisconnectMatch) {
        const provider = parseAuthProvider(authDisconnectMatch[1]!);
        const body = AuthDisconnectRequestSchema.parse({ ...objectBody(await readJsonBody(request)), provider });
        const connection = await this.authManager.disconnect(body);
        this.appendDaemonEvent({
          id: randomUUID(),
          runId: "__daemon__",
          type: "auth.disconnected",
          timestamp: nowIso(),
          provider,
          deleteStoredToken: body.deleteStoredToken,
        });
        return sendJson(response, 200, { connection });
      }

      if (request.method === "GET" && (path === "/daemon/status" || path === "/recovery/status")) {
        return sendJson(response, 200, { daemon: await this.getDaemonStatus() });
      }

      if (request.method === "GET" && path === "/harness/status") {
        return sendJson(response, 200, { harness: this.getHarnessStatus() });
      }

      if (request.method === "GET" && path === "/harness/scans") {
        const repositoryPath = url.searchParams.get("repositoryPath") ?? undefined;
        const scans = this.eventStore.listHarnessScans(repositoryPath ? this.normalizeRepositoryPath(repositoryPath) : undefined, 20);
        return sendJson(response, 200, { scans });
      }

      if (request.method === "POST" && path === "/harness/scan") {
        const scan = this.runHarnessScan(await readJsonBody(request));
        return sendJson(response, 201, { scan });
      }

      const harnessScanMatch = path.match(/^\/harness\/scans\/([^/]+)$/);
      if (request.method === "GET" && harnessScanMatch) {
        const scan = this.eventStore.getHarnessScan(decodeURIComponent(harnessScanMatch[1]!));
        if (!scan) throw new ApiError(404, "Harness scan not found.");
        return sendJson(response, 200, { scan });
      }

      if (request.method === "POST" && path === "/harness/previews") {
        const { scan, previews } = this.generateHarnessPreviewsForScan(await readJsonBody(request));
        return sendJson(response, 200, { scan, previews });
      }

      if (request.method === "POST" && path === "/harness/apply") {
        const result = this.applyHarnessPreviews(await readJsonBody(request));
        return sendJson(response, 200, { result });
      }

      const harnessRecommendationsMatch = path.match(/^\/harness\/recommendations\/([^/]+)$/);
      if (request.method === "GET" && harnessRecommendationsMatch) {
        const scan = this.eventStore.getHarnessScan(decodeURIComponent(harnessRecommendationsMatch[1]!));
        if (!scan) throw new ApiError(404, "Harness scan not found.");
        return sendJson(response, 200, { recommendations: scan.recommendations });
      }

      const providerHealthMatch = path.match(/^\/providers\/(codex|claude|cursor)\/health$/);
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

      const issueReviewArtifactsMatch = path.match(/^\/issues\/([^/]+)\/review-artifacts$/);
      if (request.method === "GET" && issueReviewArtifactsMatch) {
        const issueKey = decodeURIComponent(issueReviewArtifactsMatch[1]!);
        return sendJson(response, 200, {
          reviewArtifacts: this.getLatestReviewArtifactsForIssue(issueKey),
        });
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
        const inventory = await this.refreshWorkspaceInventory();
        return sendJson(response, 200, { workspaces: inventory.workspaces, inventory });
      }

      if (request.method === "POST" && path === "/workspaces/refresh") {
        const inventory = await this.refreshWorkspaceInventory();
        return sendJson(response, 200, { inventory });
      }

      if (request.method === "GET" && path === "/workspaces/cleanup/plan") {
        return sendJson(response, 200, { plan: await this.createCleanupPlan() });
      }

      if (request.method === "POST" && path === "/workspaces/cleanup/plan") {
        const body = WorkspaceCleanupExecuteRequestSchema.partial().parse(await readJsonBody(request));
        return sendJson(response, 200, { plan: await this.createCleanupPlan(body.identifiers) });
      }

      if (request.method === "POST" && path === "/workspaces/cleanup/execute") {
        const body = WorkspaceCleanupExecuteRequestSchema.parse(await readJsonBody(request));
        return sendJson(response, 200, { result: await this.executeCleanup(body) });
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

      const runReviewArtifactsRefreshMatch = path.match(/^\/runs\/([^/]+)\/review-artifacts\/refresh$/);
      if (request.method === "POST" && runReviewArtifactsRefreshMatch) {
        return sendJson(response, 200, {
          reviewArtifacts: await this.refreshReviewArtifactsForRun(runReviewArtifactsRefreshMatch[1]!),
        });
      }

      const runReviewArtifactsMatch = path.match(/^\/runs\/([^/]+)\/review-artifacts$/);
      if (request.method === "GET" && runReviewArtifactsMatch) {
        const runId = runReviewArtifactsMatch[1]!;
        this.requireRun(runId);
        return sendJson(response, 200, { reviewArtifacts: this.getReviewArtifacts(runId) });
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
    const runtime = this.loadWorkflowRuntime();
    const issue = await this.resolveIssue(issueId, runtime);
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
    const attempt = this.countRunsForIssue(issue.id) + 1;
    const run = createQueuedRun({
      id: randomUUID(),
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title,
      trackerKind: issue.tracker?.kind ?? runtime.config.tracker.kind,
      provider,
      attempt,
      timestamp,
      daemonInstanceId: this.daemonInstanceId,
    });
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
    const previousRecord = this.requireRecord(runId);
    previousRecord.run = RunSchema.parse({
      ...previousRecord.run,
      recoveryState:
        previousRecord.run.recoveryState === "interrupted_by_restart" || previousRecord.run.recoveryState === "orphaned_on_startup"
          ? "manually_retried"
          : previousRecord.run.recoveryState,
      updatedAt: timestamp,
      lastSeenDaemonInstanceId: this.daemonInstanceId,
    });
    this.eventStore.saveRun(previousRecord.run);

    const run = createRetryRun({ previousRun, id: randomUUID(), timestamp, daemonInstanceId: this.daemonInstanceId });
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

      await this.refreshReviewArtifactsForRecord(record, runtime);
      if (record.controller.signal.aborted) return;

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
          claudeConfig: runtime.config.claude,
          cursorConfig: runtime.config.cursor,
          signal: record.controller.signal,
          emit: (event) => this.emit(record, event),
          requestApproval: (request) => this.requestApproval(record, request),
        });
      } else if (record.run.provider === "claude") {
        await runClaudeAgentProvider({
          run: record.run,
          issue,
          attempt: record.attempt,
          workspacePath: workspace.path,
          renderedPrompt: prompt,
          workflowConfig: runtime.config,
          codexConfig: runtime.config.codex,
          claudeConfig: runtime.config.claude,
          cursorConfig: runtime.config.cursor,
          signal: record.controller.signal,
          emit: (event) => this.emit(record, event),
        });
      } else if (record.run.provider === "cursor") {
        await runCursorAgentProvider({
          run: record.run,
          issue,
          attempt: record.attempt,
          workspacePath: workspace.path,
          renderedPrompt: prompt,
          workflowConfig: runtime.config,
          codexConfig: runtime.config.codex,
          claudeConfig: runtime.config.claude,
          cursorConfig: runtime.config.cursor,
          signal: record.controller.signal,
          emit: (event) => this.emit(record, event),
        });
      } else {
        throw new ApiError(400, `Unsupported provider: ${record.run.provider}`);
      }
    } catch (error) {
      if (error instanceof ProviderRunCancelledError || record.controller.signal.aborted) {
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
            await this.refreshReviewArtifactsForRecord(record, runtime);
          }
        } catch {
          // after_run and review artifact failures are emitted as events and must not replace the provider terminal state.
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
    return this.eventStore.listIssues(runtime.config.tracker.kind);
  }

  async refreshIssueCache(options: { reconcile?: boolean } = {}): Promise<Issue[]> {
    const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
    const adapter = this.trackerAdapter(runtime.config.tracker.kind);

    try {
      const fetched = await adapter.fetchIssues(await this.trackerContext(runtime));
      this.eventStore.upsertIssues(fetched.issues, fetched.fetchedAt);
      this.trackerLastSyncAt = fetched.fetchedAt;
      this.trackerLastError = fetched.diagnostics.join("\n") || null;
      if (options.reconcile) {
        await this.reconcileRunningIssues(runtime, fetched.issues);
      }
      return fetched.issues;
    } catch (error) {
      this.trackerLastError = error instanceof Error ? error.message : "Issue refresh failed.";
      return this.eventStore.listIssues(runtime.config.tracker.kind);
    }
  }

  async resolveIssue(issueIdOrIdentifier: string, runtime = this.workflowRuntime ?? this.loadWorkflowRuntime()): Promise<Issue> {
    const cached =
      this.eventStore.getIssue(issueIdOrIdentifier) ?? this.eventStore.getIssueByIdentifier(issueIdOrIdentifier);
    if (cached?.tracker?.kind === runtime.config.tracker.kind) return cached;

    try {
      const issue = await this.trackerAdapter(runtime.config.tracker.kind).fetchIssue(
        await this.trackerContext(runtime),
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
      return this.trackerAdapter(runtime.config.tracker.kind).health(await this.trackerContext(runtime));
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

  getGithubStatus(): GitHubStatus {
    try {
      const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
      const summary = runtime.summary.github;

      if (!runtime.config.github.enabled) {
        return {
          enabled: false,
          status: "disabled",
          config: summary,
          lastCheckedAt: this.githubLastCheckedAt,
          lastArtifactRefreshAt: this.githubLastArtifactRefreshAt,
          error: null,
        };
      }

      const missingToken = !this.authManager.resolveCredential("github") && !runtime.config.github.token;
      const error = this.githubLastError ?? (missingToken ? "GitHub token is not configured; local artifacts still work." : null);
      const status = error
        ? this.githubLastArtifactRefreshAt
          ? "stale"
          : "unavailable"
        : this.githubLastHealth?.healthy
          ? "healthy"
          : "unknown";

      return {
        enabled: true,
        status,
        config: summary,
        lastCheckedAt: this.githubLastCheckedAt,
        lastArtifactRefreshAt: this.githubLastArtifactRefreshAt,
        error,
      };
    } catch (error) {
      return {
        enabled: true,
        status: "invalid_config",
        config: null,
        lastCheckedAt: this.githubLastCheckedAt,
        lastArtifactRefreshAt: this.githubLastArtifactRefreshAt,
        error: error instanceof Error ? error.message : "GitHub configuration is invalid.",
      };
    }
  }

  async getGithubHealth(): Promise<GitHubHealth> {
    const checkedAt = nowIso();
    try {
      const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
      if (!runtime.config.github.enabled) {
        const health: GitHubHealth = { enabled: false, healthy: true, checkedAt, error: null, rateLimit: null };
        this.githubLastCheckedAt = checkedAt;
        this.githubLastHealth = health;
        this.githubLastError = null;
        return health;
      }

      const credential = await this.resolveGithubCredential();
      const client = createGitHubClient({ ...runtime.config.github, token: credential?.token ?? runtime.config.github.token }, this.options.githubFetch);
      if (!client) {
        const health: GitHubHealth = {
          enabled: true,
          healthy: false,
          checkedAt,
          error: credential || runtime.config.github.token
            ? "GitHub owner/repo is not configured."
            : "GitHub token is not configured; local artifacts still work.",
          rateLimit: null,
        };
        this.githubLastCheckedAt = checkedAt;
        this.githubLastHealth = health;
        this.githubLastError = health.error;
        return health;
      }

      const health = await client.healthCheck();
      this.githubLastCheckedAt = health.checkedAt;
      this.githubLastHealth = health;
      this.githubLastError = health.error;
      return health;
    } catch (error) {
      const health: GitHubHealth = {
        enabled: true,
        healthy: false,
        checkedAt,
        error: error instanceof Error ? error.message : "GitHub health check failed.",
        rateLimit: null,
      };
      this.githubLastCheckedAt = checkedAt;
      this.githubLastHealth = health;
      this.githubLastError = health.error;
      return health;
    }
  }

  async getDaemonStatus(): Promise<DaemonStatus> {
    const workflow = this.refreshWorkflowStatus();
    const tracker = this.getTrackerStatus();
    const providers = await this.listProviderHealth();

    return {
      daemonInstanceId: this.daemonInstanceId,
      startedAt: this.startedAt,
      recoveredAt: this.recoveredAt,
      recoveredRunsCount: this.recoveredRunsCount,
      orphanedRunsCount: this.orphanedRunsCount,
      activeRunsCount: this.listRuns().filter((run) => !isTerminalRunStatus(run.status)).length,
      dbPath: this.eventStore.getDatabasePath(),
      workspaceRoot: workflow.effectiveConfigSummary?.workspaceRoot ?? null,
      workflowStatus: workflow.status,
      trackerStatus: tracker.status,
      providerSummary: providers.map((provider) => ({
        id: provider.id,
        enabled: provider.enabled,
        available: provider.available,
        status: provider.status,
      })),
    };
  }

  getHarnessStatus(): HarnessStatus {
    const currentRepositoryPath = this.getCurrentRepositoryPath();
    const latest = this.eventStore.getLatestHarnessScanForRepository(currentRepositoryPath);
    return {
      available: true,
      currentRepositoryPath,
      latestScanId: latest?.id ?? null,
      latestScanAt: latest?.scannedAt ?? null,
      latestGrade: latest?.grade ?? null,
    };
  }

  runHarnessScan(input: unknown): HarnessScanResult {
    const repositoryPath = this.getCurrentRepositoryPath();
    const scanId = `scan-${randomUUID()}`;
    const request = HarnessScanRequestSchema.parse({
      repositoryPath,
      includeGitStatus: true,
      includeDocs: true,
      includeScripts: true,
      includePackageMetadata: true,
      includeWorkflow: true,
      includeAgentsMd: true,
      includeCi: true,
      includeSecurity: true,
      includeAccessibility: true,
      includeGeneratedPreviews: false,
      ...(typeof input === "object" && input ? input : {}),
    });

    this.appendDaemonEvent({
      id: randomUUID(),
      runId: "__daemon__",
      type: "harness.scan.started",
      timestamp: nowIso(),
      scanId,
      repositoryPath: request.repositoryPath,
    });

    try {
      const scan = scanHarnessRepository(request, { id: scanId });
      this.eventStore.saveHarnessScan(scan);
      for (const recommendation of scan.recommendations) {
        this.appendDaemonEvent({
          id: randomUUID(),
          runId: "__daemon__",
          type: "harness.recommendation.generated",
          timestamp: nowIso(),
          scanId: scan.id,
          recommendation,
        });
      }
      for (const artifact of scan.generatedPreviews) {
        this.appendDaemonEvent({
          id: randomUUID(),
          runId: "__daemon__",
          type: "harness.artifact.previewed",
          timestamp: nowIso(),
          scanId: scan.id,
          artifact,
        });
      }
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: "__daemon__",
        type: "harness.scan.completed",
        timestamp: nowIso(),
        scanId: scan.id,
        repositoryPath: scan.repositoryPath,
        score: scan.score,
      });
      return scan;
    } catch (error) {
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: "__daemon__",
        type: "harness.scan.failed",
        timestamp: nowIso(),
        scanId,
        repositoryPath: request.repositoryPath,
        error: error instanceof Error ? error.message : "Harness scan failed.",
      });
      throw normalizeHarnessError(error);
    }
  }

  generateHarnessPreviewsForScan(input: unknown): { scan: HarnessScanResult; previews: HarnessScanResult["generatedPreviews"] } {
    const request = HarnessPreviewRequestSchema.parse(input);
    const existing = this.eventStore.getHarnessScan(request.scanId);
    if (!existing) throw new ApiError(404, "Harness scan not found.");

    const scan = scanHarnessRepository(
      {
        repositoryPath: existing.repositoryPath,
        includeGitStatus: true,
        includeDocs: true,
        includeScripts: true,
        includePackageMetadata: true,
        includeWorkflow: true,
        includeAgentsMd: true,
        includeCi: true,
        includeSecurity: true,
        includeAccessibility: true,
        includeGeneratedPreviews: true,
      },
      { id: existing.id },
    );
    this.eventStore.saveHarnessScan(scan);
    for (const artifact of scan.generatedPreviews) {
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: "__daemon__",
        type: "harness.artifact.previewed",
        timestamp: nowIso(),
        scanId: scan.id,
        artifact,
      });
    }
    return { scan, previews: scan.generatedPreviews };
  }

  applyHarnessPreviews(input: unknown): HarnessApplyResult {
    const request = HarnessApplyRequestSchema.parse(input);
    const repositoryPath = this.normalizeRepositoryPath(request.repositoryPath);
    let scan = this.eventStore.getLatestHarnessScanForRepository(repositoryPath);
    if (!scan) {
      throw new ApiError(404, "Run a harness scan before applying artifact previews.");
    }
    if (scan.generatedPreviews.length === 0) {
      scan = this.generateHarnessPreviewsForScan({ scanId: scan.id }).scan;
    }

    try {
      const result = applyHarnessArtifacts({ ...request, repositoryPath }, scan.generatedPreviews, { scanId: scan.id });
      const appliedAt = nowIso();
      this.eventStore.saveHarnessApplyResult({
        id: `apply-${randomUUID()}`,
        repositoryPath,
        scanId: scan.id,
        appliedAt,
        result,
      });

      for (const item of result.applied) {
        this.appendDaemonEvent({
          id: randomUUID(),
          runId: "__daemon__",
          type: "harness.artifact.applied",
          timestamp: nowIso(),
          scanId: scan.id,
          artifactId: item.artifactId,
          path: item.path,
        });
      }
      for (const item of result.skipped) {
        this.appendDaemonEvent({
          id: randomUUID(),
          runId: "__daemon__",
          type: "harness.artifact.skipped",
          timestamp: nowIso(),
          scanId: scan.id,
          artifactId: item.artifactId,
          path: item.path,
          reason: item.message,
        });
      }
      for (const item of result.failed) {
        this.appendDaemonEvent({
          id: randomUUID(),
          runId: "__daemon__",
          type: "harness.artifact.failed",
          timestamp: nowIso(),
          scanId: scan.id,
          artifactId: item.artifactId,
          path: item.path,
          error: item.error,
        });
      }

      return result;
    } catch (error) {
      throw normalizeHarnessError(error);
    }
  }

  private getCurrentRepositoryPath(): string {
    return this.normalizeRepositoryPath(this.options.cwd ?? process.env.SYMPHONIA_REPO_ROOT ?? inferRepositoryRoot(process.cwd()));
  }

  private normalizeRepositoryPath(path: string): string {
    const resolved = resolve(path);
    try {
      return realpathSync(resolved);
    } catch {
      return resolved;
    }
  }

  getReviewArtifacts(runId: string): ReviewArtifactSnapshot | null {
    this.requireRun(runId);
    return this.eventStore.getReviewArtifactSnapshot(runId);
  }

  getLatestReviewArtifactsForIssue(issueIdOrIdentifier: string): ReviewArtifactSnapshot | null {
    return (
      this.eventStore.getLatestReviewArtifactSnapshotByIssue(issueIdOrIdentifier) ??
      this.eventStore.getLatestReviewArtifactSnapshotByIdentifier(issueIdOrIdentifier)
    );
  }

  async refreshReviewArtifactsForRun(runId: string): Promise<ReviewArtifactSnapshot | null> {
    const record = this.requireRecord(runId);
    const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
    return this.refreshReviewArtifactsForRecord(record, runtime);
  }

  listWorkspaces(): WorkspaceInfo[] {
    const known = [...this.workspaces.values()];
    try {
      const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
      const issues = this.eventStore.listIssues(runtime.config.tracker.kind);
      const identifiers = issues.map((issue) => issue.identifier);
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

  async refreshWorkspaceInventory(): Promise<WorkspaceInventory> {
    const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
    const issues = this.eventStore.listIssues(runtime.config.tracker.kind);
    const inventory = await buildWorkspaceInventory({
      workspaceRoot: runtime.config.workspace.root,
      runs: this.listRuns(),
      issues,
      cleanupPolicy: runtime.config.workspace.cleanup,
    });
    this.latestWorkspaceInventory = inventory;

    for (const workspace of inventory.workspaces) {
      this.workspaces.set(workspace.issueIdentifier, {
        issueIdentifier: workspace.issueIdentifier,
        workspaceKey: workspace.workspaceKey,
        path: workspace.path,
        createdNow: false,
        exists: workspace.exists,
      });
    }

    return inventory;
  }

  async createCleanupPlan(identifiers: string[] = []): Promise<WorkspaceCleanupPlan> {
    const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
    const inventory = await this.refreshWorkspaceInventory();
    const plan = planWorkspaceCleanup(inventory, runtime.config.workspace.cleanup, {
      id: randomUUID(),
      selectedIdentifiers: identifiers,
    });
    this.latestCleanupPlan = plan;
    this.appendDaemonEvent({
      id: randomUUID(),
      runId: "__daemon__",
      type: "workspace.cleanup.planned",
      timestamp: plan.generatedAt,
      plan,
    });
    return plan;
  }

  async executeCleanup(request: WorkspaceCleanupExecuteRequest): Promise<WorkspaceCleanupResult> {
    const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
    const policy = runtime.config.workspace.cleanup;
    const startedAt = nowIso();
    const plan =
      request.planId && this.latestCleanupPlan?.id === request.planId
        ? this.latestCleanupPlan
        : await this.createCleanupPlan(request.identifiers ?? []);
    const deleted: WorkspaceCleanupResult["deleted"] = [];
    const skipped: WorkspaceCleanupResult["skipped"] = [];
    const errors: WorkspaceCleanupResult["errors"] = [];

    if (!policy.enabled || policy.dryRun || (policy.requireManualConfirmation && request.confirm !== "delete workspaces")) {
      const reason = !policy.enabled
        ? "cleanup_disabled"
        : policy.dryRun
          ? "dry_run"
          : "missing_confirmation";
      for (const item of plan.candidates) {
        skipped.push({ ...item, skippedReason: reason });
        this.appendDaemonEvent({
          id: randomUUID(),
          runId: "__daemon__",
          type: "workspace.cleanup.skipped",
          timestamp: nowIso(),
          workspaceKey: item.workspaceKey,
          path: item.path,
          reason,
        });
      }
      return {
        startedAt,
        completedAt: nowIso(),
        dryRun: policy.dryRun,
        deleted,
        skipped,
        errors,
        bytesFreed: 0,
      };
    }

    for (const item of plan.candidates) {
      const path = resolve(item.path);
      const root = resolve(plan.root);
      const activeRun = this.listRuns().find(
        (run) => !isTerminalRunStatus(run.status) && (run.issueIdentifier === item.issueIdentifier || run.workspacePath === path),
      );

      if (activeRun) {
        skipped.push({ ...item, skippedReason: "active_run" });
        continue;
      }

      if (!isInsideWorkspaceRoot(root, path) || path === root) {
        skipped.push({ ...item, skippedReason: "outside_workspace_root" });
        continue;
      }

      try {
        const stats = lstatSync(path);
        if (stats.isSymbolicLink()) {
          skipped.push({ ...item, skippedReason: "symlink_escape_protected" });
          continue;
        }

        if (runtime.config.hooks.beforeRemove) {
          const hook = await runHook({
            hookName: "beforeRemove",
            command: runtime.config.hooks.beforeRemove,
            cwd: path,
            timeoutMs: runtime.config.hooks.timeoutMs,
          });
          if (hook.status !== "succeeded") {
            skipped.push({ ...item, skippedReason: "before_remove_failed" });
            continue;
          }
        }

        this.appendDaemonEvent({
          id: randomUUID(),
          runId: "__daemon__",
          type: "workspace.cleanup.started",
          timestamp: nowIso(),
          workspaceKey: item.workspaceKey,
          path,
        });
        rmSync(path, { recursive: true, force: true });
        deleted.push(item);
        this.appendDaemonEvent({
          id: randomUUID(),
          runId: "__daemon__",
          type: "workspace.cleanup.deleted",
          timestamp: nowIso(),
          workspaceKey: item.workspaceKey,
          path,
          bytesFreed: item.sizeBytes,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Workspace cleanup failed.";
        errors.push({ workspaceKey: item.workspaceKey, path, error: message });
        this.appendDaemonEvent({
          id: randomUUID(),
          runId: "__daemon__",
          type: "workspace.cleanup.failed",
          timestamp: nowIso(),
          workspaceKey: item.workspaceKey,
          path,
          error: message,
        });
      }
    }

    for (const item of skipped) {
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: "__daemon__",
        type: "workspace.cleanup.skipped",
        timestamp: nowIso(),
        workspaceKey: item.workspaceKey,
        path: item.path,
        reason: item.skippedReason,
      });
    }

    const result: WorkspaceCleanupResult = {
      startedAt,
      completedAt: nowIso(),
      dryRun: false,
      deleted,
      skipped,
      errors,
      bytesFreed: deleted.some((item) => item.sizeBytes === null)
        ? null
        : deleted.reduce((total, item) => total + (item.sizeBytes ?? 0), 0),
    };
    this.appendDaemonEvent({
      id: randomUUID(),
      runId: "__daemon__",
      type: "workspace.cleanup.completed",
      timestamp: result.completedAt,
      result,
    });
    this.latestWorkspaceInventory = null;
    return result;
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

    return this.getPersistedRunPrompt(runId);
  }

  private getPersistedRunPrompt(runId: string): string | null {
    const promptEvent = this.eventStore
      .getEventsForRun(runId)
      .filter((event) => event.type === "prompt.rendered")
      .at(-1);

    return promptEvent?.type === "prompt.rendered" ? promptEvent.prompt : null;
  }

  async listProviderHealth(): Promise<ProviderHealth[]> {
    return [
      await this.getProviderHealth("codex"),
      await this.getProviderHealth("claude"),
      await this.getProviderHealth("cursor"),
    ];
  }

  async getProviderHealth(providerId: ProviderId): Promise<ProviderHealth> {
    if (providerId === "codex") return codexProvider.health(this.getCodexConfigForHealth());
    if (providerId === "claude") return claudeProvider.health(this.getClaudeConfigForHealth());
    return cursorProvider.health(this.getCursorConfigForHealth());
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
        message: `${hookName} hook failed before provider start.`,
        error: hook.error ?? `${hookName} hook did not succeed.`,
      });
      return false;
    }

    return true;
  }

  private async refreshReviewArtifactsForRecord(
    record: RunRecord,
    runtime: WorkflowRuntime,
  ): Promise<ReviewArtifactSnapshot | null> {
    if (this.artifactRefreshes.has(record.run.id)) {
      return this.eventStore.getReviewArtifactSnapshot(record.run.id);
    }

    this.artifactRefreshes.add(record.run.id);
    try {
      const result = await refreshReviewArtifacts({
        run: record.run,
        issue: record.issue,
        workspace: record.workspace,
        workflowConfig: {
          ...runtime.config,
          github: {
            ...runtime.config.github,
            token: (await this.resolveGithubCredential())?.token ?? runtime.config.github.token,
          },
        },
        githubFetch: this.options.githubFetch,
        signal: record.controller.signal,
      });

      for (const event of result.events) {
        await this.emit(record, event);
      }

      this.eventStore.saveReviewArtifactSnapshot(result.snapshot);
      this.githubLastArtifactRefreshAt = result.snapshot.lastRefreshedAt;
      this.githubLastError = result.snapshot.error;
      if (result.health) {
        this.githubLastHealth = result.health;
        this.githubLastCheckedAt = result.health.checkedAt;
      }
      return result.snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Review artifact refresh failed.";
      this.githubLastError = message;
      await this.emit(record, {
        id: randomUUID(),
        runId: record.run.id,
        type: "github.error",
        timestamp: nowIso(),
        operation: "refresh",
        message,
        status: null,
      });
      return this.eventStore.getReviewArtifactSnapshot(record.run.id);
    } finally {
      this.artifactRefreshes.delete(record.run.id);
    }
  }

  private async emit(record: RunRecord, event: AgentEvent): Promise<void> {
    if (this.closed) return;
    const parsed = AgentEventSchema.parse(event);

    if (isTerminalRunStatus(record.run.status) && parsed.type === "run.status") {
      return;
    }

    this.eventStore.append(parsed);
    record.run = RunSchema.parse({
      ...applyRunEvent(record.run, parsed),
      lastSeenDaemonInstanceId: this.daemonInstanceId,
    });
    this.eventStore.saveRun(record.run);
    this.broadcast(parsed);
  }

  private appendDaemonEvent(event: AgentEvent): void {
    if (this.closed) return;
    this.eventStore.append(AgentEventSchema.parse(event));
  }

  private appendAuthStartEvents(
    authSessionId: string,
    provider: AuthProviderId,
    method: AuthMethod,
    status: AuthConnectionStatus,
    verificationUri: string | null,
  ): void {
    this.appendDaemonEvent({
      id: randomUUID(),
      runId: "__daemon__",
      type: "auth.started",
      timestamp: nowIso(),
      provider,
      method,
      authSessionId,
    });
    if (status === "pending_user") {
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: "__daemon__",
        type: "auth.pending_user",
        timestamp: nowIso(),
        provider,
        method,
        authSessionId,
        verificationUri,
      });
    }
  }

  private appendAuthPollEvents(provider: AuthProviderId, result: AuthPollResult): void {
    if (result.status === "connected" && result.connection) {
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: "__daemon__",
        type: "auth.connected",
        timestamp: nowIso(),
        connection: result.connection,
      });
      return;
    }
    if (result.status === "failed" || result.status === "expired") {
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: "__daemon__",
        type: "auth.failed",
        timestamp: nowIso(),
        provider,
        method: result.connection?.method ?? "oauth_device",
        authSessionId: result.authSessionId,
        error: result.error ?? "Auth flow failed.",
      });
    }
  }

  private appendAuthCallbackEvents(provider: AuthProviderId, result: AuthCallbackResult): void {
    if (result.status === "connected" && result.connection) {
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: "__daemon__",
        type: "auth.connected",
        timestamp: nowIso(),
        connection: result.connection,
      });
      return;
    }
    if (result.status === "failed") {
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: "__daemon__",
        type: "auth.failed",
        timestamp: nowIso(),
        provider,
        method: result.connection?.method ?? "oauth_pkce",
        authSessionId: null,
        error: result.error ?? "Auth callback failed.",
      });
    }
  }

  private appendAuthValidationEvent(result: AuthValidationResult, successEvent: "auth.refreshed" | null = null): void {
    if (result.status === "connected") {
      const connection = this.authManager.getConnection(result.provider);
      if (successEvent === "auth.refreshed") {
        this.appendDaemonEvent({
          id: randomUUID(),
          runId: "__daemon__",
          type: "auth.refreshed",
          timestamp: nowIso(),
          connection,
        });
      }
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: "__daemon__",
        type: "auth.validation_succeeded",
        timestamp: nowIso(),
        result,
      });
      return;
    }
    this.appendDaemonEvent({
      id: randomUUID(),
      runId: "__daemon__",
      type: "auth.validation_failed",
      timestamp: nowIso(),
      provider: result.provider,
      error: result.error ?? "Auth validation failed.",
      credentialSource: result.credentialSource,
    });
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
    if (envProvider === "codex" || envProvider === "claude" || envProvider === "cursor") {
      return envProvider;
    }

    try {
      const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
      return runtime.config.provider;
    } catch {
      return "codex";
    }
  }

  private trackerAdapter(kind: TrackerKind) {
    if (kind !== "linear") throw new ApiError(400, `Unsupported tracker: ${kind}`);
    return this.options.linearFetch ? createLinearTrackerAdapter({ fetch: this.options.linearFetch }) : linearTrackerAdapter;
  }

  private async resolveGithubCredential() {
    let credential = this.authManager.resolveCredential("github");
    if (!credential) {
      const refresh = await this.authManager.refreshConnection("github");
      if (refresh.status === "connected") credential = this.authManager.resolveCredential("github");
    }
    return credential;
  }

  private async trackerContext(runtime: WorkflowRuntime, signal?: AbortSignal) {
    let credential = this.authManager.resolveCredential("linear");
    if (credential?.connection.status === "expired") {
      await this.authManager.refreshConnection("linear");
      credential = this.authManager.resolveCredential("linear");
    }
    return {
      workflowConfig: runtime.config,
      trackerConfig: runtime.config.tracker,
      credentialToken: credential?.authorizationHeader ?? runtime.config.tracker.apiKey ?? undefined,
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

  private getClaudeConfigForHealth() {
    try {
      const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
      return runtime.config.claude;
    } catch {
      return {
        enabled: false,
        command: process.env.SYMPHONIA_CLAUDE_COMMAND ?? "claude",
        model: "sonnet",
        maxTurns: 8,
        outputFormat: "stream-json" as const,
        permissionMode: "default",
        allowedTools: [],
        disallowedTools: [],
        appendSystemPrompt: null,
        extraArgs: [],
        env: {},
        redactedEnvKeys: [],
        healthCheckCommand: null,
        timeoutMs: 3600000,
        stallTimeoutMs: 300000,
        readTimeoutMs: 5000,
        cwdBehavior: "workspace" as const,
      };
    }
  }

  private getCursorConfigForHealth() {
    try {
      const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
      return runtime.config.cursor;
    } catch {
      return {
        enabled: false,
        command: process.env.SYMPHONIA_CURSOR_COMMAND ?? "cursor-agent",
        model: null,
        outputFormat: "stream-json" as const,
        force: false,
        extraArgs: [],
        env: {},
        redactedEnvKeys: [],
        healthCheckCommand: null,
        timeoutMs: 3600000,
        stallTimeoutMs: 300000,
        readTimeoutMs: 5000,
        cwdBehavior: "workspace" as const,
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

function parseAuthProvider(value: string): AuthProviderId {
  return AuthProviderIdSchema.parse(value);
}

function objectBody(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function normalizeHarnessError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof HarnessScannerError || error instanceof HarnessApplyError) return new ApiError(400, error.message);
  if (error instanceof Error) return new ApiError(400, error.message);
  return new ApiError(500, "Unknown harness error");
}

function inferRepositoryRoot(startPath: string): string {
  let current = resolve(startPath);
  while (true) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml")) || existsSync(resolve(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(startPath);
    current = parent;
  }
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

function sendHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  response.end(body);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
