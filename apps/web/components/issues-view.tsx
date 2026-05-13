import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PRIORITY_LABELS,
  labels as mockLabels,
  users,
  type Priority,
  type User,
} from "@/data/mock";
import { IssueStatusIcon } from "@/components/icons/issue-status-icons";
import { PriorityIcon } from "@/components/icons/status-icons";
import { UserAvatar } from "@/components/avatar-stack";
import { cn } from "@/lib/utils";
import { ExternalLink, Filter, Plus, RefreshCw, SlidersHorizontal, LayoutGrid, List, X } from "lucide-react";
import {
  DAEMON_URL,
  getIssues,
  getProviders,
  getRunApprovals,
  getRunEvents,
  getRunPrompt,
  getRuns,
  getTrackerStatus,
  getWorkspace,
  getWorkflowStatus,
  refreshIssues,
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
  isTerminalRunStatus,
  type AgentEvent,
  type Issue as DaemonIssue,
  type IssuePriority,
  type IssueState,
  type ProviderHealth,
  type ProviderId,
  type Run,
  type RunStatus,
  type TrackerStatus,
  type WorkflowStatus,
  type WorkspaceInfo,
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
  issue,
  selected,
  onSelect,
}: {
  issue: Issue;
  selected: boolean;
  onSelect: (issue: Issue) => void;
}) {
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
      {issue.trackerKind === "linear" && (
        <a
          href={issue.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
          aria-label={`Open ${issue.key} in Linear`}
        >
          Linear <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </article>
  );
}

function IssueRow({
  issue,
  selected,
  onSelect,
}: {
  issue: Issue;
  selected: boolean;
  onSelect: (issue: Issue) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(issue)}
      aria-label={`Open run details for ${issue.key}: ${issue.title}`}
      aria-pressed={selected}
      className={cn(
        "grid w-full grid-cols-[1.5rem_4.5rem_1fr_auto] items-center gap-3 px-4 py-2 border-b last:border-b-0 hover:bg-muted/40 cursor-pointer text-left",
        selected && "bg-muted/50",
      )}
    >
      <IssueStatusIcon status={issue.iconStatus} />
      <span className="text-[11px] tabular-nums text-muted-foreground">{issue.key}</span>
      <div className="min-w-0 flex items-center gap-2">
        <PriorityIcon priority={issue.priority} />
        <span className="text-sm truncate">{issue.title}</span>
      </div>
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
    </button>
  );
}

const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low", "no-priority"];

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
  const [selectedApprovals, setSelectedApprovals] = useState<ApprovalState[]>([]);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("mock");
  const [workflow, setWorkflow] = useState<WorkflowStatus | null>(null);
  const [trackerStatus, setTrackerStatus] = useState<TrackerStatus | null>(null);
  const [refreshingIssues, setRefreshingIssues] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
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

      const source = new EventSource(`${DAEMON_URL}/runs/${runId}/events/stream`);
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
      };
      sourcesRef.current.set(runId, source);
    },
    [appendEvent],
  );

  useEffect(() => {
    let alive = true;
    const sources = sourcesRef.current;

    async function loadIssues() {
      const [loadedIssues, loadedRuns, loadedProviders, loadedWorkflow] = await Promise.all([
        getIssues(),
        getRuns(),
        getProviders(),
        getWorkflowStatus(),
      ]);
      const loadedTrackerStatus = await getTrackerStatus();
      if (!alive) return;
      setAllIssues(mapDaemonIssues(loadedIssues, loadedRuns));
      setProviders(loadedProviders);
      setWorkflow(loadedWorkflow);
      setTrackerStatus(loadedTrackerStatus);
      const defaultProvider = loadedWorkflow.effectiveConfigSummary?.defaultProvider;
      if (defaultProvider === "mock" || defaultProvider === "codex") {
        setSelectedProvider((current) => current ?? defaultProvider);
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
      setSelectedApprovals([]);
      return;
    }

    setDetailError(null);
    void Promise.all([
      getRunEvents(selectedRunId),
      getRunPrompt(selectedRunId),
      selectedIssueKey ? getWorkspace(selectedIssueKey) : Promise.resolve(null),
      getRunApprovals(selectedRunId),
    ])
      .then(([events, prompt, workspace, approvals]) => {
        setSelectedEvents(events);
        setSelectedPrompt(prompt);
        setSelectedWorkspace(workspace);
        setSelectedApprovals(approvals);
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
    setSelectedApprovals([]);
    setDetailError(null);
  }, []);

  const closeDetails = useCallback(() => {
    setSelectedIssueId(null);
    setSelectedRunId(null);
    setSelectedEvents([]);
    setSelectedPrompt(null);
    setSelectedWorkspace(null);
    setSelectedApprovals([]);
    setDetailError(null);
  }, []);

  const handleStart = useCallback(
    async (issue: Issue) => {
      try {
        setDetailError(null);
        const run = await startRun(issue.id, selectedProvider);
        updateIssueRun(run);
        setSelectedIssueId(issue.id);
        setSelectedRunId(run.id);
        setSelectedEvents([]);
        setSelectedPrompt(null);
        setSelectedWorkspace(null);
        setSelectedApprovals([]);
        subscribeRun(run.id);
      } catch (caught) {
        setDetailError(caught instanceof Error ? caught.message : "Failed to start run.");
      }
    },
    [selectedProvider, subscribeRun, updateIssueRun],
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
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Failed to reload workflow.");
    }
  }, []);

  const handleRefreshIssues = useCallback(async () => {
    try {
      setRefreshingIssues(true);
      setDetailError(null);
      const [loadedIssues, loadedRuns] = await Promise.all([refreshIssues(), getRuns()]);
      setAllIssues(mapDaemonIssues(loadedIssues, loadedRuns));
      setTrackerStatus(await getTrackerStatus());
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Failed to refresh issues.");
      setTrackerStatus(await getTrackerStatus().catch(() => null));
    } finally {
      setRefreshingIssues(false);
    }
  }, []);

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

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">Issues</span>
          <span className="text-muted-foreground tabular-nums">{filtered.length}</span>
          <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", workflowStatusClass(workflow?.status))}>
            Workflow {workflow?.status ?? "unknown"}
          </span>
          <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", trackerStatusClass(trackerStatus?.status))}>
            Tracker {trackerStatus ? `${trackerStatus.kind} ${trackerStatus.status.replaceAll("_", " ")}` : "unknown"}
          </span>
          <span className="rounded-full border px-2 py-0.5 text-[11px]">
            Codex {providerLabel(providers.find((provider) => provider.id === "codex"))}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <label className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            Provider
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value as ProviderId)}
              className="rounded-md border bg-background px-2 py-1 text-[12px] text-foreground"
              aria-label="Provider mode"
            >
              <option value="mock">Mock</option>
              <option value="codex">Codex</option>
            </select>
          </label>
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
          <button className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-2 py-1 text-[12px] hover:opacity-90">
            <Plus className="h-3.5 w-3.5" /> New issue
          </button>
        </div>
      </header>

      {workflowOpen && (
        <WorkflowPanel
          onReload={handleWorkflowReload}
          providers={providers}
          trackerStatus={trackerStatus}
          workflow={workflow}
        />
      )}

      {selectedIssue && (
        <RunDetailsCard
          approvals={selectedApprovals}
          error={detailError}
          events={selectedEvents}
          issue={selectedIssue}
          onClose={closeDetails}
          onRespondApproval={handleApprovalResponse}
          onRetry={handleRetry}
          onStart={handleStart}
          onStop={handleStop}
          prompt={selectedPrompt}
          run={selectedRun}
          selectedProvider={selectedProvider}
          workspace={selectedWorkspace}
        />
      )}

      {view === "board" ? (
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
                  <button className="ml-auto grid h-5 w-5 place-items-center rounded hover:bg-background text-muted-foreground">
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex flex-col gap-2 p-2">
                  {(grouped[s] ?? []).map((i) => (
                    <IssueCard key={i.id} issue={i} selected={i.id === selectedIssueId} onSelect={selectIssue} />
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
                  <IssueRow key={i.id} issue={i} selected={i.id === selectedIssueId} onSelect={selectIssue} />
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
  approvals,
  error,
  events,
  issue,
  onClose,
  onRespondApproval,
  onRetry,
  onStart,
  onStop,
  prompt,
  run,
  selectedProvider,
  workspace,
}: {
  approvals: ApprovalState[];
  error: string | null;
  events: AgentEvent[];
  issue: Issue;
  onClose: () => void;
  onRespondApproval: (approval: ApprovalState, decision: ApprovalDecision) => Promise<void>;
  onRetry: (run: Run) => Promise<void>;
  onStart: (issue: Issue) => Promise<void>;
  onStop: (run: Run) => Promise<void>;
  prompt: string | null;
  run?: Run | null;
  selectedProvider: ProviderId;
  workspace: WorkspaceInfo | null;
}) {
  const running = run ? !isTerminalRunStatus(run.status) : false;
  const retryable = run?.status === "failed" || run?.status === "cancelled" || run?.status === "timed_out";
  const codexMetadata = extractCodexMetadata(events);
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
              <dd className="mt-1 font-medium">{run ? `${run.provider} ${run.status.replaceAll("_", " ")}` : `Ready with ${selectedProvider}`}</dd>
            </div>
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
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            {running && run ? (
              <button
                type="button"
                onClick={() => void onStop(run)}
                className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-500/10 dark:text-red-300"
              >
                {run.provider === "codex" ? "Interrupt Codex" : "Stop run"}
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
                Start {selectedProvider === "codex" ? "Codex" : "mock"} run
              </button>
            )}
          </div>

          {error && (
            <p role="alert" className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          )}

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

function WorkflowPanel({
  onReload,
  providers,
  trackerStatus,
  workflow,
}: {
  onReload: () => Promise<void>;
  providers: ProviderHealth[];
  trackerStatus: TrackerStatus | null;
  workflow: WorkflowStatus | null;
}) {
  const summary = workflow?.effectiveConfigSummary;
  const codex = providers.find((provider) => provider.id === "codex");

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
          <dd className="mt-1 font-medium">{summary?.defaultProvider ?? "mock"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Workspace root</dt>
          <dd className="mt-1 break-all font-medium">{summary?.workspaceRoot ?? "Unavailable"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Codex</dt>
          <dd className="mt-1 font-medium">{codex ? providerLabel(codex) : "unknown"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Tracker</dt>
          <dd className="mt-1 font-medium">{trackerStatus ? `${trackerStatus.kind} ${trackerStatus.status.replaceAll("_", " ")}` : "unknown"}</dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-muted-foreground">Tracker endpoint</dt>
          <dd className="mt-1 break-all font-medium">{summary?.endpoint ?? "local mock"}</dd>
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
      </dl>
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
      {summary?.trackerKind === "linear" && trackerStatus?.status === "invalid_config" && (
        <p className="mt-3 rounded-md border p-2 text-xs text-muted-foreground">
          Set <span className="font-mono">LINEAR_API_KEY</span> in the daemon environment and reload the workflow. The frontend never receives the API key.
        </p>
      )}
    </section>
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

  if (event.type === "provider.stderr" || event.type === "codex.error") {
    return <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-2 text-xs text-red-600 dark:text-red-300">{eventSummary(event)}</pre>;
  }

  if (event.type === "prompt.rendered" || event.type === "artifact") {
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
      return "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300";
    case "waiting_for_approval":
      return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300";
    case "streaming":
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
    case "agent.message":
      return `${event.role} message`;
    case "tool.call":
      return `${event.toolName} ${event.status}`;
    case "approval.requested":
      return "Approval requested";
    case "approval.resolved":
      return `Approval ${event.resolution}`;
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
  }
}

function eventSummary(event: AgentEvent) {
  switch (event.type) {
    case "run.status":
      return event.error ?? event.message ?? `Status changed to ${event.status.replaceAll("_", " ")}.`;
    case "agent.message":
      return event.message;
    case "tool.call":
      return [event.command, event.output].filter(Boolean).join("\n\n") || event.status;
    case "approval.requested":
      return event.prompt;
    case "approval.resolved":
      return `Approval ${event.approvalId} was ${event.resolution}.`;
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
  return provider.available ? "available" : "unavailable";
}

function workflowStatusClass(status?: WorkflowStatus["status"]) {
  switch (status) {
    case "healthy":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
    case "invalid":
    case "missing":
      return "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300";
    default:
      return "border-border bg-muted/60 text-muted-foreground";
  }
}

function trackerStatusClass(status?: TrackerStatus["status"]) {
  switch (status) {
    case "healthy":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
    case "stale":
    case "unknown":
      return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300";
    case "invalid_config":
    case "unavailable":
      return "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300";
    default:
      return "border-border bg-muted/60 text-muted-foreground";
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
  return scopes.join(", ") || "local mock";
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

function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
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
      color: mockLabels[(index + labelIndex) % mockLabels.length]?.color ?? "text-sky-500",
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
      assignee: users[index % users.length],
      labels,
      team: issue.tracker?.teamKey ?? issue.identifier.split("-")[0] ?? "SYM",
      url: issue.url,
      trackerKind: issue.tracker?.kind ?? "mock",
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
