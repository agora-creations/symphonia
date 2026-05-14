#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const version = normalizeVersion(process.argv[2] || packageJson.version || "0.1.0");
const commit = safeExec("git rev-parse --short HEAD") ?? "unknown";
const date = new Date().toISOString().slice(0, 10);

console.log(`# Symphonia ${version}`);
console.log("");
console.log(`Date: ${date}`);
console.log(`Commit: ${commit}`);
console.log("");
console.log("## Validation");
console.log("");
console.log("- `pnpm validate`");
console.log("- `pnpm validate:packaging`");
console.log("- `pnpm desktop:inspect-artifact`");
console.log("");
console.log("## Packaging");
console.log("");
console.log("- Desktop package artifacts are inspected before upload.");
console.log("- Runtime data, local settings, auth token stores, SQLite databases, logs, coverage, and `.env` files are excluded.");
console.log("");
console.log("## Release Notes");
console.log("");
console.log("- Fill in product-facing changes before publishing.");
console.log("- Keep GitHub and Linear writes disabled unless the workflow is explicitly configured and confirmed.");
console.log("");
console.log("## Deferred");
console.log("");
console.log("- Code signing and notarization.");
console.log("- Auto-update feeds.");
console.log("- Cross-platform packaging beyond the currently validated host package.");

function normalizeVersion(value) {
  return value.startsWith("v") ? value : `v${value}`;
}

function safeExec(command) {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
