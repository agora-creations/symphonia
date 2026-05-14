"use client";

import { useMemo, useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import { UserAvatar } from "@/components/avatar-stack";
import { useWorkspaceInsights } from "@/components/use-workspace-insights";
import { cn } from "@/lib/utils";

const ROLE_STYLE = "border-sky-500/30 bg-sky-500/15 text-sky-600 dark:text-sky-400";

export function MembersView() {
  const { insights, loading, refreshing, error, refresh } = useWorkspaceInsights();
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState<string>("all");

  const list = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return insights.members.filter((member) => {
      const matchesTeam = team === "all" || member.teams.includes(team);
      const matchesQuery =
        normalizedQuery.length === 0 ||
        member.name.toLowerCase().includes(normalizedQuery) ||
        (member.email?.toLowerCase().includes(normalizedQuery) ?? false);
      return matchesTeam && matchesQuery;
    });
  }, [insights.members, query, team]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-end gap-3 border-b px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search members"
              className="w-44 rounded-md border bg-background py-1 pl-7 pr-2 text-[12px]"
            />
          </div>
          <select value={team} onChange={(event) => setTeam(event.target.value)} className="rounded-md border bg-background px-2 py-1 text-[12px]">
            <option value="all">All teams</option>
            {insights.teams.map((item) => (
              <option key={item.key} value={item.key}>
                {item.key}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] hover:bg-muted disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} /> Refresh
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 text-[12px] text-primary-foreground opacity-50" disabled title="Member invites need a real workspace account API before they can write.">
            <Plus className="h-3.5 w-3.5" /> Invite
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="hidden grid-cols-[1fr_8rem_1fr_8rem_8rem] gap-4 border-b px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground md:grid">
          <span>Name</span>
          <span>Role</span>
          <span>Teams</span>
          <span>Issues</span>
          <span>Last active</span>
        </div>
        {loading && <StateMessage title="Loading members" message="Reading real assignees from the daemon issue cache." />}
        {!loading && error && <StateMessage title="Members unavailable" message={error} />}
        {!loading && !error && insights.members.length === 0 && (
          <StateMessage title="No real members synced" message="Members appear when synced Linear issues include assignee metadata." />
        )}
        {!loading &&
          !error &&
          list.map((member) => (
            <div key={member.id} className="grid grid-cols-[1fr_auto] items-center gap-4 border-b px-4 py-2.5 hover:bg-muted/40 md:grid-cols-[1fr_8rem_1fr_8rem_8rem]">
              <div className="flex min-w-0 items-center gap-2">
                <UserAvatar user={member} size={24} />
                <div className="min-w-0">
                  <p className="truncate text-sm">{member.name}</p>
                  {member.email && <p className="truncate text-[11px] text-muted-foreground">{member.email}</p>}
                </div>
              </div>
              <span className={cn("inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", ROLE_STYLE)}>
                {member.role}
              </span>
              <div className="hidden flex-wrap items-center gap-1 md:flex">
                {member.teams.map((item) => (
                  <span key={item} className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {item}
                  </span>
                ))}
              </div>
              <span className="hidden text-[11px] tabular-nums text-muted-foreground md:inline">
                {member.issueCount} issues
              </span>
              <span className="hidden text-[11px] tabular-nums text-muted-foreground md:inline">
                {formatMonth(member.lastActivityAt)}
              </span>
            </div>
          ))}
      </div>
    </div>
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

function formatMonth(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
