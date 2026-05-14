import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Issue, Run, WorkspaceCleanupPolicy } from "@symphonia/types";
import { buildWorkspaceInventory, planWorkspaceCleanup } from "../src/workspace-cleanup";

let directory: string;
let root: string;

beforeEach(() => {
  directory = join(tmpdir(), `symphonia-cleanup-${randomUUID()}`);
  root = join(directory, "workspaces");
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("workspace cleanup planning", () => {
  it("returns an empty inventory for an empty workspace root", async () => {
    const inventory = await buildWorkspaceInventory({
      workspaceRoot: root,
      runs: [],
      issues: [],
      cleanupPolicy: policy(),
      inspectGit: false,
    });

    expect(inventory.counts).toEqual({ total: 0, active: 0, protected: 0, candidates: 0 });
  });

  it("marks active and recent workspaces as protected", async () => {
    mkdirSync(join(root, "ENG-1"));
    const inventory = await buildWorkspaceInventory({
      workspaceRoot: root,
      runs: [run("ENG-1", "streaming", "2026-05-13T08:59:00.000Z")],
      issues: [issue("ENG-1", "In Progress")],
      cleanupPolicy: policy(),
      now: "2026-05-20T09:00:00.000Z",
      inspectGit: false,
    });

    expect(inventory.workspaces[0]).toMatchObject({
      issueIdentifier: "ENG-1",
      active: true,
      protected: true,
      cleanupCandidate: false,
    });
  });

  it("plans old terminal workspaces as candidates when cleanup is enabled", async () => {
    mkdirSync(join(root, "ENG-2"));
    const inventory = await buildWorkspaceInventory({
      workspaceRoot: root,
      runs: [run("ENG-2", "succeeded", "2026-05-01T09:00:00.000Z")],
      issues: [issue("ENG-2", "Done")],
      cleanupPolicy: policy({ enabled: true, protectRecentRunsMs: 0, deleteTerminalAfterMs: 0 }),
      now: "2026-05-20T09:00:00.000Z",
      inspectGit: false,
    });
    const plan = planWorkspaceCleanup(inventory, policy({ enabled: true, protectRecentRunsMs: 0, deleteTerminalAfterMs: 0 }), {
      id: "plan-1",
      now: "2026-05-20T09:00:00.000Z",
    });

    expect(plan.candidates[0]?.reasons).toContain("terminal_issue_old_enough");
  });

  it("keeps cleanup disabled plans protected", async () => {
    mkdirSync(join(root, "ENG-3"));
    const inventory = await buildWorkspaceInventory({
      workspaceRoot: root,
      runs: [run("ENG-3", "succeeded", "2026-05-01T09:00:00.000Z")],
      issues: [issue("ENG-3", "Done")],
      cleanupPolicy: policy({ enabled: false }),
      now: "2026-05-13T09:00:00.000Z",
      inspectGit: false,
    });
    const plan = planWorkspaceCleanup(inventory, policy({ enabled: false }), {
      id: "plan-2",
      now: "2026-05-13T09:00:00.000Z",
    });

    expect(plan.candidates).toHaveLength(0);
    expect(plan.protected[0]?.protectionReasons).toContain("cleanup_disabled");
  });

  it("protects dirty git workspaces by default", async () => {
    const workspace = join(root, "ENG-4");
    mkdirSync(workspace);
    execFileSync("git", ["init"], { cwd: workspace, stdio: "ignore" });
    writeFileSync(join(workspace, "README.md"), "dirty\n");

    const inventory = await buildWorkspaceInventory({
      workspaceRoot: root,
      runs: [run("ENG-4", "succeeded", "2026-05-01T09:00:00.000Z")],
      issues: [issue("ENG-4", "Done")],
      cleanupPolicy: policy({ enabled: true, protectRecentRunsMs: 0 }),
      now: "2026-05-13T09:00:00.000Z",
    });
    const plan = planWorkspaceCleanup(inventory, policy({ enabled: true, protectRecentRunsMs: 0 }), {
      id: "plan-3",
      now: "2026-05-13T09:00:00.000Z",
    });

    expect(plan.protected[0]?.protectionReasons).toContain("dirty_git");
  });
});

function policy(overrides: Partial<WorkspaceCleanupPolicy> = {}): WorkspaceCleanupPolicy {
  return {
    enabled: false,
    dryRun: true,
    requireManualConfirmation: true,
    deleteTerminalAfterMs: 7 * 86_400_000,
    deleteOrphanedAfterMs: 14 * 86_400_000,
    deleteInterruptedAfterMs: 14 * 86_400_000,
    maxWorkspaceAgeMs: null,
    maxTotalBytes: null,
    protectActive: true,
    protectRecentRunsMs: 86_400_000,
    protectDirtyGit: true,
    includeTerminalStates: ["Done", "Closed", "Cancelled", "Canceled", "Duplicate"],
    excludeIdentifiers: [],
    includeIdentifiers: [],
    ...overrides,
  };
}

function issue(identifier: string, state: string): Issue {
  return {
    id: `issue-${identifier}`,
    identifier,
    title: identifier,
    description: "",
    state,
    labels: [],
    priority: "No priority",
    createdAt: "2026-05-01T09:00:00.000Z",
    updatedAt: "2026-05-01T09:00:00.000Z",
    url: `https://linear.app/acme/issue/${identifier}`,
    tracker: { kind: "linear", sourceId: `issue-${identifier}` },
  };
}

function run(identifier: string, status: Run["status"], updatedAt: string): Run {
  return {
    id: `run-${identifier}`,
    issueId: `issue-${identifier}`,
    issueIdentifier: identifier,
    issueTitle: identifier,
    trackerKind: "linear",
    status,
    provider: "codex",
    attempt: 1,
    retryOfRunId: null,
    workspacePath: join(root, identifier),
    renderedPromptId: null,
    providerMetadata: {},
    startedAt: updatedAt,
    updatedAt,
    endedAt: status === "streaming" ? null : updatedAt,
    lastEventAt: updatedAt,
    terminalReason: null,
    error: null,
    recoveryState: status === "streaming" ? "active" : "terminal",
    recoveredAt: null,
    createdByDaemonInstanceId: "daemon-test",
    lastSeenDaemonInstanceId: "daemon-test",
  };
}
