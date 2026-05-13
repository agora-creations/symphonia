import { Issue, IssueSchema } from "@symphonia/types";

const baseTime = "2026-05-13T08:00:00.000Z";

const issues: Issue[] = [
  {
    id: "issue-frontend-board",
    identifier: "SYM-1",
    title: "Build Linear-like board columns",
    description: "Render mock issues by workflow state with keyboard-accessible cards.",
    state: "Todo",
    labels: ["frontend", "board"],
    priority: "High",
    createdAt: baseTime,
    updatedAt: baseTime,
    url: "https://mock.local/issues/SYM-1",
  },
  {
    id: "issue-daemon-api",
    identifier: "SYM-2",
    title: "Expose local daemon HTTP and SSE API",
    description: "Serve health, issues, runs, persisted events, and live run streams.",
    state: "Todo",
    labels: ["daemon", "api"],
    priority: "High",
    createdAt: baseTime,
    updatedAt: baseTime,
    url: "https://mock.local/issues/SYM-2",
  },
  {
    id: "issue-event-store",
    identifier: "SYM-3",
    title: "Persist agent events in SQLite",
    description: "Append run events and fetch ordered timelines for detail views.",
    state: "In Progress",
    labels: ["sqlite", "persistence"],
    priority: "Urgent",
    createdAt: baseTime,
    updatedAt: baseTime,
    url: "https://mock.local/issues/SYM-3",
  },
  {
    id: "issue-testing",
    identifier: "SYM-4",
    title: "Add deterministic run state tests",
    description: "Cover start, stop, success, failure, and retry state transitions.",
    state: "In Progress",
    labels: ["testing"],
    priority: "Medium",
    createdAt: baseTime,
    updatedAt: baseTime,
    url: "https://mock.local/issues/SYM-4",
  },
  {
    id: "issue-accessibility",
    identifier: "SYM-5",
    title: "Make board usable without drag and drop",
    description: "Ensure cards and controls are keyboard reachable with readable status text.",
    state: "Human Review",
    labels: ["accessibility", "frontend"],
    priority: "High",
    createdAt: baseTime,
    updatedAt: baseTime,
    url: "https://mock.local/issues/SYM-5",
  },
  {
    id: "issue-rework-failing-run",
    identifier: "SYM-6",
    title: "Investigate flaky mock provider run",
    description: "Designated failure-path issue used to prove retry and rework handling.",
    state: "Rework",
    labels: ["failure-path", "rework"],
    priority: "Urgent",
    createdAt: baseTime,
    updatedAt: baseTime,
    url: "https://mock.local/issues/SYM-6",
  },
  {
    id: "issue-done-readme",
    identifier: "SYM-7",
    title: "Document local prototype loop",
    description: "Explain install, dev, validation, storage, and manual fake-run verification.",
    state: "Done",
    labels: ["docs"],
    priority: "Low",
    createdAt: baseTime,
    updatedAt: baseTime,
    url: "https://mock.local/issues/SYM-7",
  },
  {
    id: "issue-blocked-looking",
    identifier: "SYM-8",
    title: "Prepare future real provider adapter boundary",
    description: "Blocked-looking planning task for real Codex integration, intentionally mocked now.",
    state: "Todo",
    labels: ["blocked-looking", "future"],
    priority: "Medium",
    createdAt: baseTime,
    updatedAt: baseTime,
    url: "https://mock.local/issues/SYM-8",
  },
];

export function listMockIssues(): Issue[] {
  return issues.map((issue) => IssueSchema.parse(issue));
}

export function getMockIssue(issueId: string): Issue | undefined {
  return listMockIssues().find((issue) => issue.id === issueId);
}

export function getMockIssueByIdentifier(issueIdentifier: string): Issue | undefined {
  return listMockIssues().find((issue) => issue.identifier === issueIdentifier);
}

export function isDesignatedFailureIssue(issueId: string): boolean {
  return issueId === "issue-rework-failing-run";
}
