import { HarnessArtifactPreview } from "@symphonia/types";
import type { HarnessScoringResult } from "./harness-scoring.js";
import type { HarnessFileRecord, HarnessScanContext } from "./harness-scanner.js";

type ArtifactSpec = {
  id: string;
  kind: HarnessArtifactPreview["kind"];
  path: string;
  content: string;
  executable?: boolean;
};

export function generateHarnessPreviews(
  context: HarnessScanContext,
  _scoring?: HarnessScoringResult,
): HarnessArtifactPreview[] {
  const specs = artifactSpecs(context);
  return specs.map((spec) => previewFor(context, spec));
}

function artifactSpecs(context: HarnessScanContext): ArtifactSpec[] {
  const frontend = context.metadata.frameworks.some((framework) => ["React", "Next.js", "Vite"].includes(framework));
  const backend = context.metadata.languages.some((language) => ["Node", "Python", "Go", "Rust"].includes(language));
  const specs: ArtifactSpec[] = [
    { id: "agents-md", kind: "AGENTS.md", path: "AGENTS.md", content: agentsMd(context) },
    { id: "workflow-md", kind: "WORKFLOW.md", path: "WORKFLOW.md", content: workflowMd(context) },
    { id: "docs-architecture", kind: "doc", path: "docs/ARCHITECTURE.md", content: architectureDoc(context) },
    { id: "docs-testing", kind: "doc", path: "docs/TESTING.md", content: testingDoc(context) },
    { id: "docs-security", kind: "doc", path: "docs/SECURITY.md", content: securityDoc(context) },
    { id: "docs-operations", kind: "doc", path: "docs/OPERATIONS.md", content: operationsDoc(context) },
    { id: "docs-harness", kind: "doc", path: "docs/HARNESS.md", content: harnessDoc(context) },
    { id: "scripts-check", kind: "script", path: "scripts/check", content: scriptDoc(context, "check"), executable: true },
    { id: "scripts-test", kind: "script", path: "scripts/test", content: scriptDoc(context, "test"), executable: true },
    { id: "scripts-lint", kind: "script", path: "scripts/lint", content: scriptDoc(context, "lint"), executable: true },
    { id: "skills-readme", kind: "skill", path: "skills/README.md", content: skillsReadme(context) },
  ];

  if (frontend) specs.splice(4, 0, { id: "docs-frontend", kind: "doc", path: "docs/FRONTEND.md", content: frontendDoc(context) });
  if (backend) specs.splice(frontend ? 5 : 4, 0, { id: "docs-backend", kind: "doc", path: "docs/BACKEND.md", content: backendDoc(context) });
  if (!hasFile(context, ".env.example")) specs.push({ id: "env-example", kind: "config", path: ".env.example", content: envExample(context) });

  return specs;
}

function previewFor(context: HarnessScanContext, spec: ArtifactSpec): HarnessArtifactPreview {
  const existing = context.files.get(spec.path);
  const exists = Boolean(existing?.exists);
  const action = decideAction(spec, existing);
  const warnings = [
    "Generated content is starter/inferred. Review before applying.",
    ...(action === "manual" ? ["Existing content requires manual merge; apply will skip this artifact."] : []),
  ];

  return {
    id: spec.id,
    kind: spec.kind,
    path: spec.path,
    action,
    existingContentHash: existing?.hash ?? null,
    proposedContent: spec.content,
    diff: buildDiff(spec.path, exists ? existing?.content ?? "" : null, spec.content, action),
    warnings,
    requiresConfirmation: action === "create" || action === "update" || action === "manual",
  };
}

function decideAction(spec: ArtifactSpec, existing: HarnessFileRecord | undefined): HarnessArtifactPreview["action"] {
  if (!existing?.exists) return "create";
  if (spec.path === ".env.example") return "skip";
  if (spec.path === "WORKFLOW.md") return "manual";
  if (spec.path.startsWith("docs/")) return "manual";
  if (spec.path === "AGENTS.md" && (existing.lineCount ?? 0) > 220) return "manual";
  if (spec.path === "skills/README.md") return "manual";
  return "update";
}

function agentsMd(context: HarnessScanContext): string {
  const checks = commandLines(context, /(check|verify|smoke|test|lint|build)/iu);
  const overview = hasFile(context, "README.md") ? "Read README.md first for the project overview." : "No README.md was detected; verify the project purpose before relying on this map.";
  return `# AGENTS.md

Generated starter map. Verify before relying on this.

## Repository Map

- Overview: ${overview}
- Deeper docs: start with docs/HARNESS.md, docs/ARCHITECTURE.md, docs/TESTING.md, and docs/SECURITY.md when they exist.
- Workflow: use WORKFLOW.md for Symphonia run settings and prompt shape.
- Package manager: ${context.metadata.packageManager ?? "unknown; verify before running commands"}.
- Languages: ${context.metadata.languages.join(", ") || "unknown"}.
- Frameworks: ${context.metadata.frameworks.join(", ") || "unknown"}.

## Checks

${checks.length > 0 ? checks.map((command) => `- \`${command}\``).join("\n") : "- No validation command was detected. Ask a maintainer or inspect package scripts before changing code."}

## Safety

- Do not write secrets to files, logs, events, diagnostics, or generated docs.
- Treat generated docs in this repository as starter/inferred until reviewed.
- Do not run destructive cleanup or delete commands unless the task explicitly requires it and the workflow gates it.

## Review

- Summarize changed files, commands run, command results, and any remaining risk.
- Prefer small, reviewable changes with evidence-backed validation.
`;
}

function workflowMd(context: HarnessScanContext): string {
  return `---
provider: codex

tracker:
  kind: linear
  api_key: "$LINEAR_API_KEY"
  allow_workspace_wide: true
  read_only: true
  active_states:
    - "Todo"
    - "In Progress"
    - "Backlog"
  terminal_states:
    - "Done"
    - "Closed"
    - "Canceled"
    - "Duplicate"

workspace:
  root: ".symphonia/workspaces"
  cleanup:
    enabled: false
    dry_run: true
    require_manual_confirmation: true
    protect_active: true
    protect_recent_runs_ms: 86400000
    protect_dirty_git: true

hooks:
  timeout_ms: 30000
  after_create: |
    printf "Workspace created at $(pwd)\\n"
  before_run: |
    printf "Preparing provider run in $(pwd)\\n"
  after_run: |
    printf "Finished provider run in $(pwd)\\n"
---

You are working on issue {{ issue.identifier }}.

Title:
{{ issue.title }}

Description:
{{ issue.description }}

State:
{{ issue.state }}

Labels:
{{ issue.labels }}

Instructions:
1. Read AGENTS.md first if it exists.
2. Inspect README.md and docs/HARNESS.md for starter context.
3. Make the smallest correct change.
4. Run the relevant validation command.
5. Report changed files, command results, and remaining risk.
6. If blocked, explain exactly what information is missing.

Detected validation commands at generation time:
${commandLines(context, /(check|verify|smoke|test|lint|build)/iu).map((command) => `- ${command}`).join("\n") || "- No validation command was detected; verify before relying on this workflow."}
`;
}

function architectureDoc(context: HarnessScanContext): string {
  return doc("Architecture", context, [
    `Detected languages: ${context.metadata.languages.join(", ") || "unknown"}.`,
    `Detected frameworks: ${context.metadata.frameworks.join(", ") || "unknown"}.`,
    hasFile(context, "package.json") ? "package.json exists and should be reviewed for workspace/package boundaries." : "No package.json was detected.",
    hasFile(context, "WORKFLOW.md") ? "WORKFLOW.md exists and may describe local agent runtime behavior." : "No WORKFLOW.md was detected.",
  ]);
}

function testingDoc(context: HarnessScanContext): string {
  return doc("Testing", context, [
    "Use this as a starter checklist. Replace inferred commands with project-approved commands.",
    ...commandLines(context, /(test|lint|build|check|verify|smoke)/iu).map((command) => `Detected command: ${command}`),
    commandLines(context, /(test|lint|build|check|verify|smoke)/iu).length === 0
      ? "No validation commands were detected. Fill in the test, lint, and build commands before relying on this document."
      : "Run the smallest relevant command first, then broaden validation for shared behavior.",
  ]);
}

function frontendDoc(context: HarnessScanContext): string {
  return doc("Frontend", context, [
    "Generated because React, Next.js, or Vite was detected.",
    "Verify route structure, state management, styling conventions, and accessibility expectations.",
    "For UI changes, check keyboard reachability, visible focus, readable loading/error states, and responsive layout.",
  ]);
}

function backendDoc(context: HarnessScanContext): string {
  return doc("Backend", context, [
    "Generated because a backend/runtime language marker was detected.",
    "Verify service boundaries, storage, migrations, background jobs, and API contracts before relying on this document.",
    "Document local development commands, test data, and rollback or recovery expectations here.",
  ]);
}

function securityDoc(context: HarnessScanContext): string {
  return doc("Security", context, [
    "Do not commit secret values. Use environment variable names and .env.example placeholders only.",
    hasFile(context, ".gitignore") ? ".gitignore exists; verify it ignores local env files and generated output." : ".gitignore was not detected; add one before storing local config.",
    "Review generated docs and scripts before applying them. They are inferred from repository evidence.",
  ]);
}

function operationsDoc(context: HarnessScanContext): string {
  return doc("Operations", context, [
    "Record local run, diagnostics, logging, troubleshooting, and recovery steps here.",
    "When a run fails, capture the command, exit code, relevant logs, and reproduction steps.",
    context.metadata.isGitRepository ? "Git repository detected; include branch and dirty-state checks in handoffs." : "Git repository was not detected in the scan.",
  ]);
}

function harnessDoc(context: HarnessScanContext): string {
  return doc("Harness", context, [
    "This file tracks agent-readiness assumptions and verification tasks.",
    `Latest generated scan path: ${context.repositoryPath}.`,
    `Package manager hint: ${context.metadata.packageManager ?? "unknown"}.`,
    "Keep AGENTS.md short. Move detailed instructions into docs files and scripts.",
    "After editing harness files, re-run the readiness scan and project validation commands.",
  ]);
}

function skillsReadme(context: HarnessScanContext): string {
  return doc("Skills", context, [
    "Place repo-local skill documentation here only after a real reusable workflow exists.",
    "Do not add credentials or private runtime details to skill files.",
    `Detected frameworks: ${context.metadata.frameworks.join(", ") || "unknown"}.`,
  ]);
}

function envExample(_context: HarnessScanContext): string {
  return `# Generated starter. Add environment variable names only; never add real secret values.

# EXAMPLE_API_KEY=
`;
}

function scriptDoc(context: HarnessScanContext, kind: "check" | "test" | "lint"): string {
  const pattern = kind === "check" ? /(check|verify|smoke|test|lint|build)/iu : new RegExp(kind, "iu");
  const commands = commandLines(context, pattern);
  if (commands.length === 0) {
    return `#!/bin/sh
set -eu
echo "No ${kind} command was detected. Fill in scripts/${kind} before relying on it." >&2
exit 1
`;
  }
  return `#!/bin/sh
set -eu
${commands.map((command) => `${command}`).join("\n")}
`;
}

function doc(title: string, context: HarnessScanContext, bullets: string[]): string {
  return `# ${title}

Generated starter/inferred documentation. Verify before relying on this.

## Evidence

${bullets.map((item) => `- ${item}`).join("\n")}

## To Verify

- Confirm the project architecture and ownership boundaries.
- Confirm the validation commands and expected runtimes.
- Confirm generated assumptions with a maintainer before treating them as policy.

## Agent Notes

- Keep AGENTS.md as a short map and link here for deeper detail.
- Prefer deterministic checks over prose-only instructions.
- Do not include secrets, customer data, or private runtime output in this document.
`;
}

function commandLines(context: HarnessScanContext, pattern: RegExp): string[] {
  return context.metadata.validationCommands
    .filter((command) => pattern.test(command.command) || pattern.test(command.label))
    .map((command) => command.command)
    .filter((command, index, array) => array.indexOf(command) === index)
    .slice(0, 8);
}

function hasFile(context: HarnessScanContext, path: string): boolean {
  return Boolean(context.files.get(path)?.exists);
}

function buildDiff(path: string, existingContent: string | null, proposedContent: string, action: HarnessArtifactPreview["action"]): string {
  if (action === "skip") return `No changes proposed for ${path}.`;
  if (action === "manual") {
    return `Manual merge required for ${path}.\n\n${createDiff(path, existingContent, proposedContent)}`;
  }
  return createDiff(path, existingContent, proposedContent);
}

function createDiff(path: string, existingContent: string | null, proposedContent: string): string {
  const oldLines = existingContent === null ? [] : existingContent.split(/\r?\n/u);
  const newLines = proposedContent.split(/\r?\n/u);
  const oldHeader = existingContent === null ? "/dev/null" : `a/${path}`;
  const body = [
    `--- ${oldHeader}`,
    `+++ b/${path}`,
    "@@",
    ...oldLines.slice(0, 120).map((line) => `-${line}`),
    ...newLines.slice(0, 160).map((line) => `+${line}`),
  ];
  if (oldLines.length > 120 || newLines.length > 160) body.push("... diff preview truncated ...");
  return body.join("\n").slice(0, 60_000);
}
