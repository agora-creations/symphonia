import { dialog, ipcMain, shell } from "electron";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DesktopServices } from "./desktop-services.js";
import { DesktopSettingsSchema } from "../shared/schemas.js";
import {
  parseChoosePathRequest,
  parseExternalUrl,
  parseRevealPath,
  parseSettingsUpdate,
  parseStarterWorkflowPath,
} from "./ipc-contracts.js";

const starterWorkflow = `---
provider: mock

tracker:
  kind: mock

workspace:
  root: ".symphonia/workspaces"
  cleanup:
    enabled: false
    dry_run: true
    require_manual_confirmation: true

hooks:
  timeout_ms: 30000
---

You are working on issue {{ issue.identifier }}.

Title:
{{ issue.title }}

Description:
{{ issue.description }}

Instructions:
1. Inspect the workspace context.
2. Make the smallest correct change.
3. Report what changed and what was verified.
`;

export function registerDesktopIpc(services: DesktopServices): void {
  ipcMain.handle("desktop:getStatus", () => services.getStatus());
  ipcMain.handle("desktop:getSettings", () => services.settingsStore.load());
  ipcMain.handle("desktop:updateSettings", (_event, input) => services.settingsStore.update(parseSettingsUpdate(input)));
  ipcMain.handle("desktop:resetSettings", () => services.settingsStore.reset());
  ipcMain.handle("desktop:validateSettings", (_event, input) => {
    const settings = input
      ? DesktopSettingsSchema.parse({ ...services.settingsStore.load(), ...parseSettingsUpdate(input) })
      : services.settingsStore.load();
    return services.settingsStore.validate(settings);
  });
  ipcMain.handle("desktop:exportSettingsRedacted", () => services.settingsStore.exportRedacted());
  ipcMain.handle("desktop:revealSettingsFile", () => {
    shell.showItemInFolder(services.settingsStore.settingsPath);
    return { ok: true };
  });
  ipcMain.handle("desktop:getDiagnostics", () => services.getDiagnostics());
  ipcMain.handle("desktop:getDaemonStatus", () => services.getDaemonStatus());
  ipcMain.handle("desktop:restartDaemon", () => services.restartDaemon());
  ipcMain.handle("desktop:getDaemonLogs", () => services.getDaemonLogs());
  ipcMain.handle("desktop:getWebStatus", () => services.getWebStatus());
  ipcMain.handle("desktop:restartWeb", () => services.restartWeb());
  ipcMain.handle("desktop:getWebLogs", () => services.getWebLogs());
  ipcMain.handle("desktop:chooseDirectory", async (_event, input) => {
    const request = parseChoosePathRequest(input);
    const result = await dialog.showOpenDialog({
      title: request.title,
      defaultPath: request.defaultPath,
      properties: ["openDirectory", "createDirectory"],
    });
    return { canceled: result.canceled, path: result.filePaths[0] ?? null };
  });
  ipcMain.handle("desktop:chooseFile", async (_event, input) => {
    const request = parseChoosePathRequest(input);
    const result = await dialog.showOpenDialog({
      title: request.title,
      defaultPath: request.defaultPath,
      properties: ["openFile"],
      filters: [{ name: "Workflow", extensions: ["md", "markdown"] }],
    });
    return { canceled: result.canceled, path: result.filePaths[0] ?? null };
  });
  ipcMain.handle("desktop:openExternalLink", async (_event, input) => {
    const url = parseExternalUrl(input);
    await shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle("desktop:revealPathInFileManager", (_event, input) => {
    const path = parseRevealPath(input);
    if (!services.canRevealPath(path)) {
      throw new Error("Only configured Symphonia paths can be revealed.");
    }
    shell.showItemInFolder(path);
    return { ok: true };
  });
  ipcMain.handle("desktop:createStarterWorkflow", (_event, input) => {
    const repositoryPath = resolve(parseStarterWorkflowPath(input));
    const settings = services.settingsStore.load();
    if (settings.repositoryPath && resolve(settings.repositoryPath) !== repositoryPath) {
      throw new Error("Starter workflow can only be created in the configured repository path.");
    }
    const workflowPath = resolve(repositoryPath, "WORKFLOW.md");
    if (existsSync(workflowPath)) return { created: false, existed: true, path: workflowPath };
    writeFileSync(workflowPath, starterWorkflow, { encoding: "utf8", flag: "wx" });
    services.settingsStore.update({ workflowPath });
    return { created: true, existed: false, path: workflowPath };
  });
}
