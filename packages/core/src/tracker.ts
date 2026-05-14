import { Issue, TrackerConfig, TrackerHealth, TrackerKind, WorkflowConfig } from "@symphonia/types";

export type TrackerFetchResult = {
  issues: Issue[];
  fetchedAt: string;
  truncated: boolean;
  diagnostics: string[];
};

export type TrackerContext = {
  workflowConfig: WorkflowConfig;
  trackerConfig: TrackerConfig;
  credentialToken?: string;
  signal?: AbortSignal;
};

export type TrackerAdapter = {
  id: TrackerKind;
  displayName: string;
  health(context: TrackerContext): Promise<TrackerHealth>;
  fetchIssues(context: TrackerContext): Promise<TrackerFetchResult>;
  fetchIssuesByIds(context: TrackerContext, issueIds: string[]): Promise<Issue[]>;
  fetchIssue(context: TrackerContext, issueIdOrIdentifier: string): Promise<Issue | null>;
  createIssueComment?: (context: TrackerContext, issueId: string, body: string) => Promise<void>;
  transitionIssueState?: (context: TrackerContext, issueId: string, stateNameOrId: string) => Promise<void>;
};

export function normalizeStateKey(state: string): string {
  return state.trim().toLowerCase();
}

export function stateListContains(states: string[], state: string): boolean {
  const key = normalizeStateKey(state);
  return states.some((candidate) => normalizeStateKey(candidate) === key);
}

export function isIssueActive(issue: Issue, config: TrackerConfig): boolean {
  return stateListContains(config.activeStates, issue.state) && !isIssueTerminal(issue, config);
}

export function isIssueTerminal(issue: Issue, config: TrackerConfig): boolean {
  return stateListContains(config.terminalStates, issue.state);
}

export function sortIssuesForDispatch(issues: Issue[]): Issue[] {
  return [...issues].sort((left, right) => {
    const priority = priorityRank(left.priority) - priorityRank(right.priority);
    if (priority !== 0) return priority;

    const created = left.createdAt.localeCompare(right.createdAt);
    if (created !== 0) return created;

    return left.identifier.localeCompare(right.identifier);
  });
}

export function filterActiveCandidateIssues(
  issues: Issue[],
  config: TrackerConfig,
  activeIssueIds: Iterable<string> = [],
): Issue[] {
  const active = new Set(activeIssueIds);
  return sortIssuesForDispatch(
    issues.filter((issue) => {
      if (!issue.id || !issue.identifier || !issue.title || !issue.state) return false;
      if (!isIssueActive(issue, config)) return false;
      if (active.has(issue.id) || active.has(issue.identifier)) return false;
      return true;
    }),
  );
}

export function trackerDisplayName(kind: TrackerKind): string {
  return kind === "linear" ? "Linear" : kind;
}

function priorityRank(priority: Issue["priority"]): number {
  switch (priority) {
    case "Urgent":
      return 1;
    case "High":
      return 2;
    case "Medium":
      return 3;
    case "Low":
      return 4;
    case "No priority":
      return 5;
  }
}
