"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, CircleDot, FolderKanban, Hash, Plus, Users as UsersIcon } from "lucide-react";
import { AvatarStack, UserAvatar } from "@/components/avatar-stack";
import { IssueStatusIcon } from "@/components/icons/issue-status-icons";
import { PriorityIcon, ProgressRing, StatusIcon } from "@/components/icons/status-icons";
import { useWorkspaceInsights } from "@/components/use-workspace-insights";
import { cn } from "@/lib/utils";
import { isTerminalState, priorityForIssue, teamKeyForIssue } from "@/lib/workspace-insights";
import type { IssueStatus } from "@/lib/view-models";

type Tab = "overview" | "projects" | "members" | "issues";

export function TeamDetailView({ teamKey }: { teamKey: string }) {
  const decodedTeamKey = decodeURIComponent(teamKey);
  const { issues, insights, loading, error } = useWorkspaceInsights();
  const [tab, setTab] = useState<Tab>("overview");

  const team = insights.teams.find((item) => item.key.toLowerCase() === decodedTeamKey.toLowerCase()) ?? null;
  const teamIssues = useMemo(() => issues.filter((issue) => teamKeyForIssue(issue).toLowerCase() === decodedTeamKey.toLowerCase()), [decodedTeamKey, issues]);

  if (loading) return <StateMessage title="Loading team" message="Reading real team metadata from synced issues." />;
  if (error) return <StateMessage title="Team unavailable" message={error} />;

  if (!team) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <div className="text-center">
          <p className="mb-2">Team not found in synced Linear data.</p>
          <Link href="/teams" className="text-primary hover:underline">
            Back to teams
          </Link>
        </div>
      </div>
    );
  }

  const openIssues = teamIssues.filter((issue) => !isTerminalState(issue.state)).length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Link href="/teams" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-3.5 w-3.5" /> Teams
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className={cn("grid h-5 w-5 place-items-center rounded bg-muted text-[10px] font-bold", team.color)}>{team.key[0]}</span>
          <span className="truncate font-semibold">{team.name}</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{team.key}</span>
        </div>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 text-[12px] text-primary-foreground opacity-50" disabled title="Issue creation remains owned by Linear until write flows are explicitly added.">
          <Plus className="h-3.5 w-3.5" /> New issue
        </button>
      </header>

      <nav className="flex items-center gap-1 border-b px-2">
        {(["overview", "projects", "members", "issues"] as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-xs capitalize transition-colors",
              tab === item ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-auto p-4">
        {tab === "overview" && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Members" value={team.members.length} icon={<UsersIcon className="h-3.5 w-3.5" />} />
              <Stat label="Projects" value={team.projects.length} icon={<FolderKanban className="h-3.5 w-3.5" />} />
              <Stat label="Active" value={team.activeIssueCount} icon={<CircleDot className="h-3.5 w-3.5" />} />
              <Stat label="Open issues" value={openIssues} icon={<Hash className="h-3.5 w-3.5" />} />
            </div>

            <section className="rounded-lg border bg-card">
              <header className="flex items-center justify-between border-b px-4 py-2">
                <h3 className="text-sm font-semibold">Recent projects</h3>
                <button type="button" onClick={() => setTab("projects")} className="text-xs text-muted-foreground hover:text-foreground">
                  View all
                </button>
              </header>
              <ul className="divide-y">
                {team.projects.slice(0, 5).map((project) => (
                  <li key={project.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <StatusIcon status={project.status} className="h-3.5 w-3.5 shrink-0" />
                    <span className="w-24 shrink-0 truncate font-mono text-[11px] text-muted-foreground">{project.key}</span>
                    <span className="flex-1 truncate">{project.name}</span>
                    <ProgressRing value={project.progress} />
                    <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">{project.progress}%</span>
                  </li>
                ))}
                {team.projects.length === 0 && <li className="px-4 py-6 text-center text-xs text-muted-foreground">No real projects synced for this team.</li>}
              </ul>
            </section>

            <section className="rounded-lg border bg-card">
              <header className="flex items-center justify-between border-b px-4 py-2">
                <h3 className="text-sm font-semibold">Members</h3>
                <AvatarStack users={team.members} max={6} size={22} />
              </header>
              <ul className="divide-y">
                {team.members.slice(0, 5).map((member) => (
                  <li key={member.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <UserAvatar user={member} size={24} />
                    <span className="flex-1 truncate">{member.name}</span>
                    <span className="text-[11px] text-muted-foreground">Assignee</span>
                  </li>
                ))}
                {team.members.length === 0 && <li className="px-4 py-6 text-center text-xs text-muted-foreground">No assignees synced for this team.</li>}
              </ul>
            </section>
          </div>
        )}

        {tab === "projects" && (
          <TableShell empty={team.projects.length === 0 ? "No real projects synced for this team." : null}>
            {team.projects.map((project) => (
              <tr key={project.id} className="hover:bg-muted/40">
                <td className="px-3 py-2"><StatusIcon status={project.status} className="h-3.5 w-3.5" /></td>
                <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{project.key}</td>
                <td className="px-3 py-2">{project.name}</td>
                <td className="px-3 py-2"><PriorityIcon priority={project.priority} className="h-3.5 w-3.5" /></td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground">{project.lead?.name ?? "-"}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-2">
                    <ProgressRing value={project.progress} />
                    <span className="w-8 text-right text-[11px] tabular-nums">{project.progress}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </TableShell>
        )}

        {tab === "members" && (
          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Name</th>
                  <th className="px-3 py-2 text-left font-medium">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {team.members.map((member) => (
                  <tr key={member.id} className="hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <UserAvatar user={member} size={24} />
                        <span>{member.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[11px]">Assignee</td>
                  </tr>
                ))}
                {team.members.length === 0 && <tr><td colSpan={2} className="px-3 py-8 text-center text-xs text-muted-foreground">No assignees</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === "issues" && (
          <div className="overflow-hidden rounded-lg border bg-card">
            <ul className="divide-y">
              {teamIssues.map((issue) => (
                <li key={issue.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                  <PriorityIcon priority={priorityForIssue(issue.priority)} className="h-3.5 w-3.5 shrink-0" />
                  <IssueStatusIcon status={iconStatusForState(issue.state)} className="h-3.5 w-3.5 shrink-0" />
                  <span className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground">{issue.identifier}</span>
                  <span className="flex-1 truncate">{issue.title}</span>
                  <span className="hidden text-[11px] text-muted-foreground sm:inline">{issue.state}</span>
                </li>
              ))}
              {teamIssues.length === 0 && <li className="px-3 py-8 text-center text-xs text-muted-foreground">No issues</li>}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function TableShell({ children, empty }: { children: React.ReactNode; empty: string | null }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="w-8 px-3 py-2 text-left font-medium"></th>
            <th className="px-3 py-2 text-left font-medium">Key</th>
            <th className="px-3 py-2 text-left font-medium">Name</th>
            <th className="px-3 py-2 text-left font-medium">Priority</th>
            <th className="px-3 py-2 text-left font-medium">Lead</th>
            <th className="px-3 py-2 text-right font-medium">Progress</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {children}
          {empty && <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function StateMessage({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
      <div>
        <p className="mb-2 text-foreground">{title}</p>
        <p className="max-w-md">{message}</p>
      </div>
    </div>
  );
}

function iconStatusForState(state: string): IssueStatus {
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
