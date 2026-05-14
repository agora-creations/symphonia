"use client";

import Link from "next/link";
import { FolderKanban, Hash, Plus, RefreshCw, Users as UsersIcon } from "lucide-react";
import { AvatarStack } from "@/components/avatar-stack";
import { useWorkspaceInsights } from "@/components/use-workspace-insights";
import { cn } from "@/lib/utils";

export function TeamsView() {
  const { insights, loading, refreshing, error, refresh } = useWorkspaceInsights();

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-end gap-3 border-b px-4 py-2.5">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] hover:bg-muted disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} /> Refresh
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 text-[12px] text-primary-foreground opacity-50" disabled title="Team creation needs a real workspace write API before it can write.">
            <Plus className="h-3.5 w-3.5" /> New team
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4">
        {loading && <StateMessage title="Loading teams" message="Reading real teams from synced issue metadata." />}
        {!loading && error && <StateMessage title="Teams unavailable" message={error} />}
        {!loading && !error && insights.teams.length === 0 && (
          <StateMessage title="No real teams synced" message="Teams appear when Linear issues have team metadata. Connect Linear, then refresh issues." />
        )}
        {!loading && !error && insights.teams.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {insights.teams.map((team) => (
              <Link key={team.id} href={`/teams/${encodeURIComponent(team.key)}`} className="group block rounded-lg border bg-card p-4 transition-colors hover:border-foreground/20">
                <div className="flex items-center gap-3">
                  <span className={cn("grid h-9 w-9 place-items-center rounded-md bg-muted text-sm font-bold", team.color)}>
                    {team.key[0]}
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">{team.name}</h3>
                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Hash className="h-3 w-3" /> {team.key}
                    </p>
                  </div>
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <Metric label="Members" value={team.members.length} />
                  <Metric label="Projects" value={team.projects.length} />
                  <Metric label="Active" value={team.activeIssueCount} />
                </dl>

                <div className="mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <UsersIcon className="h-3.5 w-3.5" />
                    <AvatarStack users={team.members} max={4} size={20} />
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <FolderKanban className="h-3.5 w-3.5" />
                    {team.projects.length} projects
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/40 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
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
