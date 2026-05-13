import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function nowIso(): string {
  return new Date().toISOString();
}

export function getRepoRootFromModule(importMetaUrl: string): string {
  const currentDir = dirname(fileURLToPath(importMetaUrl));
  return resolve(currentDir, "../../../..");
}

export function getDefaultSettingsDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SYMPHONIA_DESKTOP_SETTINGS_DIR) return resolve(env.SYMPHONIA_DESKTOP_SETTINGS_DIR);

  if (platform() === "darwin") {
    return resolve(homedir(), "Library", "Application Support", "Symphonia");
  }

  if (platform() === "win32" && env.APPDATA) {
    return resolve(env.APPDATA, "Symphonia");
  }

  return resolve(env.XDG_CONFIG_HOME ?? resolve(homedir(), ".config"), "symphonia");
}

export function resolveNullablePath(pathValue: string | null, baseDir: string): string | null {
  if (!pathValue) return null;
  if (pathValue.startsWith("~/")) return resolve(homedir(), pathValue.slice(2));
  return isAbsolute(pathValue) ? resolve(pathValue) : resolve(baseDir, pathValue);
}

export function pathExists(pathValue: string | null): boolean {
  return Boolean(pathValue && existsSync(pathValue));
}

export function dedupeRecentRepositories(paths: string[], nextPath: string | null): string[] {
  const normalized = [...(nextPath ? [nextPath] : []), ...paths].map((item) => resolve(item));
  return Array.from(new Set(normalized)).slice(0, 12);
}
