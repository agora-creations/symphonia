import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { Issue, Run, WorkspaceInfo, WorkflowDefinition } from "@symphonia/types";
import { GitHubFetch, refreshReviewArtifacts, resolveWorkflowConfig } from "../src/index";

const timestamp = "2026-05-13T10:00:00.000Z";
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("review artifact refresh", () => {
  it("creates a local-only snapshot when GitHub is disabled", async () => {
    const workspacePath = initRepo();
    writeFileSync(join(workspacePath, "README.md"), "hello\nchanged\n");

    const result = await refreshReviewArtifacts({
      run: run(),
      issue: issue(),
      workspace: workspace(workspacePath),
      workflowConfig: workflowConfig({ github: { enabled: false } }),
    });

    expect(result.health).toBeNull();
    expect(result.snapshot).toMatchObject({
      runId: "run-1",
      issueIdentifier: "ENG-1",
      trackerKind: "linear",
      pr: null,
      commitStatus: null,
      error: null,
    });
    expect(result.snapshot.git.isGitRepo).toBe(true);
    expect(result.snapshot.diff.files).toEqual([expect.objectContaining({ path: "README.md", source: "local" })]);
    expect(result.events.map((event) => event.type)).toContain("github.review_artifacts.refreshed");
  });

  it("returns local artifacts with a clear error when GitHub token is missing", async () => {
    const workspacePath = initRepo();

    const result = await refreshReviewArtifacts({
      run: run(),
      issue: issue("linear"),
      workspace: workspace(workspacePath),
      workflowConfig: workflowConfig({
        github: { enabled: true, owner: "agora-creations", repo: "symphonia" },
      }),
    });

    expect(result.health).toMatchObject({ enabled: true, healthy: false });
    expect(result.snapshot.error).toContain("token is not configured");
    expect(JSON.stringify(result.snapshot)).not.toContain("github-secret");
  });

  it("creates a GitHub-backed snapshot with PR files and CI artifacts", async () => {
    const workspacePath = initRepo("feature/ENG-1");
    const fetch = githubFetch({
      prList: [prPayload(7)],
      prFiles: [{ filename: "apps/daemon/src/daemon.ts", status: "modified", additions: 4, deletions: 2, patch: "@@" }],
    });

    const result = await refreshReviewArtifacts({
      run: run(),
      issue: issue("linear"),
      workspace: workspace(workspacePath),
      workflowConfig: workflowConfig({
        github: {
          enabled: true,
          token: "github-secret",
          owner: "agora-creations",
          repo: "symphonia",
          default_base_branch: "main",
        },
      }),
      githubFetch: fetch,
    });

    expect(result.health).toMatchObject({ healthy: true, error: null });
    expect(result.snapshot.pr).toMatchObject({ number: 7, headBranch: "feature/ENG-1" });
    expect(result.snapshot.diff.files).toEqual([expect.objectContaining({ path: "apps/daemon/src/daemon.ts", source: "github_pr" })]);
    expect(result.snapshot.commitStatus).toMatchObject({ state: "success", totalCount: 1 });
    expect(result.snapshot.checks).toEqual([expect.objectContaining({ name: "build" })]);
    expect(result.snapshot.workflowRuns).toEqual([expect.objectContaining({ name: "CI" })]);
    expect(result.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "github.health.checked",
        "github.pr.found",
        "github.pr.files.fetched",
        "github.status.fetched",
        "github.checks.fetched",
        "github.workflow_runs.fetched",
        "github.review_artifacts.refreshed",
      ]),
    );
  });

  it("reports no PR found without crashing", async () => {
    const workspacePath = initRepo("feature/ENG-404");
    const result = await refreshReviewArtifacts({
      run: run(),
      issue: issue(),
      workspace: workspace(workspacePath),
      workflowConfig: workflowConfig({
        github: { enabled: true, token: "github-secret", owner: "agora-creations", repo: "symphonia" },
      }),
      githubFetch: githubFetch({ prList: [] }),
    });

    expect(result.snapshot.pr).toBeNull();
    expect(result.snapshot.error).toBeNull();
    expect(result.events.map((event) => event.type)).toContain("github.pr.not_found");
  });

  it("returns partial snapshots when GitHub API calls fail", async () => {
    const workspacePath = initRepo("feature/ENG-500");
    const result = await refreshReviewArtifacts({
      run: run(),
      issue: issue(),
      workspace: workspace(workspacePath),
      workflowConfig: workflowConfig({
        github: { enabled: true, token: "github-secret", owner: "agora-creations", repo: "symphonia" },
      }),
      githubFetch: async (input) => {
        if (input.includes("/repos/agora-creations/symphonia") && !input.includes("/pulls")) {
          return jsonResponse({ id: 1, name: "symphonia" });
        }
        return jsonResponse({ message: "GitHub unavailable" }, 503);
      },
    });

    expect(result.snapshot.git.isGitRepo).toBe(true);
    expect(result.snapshot.error).toBe("GitHub unavailable");
    expect(result.events.map((event) => event.type)).toContain("github.error");
  });
});

function workflowConfig(config: Record<string, unknown>) {
  return resolveWorkflowConfig({
    config: {
      tracker: { kind: "linear", api_key: "linear-test-key", allow_workspace_wide: true },
      workspace: { root: ".symphonia/workspaces" },
      ...config,
    },
    promptTemplate: "Prompt",
    workflowPath: "/repo/WORKFLOW.md",
    loadedAt: timestamp,
  } satisfies WorkflowDefinition);
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "symphonia-review-artifacts-"));
  tempDirs.push(dir);
  return dir;
}

function initRepo(branch = "main"): string {
  const workspacePath = tempDir();
  git(workspacePath, ["init"]);
  git(workspacePath, ["config", "user.email", "test@example.com"]);
  git(workspacePath, ["config", "user.name", "Symphonia Test"]);
  git(workspacePath, ["branch", "-M", "main"]);
  writeFileSync(join(workspacePath, "README.md"), "hello\n");
  git(workspacePath, ["add", "README.md"]);
  git(workspacePath, ["commit", "-m", "Initial commit"]);
  if (branch !== "main") {
    git(workspacePath, ["checkout", "-b", branch]);
  }
  return workspacePath;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
}

function workspace(path: string): WorkspaceInfo {
  return {
    issueIdentifier: "ENG-1",
    workspaceKey: "ENG-1",
    path,
    createdNow: false,
    exists: true,
  };
}

function run(): Run {
  return {
    id: "run-1",
    issueId: "issue-1",
    issueIdentifier: "ENG-1",
    status: "succeeded",
    provider: "codex",
    startedAt: timestamp,
    endedAt: timestamp,
    error: null,
  };
}

function issue(kind: "linear" = "linear"): Issue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Issue title",
    description: "Issue description",
    state: "Todo",
    labels: ["backend"],
    priority: "High",
    createdAt: timestamp,
    updatedAt: timestamp,
    url: kind === "linear" ? "https://linear.app/acme/issue/ENG-1" : "https://example.com/issues/ENG-1",
    tracker: { kind, sourceId: "issue-1" },
  };
}

function githubFetch(input: { prList: unknown[]; prFiles?: unknown[] }): GitHubFetch {
  return async (url) => {
    if (url.includes("/repos/agora-creations/symphonia") && !url.includes("/pulls") && !url.includes("/commits") && !url.includes("/actions")) {
      return jsonResponse({ id: 1, name: "symphonia" });
    }
    if (url.includes("/pulls?")) {
      return jsonResponse(input.prList);
    }
    if (url.includes("/pulls/7/files")) {
      return jsonResponse(input.prFiles ?? []);
    }
    if (url.includes("/commits/head-sha-7/status") || url.includes("/commits/") && url.includes("/status")) {
      return jsonResponse({
        state: "success",
        total_count: 1,
        sha: "head-sha-7",
        statuses: [
          {
            id: 100,
            context: "ci/test",
            state: "success",
            target_url: "https://github.test/status/100",
            created_at: timestamp,
            updated_at: timestamp,
          },
        ],
      });
    }
    if (url.includes("/check-runs")) {
      return jsonResponse({
        check_runs: [
          {
            id: 101,
            name: "build",
            status: "completed",
            conclusion: "success",
            html_url: "https://github.test/checks/101",
            app: { name: "GitHub Actions" },
          },
        ],
      });
    }
    if (url.includes("/actions/runs")) {
      return jsonResponse({
        workflow_runs: [
          {
            id: 102,
            name: "CI",
            status: "completed",
            conclusion: "success",
            event: "push",
            head_branch: "feature/ENG-1",
            head_sha: "head-sha-7",
            html_url: "https://github.test/actions/runs/102",
            created_at: timestamp,
            updated_at: timestamp,
            run_started_at: timestamp,
          },
        ],
      });
    }
    throw new Error(`Unexpected GitHub URL: ${url}`);
  };
}

function prPayload(number: number) {
  return {
    id: 1000 + number,
    number,
    title: "ENG-1: test PR",
    html_url: `https://github.test/agora-creations/symphonia/pull/${number}`,
    state: "open",
    draft: true,
    merged: false,
    mergeable: true,
    head: { ref: "feature/ENG-1", sha: `head-sha-${number}` },
    base: { ref: "main", sha: "base-sha" },
    user: { login: "octocat" },
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
