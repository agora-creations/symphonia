"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, Database, FolderOpen, RefreshCw, ShieldCheck } from "lucide-react";
import { getDesktopApi, type DesktopSettings, type DesktopStatus } from "@/lib/desktop";
import { cn } from "@/lib/utils";

export function DesktopSetupGate() {
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus | null>(null);
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [starterWorkflow, setStarterWorkflow] = useState<string | null>(null);
  const desktop = getDesktopApi();

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    void Promise.all([desktop.getDesktopStatus(), desktop.getSettings()]).then(([status, loadedSettings]) => {
      if (!alive) return;
      setDesktopStatus(status);
      setSettings(loadedSettings);
    });
    return () => {
      alive = false;
    };
  }, [desktop]);

  if (!desktop || !settings || settings.firstRunCompleted) return null;

  async function chooseRepository() {
    if (!desktop || !settings) return;
    const result = await desktop.chooseDirectory({
      title: "Choose repository folder",
      defaultPath: settings.repositoryPath ?? undefined,
    });
    if (result.canceled || !result.path) return;
    const next = await desktop.updateSettings({
      repositoryPath: result.path,
      workflowPath: `${result.path}/WORKFLOW.md`,
      workspaceRoot: `${result.path}/.symphonia/workspaces`,
      databasePath: `${result.path}/.data/agentboard.sqlite`,
    });
    setSettings(next);
  }

  async function chooseWorkspaceRoot() {
    if (!desktop || !settings) return;
    const result = await desktop.chooseDirectory({
      title: "Choose workspace root",
      defaultPath: settings.workspaceRoot ?? settings.repositoryPath ?? undefined,
    });
    if (result.canceled || !result.path) return;
    setSettings(await desktop.updateSettings({ workspaceRoot: result.path }));
  }

  async function createStarterWorkflow() {
    if (!desktop || !settings?.repositoryPath) return;
    const result = await desktop.createStarterWorkflow(settings.repositoryPath);
    setStarterWorkflow(result.existed ? `Existing WORKFLOW.md kept at ${result.path}` : `Created starter WORKFLOW.md at ${result.path}`);
    setSettings(await desktop.getSettings());
  }

  async function completeSetup() {
    if (!desktop || !settings) return;
    setSaving(true);
    setMessage(null);
    try {
      const validation = await desktop.validateSettings(settings);
      if (!validation.ok) {
        setMessage(validation.errors.join(" "));
        return;
      }
      const next = await desktop.updateSettings({
        firstRunCompleted: true,
        defaultTrackerKind: "mock",
        defaultProviderId: "mock",
        githubEnabled: false,
        linearEnabled: false,
        cleanupDryRun: true,
        cleanupEnabled: false,
      });
      setSettings(next);
      await desktop.restartDaemon();
      setMessage("Setup saved. Symphonia is ready in local mock mode.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background/95 p-4 backdrop-blur">
      <div className="mx-auto flex min-h-full max-w-5xl flex-col justify-center py-8">
        <section className="rounded-md border bg-card p-6 shadow-xl">
          <div className="flex flex-col gap-3 border-b pb-5 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">First-run setup</p>
              <h1 className="mt-1 text-2xl font-semibold">Set up Symphonia as a local desktop workbench</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                The desktop shell starts the local daemon and web UI. The daemon still owns providers, trackers, workspaces,
                events, and SQLite. Optional integrations use environment variables rather than stored secrets.
              </p>
            </div>
            <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
              <div>Daemon: {desktopStatus?.daemon.state ?? "checking"}</div>
              <div>Web: {desktopStatus?.web.state ?? "checking"}</div>
            </div>
          </div>

          <div className="grid gap-4 py-5 md:grid-cols-2">
            <SetupItem
              icon={<FolderOpen className="h-4 w-4" />}
              title="Repository"
              value={settings.repositoryPath ?? "Not selected"}
              action="Choose folder"
              onAction={chooseRepository}
            />
            <SetupItem
              icon={<FolderOpen className="h-4 w-4" />}
              title="Workspace root"
              value={settings.workspaceRoot ?? "Not selected"}
              action="Choose folder"
              onAction={chooseWorkspaceRoot}
            />
            <SetupItem
              icon={<Database className="h-4 w-4" />}
              title="Database"
              value={settings.databasePath ?? "Default local SQLite path"}
            />
            <SetupItem
              icon={<ShieldCheck className="h-4 w-4" />}
              title="Safe defaults"
              value="Mock tracker/provider, GitHub and Linear disabled, cleanup disabled and dry-run."
            />
          </div>

          <div className="rounded-md border bg-muted/20 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium">WORKFLOW.md</p>
                <p className="mt-1 text-xs text-muted-foreground">{settings.workflowPath ?? "No workflow path selected"}</p>
                {starterWorkflow && <p className="mt-2 text-xs text-muted-foreground">{starterWorkflow}</p>}
              </div>
              <button
                type="button"
                onClick={createStarterWorkflow}
                className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
              >
                <CheckCircle2 className="h-4 w-4" />
                Create safe starter if missing
              </button>
            </div>
          </div>

          {message && <p className="mt-4 rounded-md border px-3 py-2 text-sm text-muted-foreground">{message}</p>}

          <div className="mt-5 flex flex-col gap-2 border-t pt-5 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={completeSetup}
              disabled={saving}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background",
                saving && "opacity-60",
              )}
            >
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Complete local setup
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function SetupItem({
  icon,
  title,
  value,
  action,
  onAction,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-md border p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <p className="mt-2 break-all text-xs text-muted-foreground">{value}</p>
      {action && onAction && (
        <button type="button" onClick={onAction} className="mt-3 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted">
          {action}
        </button>
      )}
    </div>
  );
}
