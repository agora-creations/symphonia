import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { applyHarnessArtifacts, HARNESS_APPLY_CONFIRMATION, scanHarnessRepository } from "../src/index";
import type { HarnessArtifactPreview } from "@symphonia/types";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("harness scanner, scoring, generator, and apply engine", () => {
  it("scans an empty repo without failing and reports weak readiness", () => {
    const repo = tempRepo();
    const scanResult = runScan(repo);

    expect(scanResult.score.percentage).toBeLessThan(50);
    expect(scanResult.findings.some((finding) => finding.id === "agents-missing")).toBe(true);
    expect(scanResult.recommendations.some((recommendation) => recommendation.id === "create-agents-map")).toBe(true);
  });

  it("scores a strong TypeScript repo with evidence and deterministic results", () => {
    const repo = strongRepo();
    const first = runScan(repo);
    const second = runScan(repo);

    expect(first.score.percentage).toBeGreaterThanOrEqual(80);
    expect(second.score).toEqual(first.score);
    expect(first.categories.every((category) => category.evidence.length > 0)).toBe(true);
    expect(first.metadata.validationCommands.map((command) => command.command)).toEqual(
      expect.arrayContaining(["pnpm test", "pnpm lint", "pnpm build"]),
    );
  });

  it("detects missing AGENTS.md and missing validation loop", () => {
    const repo = tempRepo();
    write(repo, "README.md", "# Demo\n");
    const scanResult = runScan(repo);

    expect(scanResult.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(["agents-missing", "test-missing", "lint-missing", "build-missing"]),
    );
  });

  it("skips giant files, ignored generated folders, and symlink escapes", () => {
    const repo = tempRepo();
    write(repo, "README.md", "# Demo\n");
    write(repo, "large.txt", "x".repeat(300_000));
    write(repo, "node_modules/pkg/package.json", "{}\n");
    const outside = tempRepo();
    write(outside, "secret.txt", "outside\n");
    symlinkSync(outside, join(repo, "outside-link"));

    const scanResult = runScan(repo);

    expect(scanResult.warnings.some((warning) => warning.includes("large"))).toBe(true);
    expect(scanResult.warnings.some((warning) => warning.includes("symlink escape"))).toBe(true);
    expect(scanResult.detectedFiles.some((file) => file.path.startsWith("node_modules/"))).toBe(false);
  });

  it("detects dirty git state when enabled", () => {
    const repo = tempRepo();
    const git = spawnSync("git", ["init"], { cwd: repo, encoding: "utf8" });
    if (git.status !== 0) return;
    write(repo, "README.md", "# Dirty\n");

    const scanResult = runScan(repo);

    expect(scanResult.metadata.isGitRepository).toBe(true);
    expect(scanResult.metadata.gitDirty).toBe(true);
  });

  it("generates preview-only AGENTS, WORKFLOW, docs, scripts, and env artifacts", () => {
    const repo = tempRepo();
    write(repo, "package.json", JSON.stringify({ scripts: { test: "vitest run", lint: "tsc --noEmit", build: "tsc" }, dependencies: { next: "1.0.0", react: "1.0.0" } }));
    const scanResult = runScan(repo, true);
    const paths = scanResult.generatedPreviews.map((preview) => preview.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        "WORKFLOW.md",
        "docs/ARCHITECTURE.md",
        "docs/TESTING.md",
        "docs/FRONTEND.md",
        "docs/BACKEND.md",
        "docs/SECURITY.md",
        "docs/OPERATIONS.md",
        "docs/HARNESS.md",
        "scripts/check",
        "scripts/test",
        "scripts/lint",
        "skills/README.md",
        ".env.example",
      ]),
    );
    expect(scanResult.generatedPreviews.every((preview) => !preview.proposedContent.includes("secret-value"))).toBe(true);
    expect(existsSync(join(repo, "AGENTS.md"))).toBe(false);
  });

  it("uses update previews for small existing AGENTS.md and manual previews for giant AGENTS.md", () => {
    const repo = tempRepo();
    write(repo, "AGENTS.md", "# Existing\n");
    let scanResult = runScan(repo, true);
    expect(scanResult.generatedPreviews.find((preview) => preview.path === "AGENTS.md")?.action).toBe("update");

    write(repo, "AGENTS.md", Array.from({ length: 250 }, (_, index) => `line ${index}`).join("\n"));
    scanResult = runScan(repo, true);
    expect(scanResult.generatedPreviews.find((preview) => preview.path === "AGENTS.md")?.action).toBe("manual");
  });

  it("dry-runs and then creates selected artifacts only after confirmation", () => {
    const repo = tempRepo();
    const scanResult = runScan(repo, true);
    const agents = scanResult.generatedPreviews.find((preview) => preview.path === "AGENTS.md")!;

    const dryRun = applyHarnessArtifacts(
      { repositoryPath: repo, artifactIds: [agents.id], confirmation: null, dryRun: true },
      scanResult.generatedPreviews,
    );
    expect(dryRun.applied).toHaveLength(0);
    expect(existsSync(join(repo, "AGENTS.md"))).toBe(false);

    const applied = applyHarnessArtifacts(
      { repositoryPath: repo, artifactIds: [agents.id], confirmation: HARNESS_APPLY_CONFIRMATION, dryRun: false },
      scanResult.generatedPreviews,
    );
    expect(applied.applied[0]?.path).toBe("AGENTS.md");
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toContain("Generated starter map");
  });

  it("rejects hash mismatches, path traversal, and symlink escape writes", () => {
    const repo = tempRepo();
    write(repo, "AGENTS.md", "# Existing\n");
    const scanResult = runScan(repo, true);
    const agents = scanResult.generatedPreviews.find((preview) => preview.path === "AGENTS.md")!;
    write(repo, "AGENTS.md", "# Changed\n");
    const mismatch = applyHarnessArtifacts(
      { repositoryPath: repo, artifactIds: [agents.id], confirmation: HARNESS_APPLY_CONFIRMATION, dryRun: false },
      [agents],
    );
    expect(mismatch.failed[0]?.error).toContain("changed since preview");

    const traversal = applyHarnessArtifacts(
      { repositoryPath: repo, artifactIds: ["bad"], confirmation: HARNESS_APPLY_CONFIRMATION, dryRun: false },
      [preview("bad", "../AGENTS.md")],
    );
    expect(traversal.failed[0]?.error).toContain("escapes repository");

    const outside = tempRepo();
    symlinkSync(outside, join(repo, "docs"));
    const symlink = applyHarnessArtifacts(
      { repositoryPath: repo, artifactIds: ["symlink"], confirmation: HARNESS_APPLY_CONFIRMATION, dryRun: false },
      [preview("symlink", "docs/ESCAPE.md")],
    );
    expect(symlink.failed[0]?.error).toContain("symlink");
  });

  it("sets executable mode for generated scripts", () => {
    const repo = tempRepo();
    const script = preview("scripts-check", "scripts/check", "script");
    const result = applyHarnessArtifacts(
      { repositoryPath: repo, artifactIds: [script.id], confirmation: HARNESS_APPLY_CONFIRMATION, dryRun: false },
      [script],
    );

    expect(result.applied[0]?.path).toBe("scripts/check");
    expect(statSync(join(repo, "scripts/check")).mode & 0o111).toBeGreaterThan(0);
  });
});

function runScan(repo: string, includeGeneratedPreviews = false) {
  return scanHarnessRepository({
    repositoryPath: repo,
    includeGitStatus: true,
    includeDocs: true,
    includeScripts: true,
    includePackageMetadata: true,
    includeWorkflow: true,
    includeAgentsMd: true,
    includeCi: true,
    includeSecurity: true,
    includeAccessibility: true,
    includeGeneratedPreviews,
  });
}

function strongRepo(): string {
  const repo = tempRepo();
  write(repo, "README.md", "# Strong Repo\n\nRun checks before review.\n");
  write(repo, "AGENTS.md", "# AGENTS.md\n\nRead docs/HARNESS.md. Run pnpm test, pnpm lint, pnpm build. Codex, Claude, and Cursor need approval guidance.\n");
  write(repo, "WORKFLOW.md", "---\nprovider: codex\ntracker:\n  kind: linear\n  api_key: \"$LINEAR_API_KEY\"\n  allow_workspace_wide: true\n  read_only: true\nworkspace:\n  root: \".symphonia/workspaces\"\n  cleanup:\n    dry_run: true\nhooks:\n  timeout_ms: 1000\n---\nValidate with pnpm test for {{ issue.identifier }}.\n");
  write(repo, "package.json", JSON.stringify({ scripts: { test: "vitest run", lint: "eslint .", build: "tsc", check: "pnpm test && pnpm lint && pnpm build" }, dependencies: { next: "1.0.0", react: "1.0.0" } }));
  write(repo, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  write(repo, ".gitignore", ".env\nnode_modules\n");
  write(repo, ".env.example", "API_KEY=\n");
  write(repo, "docs/README.md", "# Docs\n");
  write(repo, "docs/ARCHITECTURE.md", "# Architecture\n");
  write(repo, "docs/TESTING.md", "# Testing\nUse Playwright and manual QA.\n");
  write(repo, "docs/FRONTEND.md", "# Frontend\nAccessibility, keyboard, ARIA, and browser checks.\n");
  write(repo, "docs/BACKEND.md", "# Backend\n");
  write(repo, "docs/SECURITY.md", "# Security\n");
  write(repo, "docs/HARNESS.md", "# Harness\nReview, PR, checks, diagnostics, reproduction.\n");
  write(repo, "docs/OPERATIONS.md", "# Operations\nLogs, diagnostics, debug, reproduction.\n");
  write(repo, "scripts/check", "#!/bin/sh\npnpm test\npnpm lint\npnpm build\n");
  write(repo, ".github/workflows/ci.yml", "name: ci\njobs:\n  test:\n    steps:\n      - run: pnpm test\n      - run: pnpm lint\n      - run: pnpm build\n");
  return repo;
}

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "symphonia-harness-test-"));
  tempRoots.push(root);
  return root;
}

function write(root: string, path: string, content: string): void {
  const filePath = join(root, path);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function preview(id: string, path: string, kind: HarnessArtifactPreview["kind"] = "doc"): HarnessArtifactPreview {
  return {
    id,
    kind,
    path,
    action: "create",
    existingContentHash: null,
    proposedContent: "# Generated\n",
    diff: "+# Generated\n",
    warnings: [],
    requiresConfirmation: true,
  };
}
