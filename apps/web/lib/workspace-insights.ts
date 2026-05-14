import type { Issue, IssuePriority, IssueState } from "@symphonia/types";
import type { Priority, User } from "@/lib/view-models";

export type ProjectStatus = "backlog" | "planned" | "in-progress" | "paused" | "completed" | "cancelled";
export type Health = "on-track" | "at-risk" | "off-track" | "no-update";

export type WorkspaceMember = User & {
  email: string | null;
  role: "Assignee";
  teams: string[];
  issueCount: number;
  projectCount: number;
  lastActivityAt: string | null;
};

export type WorkspaceProject = {
  id: string;
  key: string;
  name: string;
  status: ProjectStatus;
  priority: Priority;
  health: Health;
  progress: number;
  lead: User | null;
  members: User[];
  team: string;
  teamName: string;
  issueCount: number;
  openIssueCount: number;
  updatedAt: string | null;
};

export type WorkspaceTeam = {
  id: string;
  key: string;
  name: string;
  color: string;
  members: User[];
  projects: WorkspaceProject[];
  issueCount: number;
  activeIssueCount: number;
};

export type WorkspaceInsights = {
  projects: WorkspaceProject[];
  members: WorkspaceMember[];
  teams: WorkspaceTeam[];
};

export const STATUS_ORDER: ProjectStatus[] = ["in-progress", "planned", "backlog", "paused", "completed", "cancelled"];

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  backlog: "Backlog",
  planned: "Planned",
  "in-progress": "In Progress",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const HEALTH_LABELS: Record<Health, string> = {
  "on-track": "On track",
  "at-risk": "At risk",
  "off-track": "Off track",
  "no-update": "No update",
};

const USER_COLORS = ["bg-rose-500", "bg-amber-500", "bg-emerald-500", "bg-sky-500", "bg-violet-500", "bg-fuchsia-500", "bg-cyan-500", "bg-orange-500"];
const TEAM_COLORS = ["text-rose-500", "text-sky-500", "text-violet-500", "text-emerald-500", "text-amber-500", "text-cyan-500"];

export function buildWorkspaceInsights(issues: Issue[]): WorkspaceInsights {
  const memberMap = new Map<string, WorkspaceMember>();
  const projectIssueMap = new Map<string, Issue[]>();
  const teamIssueMap = new Map<string, Issue[]>();

  for (const issue of issues) {
    const team = teamKeyForIssue(issue);
    if (team) {
      const items = teamIssueMap.get(team) ?? [];
      items.push(issue);
      teamIssueMap.set(team, items);
    }

    const projectId = issue.tracker?.projectId ?? issue.tracker?.projectSlug ?? null;
    if (projectId) {
      const items = projectIssueMap.get(projectId) ?? [];
      items.push(issue);
      projectIssueMap.set(projectId, items);
    }

    if (issue.assignee?.id) {
      const current = memberMap.get(issue.assignee.id);
      const member = current ?? memberFromIssue(issue);
      member.issueCount += current ? 1 : 0;
      member.lastActivityAt = newest(member.lastActivityAt, issue.updatedAt);
      if (team && !member.teams.includes(team)) member.teams.push(team);
      memberMap.set(issue.assignee.id, member);
    }
  }

  const projects = [...projectIssueMap.entries()]
    .map(([id, projectIssues]) => projectFromIssues(id, projectIssues))
    .sort((a, b) => a.key.localeCompare(b.key));

  for (const member of memberMap.values()) {
    const projectIds = new Set(
      issues
        .filter((issue) => issue.assignee?.id === member.id)
        .map((issue) => issue.tracker?.projectId ?? issue.tracker?.projectSlug ?? null)
        .filter((id): id is string => Boolean(id)),
    );
    member.projectCount = projectIds.size;
    member.teams.sort((a, b) => a.localeCompare(b));
  }

  const projectByTeam = new Map<string, WorkspaceProject[]>();
  for (const project of projects) {
    const items = projectByTeam.get(project.team) ?? [];
    items.push(project);
    projectByTeam.set(project.team, items);
  }

  const teams = [...teamIssueMap.entries()]
    .map(([key, teamIssues], index) => {
      const teamProjects = projectByTeam.get(key) ?? [];
      const members = [...memberMap.values()]
        .filter((member) => member.teams.includes(key))
        .map(({ role: _role, teams: _teams, issueCount: _issueCount, projectCount: _projectCount, lastActivityAt: _lastActivityAt, email: _email, ...user }) => user);

      return {
        id: teamIssues[0]?.tracker?.teamId ?? key,
        key,
        name: teamIssues[0]?.tracker?.teamName ?? key,
        color: TEAM_COLORS[index % TEAM_COLORS.length] ?? "text-sky-500",
        members,
        projects: teamProjects,
        issueCount: teamIssues.length,
        activeIssueCount: teamIssues.filter((issue) => !isTerminalState(issue.state)).length,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    projects,
    members: [...memberMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    teams,
  };
}

export function priorityForIssue(priority: IssuePriority): Priority {
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

export function isTerminalState(state: IssueState): boolean {
  const normalized = state.toLowerCase();
  return ["done", "closed", "completed", "cancelled", "canceled", "duplicate"].includes(normalized);
}

export function isActiveState(state: IssueState): boolean {
  const normalized = state.toLowerCase();
  return ["in progress", "started", "review", "human review", "rework"].includes(normalized);
}

export function teamKeyForIssue(issue: Issue): string {
  return issue.tracker?.teamKey ?? issue.identifier.split("-")[0] ?? "Linear";
}

function projectFromIssues(id: string, issues: Issue[]): WorkspaceProject {
  const first = issues[0];
  const terminal = issues.filter((issue) => isTerminalState(issue.state)).length;
  const active = issues.filter((issue) => isActiveState(issue.state)).length;
  const cancelled = issues.filter((issue) => ["cancelled", "canceled", "duplicate"].includes(issue.state.toLowerCase())).length;
  const openIssueCount = issues.length - terminal;
  const progress = issues.length === 0 ? 0 : Math.round((terminal / issues.length) * 100);
  const highestPriority = highestIssuePriority(issues.map((issue) => issue.priority));
  const members = dedupeUsers(issues.map(userFromIssue).filter((user): user is User => Boolean(user)));
  const lead = members[0] ?? null;

  return {
    id,
    key: first?.tracker?.projectSlug?.toUpperCase() ?? first?.tracker?.projectName ?? id,
    name: first?.tracker?.projectName ?? first?.tracker?.projectSlug ?? id,
    status: cancelled === issues.length ? "cancelled" : progress === 100 ? "completed" : active > 0 ? "in-progress" : "planned",
    priority: priorityForIssue(highestPriority),
    health: highestPriority === "Urgent" && openIssueCount > 0 ? "at-risk" : progress > 0 ? "on-track" : "no-update",
    progress,
    lead,
    members,
    team: first ? teamKeyForIssue(first) : "Linear",
    teamName: first?.tracker?.teamName ?? (first ? teamKeyForIssue(first) : "Linear"),
    issueCount: issues.length,
    openIssueCount,
    updatedAt: issues.reduce<string | null>((current, issue) => newest(current, issue.updatedAt), null),
  };
}

function memberFromIssue(issue: Issue): WorkspaceMember {
  const user = userFromIssue(issue) ?? {
    id: issue.assignee?.id ?? issue.id,
    name: issue.assignee?.email ?? "Unknown assignee",
    initials: "UA",
    color: colorForId(issue.assignee?.id ?? issue.id),
  };

  return {
    ...user,
    email: issue.assignee?.email ?? null,
    role: "Assignee",
    teams: [teamKeyForIssue(issue)],
    issueCount: 1,
    projectCount: issue.tracker?.projectId || issue.tracker?.projectSlug ? 1 : 0,
    lastActivityAt: issue.updatedAt,
  };
}

export function userFromIssue(issue: Issue): User | null {
  if (!issue.assignee?.id) return null;
  const label = issue.assignee.name ?? issue.assignee.email ?? issue.assignee.id;
  return {
    id: issue.assignee.id,
    name: label,
    initials: initialsFor(label),
    color: colorForId(issue.assignee.id),
  };
}

function highestIssuePriority(priorities: IssuePriority[]): IssuePriority {
  const order: IssuePriority[] = ["Urgent", "High", "Medium", "Low", "No priority"];
  return order.find((priority) => priorities.includes(priority)) ?? "No priority";
}

function dedupeUsers(users: User[]): User[] {
  const byId = new Map<string, User>();
  for (const user of users) byId.set(user.id, user);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function initialsFor(label: string): string {
  const parts = label
    .replace(/@.*/, "")
    .split(/\s+|[._-]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const initials = parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : label.slice(0, 2);
  return initials.toUpperCase();
}

function colorForId(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return USER_COLORS[hash % USER_COLORS.length] ?? "bg-sky-500";
}

function newest(current: string | null, next: string | null | undefined): string | null {
  if (!next) return current;
  if (!current) return next;
  return next.localeCompare(current) > 0 ? next : current;
}
