import { app, BrowserWindow, shell } from "electron";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopServices } from "./desktop-services.js";
import { registerDesktopIpc } from "./ipc.js";
import { isLocalRendererUrl } from "./ipc-contracts.js";
import { getRepoRootFromModule } from "./path-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.SYMPHONIA_REPO_ROOT ?? getRepoRootFromModule(import.meta.url);
let services: DesktopServices | null = null;
let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  services = new DesktopServices({
    repoRoot,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
  });
  registerDesktopIpc(services);

  try {
    await services.startManagedProcesses();
  } catch (error) {
    console.error("Failed to start managed Symphonia services", error);
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: "Symphonia",
    webPreferences: {
      preload: resolve(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentWebUrl = services?.getWebStatus().url;
    const allowedOrigin = currentWebUrl ? new URL(currentWebUrl).origin : null;
    if (allowedOrigin && isLocalRendererUrl(url, [allowedOrigin])) return;
    event.preventDefault();
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  const loadUrl = services.getLoadUrl();
  if (loadUrl === "about:blank") {
    await mainWindow.loadURL(createFallbackSetupUrl());
  } else {
    await mainWindow.loadURL(loadUrl);
  }
}

function createFallbackSetupUrl(): string {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Symphonia Setup</title>
  <style>
    body{margin:0;background:#09090b;color:#fafafa;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{max-width:760px;margin:10vh auto;padding:24px;border:1px solid #27272a;border-radius:8px;background:#111113}
    button{border:1px solid #3f3f46;background:#fafafa;color:#09090b;border-radius:6px;padding:9px 12px;font-weight:600}
    pre{white-space:pre-wrap;overflow:auto;background:#18181b;border:1px solid #27272a;border-radius:6px;padding:12px}
    .muted{color:#a1a1aa}
  </style>
</head>
<body>
  <main>
    <p class="muted">First-run desktop setup</p>
    <h1>Choose the local Symphonia repository</h1>
    <p class="muted">The packaged shell needs a local repository checkout so it can start the Next.js UI and daemon without you running pnpm dev manually. No API keys are stored here.</p>
    <button id="choose">Choose repository and start</button>
    <pre id="status">Waiting for repository selection.</pre>
  </main>
  <script>
    const status = document.getElementById("status");
    document.getElementById("choose").addEventListener("click", async () => {
      try {
        const result = await window.symphoniaDesktop.chooseDirectory({ title: "Choose Symphonia repository" });
        if (result.canceled || !result.path) return;
        await window.symphoniaDesktop.updateSettings({
          repositoryPath: result.path,
          workflowPath: result.path + "/WORKFLOW.md",
          workspaceRoot: result.path + "/.symphonia/workspaces",
          databasePath: result.path + "/.data/agentboard.sqlite",
          firstRunCompleted: false
        });
        status.textContent = "Starting daemon and web server...";
        await window.symphoniaDesktop.restartDaemon();
        const web = await window.symphoniaDesktop.restartWeb();
        if (web.url) window.location.href = web.url + "/issues";
      } catch (error) {
        status.textContent = String(error && error.message ? error.message : error);
      }
    });
  </script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (!services) return;
  event.preventDefault();
  const currentServices = services;
  services = null;
  void currentServices.stopManagedProcesses().finally(() => app.exit(0));
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    const currentServices = services;
    services = null;
    void currentServices?.stopManagedProcesses().finally(() => process.exit(0));
  });
}

app.whenReady().then(async () => {
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});
