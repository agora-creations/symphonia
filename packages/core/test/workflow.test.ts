import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Issue, WorkflowDefinition } from "@symphonia/types";
import {
  fallbackPrompt,
  loadWorkflowDefinition,
  PromptTemplateError,
  renderPromptTemplate,
  resolveWorkflowConfig,
  runHook,
  sanitizeWorkspaceKey,
  summarizeWorkflowConfig,
  WorkflowError,
  WorkspaceManager,
} from "../src/index";

const timestamp = "2026-05-13T08:00:00.000Z";
const tempRoots: string[] = [];
const originalEnv = { ...process.env };

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  process.env = { ...originalEnv };
});

describe("workflow parser", () => {
  it("returns a typed missing file error", () => {
    const missingPath = join(makeTempDir(), "WORKFLOW.md");
    expect(() => loadWorkflowDefinition({ workflowPath: missingPath })).toThrow(WorkflowError);
    expect(() => loadWorkflowDefinition({ workflowPath: missingPath })).toThrow("Workflow file not found");
  });

  it("loads a prompt-only file with empty config", () => {
    const workflowPath = writeWorkflow("Work on {{ issue.identifier }}.");
    const definition = loadWorkflowDefinition({ workflowPath, loadedAt: timestamp });

    expect(definition.config).toEqual({});
    expect(definition.promptTemplate).toBe("Work on {{ issue.identifier }}.");
    expect(definition.loadedAt).toBe(timestamp);
  });

  it("loads valid YAML front matter and trims the prompt body", () => {
    const workflowPath = writeWorkflow(`---
tracker:
  kind: linear
unknown_key: ignored
---

Use {{ issue.title }}.
`);
    const definition = loadWorkflowDefinition({ workflowPath, loadedAt: timestamp });

    expect(definition.config).toMatchObject({ tracker: { kind: "linear" }, unknown_key: "ignored" });
    expect(definition.promptTemplate).toBe("Use {{ issue.title }}.");
  });

  it("rejects invalid YAML", () => {
    const workflowPath = writeWorkflow(`---
tracker: [
---
Prompt`);

    expect(() => loadWorkflowDefinition({ workflowPath })).toThrow("workflow_yaml_invalid");
  });

  it("rejects front matter that is not an object", () => {
    const workflowPath = writeWorkflow(`---
- one
- two
---
Prompt`);

    expect(() => loadWorkflowDefinition({ workflowPath })).toThrow("Workflow YAML front matter must decode to an object");
  });

  it("allows an empty prompt body", () => {
    const workflowPath = writeWorkflow(`---
tracker:
  kind: linear
---
`);

    expect(loadWorkflowDefinition({ workflowPath }).promptTemplate).toBe("");
  });

  it("allows unknown top-level keys", () => {
    const workflowPath = writeWorkflow(`---
tracker:
  kind: linear
surprise:
  enabled: true
---
Prompt`);

    expect(loadWorkflowDefinition({ workflowPath }).config).toMatchObject({ surprise: { enabled: true } });
  });
});

describe("workflow config resolution", () => {
  it("applies defaults for real Linear and Codex config", () => {
    const config = resolveWorkflowConfig(definition({ tracker: linearTracker() }));

    expect(config.provider).toBe("codex");
    expect(config.tracker.kind).toBe("linear");
    expect(config.tracker.apiKey).toBe("linear-test-key");
    expect(config.tracker.allowWorkspaceWide).toBe(true);
    expect(config.github.enabled).toBe(false);
    expect(config.github.token).toBeNull();
    expect(config.claude.enabled).toBe(false);
    expect(config.cursor.enabled).toBe(false);
    expect(config.polling.intervalMs).toBe(30000);
    expect(config.agent.maxConcurrentAgents).toBe(10);
    expect(config.codex.command).toBe("codex app-server");
    expect(config.workspace.root).toContain("symphonia_workspaces");
  });

  it("resolves provider and codex settings from workflow config", () => {
    const config = resolveWorkflowConfig(
      definition({
        provider: "codex",
        tracker: linearTracker(),
        codex: {
          command: "codex app-server",
          model: "gpt-test",
          approval_policy: "on-request",
          turn_sandbox_policy: "workspaceWrite",
        },
      }),
    );

    expect(config.provider).toBe("codex");
    expect(config.codex.model).toBe("gpt-test");
    expect(config.codex.approvalPolicy).toBe("on-request");
    expect(config.codex.turnSandboxPolicy).toBe("workspaceWrite");
  });

  it("resolves Claude and Cursor provider settings with redacted env summaries", () => {
    const config = resolveWorkflowConfig(
      definition({
        provider: "claude",
        tracker: linearTracker(),
        claude: {
          enabled: true,
          command: "claude",
          model: "sonnet",
          max_turns: 4,
          output_format: "stream-json",
          permission_mode: "default",
          allowed_tools: ["Read", "Grep"],
          disallowed_tools: ["Bash(rm:*)"],
          append_system_prompt: "Use the repo workflow.",
          extra_args: ["--verbose"],
          env: { ANTHROPIC_API_KEY: "secret" },
          redacted_env_keys: ["ANTHROPIC_API_KEY"],
        },
        cursor: {
          enabled: true,
          command: "cursor-agent",
          model: "cursor-test",
          output_format: "stream-json",
          force: false,
          env: { CURSOR_API_KEY: "cursor-secret" },
          redacted_env_keys: ["CURSOR_API_KEY"],
        },
      }),
    );

    expect(config.provider).toBe("claude");
    expect(config.claude.enabled).toBe(true);
    expect(config.claude.maxTurns).toBe(4);
    expect(config.claude.allowedTools).toEqual(["Read", "Grep"]);
    expect(config.cursor.enabled).toBe(true);
    expect(config.cursor.force).toBe(false);

    const summary = summarizeWorkflowConfig(config);
    expect(summary.providers.claude.envKeys).toEqual(["ANTHROPIC_API_KEY"]);
    expect(summary.providers.cursor.envKeys).toEqual(["CURSOR_API_KEY"]);
    expect(JSON.stringify(summary)).not.toContain("secret");
  });

  it("supports provider and codex command environment overrides", () => {
    process.env.SYMPHONIA_PROVIDER = "codex";
    process.env.SYMPHONIA_CODEX_COMMAND = "node fake-app-server.mjs";

    const config = resolveWorkflowConfig(definition({ tracker: linearTracker(), provider: "codex" }));

    expect(config.provider).toBe("codex");
    expect(config.codex.command).toBe("node fake-app-server.mjs");
  });

  it("rejects unsupported providers", () => {
    expect(() => resolveWorkflowConfig(definition({ tracker: linearTracker(), provider: "banana" }))).toThrow(
      "Unsupported provider",
    );
  });

  it("resolves env vars for api keys and workspace roots", () => {
    const workspaceRoot = join(makeTempDir(), "env-root");
    process.env.SYMPHONIA_TEST_LINEAR_KEY = "linear-secret";
    process.env.SYMPHONIA_TEST_WORKSPACE_ROOT = workspaceRoot;

    const config = resolveWorkflowConfig(
      definition({
        tracker: { kind: "linear", api_key: "$SYMPHONIA_TEST_LINEAR_KEY", project_slug: "demo" },
        workspace: { root: "$SYMPHONIA_TEST_WORKSPACE_ROOT/workspaces" },
      }),
    );

    expect(config.tracker.apiKey).toBe("linear-secret");
    expect(config.workspace.root).toBe(resolve(workspaceRoot, "workspaces"));
  });

  it("resolves relative workspace roots from the workflow directory", () => {
    const root = makeTempDir();
    const workflowPath = join(root, "nested", "WORKFLOW.md");
    const config = resolveWorkflowConfig(
      definition({ tracker: linearTracker(), workspace: { root: ".symphonia/workspaces" } }, workflowPath),
    );

    expect(config.workspace.root).toBe(resolve(root, "nested", ".symphonia/workspaces"));
  });

  it("fails when tracker kind is missing", () => {
    expect(() => resolveWorkflowConfig(definition({}))).toThrow("tracker.kind is required");
  });

  it("resolves valid linear config with env api key and safe summary", () => {
    process.env.SYMPHONIA_TEST_LINEAR_KEY = "linear-secret";

    const config = resolveWorkflowConfig(
      definition({
        tracker: {
          kind: "linear",
          api_key: "$SYMPHONIA_TEST_LINEAR_KEY",
          team_key: "ENG",
          project_slug: "demo-project",
          active_states: ["Todo", "In Progress"],
          terminal_states: ["Done", "Canceled"],
          page_size: 25,
          max_pages: 3,
          read_only: true,
          write: { enabled: false },
        },
      }),
    );

    expect(config.tracker.kind).toBe("linear");
    expect(config.tracker.apiKey).toBe("linear-secret");
    expect(config.tracker.teamKey).toBe("ENG");
    expect(config.tracker.projectSlug).toBe("demo-project");
    expect(config.tracker.pageSize).toBe(25);
    expect(config.tracker.maxPages).toBe(3);
    expect(config.tracker.readOnly).toBe(true);

    const summary = summarizeWorkflowConfig(config);
    expect(summary.trackerKind).toBe("linear");
    expect(summary.teamKey).toBe("ENG");
    expect(summary.projectSlug).toBe("demo-project");
    expect(JSON.stringify(summary)).not.toContain("linear-secret");
    expect(JSON.stringify(summary)).not.toContain("apiKey");
  });

  it("allows connected-auth linear config without api key but still requires a practical scope", () => {
    const config = resolveWorkflowConfig(definition({ tracker: { kind: "linear", project_slug: "demo" } }));
    expect(config.tracker.apiKey).toBeNull();
    expect(config.tracker.projectSlug).toBe("demo");

    expect(() => resolveWorkflowConfig(definition({ tracker: { kind: "linear", api_key: "key" } }))).toThrow(
      "requires team_key, team_id, project_slug, project_id, or allow_workspace_wide",
    );
  });

  it("allows explicitly configured workspace-wide linear polling", () => {
    const config = resolveWorkflowConfig(
      definition({
        tracker: {
          kind: "linear",
          api_key: "key",
          allow_workspace_wide: true,
        },
      }),
    );

    expect(config.tracker.allowWorkspaceWide).toBe(true);
  });

  it("rejects invalid linear pagination bounds", () => {
    expect(() =>
      resolveWorkflowConfig(
        definition({
          tracker: { kind: "linear", api_key: "key", team_key: "ENG", page_size: 0 },
        }),
      ),
    ).toThrow("tracker.page_size must be between");
    expect(() =>
      resolveWorkflowConfig(
        definition({
          tracker: { kind: "linear", api_key: "key", team_key: "ENG", max_pages: 0 },
        }),
      ),
    ).toThrow("tracker.max_pages must be between");
  });

  it("resolves optional github config with redacted token summary", () => {
    process.env.SYMPHONIA_TEST_GITHUB_TOKEN = "github-secret";

    const config = resolveWorkflowConfig(
      definition({
        tracker: linearTracker(),
        github: {
          enabled: true,
          endpoint: "https://api.github.com",
          token: "$SYMPHONIA_TEST_GITHUB_TOKEN",
          owner: "agora-creations",
          repo: "symphonia",
          default_base_branch: "main",
          remote_name: "origin",
          read_only: true,
          page_size: 25,
          max_pages: 2,
          write: { enabled: false },
        },
      }),
    );

    expect(config.github.enabled).toBe(true);
    expect(config.github.token).toBe("github-secret");
    expect(config.github.owner).toBe("agora-creations");
    expect(config.github.repo).toBe("symphonia");
    expect(config.github.write.enabled).toBe(false);

    const summary = summarizeWorkflowConfig(config);
    expect(summary.github.tokenConfigured).toBe(true);
    expect(summary.github.owner).toBe("agora-creations");
    expect(JSON.stringify(summary)).not.toContain("github-secret");
    expect(JSON.stringify(summary)).not.toContain("token\":\"");
  });

  it("allows github enabled without token for local-only artifacts", () => {
    const config = resolveWorkflowConfig(
      definition({
        tracker: linearTracker(),
        github: {
          enabled: true,
          owner: "agora-creations",
          repo: "symphonia",
        },
      }),
    );

    expect(config.github.enabled).toBe(true);
    expect(config.github.token).toBeNull();
  });

  it("validates github repository, pagination, and write guards", () => {
    expect(() =>
      resolveWorkflowConfig(definition({ tracker: linearTracker(), github: { enabled: true, owner: "agora-creations" } })),
    ).toThrow("github.owner and github.repo are required");
    expect(() =>
      resolveWorkflowConfig(
        definition({ tracker: linearTracker(), github: { enabled: true, owner: "agora-creations", repo: "symphonia", page_size: 0 } }),
      ),
    ).toThrow("github.page_size must be between");
    expect(() =>
      resolveWorkflowConfig(
        definition({ tracker: linearTracker(), github: { enabled: true, owner: "agora-creations", repo: "symphonia", max_pages: 0 } }),
      ),
    ).toThrow("github.max_pages must be between");
    expect(() =>
      resolveWorkflowConfig(
        definition({
          tracker: linearTracker(),
          github: {
            enabled: true,
            owner: "agora-creations",
            repo: "symphonia",
            read_only: false,
            write: { enabled: false, allow_create_pr: true },
          },
        }),
      ),
    ).toThrow("GitHub write options require github.write.enabled");
  });

  it("fails invalid positive numeric settings", () => {
    expect(() =>
      resolveWorkflowConfig(definition({ tracker: linearTracker(), hooks: { timeout_ms: 0 } })),
    ).toThrow("hooks.timeout_ms must be positive");
    expect(() =>
      resolveWorkflowConfig(definition({ tracker: linearTracker(), agent: { max_turns: -1 } })),
    ).toThrow("agent.max_turns must be positive");
  });

  it("resolves workspace cleanup policy defaults and safe summaries", () => {
    const config = resolveWorkflowConfig(
      definition({
        tracker: linearTracker(),
        workspace: {
          root: ".symphonia/workspaces",
          cleanup: {
            enabled: true,
            dry_run: false,
            require_manual_confirmation: true,
            delete_terminal_after_ms: 0,
            protect_active: true,
            protect_dirty_git: true,
            exclude_identifiers: ["ENG-SECRET"],
          },
        },
      }),
    );
    const summary = summarizeWorkflowConfig(config);

    expect(config.workspace.cleanup).toMatchObject({
      enabled: true,
      dryRun: false,
      requireManualConfirmation: true,
      deleteTerminalAfterMs: 0,
      protectActive: true,
      protectDirtyGit: true,
    });
    expect(summary.workspaceCleanup.excludeIdentifiers).toEqual(["ENG-SECRET"]);
  });
});

describe("prompt rendering", () => {
  const issue = issueFixture();
  const workflow = {
    defaultProvider: "codex" as const,
    trackerKind: "linear" as const,
    endpoint: null,
    projectSlug: null,
    teamKey: null,
    teamId: null,
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
    hookTimeoutMs: 30000,
    codexCommand: "codex app-server",
    codexModel: null,
    providers: {
      codex: { enabled: true, command: "codex app-server", model: null },
      claude: {
        enabled: false,
        command: "claude",
        model: "sonnet",
        outputFormat: "stream-json" as const,
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
        outputFormat: "stream-json" as const,
        force: false,
        extraArgs: [],
        envKeys: [],
        redactedEnvKeys: [],
        timeoutMs: 3600000,
        stallTimeoutMs: 300000,
        readTimeoutMs: 5000,
      },
    },
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
  };

  it("renders issue fields, labels, and attempt", () => {
    const prompt = renderPromptTemplate(
      `Issue {{ issue.identifier }}: {{ issue.title }}
{{ issue.description }}
{{ issue.labels }}
Attempt {{ attempt }}`,
      { issue, attempt: 2, workflow },
    );

    expect(prompt).toContain("Issue SYM-1: Build board");
    expect(prompt).toContain("Render columns");
    expect(prompt).toContain("frontend, board");
    expect(prompt).toContain("Attempt 2");
  });

  it("renders null first attempts as empty strings", () => {
    expect(renderPromptTemplate("Attempt: {{ attempt }}", { issue, attempt: null, workflow })).toBe("Attempt: ");
  });

  it("uses a fallback prompt for empty templates", () => {
    expect(renderPromptTemplate("", { issue, attempt: null, workflow })).toBe(fallbackPrompt);
  });

  it("fails unknown variables and helpers", () => {
    expect(() => renderPromptTemplate("{{ issue.missing }}", { issue, workflow })).toThrow(PromptTemplateError);
    expect(() => renderPromptTemplate("{{ issue.title | upcase }}", { issue, workflow })).toThrow(PromptTemplateError);
  });
});

describe("workspace manager", () => {
  it("sanitizes workspace identifiers", () => {
    expect(sanitizeWorkspaceKey("SYM/../../1:bad key")).toBe("SYM_.._.._1_bad_key");
  });

  it("creates and reuses issue workspaces", () => {
    const manager = new WorkspaceManager(makeTempDir());
    const issue = issueFixture();
    const first = manager.prepareIssueWorkspace(issue);
    const second = manager.prepareIssueWorkspace(issue);

    expect(first.createdNow).toBe(true);
    expect(second.createdNow).toBe(false);
    expect(first.path).toBe(second.path);
  });

  it("keeps suspicious identifiers under the configured root", () => {
    const root = makeTempDir();
    const manager = new WorkspaceManager(root);
    const info = manager.getIssueWorkspace("../outside");

    expect(info.workspaceKey).toBe(".._outside");
    expect(info.path.startsWith(resolve(root))).toBe(true);
  });

  it("creates distinct directories for distinct issues", () => {
    const manager = new WorkspaceManager(makeTempDir());
    const first = manager.prepareIssueWorkspace(issueFixture("SYM-1"));
    const second = manager.prepareIssueWorkspace(issueFixture("SYM-2"));

    expect(first.path).not.toBe(second.path);
    expect(manager.listExistingWorkspaces(["SYM-1", "SYM-2"])).toHaveLength(2);
  });
});

describe("hook runner", () => {
  it("captures successful hook output", async () => {
    const result = await runHook({
      hookName: "beforeRun",
      command: "printf ok",
      cwd: makeTempDir(),
      timeoutMs: 1000,
    });

    expect(result.status).toBe("succeeded");
    expect(result.stdout).toBe("ok");
  });

  it("captures failed hook output", async () => {
    const result = await runHook({
      hookName: "beforeRun",
      command: "printf fail >&2; exit 7",
      cwd: makeTempDir(),
      timeoutMs: 1000,
    });

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toBe("fail");
  });

  it("times out slow hooks", async () => {
    const result = await runHook({
      hookName: "beforeRun",
      command: "sleep 1",
      cwd: makeTempDir(),
      timeoutMs: 25,
    });

    expect(result.status).toBe("timed_out");
    expect(result.error).toBe("Hook timed out.");
  });

  it("allows after_create orchestration to run only for newly-created workspaces", async () => {
    const root = makeTempDir();
    const manager = new WorkspaceManager(root);
    const issue = issueFixture();
    const first = manager.prepareIssueWorkspace(issue);
    const second = manager.prepareIssueWorkspace(issue);

    if (first.createdNow) {
      await runHook({
        hookName: "afterCreate",
        command: "printf created >> marker.txt",
        cwd: first.path,
        timeoutMs: 1000,
      });
    }

    if (second.createdNow) {
      await runHook({
        hookName: "afterCreate",
        command: "printf created >> marker.txt",
        cwd: second.path,
        timeoutMs: 1000,
      });
    }

    expect(readFileSync(join(first.path, "marker.txt"), "utf8")).toBe("created");
  });
});

function definition(config: Record<string, unknown>, workflowPath = join(makeTempDir(), "WORKFLOW.md")): WorkflowDefinition {
  return { config, promptTemplate: "Prompt", workflowPath, loadedAt: timestamp };
}

function writeWorkflow(contents: string): string {
  const workflowPath = join(makeTempDir(), "WORKFLOW.md");
  writeFileSync(workflowPath, contents);
  return workflowPath;
}

function makeTempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "symphonia-core-test-"));
  tempRoots.push(root);
  return root;
}

function linearTracker(overrides: Record<string, unknown> = {}) {
  return { kind: "linear", api_key: "linear-test-key", allow_workspace_wide: true, ...overrides };
}

function issueFixture(identifier = "SYM-1"): Issue {
  return {
    id: `issue-${identifier}`,
    identifier,
    title: "Build board",
    description: "Render columns",
    state: "Todo",
    labels: ["frontend", "board"],
    priority: "High",
    createdAt: timestamp,
    updatedAt: timestamp,
    url: `https://linear.app/acme/issue/${identifier}`,
  };
}
