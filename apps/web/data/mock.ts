// Mock data for the projects management demo.
// Original work — not copied from any source.

export type Priority = "no-priority" | "urgent" | "high" | "medium" | "low";
export type Health = "on-track" | "at-risk" | "off-track" | "no-update";
export type ProjectStatus =
  | "backlog"
  | "planned"
  | "in-progress"
  | "paused"
  | "completed"
  | "cancelled";

export interface User {
  id: string;
  name: string;
  initials: string;
  color: string; // bg color class
}

export interface Project {
  id: string;
  key: string; // e.g. CIR-001
  name: string;
  status: ProjectStatus;
  priority: Priority;
  health: Health;
  progress: number; // 0..100
  lead: User;
  members: User[];
  startDate?: string; // ISO
  targetDate?: string; // ISO
  team: string;
}

export interface Team {
  id: string;
  key: string; // 3-letter
  name: string;
  color: string;
}

export const users: User[] = [
  { id: "u1", name: "Ava Martinez", initials: "AM", color: "bg-rose-500" },
  { id: "u2", name: "Leo Tanaka", initials: "LT", color: "bg-amber-500" },
  { id: "u3", name: "Mira Khan", initials: "MK", color: "bg-emerald-500" },
  { id: "u4", name: "Noah Berg", initials: "NB", color: "bg-sky-500" },
  { id: "u5", name: "Sienna Cole", initials: "SC", color: "bg-violet-500" },
  { id: "u6", name: "Theo Park", initials: "TP", color: "bg-fuchsia-500" },
  { id: "u7", name: "Yuki Ono", initials: "YO", color: "bg-cyan-500" },
  { id: "u8", name: "Eli Romano", initials: "ER", color: "bg-orange-500" },
];

export const teams: Team[] = [
  { id: "t1", key: "CRA", name: "Craft", color: "text-rose-500" },
  { id: "t2", key: "ENG", name: "Engineering", color: "text-sky-500" },
  { id: "t3", key: "DSN", name: "Design", color: "text-violet-500" },
  { id: "t4", key: "OPS", name: "Operations", color: "text-emerald-500" },
];

export const projects: Project[] = [
  {
    id: "p1",
    key: "CRA-101",
    name: "Onboarding flow refresh",
    status: "in-progress",
    priority: "high",
    health: "on-track",
    progress: 64,
    lead: users[0],
    members: [users[0], users[2], users[4]],
    startDate: "2026-04-02",
    targetDate: "2026-06-12",
    team: "CRA",
  },
  {
    id: "p2",
    key: "ENG-204",
    name: "Realtime sync engine v2",
    status: "in-progress",
    priority: "urgent",
    health: "at-risk",
    progress: 41,
    lead: users[3],
    members: [users[3], users[1], users[6]],
    startDate: "2026-03-15",
    targetDate: "2026-05-30",
    team: "ENG",
  },
  {
    id: "p3",
    key: "DSN-052",
    name: "Marketing site redesign",
    status: "planned",
    priority: "medium",
    health: "no-update",
    progress: 0,
    lead: users[4],
    members: [users[4], users[5]],
    startDate: "2026-05-20",
    targetDate: "2026-07-08",
    team: "DSN",
  },
  {
    id: "p4",
    key: "OPS-019",
    name: "Billing migration to Stripe",
    status: "in-progress",
    priority: "high",
    health: "on-track",
    progress: 78,
    lead: users[7],
    members: [users[7], users[1]],
    startDate: "2026-02-10",
    targetDate: "2026-05-22",
    team: "OPS",
  },
  {
    id: "p5",
    key: "ENG-219",
    name: "Edge cache pipeline",
    status: "backlog",
    priority: "low",
    health: "no-update",
    progress: 0,
    lead: users[6],
    members: [users[6], users[3]],
    targetDate: "2026-08-01",
    team: "ENG",
  },
  {
    id: "p6",
    key: "CRA-088",
    name: "Mobile keyboard shortcuts",
    status: "paused",
    priority: "medium",
    health: "off-track",
    progress: 22,
    lead: users[2],
    members: [users[2], users[0]],
    startDate: "2026-01-08",
    targetDate: "2026-04-01",
    team: "CRA",
  },
  {
    id: "p7",
    key: "DSN-061",
    name: "Iconography system",
    status: "completed",
    priority: "medium",
    health: "on-track",
    progress: 100,
    lead: users[5],
    members: [users[5], users[4], users[2]],
    startDate: "2026-01-15",
    targetDate: "2026-03-30",
    team: "DSN",
  },
  {
    id: "p8",
    key: "OPS-027",
    name: "Customer onboarding playbook",
    status: "planned",
    priority: "low",
    health: "no-update",
    progress: 0,
    lead: users[7],
    members: [users[7]],
    targetDate: "2026-09-15",
    team: "OPS",
  },
  {
    id: "p9",
    key: "ENG-230",
    name: "Permissions overhaul",
    status: "backlog",
    priority: "high",
    health: "no-update",
    progress: 0,
    lead: users[1],
    members: [users[1], users[3], users[6]],
    targetDate: "2026-09-30",
    team: "ENG",
  },
  {
    id: "p10",
    key: "CRA-112",
    name: "Empty state illustrations",
    status: "completed",
    priority: "low",
    health: "on-track",
    progress: 100,
    lead: users[0],
    members: [users[0], users[5]],
    startDate: "2026-02-01",
    targetDate: "2026-03-12",
    team: "CRA",
  },
  {
    id: "p11",
    key: "OPS-031",
    name: "Internal status page",
    status: "cancelled",
    priority: "no-priority",
    health: "no-update",
    progress: 18,
    lead: users[7],
    members: [users[7], users[2]],
    targetDate: "2026-04-20",
    team: "OPS",
  },
  {
    id: "p12",
    key: "ENG-241",
    name: "Search relevance tuning",
    status: "in-progress",
    priority: "medium",
    health: "on-track",
    progress: 55,
    lead: users[6],
    members: [users[6], users[1]],
    startDate: "2026-04-12",
    targetDate: "2026-06-02",
    team: "ENG",
  },
];

export const STATUS_ORDER: ProjectStatus[] = [
  "in-progress",
  "planned",
  "backlog",
  "paused",
  "completed",
  "cancelled",
];

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  backlog: "Backlog",
  planned: "Planned",
  "in-progress": "In Progress",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  "no-priority": "No priority",
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const HEALTH_LABELS: Record<Health, string> = {
  "on-track": "On track",
  "at-risk": "At risk",
  "off-track": "Off track",
  "no-update": "No update",
};

// ===== Issues =====

export type IssueStatus =
  | "backlog"
  | "todo"
  | "in-progress"
  | "in-review"
  | "done"
  | "cancelled";

export interface Label {
  id: string;
  name: string;
  color: string; // tailwind text color class
}

export interface Issue {
  id: string;
  key: string; // ENG-123
  title: string;
  status: IssueStatus;
  priority: Priority;
  assignee?: User;
  labels: Label[];
  projectId?: string;
  team: string; // team key
  createdAt: string;
  updatedAt: string;
  dueDate?: string;
}

export const ISSUE_STATUS_ORDER: IssueStatus[] = [
  "backlog",
  "todo",
  "in-progress",
  "in-review",
  "done",
  "cancelled",
];

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  "in-progress": "In Progress",
  "in-review": "In Review",
  done: "Done",
  cancelled: "Cancelled",
};

export const labels: Label[] = [
  { id: "l1", name: "bug", color: "text-red-500" },
  { id: "l2", name: "feature", color: "text-violet-500" },
  { id: "l3", name: "improvement", color: "text-sky-500" },
  { id: "l4", name: "design", color: "text-fuchsia-500" },
  { id: "l5", name: "infra", color: "text-emerald-500" },
  { id: "l6", name: "docs", color: "text-amber-500" },
];

const titles = [
  "Drag handle misaligned on Safari",
  "Add bulk-edit shortcut for selected issues",
  "Sync hangs when offline for >30s",
  "Timeline view crashes on empty project",
  "Empty state polish for inbox",
  "Permissions: invite-only workspaces",
  "Refactor command palette renderer",
  "Add filters by assignee on board",
  "Improve focus ring contrast in dark mode",
  "Markdown paste loses inline code",
  "Webhooks retry queue stalls",
  "Add CSV export for projects",
  "Skeleton loaders flicker on first paint",
  "Notifications grouping by project",
  "Add keyboard shortcut for cycle switcher",
  "Search returns archived items",
  "Mobile gestures for swipe-to-archive",
  "Avatar uploader rejects PNGs > 1MB",
  "Onboarding step 3 copy update",
  "Edge cache misses for project icons",
  "Reorder columns persists per-user",
  "Add 'Snooze' action to inbox",
  "Project switcher should support search",
  "Cycle burn-up chart renders empty",
  "Add SSO via SAML",
];

const teamKeys = ["CRA", "ENG", "DSN", "OPS"] as const;
const statuses: IssueStatus[] = [
  "backlog",
  "todo",
  "in-progress",
  "in-progress",
  "in-review",
  "done",
  "done",
  "cancelled",
];
const priorityCycle: Priority[] = [
  "no-priority",
  "low",
  "medium",
  "medium",
  "high",
  "high",
  "urgent",
];

function pad(n: number, w = 3) {
  return String(n).padStart(w, "0");
}

export const issues: Issue[] = titles.map((title, i) => {
  const team = teamKeys[i % teamKeys.length];
  const status = statuses[i % statuses.length];
  const priority = priorityCycle[i % priorityCycle.length];
  const assignee = users[i % users.length];
  const ls = [labels[i % labels.length]];
  if (i % 3 === 0) ls.push(labels[(i + 2) % labels.length]);
  const created = new Date(2026, 3, 1 + (i % 28));
  const updated = new Date(2026, 4, 1 + (i % 12));
  return {
    id: `i${i + 1}`,
    key: `${team}-${pad(120 + i)}`,
    title,
    status,
    priority,
    assignee,
    labels: ls,
    team,
    projectId: projects[i % projects.length].id,
    createdAt: created.toISOString(),
    updatedAt: updated.toISOString(),
    dueDate: i % 4 === 0 ? new Date(2026, 5, 1 + (i % 28)).toISOString() : undefined,
  };
});

// ===== Member roles =====

export type Role = "Admin" | "Member" | "Guest";

export const userRoles: Record<string, { role: Role; teams: string[]; joined: string }> = {
  u1: { role: "Admin", teams: ["CRA", "DSN"], joined: "2024-09-12" },
  u2: { role: "Member", teams: ["ENG"], joined: "2025-01-08" },
  u3: { role: "Member", teams: ["CRA"], joined: "2024-11-22" },
  u4: { role: "Admin", teams: ["ENG", "OPS"], joined: "2024-06-03" },
  u5: { role: "Member", teams: ["DSN"], joined: "2025-03-14" },
  u6: { role: "Guest", teams: ["DSN"], joined: "2025-08-19" },
  u7: { role: "Member", teams: ["ENG"], joined: "2025-02-02" },
  u8: { role: "Admin", teams: ["OPS"], joined: "2024-10-05" },
};
