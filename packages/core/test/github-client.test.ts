import { describe, expect, it } from "vitest";
import { GitHubClientError, GitHubFetch, GitHubRestClient } from "../src/index";

const endpoint = "https://api.github.test";
const timestamp = "2026-05-13T10:00:00.000Z";

describe("github rest client", () => {
  it("checks repository health with redacted bearer auth at the boundary", async () => {
    const client = githubClient(
      async (input, init) => {
        expect(input).toBe(`${endpoint}/repos/agora-creations/symphonia`);
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer github-secret");
        expect((init?.headers as Record<string, string>)["X-GitHub-Api-Version"]).toBe("2022-11-28");
        return jsonResponse(repoPayload(), 200, { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "4999" });
      },
      { token: "github-secret" },
    );

    await expect(client.healthCheck()).resolves.toMatchObject({
      enabled: true,
      healthy: true,
      error: null,
      rateLimit: { limit: 5000, remaining: 4999 },
    });
  });

  it("surfaces unauthorized, not found, and rate-limit responses", async () => {
    await expect(githubClient(async () => jsonResponse({ message: "Bad credentials" }, 401)).healthCheck()).rejects.toMatchObject({
      code: "http",
      status: 401,
      message: "Bad credentials",
    });

    await expect(githubClient(async () => jsonResponse({ message: "Not Found" }, 404)).getRepository()).rejects.toMatchObject({
      code: "http",
      status: 404,
      message: "Not Found",
    });

    await expect(
      githubClient(async () =>
        jsonResponse({ message: "API rate limit exceeded" }, 403, {
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1770000000",
          "retry-after": "120",
        }),
      ).getRepository(),
    ).rejects.toMatchObject({
      code: "rate_limit",
      status: 403,
      rateLimit: {
        limit: 60,
        remaining: 0,
        retryAfterSeconds: 120,
      },
    });
  });

  it("paginates pull requests and looks up by head branch", async () => {
    const requestedUrls: string[] = [];
    const client = githubClient(async (input) => {
      requestedUrls.push(input);
      const url = new URL(input);
      expect(url.searchParams.get("head")).toBe("agora-creations:feature/ENG-1");
      if (url.searchParams.get("page") === "1") {
        return jsonResponse([prPayload(1), prPayload(2)]);
      }
      return jsonResponse([prPayload(3, { title: "ENG-3: third" })]);
    });

    const prs = await client.listPullRequests({ headBranch: "feature/ENG-1" });

    expect(prs.map((pr) => pr.number)).toEqual([1, 2, 3]);
    expect(requestedUrls).toHaveLength(2);
  });

  it("fetches pull request files", async () => {
    const client = githubClient(async (input) => {
      expect(input).toContain("/repos/agora-creations/symphonia/pulls/42/files");
      return jsonResponse([
        {
          filename: "packages/core/src/index.ts",
          status: "modified",
          additions: 3,
          deletions: 1,
          patch: "@@ -1 +1 @@",
        },
      ]);
    });

    await expect(client.listPullRequestFiles(42)).resolves.toEqual([
      {
        path: "packages/core/src/index.ts",
        status: "modified",
        additions: 3,
        deletions: 1,
        isBinary: false,
        oldPath: null,
        patch: "@@ -1 +1 @@",
        source: "github_pr",
      },
    ]);
  });

  it("fetches compare, combined status, check runs, and workflow runs", async () => {
    const client = githubClient(async (input) => {
      if (input.includes("/compare/main...abc123")) {
        return jsonResponse({
          total_files: 1,
          total_additions: 7,
          total_deletions: 2,
          files: [{ filename: "README.md", status: "modified", additions: 7, deletions: 2, patch: "@@" }],
        });
      }
      if (input.includes("/commits/abc123/status")) {
        return jsonResponse({
          state: "success",
          total_count: 1,
          sha: "abc123",
          statuses: [
            {
              id: 10,
              context: "ci/test",
              state: "success",
              description: "Tests passed",
              target_url: "https://github.test/status/10",
              created_at: timestamp,
              updated_at: timestamp,
            },
          ],
        });
      }
      if (input.includes("/commits/abc123/check-runs")) {
        return jsonResponse({
          check_runs: [
            {
              id: 11,
              name: "build",
              status: "completed",
              conclusion: "success",
              started_at: timestamp,
              completed_at: timestamp,
              html_url: "https://github.test/checks/11",
              details_url: "https://github.test/checks/11/details",
              app: { name: "GitHub Actions" },
            },
          ],
        });
      }
      if (input.includes("/actions/runs")) {
        const url = new URL(input);
        expect(url.searchParams.get("head_sha")).toBe("abc123");
        return jsonResponse({
          workflow_runs: [
            {
              id: 12,
              name: "CI",
              status: "completed",
              conclusion: "success",
              event: "push",
              head_branch: "feature/ENG-1",
              head_sha: "abc123",
              html_url: "https://github.test/actions/runs/12",
              created_at: timestamp,
              updated_at: timestamp,
              run_started_at: timestamp,
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${input}`);
    });

    await expect(client.compareCommits("main", "abc123")).resolves.toMatchObject({
      filesChanged: 1,
      additions: 7,
      deletions: 2,
      files: [{ source: "github_compare" }],
    });
    await expect(client.getCombinedCommitStatus("abc123")).resolves.toMatchObject({
      state: "success",
      totalCount: 1,
      statuses: [{ context: "ci/test" }],
    });
    await expect(client.listCheckRunsForRef("abc123")).resolves.toMatchObject([{ name: "build", appName: "GitHub Actions" }]);
    await expect(client.listWorkflowRuns({ headSha: "abc123" })).resolves.toMatchObject([{ name: "CI", headSha: "abc123" }]);
  });

  it("guards pull request creation behind explicit write options", async () => {
    const client = githubClient(async () => jsonResponse(prPayload(44, { title: "ENG-44: created" })));

    await expect(
      client.createPullRequest({
        title: "ENG-44: created",
        body: "body",
        head: "feature/ENG-44",
        base: "main",
        draft: true,
        writeEnabled: false,
        allowCreatePr: false,
      }),
    ).rejects.toBeInstanceOf(GitHubClientError);

    await expect(
      client.createPullRequest({
        title: "ENG-44: created",
        body: "body",
        head: "feature/ENG-44",
        base: "main",
        draft: true,
        writeEnabled: true,
        allowCreatePr: true,
      }),
    ).resolves.toMatchObject({
      number: 44,
      title: "ENG-44: created",
      draft: false,
    });
  });
});

function githubClient(fetch: GitHubFetch, overrides: Partial<ConstructorParameters<typeof GitHubRestClient>[0]> = {}) {
  return new GitHubRestClient({
    endpoint,
    owner: "agora-creations",
    repo: "symphonia",
    token: "token",
    pageSize: 2,
    maxPages: 2,
    fetch,
    ...overrides,
  });
}

function repoPayload() {
  return {
    id: 1,
    name: "symphonia",
    full_name: "agora-creations/symphonia",
    default_branch: "main",
    html_url: "https://github.test/agora-creations/symphonia",
  };
}

function prPayload(number: number, overrides: Record<string, unknown> = {}) {
  return {
    id: 1000 + number,
    number,
    title: `ENG-${number}: test PR`,
    html_url: `https://github.test/agora-creations/symphonia/pull/${number}`,
    state: "open",
    draft: false,
    merged: false,
    mergeable: true,
    head: { ref: `feature/ENG-${number}`, sha: `head-sha-${number}` },
    base: { ref: "main", sha: "base-sha" },
    user: { login: "octocat" },
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
