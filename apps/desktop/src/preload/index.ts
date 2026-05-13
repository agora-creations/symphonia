import { contextBridge, ipcRenderer } from "electron";
import type { DesktopSettingsUpdate } from "../shared/schemas.js";

const api = {
  getDesktopStatus: () => ipcRenderer.invoke("desktop:getStatus"),
  getDaemonStatus: () => ipcRenderer.invoke("desktop:getDaemonStatus"),
  restartDaemon: () => ipcRenderer.invoke("desktop:restartDaemon"),
  getDaemonLogs: () => ipcRenderer.invoke("desktop:getDaemonLogs"),
  getWebStatus: () => ipcRenderer.invoke("desktop:getWebStatus"),
  restartWeb: () => ipcRenderer.invoke("desktop:restartWeb"),
  getWebLogs: () => ipcRenderer.invoke("desktop:getWebLogs"),
  getSettings: () => ipcRenderer.invoke("desktop:getSettings"),
  updateSettings: (settings: DesktopSettingsUpdate) => ipcRenderer.invoke("desktop:updateSettings", settings),
  resetSettings: () => ipcRenderer.invoke("desktop:resetSettings"),
  validateSettings: (settings?: DesktopSettingsUpdate) => ipcRenderer.invoke("desktop:validateSettings", settings),
  exportSettingsRedacted: () => ipcRenderer.invoke("desktop:exportSettingsRedacted"),
  revealSettingsFile: () => ipcRenderer.invoke("desktop:revealSettingsFile"),
  getDiagnostics: () => ipcRenderer.invoke("desktop:getDiagnostics"),
  chooseDirectory: (request?: { title?: string; defaultPath?: string }) => ipcRenderer.invoke("desktop:chooseDirectory", request ?? {}),
  chooseFile: (request?: { title?: string; defaultPath?: string }) => ipcRenderer.invoke("desktop:chooseFile", request ?? {}),
  openExternalLink: (url: string) => ipcRenderer.invoke("desktop:openExternalLink", url),
  revealPathInFileManager: (path: string) => ipcRenderer.invoke("desktop:revealPathInFileManager", { path }),
  createStarterWorkflow: (repositoryPath: string) => ipcRenderer.invoke("desktop:createStarterWorkflow", { repositoryPath }),
};

contextBridge.exposeInMainWorld("symphoniaDesktop", api);
