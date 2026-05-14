import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  HarnessApplyRequestSchema,
  HarnessApplyResult,
  HarnessApplyResultSchema,
  HarnessArtifactPreview,
} from "@symphonia/types";

export const HARNESS_APPLY_CONFIRMATION = "APPLY HARNESS CHANGES";

export type HarnessApplyOptions = {
  scanId?: string | null;
  now?: () => Date;
  backupRoot?: string;
};

export function applyHarnessArtifacts(
  input: unknown,
  previews: HarnessArtifactPreview[],
  options: HarnessApplyOptions = {},
): HarnessApplyResult {
  const request = HarnessApplyRequestSchema.parse(input);
  const repositoryPath = resolve(request.repositoryPath);
  const rootRealPath = validateRepositoryPath(repositoryPath);
  const selected = new Set(request.artifactIds);
  const byId = new Map(previews.map((preview) => [preview.id, preview]));
  const result: HarnessApplyResult = {
    applied: [],
    skipped: [],
    failed: [],
    backups: [],
    events: [],
    nextScanSuggested: false,
  };

  if (!request.dryRun && request.confirmation !== HARNESS_APPLY_CONFIRMATION) {
    throw new HarnessApplyError("missing_confirmation", `Type ${HARNESS_APPLY_CONFIRMATION} to apply harness changes.`);
  }

  for (const artifactId of selected) {
    const preview = byId.get(artifactId);
    if (!preview) {
      result.failed.push({
        artifactId,
        path: artifactId,
        action: "manual",
        message: "Artifact preview was not found.",
        error: "missing_preview",
      });
      continue;
    }

    if (preview.action === "skip" || preview.action === "manual") {
      result.skipped.push({
        artifactId: preview.id,
        path: preview.path,
        action: preview.action,
        message: preview.action === "manual" ? "Manual merge required." : "No write proposed.",
      });
      result.events.push(`harness.artifact.skipped:${preview.id}`);
      continue;
    }

    let targetPath: string;
    try {
      targetPath = safeTargetPath(rootRealPath, preview.path);
      ensureWritableTarget(rootRealPath, targetPath);
    } catch (error) {
      result.failed.push(failure(preview, error));
      result.events.push(`harness.artifact.failed:${preview.id}`);
      continue;
    }

    if (request.dryRun) {
      result.skipped.push({
        artifactId: preview.id,
        path: preview.path,
        action: preview.action,
        message: "Dry-run only; no file was written.",
      });
      result.events.push(`harness.artifact.skipped:${preview.id}`);
      continue;
    }

    try {
      if (preview.action === "create") {
        if (existsSync(targetPath)) throw new HarnessApplyError("target_exists", "Target file already exists.");
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, preview.proposedContent, { encoding: "utf8", flag: "wx", mode: 0o644 });
      } else {
        if (!existsSync(targetPath)) throw new HarnessApplyError("target_missing", "Target file is missing.");
        const existingHash = hashFile(targetPath);
        if (preview.existingContentHash && existingHash !== preview.existingContentHash) {
          throw new HarnessApplyError("hash_mismatch", "Existing file changed since preview.");
        }
        const backupPath = backupExistingFile(rootRealPath, targetPath, preview, options);
        result.backups.push({ artifactId: preview.id, path: preview.path, backupPath });
        writeFileSync(targetPath, preview.proposedContent, { encoding: "utf8", flag: "w", mode: 0o644 });
      }

      if (preview.kind === "script" || preview.path.startsWith("scripts/")) {
        chmodSync(targetPath, 0o755);
      }

      result.applied.push({
        artifactId: preview.id,
        path: preview.path,
        action: preview.action,
        message: "Harness artifact written.",
      });
      result.events.push(`harness.artifact.applied:${preview.id}`);
      result.nextScanSuggested = true;
    } catch (error) {
      result.failed.push(failure(preview, error));
      result.events.push(`harness.artifact.failed:${preview.id}`);
    }
  }

  return HarnessApplyResultSchema.parse(result);
}

function validateRepositoryPath(repositoryPath: string): string {
  let stats;
  try {
    stats = statSync(repositoryPath);
  } catch {
    throw new HarnessApplyError("invalid_repository_path", "Repository path does not exist.");
  }
  if (!stats.isDirectory()) throw new HarnessApplyError("invalid_repository_path", "Repository path must be a directory.");
  return realpathSync(repositoryPath);
}

function safeTargetPath(rootRealPath: string, repoPath: string): string {
  if (repoPath.includes("\0")) throw new HarnessApplyError("invalid_path", "Path contains a null byte.");
  const target = resolve(rootRealPath, repoPath);
  if (!isInside(rootRealPath, target)) throw new HarnessApplyError("path_traversal", "Artifact path escapes repository.");
  return target;
}

function ensureWritableTarget(rootRealPath: string, targetPath: string): void {
  if (existsSync(targetPath)) {
    const stat = lstatSync(targetPath);
    if (stat.isSymbolicLink()) throw new HarnessApplyError("symlink_escape", "Target file is a symlink.");
    const realTarget = realpathSync(targetPath);
    if (!isInside(rootRealPath, realTarget)) throw new HarnessApplyError("symlink_escape", "Target real path escapes repository.");
    return;
  }

  let ancestor = dirname(targetPath);
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new HarnessApplyError("invalid_path", "Could not find an existing parent directory.");
    ancestor = parent;
  }
  const ancestorStat = lstatSync(ancestor);
  if (ancestorStat.isSymbolicLink()) throw new HarnessApplyError("symlink_escape", "Parent directory is a symlink.");
  const realAncestor = realpathSync(ancestor);
  if (!isInside(rootRealPath, realAncestor)) throw new HarnessApplyError("symlink_escape", "Parent directory escapes repository.");
}

function backupExistingFile(
  rootRealPath: string,
  targetPath: string,
  preview: HarnessArtifactPreview,
  options: HarnessApplyOptions,
): string {
  const stamp = (options.now ?? (() => new Date()))().toISOString().replace(/[:.]/gu, "-");
  const backupRoot = options.backupRoot ? resolve(options.backupRoot) : join(rootRealPath, ".symphonia", "harness-backups", stamp);
  if (!isInside(rootRealPath, backupRoot)) throw new HarnessApplyError("backup_path_escape", "Backup path escapes repository.");
  const backupPath = join(backupRoot, preview.path);
  mkdirSync(dirname(backupPath), { recursive: true });
  copyFileSync(targetPath, backupPath);
  return backupPath;
}

function failure(preview: HarnessArtifactPreview, error: unknown) {
  return {
    artifactId: preview.id,
    path: preview.path,
    action: preview.action,
    message: "Harness artifact was not written.",
    error: error instanceof Error ? error.message : String(error),
  };
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isInside(root: string, child: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedChild = resolve(child);
  return resolvedChild === resolvedRoot || resolvedChild.startsWith(`${resolvedRoot}${sep}`);
}

export class HarnessApplyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HarnessApplyError";
  }
}
