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
import { Filter, Plus, SlidersHorizontal, LayoutGrid, List, X } from "lucide-react";
import { DAEMON_URL, getIssues, getRunEvents, getRuns, retryRun, startRun, stopRun } from "@/lib/api";
import {
  AgentEventSchema,
  isTerminalRunStatus,
  type AgentEvent,
  type Issue as DaemonIssue,
  type IssuePriority,
  type IssueState,
  type Run,
  type RunStatus,
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
  latestRun?: Run;
};

const ISSUE_STATUS_ORDER: IssueState[] = ["Todo", "In Progress", "Human Review", "Rework", "Done"];

const ISSUE_STATUS_LABELS: Record<IssueState, string> = {
  Todo: "Todo",
  "In Progress": "In Progress",
  "Human Review": "Human Review",
  Rework: "Rework",
  Done: "Done",
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
    <button
      type="button"
      onClick={() => onSelect(issue)}
      aria-label={`Open run details for ${issue.key}: ${issue.title}`}
      aria-pressed={selected}
      className={cn(
        "w-full rounded-md border bg-card p-2.5 text-left text-card-foreground shadow-sm transition-colors cursor-pointer",
        selected ? "border-foreground/40" : "hover:border-foreground/20",
      )}
    >
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
        <PriorityIcon priority={issue.priority} />
        <span>{issue.key}</span>
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
        <span className="text-[10px] text-muted-foreground">{issue.team}</span>
        {issue.assignee && <UserAvatar user={issue.assignee} size={18} />}
      </div>
    </button>
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
  const [detailError, setDetailError] = useState<string | null>(null);
  const sourcesRef = useRef<Map<string, EventSource>>(new Map());
  const selectedRunIdRef = useRef<string | null>(null);

  const selectedIssue = useMemo(
    () => allIssues.find((issue) => issue.id === selectedIssueId) ?? null,
    [allIssues, selectedIssueId],
  );

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
      const [loadedIssues, loadedRuns] = await Promise.all([getIssues(), getRuns()]);
      if (!alive) return;
      setAllIssues(mapDaemonIssues(loadedIssues, loadedRuns));
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
      return;
    }

    setDetailError(null);
    void getRunEvents(selectedRunId)
      .then(setSelectedEvents)
      .catch((caught) => {
        setDetailError(caught instanceof Error ? caught.message : "Failed to load run events.");
      });
    subscribeRun(selectedRunId);
  }, [selectedRunId, subscribeRun]);

  const selectIssue = useCallback((issue: Issue) => {
    setSelectedIssueId(issue.id);
    setSelectedRunId(issue.latestRun?.id ?? null);
    setSelectedEvents([]);
    setDetailError(null);
  }, []);

  const closeDetails = useCallback(() => {
    setSelectedIssueId(null);
    setSelectedRunId(null);
    setSelectedEvents([]);
    setDetailError(null);
  }, []);

  const handleStart = useCallback(
    async (issue: Issue) => {
      try {
        setDetailError(null);
        const run = await startRun(issue.id);
        updateIssueRun(run);
        setSelectedIssueId(issue.id);
        setSelectedRunId(run.id);
        setSelectedEvents([]);
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
        subscribeRun(nextRun.id);
      } catch (caught) {
        setDetailError(caught instanceof Error ? caught.message : "Failed to retry run.");
      }
    },
    [subscribeRun, updateIssueRun],
  );

  const filtered = useMemo(
    () =>
      allIssues.filter(
        (i) =>
          (team === "all" || i.team === team) && (priority === "all" || i.priority === priority),
      ),
    [allIssues, team, priority],
  );

  const grouped = useMemo(() => {
    const m = {} as Record<IssueState, Issue[]>;
    for (const s of ISSUE_STATUS_ORDER) m[s] = [];
    for (const i of filtered) m[i.status].push(i);
    return m;
  }, [filtered]);

  const teamOptions = useMemo(() => ["all", ...Array.from(new Set(allIssues.map((i) => i.team))).sort()], [allIssues]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">Issues</span>
          <span className="text-muted-foreground tabular-nums">{filtered.length}</span>
        </div>
        <div className="flex items-center gap-1">
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

      {selectedIssue && (
        <RunDetailsCard
          error={detailError}
          events={selectedEvents}
          issue={selectedIssue}
          onClose={closeDetails}
          onRetry={handleRetry}
          onStart={handleStart}
          onStop={handleStop}
          run={selectedRun}
        />
      )}

      {view === "board" ? (
        <div className="flex-1 overflow-auto">
          <div className="flex min-w-max gap-3 p-3">
            {ISSUE_STATUS_ORDER.map((s) => (
              <div
                key={s}
                className="flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30"
              >
                <div className="flex items-center gap-2 px-3 py-2 border-b">
                  <IssueStatusIcon status={iconStatusForState(s)} />
                  <span className="text-sm font-medium">{ISSUE_STATUS_LABELS[s]}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {grouped[s].length}
                  </span>
                  <button className="ml-auto grid h-5 w-5 place-items-center rounded hover:bg-background text-muted-foreground">
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex flex-col gap-2 p-2">
                  {grouped[s].map((i) => (
                    <IssueCard key={i.id} issue={i} selected={i.id === selectedIssueId} onSelect={selectIssue} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {ISSUE_STATUS_ORDER.map((s) =>
            grouped[s].length === 0 ? null : (
              <section key={s} className="border-b last:border-b-0">
                <div className="flex items-center gap-2 px-4 py-2 bg-muted/30">
                  <IssueStatusIcon status={iconStatusForState(s)} />
                  <span className="text-sm font-medium">{ISSUE_STATUS_LABELS[s]}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {grouped[s].length}
                  </span>
                </div>
                {grouped[s].map((i) => (
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
  error,
  events,
  issue,
  onClose,
  onRetry,
  onStart,
  onStop,
  run,
}: {
  error: string | null;
  events: AgentEvent[];
  issue: Issue;
  onClose: () => void;
  onRetry: (run: Run) => Promise<void>;
  onStart: (issue: Issue) => Promise<void>;
  onStop: (run: Run) => Promise<void>;
  run?: Run | null;
}) {
  const running = run ? !isTerminalRunStatus(run.status) : false;
  const retryable = run?.status === "failed" || run?.status === "cancelled" || run?.status === "timed_out";

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
              <dt className="text-muted-foreground">Latest run</dt>
              <dd className="mt-1 font-medium">{run ? run.status.replaceAll("_", " ") : "No run yet"}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            {running && run ? (
              <button
                type="button"
                onClick={() => void onStop(run)}
                className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-500/10 dark:text-red-300"
              >
                Stop run
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
                Start run
              </button>
            )}
          </div>

          {error && (
            <p role="alert" className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          )}

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
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {eventSummary(event)}
                    </p>
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
  }
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
      team: issue.identifier.split("-")[0] ?? "SYM",
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
  switch (state) {
    case "Todo":
      return "todo";
    case "In Progress":
      return "in-progress";
    case "Human Review":
      return "in-review";
    case "Done":
      return "done";
    case "Rework":
      return "backlog";
  }
}
