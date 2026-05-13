"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgentEvent,
  AgentEventSchema,
  Issue,
  IssueState,
  isTerminalRunStatus,
  Run,
  RunStatus,
} from "@symphonia/types";
import { DAEMON_URL, getHealth, getIssues, getRunEvents, getRuns, retryRun, startRun, stopRun } from "@/lib/api";

const states: IssueState[] = ["Todo", "In Progress", "Human Review", "Rework", "Done"];

export default function BoardPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [eventsByRun, setEventsByRun] = useState<Record<string, AgentEvent[]>>({});
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [daemonHealthy, setDaemonHealthy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourcesRef = useRef<Map<string, EventSource>>(new Map());

  const latestRunByIssue = useMemo(() => {
    const latest = new Map<string, Run>();
    for (const run of runs) {
      const existing = latest.get(run.issueId);
      if (!existing || (run.startedAt ?? "").localeCompare(existing.startedAt ?? "") > 0) {
        latest.set(run.issueId, run);
      }
    }
    return latest;
  }, [runs]);

  const selectedIssue = useMemo(
    () => issues.find((issue) => issue.id === selectedIssueId) ?? null,
    [issues, selectedIssueId],
  );

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

  const selectedEvents = selectedRunId ? (eventsByRun[selectedRunId] ?? []) : [];

  const upsertRun = useCallback((run: Run) => {
    setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
  }, []);

  const appendEvent = useCallback((event: AgentEvent) => {
    setEventsByRun((current) => {
      const existing = current[event.runId] ?? [];
      if (existing.some((item) => item.id === event.id)) return current;
      return { ...current, [event.runId]: [...existing, event] };
    });

    if (event.type === "run.status") {
      setRuns((current) =>
        current.map((run) =>
          run.id === event.runId
            ? {
                ...run,
                status: event.status,
                endedAt: isTerminalRunStatus(event.status) ? event.timestamp : run.endedAt,
                error: event.error ?? (event.status === "failed" ? run.error : null),
              }
            : run,
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

  const refreshHealth = useCallback(async () => {
    setDaemonHealthy(await getHealth());
  }, []);

  const loadInitialData = useCallback(async () => {
    try {
      setError(null);
      const [health, loadedIssues, loadedRuns] = await Promise.all([getHealth(), getIssues(), getRuns()]);
      setDaemonHealthy(health);
      setIssues(loadedIssues);
      setRuns(loadedRuns);
      for (const run of loadedRuns) {
        if (!isTerminalRunStatus(run.status)) subscribeRun(run.id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load board.");
      setDaemonHealthy(false);
    }
  }, [subscribeRun]);

  useEffect(() => {
    void loadInitialData();
    const sources = sourcesRef.current;
    const interval = setInterval(() => {
      void refreshHealth();
    }, 5000);

    return () => {
      clearInterval(interval);
      for (const source of sources.values()) source.close();
      sources.clear();
    };
  }, [loadInitialData, refreshHealth]);

  useEffect(() => {
    if (!selectedRunId) return;

    void getRunEvents(selectedRunId)
      .then((events) => {
        setEventsByRun((current) => ({ ...current, [selectedRunId]: events }));
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Failed to load run events.");
      });

    subscribeRun(selectedRunId);
  }, [selectedRunId, subscribeRun]);

  const selectIssue = useCallback(
    (issue: Issue) => {
      const latestRun = latestRunByIssue.get(issue.id);
      setSelectedIssueId(issue.id);
      setSelectedRunId(latestRun?.id ?? null);
    },
    [latestRunByIssue],
  );

  const handleStart = useCallback(
    async (issue: Issue) => {
      try {
        setError(null);
        const run = await startRun(issue.id);
        upsertRun(run);
        setSelectedIssueId(issue.id);
        setSelectedRunId(run.id);
        subscribeRun(run.id);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Failed to start run.");
      }
    },
    [subscribeRun, upsertRun],
  );

  const handleStop = useCallback(
    async (run: Run) => {
      try {
        setError(null);
        upsertRun(await stopRun(run.id));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Failed to stop run.");
      }
    },
    [upsertRun],
  );

  const handleRetry = useCallback(
    async (run: Run) => {
      try {
        setError(null);
        const nextRun = await retryRun(run.id);
        upsertRun(nextRun);
        setSelectedRunId(nextRun.id);
        subscribeRun(nextRun.id);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Failed to retry run.");
      }
    },
    [subscribeRun, upsertRun],
  );

  return (
    <main className="min-h-screen text-zinc-100">
      <header className="border-b border-white/10 bg-black/25 px-6 py-4 backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-200">Local prototype</p>
            <h1 className="text-2xl font-semibold tracking-normal">Symphonia</h1>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`rounded-md border px-3 py-1 text-sm ${
                daemonHealthy
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
                  : "border-red-400/40 bg-red-400/10 text-red-100"
              }`}
            >
              Daemon {daemonHealthy ? "healthy" : "offline"}
            </span>
            <button
              type="button"
              onClick={() => void loadInitialData()}
              className="rounded-md border border-white/15 px-3 py-1.5 text-sm font-medium text-zinc-100 hover:bg-white/10"
            >
              Refresh
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-3 rounded-md border border-red-400/40 bg-red-400/10 px-3 py-2 text-sm text-red-100">
            {error}
          </p>
        )}
      </header>

      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section aria-labelledby="board-heading" className="px-4 py-5 md:px-6">
          <h2 id="board-heading" className="sr-only">
            Issue board
          </h2>
          <div className="grid gap-4 lg:grid-cols-5">
            {states.map((state) => {
              const stateIssues = issues.filter((issue) => issue.state === state);
              return (
                <section
                  key={state}
                  aria-labelledby={`column-${state}`}
                  className="min-h-72 rounded-lg border border-white/10 bg-zinc-950/70"
                >
                  <div className="flex items-center justify-between border-b border-white/10 px-3 py-3">
                    <h3 id={`column-${state}`} className="text-sm font-semibold text-zinc-100">
                      {state}
                    </h3>
                    <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-zinc-300">{stateIssues.length}</span>
                  </div>
                  <ul className="space-y-3 p-3">
                    {stateIssues.map((issue) => (
                      <IssueCard
                        key={issue.id}
                        issue={issue}
                        run={latestRunByIssue.get(issue.id)}
                        selected={issue.id === selectedIssueId}
                        onSelect={selectIssue}
                        onStart={handleStart}
                        onStop={handleStop}
                        onRetry={handleRetry}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </section>

        <RunDetailPanel issue={selectedIssue} run={selectedRun} events={selectedEvents} />
      </div>
    </main>
  );
}

function IssueCard({
  issue,
  run,
  selected,
  onSelect,
  onStart,
  onStop,
  onRetry,
}: {
  issue: Issue;
  run?: Run;
  selected: boolean;
  onSelect: (issue: Issue) => void;
  onStart: (issue: Issue) => Promise<void>;
  onStop: (run: Run) => Promise<void>;
  onRetry: (run: Run) => Promise<void>;
}) {
  const status = run?.status ?? "idle";
  const running = run ? !isTerminalRunStatus(run.status) : false;
  const retryable = run?.status === "failed" || run?.status === "cancelled";

  return (
    <li>
      <article
        className={`rounded-lg border bg-zinc-900/90 p-3 shadow-sm transition ${
          selected ? "border-cyan-300/80" : "border-white/10 hover:border-white/25"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => onSelect(issue)}
            className="min-w-0 flex-1 text-left"
            aria-label={`Open details for ${issue.identifier}: ${issue.title}`}
          >
            <span className="block text-xs font-medium text-cyan-200">{issue.identifier}</span>
            <span className="mt-1 block text-sm font-semibold leading-5 text-zinc-100">{issue.title}</span>
          </button>
          <StatusBadge status={status} />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {issue.labels.map((label) => (
            <span key={label} className="rounded bg-white/8 px-2 py-0.5 text-xs text-zinc-300">
              {label}
            </span>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {running && run ? (
            <button
              type="button"
              onClick={() => void onStop(run)}
              className="rounded-md border border-red-300/40 px-2.5 py-1.5 text-xs font-medium text-red-100 hover:bg-red-400/10"
              aria-label={`Stop run for ${issue.identifier}`}
            >
              Stop
            </button>
          ) : retryable && run ? (
            <button
              type="button"
              onClick={() => void onRetry(run)}
              className="rounded-md border border-amber-300/40 px-2.5 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-400/10"
              aria-label={`Retry run for ${issue.identifier}`}
            >
              Retry
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onStart(issue)}
              className="rounded-md border border-cyan-300/40 px-2.5 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-400/10"
              aria-label={`Start run for ${issue.identifier}`}
            >
              Start
            </button>
          )}
        </div>
      </article>
    </li>
  );
}

function RunDetailPanel({ issue, run, events }: { issue: Issue | null; run: Run | null; events: AgentEvent[] }) {
  return (
    <aside
      aria-labelledby="run-detail-heading"
      className="border-t border-white/10 bg-zinc-950/80 px-5 py-5 xl:min-h-[calc(100vh-73px)] xl:border-l xl:border-t-0"
    >
      <h2 id="run-detail-heading" className="text-lg font-semibold">
        Run details
      </h2>

      {!issue ? (
        <p className="mt-4 text-sm text-zinc-400">Select an issue card to inspect its mock run timeline.</p>
      ) : (
        <div className="mt-4">
          <p className="text-xs font-medium text-cyan-200">{issue.identifier}</p>
          <h3 className="mt-1 text-xl font-semibold">{issue.title}</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{issue.description}</p>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border border-white/10 p-3">
              <dt className="text-zinc-400">Priority</dt>
              <dd className="mt-1 font-medium">{issue.priority}</dd>
            </div>
            <div className="rounded-md border border-white/10 p-3">
              <dt className="text-zinc-400">Latest run</dt>
              <dd className="mt-1 font-medium">{run ? <StatusText status={run.status} /> : "No run yet"}</dd>
            </div>
          </dl>

          <section aria-labelledby="timeline-heading" className="mt-6">
            <h3 id="timeline-heading" className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-400">
              Event timeline
            </h3>
            {!run ? (
              <p className="mt-3 rounded-md border border-white/10 p-3 text-sm text-zinc-400">
                Start a run to create a persisted timeline.
              </p>
            ) : events.length === 0 ? (
              <p className="mt-3 rounded-md border border-white/10 p-3 text-sm text-zinc-400">
                Waiting for events from the daemon.
              </p>
            ) : (
              <ol aria-live="polite" aria-relevant="additions text" className="mt-3 space-y-3">
                {events.map((event) => (
                  <li key={event.id} className="rounded-md border border-white/10 bg-black/25 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-zinc-100">{eventLabel(event)}</span>
                      <time className="shrink-0 text-xs text-zinc-500" dateTime={event.timestamp}>
                        {formatTime(event.timestamp)}
                      </time>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{eventSummary(event)}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </aside>
  );
}

function StatusBadge({ status }: { status: RunStatus | "idle" }) {
  return (
    <span className={`shrink-0 rounded-md border px-2 py-1 text-xs ${statusClass(status)}`}>
      <StatusText status={status} />
    </span>
  );
}

function StatusText({ status }: { status: RunStatus | "idle" }) {
  return <>{status.replaceAll("_", " ")}</>;
}

function statusClass(status: RunStatus | "idle"): string {
  if (status === "succeeded") return "border-emerald-300/40 bg-emerald-400/10 text-emerald-100";
  if (status === "failed" || status === "cancelled" || status === "timed_out") {
    return "border-red-300/40 bg-red-400/10 text-red-100";
  }
  if (status === "idle") return "border-zinc-500/40 bg-zinc-500/10 text-zinc-300";
  return "border-cyan-300/40 bg-cyan-400/10 text-cyan-100";
}

function eventLabel(event: AgentEvent): string {
  switch (event.type) {
    case "run.status":
      return `Status: ${event.status.replaceAll("_", " ")}`;
    case "agent.message":
      return "Agent message";
    case "tool.call":
      return `Tool call: ${event.toolName}`;
    case "approval.requested":
      return "Approval requested";
    case "approval.resolved":
      return "Approval resolved";
    case "usage":
      return "Usage";
    case "artifact":
      return `Artifact: ${event.artifactType}`;
  }
}

function eventSummary(event: AgentEvent): string {
  switch (event.type) {
    case "run.status":
      return event.error ?? event.message ?? `Run moved to ${event.status}.`;
    case "agent.message":
      return event.message;
    case "tool.call":
      return [event.command, event.output].filter(Boolean).join("\n");
    case "approval.requested":
      return event.prompt;
    case "approval.resolved":
      return event.resolution;
    case "usage":
      return `${event.totalTokens} total tokens (${event.inputTokens} input, ${event.outputTokens} output).`;
    case "artifact":
      return `${event.title}\n${event.content}`;
  }
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}
