import { describe, expect, it } from "vitest";
import {
  ApprovalStateSchema,
  AgentEventSchema,
  AuthDisconnectRequestSchema,
  AuthStartRequestSchema,
  AuthStartResultSchema,
  AuthValidationResultSchema,
  IntegrationAuthConnectionSchema,
  ReviewArtifactSnapshotSchema,
  HookRunSchema,
  HarnessApplyRequestSchema,
  HarnessScanRequestSchema,
  HarnessScanResultSchema,
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
      description: "Render Linear issues.",
      state: "Todo",
      labels: ["frontend"],
      priority: "High",
      createdAt: timestamp,
      updatedAt: timestamp,
      url: "https://linear.app/acme/issue/SYM-1",
    });

    expect(issue.identifier).toBe("SYM-1");
  });

  it("parses a valid run", () => {
    const run = RunSchema.parse({
      id: "run-1",
      issueId: "issue-1",
      issueIdentifier: "SYM-1",
      status: "queued",
      provider: "codex",
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
        title: "Provider diff",
        content: "+ added",
      },
      {
        id: "event-6",
        runId: "__daemon__",
        type: "harness.scan.started",
        timestamp,
        scanId: "scan-1",
        repositoryPath: "/tmp/repo",
      },
      {
        id: "event-7",
        runId: "__daemon__",
        type: "harness.artifact.applied",
        timestamp,
        scanId: "scan-1",
        artifactId: "agents-md",
        path: "AGENTS.md",
      },
    ];

    expect(events.map((event) => AgentEventSchema.parse(event))).toHaveLength(7);
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

  it("parses auth connections, requests, results, validation, and redacted events", () => {
    const connection = IntegrationAuthConnectionSchema.parse({
      id: "github-connected",
      provider: "github",
      method: "oauth_device",
      status: "connected",
      accountLabel: "octocat",
      accountId: "123",
      workspaceLabel: null,
      workspaceId: null,
      scopes: ["repo"],
      permissions: [],
      tokenStorage: "encrypted_local_file",
      tokenExpiresAt: timestamp,
      refreshTokenExpiresAt: null,
      connectedAt: timestamp,
      lastValidatedAt: timestamp,
      lastError: null,
      redactedSource: "connected:abc123...7890",
      credentialSource: "connected",
      refreshSupported: true,
      envTokenPresent: false,
      clientIdConfigured: true,
      clientSecretConfigured: false,
    });
    expect(JSON.stringify(connection)).not.toContain("ghu_");

    const request = AuthStartRequestSchema.parse({
      provider: "linear",
      method: "oauth_pkce",
      requestedScopes: ["read"],
      redirectMode: "loopback",
      repositoryPath: "/tmp/repo",
      metadata: { clientId: "linear-client" },
    });
    expect(request.method).toBe("oauth_pkce");

    const start = AuthStartResultSchema.parse({
      authSessionId: "session-1",
      provider: "github",
      method: "oauth_device",
      status: "pending_user",
      authorizationUrl: "https://github.com/login/device",
      verificationUri: "https://github.com/login/device",
      userCode: "ABCD-1234",
      expiresAt: timestamp,
      pollIntervalMs: 5000,
      instructions: ["Enter the code."],
    });
    expect(start.status).toBe("pending_user");

    const validation = AuthValidationResultSchema.parse({
      provider: "github",
      status: "connected",
      account: { id: "123", label: "octocat", workspaceId: null, workspaceLabel: null },
      scopes: ["repo"],
      permissions: [],
      expiresAt: timestamp,
      error: null,
      credentialSource: "connected",
      redactedSource: "connected:abc123...7890",
    });
    expect(validation.account?.label).toBe("octocat");

    expect(AuthDisconnectRequestSchema.parse({ provider: "github" }).deleteStoredToken).toBe(true);

    expect(
      AgentEventSchema.parse({
        id: "auth-event",
        runId: "__daemon__",
        type: "auth.connected",
        timestamp,
        connection,
      }).type,
    ).toBe("auth.connected");

    expect(() =>
      IntegrationAuthConnectionSchema.parse({
        ...connection,
        provider: "dropbox",
      }),
    ).toThrow();
  });

  it("parses harness scan results and rejects invalid apply payloads", () => {
    const request = HarnessScanRequestSchema.parse({
      repositoryPath: "/tmp/repo",
    });
    expect(request.includeGitStatus).toBe(true);

    const scan = HarnessScanResultSchema.parse({
      id: "scan-1",
      repositoryPath: "/tmp/repo",
      scannedAt: timestamp,
      score: {
        overall: 8,
        max: 10,
        percentage: 80,
        grade: "B",
        categoryScores: {
          "repository-map": {
            score: 8,
            max: 10,
            percentage: 80,
            grade: "B",
            status: "strong",
          },
        },
      },
      grade: "B",
      categories: [
        {
          id: "repository-map",
          label: "Repository Map",
          score: 8,
          max: 10,
          status: "strong",
          summary: "Good map.",
          evidence: [{ label: "README", value: "Found README.md", filePath: "README.md", lineNumber: null }],
          findings: ["readme-present"],
          recommendations: [],
        },
      ],
      findings: [
        {
          id: "readme-present",
          categoryId: "repository-map",
          severity: "info",
          status: "present",
          title: "README present",
          description: "README exists.",
          evidence: [{ label: "README", value: "Found README.md", filePath: "README.md", lineNumber: null }],
          filePath: "README.md",
          lineNumber: null,
          recommendationIds: [],
        },
      ],
      recommendations: [],
      detectedFiles: [{ path: "README.md", kind: "readme", exists: true, sizeBytes: 12, hash: "abc", summary: "README" }],
      generatedPreviews: [],
      warnings: [],
      errors: [],
      metadata: {
        isGitRepository: true,
        gitDirty: false,
        gitBranch: "main",
        gitRemote: "https://github.com/acme/repo",
        packageManager: "pnpm",
        languages: ["TypeScript"],
        frameworks: ["Node"],
        validationCommands: [],
      },
      limits: {
        maxFiles: 100,
        maxBytes: 1000,
        maxFileSizeBytes: 1000,
        filesScanned: 1,
        bytesRead: 12,
        truncated: false,
      },
    });

    expect(scan.grade).toBe("B");
    expect(() =>
      HarnessApplyRequestSchema.parse({
        repositoryPath: "/tmp/repo",
        artifactIds: [],
        dryRun: false,
      }),
    ).toThrow();
  });

  it("parses valid workflow config, definition, status, workspace, and hook payloads", () => {
    const config = WorkflowConfigSchema.parse({
      provider: "codex",
      tracker: {
        kind: "linear",
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
      claude: {
        enabled: false,
        command: "claude",
        model: "sonnet",
        maxTurns: 8,
        outputFormat: "stream-json",
        permissionMode: "default",
        allowedTools: [],
        disallowedTools: [],
        appendSystemPrompt: null,
        extraArgs: [],
        env: {},
        redactedEnvKeys: [],
        healthCheckCommand: null,
        timeoutMs: 3600000,
        stallTimeoutMs: 300000,
        readTimeoutMs: 5000,
        cwdBehavior: "workspace",
      },
      cursor: {
        enabled: false,
        command: "cursor-agent",
        model: null,
        outputFormat: "stream-json",
        force: false,
        extraArgs: [],
        env: {},
        redactedEnvKeys: [],
        healthCheckCommand: null,
        timeoutMs: 3600000,
        stallTimeoutMs: 300000,
        readTimeoutMs: 5000,
        cwdBehavior: "workspace",
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

    expect(config.tracker.kind).toBe("linear");

    const definition = WorkflowDefinitionSchema.parse({
      config: { tracker: { kind: "linear" } },
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
        defaultProvider: "codex",
        trackerKind: "linear",
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
        providers: summaryProviders(),
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
          defaultProvider: "codex",
          trackerKind: "linear",
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
          providers: summaryProviders(),
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
        id: "event-claude-result",
        runId: "run-1",
        type: "claude.result",
        timestamp,
        sessionId: "claude-session-1",
        model: "sonnet",
        result: "Claude finished.",
        isError: false,
        numTurns: 2,
        durationMs: 1234,
        totalCostUsd: 0.01,
      },
      {
        id: "event-cursor-result",
        runId: "run-1",
        type: "cursor.result",
        timestamp,
        sessionId: "cursor-session-1",
        requestId: "request-1",
        model: "cursor-test",
        result: "Cursor finished.",
        isError: false,
        durationMs: 1234,
        durationApiMs: 1000,
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

    expect(events.map((event) => AgentEventSchema.parse(event))).toHaveLength(11);
  });

  it("parses review artifact snapshots and github events", () => {
    const snapshot = ReviewArtifactSnapshotSchema.parse({
      runId: "run-1",
      issueId: "issue-1",
      issueIdentifier: "SYM-1",
      provider: "codex",
      trackerKind: "linear",
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
        provider: "codex",
        tracker: {
          kind: "linear",
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

function summaryProviders() {
  return {
    codex: { enabled: true, command: "codex app-server", model: null },
    claude: {
      enabled: false,
      command: "claude",
      model: "sonnet",
      outputFormat: "stream-json",
      permissionMode: "default",
      allowedTools: [],
      disallowedTools: [],
      appendSystemPromptConfigured: false,
      extraArgs: [],
      envKeys: [],
      redactedEnvKeys: [],
      timeoutMs: 3600000,
      stallTimeoutMs: 300000,
      readTimeoutMs: 5000,
    },
    cursor: {
      enabled: false,
      command: "cursor-agent",
      model: null,
      outputFormat: "stream-json",
      force: false,
      extraArgs: [],
      envKeys: [],
      redactedEnvKeys: [],
      timeoutMs: 3600000,
      stallTimeoutMs: 300000,
      readTimeoutMs: 5000,
    },
  };
}
