"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, Database, ExternalLink, FileText, FolderOpen, RefreshCw, ScanSearch, ShieldCheck } from "lucide-react";
import { applyHarnessArtifacts, getAuthStatus, runHarnessScan, startAuth, validateAuth } from "@/lib/api";
import { getDesktopApi, type DesktopSettings, type DesktopStatus } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import type { AuthStatus, HarnessApplyResult, HarnessScanResult } from "@symphonia/types";

export function DesktopSetupGate() {
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus | null>(null);
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [starterWorkflow, setStarterWorkflow] = useState<string | null>(null);
  const [harnessScan, setHarnessScan] = useState<HarnessScanResult | null>(null);
  const [selectedArtifacts, setSelectedArtifacts] = useState<string[]>([]);
  const [harnessDryRun, setHarnessDryRun] = useState(true);
  const [harnessConfirmation, setHarnessConfirmation] = useState("");
  const [harnessApplyResult, setHarnessApplyResult] = useState<HarnessApplyResult | null>(null);
  const [harnessBusy, setHarnessBusy] = useState<"scan" | "apply" | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const desktop = getDesktopApi();

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    void Promise.allSettled([desktop.getDesktopStatus(), desktop.getSettings(), getAuthStatus()]).then((results) => {
      if (!alive) return;
      if (results[0].status === "fulfilled") setDesktopStatus(results[0].value);
      if (results[1].status === "fulfilled") setSettings(results[1].value);
      if (results[2].status === "fulfilled") setAuthStatus(results[2].value);
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

  async function connectGithubFromSetup() {
    const result = await startAuth("github", {
      method: "oauth_device",
      requestedScopes: ["repo"],
      redirectMode: "device",
      repositoryPath: settings?.repositoryPath ?? null,
      metadata: {},
    });
    if (result.verificationUri) await desktop?.openExternalLink(result.verificationUri);
    setMessage(result.userCode ? `GitHub device code: ${result.userCode}` : result.instructions.join(" "));
    setAuthStatus(await getAuthStatus());
  }

  async function connectLinearFromSetup() {
    const result = await startAuth("linear", {
      method: "oauth_pkce",
      requestedScopes: ["read"],
      redirectMode: "loopback",
      repositoryPath: settings?.repositoryPath ?? null,
      metadata: {},
    });
    if (result.authorizationUrl) await desktop?.openExternalLink(result.authorizationUrl);
    setMessage(result.instructions.join(" "));
    setAuthStatus(await getAuthStatus());
  }

  async function validateIntegration(provider: "github" | "linear") {
    const result = await validateAuth(provider);
    setMessage(result.error ?? `${provider} validation ${result.status}.`);
    setAuthStatus(await getAuthStatus());
  }

  async function runHarnessReadinessScan() {
    if (!settings?.repositoryPath) return;
    setHarnessBusy("scan");
    setMessage(null);
    try {
      const scan = await runHarnessScan({
        repositoryPath: settings.repositoryPath,
        includeGitStatus: true,
        includeDocs: true,
        includeScripts: true,
        includePackageMetadata: true,
        includeWorkflow: true,
        includeAgentsMd: true,
        includeCi: true,
        includeSecurity: true,
        includeAccessibility: true,
        includeGeneratedPreviews: true,
      });
      setHarnessScan(scan);
      setSelectedArtifacts(
        scan.generatedPreviews
          .filter((preview) => (preview.path === "AGENTS.md" || preview.path === "WORKFLOW.md") && (preview.action === "create" || preview.action === "update"))
          .map((preview) => preview.id),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setHarnessBusy(null);
    }
  }

  async function applyHarnessSelection() {
    if (!settings?.repositoryPath || selectedArtifacts.length === 0) return;
    setHarnessBusy("apply");
    setMessage(null);
    try {
      const result = await applyHarnessArtifacts({
        repositoryPath: settings.repositoryPath,
        artifactIds: selectedArtifacts,
        dryRun: harnessDryRun,
        confirmation: harnessDryRun ? null : harnessConfirmation,
      });
      setHarnessApplyResult(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setHarnessBusy(null);
    }
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
        defaultTrackerKind: "linear",
        defaultProviderId: "codex",
        githubEnabled: false,
        linearEnabled: true,
        cleanupDryRun: true,
        cleanupEnabled: false,
      });
      setSettings(next);
      await desktop.restartDaemon();
      setMessage("Setup saved. Symphonia is ready for real Linear and provider configuration.");
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
                The desktop shell starts the local daemon and web UI. The daemon owns real providers, Linear tracking,
                workspaces, events, and SQLite. Integrations use environment variables rather than stored secrets.
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
              title="Real-data defaults"
              value="Linear tracker, Codex provider, GitHub writes disabled, cleanup disabled and dry-run."
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

          <div className="mt-4 rounded-md border bg-muted/20 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium">Agent-readiness scan</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Optional. Preview starter harness files before writing anything.
                </p>
              </div>
              <button
                type="button"
                onClick={runHarnessReadinessScan}
                disabled={!settings.repositoryPath || harnessBusy === "scan"}
                className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                {harnessBusy === "scan" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                Scan repository readiness
              </button>
            </div>

            {harnessScan && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full border px-2 py-1">Score {harnessScan.score.percentage}%</span>
                  <span className="rounded-full border px-2 py-1">Grade {harnessScan.grade}</span>
                  <span className="rounded-full border px-2 py-1">{harnessScan.findings.length} findings</span>
                </div>
                <div className="space-y-2">
                  {harnessScan.generatedPreviews
                    .filter((preview) => preview.path === "AGENTS.md" || preview.path === "WORKFLOW.md")
                    .map((preview) => (
                      <div key={preview.id} className="rounded-md border bg-background p-3">
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={selectedArtifacts.includes(preview.id)}
                            disabled={preview.action !== "create" && preview.action !== "update"}
                            onChange={() =>
                              setSelectedArtifacts((current) =>
                                current.includes(preview.id) ? current.filter((item) => item !== preview.id) : [...current, preview.id],
                              )
                            }
                          />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <FileText className="h-4 w-4" />
                              <span className="break-all font-medium">{preview.path}</span>
                              <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{preview.action}</span>
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">{preview.warnings.join(" ")}</span>
                          </span>
                        </label>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-muted-foreground">Preview diff</summary>
                          <pre className="mt-2 max-h-52 overflow-auto rounded-md border bg-muted/20 p-2 text-xs">{preview.diff}</pre>
                        </details>
                      </div>
                    ))}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={harnessDryRun} onChange={(event) => setHarnessDryRun(event.target.checked)} />
                  Dry-run only
                </label>
                {!harnessDryRun && (
                  <input
                    value={harnessConfirmation}
                    onChange={(event) => setHarnessConfirmation(event.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-xs"
                    placeholder="APPLY HARNESS CHANGES"
                  />
                )}
                <button
                  type="button"
                  onClick={applyHarnessSelection}
                  disabled={selectedArtifacts.length === 0 || harnessBusy === "apply" || (!harnessDryRun && harnessConfirmation !== "APPLY HARNESS CHANGES")}
                  className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                >
                  {harnessBusy === "apply" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {harnessDryRun ? "Dry-run selected previews" : "Apply selected previews"}
                </button>
                {harnessApplyResult && (
                  <p className="text-xs text-muted-foreground">
                    Applied {harnessApplyResult.applied.length}, skipped {harnessApplyResult.skipped.length}, failed {harnessApplyResult.failed.length}.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 rounded-md border bg-muted/20 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium">Optional integrations</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Connect now or skip. Environment-token fallbacks remain available and no writes are enabled here.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  GitHub: {authStatus?.providers.find((item) => item.provider === "github")?.status ?? "unknown"} / Linear:{" "}
                  {authStatus?.providers.find((item) => item.provider === "linear")?.status ?? "unknown"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={connectGithubFromSetup}
                  className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
                >
                  <ExternalLink className="h-4 w-4" />
                  Connect GitHub
                </button>
                <button
                  type="button"
                  onClick={connectLinearFromSetup}
                  className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
                >
                  <ExternalLink className="h-4 w-4" />
                  Connect Linear
                </button>
                <button
                  type="button"
                  onClick={() => void validateIntegration("linear")}
                  className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Validate Linear
                </button>
                <button
                  type="button"
                  onClick={() => void validateIntegration("github")}
                  className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Validate GitHub
                </button>
              </div>
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
