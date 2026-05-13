import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  ProviderId,
  TrackerKind,
  WorkflowConfig,
  WorkflowConfigSchema,
  WorkflowConfigSummary,
  WorkflowDefinition,
  WorkflowDefinitionSchema,
  WorkflowStatus,
} from "@symphonia/types";
import { nowIso } from "./time.js";

export type WorkflowErrorCode =
  | "missing_workflow_file"
  | "workflow_front_matter_unclosed"
  | "workflow_yaml_invalid"
  | "workflow_front_matter_not_a_map"
  | "workflow_tracker_kind_missing"
  | "workflow_tracker_kind_unsupported"
  | "workflow_linear_api_key_missing"
  | "workflow_linear_scope_missing"
  | "workflow_tracker_states_invalid"
  | "workflow_tracker_page_size_invalid"
  | "workflow_tracker_max_pages_invalid"
  | "workflow_hook_timeout_invalid"
  | "workflow_agent_max_turns_invalid"
  | "workflow_agent_max_concurrent_invalid"
  | "workflow_codex_command_invalid"
  | "workflow_provider_unsupported"
  | "workflow_config_invalid";

export class WorkflowError extends Error {
  constructor(
    readonly code: WorkflowErrorCode,
    message: string,
    readonly workflowPath?: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "WorkflowError";
  }
}

export type LoadWorkflowOptions = {
  workflowPath?: string;
  cwd?: string;
  loadedAt?: string;
};

export type WorkflowRuntime = {
  definition: WorkflowDefinition;
  config: WorkflowConfig;
  summary: WorkflowConfigSummary;
};

const defaultLinearEndpoint = "https://api.linear.app/graphql";
const defaultActiveStates = ["Todo", "In Progress"];
const defaultTerminalStates = ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"];
const defaultTrackerPageSize = 50;
const defaultTrackerMaxPages = 5;
const maxTrackerPageSize = 100;
const maxTrackerMaxPages = 20;

export function discoverWorkflowPath(options: Pick<LoadWorkflowOptions, "workflowPath" | "cwd"> = {}): string {
  if (options.workflowPath) return resolve(options.workflowPath);

  const start = resolve(options.cwd ?? process.cwd());
  let current = start;

  while (true) {
    const candidate = join(current, "WORKFLOW.md");
    if (existsSync(candidate)) return candidate;
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return candidate;

    const parent = dirname(current);
    if (parent === current) return join(start, "WORKFLOW.md");
    current = parent;
  }
}

export function loadWorkflowDefinition(options: LoadWorkflowOptions = {}): WorkflowDefinition {
  const workflowPath = discoverWorkflowPath(options);

  if (!existsSync(workflowPath)) {
    throw new WorkflowError("missing_workflow_file", `Workflow file not found at ${workflowPath}.`, workflowPath);
  }

  const contents = readFileSync(workflowPath, "utf8");
  const parsed = splitWorkflowFile(contents, workflowPath);

  return WorkflowDefinitionSchema.parse({
    config: parsed.config,
    promptTemplate: parsed.promptTemplate,
    workflowPath,
    loadedAt: options.loadedAt ?? nowIso(),
  });
}

export function loadWorkflowRuntime(options: LoadWorkflowOptions = {}): WorkflowRuntime {
  const definition = loadWorkflowDefinition(options);
  const config = resolveWorkflowConfig(definition);
  return { definition, config, summary: summarizeWorkflowConfig(config) };
}

export function getWorkflowStatus(options: LoadWorkflowOptions = {}): WorkflowStatus {
  try {
    const runtime = loadWorkflowRuntime(options);
    return {
      status: "healthy",
      workflowPath: runtime.definition.workflowPath,
      loadedAt: runtime.definition.loadedAt,
      error: null,
      effectiveConfigSummary: runtime.summary,
    };
  } catch (error) {
    if (error instanceof WorkflowError) {
      return {
        status: error.code === "missing_workflow_file" ? "missing" : "invalid",
        workflowPath: error.workflowPath ?? discoverWorkflowPath(options),
        loadedAt: null,
        error: error.message,
        effectiveConfigSummary: null,
      };
    }

    return {
      status: "invalid",
      workflowPath: discoverWorkflowPath(options),
      loadedAt: null,
      error: error instanceof Error ? error.message : "Unknown workflow error.",
      effectiveConfigSummary: null,
    };
  }
}

export function resolveWorkflowConfig(definition: WorkflowDefinition): WorkflowConfig {
  const raw = definition.config;
  const trackerRaw = readObject(raw, "tracker");
  const trackerKind = readString(trackerRaw, "kind") as TrackerKind | undefined;

  if (!trackerKind) {
    throw new WorkflowError(
      "workflow_tracker_kind_missing",
      "tracker.kind is required before dispatch.",
      definition.workflowPath,
    );
  }

  if (trackerKind !== "mock" && trackerKind !== "linear") {
    throw new WorkflowError(
      "workflow_tracker_kind_unsupported",
      `Unsupported tracker.kind: ${trackerKind}.`,
      definition.workflowPath,
    );
  }

  const endpoint = readString(trackerRaw, "endpoint") ?? (trackerKind === "linear" ? defaultLinearEndpoint : null);
  const apiKey = resolveEnvReference(readString(trackerRaw, "apiKey", "api_key"));
  const teamKey = readString(trackerRaw, "teamKey", "team_key");
  const teamId = readString(trackerRaw, "teamId", "team_id");
  const projectSlug = readString(trackerRaw, "projectSlug", "project_slug");
  const projectId = readString(trackerRaw, "projectId", "project_id");
  const allowWorkspaceWide = readBoolean(trackerRaw, false, "allowWorkspaceWide", "allow_workspace_wide");
  const activeStates = readStringArray(trackerRaw, defaultActiveStates, "activeStates", "active_states");
  const terminalStates = readStringArray(trackerRaw, defaultTerminalStates, "terminalStates", "terminal_states");
  const pageSize = readPositiveInteger(trackerRaw, defaultTrackerPageSize, "pageSize", "page_size");
  const maxPages = readPositiveInteger(trackerRaw, defaultTrackerMaxPages, "maxPages", "max_pages");
  const pollIntervalMs = readOptionalPositiveInteger(trackerRaw, "pollIntervalMs", "poll_interval_ms");
  const writeRaw = readObject(trackerRaw, "write");

  if (trackerKind === "linear" && !apiKey) {
    throw new WorkflowError(
      "workflow_linear_api_key_missing",
      "tracker.api_key is required for linear tracker config.",
      definition.workflowPath,
    );
  }

  if (trackerKind === "linear" && !teamKey && !teamId && !projectSlug && !projectId && !allowWorkspaceWide) {
    throw new WorkflowError(
      "workflow_linear_scope_missing",
      "Linear tracker config requires team_key, team_id, project_slug, project_id, or allow_workspace_wide: true.",
      definition.workflowPath,
    );
  }

  if (activeStates.length === 0 || terminalStates.length === 0) {
    throw new WorkflowError(
      "workflow_tracker_states_invalid",
      "tracker.active_states and tracker.terminal_states must both contain at least one state.",
      definition.workflowPath,
    );
  }

  if (pageSize < 1 || pageSize > maxTrackerPageSize) {
    throw new WorkflowError(
      "workflow_tracker_page_size_invalid",
      `tracker.page_size must be between 1 and ${maxTrackerPageSize}.`,
      definition.workflowPath,
    );
  }

  if (maxPages < 1 || maxPages > maxTrackerMaxPages) {
    throw new WorkflowError(
      "workflow_tracker_max_pages_invalid",
      `tracker.max_pages must be between 1 and ${maxTrackerMaxPages}.`,
      definition.workflowPath,
    );
  }

  const pollingRaw = readObject(raw, "polling");
  const workspaceRaw = readObject(raw, "workspace");
  const hooksRaw = readObject(raw, "hooks");
  const agentRaw = readObject(raw, "agent");
  const codexRaw = readObject(raw, "codex");
  const provider = resolveProvider(raw, agentRaw, definition.workflowPath);

  const hookTimeoutMs = readPositiveInteger(hooksRaw, 60000, "timeoutMs", "timeout_ms");
  const maxTurns = readPositiveInteger(agentRaw, 20, "maxTurns", "max_turns");
  const maxConcurrentAgents = readPositiveInteger(agentRaw, 10, "maxConcurrentAgents", "max_concurrent_agents");
  const codexCommand = process.env.SYMPHONIA_CODEX_COMMAND ?? readString(codexRaw, "command") ?? "codex app-server";

  if (hookTimeoutMs <= 0) {
    throw new WorkflowError("workflow_hook_timeout_invalid", "hooks.timeout_ms must be positive.", definition.workflowPath);
  }

  if (maxTurns <= 0) {
    throw new WorkflowError("workflow_agent_max_turns_invalid", "agent.max_turns must be positive.", definition.workflowPath);
  }

  if (maxConcurrentAgents <= 0) {
    throw new WorkflowError(
      "workflow_agent_max_concurrent_invalid",
      "agent.max_concurrent_agents must be positive.",
      definition.workflowPath,
    );
  }

  if (codexCommand.trim().length === 0) {
    throw new WorkflowError("workflow_codex_command_invalid", "codex.command must be non-empty.", definition.workflowPath);
  }

  const workspaceRoot = resolveWorkspaceRoot(
    readString(workspaceRaw, "root") ?? join(tmpdir(), "symphonia_workspaces"),
    dirname(definition.workflowPath),
  );

  const config = {
    provider,
    tracker: {
      kind: trackerKind,
      endpoint,
      apiKey,
      teamKey: teamKey ?? null,
      teamId: teamId ?? null,
      projectSlug: projectSlug ?? null,
      projectId: projectId ?? null,
      allowWorkspaceWide,
      activeStates,
      terminalStates,
      includeArchived: readBoolean(trackerRaw, false, "includeArchived", "include_archived"),
      pageSize,
      maxPages,
      pollIntervalMs,
      readOnly: readBoolean(trackerRaw, true, "readOnly", "read_only"),
      write: {
        enabled: readBoolean(writeRaw, false, "enabled"),
        commentOnRunStart: readBoolean(writeRaw, false, "commentOnRunStart", "comment_on_run_start"),
        commentOnRunComplete: readBoolean(writeRaw, false, "commentOnRunComplete", "comment_on_run_complete"),
        moveToStateOnStart: readString(writeRaw, "moveToStateOnStart", "move_to_state_on_start") ?? null,
        moveToStateOnSuccess: readString(writeRaw, "moveToStateOnSuccess", "move_to_state_on_success") ?? null,
        moveToStateOnFailure: readString(writeRaw, "moveToStateOnFailure", "move_to_state_on_failure") ?? null,
      },
    },
    polling: {
      intervalMs: readPositiveInteger(pollingRaw, 30000, "intervalMs", "interval_ms"),
    },
    workspace: {
      root: workspaceRoot,
    },
    hooks: {
      afterCreate: readString(hooksRaw, "afterCreate", "after_create") ?? null,
      beforeRun: readString(hooksRaw, "beforeRun", "before_run") ?? null,
      afterRun: readString(hooksRaw, "afterRun", "after_run") ?? null,
      beforeRemove: readString(hooksRaw, "beforeRemove", "before_remove") ?? null,
      timeoutMs: hookTimeoutMs,
    },
    agent: {
      maxConcurrentAgents,
      maxTurns,
      maxRetryBackoffMs: readNonnegativeInteger(agentRaw, 300000, "maxRetryBackoffMs", "max_retry_backoff_ms"),
      maxConcurrentAgentsByState: readPositiveIntegerRecord(
        agentRaw,
        "maxConcurrentAgentsByState",
        "max_concurrent_agents_by_state",
      ),
    },
    codex: {
      command: codexCommand,
      model: readString(codexRaw, "model") ?? null,
      approvalPolicy: readString(codexRaw, "approvalPolicy", "approval_policy") ?? null,
      threadSandbox: readString(codexRaw, "threadSandbox", "thread_sandbox") ?? null,
      turnSandboxPolicy: readString(codexRaw, "turnSandboxPolicy", "turn_sandbox_policy") ?? null,
      turnTimeoutMs: readPositiveInteger(codexRaw, 3600000, "turnTimeoutMs", "turn_timeout_ms"),
      readTimeoutMs: readPositiveInteger(codexRaw, 5000, "readTimeoutMs", "read_timeout_ms"),
      stallTimeoutMs: readPositiveInteger(codexRaw, 300000, "stallTimeoutMs", "stall_timeout_ms"),
    },
  };

  try {
    return WorkflowConfigSchema.parse(config);
  } catch (error) {
    throw new WorkflowError(
      "workflow_config_invalid",
      error instanceof Error ? error.message : "Workflow config validation failed.",
      definition.workflowPath,
    );
  }
}

export function summarizeWorkflowConfig(config: WorkflowConfig): WorkflowConfigSummary {
  return {
    defaultProvider: config.provider,
    trackerKind: config.tracker.kind,
    endpoint: config.tracker.endpoint,
    teamKey: config.tracker.teamKey,
    teamId: config.tracker.teamId,
    projectSlug: config.tracker.projectSlug,
    projectId: config.tracker.projectId,
    allowWorkspaceWide: config.tracker.allowWorkspaceWide,
    activeStates: config.tracker.activeStates,
    terminalStates: config.tracker.terminalStates,
    includeArchived: config.tracker.includeArchived,
    pageSize: config.tracker.pageSize,
    maxPages: config.tracker.maxPages,
    pollIntervalMs: config.tracker.pollIntervalMs,
    readOnly: config.tracker.readOnly,
    writeEnabled: config.tracker.write.enabled,
    workspaceRoot: config.workspace.root,
    maxConcurrentAgents: config.agent.maxConcurrentAgents,
    maxTurns: config.agent.maxTurns,
    hookTimeoutMs: config.hooks.timeoutMs,
    codexCommand: config.codex.command,
    codexModel: config.codex.model,
  };
}

function splitWorkflowFile(contents: string, workflowPath: string): { config: Record<string, unknown>; promptTemplate: string } {
  const normalized = contents.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);

  if (lines[0]?.trim() !== "---") {
    return { config: {}, promptTemplate: normalized.trim() };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) {
    throw new WorkflowError(
      "workflow_front_matter_unclosed",
      "Workflow front matter starts with --- but does not include a closing ---.",
      workflowPath,
    );
  }

  const frontMatter = lines.slice(1, closingIndex).join("\n").trim();
  const promptTemplate = lines.slice(closingIndex + 1).join("\n").trim();

  let decoded: unknown = {};
  try {
    decoded = frontMatter.length > 0 ? parseYaml(frontMatter) : {};
  } catch (error) {
    throw new WorkflowError(
      "workflow_yaml_invalid",
      error instanceof Error ? error.message : "Invalid YAML front matter.",
      workflowPath,
    );
  }

  if (!isRecord(decoded)) {
    throw new WorkflowError(
      "workflow_front_matter_not_a_map",
      "Workflow YAML front matter must decode to an object/map.",
      workflowPath,
    );
  }

  return { config: decoded, promptTemplate };
}

function resolveWorkspaceRoot(input: string, workflowDirectory: string): string {
  const expanded = expandTilde(expandEnvironmentVariables(input));
  const absolute = isAbsolute(expanded) ? expanded : resolve(workflowDirectory, expanded);
  return resolve(absolute);
}

function expandTilde(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function expandEnvironmentVariables(value: string): string {
  return value.replace(/\$([A-Za-z_][A-Za-z0-9_]*)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, bare: string, braced: string) => {
    const name = bare ?? braced;
    return process.env[name] ?? "";
  });
}

function resolveEnvReference(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("$")) return value;
  const name = value.startsWith("${") && value.endsWith("}") ? value.slice(2, -1) : value.slice(1);
  return process.env[name] ?? null;
}

function resolveProvider(
  raw: Record<string, unknown>,
  agentRaw: Record<string, unknown>,
  workflowPath: string,
): ProviderId {
  const value = process.env.SYMPHONIA_PROVIDER ?? readString(raw, "provider") ?? readString(agentRaw, "provider") ?? "mock";
  if (value === "mock" || value === "codex") return value;
  throw new WorkflowError("workflow_provider_unsupported", `Unsupported provider: ${value}.`, workflowPath);
}

function readObject(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return isRecord(value) ? value : {};
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value.trim();
  }
  return undefined;
}

function readStringArray(record: Record<string, unknown>, fallback: string[], ...keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0)) {
      return value.map((item) => item.trim());
    }
  }
  return fallback;
}

function readBoolean(record: Record<string, unknown>, fallback: boolean, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return fallback;
}

function readPositiveInteger(record: Record<string, unknown>, fallback: number, ...keys: string[]): number {
  const value = readNumber(record, ...keys);
  return value === undefined ? fallback : value;
}

function readOptionalPositiveInteger(record: Record<string, unknown>, ...keys: string[]): number | null {
  const value = readNumber(record, ...keys);
  return value === undefined ? null : value;
}

function readNonnegativeInteger(record: Record<string, unknown>, fallback: number, ...keys: string[]): number {
  const value = readNumber(record, ...keys);
  return value === undefined ? fallback : value;
}

function readNumber(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") return value;
  }
  return undefined;
}

function readPositiveIntegerRecord(record: Record<string, unknown>, ...keys: string[]): Record<string, number> {
  for (const key of keys) {
    const value = record[key];
    if (!isRecord(value)) continue;

    const entries = Object.entries(value).filter((entry): entry is [string, number] => {
      return typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1] > 0;
    });
    return Object.fromEntries(entries);
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
