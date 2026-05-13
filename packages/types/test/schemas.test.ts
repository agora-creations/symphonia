import { describe, expect, it } from "vitest";
import {
  ApprovalStateSchema,
  AgentEventSchema,
  ReviewArtifactSnapshotSchema,
  HookRunSchema,
  IssueSchema,
  RunSchema,
  WorkflowConfigSchema,
  WorkflowDefinitionSchema,
  WorkflowStatusSchema,
  WorkspaceInfoSchema,
} from "../src/index";

const timestamp = "2026-05-13T08:00:00.000Z";

describe("shared schemas", () => {
  it("parses a valid issue", () => {
    const issue = IssueSchema.parse({
      id: "issue-1",
      identifier: "SYM-1",
      title: "Build board",
      description: "Render mock issues.",
      state: "Todo",
      labels: ["frontend"],
      priority: "High",
      createdAt: timestamp,
      updatedAt: timestamp,
      url: "https://mock.local/issues/SYM-1",
    });

    expect(issue.identifier).toBe("SYM-1");
  });

  it("parses a valid run", () => {
    const run = RunSchema.parse({
      id: "run-1",
      issueId: "issue-1",
      issueIdentifier: "SYM-1",
      status: "queued",
      provider: "mock",
      startedAt: timestamp,
      endedAt: null,
      error: null,
    });

    expect(run.status).toBe("queued");
  });

  it("parses several valid agent events", () => {
    const events = [
      {
        id: "event-1",
        runId: "run-1",
        type: "run.status",
        timestamp,
        status: "streaming",
      },
      {
        id: "event-2",
        runId: "run-1",
        type: "agent.message",
        timestamp,
        role: "assistant",
        message: "Inspecting repository.",
      },
      {
        id: "event-3",
        runId: "run-1",
        type: "tool.call",
        timestamp,
        toolName: "shell",
        command: "pnpm test",
        status: "completed",
      },
      {
        id: "event-4",
        runId: "run-1",
        type: "usage",
        timestamp,
        inputTokens: 120,
        outputTokens: 80,
        totalTokens: 200,
      },
      {
        id: "event-5",
        runId: "run-1",
        type: "artifact",
        timestamp,
        artifactType: "diff",
        title: "Mock diff",
        content: "+ added",
      },
    ];

    expect(events.map((event) => AgentEventSchema.parse(event))).toHaveLength(5);
  });

  it("rejects invalid event payloads", () => {
    expect(() =>
      AgentEventSchema.parse({
        id: "event-bad",
        runId: "run-1",
        type: "tool.call",
        timestamp,
        toolName: "shell",
        status: "not-a-status",
      }),
    ).toThrow();
  });

  it("parses valid workflow config, definition, status, workspace, and hook payloads", () => {
    const config = WorkflowConfigSchema.parse({
      provider: "mock",
      tracker: {
        kind: "mock",
        endpoint: null,
        apiKey: null,
        teamKey: null,
        teamId: null,
        projectSlug: null,
        projectId: null,
        allowWorkspaceWide: false,
        activeStates: ["Todo", "In Progress"],
        terminalStates: ["Done"],
        includeArchived: false,
        pageSize: 50,
        maxPages: 5,
        pollIntervalMs: null,
        readOnly: true,
        write: {
          enabled: false,
          commentOnRunStart: false,
          commentOnRunComplete: false,
          moveToStateOnStart: null,
          moveToStateOnSuccess: null,
          moveToStateOnFailure: null,
        },
      },
      polling: { intervalMs: 30000 },
      workspace: { root: "/tmp/symphonia_workspaces" },
      hooks: {
        afterCreate: "printf created",
        beforeRun: null,
        afterRun: null,
        beforeRemove: null,
        timeoutMs: 60000,
      },
      agent: {
        maxConcurrentAgents: 3,
        maxTurns: 8,
        maxRetryBackoffMs: 300000,
        maxConcurrentAgentsByState: { todo: 2 },
      },
      codex: {
        command: "codex app-server",
        model: null,
        approvalPolicy: null,
        threadSandbox: null,
        turnSandboxPolicy: null,
        turnTimeoutMs: 3600000,
        readTimeoutMs: 5000,
        stallTimeoutMs: 300000,
      },
      github: {
        enabled: false,
        endpoint: "https://api.github.com",
        token: null,
        owner: null,
        repo: null,
        defaultBaseBranch: "main",
        remoteName: "origin",
        readOnly: true,
        pageSize: 50,
        maxPages: 3,
        write: {
          enabled: false,
          allowPush: false,
          allowCreatePr: false,
          allowUpdatePr: false,
          allowComment: false,
          allowRequestReviewers: false,
          draftPrByDefault: true,
          prTitleTemplate: "{{ issue.identifier }}: {{ issue.title }}",
          prBodyTemplate: "See Symphonia run timeline.",
        },
      },
    });

    expect(config.tracker.kind).toBe("mock");

    const definition = WorkflowDefinitionSchema.parse({
      config: { tracker: { kind: "mock" } },
      promptTemplate: "Work on {{ issue.identifier }}.",
      workflowPath: "/repo/WORKFLOW.md",
      loadedAt: timestamp,
    });
    expect(definition.promptTemplate).toContain("issue.identifier");

    const status = WorkflowStatusSchema.parse({
      status: "healthy",
      workflowPath: "/repo/WORKFLOW.md",
      loadedAt: timestamp,
      error: null,
      effectiveConfigSummary: {
        defaultProvider: "mock",
        trackerKind: "mock",
        endpoint: null,
        teamKey: null,
        teamId: null,
        projectSlug: null,
        projectId: null,
        allowWorkspaceWide: false,
        activeStates: ["Todo"],
        terminalStates: ["Done"],
        includeArchived: false,
        pageSize: 50,
        maxPages: 5,
        pollIntervalMs: null,
        readOnly: true,
        writeEnabled: false,
        workspaceRoot: "/tmp/symphonia_workspaces",
        maxConcurrentAgents: 3,
        maxTurns: 8,
        hookTimeoutMs: 60000,
        codexCommand: "codex app-server",
        codexModel: null,
        github: {
          enabled: false,
          endpoint: "https://api.github.com",
          owner: null,
          repo: null,
          defaultBaseBranch: "main",
          remoteName: "origin",
          readOnly: true,
          writeEnabled: false,
          allowCreatePr: false,
          tokenConfigured: false,
          pageSize: 50,
          maxPages: 3,
        },
      },
    });
    expect(status.status).toBe("healthy");

    const workspace = WorkspaceInfoSchema.parse({
      issueIdentifier: "SYM-1",
      workspaceKey: "SYM-1",
      path: "/tmp/symphonia_workspaces/SYM-1",
      createdNow: true,
      exists: true,
    });
    expect(workspace.createdNow).toBe(true);

    const hook = HookRunSchema.parse({
      hookName: "beforeRun",
      status: "succeeded",
      command: "printf ok",
      cwd: "/tmp/symphonia_workspaces/SYM-1",
      startedAt: timestamp,
      endedAt: timestamp,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      error: null,
    });
    expect(hook.exitCode).toBe(0);
  });

  it("parses workflow, workspace, hook, and prompt events", () => {
    const events = [
      {
        id: "event-workflow",
        runId: "run-1",
        type: "workflow.loaded",
        timestamp,
        workflowPath: "/repo/WORKFLOW.md",
        loadedAt: timestamp,
        configSummary: {
          defaultProvider: "mock",
          trackerKind: "mock",
          endpoint: null,
          teamKey: null,
          teamId: null,
          projectSlug: null,
          projectId: null,
          allowWorkspaceWide: false,
          activeStates: ["Todo"],
          terminalStates: ["Done"],
          includeArchived: false,
          pageSize: 50,
          maxPages: 5,
          pollIntervalMs: null,
          readOnly: true,
          writeEnabled: false,
          workspaceRoot: "/tmp/symphonia_workspaces",
          maxConcurrentAgents: 3,
          maxTurns: 8,
          hookTimeoutMs: 60000,
          codexCommand: "codex app-server",
          codexModel: null,
          github: {
            enabled: false,
            endpoint: "https://api.github.com",
            owner: null,
            repo: null,
            defaultBaseBranch: "main",
            remoteName: "origin",
            readOnly: true,
            writeEnabled: false,
            allowCreatePr: false,
            tokenConfigured: false,
            pageSize: 50,
            maxPages: 3,
          },
        },
      },
      {
        id: "event-workspace",
        runId: "run-1",
        type: "workspace.ready",
        timestamp,
        workspace: {
          issueIdentifier: "SYM-1",
          workspaceKey: "SYM-1",
          path: "/tmp/symphonia_workspaces/SYM-1",
          createdNow: true,
          exists: true,
        },
      },
      {
        id: "event-hook",
        runId: "run-1",
        type: "hook.succeeded",
        timestamp,
        hook: {
          hookName: "afterCreate",
          status: "succeeded",
          command: "printf ok",
          cwd: "/tmp/symphonia_workspaces/SYM-1",
          startedAt: timestamp,
          endedAt: timestamp,
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          error: null,
        },
      },
      {
        id: "event-provider",
        runId: "run-1",
        type: "provider.started",
        timestamp,
        provider: "codex",
        command: "codex app-server",
        pid: 123,
      },
      {
        id: "event-codex-thread",
        runId: "run-1",
        type: "codex.thread.started",
        timestamp,
        threadId: "thread-1",
        model: null,
        cwd: "/tmp/symphonia_workspaces/SYM-1",
      },
      {
        id: "event-codex-delta",
        runId: "run-1",
        type: "codex.assistant.delta",
        timestamp,
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        delta: "Hello",
      },
      {
        id: "event-approval",
        runId: "run-1",
        type: "approval.requested",
        timestamp,
        approvalId: "approval-1",
        prompt: "Approve command: pnpm test",
        approvalType: "command",
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        reason: "Run tests",
        command: "pnpm test",
        cwd: "/tmp/symphonia_workspaces/SYM-1",
        availableDecisions: ["accept", "decline", "cancel"],
      },
      {
        id: "event-approval-resolved",
        runId: "run-1",
        type: "approval.resolved",
        timestamp,
        approvalId: "approval-1",
        resolution: "accept",
      },
      {
        id: "event-prompt",
        runId: "run-1",
        type: "prompt.rendered",
        timestamp,
        prompt: "You are working on SYM-1.",
      },
    ];

    expect(events.map((event) => AgentEventSchema.parse(event))).toHaveLength(9);
  });

  it("parses review artifact snapshots and github events", () => {
    const snapshot = ReviewArtifactSnapshotSchema.parse({
      runId: "run-1",
      issueId: "issue-1",
      issueIdentifier: "SYM-1",
      provider: "mock",
      trackerKind: "mock",
      workspace: {
        issueIdentifier: "SYM-1",
        workspaceKey: "SYM-1",
        path: "/tmp/symphonia_workspaces/SYM-1",
        createdNow: false,
        exists: true,
      },
      git: {
        workspacePath: "/tmp/symphonia_workspaces/SYM-1",
        isGitRepo: true,
        remoteUrl: "https://github.com/agora-creations/symphonia.git",
        remoteName: "origin",
        currentBranch: "feature/sym-1",
        baseBranch: "main",
        headSha: "abc123",
        baseSha: "def456",
        mergeBaseSha: "def456",
        isDirty: true,
        changedFileCount: 1,
        untrackedFileCount: 0,
        stagedFileCount: 0,
        unstagedFileCount: 1,
        lastCheckedAt: timestamp,
      },
      pr: null,
      diff: {
        filesChanged: 1,
        additions: 2,
        deletions: 1,
        files: [
          {
            path: "README.md",
            status: "M",
            additions: 2,
            deletions: 1,
            isBinary: false,
            oldPath: null,
            patch: "@@ -1 +1 @@",
            source: "local",
          },
        ],
      },
      checks: [],
      commitStatus: {
        state: "success",
        totalCount: 0,
        statuses: [],
        sha: "abc123",
      },
      workflowRuns: [],
      lastRefreshedAt: timestamp,
      error: null,
    });

    expect(snapshot.git.currentBranch).toBe("feature/sym-1");
    expect(() => ReviewArtifactSnapshotSchema.parse({ ...snapshot, runId: "" })).toThrow();
    expect(
      AgentEventSchema.parse({
        id: "event-github-refresh",
        runId: "run-1",
        type: "github.review_artifacts.refreshed",
        timestamp,
        snapshot,
      }),
    ).toMatchObject({ type: "github.review_artifacts.refreshed" });
  });

  it("parses approval state payloads", () => {
    const approval = ApprovalStateSchema.parse({
      approvalId: "approval-1",
      runId: "run-1",
      provider: "codex",
      approvalType: "command",
      status: "pending",
      prompt: "Approve command: pnpm test",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      reason: "Run tests",
      command: "pnpm test",
      cwd: "/tmp/symphonia_workspaces/SYM-1",
      fileSummary: null,
      availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
      decision: null,
      requestedAt: timestamp,
      resolvedAt: null,
    });

    expect(approval.status).toBe("pending");
  });

  it("rejects invalid workflow-related payloads", () => {
    expect(() =>
      WorkflowConfigSchema.parse({
        provider: "mock",
        tracker: {
          kind: "mock",
          endpoint: null,
          apiKey: null,
          projectSlug: null,
          activeStates: ["Todo"],
          terminalStates: ["Done"],
        },
        polling: { intervalMs: 0 },
        workspace: { root: "/tmp/symphonia_workspaces" },
        hooks: {
          afterCreate: null,
          beforeRun: null,
          afterRun: null,
          beforeRemove: null,
          timeoutMs: 60000,
        },
        agent: {
          maxConcurrentAgents: 1,
          maxTurns: 1,
          maxRetryBackoffMs: 0,
          maxConcurrentAgentsByState: {},
        },
        codex: {
          command: "codex app-server",
          model: null,
          approvalPolicy: null,
          threadSandbox: null,
          turnSandboxPolicy: null,
          turnTimeoutMs: 1,
          readTimeoutMs: 1,
          stallTimeoutMs: 1,
        },
      }),
    ).toThrow();

    expect(() =>
      AgentEventSchema.parse({
        id: "event-bad-workspace",
        runId: "run-1",
        type: "workspace.ready",
        timestamp,
        workspace: {
          issueIdentifier: "SYM-1",
          workspaceKey: "",
          path: "/tmp/symphonia_workspaces/SYM-1",
          createdNow: true,
          exists: true,
        },
      }),
    ).toThrow();
  });
});
