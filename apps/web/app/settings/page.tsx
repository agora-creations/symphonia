"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Copy, FolderOpen, RefreshCw, RotateCcw, ScanSearch } from "lucide-react";
import { MainLayout } from "@/components/main-layout";
import {
  getDaemonStatus,
  getGithubHealth,
  getGithubStatus,
  getProviders,
  getTrackerHealth,
  getTrackerStatus,
  getWorkspaceCleanupPlan,
  getWorkspaceInventory,
} from "@/lib/api";
import { getDesktopApi, type DesktopDiagnostics, type DesktopSettings, type DesktopStatus } from "@/lib/desktop";
import { type DaemonStatus, type GitHubHealth, type GitHubStatus, type ProviderHealth, type TrackerHealth, type TrackerStatus, type WorkspaceCleanupPlan, type WorkspaceInventory } from "@symphonia/types";

export default function SettingsPage() {
  const desktop = getDesktopApi();
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus | null>(null);
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings | null>(null);
  const [diagnostics, setDiagnostics] = useState<DesktopDiagnostics | null>(null);
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus | null>(null);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [trackerStatus, setTrackerStatus] = useState<TrackerStatus | null>(null);
  const [trackerHealth, setTrackerHealth] = useState<TrackerHealth | null>(null);
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [githubHealth, setGithubHealth] = useState<GitHubHealth | null>(null);
  const [workspaceInventory, setWorkspaceInventory] = useState<WorkspaceInventory | null>(null);
  const [cleanupPlan, setCleanupPlan] = useState<WorkspaceCleanupPlan | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMessage(null);
    const [daemon, providerList, tracker, trackerHealthResult, github, githubHealthResult, inventory, plan] = await Promise.allSettled([
      getDaemonStatus(),
      getProviders(),
      getTrackerStatus(),
      getTrackerHealth(),
      getGithubStatus(),
      getGithubHealth(),
      getWorkspaceInventory(),
      getWorkspaceCleanupPlan(),
    ]);
    if (daemon.status === "fulfilled") setDaemonStatus(daemon.value);
    if (providerList.status === "fulfilled") setProviders(providerList.value);
    if (tracker.status === "fulfilled") setTrackerStatus(tracker.value);
    if (trackerHealthResult.status === "fulfilled") setTrackerHealth(trackerHealthResult.value);
    if (github.status === "fulfilled") setGithubStatus(github.value);
    if (githubHealthResult.status === "fulfilled") setGithubHealth(githubHealthResult.value);
    if (inventory.status === "fulfilled") setWorkspaceInventory(inventory.value);
    if (plan.status === "fulfilled") setCleanupPlan(plan.value);

    if (desktop) {
      const [status, settings, diag] = await Promise.all([
        desktop.getDesktopStatus(),
        desktop.getSettings(),
        desktop.getDiagnostics(),
      ]);
      setDesktopStatus(status);
      setDesktopSettings(settings);
      setDiagnostics(diag);
    }
  }, [desktop]);

  useEffect(() => {
    void load();
  }, [load]);

  async function choosePath(kind: "repositoryPath" | "workspaceRoot" | "workflowPath") {
    if (!desktop) return;
    const chooser = kind === "workflowPath" ? desktop.chooseFile : desktop.chooseDirectory;
    const result = await chooser({ title: `Choose ${kind}` });
    if (result.canceled || !result.path) return;
    const updated = await desktop.updateSettings({ [kind]: result.path });
    setDesktopSettings(updated);
  }

  async function restartDaemon() {
    if (!desktop) return;
    await desktop.restartDaemon();
    await load();
  }

  async function restartWeb() {
    if (!desktop) return;
    await desktop.restartWeb();
    await load();
  }

  async function copyDiagnostics() {
    const payload = diagnostics ?? (desktop ? await desktop.getDiagnostics() : null);
    if (!payload) return;
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setMessage("Copied redacted diagnostics.");
  }

  return (
    <MainLayout>
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b px-4 py-2.5">
          <div>
            <span className="text-sm font-semibold">Settings</span>
            <p className="text-xs text-muted-foreground">Desktop shell, daemon, integrations, recovery, and diagnostics.</p>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </header>

        <div className="grid gap-4 p-4 xl:grid-cols-[1fr_1fr]">
          <Section title="Desktop Shell" description={desktop ? "Electron desktop mode is active." : "Open this page in the desktop app for shell controls."}>
            {desktopStatus ? (
              <div className="grid gap-2 text-sm">
                <KeyValue label="Version" value={`${desktopStatus.appVersion} / Electron ${desktopStatus.electronVersion}`} />
                <KeyValue label="Platform" value={desktopStatus.platform} />
                <KeyValue label="Settings file" value={desktopStatus.settingsPath} />
                <KeyValue label="Daemon process" value={`${desktopStatus.daemon.state} ${desktopStatus.daemon.url ?? ""}`} />
                <KeyValue label="Web process" value={`${desktopStatus.web.state} ${desktopStatus.web.url ?? ""}`} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Desktop APIs are unavailable in browser-only mode.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={restartDaemon} disabled={!desktop} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50">
                <RotateCcw className="h-4 w-4" />
                Restart daemon
              </button>
              <button type="button" onClick={restartWeb} disabled={!desktop} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50">
                <RotateCcw className="h-4 w-4" />
                Restart web
              </button>
              <button type="button" onClick={copyDiagnostics} disabled={!desktop} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50">
                <Copy className="h-4 w-4" />
                Copy diagnostics
              </button>
            </div>
            {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}
          </Section>

          <Section title="Local Settings" description="Settings are stored outside the repo and do not contain API keys. Use environment variables for secrets.">
            {desktopSettings ? (
              <div className="space-y-3">
                <PathRow label="Repository" value={desktopSettings.repositoryPath} onChoose={() => void choosePath("repositoryPath")} />
                <PathRow label="WORKFLOW.md" value={desktopSettings.workflowPath} onChoose={() => void choosePath("workflowPath")} />
                <PathRow label="Workspace root" value={desktopSettings.workspaceRoot} onChoose={() => void choosePath("workspaceRoot")} />
                <KeyValue label="Database" value={desktopSettings.databasePath ?? "Not set"} />
                <KeyValue label="Default provider" value={desktopSettings.defaultProviderId} />
                <KeyValue label="Default tracker" value={desktopSettings.defaultTrackerKind} />
                <KeyValue label="Linear secret" value={`env:${desktopSettings.linearApiKeyEnvVar}`} />
                <KeyValue label="GitHub secret" value={`env:${desktopSettings.githubTokenEnvVar}`} />
                <KeyValue label="Cleanup" value={desktopSettings.cleanupEnabled ? (desktopSettings.cleanupDryRun ? "enabled, dry-run" : "enabled") : "disabled"} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Desktop settings are not available in browser-only mode.</p>
            )}
          </Section>

          <Section title="Harness Builder" description="Scan the selected repository and preview safe AGENTS.md, WORKFLOW.md, docs, and scripts changes.">
            <div className="space-y-3 text-sm">
              <KeyValue label="Repository" value={desktopSettings?.repositoryPath ?? daemonStatus?.workspaceRoot ?? "Use Harness Builder to choose a path"} />
              <a href="/harness" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                <ScanSearch className="h-4 w-4" />
                Open Harness Builder
              </a>
            </div>
          </Section>

          <Section title="Daemon And Recovery" description="Recovery stays honest: old provider processes are not reattached after restart.">
            <div className="grid gap-2 text-sm">
              <KeyValue label="Daemon instance" value={daemonStatus?.daemonInstanceId ?? "Unavailable"} />
              <KeyValue label="Recovered runs" value={String(daemonStatus?.recoveredRunsCount ?? 0)} />
              <KeyValue label="Orphaned runs" value={String(daemonStatus?.orphanedRunsCount ?? 0)} />
              <KeyValue label="Active runs" value={String(daemonStatus?.activeRunsCount ?? 0)} />
              <KeyValue label="Workspace root" value={daemonStatus?.workspaceRoot ?? "Unavailable"} />
            </div>
          </Section>

          <Section title="Providers" description="Provider health is checked by the daemon. Claude and Cursor use pre-run CLI permissions.">
            <div className="grid gap-2">
              {providers.map((provider) => (
                <div key={provider.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{provider.displayName}</span>
                    <span className="text-xs text-muted-foreground">{provider.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {provider.enabled ? "enabled" : "disabled"} / {provider.available ? "available" : "unavailable"} / {provider.command ?? "no command"}
                  </p>
                  {provider.error && <p className="mt-1 text-xs text-destructive">{provider.error}</p>}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Trackers And GitHub" description="Linear and GitHub use daemon-side environment variables; secret values are never stored in desktop settings.">
            <div className="grid gap-2 text-sm">
              <KeyValue label="Tracker" value={trackerStatus ? `${trackerStatus.kind} / ${trackerHealth ? (trackerHealth.healthy ? "healthy" : "unavailable") : "health unknown"}` : "Unavailable"} />
              <KeyValue label="Tracker last sync" value={trackerStatus?.lastSyncAt ?? "Never"} />
              <KeyValue label="GitHub" value={githubStatus ? `${githubStatus.enabled ? "enabled" : "disabled"} / ${githubHealth ? (githubHealth.healthy ? "healthy" : "unavailable") : "health unknown"}` : "Unavailable"} />
              <KeyValue label="GitHub repo" value={githubStatus?.config?.owner && githubStatus?.config?.repo ? `${githubStatus.config.owner}/${githubStatus.config.repo}` : "Not configured"} />
            </div>
          </Section>

          <Section title="Workspace Cleanup" description="Cleanup is disabled and dry-run by default; destructive execution remains policy-gated.">
            <div className="grid gap-2 text-sm">
              <KeyValue label="Inventory" value={`${workspaceInventory?.workspaces.length ?? 0} workspaces`} />
              <KeyValue label="Active" value={String(workspaceInventory?.counts.active ?? 0)} />
              <KeyValue label="Protected" value={String(workspaceInventory?.counts.protected ?? 0)} />
              <KeyValue label="Candidates" value={String(cleanupPlan?.candidates.length ?? 0)} />
              <KeyValue label="Warnings" value={(cleanupPlan?.warnings ?? []).join("; ") || "None"} />
            </div>
          </Section>

          <Section title="Diagnostics" description="Recent desktop, web, and daemon logs are bounded and redacted.">
            <pre className="max-h-80 overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
              {diagnostics ? JSON.stringify(diagnostics, null, 2) : "Diagnostics unavailable outside desktop mode."}
            </pre>
          </Section>
        </div>
      </div>
    </MainLayout>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-md border bg-card p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="break-all text-xs">{value}</span>
    </div>
  );
}

function PathRow({ label, value, onChoose }: { label: string; value: string | null; onChoose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="break-all text-xs">{value ?? "Not set"}</p>
      </div>
      <button type="button" onClick={onChoose} className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
        <FolderOpen className="h-3.5 w-3.5" />
        Choose
      </button>
    </div>
  );
}
