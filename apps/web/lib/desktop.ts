import type { ProviderId, TrackerKind } from "@symphonia/types";

export type DesktopSettings = {
  firstRunCompleted: boolean;
  daemonPortPreference: number | null;
  daemonAutoStart: boolean;
  repositoryPath: string | null;
  workflowPath: string | null;
  workspaceRoot: string | null;
  databasePath: string | null;
  defaultTrackerKind: TrackerKind;
  defaultProviderId: ProviderId;
  githubEnabled: boolean;
  githubTokenEnvVar: string;
  linearEnabled: boolean;
  linearApiKeyEnvVar: string;
  cleanupDryRun: boolean;
  cleanupEnabled: boolean;
  lastOpenedAt: string | null;
  recentRepositories: string[];
};

export type ManagedProcessStatus = {
  state: "stopped" | "starting" | "running" | "stopping" | "crashed" | "unavailable";
  pid: number | null;
  port: number | null;
  url: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
};

export type DesktopStatus = {
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  platform: string;
  startedAt: string;
  settingsPath: string;
  settings: DesktopSettings;
  daemon: ManagedProcessStatus;
  web: ManagedProcessStatus;
};

export type DesktopDiagnostics = {
  generatedAt: string;
  desktop: DesktopStatus;
  daemonLogs: string[];
  webLogs: string[];
  desktopLogs: string[];
  redactedSettings: Record<string, unknown>;
};

export type DesktopSettingsUpdate = Partial<DesktopSettings>;

export type SymphoniaDesktopApi = {
  getDesktopStatus: () => Promise<DesktopStatus>;
  getDaemonStatus: () => Promise<ManagedProcessStatus>;
  restartDaemon: () => Promise<ManagedProcessStatus>;
  getDaemonLogs: () => Promise<string[]>;
  getWebStatus: () => Promise<ManagedProcessStatus>;
  restartWeb: () => Promise<ManagedProcessStatus>;
  getWebLogs: () => Promise<string[]>;
  getSettings: () => Promise<DesktopSettings>;
  updateSettings: (settings: DesktopSettingsUpdate) => Promise<DesktopSettings>;
  resetSettings: () => Promise<DesktopSettings>;
  validateSettings: (settings?: DesktopSettingsUpdate) => Promise<{ ok: boolean; errors: string[]; warnings: string[] }>;
  exportSettingsRedacted: () => Promise<Record<string, unknown>>;
  revealSettingsFile: () => Promise<{ ok: boolean }>;
  getDiagnostics: () => Promise<DesktopDiagnostics>;
  chooseDirectory: (request?: { title?: string; defaultPath?: string }) => Promise<{ canceled: boolean; path: string | null }>;
  chooseFile: (request?: { title?: string; defaultPath?: string }) => Promise<{ canceled: boolean; path: string | null }>;
  openExternalLink: (url: string) => Promise<{ ok: boolean }>;
  revealPathInFileManager: (path: string) => Promise<{ ok: boolean }>;
  createStarterWorkflow: (repositoryPath: string) => Promise<{ created: boolean; existed: boolean; path: string }>;
};

declare global {
  interface Window {
    symphoniaDesktop?: SymphoniaDesktopApi;
  }
}

export function getDesktopApi(): SymphoniaDesktopApi | null {
  if (typeof window === "undefined") return null;
  return window.symphoniaDesktop ?? null;
}

export async function getDesktopDaemonUrl(fallback: string): Promise<string> {
  const desktop = getDesktopApi();
  if (!desktop) return fallback;
  try {
    const status = await desktop.getDaemonStatus();
    return status.url ?? fallback;
  } catch {
    return fallback;
  }
}
