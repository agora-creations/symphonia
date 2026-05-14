import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "@symphonia/db";
import { AuthFetch, GitHubFetch, LinearFetch } from "@symphonia/core";
import { AgentEvent, ApprovalState, WorkflowStatus } from "@symphonia/types";
import { createDaemonServer, SymphoniaDaemon } from "../src/daemon";

let directory: string;
let daemon: SymphoniaDaemon;
let workflowPath: string;
const originalEnv = { ...process.env };

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "symphonia-daemon-"));
  process.env.SYMPHONIA_AUTH_STORE_PATH = join(directory, "auth-tokens.enc.json");
  workflowPath = join(directory, "WORKFLOW.md");
  writeWorkflow();

  const created = createDaemonServer(new EventStore(join(directory, "test.sqlite")), {
    workflowPath,
    cwd: directory,
    linearFetch: fakeLinearFetch({ state: "Todo" }),
  });
  daemon = created.daemon;
});

afterEach(() => {
  daemon.close();
  rmSync(directory, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe("daemon API", () => {
  it("creates an HTTP server", () => {
    const { server } = createDaemonServer(new EventStore(join(directory, "second.sqlite")));

    expect(server.listening).toBe(false);
    server.close();
  });

  it("reports workflow status and redacted config", () => {
    const status = daemon.refreshWorkflowStatus();

    expect(status.status).toBe("healthy");
    expect(status.effectiveConfigSummary?.trackerKind).toBe("linear");
    expect(JSON.stringify(status.effectiveConfigSummary)).not.toContain("apiKey");
  });

  it("reports provider health without crashing", async () => {
    const providers = await daemon.listProviderHealth();

    expect(providers.some((provider) => provider.id === "codex")).toBe(true);
    expect(providers.some((provider) => provider.id === "claude" && provider.status === "disabled")).toBe(true);
    expect(providers.some((provider) => provider.id === "cursor" && provider.status === "disabled")).toBe(true);

    writeWorkflow({ codexCommand: "definitely-not-a-symphonia-command" });
    daemon.refreshWorkflowStatus();
    const codex = await daemon.getProviderHealth("codex");
    expect(codex.available).toBe(false);

    const claudeHealth = await requestJson<{ provider: { id: string; available: boolean } }>("GET", "/providers/claude/health");
    const cursorHealth = await requestJson<{ provider: { id: string; available: boolean } }>("GET", "/providers/cursor/health");
    expect(claudeHealth.provider.id).toBe("claude");
    expect(cursorHealth.provider.id).toBe("cursor");
  });

  it("reports tracker status and refreshes real Linear issue cache through a test transport", async () => {
    const status = daemon.getTrackerStatus();

    expect(status.kind).toBe("linear");
    expect(status.config?.trackerKind).toBe("linear");
    expect(JSON.stringify(status)).not.toContain("apiKey");

    const issues = await daemon.refreshIssueCache();
    expect(issues.some((issue) => issue.identifier === "ENG-101")).toBe(true);
    expect(daemon.getTrackerStatus().issueCount).toBeGreaterThan(0);
  });

  it("reports github status and health without requiring credentials by default", async () => {
    const status = daemon.getGithubStatus();
    const health = await daemon.getGithubHealth();

    expect(status).toMatchObject({ enabled: false, status: "disabled" });
    expect(health).toMatchObject({ enabled: false, healthy: true, error: null });
  });

  it("reports fake github health with redacted token", async () => {
    const created = createDaemonServer(new EventStore(join(directory, "github.sqlite")), {
      workflowPath,
      cwd: directory,
      githubFetch: fakeGitHubFetch(),
    });
    daemon.close();
    daemon = created.daemon;
    writeWorkflow({ githubToken: "github-secret" });

    const health = await daemon.getGithubHealth();
    const status = daemon.getGithubStatus();

    expect(health).toMatchObject({ enabled: true, healthy: true, error: null });
    expect(status).toMatchObject({ enabled: true, status: "healthy" });
    expect(status.config?.tokenConfigured).toBe(true);
    expect(JSON.stringify(status)).not.toContain("github-secret");
  });

  it("serves auth status, GitHub device flow, Linear PKCE callback, validation, and disconnect without leaking tokens", async () => {
    let githubPolls = 0;
    const created = createDaemonServer(new EventStore(join(directory, "auth.sqlite")), {
      workflowPath,
      cwd: directory,
      authFetch: fakeAuthFetch(() => {
        githubPolls += 1;
        return githubPolls;
      }),
    });
    daemon.close();
    daemon = created.daemon;

    const status = await requestJson<{ auth: { providers: Array<{ provider: string; status: string }> } }>("GET", "/auth/status");
    expect(status.auth.providers.map((provider) => provider.provider)).toEqual(["github", "linear"]);

    const githubStart = await requestJson<{ result: { authSessionId: string; userCode: string } }>(
      "POST",
      "/auth/github/start",
      { method: "oauth_device", requestedScopes: ["repo"], redirectMode: "device", metadata: { clientId: "github-client" } },
    );
    expect(githubStart.result.userCode).toBe("ABCD-1234");
    expect((await requestJson<{ result: { status: string } }>("GET", `/auth/github/poll/${githubStart.result.authSessionId}`)).result.status).toBe(
      "pending_user",
    );
    const githubDone = await requestJson<{ result: { status: string; connection: { accountLabel: string; redactedSource: string } } }>(
      "GET",
      `/auth/github/poll/${githubStart.result.authSessionId}`,
    );
    expect(githubDone.result.status).toBe("connected");
    expect(githubDone.result.connection.accountLabel).toBe("octocat");
    expect(JSON.stringify(githubDone)).not.toContain("ghu_daemon_secret");

    const linearStart = await requestJson<{ result: { authSessionId: string; authorizationUrl: string } }>(
      "POST",
      "/auth/linear/start",
      { method: "oauth_pkce", requestedScopes: ["read"], redirectMode: "loopback", metadata: { clientId: "linear-client" } },
    );
    const state = new URL(linearStart.result.authorizationUrl).searchParams.get("state");
    const callback = await requestRaw("GET", `/auth/linear/callback?code=linear-code&state=${encodeURIComponent(state ?? "")}`);
    expect(callback.statusCode, callback.body).toBe(200);
    expect(callback.body).toContain("connected");

    const linear = await requestJson<{ connection: { accountLabel: string; redactedSource: string } }>("GET", "/auth/linear");
    expect(linear.connection.accountLabel).toBe("Linear User");
    expect(JSON.stringify(linear)).not.toContain("lin_daemon_secret");

    const validation = await requestJson<{ result: { status: string } }>("POST", "/auth/linear/validate");
    expect(validation.result.status).toBe("connected");

    const disconnected = await requestJson<{ connection: { status: string; credentialSource: string } }>("POST", "/auth/github/disconnect", {
      deleteStoredToken: true,
      revokeRemoteTokenIfSupported: false,
    });
    expect(["disconnected", "connected"]).toContain(disconnected.connection.status);
    expect(disconnected.connection.credentialSource).not.toBe("connected");
  });

  it("uses connected GitHub credentials for GitHub health when workflow token is absent", async () => {
    let authorization = "";
    const created = createDaemonServer(new EventStore(join(directory, "github-auth.sqlite")), {
      workflowPath,
      cwd: directory,
      authFetch: fakeAuthFetch(() => 2),
      githubFetch: async (input, init) => {
        authorization = authorizationHeader(init);
        if (input.includes("/repos/agora-creations/symphonia")) {
          return jsonResponse({
            id: 1,
            name: "symphonia",
            full_name: "agora-creations/symphonia",
            default_branch: "main",
          });
        }
        return jsonResponse({ message: `Unexpected GitHub URL: ${input}` }, 404);
      },
    });
    daemon.close();
    daemon = created.daemon;
    writeWorkflow({ githubEnabled: true });

    const started = await requestJson<{ result: { authSessionId: string } }>("POST", "/auth/github/start", {
      method: "oauth_device",
      requestedScopes: ["repo"],
      redirectMode: "device",
      metadata: { clientId: "github-client" },
    });
    const polled = await requestJson<{ result: { status: string } }>("GET", `/auth/github/poll/${started.result.authSessionId}`);
    expect(polled.result.status).toBe("connected");

    const health = await daemon.getGithubHealth();

    expect(health).toMatchObject({ enabled: true, healthy: true, error: null });
    expect(authorization).toBe("Bearer ghu_daemon_secret");
    expect(JSON.stringify(health)).not.toContain("ghu_daemon_secret");
  });

  it("uses connected Linear credentials when workflow api_key is omitted", async () => {
    let authorization = "";
    const created = createDaemonServer(new EventStore(join(directory, "linear-auth.sqlite")), {
      workflowPath,
      cwd: directory,
      authFetch: fakeAuthFetch(() => 2),
      linearFetch: async (input, init) => {
        authorization = authorizationHeader(init);
        return fakeLinearFetch({ state: "Todo" })(input, init);
      },
    });
    daemon.close();
    daemon = created.daemon;
    writeLinearWorkflow({ apiKey: null });

    const manual = await requestJson<{ result: { status: string } }>("POST", "/auth/linear/start", {
      method: "manual_token",
      requestedScopes: ["read"],
      redirectMode: "manual",
      metadata: { token: "Bearer lin_connected_secret" },
    });
    expect(manual.result.status).toBe("connected");

    const issues = await daemon.refreshIssueCache();

    expect(issues[0]?.identifier).toBe("ENG-101");
    expect(authorization).toBe("Bearer lin_connected_secret");
    expect(JSON.stringify(issues)).not.toContain("lin_connected_secret");
  });

  it("reports write policies disabled by default", async () => {
    const status = await requestJson<{ writes: { github: { enabled: boolean; readOnly: boolean }; linear: { enabled: boolean; readOnly: boolean } } }>(
      "GET",
      "/writes/status",
    );

    expect(status.writes.github).toMatchObject({ enabled: false, readOnly: true });
    expect(status.writes.linear).toMatchObject({ enabled: false, readOnly: true });
  });

  it("previews and creates a GitHub draft PR only with explicit confirmation", async () => {
    process.env.GITHUB_TOKEN = "ghu_write_secret";
    const created = createDaemonServer(new EventStore(join(directory, "github-writes.sqlite")), {
      workflowPath,
      cwd: directory,
      githubFetch: fakeGitHubWriteFetch(),
      linearFetch: fakeLinearFetch({ state: "Todo" }),
    });
    daemon.close();
    daemon = created.daemon;
    writeWorkflow({
      codexCommand: fakeCodexCommand("success"),
      githubEnabled: true,
      githubReadOnly: false,
      githubWriteEnabled: true,
      githubAllowCreatePr: true,
    });
    prepareGitWorkspace(join(directory, "workspaces", "ENG-101"));
    await daemon.refreshIssueCache();

    const run = await daemon.startRun("linear-issue-101", "codex");
    await waitForTerminal(run.id, "succeeded");
    const workspacePath = daemon.requireRun(run.id).workspacePath;
    expect(workspacePath).toBeTruthy();
    await requestJson("POST", `/runs/${run.id}/review-artifacts/refresh`);

    const previewed = await requestJson<{ preview: { id: string; blockers: string[]; confirmationPhrase: string; githubPr: { title: string } | null } }>(
      "POST",
      `/runs/${run.id}/github/pr/preview`,
      {},
    );
    expect(previewed.preview.blockers).toEqual([]);
    expect(previewed.preview.confirmationPhrase).toBe("CREATE GITHUB PR");
    expect(previewed.preview.githubPr?.title).toContain("ENG-101");
    expect(JSON.stringify(previewed)).not.toContain("ghu_write_secret");

    const startedBeforeInvalid = getEvents(run.id).filter((event) => event.type === "integration.write.started").length;
    const rejected = await requestRaw("POST", `/runs/${run.id}/github/pr/create`, {
      previewId: previewed.preview.id,
      confirmation: "wrong",
      dryRun: false,
      idempotencyKey: "github-pr-test",
    });
    expect(rejected.statusCode).toBe(400);
    expect(getEvents(run.id).filter((event) => event.type === "integration.write.started")).toHaveLength(startedBeforeInvalid);

    const createdPr = await requestJson<{ result: { status: string; externalUrl: string | null; githubPr: { number: number } | null } }>(
      "POST",
      `/runs/${run.id}/github/pr/create`,
      {
        previewId: previewed.preview.id,
        confirmation: "CREATE GITHUB PR",
        dryRun: false,
        idempotencyKey: "github-pr-test",
      },
    );
    expect(createdPr.result).toMatchObject({ status: "succeeded", externalUrl: "https://github.com/agora-creations/symphonia/pull/42" });
    expect(createdPr.result.githubPr?.number).toBe(42);

    const startedAfterCreate = getEvents(run.id).filter((event) => event.type === "integration.write.started").length;
    const replay = await requestJson<{ result: { status: string; externalId: string | null } }>("POST", `/runs/${run.id}/github/pr/create`, {
      previewId: previewed.preview.id,
      confirmation: "CREATE GITHUB PR",
      dryRun: false,
      idempotencyKey: "github-pr-test",
    });
    expect(replay.result).toMatchObject({ status: "succeeded", externalId: "42" });
    expect(getEvents(run.id).filter((event) => event.type === "integration.write.started")).toHaveLength(startedAfterCreate);

    const history = await requestJson<{ writeActions: Array<{ status: string }> }>("GET", `/runs/${run.id}/write-actions`);
    expect(history.writeActions.map((action) => action.status)).toEqual(expect.arrayContaining(["pending_confirmation", "succeeded"]));
    expect(getEvents(run.id).map((event) => event.type)).toEqual(expect.arrayContaining(["integration.write.succeeded", "github.pr.created"]));
    expect(JSON.stringify({ createdPr, history, events: getEvents(run.id) })).not.toContain("ghu_write_secret");
  });

  it("previews and posts Linear comments only with explicit confirmation", async () => {
    process.env.LINEAR_API_KEY = "lin_write_secret";
    const created = createDaemonServer(new EventStore(join(directory, "linear-writes.sqlite")), {
      workflowPath,
      cwd: directory,
      linearFetch: fakeLinearFetch({ state: "Todo" }),
    });
    daemon.close();
    daemon = created.daemon;
    writeLinearWorkflow({
      codexCommand: fakeCodexCommand("success"),
      linearReadOnly: false,
      linearWriteEnabled: true,
      linearAllowComments: true,
    });
    await daemon.refreshIssueCache();

    const run = await daemon.startRun("linear-issue-101", "codex");
    await waitForTerminal(run.id, "succeeded");

    const previewed = await requestJson<{ preview: { id: string; blockers: string[]; confirmationPhrase: string; bodyPreview: string } }>(
      "POST",
      `/runs/${run.id}/linear/comment/preview`,
      {},
    );
    expect(previewed.preview.blockers).toEqual([]);
    expect(previewed.preview.confirmationPhrase).toBe("POST LINEAR COMMENT");
    expect(previewed.preview.bodyPreview).toContain(`symphonia-run-id: ${run.id}`);
    expect(JSON.stringify(previewed)).not.toContain("lin_write_secret");

    const startedBeforeInvalid = getEvents(run.id).filter((event) => event.type === "integration.write.started").length;
    const rejected = await requestRaw("POST", `/runs/${run.id}/linear/comment/create`, {
      previewId: previewed.preview.id,
      confirmation: "wrong",
      dryRun: false,
      idempotencyKey: "linear-comment-test",
    });
    expect(rejected.statusCode).toBe(400);
    expect(getEvents(run.id).filter((event) => event.type === "integration.write.started")).toHaveLength(startedBeforeInvalid);

    const posted = await requestJson<{ result: { status: string; externalId: string | null; linearComment: { id: string } | null } }>(
      "POST",
      `/runs/${run.id}/linear/comment/create`,
      {
        previewId: previewed.preview.id,
        confirmation: "POST LINEAR COMMENT",
        dryRun: false,
        idempotencyKey: "linear-comment-test",
      },
    );
    expect(posted.result).toMatchObject({ status: "succeeded", externalId: "comment-1" });
    expect(posted.result.linearComment?.id).toBe("comment-1");

    const startedAfterPost = getEvents(run.id).filter((event) => event.type === "integration.write.started").length;
    const replay = await requestJson<{ result: { status: string; externalId: string | null } }>("POST", `/runs/${run.id}/linear/comment/create`, {
      previewId: previewed.preview.id,
      confirmation: "POST LINEAR COMMENT",
      dryRun: false,
      idempotencyKey: "linear-comment-test",
    });
    expect(replay.result).toMatchObject({ status: "succeeded", externalId: "comment-1" });
    expect(getEvents(run.id).filter((event) => event.type === "integration.write.started")).toHaveLength(startedAfterPost);

    const secondPreview = await requestJson<{ preview: { id: string } }>("POST", `/runs/${run.id}/linear/comment/preview`, {});
    const reusedKey = await requestRaw("POST", `/runs/${run.id}/linear/comment/create`, {
      previewId: secondPreview.preview.id,
      confirmation: "POST LINEAR COMMENT",
      dryRun: false,
      idempotencyKey: "linear-comment-test",
    });
    expect(reusedKey.statusCode).toBe(409);
    expect(reusedKey.body).toContain("already used for a different write action");

    const dryRunPreview = await requestJson<{ preview: { id: string } }>("POST", `/runs/${run.id}/linear/comment/preview`, {});
    const failedBeforeDryRun = getEvents(run.id).filter((event) => event.type === "integration.write.failed").length;
    const cancelled = await requestJson<{ result: { status: string } }>("POST", `/runs/${run.id}/linear/comment/create`, {
      previewId: dryRunPreview.preview.id,
      confirmation: "POST LINEAR COMMENT",
      dryRun: true,
      idempotencyKey: "linear-dry-run-test",
    });
    expect(cancelled.result.status).toBe("cancelled");
    expect(getEvents(run.id).map((event) => event.type)).toContain("integration.write.cancelled");
    expect(getEvents(run.id).filter((event) => event.type === "integration.write.failed")).toHaveLength(failedBeforeDryRun);

    const history = await requestJson<{ writeActions: Array<{ status: string }> }>("GET", `/runs/${run.id}/write-actions`);
    expect(history.writeActions.map((action) => action.status)).toEqual(expect.arrayContaining(["pending_confirmation", "succeeded", "cancelled"]));
    expect(getEvents(run.id).map((event) => event.type)).toEqual(expect.arrayContaining(["integration.write.succeeded", "linear.comment.created"]));
    expect(JSON.stringify({ posted, history, events: getEvents(run.id) })).not.toContain("lin_write_secret");
  });

  it("serves harness scan, preview, dry-run apply, confirmed apply, and stale preview errors", async () => {
    writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts: { test: "vitest run", lint: "tsc --noEmit", build: "tsc" } }));
    writeFileSync(join(directory, "README.md"), "# Harness target\n");

    const scanned = await requestJson<{ scan: { id: string; score: { percentage: number }; generatedPreviews: unknown[] } }>(
      "POST",
      "/harness/scan",
      { repositoryPath: directory, includeGeneratedPreviews: false },
    );
    expect(scanned.scan.score.percentage).toBeGreaterThan(0);
    expect(scanned.scan.generatedPreviews).toHaveLength(0);

    const previewed = await requestJson<{ scan: { generatedPreviews: Array<{ id: string; path: string }> } }>(
      "POST",
      "/harness/previews",
      { scanId: scanned.scan.id },
    );
    const agents = previewed.scan.generatedPreviews.find((preview) => preview.path === "AGENTS.md")!;
    expect(agents.id).toBeTruthy();

    const dryRun = await requestJson<{ result: { applied: unknown[]; skipped: unknown[] } }>("POST", "/harness/apply", {
      repositoryPath: directory,
      artifactIds: [agents.id],
      confirmation: null,
      dryRun: true,
    });
    expect(dryRun.result.applied).toHaveLength(0);
    expect(existsSync(join(directory, "AGENTS.md"))).toBe(false);

    const applied = await requestJson<{ result: { applied: Array<{ path: string }> } }>("POST", "/harness/apply", {
      repositoryPath: directory,
      artifactIds: [agents.id],
      confirmation: "APPLY HARNESS CHANGES",
      dryRun: false,
    });
    expect(applied.result.applied[0]?.path).toBe("AGENTS.md");
    expect(existsSync(join(directory, "AGENTS.md"))).toBe(true);

    const rescan = await requestJson<{ scan: { id: string } }>("POST", "/harness/scan", {
      repositoryPath: directory,
      includeGeneratedPreviews: true,
    });
    writeFileSync(join(directory, "AGENTS.md"), "# Changed after preview\n");
    const stale = await requestJson<{ result: { failed: Array<{ error: string }> } }>("POST", "/harness/apply", {
      repositoryPath: directory,
      artifactIds: ["agents-md"],
      confirmation: "APPLY HARNESS CHANGES",
      dryRun: false,
    });
    expect(rescan.scan.id).toBeTruthy();
    expect(stale.result.failed[0]?.error).toContain("changed since preview");
  });

  it("returns a clear harness error for invalid paths", async () => {
    const response = await requestRaw("POST", "/harness/scan", { repositoryPath: join(directory, "missing") });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("does not exist");
  });

  it("reports linear setup errors without exposing secrets", () => {
    writeLinearWorkflow({ apiKey: "$MISSING_LINEAR_API_KEY", teamKey: "" });

    const status = daemon.getTrackerStatus();

    expect(status.status).toBe("invalid_config");
    expect(status.error).toContain("requires team_key, team_id, project_slug, project_id, or allow_workspace_wide");
    expect(JSON.stringify(status)).not.toContain("MISSING_LINEAR_API_KEY");
  });

  it("refreshes Linear issues and starts a Codex run from a Linear card", async () => {
    const linearFetch = fakeLinearFetch({ state: "Todo" });
    const created = createDaemonServer(new EventStore(join(directory, "linear.sqlite")), {
      workflowPath,
      cwd: directory,
      linearFetch,
    });
    daemon.close();
    daemon = created.daemon;
    writeLinearWorkflow({ codexCommand: fakeCodexCommand("success") });

    const issues = await daemon.refreshIssueCache();
    expect(issues.map((issue) => issue.identifier)).toEqual(["ENG-101"]);
    expect(daemon.getTrackerStatus()).toMatchObject({ kind: "linear", status: "healthy", issueCount: 1 });

    const run = await daemon.startRun("linear-issue-101", "codex");
    await waitForTerminal(run.id, "succeeded");

    expect(run.provider).toBe("codex");
    expect(daemon.getRunPrompt(run.id)).toContain("Linear-backed daemon test");
    expect(daemon.getRunPrompt(run.id)).toContain("https://linear.app/acme/issue/ENG-101");
    const workspaceEvent = getEvents(run.id).find((event) => event.type === "workspace.ready");
    expect(workspaceEvent?.type === "workspace.ready" ? workspaceEvent.workspace.path : "").toContain("ENG-101");
  });

  it("proves the connected golden path with internal fixtures and no user-facing Demo Mode", async () => {
    const created = createDaemonServer(new EventStore(join(directory, "connected-golden-path.sqlite")), {
      workflowPath,
      cwd: directory,
      githubFetch: fakeGitHubFetch(),
      linearFetch: fakeLinearFetch({ state: "Todo" }),
    });
    daemon.close();
    daemon = created.daemon;
    writeWorkflow({
      codexCommand: fakeCodexCommand("success"),
      githubEnabled: true,
      githubToken: "github-secret",
    });

    const initial = await requestJson<{
      connected: {
        mode: string;
        nextAction: { kind: string };
        board: { status: string; issueCount: number };
        blockingReasons: string[];
      };
    }>("GET", "/connected/status");
    expect(initial.connected.mode).toBe("connected");
    expect(initial.connected.nextAction.kind).toBe("refresh_issues");
    expect(initial.connected.board).toMatchObject({ status: "empty", issueCount: 0 });
    expect(JSON.stringify(initial)).not.toMatch(/Demo Mode|Start Demo Workspace|Run Demo Agent/u);

    const refreshed = await requestJson<{ issues: Array<{ id: string; identifier: string }> }>("POST", "/issues/refresh");
    expect(refreshed.issues.map((issue) => issue.identifier)).toEqual(["ENG-101"]);

    const ready = await requestJson<{
      connected: {
        onboardingState: string;
        board: { status: string; issueCount: number };
        github: { status: string };
        linear: { status: string };
        provider: { kind: string; status: string };
        writes: { github: string; linear: string };
      };
    }>("GET", "/connected/status");
    expect(ready.connected).toMatchObject({
      onboardingState: "board_ready",
      board: { status: "ready", issueCount: 1 },
      github: { status: "ready" },
      linear: { status: "ready" },
      provider: { kind: "codex", status: "ready" },
      writes: { github: "read_only", linear: "read_only" },
    });

    const started = await requestJson<{ run: { id: string; provider: string; issueIdentifier: string } }>("POST", "/runs", {
      issueId: refreshed.issues[0]!.id,
      provider: "codex",
    });
    expect(started.run).toMatchObject({ provider: "codex", issueIdentifier: "ENG-101" });

    await waitForTerminal(started.run.id, "succeeded");
    const events = await requestJson<{ events: AgentEvent[] }>("GET", `/runs/${started.run.id}/events`);
    const artifacts = await requestJson<{ reviewArtifacts: { runId: string; issueIdentifier: string; provider: string } | null }>(
      "GET",
      `/runs/${started.run.id}/review-artifacts`,
    );
    const final = await requestJson<{
      connected: {
        onboardingState: string;
        activeRun: unknown;
        reviewArtifact: { status: string; runId: string | null };
        nextAction: { kind: string };
      };
    }>("GET", "/connected/status");

    expect(events.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "workflow.loaded",
        "workspace.ready",
        "prompt.rendered",
        "provider.started",
        "codex.thread.started",
        "codex.turn.started",
        "codex.assistant.delta",
        "github.review_artifacts.refreshed",
      ]),
    );
    expect(artifacts.reviewArtifacts).toMatchObject({
      runId: started.run.id,
      issueIdentifier: "ENG-101",
      provider: "codex",
    });
    expect(final.connected).toMatchObject({
      onboardingState: "completed",
      activeRun: null,
      reviewArtifact: { status: "ready", runId: started.run.id },
      nextAction: { kind: "review_artifact" },
    });
  });

  it("keeps real connected blockers explicit when Linear auth is missing and GitHub validation is disabled", async () => {
    const created = createDaemonServer(new EventStore(join(directory, "real-blockers.sqlite")), {
      workflowPath,
      cwd: directory,
    });
    daemon.close();
    daemon = created.daemon;
    writeWorkflow({ codexCommand: fakeCodexCommand("success"), linearApiKey: null });

    await requestJson("POST", "/issues/refresh");
    const status = await requestJson<{
      connected: {
        linear: { status: string; error: string | null };
        github: { status: string; enabled: boolean };
        nextAction: { kind: string };
        blockingReasons: string[];
      };
    }>("GET", "/connected/status");

    expect(status.connected).toMatchObject({
      linear: { status: "missing_auth", error: "Linear tracker config is missing endpoint or api key." },
      github: { status: "disabled", enabled: false },
      nextAction: { kind: "connect_linear" },
    });
    expect(status.connected.blockingReasons).toEqual(
      expect.arrayContaining([
        "Linear is not connected: Linear tracker config is missing endpoint or api key.",
        "GitHub repository validation is disabled in WORKFLOW.md; enable read-only GitHub validation to prove repository access.",
      ]),
    );
  });

  it("starts the codex provider from a fake linear issue", async () => {
    const created = createDaemonServer(new EventStore(join(directory, "linear-codex.sqlite")), {
      workflowPath,
      cwd: directory,
      linearFetch: fakeLinearFetch({ state: "Todo" }),
    });
    daemon.close();
    daemon = created.daemon;
    writeLinearWorkflow({ codexCommand: fakeCodexCommand("success") });
    await daemon.refreshIssueCache();

    const run = await daemon.startRun("linear-issue-101", "codex");
    await waitForTerminal(run.id, "succeeded");

    expect(run.provider).toBe("codex");
    expect(getEvents(run.id).map((event) => event.type)).toEqual(
      expect.arrayContaining(["provider.started", "codex.thread.started", "codex.turn.started"]),
    );
  });

  it("reconciles running linear issues that become terminal", async () => {
    let linearState = "Todo";
    const created = createDaemonServer(new EventStore(join(directory, "linear-reconcile.sqlite")), {
      workflowPath,
      cwd: directory,
      linearFetch: fakeLinearFetch({ getState: () => linearState }),
    });
    daemon.close();
    daemon = created.daemon;
    writeLinearWorkflow({ codexCommand: fakeCodexCommand("wait") });
    await daemon.refreshIssueCache();

    const run = await daemon.startRun("linear-issue-101", "codex");
    await waitForEvent(run.id, "codex.turn.started");

    linearState = "Done";
    await daemon.refreshIssueCache({ reconcile: true });
    await waitForTerminal(run.id, "cancelled");

    const events = getEvents(run.id);
    expect(events.some((event) => event.type === "tracker.reconciled" && event.action === "stopped_terminal")).toBe(true);
  });

  it("runs workflow, workspace, prompt, hook, and Codex provider events", async () => {
    const created = await daemon.startRun("linear-issue-101");

    await waitForTerminal(created.id, "succeeded");
    await waitForEvent(created.id, "hook.succeeded", 3);
    const events = getEvents(created.id);
    const types = events.map((event) => event.type);

    expect(types.indexOf("workflow.loaded")).toBeLessThan(types.indexOf("workspace.ready"));
    expect(types.indexOf("workspace.ready")).toBeLessThan(types.indexOf("prompt.rendered"));
    expect(types).toContain("hook.started");
    expect(types).toContain("hook.succeeded");
    expect(types).toContain("codex.assistant.delta");
    expect(types).toContain("github.review_artifacts.refreshed");

    const workspaceEvent = events.find((event) => event.type === "workspace.ready");
    expect(workspaceEvent?.type === "workspace.ready" ? workspaceEvent.workspace.path : "").toContain("ENG-101");
    expect(existsSync(workspaceEvent?.type === "workspace.ready" ? workspaceEvent.workspace.path : "")).toBe(true);

    const hookEvent = events.find((event) => event.type === "hook.succeeded" && event.hook.stdout.includes("Preparing"));
    expect(hookEvent?.type === "hook.succeeded" ? hookEvent.hook.stdout : "").toContain("Preparing");

    expect(daemon.getRunPrompt(created.id)).toContain("Linear-backed daemon test");

    const workspace = daemon.getWorkspaceInfo("ENG-101");
    expect(workspace.exists).toBe(true);
    expect(daemon.listWorkspaces().some((item) => item.issueIdentifier === "ENG-101")).toBe(true);
  });

  it("reloads invalid workflow status without crashing", async () => {
    writeFileSync(workflowPath, "---\ntracker: [\n---\nPrompt");
    const status: WorkflowStatus = daemon.refreshWorkflowStatus();

    expect(status.status).toBe("invalid");
    expect(status.error).toContain("workflow_yaml_invalid");

    await expect(daemon.startRun("linear-issue-101")).rejects.toThrow("workflow_yaml_invalid");
  });

  it("keeps stop and retry behavior working", async () => {
    writeWorkflow({ codexCommand: fakeCodexCommand("wait") });
    const created = await daemon.startRun("linear-issue-101");

    const stopped = await daemon.stopRun(created.id);
    expect(stopped.status).toBe("cancelled");

    writeWorkflow({ codexCommand: fakeCodexCommand("success") });
    const retried = await daemon.retryRun(created.id);
    expect(retried.status).toBe("queued");
    await waitForTerminal(retried.id, "succeeded");
  });

  it("runs the codex provider against a fake app-server", async () => {
    writeWorkflow({ codexCommand: fakeCodexCommand("success") });

    const created = await daemon.startRun("linear-issue-101", "codex");

    expect(created.provider).toBe("codex");
    await waitForTerminal(created.id, "succeeded");
    const types = getEvents(created.id).map((event) => event.type);

    expect(types).toEqual(expect.arrayContaining(["provider.started", "codex.thread.started", "codex.turn.started"]));
    expect(types).toContain("codex.assistant.delta");
    expect(types).toContain("codex.turn.completed");
  });

  it("runs the Claude provider against a fake CLI and refreshes artifacts", async () => {
    writeWorkflow({ provider: "claude", claudeCommand: fakeCliCommand("claude-success") });

    const created = await daemon.startRun("linear-issue-101", "claude");
    await waitForTerminal(created.id, "succeeded");

    const types = getEvents(created.id).map((event) => event.type);
    expect(created.provider).toBe("claude");
    expect(types).toEqual(expect.arrayContaining(["provider.started", "claude.system.init", "claude.result"]));
    expect(types).toContain("github.review_artifacts.refreshed");
    expect(daemon.getReviewArtifacts(created.id)).toMatchObject({ runId: created.id, provider: "claude" });
  });

  it("runs the Cursor provider against a fake CLI and refreshes artifacts", async () => {
    writeWorkflow({ provider: "cursor", cursorCommand: fakeCliCommand("cursor-success") });

    const created = await daemon.startRun("linear-issue-101", "cursor");
    await waitForTerminal(created.id, "succeeded");

    const types = getEvents(created.id).map((event) => event.type);
    expect(created.provider).toBe("cursor");
    expect(types).toEqual(expect.arrayContaining(["provider.started", "cursor.system.init", "cursor.result"]));
    expect(types).toContain("github.review_artifacts.refreshed");
    expect(daemon.getReviewArtifacts(created.id)).toMatchObject({ runId: created.id, provider: "cursor" });
  });

  it("stops active Claude and Cursor fake CLI runs", async () => {
    writeWorkflow({ provider: "claude", claudeCommand: fakeCliCommand("claude-wait") });
    const claudeRun = await daemon.startRun("linear-issue-101", "claude");
    await waitForEvent(claudeRun.id, "claude.system.init");
    await daemon.stopRun(claudeRun.id);
    await waitForTerminal(claudeRun.id, "cancelled");

    writeWorkflow({ provider: "cursor", cursorCommand: fakeCliCommand("cursor-wait") });
    const cursorRun = await daemon.startRun("linear-issue-101", "cursor");
    await waitForEvent(cursorRun.id, "cursor.system.init");
    await daemon.stopRun(cursorRun.id);
    await waitForTerminal(cursorRun.id, "cancelled");
  });

  it("retries failed Claude and Cursor fake CLI runs with the current workflow", async () => {
    writeWorkflow({ provider: "claude", claudeCommand: fakeCliCommand("claude-error-result") });
    const failedClaude = await daemon.startRun("linear-issue-101", "claude");
    await waitForTerminal(failedClaude.id, "failed");
    writeWorkflow({ provider: "claude", claudeCommand: fakeCliCommand("claude-success") });
    const retriedClaude = await daemon.retryRun(failedClaude.id);
    await waitForTerminal(retriedClaude.id, "succeeded");

    writeWorkflow({ provider: "cursor", cursorCommand: fakeCliCommand("cursor-error-result") });
    const failedCursor = await daemon.startRun("linear-issue-101", "cursor");
    await waitForTerminal(failedCursor.id, "failed");
    writeWorkflow({ provider: "cursor", cursorCommand: fakeCliCommand("cursor-success") });
    const retriedCursor = await daemon.retryRun(failedCursor.id);
    await waitForTerminal(retriedCursor.id, "succeeded");
  });

  it("persists and serves review artifact snapshots through daemon endpoints", async () => {
    const created = await daemon.startRun("linear-issue-101");

    await waitForEvent(created.id, "github.review_artifacts.refreshed");
    const stored = daemon.getReviewArtifacts(created.id);
    expect(stored).toMatchObject({
      runId: created.id,
      issueIdentifier: "ENG-101",
      trackerKind: "linear",
    });

    const fromEndpoint = await requestJson<{ reviewArtifacts: unknown }>("GET", `/runs/${created.id}/review-artifacts`);
    expect(fromEndpoint.reviewArtifacts).toMatchObject({ runId: created.id });

    const refreshed = await requestJson<{ reviewArtifacts: unknown }>("POST", `/runs/${created.id}/review-artifacts/refresh`);
    expect(refreshed.reviewArtifacts).toMatchObject({ runId: created.id });

    const byIssue = await requestJson<{ reviewArtifacts: unknown }>("GET", `/issues/${created.issueId}/review-artifacts`);
    expect(byIssue.reviewArtifacts).toMatchObject({ runId: created.id });
  });

  it("handles codex approval requests through the daemon registry", async () => {
    writeWorkflow({ codexCommand: fakeCodexCommand("approval") });

    const created = await daemon.startRun("linear-issue-101", "codex");
    await waitForApproval(created.id);

    const pending = daemon.listApprovals(created.id);
    expect(pending[0]?.status).toBe("pending");
    expect(pending[0]?.command).toBe("pnpm test");

    await respondApproval(pending[0]!.approvalId, "accept");
    await waitForTerminal(created.id, "succeeded");

    const approvals = daemon.listApprovals(created.id);
    expect(approvals[0]?.status).toBe("resolved");
    expect(getEvents(created.id).some((event) => event.type === "approval.resolved" && event.resolution === "accept")).toBe(true);
  });

  it("reconstructs active persisted runs on startup and allows manual retry", async () => {
    const databasePath = join(directory, "restart.sqlite");
    daemon.close();
    daemon = createDaemonServer(new EventStore(databasePath), {
      workflowPath,
      cwd: directory,
      linearFetch: fakeLinearFetch({ state: "Todo" }),
    }).daemon;

    writeWorkflow({ codexCommand: fakeCodexCommand("wait") });
    const created = await daemon.startRun("linear-issue-101", "codex");
    await waitForEvent(created.id, "codex.turn.started");
    daemon.close();

    daemon = createDaemonServer(new EventStore(databasePath), {
      workflowPath,
      cwd: directory,
      linearFetch: fakeLinearFetch({ state: "Todo" }),
    }).daemon;
    const recovered = daemon.requireRun(created.id);

    expect(recovered.status).toBe("interrupted");
    expect(recovered.recoveryState).toBe("interrupted_by_restart");
    expect(getEvents(created.id).some((event) => event.type === "run.recovered")).toBe(true);

    writeWorkflow({ codexCommand: fakeCodexCommand("success") });
    const retried = await daemon.retryRun(created.id);
    await waitForTerminal(retried.id, "succeeded");
    expect(daemon.requireRun(created.id).recoveryState).toBe("manually_retried");
  });

  it("leaves terminal persisted runs unchanged on startup", async () => {
    const databasePath = join(directory, "terminal-restart.sqlite");
    daemon.close();
    daemon = createDaemonServer(new EventStore(databasePath), {
      workflowPath,
      cwd: directory,
      linearFetch: fakeLinearFetch({ state: "Todo" }),
    }).daemon;

    writeWorkflow({ codexCommand: fakeCodexCommand("success") });
    const created = await daemon.startRun("linear-issue-101", "codex");
    await waitForTerminal(created.id, "succeeded");
    daemon.close();

    daemon = createDaemonServer(new EventStore(databasePath), {
      workflowPath,
      cwd: directory,
      linearFetch: fakeLinearFetch({ state: "Todo" }),
    }).daemon;

    expect(daemon.requireRun(created.id).status).toBe("succeeded");
    expect(getEvents(created.id).some((event) => event.type === "run.recovered")).toBe(false);
  });

  it("recovers stale pending approvals as non-actionable", async () => {
    const databasePath = join(directory, "approval-restart.sqlite");
    daemon.close();
    daemon = createDaemonServer(new EventStore(databasePath), {
      workflowPath,
      cwd: directory,
      linearFetch: fakeLinearFetch({ state: "Todo" }),
    }).daemon;
    writeWorkflow({ codexCommand: fakeCodexCommand("approval") });

    const created = await daemon.startRun("linear-issue-101", "codex");
    await waitForApproval(created.id);
    daemon.close();

    daemon = createDaemonServer(new EventStore(databasePath), {
      workflowPath,
      cwd: directory,
      linearFetch: fakeLinearFetch({ state: "Todo" }),
    }).daemon;

    expect(daemon.listApprovals(created.id)).toHaveLength(0);
    expect(getEvents(created.id).some((event) => event.type === "approval.recovered")).toBe(true);
    expect(getEvents(created.id).some((event) => event.type === "approval.resolved" && event.resolution === "cancel")).toBe(true);
  });

  it("reports daemon status, workspace inventory, and dry-run cleanup plans", async () => {
    writeWorkflow({ cleanupEnabled: true, cleanupDryRun: true, cleanupAfterMs: 0 });
    mkdirSync(join(directory, "workspaces", "ORPHAN-1"), { recursive: true });
    writeFileSync(join(directory, "workspaces", "ORPHAN-1", "notes.txt"), "stale\n");

    const status = await daemon.getDaemonStatus();
    const inventory = await daemon.refreshWorkspaceInventory();
    const plan = await daemon.createCleanupPlan();
    const result = await daemon.executeCleanup({ planId: plan.id, confirm: "delete workspaces" });

    expect(status.daemonInstanceId).toBeTruthy();
    expect(inventory.workspaces.some((workspace) => workspace.workspaceKey === "ORPHAN-1")).toBe(true);
    expect(plan.dryRun).toBe(true);
    expect(plan.candidates.some((workspace) => workspace.workspaceKey === "ORPHAN-1")).toBe(true);
    expect(result.skipped[0]?.skippedReason).toBe("dry_run");
    expect(existsSync(join(directory, "workspaces", "ORPHAN-1"))).toBe(true);
  });

  it("executes confirmed cleanup only when policy allows it", async () => {
    writeWorkflow({ cleanupEnabled: true, cleanupDryRun: false, cleanupAfterMs: 0 });
    mkdirSync(join(directory, "workspaces", "ORPHAN-2"), { recursive: true });
    writeFileSync(join(directory, "workspaces", "ORPHAN-2", "notes.txt"), "stale\n");

    const plan = await daemon.createCleanupPlan(["ORPHAN-2"]);
    const result = await daemon.executeCleanup({ planId: plan.id, confirm: "delete workspaces" });

    expect(result.deleted.some((workspace) => workspace.workspaceKey === "ORPHAN-2")).toBe(true);
    expect(existsSync(join(directory, "workspaces", "ORPHAN-2"))).toBe(false);
  });

  it("fails codex runs gracefully when the command is unavailable", async () => {
    writeWorkflow({ codexCommand: "definitely-not-a-symphonia-command" });

    const created = await daemon.startRun("linear-issue-101", "codex");
    await waitForTerminal(created.id, "failed");

    expect(getEvents(created.id).some((event) => event.type === "codex.error")).toBe(true);
  });

  it("interrupts active codex turns when stopped", async () => {
    writeWorkflow({ codexCommand: fakeCodexCommand("wait") });

    const created = await daemon.startRun("linear-issue-101", "codex");
    await waitForEvent(created.id, "codex.turn.started");

    await daemon.stopRun(created.id);
    await waitForTerminal(created.id, "cancelled");
    await waitForEvent(created.id, "codex.turn.completed");

    expect(getEvents(created.id).some((event) => event.type === "codex.turn.completed" && event.status === "interrupted")).toBe(true);
  });
});

async function waitForTerminal(runId: string, expectedStatus: string): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (daemon.requireRun(runId).status === expectedStatus) return;
    await sleep(20);
  }
  const run = daemon.requireRun(runId);
  throw new Error(
    `Run ${runId} did not reach ${expectedStatus}; status=${run.status}; events=${getEvents(runId)
      .map((event) => `${event.type}${"message" in event ? `:${String(event.message)}` : ""}${"error" in event ? `:${String(event.error)}` : ""}`)
      .join(",")}`,
  );
}

async function waitForEvent(runId: string, eventType: string, minimumCount = 1): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (getEvents(runId).filter((event) => event.type === eventType).length >= minimumCount) return;
    await sleep(20);
  }
  throw new Error(
    `Run ${runId} did not emit ${minimumCount} ${eventType} events; status=${daemon.requireRun(runId).status}; events=${getEvents(runId)
      .map((event) => `${event.type}${"message" in event ? `:${String(event.message)}` : ""}${"error" in event ? `:${String(event.error)}` : ""}`)
      .join(",")}`,
  );
}

async function waitForApproval(runId: string): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (daemon.listApprovals(runId).some((approval) => approval.status === "pending")) return;
    await sleep(20);
  }
  throw new Error(`Run ${runId} did not create a pending approval.`);
}

function getEvents(runId: string): AgentEvent[] {
  return (daemon as unknown as { eventStore: EventStore }).eventStore.getEventsForRun(runId);
}

async function requestJson<T>(method: "GET" | "POST", path: string, payload?: unknown): Promise<T> {
  const response = await requestRaw(method, path, payload);

  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return JSON.parse(response.body) as T;
}

async function requestRaw(method: "GET" | "POST", path: string, payload?: unknown): Promise<{ statusCode: number; body: string }> {
  let statusCode = 0;
  let body = "";
  const requestBody = payload === undefined ? "" : JSON.stringify(payload);
  const response = {
    setHeader: () => undefined,
    writeHead: (status: number) => {
      statusCode = status;
      return response;
    },
    end: (chunk?: unknown) => {
      body += chunk === undefined ? "" : String(chunk);
    },
  };
  const request = {
    method,
    url: path,
    async *[Symbol.asyncIterator]() {
      if (requestBody) yield Buffer.from(requestBody);
    },
  };

  await (daemon as unknown as {
    route: (request: unknown, response: unknown) => Promise<void>;
  }).route(request, response);

  return { statusCode, body };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function respondApproval(approvalId: string, decision: "accept" | "acceptForSession" | "decline" | "cancel"): Promise<ApprovalState> {
  return (daemon as unknown as {
    respondApproval: (approvalId: string, decision: "accept" | "acceptForSession" | "decline" | "cancel") => Promise<ApprovalState>;
  }).respondApproval(approvalId, decision);
}

function writeWorkflow(
  options: {
    codexCommand?: string;
    claudeCommand?: string;
    cursorCommand?: string;
    provider?: "codex" | "claude" | "cursor";
    githubToken?: string;
    githubEnabled?: boolean;
    githubReadOnly?: boolean;
    githubWriteEnabled?: boolean;
    githubAllowCreatePr?: boolean;
    githubAllowPush?: boolean;
    cleanupEnabled?: boolean;
    cleanupDryRun?: boolean;
    cleanupAfterMs?: number;
    linearApiKey?: string | null;
  } = {},
): void {
  writeFileSync(
    workflowPath,
    `---
provider: ${options.provider ?? "codex"}
tracker:
  kind: linear
  endpoint: "https://api.linear.app/graphql"
${options.linearApiKey === null ? "" : `  api_key: ${JSON.stringify(options.linearApiKey ?? "linear-secret")}\n`}  team_key: "ENG"
  active_states:
    - "Todo"
    - "In Progress"
  terminal_states:
    - "Done"
    - "Canceled"
  page_size: 5
  max_pages: 2
  read_only: true
workspace:
  root: "./workspaces"
  cleanup:
    enabled: ${options.cleanupEnabled ? "true" : "false"}
    dry_run: ${options.cleanupDryRun === false ? "false" : "true"}
    require_manual_confirmation: true
    delete_terminal_after_ms: ${options.cleanupAfterMs ?? 604800000}
    delete_orphaned_after_ms: ${options.cleanupAfterMs ?? 1209600000}
    delete_interrupted_after_ms: ${options.cleanupAfterMs ?? 1209600000}
    protect_active: true
    protect_recent_runs_ms: 0
    protect_dirty_git: true
${options.githubToken || options.githubEnabled ? `github:
  enabled: true
  endpoint: "https://api.github.test"
${options.githubToken ? `  token: ${JSON.stringify(options.githubToken)}\n` : ""}  owner: "agora-creations"
  repo: "symphonia"
  default_base_branch: "main"
  remote_name: "origin"
  read_only: ${options.githubReadOnly === false ? "false" : "true"}
  page_size: 5
  max_pages: 2
  write:
    enabled: ${options.githubWriteEnabled ? "true" : "false"}
    require_confirmation: true
    allow_push: ${options.githubAllowPush ? "true" : "false"}
    allow_create_pr: ${options.githubAllowCreatePr ? "true" : "false"}
    allow_comment: false
    allow_request_reviewers: false
    draft_pr_by_default: true
    protected_branches:
      - "main"
      - "master"
      - "production"
` : ""}codex:
  command: ${JSON.stringify(options.codexCommand ?? fakeCodexCommand("success"))}
  model: "fake-model"
  approval_policy: "on-request"
  turn_sandbox_policy: "workspaceWrite"
  turn_timeout_ms: 2000
  read_timeout_ms: 1000
  stall_timeout_ms: 1000
claude:
  enabled: ${options.claudeCommand || options.provider === "claude" ? "true" : "false"}
  command: ${JSON.stringify(options.claudeCommand ?? "claude")}
  model: "sonnet"
  max_turns: 3
  output_format: "stream-json"
  permission_mode: "default"
  allowed_tools:
    - "Read"
  disallowed_tools:
    - "Bash(rm:*)"
  timeout_ms: 2000
  read_timeout_ms: 1000
  stall_timeout_ms: 1000
cursor:
  enabled: ${options.cursorCommand || options.provider === "cursor" ? "true" : "false"}
  command: ${JSON.stringify(options.cursorCommand ?? "cursor-agent")}
  model: "cursor-test"
  output_format: "stream-json"
  force: false
  timeout_ms: 2000
  read_timeout_ms: 1000
  stall_timeout_ms: 1000
hooks:
  timeout_ms: 1000
  after_create: |
    printf "Created in $(pwd)\\n"
  before_run: |
    printf "Preparing in $(pwd)\\n"
  after_run: |
    printf "Finished in $(pwd)\\n"
---
You are working on {{ issue.identifier }}.

Title:
{{ issue.title }}
`,
  );
}

function writeLinearWorkflow(
  options: {
    codexCommand?: string;
    apiKey?: string | null;
    teamKey?: string;
    linearReadOnly?: boolean;
    linearWriteEnabled?: boolean;
    linearAllowComments?: boolean;
  } = {},
): void {
  writeFileSync(
    workflowPath,
    `---
provider: codex
tracker:
  kind: linear
  endpoint: "https://api.linear.app/graphql"
${options.apiKey === null ? "" : `  api_key: ${JSON.stringify(options.apiKey ?? "linear-secret")}\n`}  team_key: ${JSON.stringify(options.teamKey ?? "ENG")}
  active_states:
    - "Todo"
    - "In Progress"
  terminal_states:
    - "Done"
    - "Canceled"
  page_size: 5
  max_pages: 2
  read_only: ${options.linearReadOnly === false ? "false" : "true"}
  write:
    enabled: ${options.linearWriteEnabled ? "true" : "false"}
    require_confirmation: true
    allow_comments: ${options.linearAllowComments ? "true" : "false"}
    allow_state_transitions: false
workspace:
  root: "./workspaces"
codex:
  command: ${JSON.stringify(options.codexCommand ?? fakeCodexCommand("success"))}
  model: "fake-model"
  approval_policy: "on-request"
  turn_sandbox_policy: "workspaceWrite"
  turn_timeout_ms: 2000
  read_timeout_ms: 1000
  stall_timeout_ms: 1000
hooks:
  timeout_ms: 1000
  before_run: |
    printf "Preparing in $(pwd)\\n"
---
You are working on {{ issue.identifier }}.

Title:
{{ issue.title }}

Description:
{{ issue.description }}

State:
{{ issue.state }}

Labels:
{{ issue.labels }}

Linear URL:
{{ issue.url }}
`,
  );
}

function fakeLinearFetch(options: { state?: string; getState?: () => string }): LinearFetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { query: string };
    const state = options.getState?.() ?? options.state ?? "Todo";
    const node = fakeLinearIssue(state);

    if (body.query.includes("SymphoniaLinearViewer")) {
      return jsonResponse({ data: { viewer: { id: "viewer-1", name: "Linear User", email: "linear@example.com" } } });
    }

    if (body.query.includes("SymphoniaLinearIssues")) {
      return jsonResponse({
        data: {
          issues: {
            nodes: [node],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    }

    if (body.query.includes("SymphoniaLinearIssue")) {
      return jsonResponse({ data: { issue: node } });
    }

    if (body.query.includes("SymphoniaLinearCommentCreate") || body.query.includes("commentCreate")) {
      return jsonResponse({
        data: {
          commentCreate: {
            success: true,
            comment: {
              id: "comment-1",
              url: "https://linear.app/acme/issue/ENG-101#comment-1",
              createdAt: "2026-05-13T08:11:00.000Z",
            },
          },
        },
      });
    }

    return jsonResponse({
      data: {
        issues: {
          nodes: [node],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });
  };
}

function fakeLinearIssue(state: string) {
  return {
    id: "linear-issue-101",
    identifier: "ENG-101",
    title: "Linear-backed daemon test",
    description: "Use real Linear issue fields in the prompt.",
    priority: 2,
    branchName: "eng-101-linear-backed-daemon-test",
    url: "https://linear.app/acme/issue/ENG-101",
    createdAt: "2026-05-13T08:00:00.000Z",
    updatedAt: "2026-05-13T08:10:00.000Z",
    state: { id: `state-${state}`, name: state, type: state === "Done" ? "completed" : "unstarted" },
    labels: { nodes: [{ name: "Backend" }, { name: "Linear" }] },
    project: { id: "project-1", name: "Orchestration", slugId: "orchestration" },
    team: { id: "team-1", key: "ENG", name: "Engineering" },
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeGitHubFetch(): GitHubFetch {
  return async (input) => {
    if (input.includes("/repos/agora-creations/symphonia")) {
      return jsonResponse({
        id: 1,
        name: "symphonia",
        full_name: "agora-creations/symphonia",
        default_branch: "main",
      });
    }
    return jsonResponse({ message: `Unexpected GitHub URL: ${input}` }, 404);
  };
}

function fakeGitHubWriteFetch(): GitHubFetch {
  let created = false;
  return async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    if (url.pathname === "/repos/agora-creations/symphonia/pulls" && method === "POST") {
      created = true;
      return jsonResponse(fakePullRequest(), 201);
    }
    if (url.pathname === "/repos/agora-creations/symphonia/pulls") {
      return jsonResponse(created ? [fakePullRequest()] : []);
    }
    if (url.pathname.includes("/files")) {
      return jsonResponse([]);
    }
    if (url.pathname.includes("/status")) {
      return jsonResponse({ state: "success", total_count: 0, sha: "abc123", statuses: [] });
    }
    if (url.pathname.includes("/check-runs")) {
      return jsonResponse({ total_count: 0, check_runs: [] });
    }
    if (url.pathname.includes("/actions/runs")) {
      return jsonResponse({ total_count: 0, workflow_runs: [] });
    }
    if (url.pathname === "/repos/agora-creations/symphonia") {
      return jsonResponse({
        id: 1,
        name: "symphonia",
        full_name: "agora-creations/symphonia",
        default_branch: "main",
      });
    }
    return jsonResponse({ message: `Unexpected GitHub URL: ${input}` }, 404);
  };
}

function fakePullRequest() {
  return {
    id: 42,
    number: 42,
    title: "ENG-101: Linear-backed daemon test",
    html_url: "https://github.com/agora-creations/symphonia/pull/42",
    state: "open",
    draft: true,
    merged: false,
    mergeable: null,
    head: { ref: "feature/eng-101-write-test", sha: "abc123" },
    base: { ref: "main", sha: "base123" },
    user: { login: "octocat" },
    created_at: "2026-05-13T08:12:00.000Z",
    updated_at: "2026-05-13T08:12:00.000Z",
  };
}

function prepareGitWorkspace(workspacePath: string): void {
  mkdirSync(workspacePath, { recursive: true });
  writeFileSync(join(workspacePath, "README.md"), "# Workspace\n");
  execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "symphonia@example.com"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Symphonia Test"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["checkout", "-b", "feature/eng-101-write-test"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["add", "README.md"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "Initial workspace commit"], { cwd: workspacePath, stdio: "ignore" });
  writeFileSync(join(workspacePath, "change.txt"), "write-action validation\n");
}

function authorizationHeader(init?: RequestInit): string {
  const headers = init?.headers;
  if (headers instanceof Headers) return headers.get("Authorization") ?? "";
  if (Array.isArray(headers)) {
    return headers.find(([key]) => key.toLowerCase() === "authorization")?.[1] ?? "";
  }
  if (headers && typeof headers === "object") {
    const record = headers as Record<string, string>;
    return record.Authorization ?? record.authorization ?? "";
  }
  return "";
}

function fakeAuthFetch(nextGithubPoll: () => number): AuthFetch {
  return async (input) => {
    if (input.includes("/login/device/code")) {
      return jsonResponse({
        device_code: "device-code",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      });
    }
    if (input.includes("/login/oauth/access_token")) {
      return nextGithubPoll() === 1
        ? jsonResponse({ error: "authorization_pending" })
        : jsonResponse({ access_token: "ghu_daemon_secret", refresh_token: "ghr_refresh", expires_in: 28800, scope: "repo" });
    }
    if (input.includes("api.github.com/user")) {
      return jsonResponse({ id: 1, login: "octocat" });
    }
    if (input.includes("/oauth/token")) {
      return jsonResponse({ access_token: "lin_daemon_secret", refresh_token: "lin_refresh", expires_in: 86399, scope: "read" });
    }
    if (input.includes("/graphql")) {
      return jsonResponse({ data: { viewer: { id: "linear-user", name: "Linear User", email: "linear@example.com" } } });
    }
    return jsonResponse({ message: `Unexpected auth URL: ${input}` }, 404);
  };
}

function fakeCodexCommand(mode: string): string {
  const serverPath = join(directory, `fake-codex-${mode}.mjs`);
  writeFileSync(serverPath, fakeServerSource());
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(serverPath)} ${mode}`;
}

function fakeCliCommand(mode: string): string {
  const serverPath = join(directory, `fake-cli-${mode}.mjs`);
  writeFileSync(serverPath, fakeCliSource());
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(serverPath)} ${mode}`;
}

function fakeServerSource(): string {
  return `
import readline from "node:readline";

const mode = process.argv[2] ?? "success";
if (process.argv.includes("--help")) {
  process.stdout.write("fake-codex app-server\\n");
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin });
let activeTurn = false;

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

function turn(status = "inProgress") {
  return { id: "turn-1", items: [], itemsView: "summary", status, error: null, startedAt: 1, completedAt: status === "inProgress" ? null : 2, durationMs: status === "inProgress" ? null : 10 };
}

function complete(status = "completed") {
  send({ method: "item/started", params: { threadId: "thread-1", turnId: "turn-1", startedAtMs: Date.now(), item: { type: "agentMessage", id: "item-1", text: "", phase: null, memoryCitation: null } } });
  send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "Daemon fake Codex delta." } });
  send({ method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", completedAtMs: Date.now(), item: { type: "agentMessage", id: "item-1", text: "Daemon fake Codex delta.", phase: null, memoryCitation: null } } });
  send({ method: "turn/completed", params: { threadId: "thread-1", turn: turn(status) } });
  setTimeout(() => process.exit(0), 5);
}

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "fake-codex", codexHome: "/tmp/fake-codex", platformFamily: "unix", platformOs: "macos" } });
  } else if (message.method === "initialized") {
  } else if (message.method === "thread/start") {
    send({ id: message.id, result: { thread: { id: "thread-1", turns: [] }, model: "fake-model", modelProvider: "fake", serviceTier: null, cwd: message.params.cwd, instructionSources: [], approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }, permissionProfile: null, activePermissionProfile: null, reasoningEffort: null } });
  } else if (message.method === "turn/start") {
    send({ id: message.id, result: { turn: turn() } });
    send({ method: "turn/started", params: { threadId: "thread-1", turn: turn() } });
    activeTurn = true;
    if (mode === "approval") {
      send({ id: "approval-1", method: "item/commandExecution/requestApproval", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-command", startedAtMs: Date.now(), approvalId: "approval-1", reason: "Run tests", command: "pnpm test", cwd: message.params.cwd, availableDecisions: ["accept", "acceptForSession", "decline", "cancel"] } });
      return;
    }
    if (mode === "wait") return;
    complete();
  } else if (message.id === "approval-1") {
    complete(message.result?.decision === "accept" ? "completed" : "failed");
  } else if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    if (activeTurn) complete("interrupted");
  }
});
`;
}

function fakeCliSource(): string {
  return `
const mode = process.argv[2] ?? "claude-success";

function write(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

if (mode === "claude-success") {
  write({ type: "system", subtype: "init", session_id: "claude-session-1", model: "sonnet", cwd: process.cwd(), permissionMode: "default" });
  write({ type: "assistant", session_id: "claude-session-1", message: { role: "assistant", content: [{ type: "text", text: "Claude daemon fake message." }] } });
  write({ type: "result", subtype: "success", session_id: "claude-session-1", is_error: false, result: "Claude daemon fake result", num_turns: 1, duration_ms: 25, usage: { input_tokens: 3, output_tokens: 4 } });
  process.exit(0);
}

if (mode === "claude-error-result") {
  write({ type: "system", subtype: "init", session_id: "claude-session-1" });
  write({ type: "result", subtype: "error", session_id: "claude-session-1", is_error: true, result: "Claude fake failure" });
  process.exit(0);
}

if (mode === "claude-wait") {
  write({ type: "system", subtype: "init", session_id: "claude-session-1" });
  setInterval(() => {}, 1000);
}

if (mode === "cursor-success") {
  write({ type: "system", subtype: "init", session_id: "cursor-session-1", request_id: "request-1", model: "cursor-test", cwd: process.cwd(), apiKeySource: "login", permissionMode: "default" });
  write({ type: "assistant", session_id: "cursor-session-1", request_id: "request-1", message: { role: "assistant", content: [{ type: "text", text: "Cursor daemon fake message." }] } });
  write({ type: "result", subtype: "success", session_id: "cursor-session-1", request_id: "request-1", is_error: false, result: "Cursor daemon fake result", duration_ms: 25, duration_api_ms: 20, usage: { input_tokens: 2, output_tokens: 5 } });
  process.exit(0);
}

if (mode === "cursor-error-result") {
  write({ type: "system", subtype: "init", session_id: "cursor-session-1", request_id: "request-1" });
  write({ type: "result", subtype: "error", session_id: "cursor-session-1", request_id: "request-1", is_error: true, result: "Cursor fake failure" });
  process.exit(0);
}

if (mode === "cursor-wait") {
  write({ type: "system", subtype: "init", session_id: "cursor-session-1", request_id: "request-1" });
  setInterval(() => {}, 1000);
}
`;
}
