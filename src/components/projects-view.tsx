import { useMemo, useState } from "react";
import {
  ChevronDown,
  Filter,
  SlidersHorizontal,
  Plus,
  Calendar,
  X,
} from "lucide-react";
import {
  projects as allProjects,
  STATUS_ORDER,
  STATUS_LABELS,
  PRIORITY_LABELS,
  HEALTH_LABELS,
  type Project,
  type ProjectStatus,
  type Priority,
  type Health,
} from "@/data/mock";
import {
  StatusIcon,
  PriorityIcon,
  HealthDot,
  ProgressRing,
} from "@/components/icons/status-icons";
import { AvatarStack, UserAvatar } from "@/components/avatar-stack";
import { cn } from "@/lib/utils";

type GroupBy = "status" | "team" | "priority" | "health";

function fmtDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ProjectRow({ p }: { p: Project }) {
  return (
    <div className="group grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 px-4 py-2 border-b last:border-b-0 hover:bg-muted/40 transition-colors cursor-pointer">
      <StatusIcon status={p.status} />
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[11px] tabular-nums text-muted-foreground shrink-0 w-16">
          {p.key}
        </span>
        <span className="text-sm font-medium truncate">{p.name}</span>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          <HealthDot health={p.health} />
          <span className="text-[11px] text-muted-foreground hidden md:inline">
            {HEALTH_LABELS[p.health]}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="hidden md:flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <PriorityIcon priority={p.priority} />
          <span className="hidden lg:inline">{PRIORITY_LABELS[p.priority]}</span>
        </div>
        <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums w-20">
          <Calendar className="h-3 w-3" />
          {fmtDate(p.targetDate)}
        </div>
        <div className="hidden md:flex items-center gap-1.5 w-16">
          <ProgressRing value={p.progress} />
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {p.progress}%
          </span>
        </div>
        <div className="hidden sm:block">
          <AvatarStack users={p.members} max={3} size={20} />
        </div>
        <UserAvatar user={p.lead} size={20} className="sm:hidden" />
      </div>
    </div>
  );
}

const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low", "no-priority"];
const HEALTHS: Health[] = ["on-track", "at-risk", "off-track", "no-update"];
const TEAMS = ["CRA", "ENG", "DSN", "OPS"];

function Chip({
  label,
  onClear,
}: {
  label: string;
  onClear?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-[11px]">
      {label}
      {onClear && (
        <button onClick={onClear} className="text-muted-foreground hover:text-foreground">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

export function ProjectsView() {
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [team, setTeam] = useState<string>("all");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [health, setHealth] = useState<Health | "all">("all");
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  const filtered = useMemo(
    () =>
      allProjects.filter(
        (p) =>
          (team === "all" || p.team === team) &&
          (priority === "all" || p.priority === priority) &&
          (health === "all" || p.health === health),
      ),
    [team, priority, health],
  );

  const { groupKeys, grouped, label } = useMemo(() => {
    if (groupBy === "status") {
      const m = {} as Record<string, Project[]>;
      for (const s of STATUS_ORDER) m[s] = [];
      for (const p of filtered) m[p.status].push(p);
      return {
        groupKeys: STATUS_ORDER as readonly string[],
        grouped: m,
        label: (k: string) => STATUS_LABELS[k as ProjectStatus],
      };
    }
    if (groupBy === "team") {
      const m: Record<string, Project[]> = {};
      for (const t of TEAMS) m[t] = [];
      for (const p of filtered) (m[p.team] ||= []).push(p);
      return { groupKeys: TEAMS, grouped: m, label: (k: string) => k };
    }
    if (groupBy === "priority") {
      const m: Record<string, Project[]> = {};
      for (const pr of PRIORITIES) m[pr] = [];
      for (const p of filtered) m[p.priority].push(p);
      return {
        groupKeys: PRIORITIES,
        grouped: m,
        label: (k: string) => PRIORITY_LABELS[k as Priority],
      };
    }
    const m: Record<string, Project[]> = {};
    for (const h of HEALTHS) m[h] = [];
    for (const p of filtered) m[p.health].push(p);
    return {
      groupKeys: HEALTHS,
      grouped: m,
      label: (k: string) => HEALTH_LABELS[k as Health],
    };
  }, [filtered, groupBy]);

  const isOpen = (k: string) => openMap[k] !== false;
  const toggle = (k: string) => setOpenMap((m) => ({ ...m, [k]: !isOpen(k) }));

  const activeFilters: { label: string; clear: () => void }[] = [];
  if (team !== "all") activeFilters.push({ label: `Team: ${team}`, clear: () => setTeam("all") });
  if (priority !== "all")
    activeFilters.push({
      label: `Priority: ${PRIORITY_LABELS[priority]}`,
      clear: () => setPriority("all"),
    });
  if (health !== "all")
    activeFilters.push({
      label: `Health: ${HEALTH_LABELS[health]}`,
      clear: () => setHealth("all"),
    });

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">Projects</span>
          <span className="text-muted-foreground tabular-nums">{filtered.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <select
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-[12px]"
          >
            <option value="all">All teams</option>
            {TEAMS.map((t) => (
              <option key={t} value={t}>
                {t}
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
          <select
            value={health}
            onChange={(e) => setHealth(e.target.value as Health | "all")}
            className="rounded-md border bg-background px-2 py-1 text-[12px]"
          >
            <option value="all">All health</option>
            {HEALTHS.map((h) => (
              <option key={h} value={h}>
                {HEALTH_LABELS[h]}
              </option>
            ))}
          </select>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            className="rounded-md border bg-background px-2 py-1 text-[12px]"
            title="Group by"
          >
            <option value="status">Group: Status</option>
            <option value="team">Group: Team</option>
            <option value="priority">Group: Priority</option>
            <option value="health">Group: Health</option>
          </select>
          <button className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] hover:bg-muted">
            <Filter className="h-3.5 w-3.5" /> Filter
          </button>
          <button className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] hover:bg-muted">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Display
          </button>
          <button className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-2 py-1 text-[12px] hover:opacity-90">
            <Plus className="h-3.5 w-3.5" /> New project
          </button>
        </div>
      </header>

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          {activeFilters.map((f) => (
            <Chip key={f.label} label={f.label} onClear={f.clear} />
          ))}
          <button
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
        {groupKeys.map((k) => {
          const list = grouped[k] ?? [];
          if (list.length === 0) return null;
          const open = isOpen(k);
          return (
            <section key={k} className="border-b last:border-b-0">
              <button
                onClick={() => toggle(k)}
                className="w-full flex items-center gap-2 px-4 py-2 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
              >
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-muted-foreground transition-transform",
                    !open && "-rotate-90",
                  )}
                />
                {groupBy === "status" && <StatusIcon status={k as ProjectStatus} />}
                {groupBy === "priority" && <PriorityIcon priority={k as Priority} />}
                {groupBy === "health" && <HealthDot health={k as Health} />}
                <span className="text-sm font-medium">{label(k)}</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {list.length}
                </span>
              </button>
              {open && (
                <div>
                  {list.map((p) => (
                    <ProjectRow key={p.id} p={p} />
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
