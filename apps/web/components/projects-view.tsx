"use client";

import { useMemo, useState } from "react";
import { Calendar, ChevronDown, Filter, Plus, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { AvatarStack, UserAvatar } from "@/components/avatar-stack";
import { HealthDot, PriorityIcon, ProgressRing, StatusIcon } from "@/components/icons/status-icons";
import { useWorkspaceInsights } from "@/components/use-workspace-insights";
import { cn } from "@/lib/utils";
import {
  HEALTH_LABELS,
  STATUS_LABELS,
  STATUS_ORDER,
  type Health,
  type ProjectStatus,
  type WorkspaceProject,
} from "@/lib/workspace-insights";
import { PRIORITY_LABELS, type Priority } from "@/lib/view-models";

type GroupBy = "status" | "team" | "priority" | "health";

const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low", "no-priority"];
const HEALTHS: Health[] = ["on-track", "at-risk", "off-track", "no-update"];

export function ProjectsView() {
  const { insights, issues, loading, refreshing, error, refresh } = useWorkspaceInsights();
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [team, setTeam] = useState<string>("all");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [health, setHealth] = useState<Health | "all">("all");
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  const teamKeys = useMemo(() => insights.teams.map((item) => item.key), [insights.teams]);
  const filtered = useMemo(
    () =>
      insights.projects.filter(
        (project) =>
          (team === "all" || project.team === team) &&
          (priority === "all" || project.priority === priority) &&
          (health === "all" || project.health === health),
      ),
    [health, insights.projects, priority, team],
  );

  const { groupKeys, grouped, label } = useMemo(() => {
    if (groupBy === "status") {
      const groupedProjects: Record<string, WorkspaceProject[]> = {};
      for (const status of STATUS_ORDER) groupedProjects[status] = [];
      for (const project of filtered) groupedProjects[project.status].push(project);
      return {
        groupKeys: STATUS_ORDER as readonly string[],
        grouped: groupedProjects,
        label: (key: string) => STATUS_LABELS[key as ProjectStatus],
      };
    }
    if (groupBy === "team") {
      const groupedProjects: Record<string, WorkspaceProject[]> = {};
      for (const key of teamKeys) groupedProjects[key] = [];
      for (const project of filtered) (groupedProjects[project.team] ||= []).push(project);
      return { groupKeys: teamKeys, grouped: groupedProjects, label: (key: string) => key };
    }
    if (groupBy === "priority") {
      const groupedProjects: Record<string, WorkspaceProject[]> = {};
      for (const item of PRIORITIES) groupedProjects[item] = [];
      for (const project of filtered) groupedProjects[project.priority].push(project);
      return {
        groupKeys: PRIORITIES,
        grouped: groupedProjects,
        label: (key: string) => PRIORITY_LABELS[key as Priority],
      };
    }
    const groupedProjects: Record<string, WorkspaceProject[]> = {};
    for (const item of HEALTHS) groupedProjects[item] = [];
    for (const project of filtered) groupedProjects[project.health].push(project);
    return {
      groupKeys: HEALTHS,
      grouped: groupedProjects,
      label: (key: string) => HEALTH_LABELS[key as Health],
    };
  }, [filtered, groupBy, teamKeys]);

  const activeFilters: { label: string; clear: () => void }[] = [];
  if (team !== "all") activeFilters.push({ label: `Team: ${team}`, clear: () => setTeam("all") });
  if (priority !== "all") activeFilters.push({ label: `Priority: ${PRIORITY_LABELS[priority]}`, clear: () => setPriority("all") });
  if (health !== "all") activeFilters.push({ label: `Health: ${HEALTH_LABELS[health]}`, clear: () => setHealth("all") });

  const isOpen = (key: string) => openMap[key] !== false;
  const toggle = (key: string) => setOpenMap((current) => ({ ...current, [key]: !isOpen(key) }));

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">Projects</span>
          <span className="text-muted-foreground tabular-nums">{filtered.length}</span>
          <span className="text-[11px] text-muted-foreground">from {issues.length} synced issues</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <select value={team} onChange={(event) => setTeam(event.target.value)} className="rounded-md border bg-background px-2 py-1 text-[12px]">
            <option value="all">All teams</option>
            {teamKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
          <select value={priority} onChange={(event) => setPriority(event.target.value as Priority | "all")} className="rounded-md border bg-background px-2 py-1 text-[12px]">
            <option value="all">All priorities</option>
            {PRIORITIES.map((item) => (
              <option key={item} value={item}>
                {PRIORITY_LABELS[item]}
              </option>
            ))}
          </select>
          <select value={health} onChange={(event) => setHealth(event.target.value as Health | "all")} className="rounded-md border bg-background px-2 py-1 text-[12px]">
            <option value="all">All health</option>
            {HEALTHS.map((item) => (
              <option key={item} value={item}>
                {HEALTH_LABELS[item]}
              </option>
            ))}
          </select>
          <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as GroupBy)} className="rounded-md border bg-background px-2 py-1 text-[12px]" title="Group by">
            <option value="status">Group: Status</option>
            <option value="team">Group: Team</option>
            <option value="priority">Group: Priority</option>
            <option value="health">Group: Health</option>
          </select>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] text-muted-foreground" disabled title="Server-side project filters are not available yet.">
            <Filter className="h-3.5 w-3.5" /> Filter
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] text-muted-foreground" disabled title="Display presets will use persisted user settings when account settings exist.">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Display
          </button>
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] hover:bg-muted disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} /> Refresh
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 text-[12px] text-primary-foreground opacity-50" disabled title="Project writes are not wired yet.">
            <Plus className="h-3.5 w-3.5" /> New project
          </button>
        </div>
      </header>

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          {activeFilters.map((filter) => (
            <Chip key={filter.label} label={filter.label} onClear={filter.clear} />
          ))}
          <button
            type="button"
            onClick={() => {
              setTeam("all");
              setPriority("all");
              setHealth("all");
            }}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loading && <StateMessage title="Loading projects" message="Reading the daemon issue cache." />}
        {!loading && error && <StateMessage title="Projects unavailable" message={error} />}
        {!loading && !error && insights.projects.length === 0 && (
          <StateMessage title="No real projects synced" message="Projects appear here when Linear issues include project metadata. Refresh Linear after connecting a real workspace." />
        )}
        {!loading &&
          !error &&
          groupKeys.map((key) => {
            const list = grouped[key] ?? [];
            if (list.length === 0) return null;
            const open = isOpen(key);
            return (
              <section key={key} className="border-b last:border-b-0">
                <button type="button" onClick={() => toggle(key)} className="flex w-full items-center gap-2 bg-muted/30 px-4 py-2 text-left transition-colors hover:bg-muted/50">
                  <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", !open && "-rotate-90")} />
                  {groupBy === "status" && <StatusIcon status={key as ProjectStatus} />}
                  {groupBy === "priority" && <PriorityIcon priority={key as Priority} />}
                  {groupBy === "health" && <HealthDot health={key as Health} />}
                  <span className="text-sm font-medium">{label(key)}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{list.length}</span>
                </button>
                {open && (
                  <div>
                    {list.map((project) => (
                      <ProjectRow key={project.id} project={project} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
      </div>
    </div>
  );
}

function ProjectRow({ project }: { project: WorkspaceProject }) {
  return (
    <div className="group grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 border-b px-4 py-2 transition-colors last:border-b-0 hover:bg-muted/40">
      <StatusIcon status={project.status} />
      <div className="flex min-w-0 items-center gap-2">
        <span className="w-20 shrink-0 truncate text-[11px] tabular-nums text-muted-foreground">{project.key}</span>
        <span className="truncate text-sm font-medium">{project.name}</span>
        <div className="ml-2 flex shrink-0 items-center gap-1">
          <HealthDot health={project.health} />
          <span className="hidden text-[11px] text-muted-foreground md:inline">{HEALTH_LABELS[project.health]}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="hidden items-center gap-1.5 text-[11px] text-muted-foreground md:flex">
          <PriorityIcon priority={project.priority} />
          <span className="hidden lg:inline">{PRIORITY_LABELS[project.priority]}</span>
        </div>
        <div className="hidden w-24 items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground lg:flex">
          <Calendar className="h-3 w-3" />
          {formatDate(project.updatedAt)}
        </div>
        <div className="hidden w-16 items-center gap-1.5 md:flex">
          <ProgressRing value={project.progress} />
          <span className="text-[11px] tabular-nums text-muted-foreground">{project.progress}%</span>
        </div>
        <span className="hidden text-[11px] text-muted-foreground lg:inline">{project.openIssueCount}/{project.issueCount} open</span>
        <div className="hidden sm:block">
          <AvatarStack users={project.members} max={3} size={20} />
        </div>
        {project.lead && <UserAvatar user={project.lead} size={20} className="sm:hidden" />}
      </div>
    </div>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-[11px]">
      {label}
      <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground" aria-label={`Clear ${label}`}>
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function StateMessage({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex h-full min-h-72 items-center justify-center px-6 text-center">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "No update";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
