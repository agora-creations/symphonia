#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultOut = resolve(appRoot, "out");
const currentFile = fileURLToPath(import.meta.url);

const deniedPathRules = [
  { name: "environment file", pattern: /(^|\/)\.env($|[./])/iu },
  { name: "workspace/runtime data", pattern: /(^|\/)\.symphonia($|\/)/iu },
  { name: "daemon data directory", pattern: /(^|\/)\.data($|\/)/iu },
  { name: "SQLite database", pattern: /\.sqlite(?:-shm|-wal)?$/iu },
  { name: "settings or token store", pattern: /(^|\/)[^/]*(?:auth|token|settings)[^/]*\.json(?:\.key)?$/iu },
  { name: "logs", pattern: /(^|\/)logs?($|\/)|\.log$/iu },
  { name: "coverage output", pattern: /(^|\/)coverage($|\/)/iu },
  { name: "test or fixture file", pattern: /(^|\/)(?:test|tests|__tests__|fixtures)($|\/)|\.(?:test|spec)\.[cm]?[jt]sx?$/iu },
  { name: "desktop staging directory", pattern: /(^|\/)\.desktop-package($|\/)/iu },
  { name: "package-manager cache", pattern: /(^|\/)(?:\.pnpm-store|\.cache)($|\/)/iu },
];

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  try {
    const target = resolve(process.argv[2] ?? defaultOut);
    const report = inspectArtifact(target);
    printReport(report);
    if (report.failures.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`[artifact-inspect] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

export function inspectArtifact(rootPath) {
  if (!existsSync(rootPath)) {
    throw new Error(`Artifact path does not exist: ${rootPath}`);
  }

  const actualFiles = [];
  const asarFiles = [];
  const failures = [];
  const warnings = [];
  let totalBytes = 0;

  for (const file of walkFiles(rootPath)) {
    const relativePath = normalizePath(relative(rootPath, file));
    actualFiles.push(relativePath);
    totalBytes += statSync(file).size;
    checkDeniedPath(relativePath, "file", failures);

    if (relativePath.endsWith(".asar")) {
      try {
        for (const virtualPath of listAsarFiles(file)) {
          const asarPath = `${relativePath}:${virtualPath}`;
          asarFiles.push(asarPath);
          checkDeniedPath(virtualPath, `asar ${relativePath}`, failures);
        }
      } catch (error) {
        warnings.push(`Could not inspect ASAR ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const hasMacApp = actualFiles.some((file) => file.endsWith(".app/Contents/Info.plist"));
  const hasMacBinary = actualFiles.some((file) => file.endsWith(".app/Contents/MacOS/Symphonia"));
  const hasAsar = actualFiles.some((file) => file.endsWith(".app/Contents/Resources/app.asar") || file.endsWith("/resources/app.asar") || file.endsWith("app.asar"));
  const hasPackageMetadata =
    actualFiles.some((file) => file.endsWith("package.json")) ||
    asarFiles.some((file) => file.endsWith(":package.json") || file.endsWith("/package.json"));

  if (!hasMacApp && !hasPackageMetadata) {
    failures.push("No app metadata found: expected macOS Info.plist or package.json.");
  }
  if (!hasMacBinary) {
    warnings.push("No macOS Symphonia binary found; this is acceptable only for non-macOS artifacts.");
  }
  if (!hasAsar) {
    failures.push("No app.asar found in package resources.");
  }

  return {
    rootPath,
    actualFileCount: actualFiles.length,
    asarFileCount: asarFiles.length,
    totalBytes,
    failures,
    warnings,
    hasMacApp,
    hasMacBinary,
    hasAsar,
  };
}

function* walkFiles(root) {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    const info = lstatSync(entryPath);
    if (info.isSymbolicLink()) {
      yield entryPath;
      continue;
    }
    if (entry.isDirectory()) {
      yield* walkFiles(entryPath);
    } else if (entry.isFile()) {
      yield entryPath;
    }
  }
}

function checkDeniedPath(pathValue, source, failures) {
  const normalized = normalizePath(pathValue);
  for (const rule of deniedPathRules) {
    if (rule.pattern.test(normalized)) {
      failures.push(`Denied ${rule.name} in ${source}: ${normalized}`);
    }
  }
}

function listAsarFiles(asarPath) {
  const bytes = readFileSync(asarPath);
  if (bytes.length < 16) throw new Error("ASAR header is truncated.");
  const headerJsonLength = bytes.readUInt32LE(12);
  if (headerJsonLength <= 0 || 16 + headerJsonLength > bytes.length) {
    throw new Error("ASAR header length is invalid.");
  }
  const header = JSON.parse(bytes.subarray(16, 16 + headerJsonLength).toString("utf8"));
  const files = [];
  collectAsarFiles("", header, files);
  return files;
}

function collectAsarFiles(prefix, node, files) {
  if (!node || typeof node !== "object") return;
  if (node.files && typeof node.files === "object") {
    for (const [name, child] of Object.entries(node.files)) {
      collectAsarFiles(prefix ? `${prefix}/${name}` : name, child, files);
    }
    return;
  }
  if (prefix) files.push(prefix);
}

function printReport(report) {
  console.log(`[artifact-inspect] path: ${report.rootPath}`);
  console.log(`[artifact-inspect] files: ${report.actualFileCount} physical, ${report.asarFileCount} asar`);
  console.log(`[artifact-inspect] size: ${formatBytes(report.totalBytes)}`);
  console.log(`[artifact-inspect] metadata: macApp=${String(report.hasMacApp)} macBinary=${String(report.hasMacBinary)} asar=${String(report.hasAsar)}`);
  for (const warning of report.warnings) {
    console.log(`[artifact-inspect] warning: ${warning}`);
  }
  for (const failure of report.failures) {
    console.error(`[artifact-inspect] failure: ${failure}`);
  }
  if (report.failures.length === 0) {
    console.log("[artifact-inspect] package exclusions passed");
  }
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

function normalizePath(pathValue) {
  return pathValue.split(sep).join("/").replace(/^\/+/, "");
}
