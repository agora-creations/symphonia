import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PRIORITY_LABELS, type Priority, type User } from "@/lib/view-models";
import { userFromIssue } from "@/lib/workspace-insights";
import { IssueStatusIcon } from "@/components/icons/issue-status-icons";
import { PriorityIcon } from "@/components/icons/status-icons";
import { UserAvatar } from "@/components/avatar-stack";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileDiff,
  Filter,
  GitBranch,
  GitPullRequest,
  LayoutGrid,
  List,
  Play,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  createGithubDraftPr,
  getConnectedStatus,
  executeWorkspaceCleanup,
  getDaemonStatus,
  getGithubPrPreflight,
  getGithubStatus,
  getIssues,
  getProviders,
  getReviewArtifacts,
  getRunApprovalEvidence,
  getRunApprovals,
  getRunEventStreamUrl,
  getRunEvents,
  getRunPrompt,
  getRunWriteActions,
  getRuns,
  getTrackerStatus,
  getWorkspace,
  getWorkspaceCleanupPlan,
  getWorkspaceInventory,
  getWritesStatus,
  getWorkflowStatus,
  refreshReviewArtifacts,
  refreshIssues,
  refreshWorkspaceInventory,
  reloadWorkflow,
  respondApproval,
  retryRun,
  startRun,
  stopRun,
} from "@/lib/api";
import {
  ApprovalDecision,
  ApprovalState,
  AgentEventSchema,
  type ConnectedGoldenPathStatus,
  type DaemonStatus,
  isTerminalRunStatus,
  type AgentEvent,
  type Issue as DaemonIssue,
  type IssuePriority,
  type IssueState,
  type GitHubStatus,
  type GitHubPrExecutionResponse,
  type GitHubPrPreflightResult,
  type IntegrationWriteActionsResponse,
  type IntegrationWritePolicy,
  type IntegrationWritePreview,
  type IntegrationWriteResult,
  type LocalWriteExecutionRecord,
  type ProviderHealth,
  type ProviderId,
  type ReviewArtifactSnapshot,
  type Run,
  type RunApprovalEvidence,
  type RunStatus,
  type TrackerStatus,
  type WorkflowStatus,
  type WritesStatus,
  type WorkspaceInfo,
  type WorkspaceCleanupPlan,
  type WorkspaceCleanupResult,
  type WorkspaceInventory,
  type WriteActionPreviewContract,
} from "@symphonia/types";

type Issue = {
  id: string;
  key: string;
  title: string;
  description: string;
  status: IssueState;
  iconStatus: "backlog" | "todo" | "in-progress" | "in-review" | "done" | "cancelled";
  priority: Priority;
  sourcePriority: IssuePriority;
  assignee?: User;
  labels: Array<{ id: string; name: string; color: string }>;
  team: string;
  url: string;
  trackerKind: string;
  projectName: string | null;
  lastFetchedAt: string | null;
  latestRun?: Run;
};

function IssueCard({
  canRun,
  issue,
  onRun,
  selected,
  onSelect,
}: {
  canRun: boolean;
  issue: Issue;
  onRun: (issue: Issue) => void;
  selected: boolean;
  onSelect: (issue: Issue) => void;
}) {
  const runDisabled = !canRun || (issue.latestRun ? !isTerminalRunStatus(issue.latestRun.status) : false);

  return (
    <article
      className={cn(
        "w-full rounded-md border bg-card p-2.5 text-left text-card-foreground shadow-sm transition-colors cursor-pointer",
        selected ? "border-foreground/40" : "hover:border-foreground/20",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(issue)}
        aria-label={`Open run details for ${issue.key}: ${issue.title}`}
        aria-pressed={selected}
        className="block w-full text-left"
      >
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
          <PriorityIcon priority={issue.priority} />
          <span>{issue.key}</span>
          <span className="rounded-full border px-1.5 py-0.5 text-[10px]">{issue.trackerKind}</span>
          {issue.latestRun && <span className="rounded-full border px-1.5 py-0.5 text-[10px]">{issue.latestRun.provider}</span>}
          {issue.latestRun && <RunStatusBadge status={issue.latestRun.status} />}
        </div>
        <p className="mt-1.5 text-sm leading-snug line-clamp-2">{issue.title}</p>
        {issue.labels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {issue.labels.map((l) => (
              <span
                key={l.id}
                className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                <span className={cn("h-1.5 w-1.5 rounded-full bg-current", l.color)} />
                {l.name}
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">{issue.projectName ? `${issue.team} / ${issue.projectName}` : issue.team}</span>
          {issue.assignee && <UserAvatar user={issue.assignee} size={18} />}
        </div>
      </button>
      <div className="mt-2 flex items-center justify-between gap-2">
        {issue.trackerKind === "linear" ? (
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
            aria-label={`Open ${issue.key} in Linear`}
          >
            Linear <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => onRun(issue)}
          disabled={runDisabled}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="h-3 w-3" />
          Run with Codex
        </button>
      </div>
    </article>
  );
}

function IssueRow({
  canRun,
  issue,
  onRun,
  selected,
  onSelect,
}: {
  canRun: boolean;
  issue: Issue;
  onRun: (issue: Issue) => void;
  selected: boolean;
  onSelect: (issue: Issue) => void;
}) {
  const runDisabled = !canRun || (issue.latestRun ? !isTerminalRunStatus(issue.latestRun.status) : false);

  return (
    <div
      className={cn(
        "grid w-full grid-cols-[1.5rem_4.5rem_1fr_auto_auto] items-center gap-3 border-b px-4 py-2 text-left last:border-b-0 hover:bg-muted/40",
        selected && "bg-muted/50",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(issue)}
        aria-label={`Open run details for ${issue.key}: ${issue.title}`}
        aria-pressed={selected}
        className="contents cursor-pointer"
      >
        <IssueStatusIcon status={issue.iconStatus} />
        <span className="text-[11px] tabular-nums text-muted-foreground">{issue.key}</span>
        <div className="min-w-0 flex items-center gap-2">
          <PriorityIcon priority={issue.priority} />
          <span className="truncate text-sm">{issue.title}</span>
        </div>
      </button>
      <div className="flex items-center gap-2">
        {issue.labels.slice(0, 2).map((l) => (
          <span
            key={l.id}
            className="hidden md:inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            <span className={cn("h-1.5 w-1.5 rounded-full bg-current", l.color)} />
            {l.name}
          </span>
        ))}
        {issue.latestRun && <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">{issue.latestRun.provider}</span>}
        {issue.latestRun && <RunStatusBadge status={issue.latestRun.status} />}
        {issue.assignee && <UserAvatar user={issue.assignee} size={20} />}
      </div>
      <button
        type="button"
        onClick={() => onRun(issue)}
        disabled={runDisabled}
        className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Play className="h-3 w-3" />
        Run with Codex
      </button>
    </div>
  );
}

const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low", "no-priority"];
const labelColorPalette = ["text-sky-500", "text-emerald-500", "text-amber-500", "text-violet-500", "text-rose-500"];

export function IssuesView() {
  const [view, setView] = useState<"board" | "list">("board");
  const [team, setTeam] = useState<string>("all");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [allIssues, setAllIssues] = useState<Issue[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<AgentEvent[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceInfo | null>(null);
  const [selectedReviewArtifacts, setSelectedReviewArtifacts] = useState<ReviewArtifactSnapshot | null>(null);
  const [selectedApprovalEvidence, setSelectedApprovalEvidence] = useState<RunApprovalEvidence | null>(null);
  const [selectedApprovals, setSelectedApprovals] = useState<ApprovalState[]>([]);
  const [connectedStatus, setConnectedStatus] = useState<ConnectedGoldenPathStatus | null>(null);
  const [connectedError, setConnectedError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("codex");
  const [workflow, setWorkflow] = useState<WorkflowStatus | null>(null);
  const [trackerStatus, setTrackerStatus] = useState<TrackerStatus | null>(null);
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus | null>(null);
  const [workspaceInventory, setWorkspaceInventory] = useState<WorkspaceInventory | null>(null);
  const [cleanupPlan, setCleanupPlan] = useState<WorkspaceCleanupPlan | null>(null);
  const [cleanupResult, setCleanupResult] = useState<WorkspaceCleanupResult | null>(null);
  const [cleanupConfirm, setCleanupConfirm] = useState("");
  const [refreshingIssues, setRefreshingIssues] = useState(false);
  const [refreshingReviewArtifacts, setRefreshingReviewArtifacts] = useState(false);
  const [refreshingWorkspaces, setRefreshingWorkspaces] = useState(false);
  const [executingCleanup, setExecutingCleanup] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const sourcesRef = useRef<Map<string, EventSource>>(new Map());
  const selectedRunIdRef = useRef<string | null>(null);

  const selectedIssue = useMemo(
    () => allIssues.find((issue) => issue.id === selectedIssueId) ?? null,
    [allIssues, selectedIssueId],
  );
  const selectedIssueKey = selectedIssue?.key ?? null;

  const selectedRun = selectedIssue?.latestRun ?? null;

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  const updateIssueRun = useCallback((run: Run) => {
    setAllIssues((current) =>
      current.map((issue) => (issue.id === run.issueId ? { ...issue, latestRun: run } : issue)),
    );
  }, []);

  const appendEvent = useCallback((event: AgentEvent) => {
    if (event.runId === selectedRunIdRef.current) {
      setSelectedEvents((current) => {
        if (current.some((item) => item.id === event.id)) return current;
        return [...current, event];
      });

      if (event.type === "prompt.rendered") {
        setSelectedPrompt(event.prompt);
      }

      if (event.type === "workspace.ready") {
        setSelectedWorkspace(event.workspace);
      }

      if (event.type === "github.review_artifacts.refreshed") {
        setSelectedReviewArtifacts(event.snapshot);
        void getRunApprovalEvidence(event.runId)
          .then((evidence) => {
            setSelectedApprovalEvidence(evidence);
            setSelectedApprovals(evidence.approvals);
          })
          .catch(() => null);
      }

      if (event.type === "approval.requested") {
        setSelectedApprovals((current) => [
          ...current.filter((approval) => approval.approvalId !== event.approvalId),
          approvalStateFromEvent(event),
        ]);
      }

      if (event.type === "approval.resolved") {
        setSelectedApprovals((current) =>
          current.map((approval) =>
            approval.approvalId === event.approvalId
              ? {
                  ...approval,
                  status: "resolved",
                  decision: event.resolution,
                  resolvedAt: event.timestamp,
                }
              : approval,
          ),
        );
      }

      if (event.type === "run.status" && isTerminalRunStatus(event.status)) {
        void getRunApprovalEvidence(event.runId)
          .then((evidence) => {
            setSelectedApprovalEvidence(evidence);
            setSelectedApprovals(evidence.approvals);
            setSelectedReviewArtifacts(evidence.reviewArtifact);
          })
          .catch(() => null);
      }
    }

    if (event.type === "run.status") {
      setAllIssues((current) =>
        current.map((issue) =>
          issue.latestRun?.id === event.runId
            ? {
                ...issue,
                latestRun: {
                  ...issue.latestRun,
                  status: event.status,
                  endedAt: isTerminalRunStatus(event.status) ? event.timestamp : issue.latestRun.endedAt,
                  error: event.error ?? (event.status === "failed" ? issue.latestRun.error : null),
                },
              }
            : issue,
        ),
      );
    }
  }, []);

  const subscribeRun = useCallback(
    (runId: string) => {
      if (sourcesRef.current.has(runId)) return;

      void getRunEventStreamUrl(runId)
        .then((url) => {
          if (sourcesRef.current.has(runId)) return;
          const source = new EventSource(url);
          source.addEventListener("agent-event", (message) => {
            const event = AgentEventSchema.parse(JSON.parse((message as MessageEvent).data));
            appendEvent(event);
            if (event.type === "run.status" && isTerminalRunStatus(event.status)) {
              source.close();
              sourcesRef.current.delete(runId);
            }
          });
          source.onerror = () => {
            source.close();
            sourcesRef.current.delete(runId);
            if (runId === selectedRunIdRef.current) {
              setDetailError("Event stream disconnected. Persisted events remain visible; reopen or refresh the run to reconnect.");
            }
          };
          sourcesRef.current.set(runId, source);
        })
        .catch(() => {
          sourcesRef.current.delete(runId);
        });
    },
    [appendEvent],
  );

  useEffect(() => {
    let alive = true;
    const sources = sourcesRef.current;

    async function loadIssues() {
      const [
        loadedConnected,
        loadedIssues,
        loadedRuns,
        loadedProviders,
        loadedWorkflow,
        loadedGithubStatus,
        loadedDaemonStatus,
        loadedWorkspaceInventory,
        loadedTrackerStatus,
      ] = await Promise.allSettled([
        getConnectedStatus(),
        getIssues(),
        getRuns(),
        getProviders(),
        getWorkflowStatus(),
        getGithubStatus().catch(() => null),
        getDaemonStatus().catch(() => null),
        getWorkspaceInventory().catch(() => null),
        getTrackerStatus(),
      ]);
      if (!alive) return;

      if (loadedConnected.status === "fulfilled") {
        setConnectedStatus(loadedConnected.value);
        setConnectedError(null);
      } else {
        setConnectedStatus(null);
        setConnectedError(errorMessage(loadedConnected.reason, "Connected status is unavailable."));
      }

      if (loadedIssues.status === "fulfilled" && loadedRuns.status === "fulfilled") {
        setAllIssues(mapDaemonIssues(loadedIssues.value, loadedRuns.value));
        setBoardError(null);
      } else {
        setBoardError(errorMessage(loadedIssues.status === "rejected" ? loadedIssues.reason : loadedRuns.status === "rejected" ? loadedRuns.reason : null, "Failed to load issues."));
      }

      if (loadedProviders.status === "fulfilled") setProviders(loadedProviders.value);
      if (loadedWorkflow.status === "fulfilled") setWorkflow(loadedWorkflow.value);
      if (loadedTrackerStatus.status === "fulfilled") setTrackerStatus(loadedTrackerStatus.value);
      if (loadedGithubStatus.status === "fulfilled") setGithubStatus(loadedGithubStatus.value);
      if (loadedDaemonStatus.status === "fulfilled") setDaemonStatus(loadedDaemonStatus.value);
      if (loadedWorkspaceInventory.status === "fulfilled") setWorkspaceInventory(loadedWorkspaceInventory.value);

      const defaultProvider = loadedWorkflow.status === "fulfilled" ? loadedWorkflow.value.effectiveConfigSummary?.defaultProvider : null;
      if (defaultProvider === "codex" || defaultProvider === "claude" || defaultProvider === "cursor") {
        setSelectedProvider((current) => current || defaultProvider);
      }
    }

    void loadIssues();
    const interval = setInterval(() => {
      void loadIssues();
    }, 5000);

    return () => {
      alive = false;
      clearInterval(interval);
      for (const source of sources.values()) source.close();
      sources.clear();
    };
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedEvents([]);
      setSelectedPrompt(null);
      setSelectedWorkspace(null);
      setSelectedReviewArtifacts(null);
      setSelectedApprovalEvidence(null);
      setSelectedApprovals([]);
      return;
    }

    setDetailError(null);
    void Promise.all([
      getRunEvents(selectedRunId),
      getRunPrompt(selectedRunId),
      selectedIssueKey ? getWorkspace(selectedIssueKey) : Promise.resolve(null),
      getRunApprovals(selectedRunId),
      getReviewArtifacts(selectedRunId),
      getRunApprovalEvidence(selectedRunId),
    ])
      .then(([events, prompt, workspace, approvals, reviewArtifacts, approvalEvidence]) => {
        setSelectedEvents(events);
        setSelectedPrompt(prompt);
        setSelectedWorkspace(workspace);
        setSelectedApprovals(approvalEvidence.approvals.length > 0 ? approvalEvidence.approvals : approvals);
        setSelectedReviewArtifacts(reviewArtifacts);
        setSelectedApprovalEvidence(approvalEvidence);
      })
      .catch((caught) => {
        setDetailError(caught instanceof Error ? caught.message : "Failed to load run events.");
      });
    subscribeRun(selectedRunId);
  }, [selectedIssueKey, selectedRunId, subscribeRun]);

  const selectIssue = useCallback((issue: Issue) => {
    setSelectedIssueId(issue.id);
    setSelectedRunId(issue.latestRun?.id ?? null);
    setSelectedEvents([]);
    setSelectedPrompt(null);
    setSelectedWorkspace(null);
    setSelectedReviewArtifacts(null);
    setSelectedApprovalEvidence(null);
    setSelectedApprovals([]);
    setDetailError(null);
  }, []);

  const closeDetails = useCallback(() => {
    setSelectedIssueId(null);
    setSelectedRunId(null);
    setSelectedEvents([]);
    setSelectedPrompt(null);
    setSelectedWorkspace(null);
    setSelectedReviewArtifacts(null);
    setSelectedApprovalEvidence(null);
    setSelectedApprovals([]);
    setDetailError(null);
  }, []);

  const handleStart = useCallback(
    async (issue: Issue) => {
      try {
        setDetailError(null);
        const status = await getConnectedStatus();
        setConnectedStatus(status);
        setConnectedError(null);
        if (!canRunWithCodex(issue, status)) {
          throw new Error(status.blockingReasons[0] ?? "Connected prerequisites are not ready.");
        }
        const run = await startRun(issue.id, "codex");
        updateIssueRun(run);
        setSelectedIssueId(issue.id);
        setSelectedRunId(run.id);
        setSelectedEvents([]);
        setSelectedPrompt(null);
        setSelectedWorkspace(null);
        setSelectedReviewArtifacts(null);
        setSelectedApprovalEvidence(null);
        setSelectedApprovals([]);
        subscribeRun(run.id);
      } catch (caught) {
        setDetailError(caught instanceof Error ? caught.message : "Failed to start run.");
      }
    },
    [subscribeRun, updateIssueRun],
  );

  const handleStop = useCallback(
    async (run: Run) => {
      try {
        setDetailError(null);
        updateIssueRun(await stopRun(run.id));
      } catch (caught) {
        setDetailError(caught instanceof Error ? caught.message : "Failed to stop run.");
      }
    },
    [updateIssueRun],
  );

  const handleRetry = useCallback(
    async (run: Run) => {
      try {
        setDetailError(null);
        const nextRun = await retryRun(run.id);
        updateIssueRun(nextRun);
        setSelectedRunId(nextRun.id);
        setSelectedEvents([]);
        setSelectedPrompt(null);
        setSelectedWorkspace(null);
        setSelectedReviewArtifacts(null);
        setSelectedApprovalEvidence(null);
        setSelectedApprovals([]);
        subscribeRun(nextRun.id);
      } catch (caught) {
        setDetailError(caught instanceof Error ? caught.message : "Failed to retry run.");
      }
    },
    [subscribeRun, updateIssueRun],
  );

  const handleWorkflowReload = useCallback(async () => {
    try {
      setDetailError(null);
      setWorkflow(await reloadWorkflow());
      setProviders(await getProviders());
      setTrackerStatus(await getTrackerStatus());
      setGithubStatus(await getGithubStatus().catch(() => null));
      setConnectedStatus(await getConnectedStatus().catch(() => connectedStatus));
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Failed to reload workflow.");
    }
  }, [connectedStatus]);

  const handleRefreshIssues = useCallback(async () => {
    try {
      setRefreshingIssues(true);
      setDetailError(null);
      const [loadedIssues, loadedRuns] = await Promise.all([refreshIssues(), getRuns()]);
      setAllIssues(mapDaemonIssues(loadedIssues, loadedRuns));
      setTrackerStatus(await getTrackerStatus());
      setGithubStatus(await getGithubStatus().catch(() => null));
      setConnectedStatus(await getConnectedStatus().catch(() => connectedStatus));
      setBoardError(null);
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Failed to refresh issues.");
      setBoardError(caught instanceof Error ? caught.message : "Failed to refresh issues.");
      setTrackerStatus(await getTrackerStatus().catch(() => null));
    } finally {
      setRefreshingIssues(false);
    }
  }, [connectedStatus]);

  const handleRefreshReviewArtifacts = useCallback(async (run: Run) => {
    try {
      setRefreshingReviewArtifacts(true);
      setDetailError(null);
      setSelectedReviewArtifacts(await refreshReviewArtifacts(run.id));
      setSelectedApprovalEvidence(await getRunApprovalEvidence(run.id));
      setGithubStatus(await getGithubStatus().catch(() => null));
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Failed to refresh review artifacts.");
    } finally {
      setRefreshingReviewArtifacts(false);
    }
  }, []);

  const handleRefreshWorkspaces = useCallback(async () => {
    try {
      setRefreshingWorkspaces(true);
      setDetailError(null);
      const inventory = await refreshWorkspaceInventory();
      setWorkspaceInventory(inventory);
      setCleanupPlan(await getWorkspaceCleanupPlan());
      setDaemonStatus(await getDaemonStatus().catch(() => null));
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Failed to refresh workspaces.");
    } finally {
      setRefreshingWorkspaces(false);
    }
  }, []);

  const handlePlanCleanup = useCallback(async () => {
    try {
      setRefreshingWorkspaces(true);
      setDetailError(null);
      setWorkspaceInventory(await getWorkspaceInventory());
      setCleanupPlan(await getWorkspaceCleanupPlan());
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Failed to plan workspace cleanup.");
    } finally {
      setRefreshingWorkspaces(false);
    }
  }, []);

  const handleExecuteCleanup = useCallback(async () => {
    if (!cleanupPlan) return;
    try {
      setExecutingCleanup(true);
      setDetailError(null);
      const result = await executeWorkspaceCleanup({
        planId: cleanupPlan.id,
        confirm: cleanupConfirm,
      });
      setCleanupResult(result);
      setWorkspaceInventory(await refreshWorkspaceInventory());
      setCleanupPlan(await getWorkspaceCleanupPlan());
      setCleanupConfirm("");
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Failed to execute workspace cleanup.");
    } finally {
      setExecutingCleanup(false);
    }
  }, [cleanupConfirm, cleanupPlan]);

  const handleApprovalResponse = useCallback(async (approval: ApprovalState, decision: ApprovalDecision) => {
    try {
      setDetailError(null);
      const updated = await respondApproval(approval.approvalId, decision);
      setSelectedApprovals((current) =>
        current.map((item) => (item.approvalId === updated.approvalId ? updated : item)),
      );
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Failed to respond to approval.");
    }
  }, []);

  const filtered = useMemo(
    () =>
      allIssues.filter(
        (i) =>
          (team === "all" || i.team === team) && (priority === "all" || i.priority === priority),
      ),
    [allIssues, team, priority],
  );

  const statusColumns = useMemo(() => {
    const preferred = [
      ...(workflow?.effectiveConfigSummary?.activeStates ?? ["Todo", "In Progress", "Human Review", "Rework"]),
      ...Array.from(new Set(allIssues.map((issue) => issue.status))),
      ...(workflow?.effectiveConfigSummary?.terminalStates ?? ["Done"]),
    ];
    return Array.from(new Set(preferred.filter(Boolean)));
  }, [allIssues, workflow?.effectiveConfigSummary?.activeStates, workflow?.effectiveConfigSummary?.terminalStates]);

  const grouped = useMemo(() => {
    const m = {} as Record<IssueState, Issue[]>;
    for (const s of statusColumns) m[s] = [];
    for (const i of filtered) {
      m[i.status] = m[i.status] ?? [];
      m[i.status].push(i);
    }
    return m;
  }, [filtered, statusColumns]);

  const teamOptions = useMemo(() => ["all", ...Array.from(new Set(allIssues.map((i) => i.team))).sort()], [allIssues]);
  const canRunIssueWithCodex = useCallback(
    (issue: Issue) => canRunWithCodex(issue, connectedStatus),
    [connectedStatus],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Connected issue board</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {connectedStatus?.board.issueScope ?? trackerScopeSummary(workflow?.effectiveConfigSummary)} ·{" "}
            {connectedStatus?.board.issueCount ?? allIssues.length} real issues
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWorkflowOpen((open) => !open)}
            className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] hover:bg-muted"
          >
            Workflow
          </button>
          <button
            type="button"
            onClick={() => void handleRefreshIssues()}
            disabled={refreshingIssues}
            className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshingIssues && "animate-spin")} />
            Refresh issues
          </button>
          <div className="flex items-center rounded-md border p-0.5">
            <button
              onClick={() => setView("board")}
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px]",
                view === "board" ? "bg-muted text-foreground" : "text-muted-foreground",
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Board
            </button>
            <button
              onClick={() => setView("list")}
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px]",
                view === "list" ? "bg-muted text-foreground" : "text-muted-foreground",
              )}
            >
              <List className="h-3.5 w-3.5" /> List
            </button>
          </div>
          <select
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-[12px]"
          >
            {teamOptions.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "All teams" : t}
              </option>
            ))}
          </select>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority | "all")}
            className="rounded-md border bg-background px-2 py-1 text-[12px]"
          >
            <option value="all">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
          <button className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] hover:bg-muted">
            <Filter className="h-3.5 w-3.5" /> Filter
          </button>
          <button className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] hover:bg-muted">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Display
          </button>
          <button
            type="button"
            disabled
            title="Issue creation is deferred; refresh Linear to import real issues."
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 text-[12px] text-primary-foreground opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> New issue
          </button>
        </div>
      </header>

      {(connectedError || !connectedStatus || connectedStatus.board.status !== "ready") && (
        <ConnectedGateway
          error={connectedError}
          onRefreshIssues={handleRefreshIssues}
          refreshingIssues={refreshingIssues}
          status={connectedStatus}
        />
      )}

      {boardError && (
        <p role="alert" className="m-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
          {boardError}
        </p>
      )}

      {workflowOpen && (
        <WorkflowPanel
          cleanupConfirm={cleanupConfirm}
          cleanupPlan={cleanupPlan}
          cleanupResult={cleanupResult}
          daemonStatus={daemonStatus}
          executingCleanup={executingCleanup}
          githubStatus={githubStatus}
          onCleanupConfirmChange={setCleanupConfirm}
          onExecuteCleanup={handleExecuteCleanup}
          onPlanCleanup={handlePlanCleanup}
          onRefreshWorkspaces={handleRefreshWorkspaces}
          onReload={handleWorkflowReload}
          providers={providers}
          refreshingWorkspaces={refreshingWorkspaces}
          trackerStatus={trackerStatus}
          workflow={workflow}
          workspaceInventory={workspaceInventory}
        />
      )}

      {selectedIssue && (
        <RunDetailsCard
          approvalEvidence={selectedApprovalEvidence}
          approvals={selectedApprovals}
          error={detailError}
          events={selectedEvents}
          issue={selectedIssue}
          onClose={closeDetails}
          onRespondApproval={handleApprovalResponse}
          onRetry={handleRetry}
          onRefreshReviewArtifacts={handleRefreshReviewArtifacts}
          onStart={handleStart}
          onStop={handleStop}
          prompt={selectedPrompt}
          refreshingReviewArtifacts={refreshingReviewArtifacts}
          reviewArtifacts={selectedReviewArtifacts}
          run={selectedRun}
          selectedProvider={selectedProvider}
          workspace={selectedWorkspace}
        />
      )}

      {filtered.length === 0 ? (
        <StateMessage
          title={allIssues.length === 0 ? "No real issues loaded" : "No issues match the current filters"}
          message={
            allIssues.length === 0
              ? "Connect Linear, confirm the issue scope, then refresh issues. Symphonia does not show sample issues."
              : "Clear filters or refresh Linear to update the board."
          }
          actionLabel={allIssues.length === 0 ? "Refresh issues" : undefined}
          onAction={allIssues.length === 0 ? () => void handleRefreshIssues() : undefined}
        />
      ) : view === "board" ? (
        <div className="flex-1 overflow-auto">
          <div className="flex min-w-max gap-3 p-3">
            {statusColumns.map((s) => (
              <div
                key={s}
                className="flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30"
              >
                <div className="flex items-center gap-2 px-3 py-2 border-b">
                  <IssueStatusIcon status={iconStatusForState(s)} />
                  <span className="text-sm font-medium">{s}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {grouped[s]?.length ?? 0}
                  </span>
                  <button
                    type="button"
                    disabled
                    title="Issue creation is deferred."
                    className="ml-auto grid h-5 w-5 place-items-center rounded text-muted-foreground opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex flex-col gap-2 p-2">
                  {(grouped[s] ?? []).map((i) => (
                    <IssueCard
                      key={i.id}
                      canRun={canRunIssueWithCodex(i)}
                      issue={i}
                      onRun={(item) => void handleStart(item)}
                      selected={i.id === selectedIssueId}
                      onSelect={selectIssue}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {statusColumns.map((s) =>
            (grouped[s]?.length ?? 0) === 0 ? null : (
              <section key={s} className="border-b last:border-b-0">
                <div className="flex items-center gap-2 px-4 py-2 bg-muted/30">
                  <IssueStatusIcon status={iconStatusForState(s)} />
                  <span className="text-sm font-medium">{s}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {grouped[s]?.length ?? 0}
                  </span>
                </div>
                {(grouped[s] ?? []).map((i) => (
                  <IssueRow
                    key={i.id}
                    canRun={canRunIssueWithCodex(i)}
                    issue={i}
                    onRun={(item) => void handleStart(item)}
                    selected={i.id === selectedIssueId}
                    onSelect={selectIssue}
                  />
                ))}
              </section>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function RunDetailsCard({
  approvalEvidence,
  approvals,
  error,
  events,
  issue,
  onClose,
  onRespondApproval,
  onRetry,
  onRefreshReviewArtifacts,
  onStart,
  onStop,
  prompt,
  refreshingReviewArtifacts,
  reviewArtifacts,
  run,
  selectedProvider,
  workspace,
}: {
  approvalEvidence: RunApprovalEvidence | null;
  approvals: ApprovalState[];
  error: string | null;
  events: AgentEvent[];
  issue: Issue;
  onClose: () => void;
  onRespondApproval: (approval: ApprovalState, decision: ApprovalDecision) => Promise<void>;
  onRetry: (run: Run) => Promise<void>;
  onRefreshReviewArtifacts: (run: Run) => Promise<void>;
  onStart: (issue: Issue) => Promise<void>;
  onStop: (run: Run) => Promise<void>;
  prompt: string | null;
  refreshingReviewArtifacts: boolean;
  reviewArtifacts: ReviewArtifactSnapshot | null;
  run?: Run | null;
  selectedProvider: ProviderId;
  workspace: WorkspaceInfo | null;
}) {
  const running = run ? !isTerminalRunStatus(run.status) : false;
  const retryable =
    run?.status === "failed" ||
    run?.status === "cancelled" ||
    run?.status === "timed_out" ||
    run?.status === "interrupted" ||
    run?.status === "orphaned" ||
    run?.status === "recovered";
  const codexMetadata = extractCodexMetadata(events);
  const providerMetadata = extractProviderMetadata(events, run?.provider ?? selectedProvider);
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 px-4 py-6 backdrop-blur-sm">
      <section
        aria-labelledby="run-detail-heading"
        aria-modal="true"
        role="dialog"
        className="max-h-[84svh] w-full max-w-3xl overflow-auto rounded-lg border bg-card p-5 text-card-foreground shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="run-detail-heading" className="text-lg font-semibold">
              Run details
            </h2>
            <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">{issue.key}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close run details"
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4">
          <h3 className="text-xl font-semibold leading-tight">{issue.title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{issue.description}</p>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {issue.labels.map((label) => (
              <span
                key={label.id}
                className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                <span className={cn("h-1.5 w-1.5 rounded-full bg-current", label.color)} />
                {label.name}
              </span>
            ))}
          </div>

          <ProofStateBanner events={events} reviewArtifacts={reviewArtifacts} run={run ?? null} />

          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Priority</dt>
              <dd className="mt-1 font-medium">{issue.sourcePriority}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Tracker</dt>
              <dd className="mt-1 font-medium">{issue.trackerKind}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Current issue state</dt>
              <dd className="mt-1 font-medium">{issue.status}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Last fetched</dt>
              <dd className="mt-1 font-medium">{issue.lastFetchedAt ? formatTime(issue.lastFetchedAt) : "Not cached"}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Latest run</dt>
              <dd className="mt-1 font-medium">{run ? `${run.provider} ${run.status.replaceAll("_", " ")}` : "Ready for Codex"}</dd>
            </div>
            {run && (
              <div className="rounded-md border p-3">
                <dt className="text-muted-foreground">Recovery state</dt>
                <dd className="mt-1 font-medium">{run.recoveryState.replaceAll("_", " ")}</dd>
                <dd className="mt-1 text-xs text-muted-foreground">
                  {run.recoveredAt ? `recovered ${formatTime(run.recoveredAt)}` : "no restart recovery recorded"}
                </dd>
              </div>
            )}
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Workspace</dt>
              <dd className="mt-1 break-all font-medium">
                {workspace ? `${workspace.path} (${workspace.createdNow ? "created" : "reused"})` : "Not prepared yet"}
              </dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Issue URL</dt>
              <dd className="mt-1 break-all font-medium">
                <a
                  href={issue.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:underline"
                  aria-label={`Open ${issue.key} in ${issue.trackerKind}`}
                >
                  {issue.url}
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
              </dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Codex thread</dt>
              <dd className="mt-1 break-all font-medium">
                {codexMetadata.threadId ? `${codexMetadata.threadId}${codexMetadata.turnId ? ` / ${codexMetadata.turnId}` : ""}` : "No Codex turn"}
              </dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Provider session</dt>
              <dd className="mt-1 break-all font-medium">{providerMetadata.primary ?? "No provider session yet"}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">{providerMetadata.secondary}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            {running && run ? (
              <button
                type="button"
                onClick={() => void onStop(run)}
                className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-500/10 dark:text-red-300"
              >
                {run.provider === "codex" ? "Interrupt Codex" : `Stop ${providerDisplayName(run.provider)}`}
              </button>
            ) : retryable && run ? (
              <button
                type="button"
                onClick={() => void onRetry(run)}
                className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium text-amber-600 hover:bg-amber-500/10 dark:text-amber-300"
              >
                Retry run
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void onStart(issue)}
                className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Run with Codex
              </button>
            )}
          </div>

          {error && (
            <p role="alert" className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          )}

          <ApprovalEvidencePanel approvalEvidence={approvalEvidence} events={events} reviewArtifacts={reviewArtifacts} run={run ?? null} />

          <EvidenceSummaryPanel events={events} run={run ?? null} />

          <ReviewArtifactsPanel
            onRefresh={onRefreshReviewArtifacts}
            refreshing={refreshingReviewArtifacts}
            reviewArtifacts={reviewArtifacts}
            run={run ?? null}
          />

          <WriteActionsPanel
            approvalEvidence={approvalEvidence}
            issue={issue}
            reviewArtifacts={reviewArtifacts}
            run={run ?? null}
          />

          {pendingApprovals.length > 0 && (
            <section aria-labelledby="approvals-heading" className="mt-6">
              <h3 id="approvals-heading" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Pending approvals
              </h3>
              <div className="mt-3 space-y-3">
                {pendingApprovals.map((approval) => (
                  <ApprovalCard key={approval.approvalId} approval={approval} onRespond={onRespondApproval} />
                ))}
              </div>
            </section>
          )}

          {run && run.provider !== "codex" && (
            <p className="mt-4 rounded-md border p-3 text-xs text-muted-foreground">
              Codex supports interactive approval requests through app-server. Claude and Cursor CLI permissions are configured before run start; no live approval request is pending for this provider.
            </p>
          )}

          <section aria-labelledby="prompt-heading" className="mt-6">
            <h3 id="prompt-heading" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Rendered prompt
            </h3>
            <textarea
              readOnly
              value={prompt ?? "No rendered prompt yet."}
              className="mt-3 min-h-36 w-full resize-y rounded-md border bg-background p-3 font-mono text-xs leading-5 text-muted-foreground"
              aria-label="Rendered run prompt"
            />
          </section>

          <section aria-labelledby="timeline-heading" className="mt-6">
            <h3 id="timeline-heading" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Event timeline
            </h3>
            {!run ? (
              <p className="mt-3 rounded-md border p-3 text-sm text-muted-foreground">
                Start a run to create a persisted timeline.
              </p>
            ) : events.length === 0 ? (
              <p className="mt-3 rounded-md border p-3 text-sm text-muted-foreground">
                Waiting for events from the daemon.
              </p>
            ) : (
              <ol aria-live="polite" aria-relevant="additions text" className="mt-3 space-y-3">
                {events.map((event) => (
                  <li key={event.id} className="rounded-md border bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{eventLabel(event)}</span>
                      <time className="shrink-0 text-xs text-muted-foreground" dateTime={event.timestamp}>
                        {formatTime(event.timestamp)}
                      </time>
                    </div>
                    <EventBody event={event} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function ProofStateBanner({
  events,
  reviewArtifacts,
  run,
}: {
  events: AgentEvent[];
  reviewArtifacts: ReviewArtifactSnapshot | null;
  run: Run | null;
}) {
  const providerEvents = events.filter((event) => event.type.startsWith("codex.") || event.type === "provider.started");
  const tone = !run
    ? "neutral"
    : run.status === "failed" || run.status === "timed_out" || run.status === "stalled"
      ? "danger"
      : isTerminalRunStatus(run.status) && reviewArtifacts
        ? "success"
        : isTerminalRunStatus(run.status)
          ? "warning"
          : "active";
  const title = !run
    ? "No run started"
    : run.status === "failed" || run.status === "timed_out" || run.status === "stalled"
      ? "Run failed"
      : isTerminalRunStatus(run.status) && reviewArtifacts
        ? "Review artifact ready"
        : isTerminalRunStatus(run.status)
          ? "Run complete; review artifact missing"
          : "Run in progress";
  const message = !run
    ? "Open a real issue and run it with Codex to create the proof timeline."
    : `${run.provider} ${run.status.replaceAll("_", " ")} · ${events.length} persisted events · ${providerEvents.length} provider events`;

  return (
    <div className={cn("mt-4 rounded-md border p-3 text-sm", proofToneClass(tone))}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{title}</p>
        {run && <RunStatusBadge status={run.status} />}
      </div>
      <p className="mt-1 text-xs">{message}</p>
      {reviewArtifacts && (
        <p className="mt-1 break-all text-xs">
          Artifact refreshed {formatTime(reviewArtifacts.lastRefreshedAt)} for {reviewArtifacts.issueIdentifier} in {reviewArtifacts.workspace?.path ?? "workspace unavailable"}.
        </p>
      )}
    </div>
  );
}

function ApprovalEvidencePanel({
  approvalEvidence,
  events,
  reviewArtifacts,
  run,
}: {
  approvalEvidence: RunApprovalEvidence | null;
  events: AgentEvent[];
  reviewArtifacts: ReviewArtifactSnapshot | null;
  run: Run | null;
}) {
  const changedFiles = approvalEvidence?.changedFiles ?? reviewArtifacts?.diff.files ?? [];
  const fileSummary =
    approvalEvidence?.fileSummary ??
    (reviewArtifacts
      ? reviewArtifacts.diff.filesChanged === 0
        ? "No file changes were detected."
        : clientDiffSummary(reviewArtifacts.diff)
      : null);
  const missingReasons =
    approvalEvidence?.missingEvidenceReasons ??
    (run ? ["Approval evidence has not loaded yet. Refresh the run details if this persists."] : []);
  const eventCount = approvalEvidence?.evidenceSummary.eventCount ?? events.length;
  const finalState = approvalEvidence?.finalRunState ?? run?.status ?? null;
  const hookOutput = approvalEvidence?.hookOutputSummary ?? [];
  const reviewStatus = approvalEvidence?.reviewArtifactStatus ?? (reviewArtifacts ? (reviewArtifacts.error ? "error" : "ready") : "missing");
  const fileSummarySource = approvalEvidence?.fileSummarySource ?? (reviewArtifacts ? "review_artifact" : "unavailable");

  return (
    <section aria-labelledby="approval-evidence-heading" className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="approval-evidence-heading" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Approval evidence
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Evidence for human review before any future GitHub or Linear write action.
          </p>
        </div>
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", reviewStatus === "ready" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300")}>
          {reviewStatus.replaceAll("_", " ")}
        </span>
      </div>

      {!run ? (
        <p className="mt-3 rounded-md border p-3 text-sm text-muted-foreground">Start a run to collect approval evidence.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Run</dt>
              <dd className="mt-1 break-all font-medium">{run.id}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">{run.provider} · {finalState ? finalState.replaceAll("_", " ") : "state unavailable"}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Workspace</dt>
              <dd className="mt-1 break-all font-medium">{approvalEvidence?.workspacePath ?? reviewArtifacts?.workspace?.path ?? run.workspacePath ?? "Workspace path unavailable"}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Timeline</dt>
              <dd className="mt-1 font-medium">{eventCount} persisted events</dd>
              <dd className="mt-1 text-xs text-muted-foreground">
                {approvalEvidence?.evidenceSummary.lastEventAt ? `last event ${formatTime(approvalEvidence.evidenceSummary.lastEventAt)}` : "open the event timeline below"}
              </dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Review artifact</dt>
              <dd className="mt-1 break-all font-medium">{approvalEvidence?.reviewArtifactIdentifier ?? (reviewArtifacts ? `review-artifact:${reviewArtifacts.runId}` : "Missing")}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">{reviewArtifacts?.lastRefreshedAt ? `refreshed ${formatTime(reviewArtifacts.lastRefreshedAt)}` : "not refreshed"}</dd>
            </div>
          </dl>

          <div className="rounded-md border p-3">
            <p className="text-sm font-medium">File-change summary</p>
            {fileSummary ? (
              <p className="mt-2 text-sm text-muted-foreground">{fileSummary}</p>
            ) : (
              <p role="alert" className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                File-change summary is missing. Future write actions must stay blocked until this evidence is available or explicitly reviewed as unavailable.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">source: {fileSummarySource.replaceAll("_", " ")}</p>
          </div>

          <div className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h4 className="text-sm font-medium">Changed files</h4>
              <span className="text-xs text-muted-foreground">{changedFiles.length}</span>
            </div>
            {changedFiles.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No changed files were reported by the review evidence.</p>
            ) : (
              <ul className="divide-y">
                {changedFiles.slice(0, 12).map((file) => (
                  <li key={`${file.source}-${file.path}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <span className="break-all font-medium">{file.path}</span>
                    <span className="text-xs text-muted-foreground">{file.source} · {file.status} · +{file.additions} -{file.deletions}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {hookOutput.length > 0 ? (
            <div className="rounded-md border">
              <h4 className="border-b px-3 py-2 text-sm font-medium">Hook/test output</h4>
              <ul className="divide-y">
                {hookOutput.slice(0, 6).map((hook) => (
                  <li key={`${hook.hookName}-${hook.status}-${hook.cwd}`} className="p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{hook.hookName}</span>
                      <span className="text-xs text-muted-foreground">{hook.status.replaceAll("_", " ")} · exit {hook.exitCode ?? "n/a"}</span>
                    </div>
                    {hook.command && <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{hook.command}</p>}
                    {(hook.stdoutPreview || hook.stderrPreview || hook.error) && (
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-2 text-xs text-muted-foreground">
                        {[hook.stdoutPreview, hook.stderrPreview, hook.error].filter(Boolean).join("\n")}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="rounded-md border p-3 text-sm text-muted-foreground">No hook or test output was recorded for this run.</p>
          )}

          {missingReasons.length > 0 && (
            <StatusList title="Missing evidence" tone="warning" items={missingReasons} />
          )}
        </div>
      )}
    </section>
  );
}

function EvidenceSummaryPanel({ events, run }: { events: AgentEvent[]; run: Run | null }) {
  const hookEvents = events.filter((event) => event.type === "hook.succeeded" || event.type === "hook.failed" || event.type === "hook.timed_out");
  const providerErrors = events.filter((event) => event.type.endsWith(".error") || event.type === "provider.stderr");
  const assistantMessages = events.filter((event) => event.type === "codex.assistant.delta" || event.type === "agent.message");
  const latestHook = hookEvents.at(-1);
  const latestHookOutput =
    latestHook && "hook" in latestHook
      ? [latestHook.hook.stdout.trim(), latestHook.hook.stderr.trim()].filter(Boolean).join("\n")
      : "";

  return (
    <section aria-labelledby="evidence-summary-heading" className="mt-6">
      <h3 id="evidence-summary-heading" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Evidence summary
      </h3>
      {!run ? (
        <p className="mt-3 rounded-md border p-3 text-sm text-muted-foreground">Run evidence appears here after Codex starts.</p>
      ) : (
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-md border p-3">
            <dt className="text-muted-foreground">Timeline events</dt>
            <dd className="mt-1 font-medium">{events.length}</dd>
          </div>
          <div className="rounded-md border p-3">
            <dt className="text-muted-foreground">Provider output</dt>
            <dd className="mt-1 font-medium">{assistantMessages.length} streamed messages</dd>
          </div>
          <div className="rounded-md border p-3">
            <dt className="text-muted-foreground">Provider errors</dt>
            <dd className="mt-1 font-medium">{providerErrors.length}</dd>
          </div>
          <div className="rounded-md border p-3 sm:col-span-3">
            <dt className="text-muted-foreground">Test or hook output</dt>
            <dd className="mt-2">
              {latestHookOutput ? (
                <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-2 text-xs text-muted-foreground">{latestHookOutput}</pre>
              ) : (
                <span className="text-sm text-muted-foreground">No hook or test output has been reported yet.</span>
              )}
            </dd>
          </div>
        </div>
      )}
    </section>
  );
}

function proofToneClass(tone: "active" | "danger" | "neutral" | "success" | "warning") {
  switch (tone) {
    case "success":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "danger":
      return "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "active":
      return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "neutral":
      return "text-muted-foreground";
  }
}

function ReviewArtifactsPanel({
  onRefresh,
  refreshing,
  reviewArtifacts,
  run,
}: {
  onRefresh: (run: Run) => Promise<void>;
  refreshing: boolean;
  reviewArtifacts: ReviewArtifactSnapshot | null;
  run: Run | null;
}) {
  const git = reviewArtifacts?.git;
  const pr = reviewArtifacts?.pr;
  const files = reviewArtifacts?.diff.files ?? [];
  const hasCheckArtifacts = Boolean(
    reviewArtifacts &&
      (reviewArtifacts.checks.length > 0 ||
        reviewArtifacts.workflowRuns.length > 0 ||
        (reviewArtifacts.commitStatus?.statuses.length ?? 0) > 0),
  );

  return (
    <section aria-labelledby="review-artifacts-heading" className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="review-artifacts-heading" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Review artifacts
        </h3>
        <button
          type="button"
          onClick={() => run && void onRefresh(run)}
          disabled={!run || refreshing}
          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Refresh review artifacts
        </button>
      </div>

      {!run ? (
        <p className="mt-3 rounded-md border p-3 text-sm text-muted-foreground">Start a run to collect local git and GitHub review artifacts.</p>
      ) : !reviewArtifacts ? (
        <p className="mt-3 rounded-md border p-3 text-sm text-muted-foreground">No review artifacts have been collected yet.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {reviewArtifacts.error && (
            <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              {reviewArtifacts.error}
            </p>
          )}

          <div className="rounded-md border bg-muted/20 p-3 text-xs">
            <div className="grid gap-2 sm:grid-cols-2">
              <ArtifactKeyValue label="Issue" value={reviewArtifacts.issueIdentifier} />
              <ArtifactKeyValue label="Run" value={reviewArtifacts.runId} />
              <ArtifactKeyValue label="Provider" value={reviewArtifacts.provider} />
              <ArtifactKeyValue label="Workspace" value={reviewArtifacts.workspace?.path ?? "Unavailable"} />
              <ArtifactKeyValue label="Status" value={reviewArtifacts.error ? "needs attention" : "ready for human review"} />
              <ArtifactKeyValue label="Next action" value="Review local diff, run output, and gated future write actions." />
            </div>
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <GitBranch className="h-3.5 w-3.5" /> Branch
              </dt>
              <dd className="mt-1 break-all font-medium">{git?.currentBranch ?? "No branch"}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">
                base {git?.baseBranch ?? "unknown"} · head {shortSha(git?.headSha)}
              </dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <FileDiff className="h-3.5 w-3.5" /> Local changes
              </dt>
              <dd className="mt-1 font-medium">
                {git?.isGitRepo ? `${reviewArtifacts.diff.filesChanged} files, +${reviewArtifacts.diff.additions} -${reviewArtifacts.diff.deletions}` : "Workspace is not a git repo"}
              </dd>
              <dd className="mt-1 text-xs text-muted-foreground">
                {git?.isDirty ? "dirty" : "clean"} · untracked {git?.untrackedFileCount ?? 0} · staged {git?.stagedFileCount ?? 0}
              </dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <GitPullRequest className="h-3.5 w-3.5" /> Pull request
              </dt>
              <dd className="mt-1 font-medium">
                {pr ? (
                  <a href={pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline" aria-label={`Open pull request ${pr.number} on GitHub`}>
                    #{pr.number} {pr.title}
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                ) : (
                  "No PR found"
                )}
              </dd>
              {pr && (
                <dd className="mt-1 text-xs text-muted-foreground">
                  {pr.state} · {pr.draft ? "draft" : "ready"} · {pr.headBranch} → {pr.baseBranch}
                </dd>
              )}
            </div>
            <div className="rounded-md border p-3">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5" /> CI status
              </dt>
              <dd className="mt-1 font-medium">{hasCheckArtifacts ? (reviewArtifacts.commitStatus?.state ?? "Checks reported") : "No GitHub checks are currently reported"}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">
                {reviewArtifacts.checks.length} check runs · {reviewArtifacts.workflowRuns.length} workflow runs
                {!hasCheckArtifacts ? " · Refresh review artifacts after CI starts." : ""}
              </dd>
            </div>
          </dl>

          <div className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h4 className="text-sm font-medium">Changed files</h4>
              <span className="text-xs text-muted-foreground">{files.length}</span>
            </div>
            {files.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No changed files were reported.</p>
            ) : (
              <ul className="divide-y">
                {files.slice(0, 30).map((file) => (
                  <li key={`${file.source}-${file.path}`} className="p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="break-all text-sm font-medium">{file.path}</span>
                      <span className="text-xs text-muted-foreground">
                        {file.source} · {file.status} · +{file.additions} -{file.deletions}
                      </span>
                    </div>
                    {file.patch && (
                      <details className="mt-2 rounded-md border bg-background p-2">
                        <summary className="cursor-pointer text-xs font-medium">Patch preview</summary>
                        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{file.patch}</pre>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {hasCheckArtifacts ? (
            <div className="grid gap-3 md:grid-cols-2">
              <ArtifactStatusList
                title="Check runs"
                items={reviewArtifacts.checks.map((check) => ({
                  key: String(check.id),
                  label: check.name,
                  status: formatArtifactStatus(check.status, check.conclusion),
                  url: check.url ?? check.detailsUrl,
                }))}
              />
              <ArtifactStatusList
                title="Workflow runs"
                items={reviewArtifacts.workflowRuns.map((workflowRun) => ({
                  key: String(workflowRun.id),
                  label: workflowRun.name,
                  status: formatArtifactStatus(workflowRun.status, workflowRun.conclusion),
                  url: workflowRun.url,
                }))}
              />
            </div>
          ) : (
            <p className="rounded-md border p-3 text-sm text-muted-foreground">
              No GitHub checks are currently reported. Refresh review artifacts after CI starts or after pushing the branch.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function ArtifactKeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[6rem_1fr]">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all font-medium">{value}</span>
    </div>
  );
}

function formatArtifactStatus(status: string | null | undefined, conclusion: string | null | undefined): string {
  const normalizedStatus = normalizeArtifactState(status);
  const normalizedConclusion = normalizeArtifactState(conclusion);
  return [normalizedStatus, normalizedConclusion].filter(Boolean).join(" / ") || "unknown";
}

function normalizeArtifactState(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/_/g, " ").toLowerCase();
  if (normalized === "in progress") return "in progress";
  if (["queued", "pending", "completed", "success", "failure", "failed", "skipped", "cancelled", "canceled", "neutral", "timed out", "action required"].includes(normalized)) {
    return normalized;
  }
  return normalized;
}

function WriteActionsPanel({
  approvalEvidence,
  issue,
  reviewArtifacts,
  run,
}: {
  approvalEvidence: RunApprovalEvidence | null;
  issue: Issue;
  reviewArtifacts: ReviewArtifactSnapshot | null;
  run: Run | null;
}) {
  const [status, setStatus] = useState<WritesStatus | null>(null);
  const [writeActionResponse, setWriteActionResponse] = useState<IntegrationWriteActionsResponse | null>(null);
  const [history, setHistory] = useState<Array<IntegrationWritePreview | IntegrationWriteResult | LocalWriteExecutionRecord>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [executingPreviewId, setExecutingPreviewId] = useState<string | null>(null);
  const [confirmationByPreview, setConfirmationByPreview] = useState<Record<string, string>>({});
  const [executionResult, setExecutionResult] = useState<GitHubPrExecutionResponse | null>(null);
  const [preflightByPreview, setPreflightByPreview] = useState<Record<string, GitHubPrPreflightResult>>({});

  const loadWriteActions = useCallback(async () => {
    if (!run) {
      setWriteActionResponse(null);
      setHistory([]);
      setPreflightByPreview({});
      return;
    }
    const response = await getRunWriteActions(run.id);
    setWriteActionResponse(response);
    setHistory(response.writeActions);
    const githubPreflights = await Promise.all(
      response.previews
        .filter((preview) => preview.kind === "github_pr_create")
        .map(async (preview) => [
          preview.id,
          await getGithubPrPreflight(run.id, {
            previewId: preview.id,
            payloadHash: preview.payloadHash,
            idempotencyKey: preview.idempotencyKey,
            targetRepository: preview.targetRepository,
            baseBranch: preview.baseBranch,
            headBranch: preview.targetBranch,
          }),
        ] as const),
    );
    setPreflightByPreview(Object.fromEntries(githubPreflights));
  }, [run]);

  useEffect(() => {
    setWriteActionResponse(null);
    setHistory([]);
    setError(null);
    setPreflightByPreview({});
    void Promise.all([getWritesStatus(), run ? loadWriteActions().then(() => null) : Promise.resolve(null)])
      .then(([loadedStatus]) => {
        setStatus(loadedStatus);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Failed to load write actions.");
      });
  }, [loadWriteActions, run]);

  const handleRefresh = useCallback(async () => {
    if (!run) return;
    try {
      setBusy(true);
      setError(null);
      await loadWriteActions();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to refresh write previews.");
    } finally {
      setBusy(false);
    }
  }, [loadWriteActions, run]);

  const handleCreateDraftPr = useCallback(
    async (preview: WriteActionPreviewContract) => {
      if (!run || preview.kind !== "github_pr_create" || !preview.payload.githubPr || !preview.targetRepository || !preview.baseBranch || !preview.targetBranch) {
        return;
      }
      try {
        setExecutingPreviewId(preview.id);
        setError(null);
        const result = await createGithubDraftPr(run.id, {
          runId: run.id,
          previewId: preview.id,
          actionKind: "github_pr_create",
          payloadHash: preview.payloadHash,
          idempotencyKey: preview.idempotencyKey,
          confirmationText: confirmationByPreview[preview.id] ?? "",
          targetRepository: preview.targetRepository,
          baseBranch: preview.baseBranch,
          headBranch: preview.targetBranch,
          draft: true,
        });
        setExecutionResult(result);
        await loadWriteActions();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "GitHub draft PR creation failed.");
      } finally {
        setExecutingPreviewId(null);
      }
    },
    [confirmationByPreview, loadWriteActions, run],
  );

  const previews = writeActionResponse?.previews ?? [];
  const availability = writeActionResponse?.availability ?? approvalEvidence?.writeActionAvailability ?? [];

  return (
    <section aria-labelledby="write-actions-heading" className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="write-actions-heading" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            External write previews
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            GitHub draft PR creation is manual and confirmation-gated for {issue.key}. Linear writes remain disabled.
          </p>
        </div>
        {run && (
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {busy ? "Refreshing..." : "Refresh previews"}
          </button>
        )}
      </div>

      {!run ? (
        <p className="mt-3 rounded-md border p-3 text-sm text-muted-foreground">Start or select a run before inspecting GitHub or Linear write previews.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {error && (
            <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          )}

          <WriteAvailabilityList availability={availability} />

          {status && (
            <div className="grid gap-3 md:grid-cols-2">
              <PolicySummary title="GitHub write posture" policy={status.github} />
              <PolicySummary title="Linear write posture" policy={status.linear} />
            </div>
          )}

          {previews.length === 0 ? (
            <p className="rounded-md border p-3 text-sm text-muted-foreground">
              Write previews have not loaded yet. Existing write gates remain in force.
            </p>
          ) : (
            <div className="grid gap-3 xl:grid-cols-3">
              {previews.map((preview) => (
                <WritePreviewContractCard
                  key={preview.id}
                  preview={preview}
                  confirmationValue={confirmationByPreview[preview.id] ?? ""}
                  executionResult={executionResult?.previewId === preview.id ? executionResult : null}
                  executing={executingPreviewId === preview.id}
                  preflight={preflightByPreview[preview.id] ?? null}
                  onConfirmationChange={(value) => setConfirmationByPreview((current) => ({ ...current, [preview.id]: value }))}
                  onCreateDraftPr={() => void handleCreateDraftPr(preview)}
                />
              ))}
            </div>
          )}

          <div className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h4 className="text-sm font-medium">Local write audit history</h4>
              <span className="text-xs text-muted-foreground">{history.length}</span>
            </div>
            {history.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No previous local write previews or execution records exist for this run.</p>
            ) : (
              <ul className="divide-y">
                {history.slice(0, 20).map((action) => (
                  <li key={action.id} className="p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{writeActionLabel(action)}</span>
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", writeStatusClass(action.status))}>
                        {action.status.replaceAll("_", " ")}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{writeActionProvider(action)}</span>
                      <span>{action.kind.replaceAll("_", " ")}</span>
                      <span>{formatTime(writeActionTimestamp(action))}</span>
                      {writeActionUrl(action) && (
                        <a href={writeActionUrl(action) ?? ""} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                          Open result <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {reviewArtifacts?.pr && (
            <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
              GitHub review artifacts already detected PR #{reviewArtifacts.pr.number}; PR previews should remain blocked for duplicate creation.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function WriteAvailabilityList({ availability }: { availability: RunApprovalEvidence["writeActionAvailability"] }) {
  if (availability.length === 0) {
    return (
      <p className="rounded-md border p-3 text-sm text-muted-foreground">
        Write-action availability has not loaded yet. Existing write gates remain in force.
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h4 className="text-sm font-medium">Write gate availability</h4>
        <span className="text-xs text-muted-foreground">no automatic writes</span>
      </div>
      <ul className="divide-y">
        {availability.map((action) => (
          <li key={`${action.provider}-${action.kind}`} className="p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{action.label}</span>
              <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", writeAvailabilityClass(action.status))}>
                {action.status.replaceAll("_", " ")}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Requires {action.evidenceRequired.join(", ")}.
            </p>
            {action.reasons.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {action.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PolicySummary({ policy, title }: { policy: IntegrationWritePolicy; title: string }) {
  return (
    <div className="rounded-md border p-3">
      <h4 className="text-sm font-medium">{title}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{writePolicyText(policy)}</p>
    </div>
  );
}

function WritePreviewContractCard({
  confirmationValue,
  executing,
  executionResult,
  onConfirmationChange,
  onCreateDraftPr,
  preflight,
  preview,
}: {
  confirmationValue: string;
  executing: boolean;
  executionResult: GitHubPrExecutionResponse | null;
  onConfirmationChange: (value: string) => void;
  onCreateDraftPr: () => void;
  preflight: GitHubPrPreflightResult | null;
  preview: WriteActionPreviewContract;
}) {
  const canCreateDraftPr =
    preview.kind === "github_pr_create" &&
    preview.status === "preview_available" &&
    preview.blockingReasons.length === 0 &&
    preflight?.canExecute === true &&
    confirmationValue === preview.confirmationPhrase;
  const isGithubPr = preview.kind === "github_pr_create";
  const preflightBlocks = preflight?.blockingReasons ?? [];
  return (
    <article className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">{writePreviewLabel(preview.kind)}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{preview.targetSystem} · {preview.targetLabel}</p>
        </div>
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", writePreviewStatusClass(preview.status))}>
          {preview.status.replaceAll("_", " ")}
        </span>
      </div>

      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <PreviewKeyValue label="Mode" value={preview.dryRunOnly ? "preview only" : "execution unavailable"} />
        <PreviewKeyValue label="Evidence" value={preview.approvalEvidenceSource} />
        <PreviewKeyValue label="Review artifact" value={preview.reviewArtifactId ?? "missing"} />
        <PreviewKeyValue label="Payload hash" value={preview.payloadHash.slice(0, 16)} />
        <PreviewKeyValue label="Idempotency" value={preview.idempotencyKey} />
        {preview.targetRepository && <PreviewKeyValue label="Repository" value={preview.targetRepository} />}
        {preview.baseBranch && <PreviewKeyValue label="Base" value={preview.baseBranch} />}
        {preview.targetBranch && <PreviewKeyValue label="Branch" value={preview.targetBranch} />}
      </dl>

      <div className="mt-3 rounded-md border bg-background">
        <div className="border-b px-3 py-2 text-xs font-medium">{preview.kind === "linear_status_update" ? "State payload" : "Body preview"}</div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap p-3 text-xs leading-5 text-muted-foreground">{preview.bodyPreview || "No body generated."}</pre>
      </div>

      {preview.payload.githubPr && (
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <PreviewKeyValue label="PR title" value={preview.payload.githubPr.title} />
          <PreviewKeyValue label="Draft" value={preview.payload.githubPr.draft ? "yes" : "no"} />
          <PreviewKeyValue
            label="Changed"
            value={`${preview.payload.githubPr.changedFilesSummary.filesChanged} files, +${preview.payload.githubPr.changedFilesSummary.additions} -${preview.payload.githubPr.changedFilesSummary.deletions}`}
          />
        </dl>
      )}

      {preview.payload.linearStatusUpdate && (
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <PreviewKeyValue label="Current" value={preview.payload.linearStatusUpdate.currentStatus ?? "unknown"} />
          <PreviewKeyValue label="Proposed" value={preview.payload.linearStatusUpdate.proposedStatus ?? "not configured"} />
          <PreviewKeyValue label="Run state" value={preview.payload.linearStatusUpdate.finalRunState} />
        </dl>
      )}

      {preview.changedFiles.length > 0 ? (
        <div className="mt-3 rounded-md border bg-background">
          <div className="border-b px-3 py-2 text-xs font-medium">Changed files</div>
          <ul className="max-h-32 overflow-auto p-3 text-xs text-muted-foreground">
            {preview.changedFiles.slice(0, 8).map((file) => (
              <li key={file.path} className="break-all">
                {file.path}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 rounded-md border p-3 text-xs text-muted-foreground">No changed files are attached to this preview.</p>
      )}

      <div className="mt-3 space-y-2">
        <p className="text-xs text-muted-foreground">Requires {preview.requiredPermissions.join(", ")}.</p>
        <p className="text-xs text-muted-foreground">{preview.confirmationPrompt}</p>
      </div>

      {preview.blockingReasons.length > 0 && <StatusList title="Blocking reasons" tone="danger" items={preview.blockingReasons} />}
      {preview.riskWarnings.length > 0 && <StatusList title="Risk warnings" tone="warning" items={preview.riskWarnings} />}

      {isGithubPr && preflight && <GitHubPrPreflightPanel preflight={preflight} />}

      {isGithubPr && preview.blockingReasons.length === 0 && preview.status === "preview_available" && preflight?.canExecute === true && (
        <div className="mt-3 rounded-md border p-3">
          <label className="text-xs font-medium" htmlFor={`${preview.id}-confirmation`}>
            Type {preview.confirmationPhrase} to create a draft PR
          </label>
          <input
            id={`${preview.id}-confirmation`}
            value={confirmationValue}
            onChange={(event) => onConfirmationChange(event.target.value)}
            className="mt-2 w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs"
            placeholder={preview.confirmationPhrase}
          />
          <button
            type="button"
            disabled={!canCreateDraftPr || executing}
            onClick={onCreateDraftPr}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            {executing ? "Creating draft PR..." : "Create draft PR"}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            This writes to GitHub only after local approval/audit persistence. Linear actions remain unavailable.
          </p>
        </div>
      )}

      {isGithubPr && (preview.blockingReasons.length > 0 || preview.status !== "preview_available" || preflight?.canExecute !== true) && (
        <p className="mt-3 rounded-md border p-3 text-xs text-muted-foreground">
          Draft PR creation is unavailable until preflight, GitHub write gate, evidence, repository, branch, and confirmation requirements are satisfied.
          {preflightBlocks.length > 0 ? ` Preflight blocks: ${preflightBlocks.slice(0, 3).join(" ")}` : ""}
        </p>
      )}

      {executionResult && (
        <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          <p className="font-medium">GitHub PR execution: {executionResult.status.replaceAll("_", " ")}</p>
          {executionResult.githubPrUrl ? (
            <a href={executionResult.githubPrUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 hover:underline">
              PR #{executionResult.githubPrNumber} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <p className="mt-1">{executionResult.errorSummary ?? executionResult.blockingReasons.join(" ")}</p>
          )}
        </div>
      )}
    </article>
  );
}

function PreviewKeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all font-medium">{value}</dd>
    </div>
  );
}

function GitHubPrPreflightPanel({ preflight }: { preflight: GitHubPrPreflightResult }) {
  return (
    <div className="mt-3 rounded-md border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <h5 className="text-xs font-medium">PR preflight</h5>
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", writePreviewStatusClass(preflight.status === "passed" ? "preview_available" : preflight.status === "warning" ? "blocked" : "unavailable"))}>
          {preflight.status.replaceAll("_", " ")}
        </span>
      </div>
      <dl className="grid gap-2 p-3 text-xs sm:grid-cols-2">
        <PreviewKeyValue label="Can execute" value={preflight.canExecute ? "yes" : "no"} />
        <PreviewKeyValue label="Workspace" value={preflight.workspace.isIsolatedRunWorkspace ? "isolated" : preflight.workspace.isMainCheckout ? "main checkout" : "not isolated"} />
        <PreviewKeyValue label="Workspace kind" value={preflight.workspace.workspaceKind?.replaceAll("_", " ") ?? "unknown"} />
        <PreviewKeyValue label="Isolation" value={preflight.workspace.isolationStatus.replaceAll("_", " ")} />
        <PreviewKeyValue label="PR eligibility" value={preflight.workspace.prEligibility} />
        <PreviewKeyValue label="Ownership metadata" value={preflight.workspace.hasOwnershipMetadata ? "present" : "missing"} />
        <PreviewKeyValue label="Run ownership" value={preflight.workspace.belongsToRun ? "matches run" : "mismatch"} />
        <PreviewKeyValue label="Remote" value={preflight.repository.matchesTarget ? "matches target" : "mismatch or unavailable"} />
        <PreviewKeyValue label="Branch" value={preflight.branches.headSafe ? "safe" : "blocked"} />
        <PreviewKeyValue label="Write mode" value={preflight.writeMode.githubMode.replaceAll("_", " ")} />
        <PreviewKeyValue label="Diff parity" value={preflight.diff.matchesApprovalEvidence ? "matches evidence" : "mismatch"} />
        <PreviewKeyValue
          label="Files"
          value={`${preflight.diff.liveChangedFiles.length} live / ${preflight.diff.evidenceChangedFiles.length} evidence`}
        />
        <PreviewKeyValue label="Review" value={preflight.reviewArtifact.status} />
        <PreviewKeyValue label="Preview hash" value={preflight.preview.matches ? "matches" : "mismatch"} />
        <PreviewKeyValue label="Remote state" value={preflight.remoteState.ambiguous ? "ambiguous" : "clear"} />
        <PreviewKeyValue label="Branch freshness" value={preflight.branchFreshness.status.replaceAll("_", " ")} />
        <PreviewKeyValue label="Base advanced" value={preflight.branchFreshness.baseHasAdvanced === null ? "unknown" : preflight.branchFreshness.baseHasAdvanced ? "yes" : "no"} />
        <PreviewKeyValue label="Stored base" value={shortCommit(preflight.branchFreshness.storedBaseCommit)} />
        <PreviewKeyValue label="Remote base" value={shortCommit(preflight.branchFreshness.currentRemoteBaseCommit)} />
      </dl>
      {preflight.diff.missingFromLiveDiff.length > 0 && (
        <StatusList title="Missing from live diff" tone="danger" items={preflight.diff.missingFromLiveDiff.slice(0, 8)} />
      )}
      {preflight.diff.extraInLiveDiff.length > 0 && (
        <StatusList title="Extra in live diff" tone="danger" items={preflight.diff.extraInLiveDiff.slice(0, 8)} />
      )}
      {preflight.branchFreshness.upstreamChangedFiles.length > 0 && (
        <StatusList title="Upstream changed files" tone="warning" items={preflight.branchFreshness.upstreamChangedFiles.slice(0, 8)} />
      )}
      {preflight.branchFreshness.overlappingChangedFiles.length > 0 && (
        <StatusList title="Branch freshness overlaps" tone="danger" items={preflight.branchFreshness.overlappingChangedFiles.slice(0, 8)} />
      )}
      {preflight.branchFreshness.blockingReasons.length > 0 && (
        <StatusList title="Branch freshness blocking reasons" tone="danger" items={preflight.branchFreshness.blockingReasons} />
      )}
      {preflight.branchFreshness.warnings.length > 0 && (
        <StatusList title="Branch freshness warnings" tone="warning" items={preflight.branchFreshness.warnings} />
      )}
      {preflight.blockingReasons.length > 0 && <StatusList title="Preflight blocking reasons" tone="danger" items={preflight.blockingReasons} />}
      {preflight.warnings.length > 0 && <StatusList title="Preflight warnings" tone="warning" items={preflight.warnings} />}
    </div>
  );
}

function shortCommit(value: string | null): string {
  return value ? value.slice(0, 12) : "unknown";
}

function StatusList({ items, title, tone }: { items: string[]; title: string; tone: "danger" | "warning" }) {
  return (
    <div className={cn("rounded-md border p-3 text-xs", tone === "danger" ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300")}>
      <p className="font-medium">{title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function writePolicyText(policy: IntegrationWritePolicy | null): string {
  if (!policy) return "Policy not loaded.";
  if (policy.readOnly) return "Read-only is enabled; writes are blocked.";
  if (!policy.enabled) return "Writes are disabled by policy.";
  if (policy.allowedKinds.length === 0) return "No write action kind is enabled.";
  return `Enabled for ${policy.allowedKinds.map((kind) => kind.replaceAll("_", " ")).join(", ")}; confirmation required.`;
}

function writeActionLabel(action: IntegrationWritePreview | IntegrationWriteResult | LocalWriteExecutionRecord): string {
  if ("recordType" in action) {
    return action.githubPrUrl ? "GitHub draft PR execution" : "GitHub draft PR attempt";
  }
  if ("executedAt" in action) {
    return action.externalUrl ? `${action.kind.replaceAll("_", " ")} result` : `${action.kind.replaceAll("_", " ")} attempt`;
  }
  return action.title;
}

function writeActionProvider(action: IntegrationWritePreview | IntegrationWriteResult | LocalWriteExecutionRecord): string {
  return "recordType" in action ? action.targetSystem : action.provider;
}

function writeActionTimestamp(action: IntegrationWritePreview | IntegrationWriteResult | LocalWriteExecutionRecord): string {
  if ("recordType" in action) return action.completedAt ?? action.startedAt;
  return "executedAt" in action ? action.executedAt : action.createdAt;
}

function writeActionUrl(action: IntegrationWritePreview | IntegrationWriteResult | LocalWriteExecutionRecord): string | null {
  if ("recordType" in action) return action.githubPrUrl;
  return "externalUrl" in action ? action.externalUrl : null;
}

function writePreviewLabel(kind: WriteActionPreviewContract["kind"]): string {
  switch (kind) {
    case "github_pr_create":
      return "GitHub PR preview";
    case "linear_comment_create":
      return "Linear comment preview";
    case "linear_status_update":
      return "Linear status preview";
    case "github_branch_push":
      return "GitHub branch preview";
    case "github_issue_comment":
      return "GitHub comment preview";
  }
}

function writePreviewStatusClass(status: WriteActionPreviewContract["status"]) {
  switch (status) {
    case "preview_available":
      return "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300";
    case "read_only":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "evidence_missing":
    case "blocked":
      return "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300";
    case "unavailable":
      return "border-muted bg-muted/40 text-muted-foreground";
  }
}

function writeStatusClass(status: IntegrationWritePreview["status"] | LocalWriteExecutionRecord["status"]) {
  switch (status) {
    case "succeeded":
    case "already_executed":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
    case "blocked":
    case "failed":
      return "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300";
    case "executing":
    case "in_progress":
    case "pending":
    case "pending_confirmation":
    case "previewed":
      return "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300";
    case "cancelled":
      return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300";
  }
}

function writeAvailabilityClass(status: RunApprovalEvidence["writeActionAvailability"][number]["status"]) {
  switch (status) {
    case "enabled":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
    case "manual_enabled":
    case "gated":
      return "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300";
    case "read_only":
    case "disabled":
    case "unavailable":
    case "blocked":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
}

function ArtifactStatusList({
  items,
  title,
}: {
  items: Array<{ key: string; label: string; status: string; url: string | null }>;
  title: string;
}) {
  return (
    <div className="rounded-md border">
      <h4 className="border-b px-3 py-2 text-sm font-medium">{title}</h4>
      {items.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">No entries.</p>
      ) : (
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-3 p-3 text-sm">
              <span className="min-w-0 truncate">{item.label}</span>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-muted-foreground hover:text-foreground" aria-label={`Open ${item.label}`}>
                  {item.status}
                </a>
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">{item.status}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StateMessage({
  actionLabel,
  message,
  onAction,
  title,
}: {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12 text-center">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
        {actionLabel && onAction && (
          <button type="button" onClick={onAction} className="mt-3 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
            <RefreshCw className="h-3.5 w-3.5" />
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <span
      className={cn(
        "ml-auto inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] capitalize leading-none",
        runStatusClassName(status),
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

function ConnectedGateway({
  error,
  onRefreshIssues,
  refreshingIssues,
  status,
}: {
  error: string | null;
  onRefreshIssues: () => Promise<void>;
  refreshingIssues: boolean;
  status: ConnectedGoldenPathStatus | null;
}) {
  const next = status?.nextAction ?? { kind: "start_daemon" as const, label: "Start daemon", href: null };
  const rows = status
    ? [
        {
          key: "daemon",
          label: "Daemon/runtime",
          status: status.daemon.status,
          why: "Required for issues, runs, events, and local artifacts.",
          guidance: `${status.daemon.activeRunsCount} active runs, ${status.daemon.recoveredRunsCount} recovered.`,
          actionKind: "start_daemon",
        },
        {
          key: "repo",
          label: "Repository/workspace",
          status: status.repository.status === "ready" && status.workspace.status === "ready" ? "ready" : status.repository.status,
          why: "Codex runs execute inside a selected local repository workspace.",
          guidance: status.workspace.path ?? status.repository.error ?? "Choose a repository with WORKFLOW.md.",
          actionKind: status.repository.status === "missing" ? "choose_repo" : "configure_workflow",
        },
        {
          key: "github",
          label: "GitHub validation",
          status: status.github.status,
          why: "Review artifacts can validate repository access and existing PR context.",
          guidance: githubGatewayGuidance(status),
          actionKind: "validate_github",
        },
        {
          key: "linear",
          label: "Linear connection",
          status: status.linear.status,
          why: "The board must be populated from real tracked issues.",
          guidance: linearGatewayGuidance(status),
          actionKind: "connect_linear",
        },
        {
          key: "provider",
          label: "Codex provider",
          status: status.provider.status,
          why: "The first run uses the configured Codex app-server provider.",
          guidance: status.provider.error ?? status.provider.hint ?? status.provider.command ?? "Check Codex availability.",
          actionKind: "check_provider",
        },
        {
          key: "board",
          label: "Issue board",
          status: status.board.status,
          why: "A connected-ready user should land on real runnable issue cards.",
          guidance: `${status.board.issueScope}; last sync ${status.board.lastSyncAt ? formatTime(status.board.lastSyncAt) : "never"}.`,
          actionKind: status.board.issueCount === 0 ? "refresh_issues" : "open_board",
        },
        {
          key: "writes",
          label: "Write safety",
          status: status.writes.github === "enabled" || status.writes.linear === "enabled" ? "gated" : "ready",
          why: "GitHub and Linear writes must stay disabled or explicitly confirmation-gated.",
          guidance: `GitHub ${status.writes.github.replaceAll("_", " ")}; Linear ${status.writes.linear.replaceAll("_", " ")}.`,
          actionKind: "review_write_permissions",
        },
      ]
    : [
        {
          key: "daemon",
          label: "Daemon/runtime",
          status: "unavailable",
          why: "Required for issues, runs, events, and local artifacts.",
          guidance: error ?? "The daemon could not be reached at the configured URL.",
          actionKind: "start_daemon",
        },
      ];

  return (
    <section className="border-b bg-muted/20 px-4 py-3" aria-labelledby="connected-gateway-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="connected-gateway-heading" className="text-sm font-semibold">
            Connected setup
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Symphonia uses real local runtime checks, real Linear issues, and the configured Codex provider. It does not seed sample issues or offer Demo Mode.
          </p>
        </div>
        <GatewayAction action={next} onRefreshIssues={onRefreshIssues} refreshingIssues={refreshingIssues} />
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {rows.map((row) => (
          <GatewayRow
            key={row.key}
            action={next.kind === row.actionKind ? next : null}
            guidance={row.guidance}
            label={row.label}
            onRefreshIssues={onRefreshIssues}
            refreshingIssues={refreshingIssues}
            status={row.status}
            why={row.why}
          />
        ))}
      </div>
      {status && status.blockingReasons.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            Blocking reasons
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {status.blockingReasons.slice(0, 5).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function GatewayRow({
  action,
  guidance,
  label,
  onRefreshIssues,
  refreshingIssues,
  status,
  why,
}: {
  action: ConnectedGoldenPathStatus["nextAction"] | null;
  guidance: string;
  label: string;
  onRefreshIssues: () => Promise<void>;
  refreshingIssues: boolean;
  status: string;
  why: string;
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="mt-1 text-xs text-muted-foreground">{why}</p>
        </div>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px]", readinessClass(status))}>
          {readinessLabel(status)}
        </span>
      </div>
      <p className="mt-2 break-words text-xs text-muted-foreground">{guidance}</p>
      {action && (
        <div className="mt-3">
          <GatewayAction action={action} compact onRefreshIssues={onRefreshIssues} refreshingIssues={refreshingIssues} />
        </div>
      )}
    </div>
  );
}

function GatewayAction({
  action,
  compact = false,
  onRefreshIssues,
  refreshingIssues,
}: {
  action: ConnectedGoldenPathStatus["nextAction"];
  compact?: boolean;
  onRefreshIssues: () => Promise<void>;
  refreshingIssues: boolean;
}) {
  const className = compact
    ? "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
    : "inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90";

  if (action.kind === "refresh_issues") {
    return (
      <button type="button" onClick={() => void onRefreshIssues()} disabled={refreshingIssues} className={cn(className, "disabled:cursor-not-allowed disabled:opacity-60")}>
        <RefreshCw className={cn("h-3.5 w-3.5", refreshingIssues && "animate-spin")} />
        {action.label}
      </button>
    );
  }

  if (action.href) {
    return (
      <a href={action.href} className={className}>
        {action.label}
        <ArrowRight className="h-3.5 w-3.5" />
      </a>
    );
  }

  return <span className={className}>{action.label}</span>;
}

function readinessLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function readinessClass(status: string): string {
  if (status === "ready" || status === "healthy") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
  }
  if (status === "missing" || status === "missing_auth" || status === "unavailable" || status === "invalid" || status === "invalid_config" || status === "blocked") {
    return "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300";
  }
  if (status === "empty" || status === "stale" || status === "unknown" || status === "disabled" || status === "gated") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "text-muted-foreground";
}

function githubGatewayGuidance(status: ConnectedGoldenPathStatus): string {
  if (status.github.status === "disabled") {
    return "GitHub validation is disabled in WORKFLOW.md; keep writes off and enable read-only validation when ready.";
  }
  if (status.github.status === "missing_auth") {
    return "Set GITHUB_TOKEN/GITHUB_PAT or connect GitHub in Settings. No GitHub writes are enabled here.";
  }
  return status.github.repository ?? status.github.error ?? "Connect or validate GitHub from Settings.";
}

function linearGatewayGuidance(status: ConnectedGoldenPathStatus): string {
  if (status.linear.status === "missing_auth") {
    return status.linear.error
      ? `Set LINEAR_API_KEY or connect Linear in Settings. ${status.linear.error}`
      : "Set LINEAR_API_KEY or connect Linear in Settings; no sample issues are substituted.";
  }
  return status.linear.error ?? `${status.linear.issueScope}; ${status.linear.issueCount} cached issues.`;
}

function WorkflowPanel({
  cleanupConfirm,
  cleanupPlan,
  cleanupResult,
  daemonStatus,
  executingCleanup,
  githubStatus,
  onCleanupConfirmChange,
  onExecuteCleanup,
  onPlanCleanup,
  onRefreshWorkspaces,
  onReload,
  providers,
  refreshingWorkspaces,
  trackerStatus,
  workflow,
  workspaceInventory,
}: {
  cleanupConfirm: string;
  cleanupPlan: WorkspaceCleanupPlan | null;
  cleanupResult: WorkspaceCleanupResult | null;
  daemonStatus: DaemonStatus | null;
  executingCleanup: boolean;
  githubStatus: GitHubStatus | null;
  onCleanupConfirmChange: (value: string) => void;
  onExecuteCleanup: () => Promise<void>;
  onPlanCleanup: () => Promise<void>;
  onRefreshWorkspaces: () => Promise<void>;
  onReload: () => Promise<void>;
  providers: ProviderHealth[];
  refreshingWorkspaces: boolean;
  trackerStatus: TrackerStatus | null;
  workflow: WorkflowStatus | null;
  workspaceInventory: WorkspaceInventory | null;
}) {
  const summary = workflow?.effectiveConfigSummary;

  return (
    <section aria-labelledby="workflow-panel-heading" className="border-b bg-muted/20 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="workflow-panel-heading" className="text-sm font-semibold">
            Workflow status
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {workflow?.workflowPath ?? "No workflow loaded"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onReload()}
          className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-background"
        >
          Reload workflow
        </button>
      </div>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="mt-1 font-medium">{workflow?.status ?? "unknown"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Provider</dt>
          <dd className="mt-1 font-medium">{summary?.defaultProvider ?? "codex"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Workspace root</dt>
          <dd className="mt-1 break-all font-medium">{summary?.workspaceRoot ?? "Unavailable"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Daemon instance</dt>
          <dd className="mt-1 break-all font-medium">{daemonStatus?.daemonInstanceId.slice(0, 8) ?? "unknown"}</dd>
          <dd className="mt-1 text-[11px] text-muted-foreground">
            {daemonStatus ? `${daemonStatus.activeRunsCount} active · ${daemonStatus.recoveredRunsCount} recovered` : "status unavailable"}
          </dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Workspace cleanup</dt>
          <dd className="mt-1 font-medium">
            {summary?.workspaceCleanup.enabled ? "enabled" : "disabled"} · {summary?.workspaceCleanup.dryRun ? "dry-run" : "delete enabled"}
          </dd>
          <dd className="mt-1 text-[11px] text-muted-foreground">
            {workspaceInventory ? `${workspaceInventory.counts.candidates} candidates · ${workspaceInventory.counts.protected} protected` : "inventory not loaded"}
          </dd>
        </div>
        {(["codex", "claude", "cursor"] as ProviderId[]).map((providerId) => {
          const provider = providers.find((item) => item.id === providerId);
          return (
            <div key={providerId} className="rounded-md border bg-background p-2">
              <dt className="text-muted-foreground">{providerDisplayName(providerId)}</dt>
              <dd className="mt-1 font-medium">{providerLabel(provider)}</dd>
              <dd className="mt-1 break-all text-[11px] text-muted-foreground">
                {provider?.command ?? "not configured"}
              </dd>
            </div>
          );
        })}
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">GitHub</dt>
          <dd className="mt-1 font-medium">{githubStatus ? `${githubStatus.enabled ? "enabled" : "disabled"} ${githubStatus.status.replaceAll("_", " ")}` : "unknown"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">GitHub repo</dt>
          <dd className="mt-1 break-all font-medium">
            {summary?.github?.owner && summary.github.repo ? `${summary.github.owner}/${summary.github.repo}` : "Not configured"}
          </dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">GitHub token</dt>
          <dd className="mt-1 font-medium">{summary?.github?.tokenConfigured ? "configured" : "not configured"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">GitHub writes</dt>
          <dd className="mt-1 font-medium">{summary?.github ? (summary.github.readOnly || !summary.github.writeEnabled ? "disabled" : "enabled") : "disabled"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Tracker</dt>
          <dd className="mt-1 font-medium">{trackerStatus ? `${trackerStatus.kind} ${trackerStatus.status.replaceAll("_", " ")}` : "unknown"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Tracker endpoint</dt>
          <dd className="mt-1 break-all font-medium">{summary?.endpoint ?? "not configured"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Team/project</dt>
          <dd className="mt-1 font-medium">{trackerScopeSummary(summary)}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Active states</dt>
          <dd className="mt-1 font-medium">{summary?.activeStates.join(", ") ?? "Unavailable"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Terminal states</dt>
          <dd className="mt-1 font-medium">{summary?.terminalStates.join(", ") ?? "Unavailable"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Linear writes</dt>
          <dd className="mt-1 font-medium">{summary ? (summary.readOnly || !summary.writeEnabled ? "disabled" : "enabled") : "Unavailable"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Last sync</dt>
          <dd className="mt-1 font-medium">{trackerStatus?.lastSyncAt ? formatTime(trackerStatus.lastSyncAt) : "Not synced"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Cached issues</dt>
          <dd className="mt-1 font-medium">{trackerStatus?.issueCount ?? 0}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Max agents</dt>
          <dd className="mt-1 font-medium">{summary?.maxConcurrentAgents ?? "Unavailable"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Hook timeout</dt>
          <dd className="mt-1 font-medium">{summary ? `${summary.hookTimeoutMs}ms` : "Unavailable"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Codex command</dt>
          <dd className="mt-1 break-all font-medium">{summary?.codexCommand ?? "codex app-server"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Claude permissions</dt>
          <dd className="mt-1 font-medium">{summary?.providers.claude.permissionMode ?? "default"}</dd>
          <dd className="mt-1 text-[11px] text-muted-foreground">
            allow {summary?.providers.claude.allowedTools.length ?? 0} · deny {summary?.providers.claude.disallowedTools.length ?? 0}
          </dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Cursor force mode</dt>
          <dd className="mt-1 font-medium">{summary?.providers.cursor.force ? "enabled" : "disabled"}</dd>
          <dd className="mt-1 text-[11px] text-muted-foreground">CLI permissions are configured before run start.</dd>
        </div>
      </dl>
      <p className="mt-3 rounded-md border p-2 text-xs text-muted-foreground">
        Codex supports interactive approval requests through app-server. Claude Code and Cursor Agent run as CLI stream providers with pre-run permission configuration.
      </p>
      <RecoveryCleanupPanel
        cleanupConfirm={cleanupConfirm}
        cleanupPlan={cleanupPlan}
        cleanupResult={cleanupResult}
        daemonStatus={daemonStatus}
        executingCleanup={executingCleanup}
        onCleanupConfirmChange={onCleanupConfirmChange}
        onExecuteCleanup={onExecuteCleanup}
        onPlanCleanup={onPlanCleanup}
        onRefreshWorkspaces={onRefreshWorkspaces}
        refreshingWorkspaces={refreshingWorkspaces}
        workspaceInventory={workspaceInventory}
      />
      {workflow?.error && (
        <p role="alert" className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-300">
          {workflow.error}
        </p>
      )}
      {trackerStatus?.error && (
        <p role="alert" className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-300">
          {trackerStatus.error}
        </p>
      )}
      {githubStatus?.error && (
        <p role="alert" className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-300">
          {githubStatus.error}
        </p>
      )}
      {summary?.trackerKind === "linear" && trackerStatus?.status === "invalid_config" && (
        <p className="mt-3 rounded-md border p-2 text-xs text-muted-foreground">
          Set <span className="font-mono">LINEAR_API_KEY</span> in the daemon environment and reload the workflow. The frontend never receives the API key.
        </p>
      )}
    </section>
  );
}

function RecoveryCleanupPanel({
  cleanupConfirm,
  cleanupPlan,
  cleanupResult,
  daemonStatus,
  executingCleanup,
  onCleanupConfirmChange,
  onExecuteCleanup,
  onPlanCleanup,
  onRefreshWorkspaces,
  refreshingWorkspaces,
  workspaceInventory,
}: {
  cleanupConfirm: string;
  cleanupPlan: WorkspaceCleanupPlan | null;
  cleanupResult: WorkspaceCleanupResult | null;
  daemonStatus: DaemonStatus | null;
  executingCleanup: boolean;
  onCleanupConfirmChange: (value: string) => void;
  onExecuteCleanup: () => Promise<void>;
  onPlanCleanup: () => Promise<void>;
  onRefreshWorkspaces: () => Promise<void>;
  refreshingWorkspaces: boolean;
  workspaceInventory: WorkspaceInventory | null;
}) {
  const cleanupEnabled = cleanupPlan?.enabled === true && cleanupPlan.dryRun === false;
  const canExecute = cleanupEnabled && cleanupConfirm === "delete workspaces" && (cleanupPlan?.candidates.length ?? 0) > 0 && !executingCleanup;

  return (
    <section aria-labelledby="recovery-cleanup-heading" className="mt-3 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="recovery-cleanup-heading" className="text-sm font-semibold">
            Recovery and workspace cleanup
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Restart recovery preserves old timelines and marks prior active runs interrupted. Cleanup is preview-first.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onRefreshWorkspaces()}
            disabled={refreshingWorkspaces}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshingWorkspaces && "animate-spin")} />
            Refresh inventory
          </button>
          <button
            type="button"
            onClick={() => void onPlanCleanup()}
            disabled={refreshingWorkspaces}
            className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            Preview cleanup
          </button>
        </div>
      </div>

      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">Recovered runs</dt>
          <dd className="mt-1 font-medium">{daemonStatus?.recoveredRunsCount ?? 0}</dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">Orphaned runs</dt>
          <dd className="mt-1 font-medium">{daemonStatus?.orphanedRunsCount ?? 0}</dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">Workspaces</dt>
          <dd className="mt-1 font-medium">{workspaceInventory?.counts.total ?? 0}</dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">Cleanup candidates</dt>
          <dd className="mt-1 font-medium">{cleanupPlan?.candidates.length ?? workspaceInventory?.counts.candidates ?? 0}</dd>
        </div>
      </dl>

      {cleanupPlan && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <WorkspacePlanList title="Candidates" items={cleanupPlan.candidates} emptyText="No cleanup candidates." />
          <WorkspacePlanList title="Protected" items={cleanupPlan.protected.slice(0, 12)} emptyText="No protected workspaces reported." />
        </div>
      )}

      {cleanupPlan?.warnings.length ? (
        <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          {cleanupPlan.warnings.join(", ").replaceAll("_", " ")}
        </p>
      ) : null}

      <div className="mt-3 rounded-md border p-3">
        <label className="block text-xs font-medium">
          Confirmation text
          <input
            value={cleanupConfirm}
            onChange={(event) => onCleanupConfirmChange(event.target.value)}
            placeholder="delete workspaces"
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => void onExecuteCleanup()}
          disabled={!canExecute}
          className="mt-2 rounded-md border px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300"
        >
          {executingCleanup ? "Cleaning..." : "Execute cleanup"}
        </button>
        <p className="mt-2 text-xs text-muted-foreground">
          Execution stays disabled unless cleanup is enabled, dry-run is false, candidates exist, and the confirmation text matches exactly.
        </p>
      </div>

      {cleanupResult && (
        <p className="mt-3 rounded-md border p-2 text-xs text-muted-foreground">
          Cleanup result: {cleanupResult.deleted.length} deleted, {cleanupResult.skipped.length} skipped, {cleanupResult.errors.length} errors.
        </p>
      )}
    </section>
  );
}

function WorkspacePlanList({
  emptyText,
  items,
  title,
}: {
  emptyText: string;
  items: WorkspaceCleanupPlan["candidates"];
  title: string;
}) {
  return (
    <div className="rounded-md border">
      <h4 className="border-b px-3 py-2 text-xs font-medium">{title}</h4>
      {items.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="max-h-64 divide-y overflow-auto">
          {items.map((item) => (
            <li key={`${title}-${item.workspaceKey}`} className="p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{item.issueIdentifier}</span>
                <span className="text-muted-foreground">{item.sizeBytes === null ? "size unknown" : `${item.sizeBytes} bytes`}</span>
              </div>
              <p className="mt-1 break-all text-muted-foreground">{item.path}</p>
              <p className="mt-1 text-muted-foreground">
                reasons: {item.reasons.length ? item.reasons.join(", ").replaceAll("_", " ") : "none"}
              </p>
              {item.protectionReasons.length > 0 && (
                <p className="mt-1 text-muted-foreground">
                  protected: {item.protectionReasons.join(", ").replaceAll("_", " ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ApprovalCard({
  approval,
  onRespond,
}: {
  approval: ApprovalState;
  onRespond: (approval: ApprovalState, decision: ApprovalDecision) => Promise<void>;
}) {
  const decisions: ApprovalDecision[] =
    approval.availableDecisions.length > 0 ? approval.availableDecisions : ["accept", "decline", "cancel"];

  return (
    <article className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">
          {approval.approvalType.replaceAll("_", " ")} approval
        </h4>
        <span className="text-xs text-muted-foreground">{approval.approvalId}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{approval.reason ?? approval.prompt}</p>
      {approval.command && (
        <pre className="mt-2 overflow-auto rounded-md border bg-background p-2 text-xs">{approval.command}</pre>
      )}
      {approval.cwd && <p className="mt-2 break-all text-xs text-muted-foreground">cwd: {approval.cwd}</p>}
      {approval.fileSummary && <p className="mt-2 break-all text-xs text-muted-foreground">{approval.fileSummary}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        Approvals execute local Codex-requested actions in the workspace. Review commands and file scopes before accepting.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {decisions.map((decision) => (
          <button
            key={decision}
            type="button"
            onClick={() => void onRespond(approval, decision)}
            className="rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            {decisionLabel(decision)}
          </button>
        ))}
      </div>
    </article>
  );
}

function EventBody({ event }: { event: AgentEvent }) {
  if (event.type === "hook.started" || event.type === "hook.succeeded" || event.type === "hook.failed" || event.type === "hook.timed_out") {
    return (
      <div className="mt-2 text-sm leading-6 text-muted-foreground">
        <p className="whitespace-pre-wrap">{event.hook.error ?? event.hook.command ?? event.hook.status}</p>
        {(event.hook.stdout || event.hook.stderr) && (
          <details className="mt-2 rounded-md border bg-background p-2">
            <summary className="cursor-pointer text-xs font-medium text-foreground">Hook output</summary>
            {event.hook.stdout && <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{event.hook.stdout}</pre>}
            {event.hook.stderr && <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-red-600 dark:text-red-300">{event.hook.stderr}</pre>}
          </details>
        )}
      </div>
    );
  }

  if (event.type === "provider.stderr" || event.type === "codex.error" || event.type === "claude.error" || event.type === "cursor.error") {
    return <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-2 text-xs text-red-600 dark:text-red-300">{eventSummary(event)}</pre>;
  }

  if (event.type === "prompt.rendered" || event.type === "artifact" || event.type === "claude.result" || event.type === "cursor.result") {
    return <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-2 text-xs text-muted-foreground">{eventSummary(event)}</pre>;
  }

  return (
    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
      {eventSummary(event)}
    </p>
  );
}

function runStatusClassName(status: RunStatus) {
  switch (status) {
    case "succeeded":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
    case "failed":
    case "timed_out":
    case "stalled":
    case "cancelled":
    case "interrupted":
    case "orphaned":
      return "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300";
    case "recovered":
      return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300";
    case "waiting_for_approval":
      return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300";
    case "streaming":
    case "running":
    case "launching_agent":
    case "building_prompt":
    case "preparing_workspace":
    case "queued":
      return "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300";
    case "idle":
      return "border-border bg-muted/60 text-muted-foreground";
  }
}

function eventLabel(event: AgentEvent) {
  switch (event.type) {
    case "run.status":
      return `Run ${event.status.replaceAll("_", " ")}`;
    case "run.recovered":
      return "Run recovered";
    case "agent.message":
      return `${event.role} message`;
    case "tool.call":
      return `${event.toolName} ${event.status}`;
    case "approval.requested":
      return "Approval requested";
    case "approval.resolved":
      return `Approval ${event.resolution}`;
    case "approval.recovered":
      return "Approval recovered";
    case "usage":
      return "Token usage";
    case "artifact":
      return event.title;
    case "workflow.loaded":
      return "Workflow loaded";
    case "workflow.invalid":
      return "Workflow invalid";
    case "workspace.ready":
      return "Workspace ready";
    case "workspace.cleanup.planned":
      return "Workspace cleanup planned";
    case "workspace.cleanup.started":
      return "Workspace cleanup started";
    case "workspace.cleanup.skipped":
      return "Workspace cleanup skipped";
    case "workspace.cleanup.deleted":
      return "Workspace cleanup deleted";
    case "workspace.cleanup.failed":
      return "Workspace cleanup failed";
    case "workspace.cleanup.completed":
      return "Workspace cleanup completed";
    case "hook.started":
      return `${event.hook.hookName} started`;
    case "hook.succeeded":
      return `${event.hook.hookName} succeeded`;
    case "hook.failed":
      return `${event.hook.hookName} failed`;
    case "hook.timed_out":
      return `${event.hook.hookName} timed out`;
    case "prompt.rendered":
      return "Prompt rendered";
    case "provider.started":
      return `${event.provider} provider started`;
    case "provider.stderr":
      return `${event.provider} stderr`;
    case "tracker.sync":
      return `Tracker sync ${event.status}`;
    case "tracker.reconciled":
      return "Tracker reconciled";
    case "github.health.checked":
      return "GitHub health checked";
    case "github.repo.detected":
      return "Git repository detected";
    case "git.status.checked":
      return "Git status checked";
    case "git.diff.generated":
      return "Git diff generated";
    case "github.pr.found":
      return "GitHub PR found";
    case "github.pr.not_found":
      return "GitHub PR not found";
    case "github.pr.created":
      return "GitHub PR created";
    case "github.pr.files.fetched":
      return "GitHub PR files fetched";
    case "github.status.fetched":
      return "GitHub status fetched";
    case "github.checks.fetched":
      return "GitHub checks fetched";
    case "github.workflow_runs.fetched":
      return "GitHub workflow runs fetched";
    case "github.review_artifacts.refreshed":
      return "Review artifacts refreshed";
    case "github.error":
      return "GitHub error";
    case "integration.write.previewed":
      return "Write previewed";
    case "integration.write.blocked":
      return "Write blocked";
    case "integration.write.confirmation_required":
      return "Write confirmation required";
    case "integration.write.started":
      return "Write started";
    case "integration.write.succeeded":
      return "Write succeeded";
    case "integration.write.failed":
      return "Write failed";
    case "integration.write.cancelled":
      return "Write cancelled";
    case "github.pr.previewed":
      return "GitHub PR previewed";
    case "github.pr.create_failed":
      return "GitHub PR creation failed";
    case "github.branch.push.previewed":
      return "GitHub branch push previewed";
    case "github.branch.push_started":
      return "GitHub branch push started";
    case "github.branch.push_succeeded":
      return "GitHub branch push succeeded";
    case "github.branch.push_failed":
      return "GitHub branch push failed";
    case "linear.comment.previewed":
      return "Linear comment previewed";
    case "linear.comment.created":
      return "Linear comment created";
    case "linear.comment.create_failed":
      return "Linear comment failed";
    case "codex.thread.started":
      return "Codex thread started";
    case "codex.turn.started":
      return "Codex turn started";
    case "codex.turn.completed":
      return `Codex turn ${event.status}`;
    case "codex.item.started":
      return `${event.itemType} started`;
    case "codex.item.completed":
      return `${event.itemType} completed`;
    case "codex.assistant.delta":
      return "Codex assistant delta";
    case "codex.usage":
      return "Codex usage";
    case "codex.error":
      return "Codex error";
    case "claude.system.init":
      return "Claude session initialized";
    case "claude.assistant.message":
      return "Claude assistant message";
    case "claude.user.message":
      return "Claude user message";
    case "claude.tool.use":
      return `Claude ${event.toolName}`;
    case "claude.tool.result":
      return "Claude tool result";
    case "claude.result":
      return event.isError ? "Claude error result" : "Claude result";
    case "claude.usage":
      return "Claude usage";
    case "claude.error":
      return "Claude error";
    case "cursor.system.init":
      return "Cursor session initialized";
    case "cursor.assistant.delta":
      return "Cursor assistant delta";
    case "cursor.assistant.message":
      return "Cursor assistant message";
    case "cursor.tool.call":
      return `Cursor ${event.toolName} ${event.status}`;
    case "cursor.tool.result":
      return "Cursor tool result";
    case "cursor.result":
      return event.isError ? "Cursor error result" : "Cursor result";
    case "cursor.usage":
      return "Cursor usage";
    case "cursor.error":
      return "Cursor error";
  }
}

function eventSummary(event: AgentEvent) {
  switch (event.type) {
    case "run.status":
      return event.error ?? event.message ?? `Status changed to ${event.status.replaceAll("_", " ")}.`;
    case "run.recovered":
      return `${event.previousStatus.replaceAll("_", " ")} -> ${event.newStatus.replaceAll("_", " ")}\nreason: ${event.reason}\nretry available: ${event.retryAvailable ? "yes" : "no"}`;
    case "agent.message":
      return event.message;
    case "tool.call":
      return [event.command, event.output].filter(Boolean).join("\n\n") || event.status;
    case "approval.requested":
      return event.prompt;
    case "approval.resolved":
      return `Approval ${event.approvalId} was ${event.resolution}.`;
    case "approval.recovered":
      return `Approval ${event.approvalId} was marked stale after daemon startup recovery.`;
    case "usage":
      return `${event.totalTokens.toLocaleString()} total tokens (${event.inputTokens.toLocaleString()} in, ${event.outputTokens.toLocaleString()} out).`;
    case "artifact":
      return event.content;
    case "workflow.loaded":
      return `Loaded ${event.workflowPath}.`;
    case "workflow.invalid":
      return `${event.code}: ${event.error}`;
    case "workspace.ready":
      return event.workspace.path;
    case "workspace.cleanup.planned":
      return `${event.plan.candidates.length} candidates, ${event.plan.protected.length} protected.\n${event.plan.warnings.join(", ")}`;
    case "workspace.cleanup.started":
      return event.path;
    case "workspace.cleanup.skipped":
      return `${event.path}\n${event.reason}`;
    case "workspace.cleanup.deleted":
      return `${event.path}\n${event.bytesFreed ?? 0} bytes freed.`;
    case "workspace.cleanup.failed":
      return `${event.path}\n${event.error}`;
    case "workspace.cleanup.completed":
      return `${event.result.deleted.length} deleted, ${event.result.skipped.length} skipped, ${event.result.errors.length} errors.`;
    case "hook.started":
    case "hook.succeeded":
    case "hook.failed":
    case "hook.timed_out":
      return [
        event.hook.command,
        event.hook.stdout,
        event.hook.stderr,
        event.hook.error,
      ]
        .filter(Boolean)
        .join("\n\n");
    case "prompt.rendered":
      return event.prompt;
    case "provider.started":
      return [`pid ${event.pid ?? "unknown"}`, event.command].join("\n");
    case "provider.stderr":
      return event.message;
    case "tracker.sync":
      return event.error ?? event.message ?? `${event.tracker} sync ${event.status}${event.issueCount === undefined ? "" : ` (${event.issueCount} issues)`}.`;
    case "tracker.reconciled":
      return `${event.identifier}: ${event.previousState ?? "unknown"} -> ${event.currentState}\n${event.message}`;
    case "github.health.checked":
      return event.error ?? event.message ?? event.status;
    case "github.repo.detected":
    case "git.status.checked":
      return `${event.git.isGitRepo ? "git repo" : "not a git repo"}\n${event.git.currentBranch ?? "no branch"}\n${event.git.workspacePath}`;
    case "git.diff.generated":
      return `${event.diff.filesChanged} files changed, +${event.diff.additions} -${event.diff.deletions}.`;
    case "github.pr.found":
    case "github.pr.created":
      return `#${event.pr.number} ${event.pr.title}\n${event.pr.url}`;
    case "github.pr.not_found":
      return event.message;
    case "github.pr.files.fetched":
      return `${event.fileCount} PR files fetched.`;
    case "github.status.fetched":
      return `${event.commitStatus.state} (${event.commitStatus.totalCount} statuses).`;
    case "github.checks.fetched":
      return `${event.checkCount} check runs fetched.`;
    case "github.workflow_runs.fetched":
      return `${event.workflowRunCount} workflow runs fetched.`;
    case "github.review_artifacts.refreshed":
      return `${event.snapshot.diff.filesChanged} changed files. Last refreshed ${formatTime(event.snapshot.lastRefreshedAt)}.`;
    case "github.error":
      return `${event.operation}: ${event.message}`;
    case "integration.write.previewed":
    case "integration.write.blocked":
      return `${event.preview.title}\n${event.preview.blockers.length} blockers · ${event.preview.warnings.length} warnings`;
    case "integration.write.confirmation_required":
      return `${event.provider} ${event.kind.replaceAll("_", " ")} requires confirmation.`;
    case "integration.write.started":
      return `${event.provider} ${event.kind.replaceAll("_", " ")} started.`;
    case "integration.write.succeeded":
      return [event.result.externalUrl ?? event.result.externalId, event.result.warnings.join("\n")].filter(Boolean).join("\n");
    case "integration.write.failed":
      return event.error;
    case "integration.write.cancelled":
      return event.reason;
    case "github.pr.previewed":
      return `${event.preview.title}\n${event.preview.headBranch ?? "unknown"} -> ${event.preview.baseBranch}`;
    case "github.pr.create_failed":
      return event.error;
    case "github.branch.push.previewed":
      return `${event.preview.branch}\n${event.preview.blockers.join("\n")}`;
    case "github.branch.push_started":
      return event.branch;
    case "github.branch.push_succeeded":
      return `${event.branch}\n${shortSha(event.headSha)}`;
    case "github.branch.push_failed":
      return `${event.branch ?? "unknown branch"}\n${event.error}`;
    case "linear.comment.previewed":
      return `${event.preview.issueIdentifier}\n${event.preview.body}`;
    case "linear.comment.created":
      return `${event.result.id}\n${event.result.url ?? "No URL returned"}`;
    case "linear.comment.create_failed":
      return event.error;
    case "codex.thread.started":
      return [`thread ${event.threadId}`, event.model ? `model ${event.model}` : null, event.cwd ? `cwd ${event.cwd}` : null]
        .filter(Boolean)
        .join("\n");
    case "codex.turn.started":
      return `${event.threadId} / ${event.turnId}\n${event.status}`;
    case "codex.turn.completed":
      return [event.threadId, event.turnId, event.status, event.error].filter(Boolean).join("\n");
    case "codex.item.started":
    case "codex.item.completed":
      return event.summary;
    case "codex.assistant.delta":
      return event.delta;
    case "codex.usage":
      return `${event.totalTokens.toLocaleString()} total tokens (${event.inputTokens.toLocaleString()} in, ${event.outputTokens.toLocaleString()} out).`;
    case "codex.error":
      return event.message;
    case "claude.system.init":
      return [`session ${event.sessionId ?? "unknown"}`, event.model ? `model ${event.model}` : null, event.permissionMode ? `permission ${event.permissionMode}` : null, event.cwd ? `cwd ${event.cwd}` : null]
        .filter(Boolean)
        .join("\n");
    case "claude.assistant.message":
    case "claude.user.message":
      return event.message;
    case "claude.tool.use":
      return [event.toolUseId ? `tool id ${event.toolUseId}` : null, event.input].filter(Boolean).join("\n");
    case "claude.tool.result":
      return [event.toolUseId ? `tool id ${event.toolUseId}` : null, event.status, event.content].filter(Boolean).join("\n");
    case "claude.result":
      return [
        event.result,
        event.numTurns === null ? null : `${event.numTurns} turns`,
        event.durationMs === null ? null : `${event.durationMs}ms`,
        event.totalCostUsd === null ? null : `$${event.totalCostUsd.toFixed(4)}`,
      ]
        .filter(Boolean)
        .join("\n");
    case "claude.usage":
      return `${event.totalTokens?.toLocaleString() ?? "unknown"} total tokens (${event.inputTokens?.toLocaleString() ?? "unknown"} in, ${event.outputTokens?.toLocaleString() ?? "unknown"} out).`;
    case "claude.error":
      return event.message;
    case "cursor.system.init":
      return [`session ${event.sessionId ?? "unknown"}`, event.requestId ? `request ${event.requestId}` : null, event.model ? `model ${event.model}` : null, event.apiKeySource ? `auth ${event.apiKeySource}` : null, event.cwd ? `cwd ${event.cwd}` : null]
        .filter(Boolean)
        .join("\n");
    case "cursor.assistant.delta":
      return event.delta;
    case "cursor.assistant.message":
      return event.message;
    case "cursor.tool.call":
      return [event.callId ? `call ${event.callId}` : null, event.status, event.input].filter(Boolean).join("\n");
    case "cursor.tool.result":
      return [event.callId ? `call ${event.callId}` : null, event.status, event.content].filter(Boolean).join("\n");
    case "cursor.result":
      return [
        event.result,
        event.durationMs === null ? null : `${event.durationMs}ms`,
        event.durationApiMs === null ? null : `${event.durationApiMs}ms API`,
      ]
        .filter(Boolean)
        .join("\n");
    case "cursor.usage":
      return `${event.totalTokens?.toLocaleString() ?? "unknown"} total tokens (${event.inputTokens?.toLocaleString() ?? "unknown"} in, ${event.outputTokens?.toLocaleString() ?? "unknown"} out).`;
    case "cursor.error":
      return event.message;
  }
}

function approvalStateFromEvent(event: Extract<AgentEvent, { type: "approval.requested" }>): ApprovalState {
  return {
    approvalId: event.approvalId,
    runId: event.runId,
    provider: "codex",
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
    availableDecisions: event.availableDecisions ?? ["accept", "decline", "cancel"],
    decision: null,
    requestedAt: event.timestamp,
    resolvedAt: null,
  };
}

function providerLabel(provider?: ProviderHealth) {
  if (!provider) return "unknown";
  if (provider.status === "disabled" || provider.enabled === false) return "disabled";
  return provider.available ? "available" : "unavailable";
}

function providerDisplayName(provider: ProviderId) {
  switch (provider) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude Code";
    case "cursor":
      return "Cursor Agent";
  }
}

function trackerScopeSummary(summary: WorkflowStatus["effectiveConfigSummary"] | undefined) {
  if (!summary) return "Unavailable";
  const scopes = [
    summary.teamKey ? `team ${summary.teamKey}` : null,
    summary.teamId ? `team id ${summary.teamId}` : null,
    summary.projectSlug ? `project ${summary.projectSlug}` : null,
    summary.projectId ? `project id ${summary.projectId}` : null,
    summary.allowWorkspaceWide ? "workspace-wide" : null,
  ].filter(Boolean);
  return scopes.join(", ") || "scope missing";
}

function decisionLabel(decision: ApprovalDecision) {
  switch (decision) {
    case "accept":
      return "Accept";
    case "acceptForSession":
      return "Accept for session";
    case "decline":
      return "Decline";
    case "cancel":
      return "Cancel";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
  }
}

function extractCodexMetadata(events: AgentEvent[]): { threadId: string | null; turnId: string | null } {
  let threadId: string | null = null;
  let turnId: string | null = null;
  for (const event of events) {
    if (event.type === "codex.thread.started") threadId = event.threadId;
    if (event.type === "codex.turn.started" || event.type === "codex.turn.completed" || event.type === "codex.assistant.delta") {
      threadId = event.threadId;
      turnId = event.turnId;
    }
  }
  return { threadId, turnId };
}

function extractProviderMetadata(
  events: AgentEvent[],
  provider: ProviderId,
): { primary: string | null; secondary: string } {
  if (provider === "codex") {
    const codex = extractCodexMetadata(events);
    return {
      primary: codex.threadId ? `${codex.threadId}${codex.turnId ? ` / ${codex.turnId}` : ""}` : null,
      secondary: "Codex app-server approvals can appear live during a turn.",
    };
  }

  if (provider === "claude") {
    const init = findLastEvent(events, "claude.system.init");
    const result = findLastEvent(events, "claude.result");
    const sessionId = init?.type === "claude.system.init" ? init.sessionId : result?.type === "claude.result" ? result.sessionId : null;
    const model = init?.type === "claude.system.init" ? init.model : result?.type === "claude.result" ? result.model : null;
    const resultDetails =
      result?.type === "claude.result"
        ? [result.numTurns === null ? null : `${result.numTurns} turns`, result.durationMs === null ? null : `${result.durationMs}ms`, result.totalCostUsd === null ? null : `$${result.totalCostUsd.toFixed(4)}`]
            .filter(Boolean)
            .join(" · ")
        : "CLI permissions are configured before run start.";
    return {
      primary: sessionId,
      secondary: [model, resultDetails].filter(Boolean).join(" · "),
    };
  }

  if (provider === "cursor") {
    const init = findLastEvent(events, "cursor.system.init");
    const result = findLastEvent(events, "cursor.result");
    const sessionId = init?.type === "cursor.system.init" ? init.sessionId : result?.type === "cursor.result" ? result.sessionId : null;
    const requestId = init?.type === "cursor.system.init" ? init.requestId : result?.type === "cursor.result" ? result.requestId : null;
    const model = init?.type === "cursor.system.init" ? init.model : result?.type === "cursor.result" ? result.model : null;
    const resultDetails =
      result?.type === "cursor.result"
        ? [result.durationMs === null ? null : `${result.durationMs}ms`, result.durationApiMs === null ? null : `${result.durationApiMs}ms API`]
            .filter(Boolean)
            .join(" · ")
        : "CLI permissions are configured before run start.";
    return {
      primary: [sessionId, requestId].filter(Boolean).join(" / ") || null,
      secondary: [model, resultDetails].filter(Boolean).join(" · "),
    };
  }

  return { primary: null, secondary: "Provider metadata is unavailable for this run." };
}

function findLastEvent<T extends AgentEvent["type"]>(events: AgentEvent[], type: T): Extract<AgentEvent, { type: T }> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === type) return event as Extract<AgentEvent, { type: T }>;
  }
  return null;
}

function shortSha(sha: string | null | undefined) {
  return sha ? sha.slice(0, 7) : "unknown";
}

function clientDiffSummary(diff: ReviewArtifactSnapshot["diff"]): string {
  const files = diff.files.slice(0, 5).map((file) => file.path);
  const remaining = Math.max(0, diff.filesChanged - files.length);
  const fileList = files.length > 0 ? `: ${files.join(", ")}${remaining > 0 ? `, and ${remaining} more` : ""}` : "";
  return `${diff.filesChanged} changed ${diff.filesChanged === 1 ? "file" : "files"}, +${diff.additions} -${diff.deletions}${fileList}.`;
}

function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function canRunWithCodex(issue: Issue, status: ConnectedGoldenPathStatus | null): boolean {
  if (issue.latestRun && !isTerminalRunStatus(issue.latestRun.status)) return false;
  if (!status) return false;
  return (
    status.board.status === "ready" &&
    status.workspace.status === "ready" &&
    status.linear.status === "ready" &&
    status.github.status === "ready" &&
    status.provider.kind === "codex" &&
    status.provider.status === "ready"
  );
}

function mapDaemonIssues(issues: DaemonIssue[], runs: Run[]): Issue[] {
  const latestRunByIssue = new Map<string, Run>();
  for (const run of runs) {
    const existing = latestRunByIssue.get(run.issueId);
    if (!existing || (run.startedAt ?? "").localeCompare(existing.startedAt ?? "") > 0) {
      latestRunByIssue.set(run.issueId, run);
    }
  }

  return issues.map((issue, index) => {
    const labels = issue.labels.map((label, labelIndex) => ({
      id: `${issue.id}-${label}`,
      name: label,
      color: labelColorPalette[(index + labelIndex) % labelColorPalette.length] ?? "text-sky-500",
    }));

    return {
      id: issue.id,
      key: issue.identifier,
      title: issue.title,
      description: issue.description,
      status: issue.state,
      iconStatus: iconStatusForState(issue.state),
      priority: priorityForIssue(issue.priority),
      sourcePriority: issue.priority,
      assignee: userFromIssue(issue) ?? undefined,
      labels,
      team: issue.tracker?.teamKey ?? issue.identifier.split("-")[0] ?? "SYM",
      url: issue.url,
      trackerKind: issue.tracker?.kind ?? "linear",
      projectName: issue.tracker?.projectName ?? null,
      lastFetchedAt: issue.lastFetchedAt ?? null,
      latestRun: latestRunByIssue.get(issue.id),
    };
  });
}

function priorityForIssue(priority: DaemonIssue["priority"]): Priority {
  switch (priority) {
    case "Urgent":
      return "urgent";
    case "High":
      return "high";
    case "Medium":
      return "medium";
    case "Low":
      return "low";
    case "No priority":
      return "no-priority";
  }
}

function iconStatusForState(state: IssueState): Issue["iconStatus"] {
  switch (state.toLowerCase()) {
    case "todo":
      return "todo";
    case "in progress":
    case "started":
      return "in-progress";
    case "human review":
    case "review":
      return "in-review";
    case "done":
    case "closed":
    case "completed":
      return "done";
    case "cancelled":
    case "canceled":
    case "duplicate":
      return "cancelled";
    case "rework":
    case "backlog":
      return "backlog";
    default:
      return "todo";
  }
}
