import { Issue, IssueSchema, TrackerHealth } from "@symphonia/types";
import {
  createLinearClient,
  LinearFetch,
  LinearGraphqlClient,
  LinearIssueNode,
  LinearClientError,
} from "./linear-client.js";
import { nowIso } from "./time.js";
import { normalizeStateKey, sortIssuesForDispatch, TrackerAdapter, TrackerContext, TrackerFetchResult } from "./tracker.js";

type LinearTrackerOptions = {
  fetch?: LinearFetch;
  client?: LinearGraphqlClient;
};

export function createLinearTrackerAdapter(options: LinearTrackerOptions = {}): TrackerAdapter {
  return {
    id: "linear",
    displayName: "Linear",
    async health(context) {
      return linearHealth(context, getClient(context, options));
    },
    async fetchIssues(context) {
      return fetchLinearIssues(context, getClient(context, options));
    },
    async fetchIssuesByIds(context, issueIds) {
      const client = getClient(context, options);
      const issues: Issue[] = [];
      for (const issueId of issueIds) {
        const issue = await fetchLinearIssue(context, client, issueId);
        if (issue) issues.push(issue);
      }
      return issues;
    },
    async fetchIssue(context, issueIdOrIdentifier) {
      return fetchLinearIssue(context, getClient(context, options), issueIdOrIdentifier);
    },
    async createIssueComment(context, issueId, body) {
      ensureWritesAllowed(context);
      await getClient(context, options).createComment(issueId, body, context.signal);
    },
    async transitionIssueState(context, issueId, stateNameOrId) {
      ensureWritesAllowed(context);
      await getClient(context, options).updateIssueState(issueId, stateNameOrId, context.signal);
    },
  };
}

export const linearTrackerAdapter = createLinearTrackerAdapter();

export function normalizeLinearIssue(node: LinearIssueNode, fetchedAt = nowIso()): Issue | null {
  if (!node.id || !node.identifier || !node.title || !node.state?.name || !node.createdAt || !node.updatedAt) {
    return null;
  }

  const labels = [...new Set((node.labels?.nodes ?? []).map((label) => label.name?.trim().toLowerCase()).filter(isNonEmpty))];
  const issue = {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    description: node.description ?? "",
    state: node.state.name,
    labels,
    priority: normalizeLinearPriority(node.priority),
    branchName: node.branchName ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    url: node.url ?? `https://linear.app/issue/${encodeURIComponent(node.identifier)}`,
    tracker: {
      kind: "linear" as const,
      sourceId: node.id,
      teamId: node.team?.id ?? null,
      teamKey: node.team?.key ?? null,
      teamName: node.team?.name ?? null,
      projectId: node.project?.id ?? null,
      projectName: node.project?.name ?? null,
      projectSlug: node.project?.slugId ?? null,
      stateId: node.state.id ?? null,
    },
    lastFetchedAt: fetchedAt,
  };

  return IssueSchema.parse(issue);
}

export function matchesLinearScope(node: LinearIssueNode, context: TrackerContext): boolean {
  const config = context.trackerConfig;
  if (config.allowWorkspaceWide) return true;

  const teamId = node.team?.id ?? null;
  const teamKey = node.team?.key ?? null;
  const projectId = node.project?.id ?? null;
  const projectSlug = node.project?.slugId ?? null;
  const projectName = node.project?.name ?? null;

  const checks: boolean[] = [];
  if (config.teamId) checks.push(teamId === config.teamId);
  if (config.teamKey) checks.push(Boolean(teamKey && normalizeStateKey(teamKey) === normalizeStateKey(config.teamKey)));
  if (config.projectId) checks.push(projectId === config.projectId);
  if (config.projectSlug) {
    checks.push(
      Boolean(
        (projectSlug && normalizeStateKey(projectSlug) === normalizeStateKey(config.projectSlug)) ||
          (projectName && normalizeStateKey(projectName) === normalizeStateKey(config.projectSlug)),
      ),
    );
  }

  return checks.length > 0 && checks.every(Boolean);
}

async function linearHealth(context: TrackerContext, client: LinearGraphqlClient): Promise<TrackerHealth> {
  try {
    await client.healthCheck(context.signal);
    return {
      kind: "linear",
      displayName: "Linear",
      healthy: true,
      checkedAt: nowIso(),
      error: null,
    };
  } catch (error) {
    return {
      kind: "linear",
      displayName: "Linear",
      healthy: false,
      checkedAt: nowIso(),
      error: error instanceof Error ? error.message : "Linear health check failed.",
    };
  }
}

async function fetchLinearIssues(context: TrackerContext, client: LinearGraphqlClient): Promise<TrackerFetchResult> {
  const fetchedAt = nowIso();
  const issues: Issue[] = [];
  const diagnostics: string[] = [];
  let after: string | null = null;
  let truncated = false;

  for (let page = 0; page < context.trackerConfig.maxPages; page += 1) {
    const result = await client.listIssuesPage({
      first: context.trackerConfig.pageSize,
      after,
      includeArchived: context.trackerConfig.includeArchived,
      signal: context.signal,
    });

    for (const node of result.nodes) {
      if (!matchesLinearScope(node, context)) continue;
      const issue = normalizeLinearIssue(node, fetchedAt);
      if (issue) issues.push(issue);
    }

    if (!result.hasNextPage) {
      return {
        issues: sortIssuesForDispatch(dedupeIssues(issues)),
        fetchedAt,
        truncated,
        diagnostics,
      };
    }

    after = result.endCursor;
    if (!after) break;
  }

  truncated = true;
  diagnostics.push(`Linear issue fetch stopped after max_pages=${context.trackerConfig.maxPages}.`);
  return {
    issues: sortIssuesForDispatch(dedupeIssues(issues)),
    fetchedAt,
    truncated,
    diagnostics,
  };
}

async function fetchLinearIssue(
  context: TrackerContext,
  client: LinearGraphqlClient,
  issueIdOrIdentifier: string,
): Promise<Issue | null> {
  const node = await client.getIssue(issueIdOrIdentifier, context.signal);
  if (!node || !matchesLinearScope(node, context)) return null;
  return normalizeLinearIssue(node, nowIso());
}

function getClient(context: TrackerContext, options: LinearTrackerOptions): LinearGraphqlClient {
  if (options.client) return options.client;
  return createLinearClient(
    {
      ...context.trackerConfig,
      apiKey: context.credentialToken ?? context.trackerConfig.apiKey,
    },
    options.fetch,
  );
}

function ensureWritesAllowed(context: TrackerContext): void {
  if (context.trackerConfig.readOnly || !context.trackerConfig.write.enabled) {
    throw new LinearClientError("Linear writes are disabled by tracker configuration.", "graphql");
  }
}

function normalizeLinearPriority(priority: number | null | undefined): Issue["priority"] {
  switch (priority) {
    case 1:
      return "Urgent";
    case 2:
      return "High";
    case 3:
      return "Medium";
    case 4:
      return "Low";
    case 0:
    default:
      return "No priority";
  }
}

function dedupeIssues(issues: Issue[]): Issue[] {
  return [...new Map(issues.map((issue) => [issue.id, issue])).values()];
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
