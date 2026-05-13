import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopSettingsStore } from "../src/main/settings-store.js";

function tempDir() {
  return mkdtempSync(resolve(tmpdir(), "symphonia-desktop-settings-"));
}

describe("DesktopSettingsStore", () => {
  it("loads safe first-run defaults", () => {
    const dir = tempDir();
    try {
      const store = new DesktopSettingsStore({ settingsDir: dir, repoRoot: dir });
      const settings = store.load();
      expect(settings.firstRunCompleted).toBe(false);
      expect(settings.defaultProviderId).toBe("mock");
      expect(settings.defaultTrackerKind).toBe("mock");
      expect(settings.cleanupEnabled).toBe(false);
      expect(settings.cleanupDryRun).toBe(true);
      expect(settings.githubTokenEnvVar).toBe("GITHUB_TOKEN");
      expect(settings.linearApiKeyEnvVar).toBe("LINEAR_API_KEY");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists updates outside the repo and redacts secret env references", () => {
    const dir = tempDir();
    try {
      const store = new DesktopSettingsStore({ settingsDir: resolve(dir, "config"), repoRoot: dir });
      const updated = store.update({
        firstRunCompleted: true,
        repositoryPath: dir,
        githubEnabled: true,
        linearEnabled: true,
      });
      expect(updated.firstRunCompleted).toBe(true);
      const reloaded = store.load();
      expect(reloaded.repositoryPath).toBe(dir);
      const redacted = store.exportRedacted();
      expect(redacted.githubTokenEnvVar).toBe("[env:GITHUB_TOKEN]");
      expect(redacted.linearApiKeyEnvVar).toBe("[env:LINEAR_API_KEY]");
      expect(redacted.secretsStored).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("validates missing paths with clear errors and warnings", () => {
    const dir = tempDir();
    try {
      const store = new DesktopSettingsStore({ settingsDir: resolve(dir, "config"), repoRoot: dir });
      const settings = store.update({
        repositoryPath: resolve(dir, "missing"),
        workflowPath: resolve(dir, "missing", "WORKFLOW.md"),
      });
      const validation = store.validate(settings);
      expect(validation.ok).toBe(false);
      expect(validation.errors.join("\n")).toContain("Repository path does not exist");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts a repo with a WORKFLOW.md", () => {
    const dir = tempDir();
    try {
      writeFileSync(resolve(dir, "WORKFLOW.md"), "---\nprovider: mock\n---\n", "utf8");
      const store = new DesktopSettingsStore({ settingsDir: resolve(dir, "config"), repoRoot: dir });
      const validation = store.validate(store.load());
      expect(validation.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
