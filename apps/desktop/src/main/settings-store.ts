import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DesktopSettingsSchema,
  DesktopSettingsUpdateSchema,
} from "../shared/schemas.js";
import type { DesktopSettings, DesktopSettingsUpdate, DesktopSettingsValidationResult } from "../shared/schemas.js";
import { dedupeRecentRepositories, getDefaultSettingsDir, nowIso, pathExists, resolveNullablePath } from "./path-utils.js";

export type SettingsStoreOptions = {
  settingsDir?: string;
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
};

export class DesktopSettingsStore {
  readonly settingsPath: string;
  private readonly settingsDir: string;
  private readonly repoRoot: string;

  constructor(options: SettingsStoreOptions = {}) {
    this.settingsDir = resolve(options.settingsDir ?? getDefaultSettingsDir(options.env));
    this.settingsPath = resolve(this.settingsDir, "settings.json");
    this.repoRoot = resolve(options.repoRoot ?? process.cwd());
  }

  getDefaultSettings(): DesktopSettings {
    return DesktopSettingsSchema.parse({
      firstRunCompleted: false,
      daemonPortPreference: 4100,
      daemonAutoStart: true,
      repositoryPath: this.repoRoot,
      workflowPath: resolve(this.repoRoot, "WORKFLOW.md"),
      workspaceRoot: resolve(this.repoRoot, ".symphonia", "workspaces"),
      databasePath: resolve(this.repoRoot, ".data", "agentboard.sqlite"),
      defaultTrackerKind: "linear",
      defaultProviderId: "codex",
      githubEnabled: false,
      githubTokenEnvVar: "GITHUB_TOKEN",
      linearEnabled: false,
      linearApiKeyEnvVar: "LINEAR_API_KEY",
      cleanupDryRun: true,
      cleanupEnabled: false,
      lastOpenedAt: null,
      recentRepositories: [this.repoRoot],
    });
  }

  load(): DesktopSettings {
    try {
      const raw = JSON.parse(readFileSync(this.settingsPath, "utf8")) as unknown;
      return DesktopSettingsSchema.parse({
        ...this.getDefaultSettings(),
        ...(typeof raw === "object" && raw ? raw : {}),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      return this.getDefaultSettings();
    }
  }

  save(settings: DesktopSettings): DesktopSettings {
    const parsed = DesktopSettingsSchema.parse(settings);
    mkdirSync(dirname(this.settingsPath), { recursive: true });
    writeFileSync(this.settingsPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    return parsed;
  }

  update(update: DesktopSettingsUpdate): DesktopSettings {
    const parsedUpdate = DesktopSettingsUpdateSchema.parse(update);
    const current = this.load();
    const next = DesktopSettingsSchema.parse({
      ...current,
      ...parsedUpdate,
      lastOpenedAt: parsedUpdate.lastOpenedAt ?? nowIso(),
      recentRepositories:
        parsedUpdate.repositoryPath !== undefined
          ? dedupeRecentRepositories(current.recentRepositories, parsedUpdate.repositoryPath)
          : current.recentRepositories,
    });
    return this.save(next);
  }

  reset(): DesktopSettings {
    return this.save(this.getDefaultSettings());
  }

  validate(settings: DesktopSettings = this.load()): DesktopSettingsValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const repoPath = resolveNullablePath(settings.repositoryPath, this.repoRoot);
    const workflowPath = resolveNullablePath(settings.workflowPath, repoPath ?? this.repoRoot);
    const workspaceRoot = resolveNullablePath(settings.workspaceRoot, repoPath ?? this.repoRoot);
    const databasePath = resolveNullablePath(settings.databasePath, repoPath ?? this.repoRoot);

    if (!repoPath) errors.push("Repository path is required.");
    if (repoPath && !pathExists(repoPath)) errors.push(`Repository path does not exist: ${repoPath}`);
    if (!workflowPath) errors.push("Workflow path is required.");
    if (workflowPath && !pathExists(workflowPath)) warnings.push(`WORKFLOW.md was not found at ${workflowPath}.`);
    if (!workspaceRoot) errors.push("Workspace root is required.");
    if (!databasePath) errors.push("Database path is required.");
    if (settings.cleanupEnabled && settings.cleanupDryRun) {
      warnings.push("Workspace cleanup is enabled but still in dry-run mode.");
    }
    if (settings.linearEnabled) {
      warnings.push(`Linear requires ${settings.linearApiKeyEnvVar} in the daemon environment.`);
    }
    if (settings.githubEnabled) {
      warnings.push(`GitHub API access requires ${settings.githubTokenEnvVar} in the daemon environment.`);
    }

    return { ok: errors.length === 0, errors, warnings };
  }

  exportRedacted(settings: DesktopSettings = this.load()): Record<string, unknown> {
    return {
      ...settings,
      githubTokenEnvVar: settings.githubTokenEnvVar ? `[env:${settings.githubTokenEnvVar}]` : null,
      linearApiKeyEnvVar: settings.linearApiKeyEnvVar ? `[env:${settings.linearApiKeyEnvVar}]` : null,
      secretsStored: false,
      settingsPath: this.settingsPath,
    };
  }
}
