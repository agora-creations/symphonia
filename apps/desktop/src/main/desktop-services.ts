import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { DesktopDiagnostics, DesktopSettings, DesktopStatus, ManagedProcessStatus } from "../shared/schemas.js";
import { LogBuffer } from "./log-buffer.js";
import { getRepoRootFromModule, nowIso } from "./path-utils.js";
import { DesktopSettingsStore } from "./settings-store.js";
import { ManagedProcess } from "./process-manager.js";

export type DesktopServicesOptions = {
  repoRoot?: string;
  settingsStore?: DesktopSettingsStore;
  desktopLogs?: LogBuffer;
  daemon?: ManagedProcess;
  web?: ManagedProcess;
  appVersion?: string;
  electronVersion?: string;
};

export class DesktopServices {
  readonly startedAt = nowIso();
  readonly repoRoot: string;
  readonly settingsStore: DesktopSettingsStore;
  private readonly desktopLogs: LogBuffer;
  private readonly daemon: ManagedProcess;
  private readonly web: ManagedProcess;
  private readonly appVersion: string;
  private readonly electronVersion: string;

  constructor(options: DesktopServicesOptions = {}) {
    this.repoRoot = resolve(options.repoRoot ?? getRepoRootFromModule(import.meta.url));
    this.settingsStore = options.settingsStore ?? new DesktopSettingsStore({ repoRoot: this.repoRoot });
    this.desktopLogs = options.desktopLogs ?? new LogBuffer();
    this.appVersion = options.appVersion ?? "0.1.0";
    this.electronVersion = options.electronVersion ?? process.versions.electron ?? "unknown";

    const settings = this.settingsStore.load();
    this.daemon =
      options.daemon ??
      new ManagedProcess({
        name: "daemon",
        command: "pnpm",
        args: ["--filter", "@symphonia/daemon", "dev"],
        cwd: () => this.settingsStore.load().repositoryPath ?? this.repoRoot,
        preferredPort: settings.daemonPortPreference ?? 4100,
        healthPath: "/healthz",
        portEnvVar: "SYMPHONIA_DAEMON_PORT",
        autoSelectPort: true,
      });
    this.web =
      options.web ??
      new ManagedProcess({
        name: "web",
        command: "pnpm",
        args: ["--filter", "@symphonia/web", "dev"],
        cwd: () => this.settingsStore.load().repositoryPath ?? this.repoRoot,
        preferredPort: 3000,
        healthPath: "/issues",
        autoSelectPort: true,
      });
  }

  async startManagedProcesses(): Promise<void> {
    const settings = this.settingsStore.update({ lastOpenedAt: nowIso() });
    if (!settings.daemonAutoStart) return;
    await this.startDaemon(settings);
    await this.startWeb(settings);
  }

  async startDaemon(settings: DesktopSettings = this.settingsStore.load()): Promise<ManagedProcessStatus> {
    const env: NodeJS.ProcessEnv = {
      SYMPHONIA_DAEMON_PORT: String(settings.daemonPortPreference ?? 4100),
      SYMPHONIA_WORKFLOW_PATH: settings.workflowPath ?? undefined,
      SYMPHONIA_DB_PATH: settings.databasePath ?? undefined,
      SYMPHONIA_PROVIDER: settings.defaultProviderId,
    };
    return this.daemon.start(env);
  }

  async restartDaemon(): Promise<ManagedProcessStatus> {
    const settings = this.settingsStore.load();
    return this.daemon.restart({
      SYMPHONIA_DAEMON_PORT: String(settings.daemonPortPreference ?? 4100),
      SYMPHONIA_WORKFLOW_PATH: settings.workflowPath ?? undefined,
      SYMPHONIA_DB_PATH: settings.databasePath ?? undefined,
      SYMPHONIA_PROVIDER: settings.defaultProviderId,
    });
  }

  async startWeb(settings: DesktopSettings = this.settingsStore.load()): Promise<ManagedProcessStatus> {
    const daemonUrl = this.daemon.getStatus().url ?? `http://127.0.0.1:${settings.daemonPortPreference ?? 4100}`;
    return this.web.start({
      NEXT_PUBLIC_DAEMON_URL: daemonUrl,
    });
  }

  async restartWeb(): Promise<ManagedProcessStatus> {
    const daemonUrl = this.daemon.getStatus().url ?? "http://127.0.0.1:4100";
    return this.web.restart({
      NEXT_PUBLIC_DAEMON_URL: daemonUrl,
    });
  }

  async stopManagedProcesses(): Promise<void> {
    await Promise.allSettled([this.web.stop(), this.daemon.stop()]);
  }

  getStatus(): DesktopStatus {
    return {
      appVersion: this.appVersion,
      electronVersion: this.electronVersion,
      nodeVersion: process.versions.node,
      platform: process.platform,
      startedAt: this.startedAt,
      settingsPath: this.settingsStore.settingsPath,
      settings: this.settingsStore.load(),
      daemon: this.daemon.getStatus(),
      web: this.web.getStatus(),
    };
  }

  getDaemonStatus(): ManagedProcessStatus {
    return this.daemon.getStatus();
  }

  getWebStatus(): ManagedProcessStatus {
    return this.web.getStatus();
  }

  getDaemonLogs(): string[] {
    return this.daemon.getLogs();
  }

  getWebLogs(): string[] {
    return this.web.getLogs();
  }

  getDiagnostics(): DesktopDiagnostics {
    return {
      generatedAt: nowIso(),
      desktop: this.getStatus(),
      daemonLogs: this.getDaemonLogs(),
      webLogs: this.getWebLogs(),
      desktopLogs: this.desktopLogs.snapshot(),
      redactedSettings: this.settingsStore.exportRedacted(),
    };
  }

  getLoadUrl(): string {
    return this.web.getStatus().url ? `${this.web.getStatus().url}/issues` : "about:blank";
  }

  canRevealPath(pathValue: string): boolean {
    const settings = this.settingsStore.load();
    const allowed = [
      this.settingsStore.settingsPath,
      settings.repositoryPath,
      settings.workflowPath,
      settings.workspaceRoot,
      settings.databasePath,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => resolve(value));
    const resolved = resolve(pathValue);
    return allowed.some((value) => resolved === value || resolved.startsWith(`${value}/`)) && existsSync(resolved);
  }
}
