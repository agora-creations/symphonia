import { z } from "zod";
import { TrackerConfig } from "@symphonia/types";

export type LinearFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type LinearGraphqlClientOptions = {
  endpoint: string;
  apiKey: string;
  fetch?: LinearFetch;
  timeoutMs?: number;
};

export class LinearClientError extends Error {
  constructor(
    message: string,
    readonly code: "network" | "http" | "graphql" | "invalid_response",
    readonly status?: number,
  ) {
    super(message);
    this.name = "LinearClientError";
  }
}

const GraphqlErrorSchema = z.object({
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
  extensions: z.record(z.unknown()).optional(),
});

const GraphqlResponseSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(GraphqlErrorSchema).optional(),
});

const PageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
});

export const LinearViewerSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});
export type LinearViewer = z.infer<typeof LinearViewerSchema>;

export const LinearIssueNodeSchema = z.object({
  id: z.string().nullable(),
  identifier: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable().optional(),
  priority: z.number().nullable().optional(),
  branchName: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  state: z
    .object({
      id: z.string().nullable().optional(),
      name: z.string().nullable(),
      type: z.string().nullable().optional(),
    })
    .nullable(),
  labels: z
    .object({
      nodes: z.array(z.object({ name: z.string().nullable() })).optional(),
    })
    .nullable()
    .optional(),
  assignee: z
    .object({
      id: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  project: z
    .object({
      id: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      slugId: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  team: z
    .object({
      id: z.string().nullable().optional(),
      key: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type LinearIssueNode = z.infer<typeof LinearIssueNodeSchema>;

const LinearIssuesPageSchema = z.object({
  issues: z.object({
    nodes: z.array(LinearIssueNodeSchema),
    pageInfo: PageInfoSchema,
  }),
});

const LinearIssueResponseSchema = z.object({
  issue: LinearIssueNodeSchema.nullable(),
});

const LinearViewerResponseSchema = z.object({
  viewer: LinearViewerSchema,
});

export type LinearIssuesPage = {
  nodes: LinearIssueNode[];
  hasNextPage: boolean;
  endCursor: string | null;
};

export class LinearGraphqlClient {
  private readonly fetchFn: LinearFetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: LinearGraphqlClientOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async healthCheck(signal?: AbortSignal): Promise<LinearViewer> {
    const data = await this.request(
      `query SymphoniaLinearViewer {
        viewer {
          id
          name
          email
        }
      }`,
      {},
      signal,
    );
    return LinearViewerResponseSchema.parse(data).viewer;
  }

  async listIssuesPage(input: {
    first: number;
    after: string | null;
    includeArchived: boolean;
    signal?: AbortSignal;
  }): Promise<LinearIssuesPage> {
    const data = await this.request(
      `query SymphoniaLinearIssues($first: Int!, $after: String, $includeArchived: Boolean!) {
        issues(first: $first, after: $after, includeArchived: $includeArchived, orderBy: createdAt) {
          nodes {
            id
            identifier
            title
            description
            priority
            branchName
            url
            createdAt
            updatedAt
            state {
              id
              name
              type
            }
            labels {
              nodes {
                name
              }
            }
            assignee {
              id
              name
              email
            }
            project {
              id
              name
              slugId
            }
            team {
              id
              key
              name
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }`,
      {
        first: input.first,
        after: input.after,
        includeArchived: input.includeArchived,
      },
      input.signal,
    );
    const parsed = LinearIssuesPageSchema.parse(data).issues;
    return {
      nodes: parsed.nodes,
      hasNextPage: parsed.pageInfo.hasNextPage,
      endCursor: parsed.pageInfo.endCursor,
    };
  }

  async getIssue(idOrIdentifier: string, signal?: AbortSignal): Promise<LinearIssueNode | null> {
    const data = await this.request(
      `query SymphoniaLinearIssue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          description
          priority
          branchName
          url
          createdAt
          updatedAt
          state {
            id
            name
            type
          }
          labels {
            nodes {
              name
            }
          }
          assignee {
            id
            name
            email
          }
          project {
            id
            name
            slugId
          }
          team {
            id
            key
            name
          }
        }
      }`,
      { id: idOrIdentifier },
      signal,
    );
    return LinearIssueResponseSchema.parse(data).issue;
  }

  async createComment(issueId: string, body: string, signal?: AbortSignal): Promise<void> {
    await this.request(
      `mutation SymphoniaLinearCommentCreate($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
        }
      }`,
      { issueId, body },
      signal,
    );
  }

  async updateIssueState(issueId: string, stateId: string, signal?: AbortSignal): Promise<void> {
    await this.request(
      `mutation SymphoniaLinearIssueUpdate($issueId: String!, $stateId: String!) {
        issueUpdate(id: $issueId, input: { stateId: $stateId }) {
          success
        }
      }`,
      { issueId, stateId },
      signal,
    );
  }

  private async request(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });

    try {
      const response = await this.fetchFn(this.options.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorizationHeaderValue(this.options.apiKey),
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new LinearClientError(`Linear request failed with HTTP ${response.status}.`, "http", response.status);
      }

      const decoded = GraphqlResponseSchema.parse(await response.json());
      if (decoded.errors && decoded.errors.length > 0) {
        throw new LinearClientError(decoded.errors.map((error) => error.message).join("; "), "graphql", response.status);
      }

      if (decoded.data === undefined) {
        throw new LinearClientError("Linear response did not include data.", "invalid_response", response.status);
      }

      return decoded.data;
    } catch (error) {
      if (error instanceof LinearClientError) throw error;
      if (error instanceof z.ZodError) {
        throw new LinearClientError(`Invalid Linear response: ${error.message}`, "invalid_response");
      }
      throw new LinearClientError(error instanceof Error ? error.message : "Linear network request failed.", "network");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

export function createLinearClient(config: TrackerConfig, fetchFn?: LinearFetch): LinearGraphqlClient {
  if (config.kind !== "linear" || !config.endpoint || !config.apiKey) {
    throw new LinearClientError("Linear tracker config is missing endpoint or api key.", "invalid_response");
  }
  return new LinearGraphqlClient({
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    fetch: fetchFn,
  });
}

function authorizationHeaderValue(apiKey: string): string {
  return apiKey.startsWith("Bearer ") ? apiKey : apiKey;
}
