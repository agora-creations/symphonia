"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  FileText,
  GitBranch,
  History,
  Play,
  RefreshCw,
  ScanSearch,
} from "lucide-react";
import {
  applyHarnessArtifacts,
  generateHarnessPreviews,
  getHarnessScans,
  getHarnessStatus,
  runHarnessScan,
} from "@/lib/api";
import { getDesktopApi } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import type {
  HarnessApplyResult,
  HarnessArtifactPreview,
  HarnessCategory,
  HarnessFinding,
  HarnessRecommendation,
  HarnessScanResult,
  HarnessStatus,
} from "@symphonia/types";

const confirmationText = "APPLY HARNESS CHANGES";

export function HarnessBuilder() {
  const desktop = getDesktopApi();
  const [status, setStatus] = useState<HarnessStatus | null>(null);
  const [repositoryPath, setRepositoryPath] = useState("");
  const [scan, setScan] = useState<HarnessScanResult | null>(null);
  const [history, setHistory] = useState<HarnessScanResult[]>([]);
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);
  const [dryRun, setDryRun] = useState(true);
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState<HarnessApplyResult | null>(null);
  const [loading, setLoading] = useState<"status" | "scan" | "preview" | "apply" | null>("status");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading("status");
    try {
      const loadedStatus = await getHarnessStatus();
      const settings = desktop ? await desktop.getSettings().catch(() => null) : null;
      const path = settings?.repositoryPath ?? loadedStatus.currentRepositoryPath ?? "";
      setStatus(loadedStatus);
      setRepositoryPath(path);
      const scans = path ? await getHarnessScans(path).catch(() => []) : [];
      setHistory(scans);
      setScan(scans[0] ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(null);
    }
  }, [desktop]);

  useEffect(() => {
    void load();
  }, [load]);

  async function chooseRepository() {
    if (!desktop) return;
    const result = await desktop.chooseDirectory({ title: "Choose repository folder", defaultPath: repositoryPath || undefined });
    if (result.canceled || !result.path) return;
    setRepositoryPath(result.path);
  }

  async function scanRepository() {
    setError(null);
    setResult(null);
    setLoading("scan");
    try {
      const next = await runHarnessScan({
        repositoryPath,
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
      setScan(next);
      setHistory(await getHarnessScans(next.repositoryPath).catch(() => [next]));
      setSelectedArtifactIds(next.generatedPreviews.filter((preview) => preview.action === "create" || preview.action === "update").map((preview) => preview.id));
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setLoading(null);
    }
  }

  async function previewArtifacts() {
    if (!scan) return;
    setError(null);
    setLoading("preview");
    try {
      const next = await generateHarnessPreviews(scan.id);
      setScan(next);
      setHistory(await getHarnessScans(next.repositoryPath).catch(() => [next]));
      setSelectedArtifactIds(next.generatedPreviews.filter((preview) => preview.action === "create" || preview.action === "update").map((preview) => preview.id));
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : String(previewError));
    } finally {
      setLoading(null);
    }
  }

  async function applySelected() {
    if (!scan || selectedArtifactIds.length === 0) return;
    setError(null);
    setLoading("apply");
    try {
      const next = await applyHarnessArtifacts({
        repositoryPath: scan.repositoryPath,
        artifactIds: selectedArtifactIds,
        dryRun,
        confirmation: dryRun ? null : confirmation,
      });
      setResult(next);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : String(applyError));
    } finally {
      setLoading(null);
    }
  }

  const selectedPreviewCount = selectedArtifactIds.length;
  const canWrite = dryRun || confirmation === confirmationText;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <span className="text-sm font-semibold">Harness Builder</span>
          <p className="text-xs text-muted-foreground">Scan a repository, preview agent harness changes, and apply only selected files.</p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center">
          <label className="min-w-0 flex-1 text-xs text-muted-foreground">
            Repository
            <input
              value={repositoryPath}
              onChange={(event) => setRepositoryPath(event.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-xs text-foreground"
              placeholder={status?.currentRepositoryPath ?? "Choose a repository path"}
            />
          </label>
          <button type="button" onClick={chooseRepository} disabled={!desktop} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50">
            <GitBranch className="h-4 w-4" />
            Choose
          </button>
          <button type="button" onClick={scanRepository} disabled={!repositoryPath || loading === "scan"} className="inline-flex items-center justify-center gap-2 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50">
            {loading === "scan" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
            Run scan
          </button>
        </div>
      </header>

      <div aria-live="polite" className="sr-only">
        {loading ? `Harness ${loading} in progress` : "Harness builder idle"}
      </div>
      {error && (
        <div className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
        <div className="space-y-4">
          {scan ? <ScorePanel scan={scan} /> : <EmptyPanel loading={loading === "status"} />}
          {scan && <CategoryGrid categories={scan.categories} />}
          {scan && <FindingsPanel findings={scan.findings} recommendations={scan.recommendations} />}
        </div>

        <div className="space-y-4">
          {scan && (
            <RecommendationsPanel recommendations={scan.recommendations} />
          )}
          {scan && (
            <PreviewPanel
              scan={scan}
              selectedArtifactIds={selectedArtifactIds}
              onToggle={(artifactId) =>
                setSelectedArtifactIds((current) =>
                  current.includes(artifactId) ? current.filter((item) => item !== artifactId) : [...current, artifactId],
                )
              }
              onGenerate={previewArtifacts}
              loading={loading === "preview"}
            />
          )}
          {scan && (
            <ApplyPanel
              dryRun={dryRun}
              onDryRunChange={setDryRun}
              confirmation={confirmation}
              onConfirmationChange={setConfirmation}
              selectedPreviewCount={selectedPreviewCount}
              canWrite={canWrite}
              onApply={applySelected}
              loading={loading === "apply"}
              result={result}
              onRescan={scanRepository}
            />
          )}
          <HistoryPanel scans={history} onSelect={(item) => setScan(item)} />
        </div>
      </div>
    </div>
  );
}

function EmptyPanel({ loading }: { loading: boolean }) {
  return (
    <section className="rounded-md border bg-card p-5">
      <div className="flex items-center gap-3">
        {loading ? <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /> : <ScanSearch className="h-5 w-5 text-muted-foreground" />}
        <div>
          <h1 className="text-lg font-semibold">No readiness scan loaded</h1>
          <p className="mt-1 text-sm text-muted-foreground">Choose a repository path and run a scan to see score, evidence, previews, and apply controls.</p>
        </div>
      </div>
    </section>
  );
}

function ScorePanel({ scan }: { scan: HarnessScanResult }) {
  const risky = scan.categories.filter((category) => category.status === "risky").length;
  const missing = scan.categories.filter((category) => category.status === "missing").length;
  return (
    <section className="rounded-md border bg-card p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Agent readiness score</p>
          <h1 className="mt-1 text-3xl font-semibold tabular-nums">
            {scan.score.percentage}% <span className="text-lg text-muted-foreground">Grade {scan.grade}</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {scan.repositoryPath}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <Metric label="Findings" value={String(scan.findings.length)} />
          <Metric label="Risky" value={String(risky)} tone={risky > 0 ? "risk" : "ok"} />
          <Metric label="Missing" value={String(missing)} tone={missing > 0 ? "warn" : "ok"} />
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-foreground" style={{ width: `${scan.score.percentage}%` }} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Scanned {scan.detectedFiles.filter((file) => file.exists).length} files. Limits: {scan.limits.filesScanned}/{scan.limits.maxFiles} files, {scan.limits.bytesRead}/{scan.limits.maxBytes} bytes read.
      </p>
      {scan.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-amber-700 dark:text-amber-300">
          {scan.warnings.map((warning) => (
            <li key={warning} className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "risk" }) {
  return (
    <div className={cn("rounded-md border px-3 py-2", tone === "risk" && "border-destructive/40", tone === "warn" && "border-amber-500/40")}>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

function CategoryGrid({ categories }: { categories: HarnessCategory[] }) {
  return (
    <section className="grid gap-2 md:grid-cols-2">
      {categories.map((category) => (
        <button key={category.id} type="button" className="rounded-md border bg-card p-3 text-left focus:outline-none focus:ring-2 focus:ring-ring">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{category.label}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{Math.round((category.score / category.max) * 100)}%</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{category.status}: {category.summary}</p>
        </button>
      ))}
    </section>
  );
}

function FindingsPanel({ findings, recommendations }: { findings: HarnessFinding[]; recommendations: HarnessRecommendation[] }) {
  const byId = new Map(recommendations.map((recommendation) => [recommendation.id, recommendation]));
  return (
    <section className="rounded-md border bg-card p-4">
      <h2 className="text-sm font-semibold">Findings</h2>
      <div className="mt-3 max-h-[34rem] space-y-2 overflow-auto pr-1">
        {findings.map((finding) => (
          <article key={finding.id} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border px-2 py-0.5 text-[11px]">{finding.severity}</span>
              <span className="rounded-full border px-2 py-0.5 text-[11px]">{finding.status}</span>
              <span className="text-sm font-medium">{finding.title}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{finding.description}</p>
            {finding.evidence.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {finding.evidence.map((item) => (
                  <li key={`${finding.id}-${item.label}-${item.value}`} className="break-words text-muted-foreground">
                    {item.label}: {item.value}{item.filePath ? ` (${item.filePath}${item.lineNumber ? `:${item.lineNumber}` : ""})` : ""}
                  </li>
                ))}
              </ul>
            )}
            {finding.recommendationIds.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Recommendation: {finding.recommendationIds.map((id) => byId.get(id)?.title ?? id).join(", ")}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function RecommendationsPanel({ recommendations }: { recommendations: HarnessRecommendation[] }) {
  return (
    <section className="rounded-md border bg-card p-4">
      <h2 className="text-sm font-semibold">Recommendations</h2>
      <div className="mt-3 space-y-2">
        {recommendations.slice(0, 8).map((recommendation) => (
          <article key={recommendation.id} className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{recommendation.title}</span>
              <span className="rounded-full border px-2 py-0.5 text-[11px]">{recommendation.priority}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{recommendation.rationale}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Artifacts: {recommendation.proposedArtifacts.map((artifact) => `${artifact.action} ${artifact.path}`).join(", ") || "manual"}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PreviewPanel({
  scan,
  selectedArtifactIds,
  onToggle,
  onGenerate,
  loading,
}: {
  scan: HarnessScanResult;
  selectedArtifactIds: string[];
  onToggle: (artifactId: string) => void;
  onGenerate: () => void;
  loading: boolean;
}) {
  return (
    <section className="rounded-md border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Artifact Previews</h2>
        <button type="button" onClick={onGenerate} disabled={loading} className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-50">
          {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
          Generate previews
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {scan.generatedPreviews.length === 0 && <p className="text-xs text-muted-foreground">No previews generated yet.</p>}
        {scan.generatedPreviews.map((preview) => (
          <PreviewItem key={preview.id} preview={preview} selected={selectedArtifactIds.includes(preview.id)} onToggle={() => onToggle(preview.id)} />
        ))}
      </div>
    </section>
  );
}

function PreviewItem({ preview, selected, onToggle }: { preview: HarnessArtifactPreview; selected: boolean; onToggle: () => void }) {
  const selectable = preview.action === "create" || preview.action === "update";
  return (
    <article className="rounded-md border p-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          disabled={!selectable}
          onChange={onToggle}
          className="mt-1"
          aria-label={`Select ${preview.path}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all text-sm font-medium">{preview.path}</span>
            <span className="rounded-full border px-2 py-0.5 text-[11px]">{preview.action}</span>
            <span className="rounded-full border px-2 py-0.5 text-[11px]">{preview.kind}</span>
          </div>
          {preview.warnings.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">{preview.warnings.join(" ")}</p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Diff preview</summary>
            <pre aria-label={`Diff preview for ${preview.path}`} className="mt-2 max-h-80 overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
              {preview.diff}
            </pre>
          </details>
        </div>
      </div>
    </article>
  );
}

function ApplyPanel({
  dryRun,
  onDryRunChange,
  confirmation,
  onConfirmationChange,
  selectedPreviewCount,
  canWrite,
  onApply,
  loading,
  result,
  onRescan,
}: {
  dryRun: boolean;
  onDryRunChange: (value: boolean) => void;
  confirmation: string;
  onConfirmationChange: (value: string) => void;
  selectedPreviewCount: number;
  canWrite: boolean;
  onApply: () => void;
  loading: boolean;
  result: HarnessApplyResult | null;
  onRescan: () => void;
}) {
  return (
    <section className="rounded-md border bg-card p-4">
      <h2 className="text-sm font-semibold">Apply</h2>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={dryRun} onChange={(event) => onDryRunChange(event.target.checked)} />
        Dry-run only
      </label>
      {!dryRun && (
        <label className="mt-3 block text-xs text-muted-foreground">
          Type confirmation
          <input
            value={confirmation}
            onChange={(event) => onConfirmationChange(event.target.value)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-xs text-foreground"
            placeholder={confirmationText}
          />
        </label>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onApply} disabled={loading || selectedPreviewCount === 0 || !canWrite} className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50">
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {dryRun ? "Dry-run apply" : "Apply selected"}
        </button>
        <button type="button" onClick={onRescan} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <RefreshCw className="h-4 w-4" />
          Re-scan
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{selectedPreviewCount} selected artifacts. Writes require exact confirmation.</p>
      {result && (
        <div className="mt-3 rounded-md border p-3 text-xs">
          <p>Applied: {result.applied.length}. Skipped: {result.skipped.length}. Failed: {result.failed.length}.</p>
          {result.failed.length > 0 && <p className="mt-1 text-destructive">{result.failed.map((item) => `${item.path}: ${item.error}`).join("; ")}</p>}
          {result.nextScanSuggested && <p className="mt-1 text-muted-foreground">Re-scan is recommended.</p>}
        </div>
      )}
    </section>
  );
}

function HistoryPanel({ scans, onSelect }: { scans: HarnessScanResult[]; onSelect: (scan: HarnessScanResult) => void }) {
  return (
    <section className="rounded-md border bg-card p-4">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Scan History</h2>
      </div>
      <div className="mt-3 space-y-2">
        {scans.length === 0 && <p className="text-xs text-muted-foreground">No scan history for this repository yet.</p>}
        {scans.slice(0, 6).map((item) => (
          <button key={`${item.id}-${item.scannedAt}`} type="button" onClick={() => onSelect(item)} className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs hover:bg-muted">
            <span className="truncate">{new Date(item.scannedAt).toLocaleString()}</span>
            <span className="shrink-0 tabular-nums">{item.score.percentage}% {item.grade}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
