"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Bell,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  FolderOpen,
  KeyRound,
  LogOut,
  Palette,
  Plug,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  User as UserIcon,
} from "lucide-react";
import { MainLayout } from "@/components/main-layout";
import { useTheme } from "@/components/theme-provider";
import {
  disconnectAuth,
  getAuthStatus,
  getDaemonStatus,
  getGithubHealth,
  getGithubStatus,
  getProviders,
  getTrackerHealth,
  getTrackerStatus,
  getWorkspaceCleanupPlan,
  getWorkspaceInventory,
  pollAuth,
  refreshAuth,
  startAuth,
  validateAuth,
} from "@/lib/api";
import { getDesktopApi, type DesktopDiagnostics, type DesktopSettings, type DesktopStatus } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import {
  type AuthProviderId,
  type AuthStartResult,
  type AuthStatus,
  type DaemonStatus,
  type GitHubHealth,
  type GitHubStatus,
  type IntegrationAuthConnection,
  type ProviderHealth,
  type TrackerHealth,
  type TrackerStatus,
  type WorkspaceCleanupPlan,
  type WorkspaceInventory,
} from "@symphonia/types";

type SectionId = "profile" | "appearance" | "notifications" | "workspace" | "integrations" | "security" | "billing";

const sections: { id: SectionId; label: string; icon: typeof UserIcon }[] = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "workspace", label: "Workspace", icon: Building2 },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "security", label: "Security", icon: KeyRound },
  { id: "billing", label: "Billing", icon: CreditCard },
];

export default function SettingsPage() {
  const desktop = getDesktopApi();
  const { theme, toggle } = useTheme();
  const [active, setActive] = useState<SectionId>("profile");
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus | null>(null);
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings | null>(null);
  const [diagnostics, setDiagnostics] = useState<DesktopDiagnostics | null>(null);
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus | null>(null);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [trackerStatus, setTrackerStatus] = useState<TrackerStatus | null>(null);
  const [trackerHealth, setTrackerHealth] = useState<TrackerHealth | null>(null);
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [githubHealth, setGithubHealth] = useState<GitHubHealth | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authSessions, setAuthSessions] = useState<Partial<Record<AuthProviderId, AuthStartResult>>>({});
  const [manualTokens, setManualTokens] = useState<Partial<Record<AuthProviderId, string>>>({});
  const [workspaceInventory, setWorkspaceInventory] = useState<WorkspaceInventory | null>(null);
  const [cleanupPlan, setCleanupPlan] = useState<WorkspaceCleanupPlan | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [slackConnected, setSlackConnected] = useState(false);

  const load = useCallback(async () => {
    setMessage(null);
    const [daemon, auth, providerList, tracker, trackerHealthResult, github, githubHealthResult, inventory, plan] = await Promise.allSettled([
      getDaemonStatus(),
      getAuthStatus(),
      getProviders(),
      getTrackerStatus(),
      getTrackerHealth(),
      getGithubStatus(),
      getGithubHealth(),
      getWorkspaceInventory(),
      getWorkspaceCleanupPlan(),
    ]);
    if (daemon.status === "fulfilled") setDaemonStatus(daemon.value);
    if (auth.status === "fulfilled") setAuthStatus(auth.value);
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

  const connectedAccount = useMemo(() => {
    const connected = authStatus?.providers.find((connection) => connection.status === "connected" && connection.accountLabel);
    return connected?.accountLabel ?? null;
  }, [authStatus]);

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

  async function openTrustedAuthUrl(url: string | null) {
    if (!url) return;
    if (desktop) {
      await desktop.openExternalLink(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function connectGithub() {
    const result = await startAuth("github", {
      method: "oauth_device",
      requestedScopes: ["repo"],
      redirectMode: "device",
      repositoryPath: desktopSettings?.repositoryPath ?? null,
      metadata: {},
    });
    setAuthSessions((current) => ({ ...current, github: result }));
    await openTrustedAuthUrl(result.verificationUri ?? result.authorizationUrl);
    await load();
  }

  async function connectLinear() {
    const result = await startAuth("linear", {
      method: "oauth_pkce",
      requestedScopes: ["read"],
      redirectMode: "loopback",
      repositoryPath: desktopSettings?.repositoryPath ?? null,
      metadata: {},
    });
    setAuthSessions((current) => ({ ...current, linear: result }));
    await openTrustedAuthUrl(result.authorizationUrl);
    await load();
  }

  async function submitManualToken(provider: AuthProviderId) {
    const token = manualTokens[provider]?.trim();
    if (!token) {
      setMessage(`Enter a ${provider} token before saving manual token mode.`);
      return;
    }
    await startAuth(provider, {
      method: "manual_token",
      requestedScopes: [],
      redirectMode: "manual",
      repositoryPath: desktopSettings?.repositoryPath ?? null,
      metadata: { token },
    });
    setManualTokens((current) => ({ ...current, [provider]: "" }));
    await load();
  }

  async function pollProvider(provider: AuthProviderId) {
    const session = authSessions[provider];
    if (!session) return;
    await pollAuth(provider, session.authSessionId);
    await load();
  }

  async function validateProvider(provider: AuthProviderId) {
    await validateAuth(provider);
    await load();
  }

  async function refreshProvider(provider: AuthProviderId) {
    await refreshAuth(provider);
    await load();
  }

  async function disconnectProvider(provider: AuthProviderId) {
    const confirmed = window.confirm(`Disconnect ${provider} and delete locally stored credentials?`);
    if (!confirmed) return;
    await disconnectAuth(provider, { deleteStoredToken: true, revokeRemoteTokenIfSupported: false });
    await load();
  }

  return (
    <MainLayout>
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-semibold">Settings</span>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="hidden w-56 shrink-0 flex-col gap-0.5 border-r p-2 md:flex">
            {sections.map((section) => {
              const Icon = section.icon;
              const isActive = active === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActive(section.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    isActive ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {section.label}
                </button>
              );
            })}
          </nav>

          <div className="flex gap-1 overflow-x-auto border-b px-3 py-2 md:hidden">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setActive(section.id)}
                className={cn(
                  "whitespace-nowrap rounded-md px-2.5 py-1 text-xs",
                  active === section.id ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60",
                )}
              >
                {section.label}
              </button>
            ))}
          </div>

          <main className="max-w-3xl flex-1 overflow-y-auto p-6">
            {active === "profile" && (
              <Section title="Profile" description="Local account context shown from connected integrations. No synthetic user profile is stored in the frontend.">
                <div className="flex items-center gap-4">
                  <span className="grid h-16 w-16 place-items-center rounded-full bg-sky-600 text-sm font-medium text-white">
                    {initialsFor(connectedAccount ?? "Local operator")}
                  </span>
                  <div className="space-y-1">
                    <button type="button" disabled className="rounded-md border px-3 py-1 text-xs opacity-50">
                      Upload photo
                    </button>
                    <p className="text-xs text-muted-foreground">Profile writes need a real account service.</p>
                  </div>
                </div>
                <Field label="Display name">
                  <input value={connectedAccount ?? "Local operator"} readOnly className="w-full rounded-md border bg-background px-3 py-1.5 text-sm" />
                </Field>
                <Field label="Email">
                  <input value="Not provided by current integrations" readOnly className="w-full rounded-md border bg-background px-3 py-1.5 text-sm text-muted-foreground" />
                </Field>
                <Field label="Short bio">
                  <textarea value="No real profile backend is connected yet." readOnly rows={3} className="w-full resize-none rounded-md border bg-background px-3 py-1.5 text-sm text-muted-foreground" />
                </Field>
                <SaveBar disabled label="No profile writes available" />
              </Section>
            )}

            {active === "appearance" && (
              <Section title="Appearance" description="Tune the look and density of this local interface.">
                <Field label="Theme">
                  <div className="grid max-w-sm grid-cols-2 gap-2">
                    {(["light", "dark"] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          if (theme !== item) toggle();
                        }}
                        className={cn("rounded-md border p-3 text-left transition-colors", theme === item ? "border-primary ring-2 ring-primary/20" : "hover:bg-accent")}
                      >
                        <div className={cn("mb-2 h-12 rounded border", item === "dark" ? "bg-zinc-900" : "bg-zinc-50")} />
                        <span className="text-xs capitalize">{item}</span>
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Accent color">
                  <div className="flex gap-2">
                    {["bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-rose-500", "bg-amber-500"].map((color, index) => (
                      <button key={color} type="button" className={cn("h-7 w-7 rounded-full ring-offset-2 ring-offset-background", color, index === 0 && "ring-2 ring-foreground")} aria-label={`${color} accent`} />
                    ))}
                  </div>
                </Field>
                <ToggleRow label="Compact density" description="Density preferences will be persisted when user settings are available." checked={false} disabled onChange={() => {}} />
              </Section>
            )}

            {active === "notifications" && (
              <Section title="Notifications" description="Notification settings are ready for real account data, but no notification backend is connected yet.">
                <ToggleRow label="Mentions" description="Someone mentions you in a comment or thread." checked={false} disabled onChange={() => {}} />
                <ToggleRow label="Assigned to me" description="You're assigned to an issue or project." checked={false} disabled onChange={() => {}} />
                <ToggleRow label="Weekly digest" description="A weekly summary of your workspace." checked={false} disabled onChange={() => {}} />
                <ToggleRow label="Product updates" description="Product update email preferences require a real account service." checked={false} disabled onChange={() => {}} />
              </Section>
            )}

            {active === "workspace" && (
              <Section title="Workspace" description="Local desktop, daemon, workflow, harness, and cleanup settings. Secrets stay outside settings JSON.">
                {desktopStatus && (
                  <div className="mb-4 rounded-md border p-3">
                    <KeyValue label="Desktop" value={`${desktopStatus.appVersion} / Electron ${desktopStatus.electronVersion}`} />
                    <KeyValue label="Daemon" value={`${desktopStatus.daemon.state} ${desktopStatus.daemon.url ?? ""}`} />
                    <KeyValue label="Web" value={`${desktopStatus.web.state} ${desktopStatus.web.url ?? ""}`} />
                    <KeyValue label="Settings file" value={desktopStatus.settingsPath} />
                  </div>
                )}
                {desktopSettings ? (
                  <div className="space-y-3">
                    <PathRow label="Repository" value={desktopSettings.repositoryPath} onChoose={() => void choosePath("repositoryPath")} />
                    <PathRow label="WORKFLOW.md" value={desktopSettings.workflowPath} onChoose={() => void choosePath("workflowPath")} />
                    <PathRow label="Workspace root" value={desktopSettings.workspaceRoot} onChoose={() => void choosePath("workspaceRoot")} />
                    <KeyValue label="Database" value={desktopSettings.databasePath ?? "Not set"} />
                    <KeyValue label="Default provider" value={desktopSettings.defaultProviderId} />
                    <KeyValue label="Default tracker" value={desktopSettings.defaultTrackerKind} />
                    <KeyValue label="Cleanup" value={desktopSettings.cleanupEnabled ? (desktopSettings.cleanupDryRun ? "enabled, dry-run" : "enabled") : "disabled"} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Desktop settings are unavailable in browser-only mode.</p>
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
                  <a href="/harness" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                    <ScanSearch className="h-4 w-4" />
                    Harness Builder
                  </a>
                </div>
                <div className="mt-4 grid gap-2 text-sm">
                  <KeyValue label="Daemon instance" value={daemonStatus?.daemonInstanceId ?? "Unavailable"} />
                  <KeyValue label="Active runs" value={String(daemonStatus?.activeRunsCount ?? 0)} />
                  <KeyValue label="Recovered runs" value={String(daemonStatus?.recoveredRunsCount ?? 0)} />
                  <KeyValue label="Workspaces" value={`${workspaceInventory?.workspaces.length ?? 0} total / ${workspaceInventory?.counts.active ?? 0} active`} />
                  <KeyValue label="Cleanup candidates" value={String(cleanupPlan?.candidates.length ?? 0)} />
                </div>
              </Section>
            )}

            {active === "integrations" && (
              <Section title="Integrations" description="Connect Symphonia to the real tools your team already uses. GitHub and Linear are daemon-backed; Slack is a local prototype toggle.">
                <IntegrationCard
                  provider="github"
                  title="GitHub"
                  description="Device flow for local desktop/browser usage, with GITHUB_TOKEN/GITHUB_PAT fallback."
                  connection={authStatus?.providers.find((connection) => connection.provider === "github") ?? null}
                  session={authSessions.github ?? null}
                  manualToken={manualTokens.github ?? ""}
                  onManualTokenChange={(value) => setManualTokens((current) => ({ ...current, github: value }))}
                  onConnect={() => void connectGithub()}
                  onPoll={() => void pollProvider("github")}
                  onManualToken={() => void submitManualToken("github")}
                  onValidate={() => void validateProvider("github")}
                  onRefresh={() => void refreshProvider("github")}
                  onDisconnect={() => void disconnectProvider("github")}
                />
                <IntegrationCard
                  provider="linear"
                  title="Linear"
                  description="PKCE loopback when SYMPHONIA_LINEAR_CLIENT_ID is configured, with LINEAR_API_KEY fallback."
                  connection={authStatus?.providers.find((connection) => connection.provider === "linear") ?? null}
                  session={authSessions.linear ?? null}
                  manualToken={manualTokens.linear ?? ""}
                  onManualTokenChange={(value) => setManualTokens((current) => ({ ...current, linear: value }))}
                  onConnect={() => void connectLinear()}
                  onPoll={() => void load()}
                  onManualToken={() => void submitManualToken("linear")}
                  onValidate={() => void validateProvider("linear")}
                  onRefresh={() => void refreshProvider("linear")}
                  onDisconnect={() => void disconnectProvider("linear")}
                />
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Slack</div>
                    <div className="text-xs text-muted-foreground">Prototype-only notification toggle. No Slack API calls are wired.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSlackConnected((current) => !current)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs transition-colors",
                      slackConnected ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "hover:bg-accent",
                    )}
                  >
                    {slackConnected ? (
                      <span className="flex items-center gap-1">
                        <Check className="h-3 w-3" /> Connected
                      </span>
                    ) : (
                      "Connect"
                    )}
                  </button>
                </div>
              </Section>
            )}

            {active === "security" && (
              <Section title="Security" description="Token and diagnostic surfaces are redacted. Raw secrets never render in the settings UI.">
                <div className="space-y-3">
                  <KeyValue label="GitHub credential" value={authStatus?.providers.find((connection) => connection.provider === "github")?.redactedSource ?? "unavailable"} />
                  <KeyValue label="Linear credential" value={authStatus?.providers.find((connection) => connection.provider === "linear")?.redactedSource ?? "unavailable"} />
                  <KeyValue label="GitHub health" value={githubHealth ? (githubHealth.healthy ? "healthy" : `unavailable: ${githubHealth.error ?? "unknown"}`) : "unknown"} />
                  <KeyValue label="Linear health" value={trackerHealth ? (trackerHealth.healthy ? "healthy" : `unavailable: ${trackerHealth.error ?? "unknown"}`) : "unknown"} />
                  <KeyValue label="GitHub repo" value={githubStatus?.config?.owner && githubStatus?.config?.repo ? `${githubStatus.config.owner}/${githubStatus.config.repo}` : "Not configured"} />
                  <KeyValue label="Tracker" value={trackerStatus ? `${trackerStatus.kind} / ${trackerStatus.status.replaceAll("_", " ")}` : "Unavailable"} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={copyDiagnostics} disabled={!desktop} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50">
                    <Copy className="h-4 w-4" />
                    Copy diagnostics
                  </button>
                </div>
                {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}
                <Field label="Provider health">
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
                </Field>
              </Section>
            )}

            {active === "billing" && (
              <Section title="Billing" description="Billing is intentionally empty until a real account and subscription backend exists.">
                <div className="rounded-md border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Current plan</div>
                      <div className="text-lg font-semibold">No billing account connected</div>
                      <div className="text-xs text-muted-foreground">No synthetic subscription, invoice, or card data is rendered.</div>
                    </div>
                    <button type="button" disabled className="rounded-md border px-3 py-1.5 text-xs opacity-50">
                      Manage plan
                    </button>
                  </div>
                </div>
              </Section>
            )}
          </main>
        </div>
      </div>
    </MainLayout>
  );
}

function IntegrationCard({
  provider,
  title,
  description,
  connection,
  session,
  manualToken,
  onManualTokenChange,
  onConnect,
  onPoll,
  onManualToken,
  onValidate,
  onRefresh,
  onDisconnect,
}: {
  provider: AuthProviderId;
  title: string;
  description: string;
  connection: IntegrationAuthConnection | null;
  session: AuthStartResult | null;
  manualToken: string;
  onManualTokenChange: (value: string) => void;
  onConnect: () => void;
  onPoll: () => void;
  onManualToken: () => void;
  onValidate: () => void;
  onRefresh: () => void;
  onDisconnect: () => void;
}) {
  const connected = connection?.status === "connected";
  const canOauthConnect = provider === "github" || Boolean(connection?.clientIdConfigured);
  return (
    <div className="mb-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onConnect} disabled={!canOauthConnect} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-50">
            <ExternalLink className="h-3 w-3" /> Connect
          </button>
          <button type="button" onClick={onValidate} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent">
            <CheckCircle2 className="h-3 w-3" /> Validate
          </button>
          <button type="button" onClick={onRefresh} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
          <button type="button" onClick={onDisconnect} disabled={!connected && connection?.credentialSource !== "manual"} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-50">
            <LogOut className="h-3 w-3" /> Disconnect
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-1 text-xs">
        <KeyValue label="Status" value={connection?.status ?? "unknown"} />
        <KeyValue label="Method" value={connection?.method ?? "unavailable"} />
        <KeyValue label="Credential source" value={connection?.redactedSource ?? "unavailable"} />
        <KeyValue label="Account" value={connection?.accountLabel ?? "Not validated"} />
        <KeyValue label="Workspace" value={connection?.workspaceLabel ?? "Not reported"} />
        <KeyValue label="Scopes" value={(connection?.scopes ?? []).join(", ") || "Unknown"} />
        <KeyValue label="Storage" value={`${connection?.tokenStorage ?? "none"}${connection?.refreshSupported ? " / refreshable" : ""}`} />
        <KeyValue label="Expires" value={connection?.tokenExpiresAt ?? "Unknown or non-expiring"} />
        <KeyValue label="Last checked" value={connection?.lastValidatedAt ?? "Never"} />
        <KeyValue label="Env fallback" value={connection?.envTokenPresent ? "detected" : "not detected"} />
        <KeyValue label="Client id" value={connection?.clientIdConfigured ? "configured" : "not configured"} />
        {connection?.lastError && <p className="text-xs text-destructive">{connection.lastError}</p>}
      </div>

      {session && (
        <div className="mt-3 rounded-md border bg-muted/20 p-2 text-xs">
          <p className="font-medium">Pending authorization</p>
          <p className="mt-1 text-muted-foreground">Session {session.authSessionId}</p>
          {session.userCode && <p className="mt-1 select-all text-sm font-semibold">{session.userCode}</p>}
          {session.authorizationUrl && <p className="mt-1 break-all">{session.authorizationUrl}</p>}
          <button type="button" onClick={onPoll} className="mt-2 rounded-md border px-2 py-1 text-xs hover:bg-accent">
            Check status
          </button>
        </div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Manual token fallback</span>
          <input
            value={manualToken}
            onChange={(event) => onManualTokenChange(event.target.value)}
            type="password"
            autoComplete="off"
            placeholder={`${title} token`}
            className="rounded-md border bg-background px-2 py-1.5 text-xs"
          />
        </label>
        <button type="button" onClick={onManualToken} className="mt-auto inline-flex items-center justify-center gap-2 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent">
          <KeyRound className="h-3.5 w-3.5" />
          Store manual token
        </button>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border p-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("h-5 w-9 rounded-full border p-0.5 transition-colors disabled:opacity-50", checked ? "bg-primary" : "bg-muted")}
        aria-pressed={checked}
      >
        <span className={cn("block h-3.5 w-3.5 rounded-full bg-background transition-transform", checked && "translate-x-4")} />
      </button>
    </div>
  );
}

function SaveBar({ disabled = false, label = "Save changes" }: { disabled?: boolean; label?: string }) {
  return (
    <div className="flex justify-end">
      <button type="button" disabled={disabled} className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {label}
      </button>
    </div>
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

function initialsFor(label: string) {
  const parts = label.split(/\s+|[._-]/).filter(Boolean);
  const initials = parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : label.slice(0, 2);
  return initials.toUpperCase();
}
