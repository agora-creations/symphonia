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
  kind: mock
unknown_key: ignored
---

Use {{ issue.title }}.
`);
    const definition = loadWorkflowDefinition({ workflowPath, loadedAt: timestamp });

    expect(definition.config).toMatchObject({ tracker: { kind: "mock" }, unknown_key: "ignored" });
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
  kind: mock
---
`);

    expect(loadWorkflowDefinition({ workflowPath }).promptTemplate).toBe("");
  });

  it("allows unknown top-level keys", () => {
    const workflowPath = writeWorkflow(`---
tracker:
  kind: mock
surprise:
  enabled: true
---
Prompt`);

    expect(loadWorkflowDefinition({ workflowPath }).config).toMatchObject({ surprise: { enabled: true } });
  });
});

describe("workflow config resolution", () => {
  it("applies defaults for mock tracker config without credentials", () => {
    const config = resolveWorkflowConfig(definition({ tracker: { kind: "mock" } }));

    expect(config.tracker.kind).toBe("mock");
    expect(config.tracker.apiKey).toBeNull();
    expect(config.polling.intervalMs).toBe(30000);
    expect(config.agent.maxConcurrentAgents).toBe(10);
    expect(config.codex.command).toBe("codex app-server");
    expect(config.workspace.root).toContain("symphonia_workspaces");
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
      definition({ tracker: { kind: "mock" }, workspace: { root: ".symphonia/workspaces" } }, workflowPath),
    );

    expect(config.workspace.root).toBe(resolve(root, "nested", ".symphonia/workspaces"));
  });

  it("fails when tracker kind is missing", () => {
    expect(() => resolveWorkflowConfig(definition({}))).toThrow("tracker.kind is required");
  });

  it("requires linear api key and project slug", () => {
    expect(() => resolveWorkflowConfig(definition({ tracker: { kind: "linear", project_slug: "demo" } }))).toThrow(
      "tracker.api_key is required",
    );
    expect(() => resolveWorkflowConfig(definition({ tracker: { kind: "linear", api_key: "key" } }))).toThrow(
      "tracker.project_slug is required",
    );
  });

  it("fails invalid positive numeric settings", () => {
    expect(() =>
      resolveWorkflowConfig(definition({ tracker: { kind: "mock" }, hooks: { timeout_ms: 0 } })),
    ).toThrow("hooks.timeout_ms must be positive");
    expect(() =>
      resolveWorkflowConfig(definition({ tracker: { kind: "mock" }, agent: { max_turns: -1 } })),
    ).toThrow("agent.max_turns must be positive");
  });
});

describe("prompt rendering", () => {
  const issue = mockIssue();
  const workflow = {
    trackerKind: "mock" as const,
    endpoint: null,
    projectSlug: null,
    activeStates: ["Todo"],
    terminalStates: ["Done"],
    workspaceRoot: "/tmp/symphonia_workspaces",
    maxConcurrentAgents: 3,
    maxTurns: 8,
    hookTimeoutMs: 30000,
    codexCommand: "codex app-server",
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
    const issue = mockIssue();
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
    const first = manager.prepareIssueWorkspace(mockIssue("SYM-1"));
    const second = manager.prepareIssueWorkspace(mockIssue("SYM-2"));

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
    const issue = mockIssue();
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

function mockIssue(identifier = "SYM-1"): Issue {
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
    url: `https://mock.local/issues/${identifier}`,
  };
}
