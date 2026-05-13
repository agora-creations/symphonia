import {
  ChangedFile,
  ChangedFileSchema,
  CheckRunSummary,
  CheckRunSummarySchema,
  CommitStatusSummary,
  CommitStatusSummarySchema,
  DiffSummary,
  DiffSummarySchema,
  GitHubConfig,
  GitHubHealth,
  PullRequestSummary,
  PullRequestSummarySchema,
  WorkflowRunSummary,
  WorkflowRunSummarySchema,
} from "@symphonia/types";
import { nowIso } from "./time.js";

export type GitHubFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type GitHubClientOptions = {
  endpoint: string;
  owner: string;
  repo: string;
  token: string | null;
  pageSize: number;
  maxPages: number;
  fetch?: GitHubFetch;
};

export type GitHubRateLimitDiagnostics = {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  retryAfterSeconds: number | null;
};

export class GitHubClientError extends Error {
  constructor(
    message: string,
    readonly code: "network" | "http" | "rate_limit" | "invalid_response" | "write_disabled",
    readonly status: number | null = null,
    readonly rateLimit: GitHubRateLimitDiagnostics | null = null,
  ) {
    super(message);
    this.name = "GitHubClientError";
  }
}

type RequestOptions = {
  method?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
};

export class GitHubRestClient {
  private readonly fetchFn: GitHubFetch;
  private readonly endpoint: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string | null;
  private readonly pageSize: number;
  private readonly maxPages: number;

  constructor(options: GitHubClientOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.owner = options.owner;
    this.repo = options.repo;
    this.token = options.token;
    this.pageSize = options.pageSize;
    this.maxPages = options.maxPages;
  }

  async healthCheck(signal?: AbortSignal): Promise<GitHubHealth> {
    const response = await this.request<Record<string, unknown>>(`/repos/${this.owner}/${this.repo}`, { signal });
    return {
      enabled: true,
      healthy: true,
      checkedAt: nowIso(),
      error: null,
      rateLimit: response.rateLimit,
    };
  }

  async getRepository(signal?: AbortSignal): Promise<Record<string, unknown>> {
    return (await this.request<Record<string, unknown>>(`/repos/${this.owner}/${this.repo}`, { signal })).data;
  }

  async listPullRequests(input: { headBranch?: string | null; state?: "open" | "closed" | "all"; signal?: AbortSignal }): Promise<PullRequestSummary[]> {
    const query: Record<string, string | number> = {
      state: input.state ?? "all",
      sort: "updated",
      direction: "desc",
    };
    if (input.headBranch) {
      query.head = `${this.owner}:${input.headBranch}`;
    }

    const items = await this.paginate<Record<string, unknown>>(`/repos/${this.owner}/${this.repo}/pulls`, query, input.signal);
    return items.map(normalizePullRequest).filter(isDefined);
  }

  async getPullRequest(number: number, signal?: AbortSignal): Promise<PullRequestSummary> {
    const result = await this.request<Record<string, unknown>>(`/repos/${this.owner}/${this.repo}/pulls/${number}`, { signal });
    return normalizePullRequest(result.data) ?? failInvalid("Invalid GitHub pull request response.");
  }

  async listPullRequestFiles(number: number, signal?: AbortSignal): Promise<ChangedFile[]> {
    const items = await this.paginate<Record<string, unknown>>(
      `/repos/${this.owner}/${this.repo}/pulls/${number}/files`,
      {},
      signal,
    );
    return items.map((item) => normalizeGithubFile(item, "github_pr")).filter(isDefined);
  }

  async compareCommits(base: string, head: string, signal?: AbortSignal): Promise<DiffSummary> {
    const result = await this.request<Record<string, unknown>>(
      `/repos/${this.owner}/${this.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
      { signal },
    );
    const files = arrayOfRecords(result.data.files).map((file) => normalizeGithubFile(file, "github_compare")).filter(isDefined);
    return DiffSummarySchema.parse({
      filesChanged: numberOr(files.length, result.data.total_files),
      additions: numberOr(files.reduce((total, file) => total + file.additions, 0), result.data.total_additions),
      deletions: numberOr(files.reduce((total, file) => total + file.deletions, 0), result.data.total_deletions),
      files,
    });
  }

  async getCombinedCommitStatus(ref: string, signal?: AbortSignal): Promise<CommitStatusSummary> {
    const result = await this.request<Record<string, unknown>>(
      `/repos/${this.owner}/${this.repo}/commits/${encodeURIComponent(ref)}/status`,
      { signal },
    );
    return CommitStatusSummarySchema.parse({
      state: stringOr("unknown", result.data.state),
      totalCount: numberOr(0, result.data.total_count),
      sha: stringOrNull(result.data.sha),
      statuses: arrayOfRecords(result.data.statuses).map((status) => ({
        id: nullableNumber(status.id),
        context: stringOr("status", status.context),
        state: stringOr("unknown", status.state),
        description: stringOrNull(status.description),
        targetUrl: stringOrNull(status.target_url),
        createdAt: stringOrNull(status.created_at),
        updatedAt: stringOrNull(status.updated_at),
      })),
    });
  }

  async listCheckRunsForRef(ref: string, signal?: AbortSignal): Promise<CheckRunSummary[]> {
    const pages = await this.paginateEnvelope<Record<string, unknown>>(
      `/repos/${this.owner}/${this.repo}/commits/${encodeURIComponent(ref)}/check-runs`,
      {},
      "check_runs",
      signal,
    );
    return pages.map(normalizeCheckRun).filter(isDefined);
  }

  async listWorkflowRuns(input: { headSha?: string | null; branch?: string | null; signal?: AbortSignal }): Promise<WorkflowRunSummary[]> {
    const query: Record<string, string> = {};
    if (input.headSha) query.head_sha = input.headSha;
    if (!input.headSha && input.branch) query.branch = input.branch;
    const pages = await this.paginateEnvelope<Record<string, unknown>>(
      `/repos/${this.owner}/${this.repo}/actions/runs`,
      query,
      "workflow_runs",
      input.signal,
    );
    return pages.map(normalizeWorkflowRun).filter(isDefined);
  }

  async createPullRequest(input: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft: boolean;
    writeEnabled: boolean;
    allowCreatePr: boolean;
    signal?: AbortSignal;
  }): Promise<PullRequestSummary> {
    if (!input.writeEnabled || !input.allowCreatePr) {
      throw new GitHubClientError("GitHub PR creation is disabled by workflow configuration.", "write_disabled");
    }

    const result = await this.request<Record<string, unknown>>(`/repos/${this.owner}/${this.repo}/pulls`, {
      method: "POST",
      body: {
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
        draft: input.draft,
      },
      signal: input.signal,
    });
    return normalizePullRequest(result.data) ?? failInvalid("Invalid GitHub create pull request response.");
  }

  private async paginate<T extends Record<string, unknown>>(
    path: string,
    query: Record<string, string | number | boolean | null | undefined>,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= this.maxPages; page += 1) {
      const result = await this.request<unknown>(path, {
        query: { ...query, per_page: this.pageSize, page },
        signal,
      });
      const data = Array.isArray(result.data) ? result.data : [];
      items.push(...(data.filter(isRecord) as T[]));
      if (data.length < this.pageSize) break;
    }
    return items;
  }

  private async paginateEnvelope<T extends Record<string, unknown>>(
    path: string,
    query: Record<string, string | number | boolean | null | undefined>,
    key: string,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= this.maxPages; page += 1) {
      const result = await this.request<Record<string, unknown>>(path, {
        query: { ...query, per_page: this.pageSize, page },
        signal,
      });
      const data = Array.isArray(result.data[key]) ? result.data[key] : [];
      items.push(...(data.filter(isRecord) as T[]));
      if (data.length < this.pageSize) break;
    }
    return items;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<{ data: T; rateLimit: GitHubRateLimitDiagnostics }> {
    const url = new URL(`${this.endpoint}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "symphonia-local",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      throw new GitHubClientError(error instanceof Error ? error.message : "GitHub network request failed.", "network");
    }

    const rateLimit = rateLimitFromHeaders(response.headers);
    const payload = await readResponseJson(response);
    if (!response.ok) {
      const message = githubErrorMessage(payload, response.status);
      throw new GitHubClientError(
        message,
        response.status === 429 || rateLimit.remaining === 0 ? "rate_limit" : "http",
        response.status,
        rateLimit,
      );
    }

    return { data: payload as T, rateLimit };
  }
}

export function createGitHubClient(config: GitHubConfig, fetchFn?: GitHubFetch): GitHubRestClient | null {
  if (!config.enabled || !config.owner || !config.repo || !config.token) return null;
  return new GitHubRestClient({
    endpoint: config.endpoint,
    owner: config.owner,
    repo: config.repo,
    token: config.token,
    pageSize: config.pageSize,
    maxPages: config.maxPages,
    fetch: fetchFn,
  });
}

function normalizePullRequest(input: Record<string, unknown>): PullRequestSummary | null {
  const head = isRecord(input.head) ? input.head : {};
  const base = isRecord(input.base) ? input.base : {};
  const user = isRecord(input.user) ? input.user : {};
  const number = nullableNumber(input.number);
  if (!number) return null;
  return PullRequestSummarySchema.parse({
    id: numberOr(number, input.id),
    number,
    title: stringOr("", input.title),
    url: stringOr("", input.html_url),
    state: stringOr("unknown", input.state),
    draft: Boolean(input.draft),
    merged: Boolean(input.merged),
    mergeable: typeof input.mergeable === "boolean" ? input.mergeable : null,
    baseBranch: stringOr("unknown", base.ref),
    headBranch: stringOr("unknown", head.ref),
    headSha: stringOrNull(head.sha),
    baseSha: stringOrNull(base.sha),
    author: stringOrNull(user.login),
    createdAt: stringOr(nowIso(), input.created_at),
    updatedAt: stringOr(nowIso(), input.updated_at),
  });
}

function normalizeGithubFile(input: Record<string, unknown>, source: ChangedFile["source"]): ChangedFile | null {
  const filename = stringOrNull(input.filename);
  if (!filename) return null;
  return ChangedFileSchema.parse({
    path: filename,
    status: stringOr("modified", input.status),
    additions: numberOr(0, input.additions),
    deletions: numberOr(0, input.deletions),
    isBinary: false,
    oldPath: stringOrNull(input.previous_filename),
    patch: stringOrNull(input.patch),
    source,
  });
}

function normalizeCheckRun(input: Record<string, unknown>): CheckRunSummary | null {
  const name = stringOrNull(input.name);
  if (!name) return null;
  const app = isRecord(input.app) ? input.app : {};
  return CheckRunSummarySchema.parse({
    id: numberOr(0, input.id),
    name,
    status: stringOrNull(input.status),
    conclusion: stringOrNull(input.conclusion),
    startedAt: stringOrNull(input.started_at),
    completedAt: stringOrNull(input.completed_at),
    url: stringOrNull(input.html_url),
    detailsUrl: stringOrNull(input.details_url),
    appName: stringOrNull(app.name),
  });
}

function normalizeWorkflowRun(input: Record<string, unknown>): WorkflowRunSummary | null {
  const id = nullableNumber(input.id);
  if (id === null) return null;
  return WorkflowRunSummarySchema.parse({
    id,
    name: stringOr("Workflow run", input.name) || stringOr("Workflow run", input.display_title),
    status: stringOrNull(input.status),
    conclusion: stringOrNull(input.conclusion),
    event: stringOrNull(input.event),
    branch: stringOrNull(input.head_branch),
    headSha: stringOrNull(input.head_sha),
    url: stringOrNull(input.html_url),
    createdAt: stringOr(nowIso(), input.created_at),
    updatedAt: stringOr(nowIso(), input.updated_at),
    runStartedAt: stringOrNull(input.run_started_at),
  });
}

function rateLimitFromHeaders(headers: Headers): GitHubRateLimitDiagnostics {
  const reset = nullableNumber(headers.get("x-ratelimit-reset"));
  return {
    limit: nullableNumber(headers.get("x-ratelimit-limit")),
    remaining: nullableNumber(headers.get("x-ratelimit-remaining")),
    resetAt: reset === null ? null : new Date(reset * 1000).toISOString(),
    retryAfterSeconds: nullableNumber(headers.get("retry-after")),
  };
}

async function readResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GitHubClientError("GitHub returned invalid JSON.", "invalid_response", response.status);
  }
}

function githubErrorMessage(payload: unknown, status: number): string {
  if (isRecord(payload) && typeof payload.message === "string") return payload.message;
  return `GitHub request failed with HTTP ${status}.`;
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function stringOr(fallback: string, value: unknown): string {
  return typeof value === "string" ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function numberOr(fallback: number, value: unknown): number {
  return nullableNumber(value) ?? fallback;
}

function failInvalid(message: string): never {
  throw new GitHubClientError(message, "invalid_response");
}
