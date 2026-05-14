import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import {
  HarnessDetectedFile,
  HarnessRepositoryMetadata,
  HarnessScanLimits,
  HarnessScanRequest,
  HarnessScanRequestSchema,
  HarnessScanResult,
  HarnessScanResultSchema,
} from "@symphonia/types";
import { scoreHarnessContext } from "./harness-scoring.js";
import { generateHarnessPreviews } from "./harness-generator.js";

export type HarnessFileRecord = HarnessDetectedFile & {
  absolutePath: string;
  content: string | null;
  lineCount: number | null;
  skippedReason: string | null;
};

export type HarnessScanContext = {
  id: string;
  repositoryPath: string;
  scannedAt: string;
  request: HarnessScanRequest;
  files: Map<string, HarnessFileRecord>;
  warnings: string[];
  errors: string[];
  metadata: HarnessRepositoryMetadata;
  limits: HarnessScanLimits;
};

export type HarnessScannerOptions = {
  id?: string;
  maxFiles?: number;
  maxBytes?: number;
  maxFileSizeBytes?: number;
  now?: () => Date;
};

const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  ".symphonia",
  ".pnpm-store",
  ".data",
  ".desktop-package",
  ".turbo",
  ".cache",
  "vendor",
]);

const textExtensions = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".sh",
  ".env",
  ".example",
  ".gitignore",
  ".dockerignore",
]);

const harnessFileKinds: Array<[RegExp, string]> = [
  [/^AGENTS\.md$/u, "agents"],
  [/^WORKFLOW\.md$/u, "workflow"],
  [/^README\.md$/u, "readme"],
  [/^docs\//u, "doc"],
  [/^ARCHITECTURE\.md$/u, "doc"],
  [/^SECURITY\.md$/u, "security"],
  [/^TESTING\.md$/u, "testing"],
  [/^FRONTEND\.md$/u, "frontend"],
  [/^BACKEND\.md$/u, "backend"],
  [/^CONTRIBUTING\.md$/u, "contributing"],
  [/^scripts\//u, "script"],
  [/^skills\//u, "skill"],
  [/^evals\//u, "eval"],
  [/^\.github\/workflows\//u, "ci"],
  [/^package\.json$/u, "metadata"],
  [/^pnpm-workspace\.yaml$/u, "metadata"],
  [/^tsconfig/u, "metadata"],
  [/^pyproject\.toml$/u, "metadata"],
  [/^Cargo\.toml$/u, "metadata"],
  [/^go\.mod$/u, "metadata"],
  [/^Dockerfile$/u, "metadata"],
  [/^docker-compose\.(yml|yaml)$/u, "metadata"],
];

export function scanHarnessRepository(input: unknown, options: HarnessScannerOptions = {}): HarnessScanResult {
  const request = HarnessScanRequestSchema.parse(input);
  const context = buildHarnessScanContext(request, options);
  const scored = scoreHarnessContext(context);
  const generatedPreviews = request.includeGeneratedPreviews ? generateHarnessPreviews(context, scored) : [];
  const result = HarnessScanResultSchema.parse({
    id: context.id,
    repositoryPath: context.repositoryPath,
    scannedAt: context.scannedAt,
    score: scored.score,
    grade: scored.score.grade,
    categories: scored.categories,
    findings: scored.findings,
    recommendations: scored.recommendations,
    detectedFiles: [...context.files.values()].map(({ absolutePath: _absolutePath, content: _content, lineCount: _lineCount, skippedReason: _skippedReason, ...file }) => file),
    generatedPreviews,
    warnings: context.warnings,
    errors: context.errors,
    metadata: context.metadata,
    limits: context.limits,
  });
  return result;
}

export function buildHarnessScanContext(
  input: HarnessScanRequest,
  options: HarnessScannerOptions = {},
): HarnessScanContext {
  const repositoryPath = resolve(input.repositoryPath);
  const scannedAt = (options.now ?? (() => new Date()))().toISOString();
  const warnings: string[] = [];
  const errors: string[] = [];
  const maxFiles = options.maxFiles ?? 2_000;
  const maxBytes = options.maxBytes ?? 2_500_000;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? 256_000;
  const files = new Map<string, HarnessFileRecord>();

  let rootRealPath: string;
  try {
    const stats = statSync(repositoryPath);
    if (!stats.isDirectory()) {
      throw new Error("repositoryPath must be a directory.");
    }
    rootRealPath = realpathSync(repositoryPath);
  } catch (error) {
    const message =
      error && typeof error === "object" && "code" in error && error.code === "ENOENT"
        ? "Repository path does not exist."
        : error instanceof Error
          ? error.message
          : "Repository path could not be read.";
    throw new HarnessScannerError("invalid_repository_path", message);
  }

  const limits: HarnessScanLimits = {
    maxFiles,
    maxBytes,
    maxFileSizeBytes,
    filesScanned: 0,
    bytesRead: 0,
    truncated: false,
  };

  const stack = [rootRealPath];
  while (stack.length > 0) {
    if (limits.filesScanned >= maxFiles || limits.bytesRead >= maxBytes) {
      limits.truncated = true;
      warnings.push("Scan limits were reached before the full repository tree was inspected.");
      break;
    }

    const current = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current).sort();
    } catch (error) {
      warnings.push(`Could not read directory ${toRepoPath(rootRealPath, current)}: ${safeError(error)}`);
      continue;
    }

    for (const entry of entries) {
      if (limits.filesScanned >= maxFiles || limits.bytesRead >= maxBytes) {
        limits.truncated = true;
        warnings.push("Scan limits were reached before the full repository tree was inspected.");
        break;
      }

      const absolutePath = join(current, entry);
      const relativePath = toRepoPath(rootRealPath, absolutePath);
      if (relativePath === "") continue;

      let stats;
      try {
        stats = lstatSync(absolutePath);
      } catch (error) {
        warnings.push(`Could not inspect ${relativePath}: ${safeError(error)}`);
        continue;
      }

      if (stats.isSymbolicLink()) {
        try {
          const target = realpathSync(absolutePath);
          if (!isInside(rootRealPath, target)) {
            warnings.push(`Skipped symlink escape at ${relativePath}.`);
            continue;
          }
        } catch {
          warnings.push(`Skipped unreadable symlink at ${relativePath}.`);
          continue;
        }
      }

      if (stats.isDirectory()) {
        if (ignoredDirectories.has(entry)) continue;
        stack.push(absolutePath);
        continue;
      }

      if (!stats.isFile()) continue;
      limits.filesScanned += 1;
      const kind = classifyFile(relativePath);
      const hash = stats.size <= maxFileSizeBytes ? hashFile(absolutePath) : null;
      const detected: HarnessFileRecord = {
        path: relativePath,
        kind,
        exists: true,
        sizeBytes: stats.size,
        hash,
        summary: summarizeFile(relativePath, kind, stats.size),
        absolutePath,
        content: null,
        lineCount: null,
        skippedReason: null,
      };

      if (stats.size > maxFileSizeBytes) {
        detected.skippedReason = "file_too_large";
        detected.summary = `${detected.summary}; content skipped because it exceeds ${maxFileSizeBytes} bytes`;
        warnings.push(`Skipped large file content for ${relativePath}.`);
      } else if (limits.bytesRead + stats.size > maxBytes) {
        detected.skippedReason = "scan_byte_limit";
        limits.truncated = true;
        warnings.push(`Skipped ${relativePath} because scan byte limit was reached.`);
      } else if (isSecretLookingPath(relativePath)) {
        detected.skippedReason = "secret_looking_path";
        detected.summary = `${detected.summary}; content intentionally not read because the path looks secret-bearing`;
      } else if (isReadableTextPath(relativePath)) {
        try {
          const content = readFileSync(absolutePath, "utf8");
          if (content.includes("\u0000")) {
            detected.skippedReason = "binary_file";
          } else {
            limits.bytesRead += Buffer.byteLength(content);
            detected.content = content;
            detected.lineCount = content.split(/\r?\n/u).length;
          }
        } catch (error) {
          detected.skippedReason = "read_failed";
          warnings.push(`Could not read ${relativePath}: ${safeError(error)}`);
        }
      } else {
        detected.skippedReason = "non_text_file";
      }

      files.set(relativePath, detected);
    }
  }

  ensureExpectedMissingFiles(files, input);
  const metadata = detectMetadata(rootRealPath, files, input);
  return {
    id: options.id ?? `scan-${randomUUID()}`,
    repositoryPath: rootRealPath,
    scannedAt,
    request: input,
    files,
    warnings,
    errors,
    metadata,
    limits,
  };
}

export function getHarnessFile(context: HarnessScanContext, path: string): HarnessFileRecord | null {
  return context.files.get(normalizeRepoPath(path)) ?? null;
}

export function hasHarnessFile(context: HarnessScanContext, path: string): boolean {
  return Boolean(getHarnessFile(context, path)?.exists);
}

export function findHarnessLine(file: HarnessFileRecord | null, pattern: RegExp): number | null {
  if (!file?.content) return null;
  const lines = file.content.split(/\r?\n/u);
  const index = lines.findIndex((line) => pattern.test(line));
  return index >= 0 ? index + 1 : null;
}

export function listFilesByPrefix(context: HarnessScanContext, prefix: string): HarnessFileRecord[] {
  const normalized = normalizeRepoPath(prefix);
  return [...context.files.values()].filter((file) => file.exists && file.path.startsWith(normalized));
}

export function readPackageJson(context: HarnessScanContext): Record<string, unknown> | null {
  const file = getHarnessFile(context, "package.json");
  if (!file?.content) return null;
  try {
    return JSON.parse(file.content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isSecretLookingPath(path: string): boolean {
  const lower = path.toLowerCase();
  const name = basename(lower);
  if (name === ".env.example" || name === ".env.sample" || name.endsWith(".example")) return false;
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    name.includes("secret") ||
    name.includes("credentials") ||
    name.includes("token") ||
    name === "id_rsa" ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    name.endsWith(".p12") ||
    name.endsWith(".pfx")
  );
}

function detectMetadata(
  rootRealPath: string,
  files: Map<string, HarnessFileRecord>,
  request: HarnessScanRequest,
): HarnessRepositoryMetadata {
  const packageJsonFiles = [...files.values()].filter((file) => basename(file.path) === "package.json" && file.content);
  const parsedPackages = packageJsonFiles
    .map((file) => ({ file, parsed: safeJson(file.content ?? "") }))
    .filter((item): item is { file: HarnessFileRecord; parsed: Record<string, unknown> } => Boolean(item.parsed));
  const parsedPackage = parsedPackages.find((item) => item.file.path === "package.json")?.parsed ?? null;
  const deps = new Set<string>();
  for (const item of parsedPackages) {
    for (const dep of dependencyNames(item.parsed)) deps.add(dep);
  }
  const scripts = parsedPackage && typeof parsedPackage.scripts === "object" && parsedPackage.scripts
    ? (parsedPackage.scripts as Record<string, unknown>)
    : {};
  const git = request.includeGitStatus ? detectGit(rootRealPath) : null;
  const languages = new Set<string>();
  const frameworks = new Set<string>();

  for (const path of files.keys()) {
    const lower = path.toLowerCase();
    if (lower.endsWith(".ts") || lower.endsWith(".tsx")) languages.add("TypeScript");
    if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) languages.add("JavaScript");
    if (lower.endsWith(".py")) languages.add("Python");
    if (lower.endsWith(".go") || lower === "go.mod") languages.add("Go");
    if (lower.endsWith(".rs") || lower === "cargo.toml") languages.add("Rust");
    if (lower.endsWith("package.json")) languages.add("Node");
    if (lower.endsWith("pyproject.toml")) languages.add("Python");
    if (/next\.config\.(mjs|js|ts)$/u.test(lower)) frameworks.add("Next.js");
    if (/vite\.config\.(mjs|js|ts)$/u.test(lower)) frameworks.add("Vite");
  }

  if (deps.has("next")) frameworks.add("Next.js");
  if (deps.has("vite")) frameworks.add("Vite");
  if (deps.has("react") || deps.has("react-dom")) frameworks.add("React");
  if (files.has("package.json")) frameworks.add("Node");
  if (files.has("pyproject.toml")) frameworks.add("Python");
  if (files.has("go.mod")) frameworks.add("Go");
  if (files.has("Cargo.toml")) frameworks.add("Rust");

  const validationCommands = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== "string") continue;
    if (/(test|lint|build|check|typecheck|verify|smoke)/iu.test(name)) {
      validationCommands.push({
        id: `package-${name}`,
        label: `package script ${name}`,
        command: packageManagerCommand(detectPackageManager(files), name),
        source: "package.json" as const,
        filePath: "package.json",
      });
    }
  }

  for (const script of ["scripts/check", "scripts/check.sh", "scripts/test", "scripts/test.sh", "scripts/lint", "scripts/lint.sh"]) {
    if (files.get(script)?.exists) {
      validationCommands.push({
        id: `script-${script.replace(/\W+/gu, "-")}`,
        label: script,
        command: script.endsWith(".sh") ? `sh ${script}` : `sh ${script}`,
        source: "script" as const,
        filePath: script,
      });
    }
  }

  const makefile = files.get("Makefile") ?? files.get("makefile");
  if (makefile?.content) {
    for (const target of [...makefile.content.matchAll(/^([A-Za-z0-9_.-]+):/gmu)].map((match) => match[1]!).sort()) {
      if (/(test|lint|build|check|verify|smoke)/iu.test(target)) {
        validationCommands.push({
          id: `make-${target}`,
          label: `make ${target}`,
          command: `make ${target}`,
          source: "makefile" as const,
          filePath: makefile.path,
        });
      }
    }
  }

  for (const file of [...files.values()].filter((item) => item.path.startsWith(".github/workflows/"))) {
    if (file.content && /(pnpm|npm|yarn|bun|cargo|go|pytest|vitest|eslint|tsc|test|lint|build)/iu.test(file.content)) {
      validationCommands.push({
        id: `ci-${file.path.replace(/\W+/gu, "-")}`,
        label: `CI workflow ${file.path}`,
        command: "CI workflow",
        source: "ci" as const,
        filePath: file.path,
      });
    }
  }

  return {
    isGitRepository: git?.isGitRepository ?? files.has(".git"),
    gitDirty: git?.dirty ?? null,
    gitBranch: git?.branch ?? null,
    gitRemote: git?.remote ?? null,
    packageManager: detectPackageManager(files),
    languages: [...languages].sort(),
    frameworks: [...frameworks].sort(),
    validationCommands: dedupeValidationCommands(validationCommands),
  };
}

function detectGit(root: string): { isGitRepository: boolean; dirty: boolean | null; branch: string | null; remote: string | null } {
  const status = spawnSync("git", ["-C", root, "status", "--short", "--branch"], {
    encoding: "utf8",
    timeout: 3_000,
  });
  if (status.status !== 0) {
    return { isGitRepository: false, dirty: null, branch: null, remote: null };
  }
  const output = status.stdout.trim();
  const branchLine = output.split(/\r?\n/u)[0] ?? "";
  const branch = branchLine.replace(/^##\s+/u, "").split("...")[0]?.trim() || null;
  const dirty = output.split(/\r?\n/u).slice(1).some(Boolean);
  const remote = spawnSync("git", ["-C", root, "remote", "get-url", "origin"], {
    encoding: "utf8",
    timeout: 3_000,
  });
  return {
    isGitRepository: true,
    dirty,
    branch,
    remote: remote.status === 0 ? remote.stdout.trim() || null : null,
  };
}

function detectPackageManager(files: Map<string, HarnessFileRecord>): string | null {
  if (files.has("pnpm-lock.yaml") || files.has("pnpm-workspace.yaml")) return "pnpm";
  if (files.has("yarn.lock")) return "yarn";
  if (files.has("package-lock.json")) return "npm";
  if (files.has("bun.lock") || files.has("bun.lockb")) return "bun";
  if (files.has("package.json")) return "npm";
  if (files.has("Cargo.toml")) return "cargo";
  if (files.has("go.mod")) return "go";
  if (files.has("pyproject.toml")) return "python";
  return null;
}

function packageManagerCommand(manager: string | null, script: string): string {
  if (manager === "pnpm") return `pnpm ${script}`;
  if (manager === "yarn") return `yarn ${script}`;
  if (manager === "bun") return `bun run ${script}`;
  return `npm run ${script}`;
}

function dedupeValidationCommands(commands: HarnessRepositoryMetadata["validationCommands"]): HarnessRepositoryMetadata["validationCommands"] {
  const seen = new Set<string>();
  return commands.filter((command) => {
    const key = `${command.command}:${command.filePath ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ensureExpectedMissingFiles(files: Map<string, HarnessFileRecord>, request: HarnessScanRequest): void {
  const expected = [
    request.includeAgentsMd ? "AGENTS.md" : null,
    request.includeWorkflow ? "WORKFLOW.md" : null,
    request.includeDocs ? "README.md" : null,
    request.includeDocs ? "docs/ARCHITECTURE.md" : null,
    request.includeDocs ? "docs/TESTING.md" : null,
    request.includeSecurity ? "docs/SECURITY.md" : null,
    request.includeScripts ? "scripts/check" : null,
    request.includeScripts ? "scripts/test" : null,
    request.includeScripts ? "scripts/lint" : null,
    request.includeCi ? ".github/workflows/ci.yml" : null,
  ].filter((value): value is string => Boolean(value));

  for (const path of expected) {
    if (files.has(path)) continue;
    files.set(path, {
      path,
      kind: classifyFile(path),
      exists: false,
      sizeBytes: null,
      hash: null,
      summary: "Missing expected harness file.",
      absolutePath: "",
      content: null,
      lineCount: null,
      skippedReason: "missing",
    });
  }
}

function classifyFile(path: string): string {
  for (const [pattern, kind] of harnessFileKinds) {
    if (pattern.test(path)) return kind;
  }
  if (isSecretLookingPath(path)) return "secret-looking";
  return "file";
}

function summarizeFile(path: string, kind: string, sizeBytes: number): string {
  return `${kind} file ${path} (${sizeBytes} bytes)`;
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function safeJson(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function dependencyNames(packageJson: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const value = packageJson[key];
    if (value && typeof value === "object") {
      for (const dep of Object.keys(value)) names.add(dep);
    }
  }
  return names;
}

function isReadableTextPath(path: string): boolean {
  const name = basename(path);
  if (name === "Makefile" || name === "Dockerfile" || name === ".gitignore") return true;
  const extension = extensionWithDot(path);
  return textExtensions.has(extension);
}

function extensionWithDot(path: string): string {
  const name = basename(path);
  if (name.startsWith(".") && !name.slice(1).includes(".")) return name;
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function toRepoPath(root: string, path: string): string {
  return normalizeRepoPath(relative(root, path));
}

function normalizeRepoPath(path: string): string {
  return path.split(sep).join("/").replace(/^\.\//u, "");
}

function isInside(root: string, child: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedChild = resolve(child);
  return resolvedChild === resolvedRoot || resolvedChild.startsWith(`${resolvedRoot}${sep}`);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class HarnessScannerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HarnessScannerError";
  }
}
