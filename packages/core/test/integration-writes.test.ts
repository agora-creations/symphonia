import { describe, expect, it } from "vitest";
import { AuthResolvedCredential, GitHubFetch, GitHubRestClient, LinearGraphqlClient } from "../src/index";
import {
  buildGitHubPrPreview,
  buildLinearCommentPreview,
  executeGitHubPrCreate,
  executeLinearCommentCreate,
} from "../src/integration-writes";
import { Issue, ReviewArtifactSnapshot, Run, WorkflowDefinition } from "@symphonia/types";
import { resolveWorkflowConfig } from "../src/workflow";

const timestamp = "2026-05-14T10:00:00.000Z";

describe("integration write previews and execution", () => {
  it("builds blocked previews when writes are disabled by default", async () => {
    const workflowConfig = resolveWorkflowConfig(definition());
    const preview = await buildGitHubPrPreview({
      run: run(),
      issue: issue(),
      workflowConfig,
      reviewArtifacts: reviewArtifacts(),
      credential: credential("github"),
      githubClient: githubClient(async () => jsonResponse([])),
      now: now(),
    });

    expect(preview.status).toBe("blocked");
    expect(preview.blockers).toEqual(expect.arrayContaining(["GitHub read_only is true.", "GitHub writes are disabled."]));
    expect(preview.bodyPreview).toContain("symphonia-run-id");
    expect(JSON.stringify(preview)).not.toContain("ghu_secret");
  });

  it("builds a GitHub PR preview and creates a draft PR after confirmation", async () => {
    const workflowConfig = resolveWorkflowConfig(
      definition({
        github: {
          enabled: true,
          owner: "agora-creations",
          repo: "symphonia",
          read_only: false,
          write: { enabled: true, allow_create_pr: true },
        },
      }),
    );
    let created = false;
    const client = githubClient(async (input, init) => {
      if (input.includes("/pulls?")) return jsonResponse([]);
      if (input.endsWith("/pulls") && init?.method === "POST") {
        created = true;
        const body = JSON.parse(String(init.body)) as { draft: boolean; title: string; head: string; base: string };
        expect(body).toMatchObject({ draft: true, title: "ENG-101: Linear-backed daemon test", head: "feature/ENG-101", base: "main" });
        return jsonResponse(prPayload(77, { title: body.title, draft: body.draft }));
      }
      return jsonResponse({ message: `Unexpected URL: ${input}` }, 404);
    });
    const preview = await buildGitHubPrPreview({
      run: run(),
      issue: issue(),
      workflowConfig,
      reviewArtifacts: reviewArtifacts(),
      credential: credential("github"),
      githubClient: client,
      now: now(),
    });

    expect(preview.status).toBe("pending_confirmation");
    expect(preview.blockers).toEqual([]);

    await expect(
      executeGitHubPrCreate({
        preview,
        request: { previewId: preview.id, confirmation: "wrong", dryRun: false, idempotencyKey: "one" },
        workflowConfig,
        credential: credential("github"),
        githubClient: client,
      }),
    ).rejects.toThrow("Confirmation phrase");

    const result = await executeGitHubPrCreate({
      preview,
      request: { previewId: preview.id, confirmation: "CREATE GITHUB PR", dryRun: false, idempotencyKey: "one" },
      workflowConfig,
      credential: credential("github"),
      githubClient: client,
    });

    expect(created).toBe(true);
    expect(result).toMatchObject({ status: "succeeded", externalId: "77", githubPr: { number: 77, draft: true } });
    expect(JSON.stringify(result)).not.toContain("ghu_secret");
  });

  it("fails PR preview on unknown template variables without writing", async () => {
    const workflowConfig = resolveWorkflowConfig(
      definition({
        github: {
          enabled: true,
          owner: "agora-creations",
          repo: "symphonia",
          read_only: false,
          write: {
            enabled: true,
            allow_create_pr: true,
            pr_title_template: "{{ issue.identifier }}",
            pr_body_template: "{{ missing.value }}",
          },
        },
      }),
    );
    const preview = await buildGitHubPrPreview({
      run: run(),
      issue: issue(),
      workflowConfig,
      reviewArtifacts: reviewArtifacts(),
      credential: credential("github"),
      githubClient: githubClient(async () => jsonResponse([])),
      now: now(),
    });

    expect(preview.status).toBe("blocked");
    expect(preview.blockers.join("\n")).toContain("Unknown template variable");
  });

  it("reports GitHub PR blockers for missing credentials, protected branches, and existing PRs", async () => {
    const workflowConfig = resolveWorkflowConfig(
      definition({
        github: {
          enabled: true,
          owner: "agora-creations",
          repo: "symphonia",
          read_only: false,
          write: { enabled: true, allow_create_pr: true },
        },
      }),
    );
    const protectedBranchArtifacts = reviewArtifacts();
    protectedBranchArtifacts.git.currentBranch = "main";

    const protectedPreview = await buildGitHubPrPreview({
      run: run(),
      issue: issue(),
      workflowConfig,
      reviewArtifacts: protectedBranchArtifacts,
      credential: null,
      githubClient: githubClient(async () => jsonResponse([])),
      now: now(),
    });
    expect(protectedPreview.status).toBe("blocked");
    expect(protectedPreview.blockers).toEqual(
      expect.arrayContaining(["GitHub credentials are unavailable.", "Branch main is protected and cannot be used as a PR head."]),
    );

    const existingPreview = await buildGitHubPrPreview({
      run: run(),
      issue: issue(),
      workflowConfig,
      reviewArtifacts: { ...reviewArtifacts(), pr: prSummary(12) },
      credential: credential("github"),
      githubClient: githubClient(async () => jsonResponse([])),
      now: now(),
    });
    expect(existingPreview.status).toBe("blocked");
    expect(existingPreview.blockers.join("\n")).toContain("Existing PR #12");
  });

  it("warns that branch push is deferred instead of pushing during PR preview", async () => {
    const workflowConfig = resolveWorkflowConfig(
      definition({
        github: {
          enabled: true,
          owner: "agora-creations",
          repo: "symphonia",
          read_only: false,
          write: { enabled: true, allow_create_pr: true, allow_push: false },
        },
      }),
    );
    const preview = await buildGitHubPrPreview({
      run: run(),
      issue: issue(),
      workflowConfig,
      reviewArtifacts: reviewArtifacts(),
      credential: credential("github"),
      githubClient: githubClient(async () => jsonResponse([])),
      now: now(),
    });

    expect(preview.blockers).toEqual([]);
    expect(preview.warnings.join("\n")).toContain("will not push branches");
  });

  it("builds and posts a Linear comment after confirmation", async () => {
    const workflowConfig = resolveWorkflowConfig(
      definition({
        tracker: {
          ...linearTracker(),
          read_only: false,
          write: { enabled: true, allow_comments: true, allow_state_transitions: false },
        },
      }),
    );
    const preview = buildLinearCommentPreview({
      run: run(),
      issue: issue(),
      workflowConfig,
      credential: credential("linear"),
      now: now(),
    });
    expect(preview.status).toBe("pending_confirmation");

    const result = await executeLinearCommentCreate({
      preview,
      request: { previewId: preview.id, confirmation: "POST LINEAR COMMENT", dryRun: false, idempotencyKey: "linear-one" },
      workflowConfig,
      credential: credential("linear"),
      linearClient: new LinearGraphqlClient({
        endpoint: "https://api.linear.test/graphql",
        apiKey: "Bearer lin_secret",
        fetch: async () =>
          jsonResponse({
            data: {
              commentCreate: {
                success: true,
                comment: { id: "comment-1", url: "https://linear.app/acme/issue/ENG-101#comment-1", createdAt: timestamp },
              },
            },
          }),
      }),
      now: now(),
    });

    expect(result).toMatchObject({ status: "succeeded", externalId: "comment-1" });
    expect(result.linearComment?.bodyPreview).toContain("symphonia-run-id");
    expect(JSON.stringify(result)).not.toContain("lin_secret");
  });

  it("reports Linear comment blockers when writes or credentials are unavailable", () => {
    const workflowConfig = resolveWorkflowConfig(definition({ tracker: { ...linearTracker(), read_only: false } }));
    const preview = buildLinearCommentPreview({
      run: run(),
      issue: issue(),
      workflowConfig,
      credential: null,
      now: now(),
    });

    expect(preview.status).toBe("blocked");
    expect(preview.blockers).toEqual(expect.arrayContaining(["Linear writes are disabled.", "Linear comments are disabled.", "Linear credentials are unavailable."]));
  });

  it("keeps Linear state transitions blocked for comment execution", async () => {
    const workflowConfig = resolveWorkflowConfig(
      definition({
        tracker: {
          ...linearTracker(),
          read_only: false,
          write: { enabled: true, allow_comments: true, allow_state_transitions: true },
        },
      }),
    );
    const preview = buildLinearCommentPreview({
      run: run(),
      issue: issue(),
      workflowConfig,
      credential: credential("linear"),
      now: now(),
    });
    const result = await executeLinearCommentCreate({
      preview,
      request: { previewId: preview.id, confirmation: "POST LINEAR COMMENT", dryRun: false, idempotencyKey: null },
      workflowConfig,
      credential: credential("linear"),
      linearClient: new LinearGraphqlClient({ endpoint: "https://api.linear.test/graphql", apiKey: "lin", fetch: async () => jsonResponse({ data: {} }) }),
      now: now(),
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("Linear state transitions are not supported");
  });
});

function now() {
  return new Date().toISOString();
}

function definition(config: Record<string, unknown> = {}): WorkflowDefinition {
  return {
    config: {
      tracker: linearTracker(),
      ...config,
    },
    promptTemplate: "Prompt",
    workflowPath: "/tmp/WORKFLOW.md",
    loadedAt: timestamp,
  };
}

function linearTracker() {
  return {
    kind: "linear",
    api_key: "linear-test-key",
    allow_workspace_wide: true,
    read_only: true,
  };
}

function issue(): Issue {
  return {
    id: "linear-issue-101",
    identifier: "ENG-101",
    title: "Linear-backed daemon test",
    description: "Test issue",
    state: "Todo",
    labels: ["backend"],
    priority: "High",
    createdAt: timestamp,
    updatedAt: timestamp,
    url: "https://linear.app/acme/issue/ENG-101",
    tracker: { kind: "linear", sourceId: "linear-issue-101" },
  };
}

function run(): Run {
  return {
    id: "run-1",
    issueId: "linear-issue-101",
    issueIdentifier: "ENG-101",
    issueTitle: "Linear-backed daemon test",
    trackerKind: "linear",
    status: "succeeded",
    provider: "codex",
    attempt: 1,
    retryOfRunId: null,
    workspacePath: "/tmp/workspaces/ENG-101",
    renderedPromptId: null,
    providerMetadata: {},
    startedAt: timestamp,
    updatedAt: timestamp,
    endedAt: timestamp,
    lastEventAt: timestamp,
    terminalReason: "completed",
    error: null,
    recoveryState: "none",
    recoveredAt: null,
    createdByDaemonInstanceId: "daemon-1",
    lastSeenDaemonInstanceId: "daemon-1",
  };
}

function reviewArtifacts(): ReviewArtifactSnapshot {
  return {
    runId: "run-1",
    issueId: "linear-issue-101",
    issueIdentifier: "ENG-101",
    provider: "codex",
    trackerKind: "linear",
    workspace: { issueIdentifier: "ENG-101", workspaceKey: "ENG-101", path: "/tmp/workspaces/ENG-101", createdNow: false, exists: true },
    git: {
      workspacePath: "/tmp/workspaces/ENG-101",
      isGitRepo: true,
      remoteUrl: "https://github.com/agora-creations/symphonia.git",
      remoteName: "origin",
      currentBranch: "feature/ENG-101",
      baseBranch: "main",
      headSha: "abc123",
      baseSha: "base123",
      mergeBaseSha: "base123",
      isDirty: false,
      changedFileCount: 1,
      untrackedFileCount: 0,
      stagedFileCount: 0,
      unstagedFileCount: 0,
      lastCheckedAt: timestamp,
    },
    pr: null,
    diff: {
      filesChanged: 1,
      additions: 2,
      deletions: 1,
      files: [{ path: "README.md", status: "modified", additions: 2, deletions: 1, isBinary: false, oldPath: null, patch: "@@", source: "local" }],
    },
    checks: [],
    commitStatus: null,
    workflowRuns: [],
    lastRefreshedAt: timestamp,
    error: null,
  };
}

function credential(provider: "github" | "linear"): AuthResolvedCredential {
  return {
    provider,
    source: "connected",
    token: provider === "github" ? "ghu_secret" : "lin_secret",
    authorizationHeader: provider === "github" ? "Bearer ghu_secret" : "Bearer lin_secret",
    connection: {
      id: `${provider}-connected`,
      provider,
      method: provider === "github" ? "oauth_device" : "oauth_pkce",
      status: "connected",
      accountLabel: provider === "github" ? "octocat" : "Linear User",
      accountId: "account-1",
      workspaceLabel: null,
      workspaceId: null,
      scopes: provider === "github" ? ["repo"] : ["read"],
      permissions: [],
      tokenStorage: "memory",
      tokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      connectedAt: timestamp,
      lastValidatedAt: timestamp,
      lastError: null,
      redactedSource: "connected:abc123...7890",
      credentialSource: "connected",
      refreshSupported: false,
      envTokenPresent: false,
      clientIdConfigured: true,
      clientSecretConfigured: false,
    },
  };
}

function githubClient(fetch: GitHubFetch) {
  return new GitHubRestClient({
    endpoint: "https://api.github.test",
    owner: "agora-creations",
    repo: "symphonia",
    token: "ghu_secret",
    pageSize: 20,
    maxPages: 1,
    fetch,
  });
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

function prSummary(number: number): ReviewArtifactSnapshot["pr"] {
  return {
    id: 1000 + number,
    number,
    title: `ENG-${number}: test PR`,
    url: `https://github.test/agora-creations/symphonia/pull/${number}`,
    state: "open",
    draft: false,
    merged: false,
    mergeable: true,
    baseBranch: "main",
    headBranch: "feature/ENG-101",
    headSha: "abc123",
    baseSha: "base123",
    author: "octocat",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
