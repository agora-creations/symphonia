import { describe, expect, it } from "vitest";
import { Issue, WorkflowDefinition } from "@symphonia/types";
import {
  createLinearTrackerAdapter,
  filterActiveCandidateIssues,
  LinearClientError,
  LinearFetch,
  LinearGraphqlClient,
  normalizeLinearIssue,
  resolveWorkflowConfig,
  sortIssuesForDispatch,
} from "../src/index";

const timestamp = "2026-05-13T08:00:00.000Z";

describe("linear graphql client", () => {
  it("checks viewer health with personal api key authorization", async () => {
    const client = new LinearGraphqlClient({
      endpoint: "https://api.linear.app/graphql",
      apiKey: "linear-secret",
      fetch: async (_input, init) => {
        expect((init?.headers as Record<string, string>).Authorization).toBe("linear-secret");
        return jsonResponse({ data: { viewer: { id: "user-1", name: "Ada", email: "ada@example.com" } } });
      },
    });

    await expect(client.healthCheck()).resolves.toMatchObject({ id: "user-1", name: "Ada" });
  });

  it("surfaces graphql credential errors", async () => {
    const client = new LinearGraphqlClient({
      endpoint: "https://api.linear.app/graphql",
      apiKey: "bad-key",
      fetch: async () => jsonResponse({ errors: [{ message: "Authentication required" }] }),
    });

    await expect(client.healthCheck()).rejects.toMatchObject({
      code: "graphql",
      message: "Authentication required",
    });
  });

  it("surfaces network failures", async () => {
    const client = new LinearGraphqlClient({
      endpoint: "https://api.linear.app/graphql",
      apiKey: "key",
      fetch: async () => {
        throw new Error("connection refused");
      },
    });

    await expect(client.healthCheck()).rejects.toMatchObject({
      code: "network",
      message: "connection refused",
    });
  });
});

describe("linear tracker adapter", () => {
  it("fetches paginated issues, filters scope, and normalizes fields", async () => {
    const fetch = paginatedIssueFetch([
      [linearNode({ id: "issue-1", identifier: "ENG-1", title: "Second", priority: 4, createdAt: "2026-05-13T09:00:00.000Z" })],
      [
        linearNode({
          id: "issue-2",
          identifier: "ENG-2",
          title: "First urgent",
          priority: 1,
          createdAt: "2026-05-13T07:00:00.000Z",
          labels: ["Backend", "API"],
        }),
        linearNode({
          id: "issue-out",
          identifier: "OPS-1",
          title: "Wrong team",
          teamKey: "OPS",
        }),
      ],
    ]);
    const adapter = createLinearTrackerAdapter({ fetch });
    const context = trackerContext();

    const result = await adapter.fetchIssues(context);

    expect(result.truncated).toBe(false);
    expect(result.issues.map((issue) => issue.identifier)).toEqual(["ENG-2", "ENG-1"]);
    expect(result.issues[0]?.labels).toEqual(["backend", "api"]);
    expect(result.issues[0]?.tracker?.kind).toBe("linear");
    expect(result.issues[0]?.tracker?.teamKey).toBe("ENG");
  });

  it("reports truncation when max pages stops pagination", async () => {
    const adapter = createLinearTrackerAdapter({
      fetch: paginatedIssueFetch([[linearNode({ id: "issue-1", identifier: "ENG-1" })], [linearNode({ id: "issue-2", identifier: "ENG-2" })]]),
    });
    const context = trackerContext({ max_pages: 1 });

    const result = await adapter.fetchIssues(context);

    expect(result.truncated).toBe(true);
    expect(result.diagnostics[0]).toContain("max_pages=1");
    expect(result.issues.map((issue) => issue.identifier)).toEqual(["ENG-1"]);
  });

  it("fetches one issue by id or identifier", async () => {
    const adapter = createLinearTrackerAdapter({
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { query: string; variables: { id: string } };
        expect(body.query).toContain("query SymphoniaLinearIssue");
        expect(body.variables.id).toBe("ENG-9");
        return jsonResponse({ data: { issue: linearNode({ id: "issue-9", identifier: "ENG-9", title: "Direct fetch" }) } });
      },
    });

    await expect(adapter.fetchIssue(trackerContext(), "ENG-9")).resolves.toMatchObject({
      id: "issue-9",
      identifier: "ENG-9",
      title: "Direct fetch",
    });
  });

  it("normalizes issue priority, labels, and source metadata", () => {
    const issue = normalizeLinearIssue(
      linearNode({
        id: "issue-3",
        identifier: "ENG-3",
        priority: 2,
        labels: ["Feature", "FRONTEND"],
        projectSlug: "orchestration",
        assignee: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
      }),
      timestamp,
    );

    expect(issue).toMatchObject({
      priority: "High",
      labels: ["feature", "frontend"],
      tracker: {
        kind: "linear",
        projectSlug: "orchestration",
      },
      assignee: {
        id: "user-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
      },
      lastFetchedAt: timestamp,
    });
  });

  it("filters active candidates case-insensitively and excludes terminal/running issues", () => {
    const config = trackerContext().trackerConfig;
    const issues: Issue[] = [
      issue("ENG-3", "done", "Urgent", "2026-05-13T05:00:00.000Z"),
      issue("ENG-2", "In Progress", "Low", "2026-05-13T04:00:00.000Z"),
      issue("ENG-1", "todo", "High", "2026-05-13T03:00:00.000Z"),
    ];

    expect(filterActiveCandidateIssues(issues, config, ["issue-ENG-2"]).map((item) => item.identifier)).toEqual(["ENG-1"]);
  });

  it("sorts candidates by priority, creation time, and identifier", () => {
    const issues: Issue[] = [
      issue("ENG-2", "Todo", "Low", "2026-05-13T03:00:00.000Z"),
      issue("ENG-1", "Todo", "Urgent", "2026-05-13T04:00:00.000Z"),
      issue("ENG-3", "Todo", "Urgent", "2026-05-13T04:00:00.000Z"),
      issue("ENG-4", "Todo", "Urgent", "2026-05-13T02:00:00.000Z"),
    ];

    expect(sortIssuesForDispatch(issues).map((item) => item.identifier)).toEqual(["ENG-4", "ENG-1", "ENG-3", "ENG-2"]);
  });

  it("prevents writes in read-only mode", async () => {
    const adapter = createLinearTrackerAdapter({ fetch: async () => jsonResponse({ data: { ok: true } }) });

    await expect(adapter.createIssueComment?.(trackerContext(), "issue-1", "hello")).rejects.toBeInstanceOf(
      LinearClientError,
    );
  });
});

function trackerContext(overrides: Record<string, unknown> = {}) {
  const config = resolveWorkflowConfig(
    definition({
      tracker: {
        kind: "linear",
        api_key: "linear-secret",
        team_key: "ENG",
        active_states: ["Todo", "In Progress"],
        terminal_states: ["Done", "Canceled"],
        page_size: 2,
        max_pages: 5,
        ...overrides,
      },
    }),
  );

  return {
    workflowConfig: config,
    trackerConfig: config.tracker,
  };
}

function definition(config: Record<string, unknown>): WorkflowDefinition {
  return {
    config,
    promptTemplate: "Prompt",
    workflowPath: "/repo/WORKFLOW.md",
    loadedAt: timestamp,
  };
}

function paginatedIssueFetch(pages: LinearNode[][]): LinearFetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { variables: { after: string | null } };
    const pageIndex = body.variables.after ? Number(body.variables.after) : 0;
    const nextPageIndex = pageIndex + 1;
    return jsonResponse({
      data: {
        issues: {
          nodes: pages[pageIndex] ?? [],
          pageInfo: {
            hasNextPage: nextPageIndex < pages.length,
            endCursor: nextPageIndex < pages.length ? String(nextPageIndex) : null,
          },
        },
      },
    });
  };
}

type LinearNode = ReturnType<typeof linearNode>;

function linearNode(input: {
  id?: string;
  identifier?: string;
  title?: string;
  description?: string | null;
  priority?: number | null;
  state?: string;
  labels?: string[];
  teamKey?: string;
  projectSlug?: string | null;
  assignee?: { id: string; name?: string | null; email?: string | null } | null;
  createdAt?: string;
  updatedAt?: string;
}) {
  return {
    id: input.id ?? "issue-1",
    identifier: input.identifier ?? "ENG-1",
    title: input.title ?? "Linear issue",
    description: input.description ?? "Issue body",
    priority: input.priority ?? 3,
    branchName: "eng-1-linear-issue",
    url: `https://linear.app/acme/issue/${input.identifier ?? "ENG-1"}`,
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    state: {
      id: `state-${input.state ?? "Todo"}`,
      name: input.state ?? "Todo",
      type: "unstarted",
    },
    labels: {
      nodes: (input.labels ?? ["Frontend"]).map((name) => ({ name })),
    },
    assignee:
      input.assignee === undefined
        ? null
        : input.assignee
          ? {
              id: input.assignee.id,
              name: input.assignee.name ?? null,
              email: input.assignee.email ?? null,
            }
          : null,
    project: {
      id: "project-1",
      name: input.projectSlug ?? "orchestration",
      slugId: input.projectSlug ?? "orchestration",
    },
    team: {
      id: "team-1",
      key: input.teamKey ?? "ENG",
      name: "Engineering",
    },
  };
}

function issue(identifier: string, state: string, priority: Issue["priority"], createdAt: string): Issue {
  return {
    id: `issue-${identifier}`,
    identifier,
    title: identifier,
    description: "",
    state,
    labels: [],
    priority,
    createdAt,
    updatedAt: createdAt,
    url: `https://linear.app/acme/issue/${identifier}`,
    tracker: { kind: "linear", sourceId: `issue-${identifier}` },
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
