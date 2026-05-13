import { useMemo, useState } from "react";
import {
  issues as allIssues,
  ISSUE_STATUS_ORDER,
  ISSUE_STATUS_LABELS,
  PRIORITY_LABELS,
  type Issue,
  type IssueStatus,
  type Priority,
} from "@/data/mock";
import { IssueStatusIcon } from "@/components/icons/issue-status-icons";
import { PriorityIcon } from "@/components/icons/status-icons";
import { UserAvatar } from "@/components/avatar-stack";
import { cn } from "@/lib/utils";
import { Filter, Plus, SlidersHorizontal, LayoutGrid, List } from "lucide-react";

function IssueCard({ issue }: { issue: Issue }) {
  return (
    <div className="rounded-md border bg-card p-2.5 text-card-foreground shadow-sm hover:border-foreground/20 transition-colors cursor-pointer">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
        <PriorityIcon priority={issue.priority} />
        <span>{issue.key}</span>
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
    </div>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  return (
    <div className="grid grid-cols-[1.5rem_4.5rem_1fr_auto] items-center gap-3 px-4 py-2 border-b last:border-b-0 hover:bg-muted/40 cursor-pointer">
      <IssueStatusIcon status={issue.status} />
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
        {issue.assignee && <UserAvatar user={issue.assignee} size={20} />}
      </div>
    </div>
  );
}

const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low", "no-priority"];

export function IssuesView() {
  const [view, setView] = useState<"board" | "list">("board");
  const [team, setTeam] = useState<string>("all");
  const [priority, setPriority] = useState<Priority | "all">("all");

  const filtered = useMemo(
    () =>
      allIssues.filter(
        (i) =>
          (team === "all" || i.team === team) && (priority === "all" || i.priority === priority),
      ),
    [team, priority],
  );

  const grouped = useMemo(() => {
    const m = {} as Record<IssueStatus, Issue[]>;
    for (const s of ISSUE_STATUS_ORDER) m[s] = [];
    for (const i of filtered) m[i.status].push(i);
    return m;
  }, [filtered]);

  const teamOptions = ["all", "CRA", "ENG", "DSN", "OPS"];

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

      {view === "board" ? (
        <div className="flex-1 overflow-auto">
          <div className="flex min-w-max gap-3 p-3">
            {ISSUE_STATUS_ORDER.map((s) => (
              <div
                key={s}
                className="flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30"
              >
                <div className="flex items-center gap-2 px-3 py-2 border-b">
                  <IssueStatusIcon status={s} />
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
                    <IssueCard key={i.id} issue={i} />
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
                  <IssueStatusIcon status={s} />
                  <span className="text-sm font-medium">{ISSUE_STATUS_LABELS[s]}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {grouped[s].length}
                  </span>
                </div>
                {grouped[s].map((i) => (
                  <IssueRow key={i.id} issue={i} />
                ))}
              </section>
            ),
          )}
        </div>
      )}
    </div>
  );
}
