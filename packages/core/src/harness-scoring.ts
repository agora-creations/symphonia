import {
  HarnessCategory,
  HarnessCategoryScore,
  HarnessCategoryStatus,
  HarnessEvidence,
  HarnessFinding,
  HarnessRecommendation,
  HarnessScore,
} from "@symphonia/types";
import type { HarnessFileRecord, HarnessScanContext } from "./harness-scanner.js";

export type HarnessScoringResult = {
  score: HarnessScore;
  categories: HarnessCategory[];
  findings: HarnessFinding[];
  recommendations: HarnessRecommendation[];
};

type CategoryDraft = {
  id: string;
  label: string;
  max: number;
  score: number;
  evidence: HarnessEvidence[];
  findings: HarnessFinding[];
  recommendations: HarnessRecommendation[];
  summary: string;
};

export function scoreHarnessContext(context: HarnessScanContext): HarnessScoringResult {
  const drafts = [
    scoreRepositoryMap(context),
    scoreWorkflowContract(context),
    scoreValidationLoop(context),
    scoreDocumentationSystem(context),
    scoreSafetyAndSecrets(context),
    scoreProviderReadiness(context),
    scoreReviewReadiness(context),
    scoreObservability(context),
    scoreAccessibility(context),
    scoreSymphoniaCompatibility(context),
  ];

  const categories = drafts.map(finalizeCategory);
  const findings = drafts.flatMap((draft) => draft.findings);
  const recommendations = dedupeRecommendations(drafts.flatMap((draft) => draft.recommendations));
  const max = categories.reduce((sum, category) => sum + category.max, 0);
  const overall = categories.reduce((sum, category) => sum + category.score, 0);
  const percentage = Math.round((overall / max) * 100);
  const categoryScores = Object.fromEntries(
    categories.map((category) => [
      category.id,
      {
        score: category.score,
        max: category.max,
        percentage: Math.round((category.score / category.max) * 100),
        grade: gradeFor(Math.round((category.score / category.max) * 100)),
        status: category.status,
      } satisfies HarnessCategoryScore,
    ]),
  );

  return {
    score: {
      overall,
      max,
      percentage,
      grade: gradeFor(percentage),
      categoryScores,
    },
    categories,
    findings,
    recommendations,
  };
}

function scoreRepositoryMap(context: HarnessScanContext): CategoryDraft {
  const draft = createDraft("repository-map", "Repository Map");
  const readme = file(context, "README.md");
  const agents = file(context, "AGENTS.md");
  const docsIndex = file(context, "docs/README.md") ?? file(context, "docs/HARNESS.md");

  if (readme?.exists) {
    addPoints(draft, 3, evidence("README.md", "README.md exists.", "README.md"));
    addFinding(draft, "readme-present", "info", "present", "README is present", "A top-level README gives agents a starting point.", [
      evidence("README.md", "Found top-level README.", "README.md"),
    ]);
  } else {
    addFinding(draft, "readme-missing", "high", "missing", "README is missing", "Agents lack a top-level project overview.", []);
    addRecommendation(draft, "add-readme", "high", "Add a README overview", "Create a short README before relying on agent runs.", [
      artifact("doc", "README.md", "manual"),
    ]);
  }

  if (agents?.exists) {
    addPoints(draft, 3, evidence("AGENTS.md", "AGENTS.md exists.", "AGENTS.md"));
    const lineCount = agents.lineCount ?? 0;
    if (lineCount > 0 && lineCount <= 180) {
      addPoints(draft, 1, evidence("AGENTS.md length", `${lineCount} lines; concise enough to be a map.`, "AGENTS.md"));
    } else if (lineCount > 180) {
      addFinding(draft, "agents-giant", "medium", "weak", "AGENTS.md is too long", "AGENTS.md should be a short map with links to deeper docs.", [
        evidence("AGENTS.md length", `${lineCount} lines.`, "AGENTS.md"),
      ]);
      addRecommendation(draft, "shorten-agents-map", "medium", "Shorten AGENTS.md into a map", "Move deep instructions into repo-local docs and keep AGENTS.md scannable.", [
        artifact("AGENTS.md", "AGENTS.md", "update"),
      ]);
    }
  } else {
    addFinding(draft, "agents-missing", "high", "missing", "AGENTS.md is missing", "Coding agents do not have a repo-local instruction map.", []);
    addRecommendation(draft, "create-agents-map", "high", "Create a short AGENTS.md map", "A concise map helps agents find docs, checks, conventions, and safety notes.", [
      artifact("AGENTS.md", "AGENTS.md", "create"),
    ]);
  }

  if (docsIndex?.exists) {
    addPoints(draft, 3, evidence("Docs index", `${docsIndex.path} exists.`, docsIndex.path));
  } else if (dirHas(context, "docs/")) {
    addPoints(draft, 1, evidence("Docs directory", "docs/ exists but has no README or HARNESS index.", "docs/"));
    addRecommendation(draft, "add-docs-index", "medium", "Add a docs index", "A docs index lets agents navigate deeper documentation quickly.", [
      artifact("doc", "docs/HARNESS.md", "create"),
    ]);
  } else {
    addFinding(draft, "docs-index-missing", "medium", "missing", "Docs index is missing", "There is no docs/ index for deeper agent context.", []);
    addRecommendation(draft, "create-docs-harness", "medium", "Create docs/HARNESS.md", "A harness guide documents what was inferred and what humans should verify.", [
      artifact("doc", "docs/HARNESS.md", "create"),
    ]);
  }

  draft.summary = summarizeDraft(draft, "Repository has a usable top-level map.", "Repository map is incomplete.");
  return draft;
}

function scoreWorkflowContract(context: HarnessScanContext): CategoryDraft {
  const draft = createDraft("workflow-contract", "Workflow Contract");
  const workflow = file(context, "WORKFLOW.md");
  if (workflow?.exists) {
    addPoints(draft, 5, evidence("WORKFLOW.md", "WORKFLOW.md exists.", "WORKFLOW.md"));
    if (/tracker:\s*\n[\s\S]*kind:\s*linear/u.test(workflow.content ?? "")) {
      addPoints(draft, 1, evidence("Linear tracker", "Real Linear tracker configuration detected.", "WORKFLOW.md"));
    }
    if (/provider:\s*(codex|claude|cursor)/u.test(workflow.content ?? "")) {
      addPoints(draft, 1, evidence("Real provider", "Real provider configuration detected.", "WORKFLOW.md"));
    }
    if (/\{\{\s*issue\./u.test(workflow.content ?? "")) {
      addPoints(draft, 2, evidence("Prompt template", "Issue fields are referenced in the prompt template.", "WORKFLOW.md"));
    }
    if (/hooks:/u.test(workflow.content ?? "")) {
      addPoints(draft, 1, evidence("Hooks", "Workflow hook block is present.", "WORKFLOW.md"));
    }
  } else {
    addFinding(draft, "workflow-missing", "high", "missing", "WORKFLOW.md is missing", "Symphonia needs a workflow contract to run agents safely.", []);
    addRecommendation(draft, "create-workflow", "high", "Create safe WORKFLOW.md", "Use Linear plus a real provider with harmless hooks and read-only external writes.", [
      artifact("WORKFLOW.md", "WORKFLOW.md", "create"),
    ]);
  }
  draft.summary = summarizeDraft(draft, "Workflow contract is present and safe enough to start.", "Workflow contract needs stronger defaults.");
  return draft;
}

function scoreValidationLoop(context: HarnessScanContext): CategoryDraft {
  const draft = createDraft("validation-loop", "Validation Loop");
  const commands = context.metadata.validationCommands;
  const hasTest = commands.some((command) => /test/iu.test(command.command) || /test/iu.test(command.label));
  const hasLint = commands.some((command) => /lint|eslint|typecheck|tsc/iu.test(command.command) || /lint/iu.test(command.label));
  const hasBuild = commands.some((command) => /build/iu.test(command.command) || /build/iu.test(command.label));
  const hasCheck = commands.some((command) => /check|verify|smoke/iu.test(command.command) || /check|verify|smoke/iu.test(command.label));
  const hasCi = commands.some((command) => command.source === "ci");

  if (hasTest) addPoints(draft, 2, evidence("Test command", commandSummary(commands, /test/iu), "package.json"));
  else addMissingValidation(draft, "test");
  if (hasLint) addPoints(draft, 2, evidence("Lint/type command", commandSummary(commands, /lint|eslint|typecheck|tsc/iu), "package.json"));
  else addMissingValidation(draft, "lint");
  if (hasBuild) addPoints(draft, 2, evidence("Build command", commandSummary(commands, /build/iu), "package.json"));
  else addMissingValidation(draft, "build");
  if (hasCheck) addPoints(draft, 2, evidence("Check command", commandSummary(commands, /check|verify|smoke/iu), null));
  else {
    addFinding(draft, "check-missing", "medium", "missing", "No aggregate check command found", "Agents benefit from one command that runs the core validation loop.", []);
    addRecommendation(draft, "create-script-check", "high", "Create scripts/check", "A discoverable check script gives agents a single validation entry point.", [
      artifact("script", "scripts/check", "create"),
    ]);
  }
  if (hasCi) addPoints(draft, 2, evidence("CI validation", "A GitHub Actions workflow references validation commands.", ".github/workflows/"));
  else {
    addFinding(draft, "ci-missing", "medium", "missing", "No CI workflow detected", "Review readiness is weaker without CI validating core commands.", []);
  }

  draft.summary = summarizeDraft(draft, "Validation commands are discoverable.", "Validation loop is incomplete.");
  return draft;
}

function scoreDocumentationSystem(context: HarnessScanContext): CategoryDraft {
  const draft = createDraft("documentation-system", "Documentation System");
  const docs = dirHas(context, "docs/");
  if (docs) addPoints(draft, 2, evidence("docs/", "Documentation directory exists.", "docs/"));
  else addRecommendation(draft, "create-docs", "medium", "Create starter docs", "Starter docs should capture architecture, testing, security, and harness assumptions.", [
    artifact("doc", "docs/ARCHITECTURE.md", "create"),
    artifact("doc", "docs/TESTING.md", "create"),
  ]);

  for (const [path, points, title] of [
    ["docs/ARCHITECTURE.md", 2, "Architecture docs"],
    ["docs/TESTING.md", 2, "Testing docs"],
    ["docs/SECURITY.md", 1, "Security docs"],
    ["docs/HARNESS.md", 1, "Harness docs"],
  ] as const) {
    if (file(context, path)?.exists) addPoints(draft, points, evidence(title, `${path} exists.`, path));
  }
  if (context.metadata.frameworks.some((framework) => framework === "React" || framework === "Next.js" || framework === "Vite")) {
    if (file(context, "docs/FRONTEND.md")?.exists) addPoints(draft, 1, evidence("Frontend docs", "docs/FRONTEND.md exists.", "docs/FRONTEND.md"));
    else addRecommendation(draft, "create-frontend-docs", "medium", "Create frontend docs", "Frontend repos need UI validation and accessibility notes.", [
      artifact("doc", "docs/FRONTEND.md", "create"),
    ]);
  } else {
    addPoints(draft, 1, evidence("Frontend docs", "No frontend framework detected; frontend docs are optional.", null));
  }
  if (context.metadata.languages.some((language) => ["Node", "Python", "Go", "Rust"].includes(language))) {
    if (file(context, "docs/BACKEND.md")?.exists) addPoints(draft, 1, evidence("Backend docs", "docs/BACKEND.md exists.", "docs/BACKEND.md"));
    else addRecommendation(draft, "create-backend-docs", "low", "Create backend docs", "Backend docs should record runtime boundaries and data/storage assumptions.", [
      artifact("doc", "docs/BACKEND.md", "create"),
    ]);
  }
  if (!docs) {
    addFinding(draft, "docs-missing", "medium", "missing", "docs/ is missing", "Deeper knowledge has no structured home outside AGENTS.md.", []);
  }
  draft.summary = summarizeDraft(draft, "Documentation system is structured.", "Documentation system needs starter files.");
  return draft;
}

function scoreSafetyAndSecrets(context: HarnessScanContext): CategoryDraft {
  const draft = createDraft("safety-secrets", "Safety And Secrets");
  const gitignore = file(context, ".gitignore");
  const envExample = file(context, ".env.example") ?? file(context, ".env.sample");
  const secretFiles = [...context.files.values()].filter((item) => item.exists && item.kind === "secret-looking");

  if (gitignore?.exists) addPoints(draft, 3, evidence(".gitignore", ".gitignore exists.", ".gitignore"));
  else addFinding(draft, "gitignore-missing", "high", "missing", ".gitignore is missing", "Repos without .gitignore are more likely to commit generated files or local secrets.", []);

  if (envExample?.exists) addPoints(draft, 2, evidence("Env example", `${envExample.path} exists.`, envExample.path));
  else addRecommendation(draft, "create-env-example", "low", "Create .env.example", "Document environment variable names without storing secret values.", [
    artifact("config", ".env.example", "create"),
  ]);

  if (secretFiles.length === 0) {
    addPoints(draft, 3, evidence("Secret-looking files", "No secret-looking file names detected in scanned tree.", null));
  } else {
    addFinding(draft, "secret-looking-files", "critical", "risky", "Secret-looking files detected", "The scanner did not read values, but secret-looking paths should be reviewed.", secretFiles.slice(0, 5).map((item) => evidence("Secret-looking path", item.path, item.path)));
  }

  const workflow = file(context, "WORKFLOW.md");
  if (!workflow?.content || !/rm\s+-rf|delete|cleanup|destructive/iu.test(workflow.content)) {
    addPoints(draft, 2, evidence("Destructive operations", "No obvious destructive workflow command detected in bounded scan.", "WORKFLOW.md"));
  } else {
    addFinding(draft, "destructive-workflow", "high", "risky", "Workflow mentions destructive operations", "Destructive commands should be documented and gated.", [
      evidence("WORKFLOW.md", "Potential destructive operation text detected.", "WORKFLOW.md"),
    ]);
  }
  draft.summary = summarizeDraft(draft, "Safety and secret hygiene signals are present.", "Safety and secret hygiene need attention.");
  return draft;
}

function scoreProviderReadiness(context: HarnessScanContext): CategoryDraft {
  const draft = createDraft("provider-readiness", "Provider Readiness");
  const haystack = textFromFiles(context, ["AGENTS.md", "README.md", "WORKFLOW.md", "docs/HARNESS.md", "docs/OPERATIONS.md"]);
  const hasCodex = /codex/iu.test(haystack);
  const hasClaude = /claude/iu.test(haystack);
  const hasCursor = /cursor/iu.test(haystack);
  const hasPermissions = /approval|permission|sandbox|credential|secret/iu.test(haystack);
  const hasCommands = /pnpm|npm|yarn|bun|cargo|go test|pytest|make/iu.test(haystack);

  if (hasCodex) addPoints(draft, 2, evidence("Codex guidance", "Codex is mentioned in harness docs.", null));
  if (hasClaude) addPoints(draft, 2, evidence("Claude guidance", "Claude is mentioned in harness docs.", null));
  if (hasCursor) addPoints(draft, 2, evidence("Cursor guidance", "Cursor is mentioned in harness docs.", null));
  if (hasPermissions) addPoints(draft, 2, evidence("Permission guidance", "Permission or approval guidance is documented.", null));
  if (hasCommands) addPoints(draft, 2, evidence("Provider commands", "Runnable commands are documented.", null));

  if (draft.score < 6) {
    addFinding(draft, "provider-guidance-weak", "medium", "weak", "Provider guidance is thin", "Codex, Claude, Cursor, permissions, or command guidance is not easy to find.", []);
    addRecommendation(draft, "add-provider-guidance", "medium", "Document provider expectations", "AGENTS.md should point to provider-safe commands and approval rules.", [
      artifact("AGENTS.md", "AGENTS.md", file(context, "AGENTS.md")?.exists ? "update" : "create"),
    ]);
  }
  draft.summary = summarizeDraft(draft, "Provider guidance is discoverable.", "Provider guidance needs clearer instructions.");
  return draft;
}

function scoreReviewReadiness(context: HarnessScanContext): CategoryDraft {
  const draft = createDraft("review-readiness", "Review Readiness");
  const githubRemote = context.metadata.gitRemote && /github\.com[:/]/iu.test(context.metadata.gitRemote);
  const hasCi = context.metadata.validationCommands.some((command) => command.source === "ci");
  const reviewDocs = textFromFiles(context, ["AGENTS.md", "CONTRIBUTING.md", "docs/HARNESS.md", "docs/OPERATIONS.md"]);

  if (githubRemote) addPoints(draft, 3, evidence("GitHub remote", "GitHub origin remote detected.", null));
  else addFinding(draft, "github-remote-missing", "low", context.metadata.isGitRepository ? "unknown" : "missing", "GitHub remote not detected", "Review artifacts may still work locally, but GitHub review context is weaker.", []);
  if (hasCi) addPoints(draft, 3, evidence("CI", "CI workflow detected.", ".github/workflows/"));
  if (/pull request|pr|review|diff|checks?/iu.test(reviewDocs)) addPoints(draft, 4, evidence("Review instructions", "PR/review instructions are documented.", null));
  else addRecommendation(draft, "add-review-guidance", "low", "Add review expectations", "Document what agents should hand off for human review.", [
    artifact("AGENTS.md", "AGENTS.md", file(context, "AGENTS.md")?.exists ? "update" : "create"),
  ]);
  draft.summary = summarizeDraft(draft, "Review handoff signals are present.", "Review handoff needs clearer signals.");
  return draft;
}

function scoreObservability(context: HarnessScanContext): CategoryDraft {
  const draft = createDraft("observability-debuggability", "Observability And Debuggability");
  const operations = file(context, "docs/OPERATIONS.md");
  const troubleshooting = file(context, "docs/TROUBLESHOOTING.md") ?? file(context, "TROUBLESHOOTING.md");
  const readme = file(context, "README.md");
  const docsText = textFromFiles(context, ["README.md", "docs/OPERATIONS.md", "docs/TROUBLESHOOTING.md", "docs/HARNESS.md"]);

  if (operations?.exists) addPoints(draft, 3, evidence("Operations docs", "docs/OPERATIONS.md exists.", "docs/OPERATIONS.md"));
  if (troubleshooting?.exists) addPoints(draft, 3, evidence("Troubleshooting docs", `${troubleshooting.path} exists.`, troubleshooting.path));
  if (/logs?|diagnostics?|debug|repro|reproduction/iu.test(docsText)) addPoints(draft, 3, evidence("Debug terms", "Docs mention logs, diagnostics, debug, or reproduction.", readme?.path ?? null));
  if (context.metadata.validationCommands.some((command) => /smoke|verify|check/iu.test(command.command))) addPoints(draft, 1, evidence("Smoke/check command", "A smoke/check command is discoverable.", null));
  if (draft.score < 5) {
    addRecommendation(draft, "create-operations-docs", "medium", "Create operations and troubleshooting docs", "Agents need reproducible debug and recovery steps when runs fail.", [
      artifact("doc", "docs/OPERATIONS.md", "create"),
    ]);
  }
  draft.summary = summarizeDraft(draft, "Debugging and recovery instructions are findable.", "Debugging and recovery instructions are weak.");
  return draft;
}

function scoreAccessibility(context: HarnessScanContext): CategoryDraft {
  const draft = createDraft("accessibility-ux", "Accessibility And UX");
  const frontend = context.metadata.frameworks.some((framework) => ["React", "Next.js", "Vite"].includes(framework));
  if (!frontend) {
    addPoints(draft, 7, evidence("Frontend detection", "No frontend framework detected; accessibility category is mostly not applicable.", null));
    draft.summary = "No frontend framework was detected; accessibility checks are optional for this repository.";
    return draft;
  }
  const docsText = textFromFiles(context, ["docs/FRONTEND.md", "README.md", "AGENTS.md", "docs/TESTING.md"]);
  const commands = context.metadata.validationCommands.map((command) => command.command).join("\n");
  if (file(context, "docs/FRONTEND.md")?.exists) addPoints(draft, 3, evidence("Frontend docs", "docs/FRONTEND.md exists.", "docs/FRONTEND.md"));
  if (/accessibility|a11y|aria|keyboard|screen reader/iu.test(docsText)) addPoints(draft, 3, evidence("Accessibility guidance", "Docs mention accessibility or keyboard/screen-reader behavior.", null));
  if (/playwright|cypress|storybook|vitest|testing-library|axe|a11y/iu.test(commands + docsText)) addPoints(draft, 3, evidence("UI QA", "UI test or QA tooling is mentioned.", null));
  if (/manual qa|visual|screenshot|browser/iu.test(docsText)) addPoints(draft, 1, evidence("Manual QA", "Manual UI QA instructions are mentioned.", null));
  if (draft.score < 6) {
    addFinding(draft, "accessibility-guidance-weak", "medium", "weak", "Frontend accessibility guidance is weak", "Frontend repos need keyboard, ARIA, and manual QA expectations for agents.", []);
    addRecommendation(draft, "create-frontend-accessibility-docs", "medium", "Add frontend accessibility guidance", "Document expected UI checks and manual QA paths.", [
      artifact("doc", "docs/FRONTEND.md", file(context, "docs/FRONTEND.md")?.exists ? "update" : "create"),
    ]);
  }
  draft.summary = summarizeDraft(draft, "Frontend accessibility and QA guidance are present.", "Frontend accessibility and QA guidance need work.");
  return draft;
}

function scoreSymphoniaCompatibility(context: HarnessScanContext): CategoryDraft {
  const draft = createDraft("symphonia-compatibility", "Symphonia Compatibility");
  const workflow = file(context, "WORKFLOW.md");
  if (!workflow?.exists) {
    addFinding(draft, "symphonia-workflow-missing", "high", "missing", "No Symphonia WORKFLOW.md", "Symphonia can still scan this repo, but agent runs need a workflow contract.", []);
    addRecommendation(draft, "create-symphonia-workflow", "high", "Create Symphonia workflow", "Use Linear plus a real provider with a bounded workspace root and read-only external writes.", [
      artifact("WORKFLOW.md", "WORKFLOW.md", "create"),
    ]);
    draft.summary = "Symphonia compatibility is missing a workflow contract.";
    return draft;
  }
  const content = workflow.content ?? "";
  if (/workspace:\s*\n[\s\S]*root:/u.test(content)) addPoints(draft, 2, evidence("Workspace root", "Workflow declares a workspace root.", "WORKFLOW.md"));
  if (/cleanup:\s*\n[\s\S]*dry_run:\s*true/u.test(content)) addPoints(draft, 2, evidence("Cleanup dry-run", "Cleanup is dry-run in workflow.", "WORKFLOW.md"));
  if (/hooks:/u.test(content)) addPoints(draft, 2, evidence("Hooks", "Hooks block exists.", "WORKFLOW.md"));
  if (/\{\{\s*issue\./u.test(content)) addPoints(draft, 2, evidence("Issue prompt", "Prompt references issue fields.", "WORKFLOW.md"));
  if (/pnpm|npm|yarn|bun|cargo|go test|pytest|make|validation|test|lint|build/iu.test(content)) addPoints(draft, 2, evidence("Validation in prompt", "Workflow or prompt references validation.", "WORKFLOW.md"));
  draft.summary = summarizeDraft(draft, "Symphonia workflow is compatible with safe local runs.", "Symphonia workflow needs safer local-run defaults.");
  return draft;
}

function createDraft(id: string, label: string): CategoryDraft {
  return { id, label, max: 10, score: 0, evidence: [], findings: [], recommendations: [], summary: "" };
}

function finalizeCategory(draft: CategoryDraft): HarnessCategory {
  const score = Math.min(draft.max, Math.max(0, Math.round(draft.score)));
  return {
    id: draft.id,
    label: draft.label,
    score,
    max: draft.max,
    status: statusFor(score, draft.max, draft.findings),
    summary: draft.summary || summarizeDraft({ ...draft, score }, "Category is strong.", "Category needs work."),
    evidence: draft.evidence,
    findings: draft.findings.map((finding) => finding.id),
    recommendations: draft.recommendations.map((recommendation) => recommendation.id),
  };
}

function statusFor(score: number, max: number, findings: HarnessFinding[]): HarnessCategoryStatus {
  if (findings.some((finding) => finding.status === "risky" || finding.severity === "critical")) return "risky";
  const percentage = (score / max) * 100;
  if (percentage >= 80) return "strong";
  if (percentage >= 40) return "partial";
  return "missing";
}

function gradeFor(percentage: number): "A" | "B" | "C" | "D" | "F" {
  if (percentage >= 90) return "A";
  if (percentage >= 80) return "B";
  if (percentage >= 70) return "C";
  if (percentage >= 55) return "D";
  return "F";
}

function addPoints(draft: CategoryDraft, points: number, item: HarnessEvidence): void {
  draft.score += points;
  draft.evidence.push(item);
}

function addFinding(
  draft: CategoryDraft,
  id: string,
  severity: HarnessFinding["severity"],
  status: HarnessFinding["status"],
  title: string,
  description: string,
  evidenceItems: HarnessEvidence[],
  recommendationIds: string[] = [],
): void {
  draft.findings.push({
    id,
    categoryId: draft.id,
    severity,
    status,
    title,
    description,
    evidence: evidenceItems,
    filePath: evidenceItems[0]?.filePath ?? null,
    lineNumber: evidenceItems[0]?.lineNumber ?? null,
    recommendationIds,
  });
}

function addRecommendation(
  draft: CategoryDraft,
  id: string,
  priority: HarnessRecommendation["priority"],
  title: string,
  description: string,
  proposedArtifacts: HarnessRecommendation["proposedArtifacts"],
): void {
  draft.recommendations.push({
    id,
    categoryId: draft.id,
    priority,
    title,
    description,
    rationale: description,
    proposedArtifacts,
    manualSteps: [],
    riskLevel: priority === "high" ? "medium" : "low",
    appliesAutomatically: proposedArtifacts.some((item) => item.action === "create" || item.action === "update"),
  });
}

function addMissingValidation(draft: CategoryDraft, kind: "test" | "lint" | "build"): void {
  addFinding(draft, `${kind}-missing`, "high", "missing", `No ${kind} command found`, `No discoverable ${kind} command was detected.`, []);
  addRecommendation(draft, `create-script-${kind}`, "high", `Create scripts/${kind}`, `Expose a safe ${kind} entry point for agents and CI.`, [
    artifact("script", `scripts/${kind}`, "create"),
  ]);
}

function artifact(kind: HarnessRecommendation["proposedArtifacts"][number]["kind"], path: string, action: HarnessRecommendation["proposedArtifacts"][number]["action"]) {
  return { kind, path, action };
}

function evidence(label: string, value: string, filePath: string | null, lineNumber: number | null = null): HarnessEvidence {
  return { label, value, filePath, lineNumber };
}

function summarizeDraft(draft: Pick<CategoryDraft, "score" | "max">, strong: string, weak: string): string {
  return draft.score / draft.max >= 0.7 ? strong : weak;
}

function file(context: HarnessScanContext, path: string): HarnessFileRecord | null {
  return context.files.get(path) ?? null;
}

function dirHas(context: HarnessScanContext, prefix: string): boolean {
  return [...context.files.values()].some((item) => item.exists && item.path.startsWith(prefix));
}

function textFromFiles(context: HarnessScanContext, paths: string[]): string {
  return paths.map((path) => file(context, path)?.content ?? "").join("\n");
}

function commandSummary(commands: HarnessScanContext["metadata"]["validationCommands"], pattern: RegExp): string {
  return commands
    .filter((command) => pattern.test(command.command) || pattern.test(command.label))
    .map((command) => command.command)
    .join(", ");
}

function dedupeRecommendations(items: HarnessRecommendation[]): HarnessRecommendation[] {
  const seen = new Map<string, HarnessRecommendation>();
  for (const item of items) {
    if (!seen.has(item.id)) seen.set(item.id, item);
  }
  return [...seen.values()];
}
