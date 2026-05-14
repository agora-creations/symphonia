import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, realpathSync, rmSync } from "node:fs";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import rootPackage from "../../../package.json" with { type: "json" };
import {
  applyRunEvent,
  applyHarnessArtifacts,
  AuthFetch,
  AuthManager,
  buildWorkspaceInventory,
  canStartRunForIssue,
  buildGitHubPrPreview,
  buildLinearCommentPreview,
  claudeProvider,
  codexProvider,
  createDefaultAuthManager,
  createQueuedRun,
  createGitHubClient,
  createLinearClient,
  createRetryRun,
  cursorProvider,
  getWorkflowStatus,
  createLinearTrackerAdapter,
  githubWritePolicy,
  GitHubFetch,
  HarnessApplyError,
  HarnessScannerError,
  isIssueActive,
  isIssueTerminal,
  LinearFetch,
  linearTrackerAdapter,
  linearWritePolicy,
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
  ChangedFile,
  ConnectedGoldenPathStatus,
  DaemonStatus,
  DiffSummary,
  HookName,
  HookRun,
  Issue,
  isTerminalRunStatus,
  IntegrationWriteKind,
  IntegrationWritePolicy,
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
  IntegrationWritePreview,
  IntegrationWriteResult,
  ReviewArtifactSnapshot,
  Run,
  RunApprovalEvidence,
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
  WriteActionAvailability,
  WriteActionPreviewContract,
  WriteActionPreviewContractSchema,
  LinearStatusUpdatePreview,
  LinearStatusUpdatePreviewSchema,
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
const daemonVersion = typeof rootPackage.version === "string" ? rootPackage.version : "0.1.0";

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
        return sendJson(response, 200, { ok: true, service: "symphonia-daemon", version: daemonVersion, timestamp: nowIso() });
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

      if (request.method === "GET" && path === "/writes/status") {
        return sendJson(response, 200, { writes: this.getWritesStatus() });
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

      if (request.method === "GET" && (path === "/connected/status" || path === "/golden-path/status")) {
        return sendJson(response, 200, { connected: await this.getConnectedStatus() });
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

      const runApprovalEvidenceMatch = path.match(/^\/runs\/([^/]+)\/approval-evidence$/);
      if (request.method === "GET" && runApprovalEvidenceMatch) {
        return sendJson(response, 200, { approvalEvidence: this.getRunApprovalEvidence(runApprovalEvidenceMatch[1]!) });
      }

      const runReviewArtifactsMatch = path.match(/^\/runs\/([^/]+)\/review-artifacts$/);
      if (request.method === "GET" && runReviewArtifactsMatch) {
        const runId = runReviewArtifactsMatch[1]!;
        this.requireRun(runId);
        return sendJson(response, 200, { reviewArtifacts: this.getReviewArtifacts(runId) });
      }

      const runWriteActionsMatch = path.match(/^\/runs\/([^/]+)\/write-actions$/);
      if (request.method === "GET" && runWriteActionsMatch) {
        const runId = runWriteActionsMatch[1]!;
        this.requireRun(runId);
        return sendJson(response, 200, {
          writeActions: this.eventStore.listIntegrationWriteActionsForRun(runId),
          availability: this.getWriteActionAvailability(runId),
          previews: await this.getWriteActionPreviews(runId),
        });
      }

      const githubPrPreviewMatch = path.match(/^\/runs\/([^/]+)\/github\/pr\/preview$/);
      if (request.method === "POST" && githubPrPreviewMatch) {
        const preview = await this.previewGithubPr(githubPrPreviewMatch[1]!, await readJsonBody(request));
        return sendJson(response, 200, { preview });
      }

      const githubPrCreateMatch = path.match(/^\/runs\/([^/]+)\/github\/pr\/create$/);
      if (request.method === "POST" && githubPrCreateMatch) {
        this.requireRun(githubPrCreateMatch[1]!);
        throw new ApiError(405, "GitHub PR creation is disabled in Milestone 15B; use preview-only write contracts.");
      }

      const linearCommentPreviewMatch = path.match(/^\/runs\/([^/]+)\/linear\/comment\/preview$/);
      if (request.method === "POST" && linearCommentPreviewMatch) {
        const preview = await this.previewLinearComment(linearCommentPreviewMatch[1]!, await readJsonBody(request));
        return sendJson(response, 200, { preview });
      }

      const linearCommentCreateMatch = path.match(/^\/runs\/([^/]+)\/linear\/comment\/create$/);
      if (request.method === "POST" && linearCommentCreateMatch) {
        this.requireRun(linearCommentCreateMatch[1]!);
        throw new ApiError(405, "Linear comments are disabled in Milestone 15B; use preview-only write contracts.");
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

  async getConnectedStatus(): Promise<ConnectedGoldenPathStatus> {
    const generatedAt = nowIso();
    const workflow = this.refreshWorkflowStatus();
    const repositoryPath = this.getCurrentRepositoryPath();
    const summary = workflow.effectiveConfigSummary;
    const workspacePath = summary?.workspaceRoot ?? null;
    const tracker = this.getTrackerStatus();
    let github = this.getGithubStatus();
    const providers = await this.listProviderHealth();
    const providerKind = summary?.defaultProvider ?? this.getDefaultProvider();
    const provider = providers.find((item) => item.id === providerKind) ?? (await this.getProviderHealth(providerKind));
    const linearConnection = this.authManager.getConnection("linear");
    const githubConnection = this.authManager.getConnection("github");
    const linearCredential = this.authManager.resolveCredential("linear");
    const githubCredential = this.authManager.resolveCredential("github");
    const hasLinearCredential = Boolean(linearCredential || this.workflowRuntime?.config.tracker.apiKey);
    const hasGithubCredential = Boolean(githubCredential || this.workflowRuntime?.config.github.token);
    if (github.enabled && hasGithubCredential) {
      await this.getGithubHealth();
      github = this.getGithubStatus();
    }
    const writes = this.tryGetWritesStatus();
    const runs = this.listRuns();
    const activeRun = runs.find((run) => !isTerminalRunStatus(run.status)) ?? null;
    const latestRun = activeRun ?? runs[0] ?? null;
    const reviewArtifact = latestRun ? this.eventStore.getReviewArtifactSnapshot(latestRun.id) : null;
    const issueScope = this.issueScopeLabel(summary);
    const repositoryStatus =
      workflow.status === "healthy" ? "ready" : workflow.status === "missing" ? "missing" : "invalid";
    const workspaceStatus = workspacePath ? "ready" : workflow.status === "healthy" ? "missing" : "unknown";
    const linearStatus = connectedLinearStatus(workflow.status, tracker.status, tracker.issueCount, hasLinearCredential);
    const githubStatus = connectedGithubStatus(github, hasGithubCredential);
    const providerStatus = provider.available ? "ready" : provider.status === "invalid_config" ? "invalid_config" : "unavailable";
    const blockers: string[] = [];

    if (repositoryStatus !== "ready") {
      blockers.push(workflow.error ?? "No healthy WORKFLOW.md is loaded for a local repository.");
    }
    if (workspaceStatus !== "ready") {
      blockers.push("No workspace root is configured.");
    }
    if (linearStatus !== "ready") {
      blockers.push(linearBlocker(linearStatus, tracker.error));
    }
    if (githubStatus !== "ready") {
      blockers.push(githubBlocker(githubStatus, github.error));
    }
    if (providerStatus !== "ready") {
      blockers.push(provider.error ?? provider.hint ?? "Codex provider is not available.");
    }
    if (tracker.issueCount === 0) {
      blockers.push("No real Linear issues are cached for the current issue scope.");
    }

    const boardReady =
      repositoryStatus === "ready" &&
      workspaceStatus === "ready" &&
      linearStatus === "ready" &&
      githubStatus === "ready" &&
      providerStatus === "ready" &&
      tracker.issueCount > 0;
    const boardStatus = boardReady ? "ready" : tracker.issueCount === 0 ? "empty" : "blocked";
    const onboardingState = connectedOnboardingState({
      repositoryStatus,
      workspaceStatus,
      linearStatus,
      githubStatus,
      providerStatus,
      boardReady,
      activeRun,
      latestRun,
      reviewArtifactReady: Boolean(reviewArtifact),
      issueCount: tracker.issueCount,
    });

    return {
      mode: "connected",
      generatedAt,
      onboardingState,
      daemon: {
        status: "healthy",
        instanceId: this.daemonInstanceId,
        startedAt: this.startedAt,
        activeRunsCount: runs.filter((run) => !isTerminalRunStatus(run.status)).length,
        recoveredRunsCount: this.recoveredRunsCount,
      },
      repository: {
        status: repositoryStatus,
        path: repositoryPath,
        workflowPath: workflow.workflowPath,
        workflowStatus: workflow.status,
        error: workflow.error,
      },
      workspace: {
        status: workspaceStatus,
        path: workspacePath,
        exists: workspacePath ? existsSync(workspacePath) : null,
      },
      linear: {
        status: linearStatus,
        authStatus: linearConnection.status,
        credentialSource: linearConnection.credentialSource,
        issueCount: tracker.issueCount,
        issueScope,
        lastSyncAt: tracker.lastSyncAt,
        error: tracker.error,
      },
      github: {
        status: githubStatus,
        authStatus: githubConnection.status,
        credentialSource: githubConnection.credentialSource,
        enabled: github.enabled,
        repository: github.config?.owner && github.config.repo ? `${github.config.owner}/${github.config.repo}` : null,
        lastCheckedAt: github.lastCheckedAt,
        error: github.error,
      },
      provider: {
        kind: providerKind,
        status: providerStatus,
        command: provider.command,
        available: provider.available,
        error: provider.error,
        hint: provider.hint,
      },
      eventStore: {
        status: "ready",
        databasePath: this.eventStore.getDatabasePath(),
      },
      board: {
        status: boardStatus,
        issueCount: tracker.issueCount,
        issueScope,
        lastSyncAt: tracker.lastSyncAt,
      },
      activeRun: activeRun
        ? {
            id: activeRun.id,
            issueIdentifier: activeRun.issueIdentifier,
            provider: activeRun.provider,
            status: activeRun.status,
          }
        : null,
      reviewArtifact: {
        status: reviewArtifact ? "ready" : latestRun ? "missing" : "unavailable",
        runId: reviewArtifact?.runId ?? latestRun?.id ?? null,
        issueIdentifier: reviewArtifact?.issueIdentifier ?? latestRun?.issueIdentifier ?? null,
        lastRefreshedAt: reviewArtifact?.lastRefreshedAt ?? null,
        error: reviewArtifact?.error ?? null,
      },
      writes: {
        github: writePosture(writes?.github ?? null),
        linear: writePosture(writes?.linear ?? null),
      },
      nextAction: connectedNextAction({
        repositoryStatus,
        workspaceStatus,
        linearStatus,
        githubStatus,
        providerStatus,
        boardReady,
        issueCount: tracker.issueCount,
        activeRun,
        latestRun,
        reviewArtifactReady: Boolean(reviewArtifact),
      }),
      blockingReasons: [...new Set(blockers.filter(Boolean))],
    };
  }

  private tryGetWritesStatus(): { github: IntegrationWritePolicy; linear: IntegrationWritePolicy } | null {
    try {
      return this.getWritesStatus();
    } catch {
      return null;
    }
  }

  private issueScopeLabel(summary: WorkflowConfigSummary | null): string {
    if (!summary) return "No Linear issue scope loaded";
    if (summary.teamKey) return `Linear team ${summary.teamKey}`;
    if (summary.teamId) return `Linear team id ${summary.teamId}`;
    if (summary.projectSlug) return `Linear project ${summary.projectSlug}`;
    if (summary.projectId) return `Linear project id ${summary.projectId}`;
    if (summary.allowWorkspaceWide) return "Linear workspace-wide read-only scope";
    return "Linear issue scope missing";
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

  getWritesStatus() {
    const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
    return {
      github: githubWritePolicy(runtime.config.github),
      linear: linearWritePolicy(runtime.config.tracker),
    };
  }

  getRunApprovalEvidence(runId: string): RunApprovalEvidence {
    const record = this.requireRecord(runId);
    const events = this.eventStore.getEventsForRun(runId);
    const reviewArtifact = this.eventStore.getReviewArtifactSnapshot(runId);
    const fileEvidence = this.getFileSummaryEvidence(runId, events, reviewArtifact);
    const approvals = this.listApprovals(runId);
    const workspacePath =
      record.run.workspacePath ?? record.workspace?.path ?? reviewArtifact?.workspace?.path ?? fileEvidence.gitWorkspacePath ?? null;
    const hookOutputSummary = events
      .filter(
        (event): event is Extract<AgentEvent, { type: "hook.started" | "hook.succeeded" | "hook.failed" | "hook.timed_out" }> =>
          event.type === "hook.started" ||
          event.type === "hook.succeeded" ||
          event.type === "hook.failed" ||
          event.type === "hook.timed_out",
      )
      .map((event) => ({
        hookName: event.hook.hookName,
        status: event.hook.status,
        command: event.hook.command,
        cwd: event.hook.cwd,
        exitCode: event.hook.exitCode,
        stdoutPreview: truncateText(event.hook.stdout, 600),
        stderrPreview: truncateText(event.hook.stderr, 600),
        error: event.hook.error,
      }));
    const providerErrorCount = events.filter(isProviderErrorEvent).length;
    const providerEventCount = events.filter(isProviderEvent).length;
    const missingEvidenceReasons = [
      ...fileEvidence.missingEvidenceReasons,
      ...(workspacePath ? [] : ["Workspace path is unavailable, so file evidence cannot be tied to a local workspace."]),
      ...(events.length > 0 ? [] : ["No persisted run events are available for this run."]),
      ...(reviewArtifact
        ? reviewArtifact.error
          ? [`Review artifact refresh reported: ${reviewArtifact.error}`]
          : []
        : ["Review artifact snapshot is missing; refresh review artifacts before approving future writes."]),
      ...(isTerminalRunStatus(record.run.status)
        ? []
        : ["Run is not terminal yet, so final approval evidence is still incomplete."]),
    ];

    return {
      run: record.run,
      issue: record.issue,
      workspacePath,
      provider: record.run.provider,
      finalRunState: record.run.status,
      changedFiles: fileEvidence.changedFiles,
      fileSummary: fileEvidence.fileSummary,
      fileSummarySource: fileEvidence.fileSummarySource,
      evidenceSummary: {
        eventCount: events.length,
        providerEventCount,
        approvalCount: approvals.length,
        pendingApprovalCount: approvals.filter((approval) => approval.status === "pending").length,
        hookCount: hookOutputSummary.length,
        failedHookCount: hookOutputSummary.filter((hook) => hook.status === "failed" || hook.status === "timed_out").length,
        providerErrorCount,
        lastEventAt: events.at(-1)?.timestamp ?? null,
      },
      hookOutputSummary,
      reviewArtifactStatus: reviewArtifact ? (reviewArtifact.error ? "error" : "ready") : record.run ? "missing" : "unavailable",
      reviewArtifactIdentifier: reviewArtifact ? `review-artifact:${reviewArtifact.runId}` : null,
      reviewArtifactPath: null,
      reviewArtifact,
      writeActionAvailability: this.getWriteActionAvailability(runId),
      missingEvidenceReasons: [...new Set(missingEvidenceReasons)],
      approvals,
    };
  }

  private getWriteActionAvailability(runId: string): WriteActionAvailability[] {
    const record = this.requireRecord(runId);
    const events = this.eventStore.getEventsForRun(runId);
    const reviewArtifact = this.eventStore.getReviewArtifactSnapshot(runId);
    const fileEvidence = this.getFileSummaryEvidence(runId, events, reviewArtifact);
    const writes = this.tryGetWritesStatus();
    const evidenceMissing = [
      ...(reviewArtifact ? [] : ["Review artifact is missing."]),
      ...(fileEvidence.fileSummary ? [] : ["File-change summary is missing."]),
      ...(record.run.workspacePath ? [] : ["Run workspace path is missing."]),
      ...(isTerminalRunStatus(record.run.status) ? [] : ["Run has not reached a terminal state."]),
    ];

    return [
      writeAvailability({
        provider: "github",
        kind: "github_pr_create",
        label: "Create GitHub draft PR",
        policy: writes?.github ?? null,
        evidenceMissing,
      }),
      writeAvailability({
        provider: "linear",
        kind: "linear_comment_create",
        label: "Post Linear run comment",
        policy: writes?.linear ?? null,
        evidenceMissing,
      }),
      writeAvailability({
        provider: "linear",
        kind: "linear_status_update",
        label: "Update Linear issue status",
        policy: writes?.linear ?? null,
        evidenceMissing,
      }),
    ];
  }

  private async getWriteActionPreviews(runId: string): Promise<WriteActionPreviewContract[]> {
    const record = this.requireRecord(runId);
    const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
    const evidence = this.getRunApprovalEvidence(runId);
    const availability = evidence.writeActionAvailability;
    const reviewArtifacts = evidence.reviewArtifact;
    const githubCredential = this.authManager.resolveCredential("github");
    const linearCredential = this.authManager.resolveCredential("linear");
    const githubPreview = await buildGitHubPrPreview({
      run: record.run,
      issue: record.issue,
      workflowConfig: runtime.config,
      reviewArtifacts,
      credential: githubCredential,
      githubClient: null,
    });
    const linearCommentPreview = buildLinearCommentPreview({
      run: record.run,
      issue: record.issue,
      workflowConfig: runtime.config,
      credential: linearCredential,
    });
    const linearStatusPreview = this.buildLinearStatusUpdatePreview(record, runtime, evidence, linearCredential?.source ?? "unavailable");

    return [
      previewContractFromIntegrationPreview({
        preview: githubPreview,
        evidence,
        availability: availability.find((item) => item.kind === "github_pr_create") ?? null,
        generatedBy: "local-daemon",
      }),
      previewContractFromIntegrationPreview({
        preview: linearCommentPreview,
        evidence,
        availability: availability.find((item) => item.kind === "linear_comment_create") ?? null,
        generatedBy: "local-daemon",
      }),
      linearStatusPreviewContract({
        run: record.run,
        issue: record.issue,
        preview: linearStatusPreview,
        credentialSource: linearCredential?.source ?? "unavailable",
        evidence,
        availability: availability.find((item) => item.kind === "linear_status_update") ?? null,
        generatedBy: "local-daemon",
      }),
    ];
  }

  private buildLinearStatusUpdatePreview(
    record: RunRecord,
    runtime: WorkflowRuntime,
    evidence: RunApprovalEvidence,
    credentialSource: IntegrationWritePreview["credentialSource"],
  ) {
    const config = runtime.config.tracker;
    const policy = linearWritePolicy(config);
    const proposedStatus = proposedLinearStatusForRun(config, record.run.status);
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (config.kind !== "linear") blockers.push("Tracker is not Linear.");
    if (config.readOnly) blockers.push("Linear tracker read_only is true.");
    if (!config.write.enabled) blockers.push("Linear writes are disabled.");
    if (!config.write.allowStateTransitions) blockers.push("Linear state transitions are disabled.");
    if (!policy.allowedKinds.includes("linear_status_update")) blockers.push("Linear status updates are not enabled in WORKFLOW.md.");
    if (credentialSource === "unavailable") blockers.push("Linear credentials are unavailable.");
    if (!record.issue.id) blockers.push("Linear issue id is unavailable.");
    if (!proposedStatus) blockers.push("No Linear target status is configured for this run result.");
    if (evidence.missingEvidenceReasons.length > 0) blockers.push(...evidence.missingEvidenceReasons);
    if (record.issue.state && proposedStatus && record.issue.state === proposedStatus) {
      warnings.push(`Linear issue is already in ${proposedStatus}.`);
    }

    return LinearStatusUpdatePreviewSchema.parse({
      runId: record.run.id,
      issueId: record.issue.id,
      issueIdentifier: record.issue.identifier,
      issueUrl: record.issue.url,
      currentStatus: record.issue.state,
      proposedStatus,
      finalRunState: record.run.status,
      blockers: [...new Set(blockers)],
      warnings,
    });
  }

  private getFileSummaryEvidence(
    runId: string,
    events = this.eventStore.getEventsForRun(runId),
    reviewArtifact = this.eventStore.getReviewArtifactSnapshot(runId),
  ): {
    changedFiles: ChangedFile[];
    fileSummary: string | null;
    fileSummarySource: RunApprovalEvidence["fileSummarySource"];
    gitWorkspacePath: string | null;
    missingEvidenceReasons: string[];
  } {
    const approvalEventSummary = events
      .filter((event): event is Extract<AgentEvent, { type: "approval.requested" }> => event.type === "approval.requested")
      .map((event) => event.fileSummary)
      .find((summary): summary is string => Boolean(summary && summary.trim().length > 0));
    const latestDiffEvent = events
      .filter((event): event is Extract<AgentEvent, { type: "git.diff.generated" }> => event.type === "git.diff.generated")
      .at(-1);
    const diff = reviewArtifact?.diff ?? latestDiffEvent?.diff ?? null;
    const gitWorkspacePath = reviewArtifact?.git.workspacePath ?? null;
    const source = approvalEventSummary ? "approval_event" : reviewArtifact ? "review_artifact" : latestDiffEvent ? "diff_event" : "unavailable";

    if (approvalEventSummary) {
      return {
        changedFiles: diff?.files ?? [],
        fileSummary: approvalEventSummary,
        fileSummarySource: "approval_event",
        gitWorkspacePath,
        missingEvidenceReasons: diff ? [] : ["Approval included a file summary, but no changed-file list is available."],
      };
    }

    if (!diff) {
      return {
        changedFiles: [],
        fileSummary: null,
        fileSummarySource: "unavailable",
        gitWorkspacePath,
        missingEvidenceReasons: ["No review artifact diff or git diff event is available for this run."],
      };
    }

    if (diff.filesChanged === 0) {
      return {
        changedFiles: [],
        fileSummary: "No file changes were detected.",
        fileSummarySource: "empty",
        gitWorkspacePath,
        missingEvidenceReasons: [],
      };
    }

    return {
      changedFiles: diff.files,
      fileSummary: formatDiffSummary(diff),
      fileSummarySource: source === "unavailable" ? "diff_event" : source,
      gitWorkspacePath,
      missingEvidenceReasons: [],
    };
  }

  async previewGithubPr(runId: string, input: unknown): Promise<IntegrationWritePreview> {
    const record = this.requireRecord(runId);
    const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
    const body = objectBody(input);
    const credential = await this.resolveGithubCredential();
    const githubClient = this.githubClientForRuntime(runtime, credential?.token ?? null);
    const reviewArtifacts =
      this.eventStore.getReviewArtifactSnapshot(runId) ?? (await this.refreshReviewArtifactsForRecord(record, runtime));
    const preview = await buildGitHubPrPreview({
      run: record.run,
      issue: record.issue,
      workflowConfig: runtime.config,
      reviewArtifacts,
      credential,
      githubClient,
      titleOverride: stringBody(body, "title"),
      bodyOverride: stringBody(body, "body"),
      draftOverride: booleanBody(body, "draft"),
      baseBranchOverride: stringBody(body, "baseBranch"),
    });
    this.eventStore.saveIntegrationWritePreview(preview);
    this.appendWritePreviewEvents(preview);
    return preview;
  }

  async createGithubPr(runId: string, _input: unknown) {
    this.requireRun(runId);
    throw new ApiError(405, "GitHub PR creation is disabled in Milestone 15B; use preview-only write contracts.");
  }

  async previewLinearComment(runId: string, input: unknown): Promise<IntegrationWritePreview> {
    const record = this.requireRecord(runId);
    const runtime = this.workflowRuntime ?? this.loadWorkflowRuntime();
    const body = objectBody(input);
    const credential = this.authManager.resolveCredential("linear");
    const preview = buildLinearCommentPreview({
      run: record.run,
      issue: record.issue,
      workflowConfig: runtime.config,
      credential,
      bodyOverride: stringBody(body, "body"),
    });
    this.eventStore.saveIntegrationWritePreview(preview);
    this.appendWritePreviewEvents(preview);
    return preview;
  }

  async createLinearComment(runId: string, _input: unknown) {
    this.requireRun(runId);
    throw new ApiError(405, "Linear comments are disabled in Milestone 15B; use preview-only write contracts.");
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
    const approvals = new Map<string, ApprovalState>();
    for (const approval of this.listPersistedApprovals(runId)) {
      approvals.set(approval.approvalId, approval);
    }
    for (const approval of this.approvals.values()) {
      if (!runId || approval.runId === runId) {
        approvals.set(approval.approvalId, this.serializeApproval(approval));
      }
    }
    return [...approvals.values()].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  private listPersistedApprovals(runId?: string): ApprovalState[] {
    const runIds = runId ? [runId] : this.eventStore.listRuns().map((run) => run.id);
    const approvals: ApprovalState[] = [];

    for (const id of runIds) {
      const events = this.eventStore.getEventsForRun(id);
      const byId = new Map<string, ApprovalState>();
      for (const event of events) {
        if (event.type === "approval.requested") {
          byId.set(event.approvalId, this.approvalStateFromEvent(event));
          continue;
        }
        if (event.type === "approval.resolved") {
          const existing = byId.get(event.approvalId);
          if (existing) {
            byId.set(event.approvalId, {
              ...existing,
              status: "resolved",
              decision: event.resolution,
              resolvedAt: event.timestamp,
            });
          }
          continue;
        }
        if (event.type === "approval.recovered") {
          const existing = byId.get(event.approvalId);
          if (existing && existing.status === "pending") {
            byId.set(event.approvalId, {
              ...existing,
              status: "resolved",
              decision: "cancel",
              resolvedAt: event.timestamp,
            });
          }
        }
      }
      approvals.push(...byId.values());
    }

    return approvals;
  }

  private approvalStateFromEvent(event: Extract<AgentEvent, { type: "approval.requested" }>): ApprovalState {
    return this.hydrateApprovalFileSummary({
      approvalId: event.approvalId,
      runId: event.runId,
      provider: this.requireRun(event.runId).provider,
      approvalType: event.approvalType ?? "unknown",
      status: "pending",
      prompt: event.prompt,
      threadId: event.threadId ?? null,
      turnId: event.turnId ?? null,
      itemId: event.itemId ?? null,
      reason: event.reason ?? null,
      command: event.command ?? null,
      cwd: event.cwd ?? null,
      fileSummary: event.fileSummary ?? null,
      availableDecisions: event.availableDecisions ?? [],
      decision: null,
      requestedAt: event.timestamp,
      resolvedAt: null,
    });
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
    return this.hydrateApprovalFileSummary({
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
    });
  }

  private hydrateApprovalFileSummary(approval: ApprovalState): ApprovalState {
    if (approval.fileSummary || approval.approvalType !== "file_change") return approval;
    return {
      ...approval,
      fileSummary: this.getFileSummaryEvidence(approval.runId).fileSummary,
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
    const parsed = AgentEventSchema.parse(event);
    this.eventStore.append(parsed);
    this.broadcast(parsed);
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

  private appendWritePreviewEvents(preview: IntegrationWritePreview): void {
    this.appendDaemonEvent({
      id: randomUUID(),
      runId: preview.runId,
      type: "integration.write.previewed",
      timestamp: nowIso(),
      preview,
    });
    if (preview.blockers.length > 0) {
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: preview.runId,
        type: "integration.write.blocked",
        timestamp: nowIso(),
        preview,
      });
      return;
    }
    this.appendDaemonEvent({
      id: randomUUID(),
      runId: preview.runId,
      type: "integration.write.confirmation_required",
      timestamp: nowIso(),
      previewId: preview.id,
      provider: preview.provider,
      kind: preview.kind,
    });
    if (preview.githubPr) {
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: preview.runId,
        type: "github.pr.previewed",
        timestamp: nowIso(),
        preview: preview.githubPr,
      });
    }
    if (preview.linearComment) {
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: preview.runId,
        type: "linear.comment.previewed",
        timestamp: nowIso(),
        preview: preview.linearComment,
      });
    }
  }

  private appendWriteStartedEvent(preview: IntegrationWritePreview): void {
    this.appendDaemonEvent({
      id: randomUUID(),
      runId: preview.runId,
      type: "integration.write.started",
      timestamp: nowIso(),
      previewId: preview.id,
      provider: preview.provider,
      kind: preview.kind,
      target: preview.target,
    });
  }

  private getMatchingIdempotencyResult(
    preview: IntegrationWritePreview,
    request: { idempotencyKey: string | null },
  ): IntegrationWriteResult | null {
    if (!request.idempotencyKey) return null;
    const existing = this.eventStore.findIntegrationWriteResultByIdempotencyKey(request.idempotencyKey);
    if (!existing) return null;

    const existingRunId = stringFromRecord(existing.redactedRequestSummary, "runId");
    if (
      existing.previewId !== preview.id ||
      existing.provider !== preview.provider ||
      existing.kind !== preview.kind ||
      existingRunId !== preview.runId
    ) {
      throw new ApiError(409, "Idempotency key was already used for a different write action.");
    }

    return existing;
  }

  private appendWriteResultEvents(preview: IntegrationWritePreview, result: IntegrationWriteResult): void {
    if (result.status === "succeeded") {
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: preview.runId,
        type: "integration.write.succeeded",
        timestamp: nowIso(),
        result,
      });
      if (result.githubPr) {
        this.appendDaemonEvent({
          id: randomUUID(),
          runId: preview.runId,
          type: "github.pr.created",
          timestamp: nowIso(),
          pr: {
            id: result.githubPr.id,
            number: result.githubPr.number,
            title: result.githubPr.title,
            url: result.githubPr.url,
            state: result.githubPr.state,
            draft: result.githubPr.draft,
            merged: false,
            mergeable: null,
            baseBranch: result.githubPr.baseBranch,
            headBranch: result.githubPr.headBranch,
            headSha: preview.githubPr?.headSha ?? null,
            baseSha: null,
            author: null,
            createdAt: result.githubPr.createdAt,
            updatedAt: result.executedAt,
          },
        });
      }
      if (result.linearComment) {
        this.appendDaemonEvent({
          id: randomUUID(),
          runId: preview.runId,
          type: "linear.comment.created",
          timestamp: nowIso(),
          result: result.linearComment,
        });
      }
      return;
    }
    if (result.status === "cancelled") {
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: preview.runId,
        type: "integration.write.cancelled",
        timestamp: nowIso(),
        previewId: preview.id,
        provider: preview.provider,
        kind: preview.kind,
        reason: result.errors[0] ?? "Integration write was cancelled.",
      });
      return;
    }
    const error = result.errors[0] ?? "Integration write failed.";
    this.appendDaemonEvent({
      id: randomUUID(),
      runId: preview.runId,
      type: "integration.write.failed",
      timestamp: nowIso(),
      previewId: preview.id,
      provider: preview.provider,
      kind: preview.kind,
      error,
    });
    if (preview.kind === "github_pr_create") {
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: preview.runId,
        type: "github.pr.create_failed",
        timestamp: nowIso(),
        previewId: preview.id,
        error,
      });
    }
    if (preview.kind === "linear_comment_create") {
      this.appendDaemonEvent({
        id: randomUUID(),
        runId: preview.runId,
        type: "linear.comment.create_failed",
        timestamp: nowIso(),
        previewId: preview.id,
        error,
      });
    }
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

  private githubClientForRuntime(runtime: WorkflowRuntime, token: string | null) {
    return createGitHubClient(
      {
        ...runtime.config.github,
        token: token ?? runtime.config.github.token,
      },
      this.options.githubFetch,
    );
  }

  private linearClientForRuntime(runtime: WorkflowRuntime, token: string | null) {
    const apiKey = token ?? runtime.config.tracker.apiKey;
    if (!apiKey) return null;
    return createLinearClient(
      {
        ...runtime.config.tracker,
        apiKey,
      },
      this.options.linearFetch,
    );
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

function formatDiffSummary(diff: DiffSummary): string {
  const files = diff.files.slice(0, 5).map((file) => file.path);
  const remaining = Math.max(0, diff.filesChanged - files.length);
  const fileList = files.length > 0 ? `: ${files.join(", ")}${remaining > 0 ? `, and ${remaining} more` : ""}` : "";
  const noun = diff.filesChanged === 1 ? "file" : "files";
  return `${diff.filesChanged} changed ${noun}, +${diff.additions} -${diff.deletions}${fileList}.`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function isProviderEvent(event: AgentEvent): boolean {
  return event.type.startsWith("codex.") || event.type.startsWith("claude.") || event.type.startsWith("cursor.") || event.type === "provider.started" || event.type === "provider.stderr";
}

function isProviderErrorEvent(event: AgentEvent): boolean {
  return event.type.endsWith(".error") || event.type === "provider.stderr";
}

function previewContractFromIntegrationPreview(input: {
  preview: IntegrationWritePreview;
  evidence: RunApprovalEvidence;
  availability: WriteActionAvailability | null;
  generatedBy: string | null;
}): WriteActionPreviewContract {
  const approvalEvidenceId = `approval-evidence:${input.preview.runId}`;
  const reviewArtifactId = input.evidence.reviewArtifactIdentifier;
  const payload = {
    githubPr: input.preview.githubPr,
    linearComment: input.preview.linearComment,
    linearStatusUpdate: null,
  };
  const immutablePayload = {
    kind: input.preview.kind,
    runId: input.preview.runId,
    issueId: input.preview.issueId,
    issueIdentifier: input.preview.issueIdentifier,
    target: input.preview.target,
    title: input.preview.title,
    bodyPreview: input.preview.bodyPreview,
    reviewArtifactId,
    approvalEvidenceId,
    payload,
  };
  const payloadHash = sha256(stableStringify(immutablePayload));
  const availabilityReasons = nonConfirmationReasons(input.availability?.reasons ?? []);
  const blockingReasons = uniqueStrings([...input.preview.blockers, ...availabilityReasons]);
  const riskWarnings = uniqueStrings([
    ...input.preview.warnings,
    "Preview-only in Milestone 15B; no external write endpoint will execute this action.",
  ]);
  const generatedAt = nowIso();
  const targetRepository =
    input.preview.target.owner && input.preview.target.repo ? `${input.preview.target.owner}/${input.preview.target.repo}` : null;
  const contract = WriteActionPreviewContractSchema.parse({
    id: `write-preview-${input.preview.runId}-${input.preview.kind}-${payloadHash.slice(0, 12)}`,
    runId: input.preview.runId,
    issueId: input.preview.issueId,
    issueIdentifier: input.preview.issueIdentifier,
    kind: input.preview.kind,
    targetSystem: input.preview.provider,
    targetLabel: writePreviewTargetLabel(input.preview),
    status: writePreviewStatus(input.availability, blockingReasons, input.evidence),
    title: previewContractTitle(input.preview),
    bodyPreview: input.preview.bodyPreview,
    targetRepository,
    targetBranch: input.preview.target.branch,
    baseBranch: input.preview.target.baseBranch,
    changedFiles: input.evidence.changedFiles,
    reviewArtifactId,
    reviewArtifactPath: input.evidence.reviewArtifactPath,
    approvalEvidenceId,
    approvalEvidenceSource: `approval-evidence:${input.evidence.fileSummarySource}`,
    requiredPermissions: input.preview.requiredPermissions,
    confirmationRequired: input.preview.confirmationRequired,
    confirmationPrompt: confirmationPrompt(input.preview.confirmationRequired, input.preview.confirmationPhrase),
    blockingReasons,
    riskWarnings,
    idempotencyKey: previewIdempotencyKey(input.preview.runId, input.preview.kind, payloadHash),
    payloadHash,
    generatedAt,
    expiresAt: input.preview.expiresAt,
    dryRunOnly: true,
    payload,
    audit: {
      runId: input.preview.runId,
      issueId: input.preview.issueId,
      kind: input.preview.kind,
      targetSystem: input.preview.provider,
      targetIdentifier: writePreviewTargetLabel(input.preview),
      payloadHash,
      approvalEvidenceSource: `approval-evidence:${input.evidence.fileSummarySource}`,
      reviewArtifactSource: reviewArtifactId,
      generatedAt,
      generatedBy: input.generatedBy,
      idempotencyKey: previewIdempotencyKey(input.preview.runId, input.preview.kind, payloadHash),
      status: "previewed",
      externalWriteId: null,
    },
  });

  return contract;
}

function linearStatusPreviewContract(input: {
  run: Run;
  issue: Issue;
  preview: LinearStatusUpdatePreview;
  credentialSource: IntegrationWritePreview["credentialSource"];
  evidence: RunApprovalEvidence;
  availability: WriteActionAvailability | null;
  generatedBy: string | null;
}): WriteActionPreviewContract {
  const approvalEvidenceId = `approval-evidence:${input.run.id}`;
  const reviewArtifactId = input.evidence.reviewArtifactIdentifier;
  const bodyPreview = input.preview.proposedStatus
    ? `Move ${input.issue.identifier} from ${input.preview.currentStatus ?? "unknown"} to ${input.preview.proposedStatus}.`
    : `No Linear target status is configured for ${input.run.status}.`;
  const payload = {
    githubPr: null,
    linearComment: null,
    linearStatusUpdate: input.preview,
  };
  const immutablePayload = {
    kind: "linear_status_update",
    runId: input.run.id,
    issueId: input.issue.id,
    issueIdentifier: input.issue.identifier,
    target: { provider: "linear", issueId: input.issue.id, issueIdentifier: input.issue.identifier, url: input.issue.url },
    bodyPreview,
    reviewArtifactId,
    approvalEvidenceId,
    payload,
  };
  const payloadHash = sha256(stableStringify(immutablePayload));
  const availabilityReasons = nonConfirmationReasons(input.availability?.reasons ?? []);
  const blockingReasons = uniqueStrings([...input.preview.blockers, ...availabilityReasons]);
  const generatedAt = nowIso();
  const contract = WriteActionPreviewContractSchema.parse({
    id: `write-preview-${input.run.id}-linear_status_update-${payloadHash.slice(0, 12)}`,
    runId: input.run.id,
    issueId: input.issue.id,
    issueIdentifier: input.issue.identifier,
    kind: "linear_status_update",
    targetSystem: "linear",
    targetLabel: input.issue.identifier,
    status: writePreviewStatus(input.availability, blockingReasons, input.evidence),
    title: "Linear status update",
    bodyPreview,
    targetRepository: null,
    targetBranch: null,
    baseBranch: null,
    changedFiles: input.evidence.changedFiles,
    reviewArtifactId,
    reviewArtifactPath: input.evidence.reviewArtifactPath,
    approvalEvidenceId,
    approvalEvidenceSource: `approval-evidence:${input.evidence.fileSummarySource}`,
    requiredPermissions: ["Linear issueUpdate"],
    confirmationRequired: true,
    confirmationPrompt: confirmationPrompt(true, confirmationPhraseFromAvailability(input.availability)),
    blockingReasons,
    riskWarnings: uniqueStrings([
      ...input.preview.warnings,
      `Credential source would be ${input.credentialSource}.`,
      "Preview-only in Milestone 15B; no external write endpoint will execute this action.",
    ]),
    idempotencyKey: previewIdempotencyKey(input.run.id, "linear_status_update", payloadHash),
    payloadHash,
    generatedAt,
    expiresAt: null,
    dryRunOnly: true,
    payload,
    audit: {
      runId: input.run.id,
      issueId: input.issue.id,
      kind: "linear_status_update",
      targetSystem: "linear",
      targetIdentifier: input.issue.identifier,
      payloadHash,
      approvalEvidenceSource: `approval-evidence:${input.evidence.fileSummarySource}`,
      reviewArtifactSource: reviewArtifactId,
      generatedAt,
      generatedBy: input.generatedBy,
      idempotencyKey: previewIdempotencyKey(input.run.id, "linear_status_update", payloadHash),
      status: "previewed",
      externalWriteId: null,
    },
  });

  return contract;
}

function writePreviewStatus(
  availability: WriteActionAvailability | null,
  blockingReasons: string[],
  evidence: RunApprovalEvidence,
): WriteActionPreviewContract["status"] {
  if (evidence.missingEvidenceReasons.length > 0) return "evidence_missing";
  if (!availability) return "unavailable";
  if (availability.status === "read_only") return "read_only";
  if (availability.status === "disabled" || availability.status === "blocked") return "blocked";
  if (availability.status === "unavailable") return "unavailable";
  return blockingReasons.length > 0 ? "blocked" : "preview_available";
}

function previewContractTitle(preview: IntegrationWritePreview): string {
  if (preview.githubPr) return preview.githubPr.title;
  if (preview.linearComment) return "Linear run comment";
  return preview.title;
}

function writePreviewTargetLabel(preview: IntegrationWritePreview): string {
  if (preview.provider === "github") {
    const repo = preview.target.owner && preview.target.repo ? `${preview.target.owner}/${preview.target.repo}` : "GitHub repository";
    return preview.target.branch ? `${repo} on ${preview.target.branch}` : repo;
  }
  return preview.target.issueIdentifier ?? preview.issueIdentifier ?? "Linear issue";
}

function confirmationPrompt(required: boolean, phrase: string): string {
  return required
    ? `Future execution would require explicit confirmation: ${phrase}.`
    : "Future execution would require an explicit approval record before external writes are enabled.";
}

function confirmationPhraseFromAvailability(availability: WriteActionAvailability | null): string {
  const phraseReason = availability?.reasons.find((reason) => reason.startsWith("Manual confirmation phrase is required: "));
  return phraseReason?.replace("Manual confirmation phrase is required: ", "").replace(/\.$/, "") ?? "configured confirmation phrase";
}

function nonConfirmationReasons(reasons: string[]): string[] {
  return reasons.filter(
    (reason) =>
      !reason.startsWith("Manual confirmation phrase is required: ") &&
      reason !== "Policy permits this action only after explicit review.",
  );
}

function previewIdempotencyKey(runId: string, kind: IntegrationWriteKind, payloadHash: string): string {
  return `preview:${kind}:${runId}:${payloadHash.slice(0, 24)}`;
}

function proposedLinearStatusForRun(config: WorkflowRuntime["config"]["tracker"], status: Run["status"]): string | null {
  if (!config.write.allowStateTransitions) return null;
  if (status === "succeeded") return config.write.moveToStateOnSuccess;
  if (status === "failed" || status === "timed_out" || status === "cancelled" || status === "interrupted" || status === "orphaned") {
    return config.write.moveToStateOnFailure;
  }
  return config.write.moveToStateOnStart;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function writeAvailability(input: {
  provider: WriteActionAvailability["provider"];
  kind: IntegrationWriteKind;
  label: string;
  policy: IntegrationWritePolicy | null;
  evidenceMissing: string[];
}): WriteActionAvailability {
  const evidenceRequired = ["terminal run", "workspace path", "review artifact", "file-change summary"];
  const reasons: string[] = [];
  let status: WriteActionAvailability["status"] = "gated";

  if (!input.policy) {
    return {
      provider: input.provider,
      kind: input.kind,
      label: input.label,
      status: "unavailable",
      reasons: ["Write policy could not be loaded."],
      evidenceRequired,
    };
  }

  if (input.policy.readOnly) {
    status = "read_only";
    reasons.push(`${providerLabel(input.provider)} read_only is true.`);
  }
  if (!input.policy.enabled) {
    status = status === "read_only" ? status : "disabled";
    reasons.push(`${providerLabel(input.provider)} writes are disabled.`);
  }
  if (!input.policy.allowedKinds.includes(input.kind)) {
    status = status === "read_only" || status === "disabled" ? status : "gated";
    reasons.push(`${input.label} is not enabled in WORKFLOW.md.`);
  }
  if (input.evidenceMissing.length > 0) {
    status = status === "read_only" || status === "disabled" ? status : "unavailable";
    reasons.push(...input.evidenceMissing);
  }
  if (reasons.length === 0 && input.policy.requireConfirmation) {
    status = "gated";
    reasons.push(`Manual confirmation phrase is required: ${input.policy.confirmationPhrase}.`);
  }
  if (reasons.length === 0) {
    status = input.policy.allowAutomatic ? "enabled" : "gated";
    reasons.push("Policy permits this action only after explicit review.");
  }

  return {
    provider: input.provider,
    kind: input.kind,
    label: input.label,
    status,
    reasons: [...new Set(reasons)],
    evidenceRequired,
  };
}

function providerLabel(provider: WriteActionAvailability["provider"]): string {
  return provider === "github" ? "GitHub" : "Linear";
}

type ConnectedReadinessStatus = ConnectedGoldenPathStatus["linear"]["status"];
type ConnectedActionInput = {
  repositoryStatus: ConnectedReadinessStatus;
  workspaceStatus: ConnectedReadinessStatus;
  linearStatus: ConnectedReadinessStatus;
  githubStatus: ConnectedReadinessStatus;
  providerStatus: ConnectedReadinessStatus;
  boardReady: boolean;
  issueCount: number;
  activeRun: Run | null;
  latestRun: Run | null;
  reviewArtifactReady: boolean;
};

function connectedLinearStatus(
  workflowStatus: WorkflowStatus["status"],
  trackerStatus: TrackerStatus["status"],
  issueCount: number,
  hasCredential: boolean,
): ConnectedReadinessStatus {
  if (workflowStatus !== "healthy") return "invalid_config";
  if (!hasCredential) return "missing_auth";
  if (trackerStatus === "invalid_config") return "invalid_config";
  if (trackerStatus === "unavailable") return "unavailable";
  if (trackerStatus === "stale") return issueCount > 0 ? "stale" : "unavailable";
  if (issueCount > 0) return "ready";
  if (trackerStatus === "healthy" || trackerStatus === "unknown") return "ready";
  return "unknown";
}

function connectedGithubStatus(
  github: GitHubStatus,
  hasCredential: boolean,
): ConnectedReadinessStatus {
  if (!github.enabled) return "disabled";
  if (github.status === "invalid_config") return "invalid_config";
  if (!hasCredential) return "missing_auth";
  if (github.status === "healthy") return "ready";
  if (github.status === "stale") return "stale";
  if (github.status === "unavailable") return "unavailable";
  return "unknown";
}

function connectedOnboardingState(input: ConnectedActionInput): ConnectedGoldenPathStatus["onboardingState"] {
  if (input.repositoryStatus !== "ready") return "needs_repo";
  if (input.workspaceStatus !== "ready") return "needs_repo";
  if (input.linearStatus !== "ready") return "needs_linear";
  if (input.githubStatus !== "ready") return "needs_github";
  if (input.providerStatus !== "ready") return "needs_provider";
  if (input.issueCount === 0 || !input.boardReady) return "needs_issue_scope";

  if (input.activeRun) {
    if (input.activeRun.status === "preparing_workspace") return "workspace_preparing";
    if (input.activeRun.status === "building_prompt") return "workspace_ready";
    if (input.activeRun.status === "queued" || input.activeRun.status === "launching_agent") return "run_starting";
    if (input.activeRun.status === "running" || input.activeRun.status === "streaming") return "evidence_streaming";
    return "run_active";
  }

  if (input.latestRun && isTerminalRunStatus(input.latestRun.status)) {
    if (input.latestRun.status === "failed" || input.latestRun.status === "timed_out" || input.latestRun.status === "stalled") {
      return "failed";
    }
    if (input.reviewArtifactReady) return input.latestRun.status === "succeeded" ? "completed" : "review_ready";
    return "review_ready";
  }

  return "board_ready";
}

function connectedNextAction(input: ConnectedActionInput): ConnectedGoldenPathStatus["nextAction"] {
  if (input.repositoryStatus === "missing") {
    return { kind: "choose_repo", label: "Choose local repository", href: "/settings" };
  }
  if (input.repositoryStatus !== "ready" || input.workspaceStatus !== "ready") {
    return { kind: "configure_workflow", label: "Fix WORKFLOW.md", href: "/settings" };
  }
  if (input.linearStatus !== "ready") {
    return { kind: "connect_linear", label: "Connect Linear", href: "/settings" };
  }
  if (input.githubStatus !== "ready") {
    return { kind: "validate_github", label: "Validate GitHub", href: "/settings" };
  }
  if (input.providerStatus !== "ready") {
    return { kind: "check_provider", label: "Check Codex", href: "/settings" };
  }
  if (input.issueCount === 0 || !input.boardReady) {
    return { kind: "refresh_issues", label: "Refresh real issues", href: null };
  }
  if (input.activeRun) {
    return { kind: "watch_run", label: "Watch run evidence", href: null };
  }
  if (input.latestRun && isTerminalRunStatus(input.latestRun.status)) {
    if (input.latestRun.status === "succeeded" && input.reviewArtifactReady) {
      return { kind: "review_artifact", label: "Review artifact ready", href: null };
    }
    if (input.latestRun.status === "failed") {
      return { kind: "needs_attention", label: "Inspect failed run", href: null };
    }
  }
  return { kind: "open_board", label: "Open issue board", href: "/issues" };
}

function linearBlocker(status: ConnectedReadinessStatus, error: string | null): string {
  if (status === "missing_auth") {
    return error
      ? `Linear is not connected: ${error}`
      : "Linear is not connected. Set LINEAR_API_KEY or connect Linear in Settings.";
  }
  if (status === "invalid_config") return error ?? "Linear workflow configuration is invalid.";
  if (status === "unavailable") return error ?? "Linear is unavailable.";
  if (status === "stale") return error ?? "Linear issue cache is stale.";
  if (status === "unknown") return "Linear has not been validated or refreshed.";
  return "Linear is not ready.";
}

function githubBlocker(status: ConnectedReadinessStatus, error: string | null): string {
  if (status === "disabled") return "GitHub repository validation is disabled in WORKFLOW.md; enable read-only GitHub validation to prove repository access.";
  if (status === "missing_auth") return "GitHub credentials are unavailable. Set GITHUB_TOKEN/GITHUB_PAT or connect GitHub in Settings.";
  if (status === "invalid_config") return error ?? "GitHub workflow configuration is invalid.";
  if (status === "unavailable") return error ?? "GitHub repository is unavailable.";
  if (status === "stale") return error ?? "GitHub repository validation is stale.";
  if (status === "unknown") return "GitHub has not been validated.";
  return "GitHub is not ready.";
}

function writePosture(policy: IntegrationWritePolicy | null): ConnectedGoldenPathStatus["writes"]["github"] {
  if (!policy) return "disabled";
  if (policy.readOnly) return "read_only";
  if (!policy.enabled) return "disabled";
  if (policy.requireConfirmation) return "gated";
  return "enabled";
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

function stringFromRecord(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" ? value : null;
}

function stringBody(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function booleanBody(input: Record<string, unknown>, key: string): boolean | null {
  const value = input[key];
  return typeof value === "boolean" ? value : null;
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
