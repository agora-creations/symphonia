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
  | "workflow_github_repo_missing"
  | "workflow_github_page_size_invalid"
  | "workflow_github_max_pages_invalid"
  | "workflow_github_write_guard_invalid"
  | "workflow_workspace_cleanup_invalid"
  | "workflow_hook_timeout_invalid"
  | "workflow_agent_max_turns_invalid"
  | "workflow_agent_max_concurrent_invalid"
  | "workflow_codex_command_invalid"
  | "workflow_claude_command_invalid"
  | "workflow_cursor_command_invalid"
  | "workflow_claude_timeout_invalid"
  | "workflow_cursor_timeout_invalid"
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
const defaultTerminalStates = ["Closed", "Canceled", "Duplicate", "Done"];
const defaultTrackerPageSize = 50;
const defaultTrackerMaxPages = 5;
const maxTrackerPageSize = 100;
const maxTrackerMaxPages = 20;
const defaultGithubEndpoint = "https://api.github.com";
const defaultGithubPageSize = 50;
const defaultGithubMaxPages = 3;
const maxGithubPageSize = 100;
const maxGithubMaxPages = 20;
const defaultCliTimeoutMs = 3600000;
const defaultCliStallTimeoutMs = 300000;
const defaultCliReadTimeoutMs = 5000;
const dayMs = 86_400_000;
const defaultWorkspaceCleanupPolicy = {
  enabled: false,
  dryRun: true,
  requireManualConfirmation: true,
  deleteTerminalAfterMs: 7 * dayMs,
  deleteOrphanedAfterMs: 14 * dayMs,
  deleteInterruptedAfterMs: 14 * dayMs,
  maxWorkspaceAgeMs: null,
  maxTotalBytes: null,
  protectActive: true,
  protectRecentRunsMs: dayMs,
  protectDirtyGit: true,
  includeTerminalStates: ["Done", "Closed", "Cancelled", "Canceled", "Duplicate"],
  excludeIdentifiers: [],
  includeIdentifiers: [],
};
const defaultPrTitleTemplate = "{{ issue.identifier }}: {{ issue.title }}";
const defaultPrBodyTemplate = `## Summary

Automated work for {{ issue.identifier }}.

Issue: {{ issue.url }}

## Validation

See Symphonia run timeline and review artifacts.`;

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

  if (trackerKind !== "linear") {
    throw new WorkflowError(
      "workflow_tracker_kind_unsupported",
      `Unsupported tracker.kind: ${trackerKind}. Symphonia now requires a real Linear tracker configuration.`,
      definition.workflowPath,
    );
  }

  const endpoint = readString(trackerRaw, "endpoint") ?? defaultLinearEndpoint;
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
  const claudeRaw = readObject(raw, "claude");
  const cursorRaw = readObject(raw, "cursor");
  const githubRaw = readObject(raw, "github");
  const provider = resolveProvider(raw, agentRaw, definition.workflowPath);
  const githubEnabled = readBoolean(githubRaw, false, "enabled");
  const githubReadOnly = readBoolean(githubRaw, true, "readOnly", "read_only");
  const githubWriteRaw = readObject(githubRaw, "write");
  const githubWriteEnabled = !githubReadOnly && readBoolean(githubWriteRaw, false, "enabled");
  const githubAllowCreatePr = githubWriteEnabled && readBoolean(githubWriteRaw, false, "allowCreatePr", "allow_create_pr");
  const githubAllowPush = githubWriteEnabled && readBoolean(githubWriteRaw, false, "allowPush", "allow_push");
  const githubAllowUpdatePr = githubWriteEnabled && readBoolean(githubWriteRaw, false, "allowUpdatePr", "allow_update_pr");
  const githubAllowComment = githubWriteEnabled && readBoolean(githubWriteRaw, false, "allowComment", "allow_comment");
  const githubAllowRequestReviewers =
    githubWriteEnabled && readBoolean(githubWriteRaw, false, "allowRequestReviewers", "allow_request_reviewers");
  const githubOwner = readString(githubRaw, "owner") ?? null;
  const githubRepo = readString(githubRaw, "repo") ?? null;
  const githubPageSize = readPositiveInteger(githubRaw, defaultGithubPageSize, "pageSize", "page_size");
  const githubMaxPages = readPositiveInteger(githubRaw, defaultGithubMaxPages, "maxPages", "max_pages");

  if (githubEnabled && (!githubOwner || !githubRepo)) {
    throw new WorkflowError(
      "workflow_github_repo_missing",
      "github.owner and github.repo are required when github.enabled is true.",
      definition.workflowPath,
    );
  }

  if (githubPageSize < 1 || githubPageSize > maxGithubPageSize) {
    throw new WorkflowError(
      "workflow_github_page_size_invalid",
      `github.page_size must be between 1 and ${maxGithubPageSize}.`,
      definition.workflowPath,
    );
  }

  if (githubMaxPages < 1 || githubMaxPages > maxGithubMaxPages) {
    throw new WorkflowError(
      "workflow_github_max_pages_invalid",
      `github.max_pages must be between 1 and ${maxGithubMaxPages}.`,
      definition.workflowPath,
    );
  }

  if (!githubWriteEnabled) {
    const invalidWriteFlag =
      readBoolean(githubWriteRaw, false, "allowCreatePr", "allow_create_pr") ||
      readBoolean(githubWriteRaw, false, "allowPush", "allow_push") ||
      readBoolean(githubWriteRaw, false, "allowUpdatePr", "allow_update_pr") ||
      readBoolean(githubWriteRaw, false, "allowComment", "allow_comment") ||
      readBoolean(githubWriteRaw, false, "allowRequestReviewers", "allow_request_reviewers");
    if (!githubReadOnly && invalidWriteFlag) {
      throw new WorkflowError(
        "workflow_github_write_guard_invalid",
        "GitHub write options require github.write.enabled: true.",
        definition.workflowPath,
      );
    }
  }

  const hookTimeoutMs = readPositiveInteger(hooksRaw, 60000, "timeoutMs", "timeout_ms");
  const maxTurns = readPositiveInteger(agentRaw, 20, "maxTurns", "max_turns");
  const maxConcurrentAgents = readPositiveInteger(agentRaw, 10, "maxConcurrentAgents", "max_concurrent_agents");
  const codexCommand = process.env.SYMPHONIA_CODEX_COMMAND ?? readString(codexRaw, "command") ?? "codex app-server";
  const claudeCommand = process.env.SYMPHONIA_CLAUDE_COMMAND ?? readString(claudeRaw, "command") ?? "claude";
  const cursorCommand = process.env.SYMPHONIA_CURSOR_COMMAND ?? readString(cursorRaw, "command") ?? "cursor-agent";
  const claudeTimeoutMs = readPositiveInteger(claudeRaw, defaultCliTimeoutMs, "timeoutMs", "timeout_ms");
  const claudeStallTimeoutMs = readPositiveInteger(claudeRaw, defaultCliStallTimeoutMs, "stallTimeoutMs", "stall_timeout_ms");
  const claudeReadTimeoutMs = readPositiveInteger(claudeRaw, defaultCliReadTimeoutMs, "readTimeoutMs", "read_timeout_ms");
  const cursorTimeoutMs = readPositiveInteger(cursorRaw, defaultCliTimeoutMs, "timeoutMs", "timeout_ms");
  const cursorStallTimeoutMs = readPositiveInteger(cursorRaw, defaultCliStallTimeoutMs, "stallTimeoutMs", "stall_timeout_ms");
  const cursorReadTimeoutMs = readPositiveInteger(cursorRaw, defaultCliReadTimeoutMs, "readTimeoutMs", "read_timeout_ms");

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

  if (claudeCommand.trim().length === 0) {
    throw new WorkflowError("workflow_claude_command_invalid", "claude.command must be non-empty.", definition.workflowPath);
  }

  if (cursorCommand.trim().length === 0) {
    throw new WorkflowError("workflow_cursor_command_invalid", "cursor.command must be non-empty.", definition.workflowPath);
  }

  if (claudeTimeoutMs <= 0 || claudeStallTimeoutMs <= 0 || claudeReadTimeoutMs <= 0) {
    throw new WorkflowError("workflow_claude_timeout_invalid", "Claude timeout settings must be positive.", definition.workflowPath);
  }

  if (cursorTimeoutMs <= 0 || cursorStallTimeoutMs <= 0 || cursorReadTimeoutMs <= 0) {
    throw new WorkflowError("workflow_cursor_timeout_invalid", "Cursor timeout settings must be positive.", definition.workflowPath);
  }

  const workspaceRoot = resolveWorkspaceRoot(
    readString(workspaceRaw, "root") ?? join(tmpdir(), "symphonia_workspaces"),
    dirname(definition.workflowPath),
  );
  const cleanupRaw = readObject(workspaceRaw, "cleanup");
  const cleanupPolicy = {
    enabled: readBoolean(cleanupRaw, defaultWorkspaceCleanupPolicy.enabled, "enabled"),
    dryRun: readBoolean(cleanupRaw, defaultWorkspaceCleanupPolicy.dryRun, "dryRun", "dry_run"),
    requireManualConfirmation: readBoolean(
      cleanupRaw,
      defaultWorkspaceCleanupPolicy.requireManualConfirmation,
      "requireManualConfirmation",
      "require_manual_confirmation",
    ),
    deleteTerminalAfterMs: readOptionalNonnegativeInteger(
      cleanupRaw,
      defaultWorkspaceCleanupPolicy.deleteTerminalAfterMs,
      "deleteTerminalAfterMs",
      "delete_terminal_after_ms",
    ),
    deleteOrphanedAfterMs: readOptionalNonnegativeInteger(
      cleanupRaw,
      defaultWorkspaceCleanupPolicy.deleteOrphanedAfterMs,
      "deleteOrphanedAfterMs",
      "delete_orphaned_after_ms",
    ),
    deleteInterruptedAfterMs: readOptionalNonnegativeInteger(
      cleanupRaw,
      defaultWorkspaceCleanupPolicy.deleteInterruptedAfterMs,
      "deleteInterruptedAfterMs",
      "delete_interrupted_after_ms",
    ),
    maxWorkspaceAgeMs: readOptionalNonnegativeInteger(
      cleanupRaw,
      defaultWorkspaceCleanupPolicy.maxWorkspaceAgeMs,
      "maxWorkspaceAgeMs",
      "max_workspace_age_ms",
    ),
    maxTotalBytes: readOptionalNonnegativeInteger(
      cleanupRaw,
      defaultWorkspaceCleanupPolicy.maxTotalBytes,
      "maxTotalBytes",
      "max_total_bytes",
    ),
    protectActive: readBoolean(cleanupRaw, defaultWorkspaceCleanupPolicy.protectActive, "protectActive", "protect_active"),
    protectRecentRunsMs: readNonnegativeInteger(
      cleanupRaw,
      defaultWorkspaceCleanupPolicy.protectRecentRunsMs,
      "protectRecentRunsMs",
      "protect_recent_runs_ms",
    ),
    protectDirtyGit: readBoolean(
      cleanupRaw,
      defaultWorkspaceCleanupPolicy.protectDirtyGit,
      "protectDirtyGit",
      "protect_dirty_git",
    ),
    includeTerminalStates: readStringArray(
      cleanupRaw,
      defaultWorkspaceCleanupPolicy.includeTerminalStates,
      "includeTerminalStates",
      "include_terminal_states",
    ),
    excludeIdentifiers: readStringArray(cleanupRaw, [], "excludeIdentifiers", "exclude_identifiers"),
    includeIdentifiers: readStringArray(cleanupRaw, [], "includeIdentifiers", "include_identifiers"),
  };

  if (
    [
      cleanupPolicy.deleteTerminalAfterMs,
      cleanupPolicy.deleteOrphanedAfterMs,
      cleanupPolicy.deleteInterruptedAfterMs,
      cleanupPolicy.maxWorkspaceAgeMs,
      cleanupPolicy.maxTotalBytes,
      cleanupPolicy.protectRecentRunsMs,
    ].some((value) => value !== null && value < 0)
  ) {
    throw new WorkflowError(
      "workflow_workspace_cleanup_invalid",
      "workspace.cleanup durations and byte limits must be non-negative or null.",
      definition.workflowPath,
    );
  }

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
      cleanup: cleanupPolicy,
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
    claude: {
      enabled: readBoolean(claudeRaw, false, "enabled"),
      command: claudeCommand,
      model: readString(claudeRaw, "model") ?? null,
      maxTurns: readPositiveInteger(claudeRaw, maxTurns, "maxTurns", "max_turns"),
      outputFormat: readCliOutputFormat(claudeRaw, "stream-json", "outputFormat", "output_format"),
      permissionMode: readString(claudeRaw, "permissionMode", "permission_mode") ?? "default",
      allowedTools: readStringArray(claudeRaw, [], "allowedTools", "allowed_tools"),
      disallowedTools: readStringArray(claudeRaw, [], "disallowedTools", "disallowed_tools"),
      appendSystemPrompt: readString(claudeRaw, "appendSystemPrompt", "append_system_prompt") ?? null,
      extraArgs: readStringArray(claudeRaw, [], "extraArgs", "extra_args"),
      env: readStringRecord(claudeRaw, "env"),
      redactedEnvKeys: readStringArray(claudeRaw, [], "redactedEnvKeys", "redacted_env_keys"),
      healthCheckCommand: readString(claudeRaw, "healthCheckCommand", "health_check_command") ?? null,
      timeoutMs: claudeTimeoutMs,
      stallTimeoutMs: claudeStallTimeoutMs,
      readTimeoutMs: claudeReadTimeoutMs,
      cwdBehavior: "workspace" as const,
    },
    cursor: {
      enabled: readBoolean(cursorRaw, false, "enabled"),
      command: cursorCommand,
      model: readString(cursorRaw, "model") ?? null,
      outputFormat: readCliOutputFormat(cursorRaw, "stream-json", "outputFormat", "output_format"),
      force: readBoolean(cursorRaw, false, "force"),
      extraArgs: readStringArray(cursorRaw, [], "extraArgs", "extra_args"),
      env: readStringRecord(cursorRaw, "env"),
      redactedEnvKeys: readStringArray(cursorRaw, [], "redactedEnvKeys", "redacted_env_keys"),
      healthCheckCommand: readString(cursorRaw, "healthCheckCommand", "health_check_command") ?? null,
      timeoutMs: cursorTimeoutMs,
      stallTimeoutMs: cursorStallTimeoutMs,
      readTimeoutMs: cursorReadTimeoutMs,
      cwdBehavior: "workspace" as const,
    },
    github: {
      enabled: githubEnabled,
      endpoint: readString(githubRaw, "endpoint") ?? defaultGithubEndpoint,
      token: resolveEnvReference(readString(githubRaw, "token")) ?? null,
      owner: githubOwner,
      repo: githubRepo,
      defaultBaseBranch: readString(githubRaw, "defaultBaseBranch", "default_base_branch") ?? "main",
      remoteName: readString(githubRaw, "remoteName", "remote_name") ?? "origin",
      readOnly: githubReadOnly,
      pageSize: githubPageSize,
      maxPages: githubMaxPages,
      write: {
        enabled: githubWriteEnabled,
        allowPush: githubAllowPush,
        allowCreatePr: githubAllowCreatePr,
        allowUpdatePr: githubAllowUpdatePr,
        allowComment: githubAllowComment,
        allowRequestReviewers: githubAllowRequestReviewers,
        draftPrByDefault: readBoolean(githubWriteRaw, true, "draftPrByDefault", "draft_pr_by_default"),
        prTitleTemplate:
          readString(githubWriteRaw, "prTitleTemplate", "pr_title_template") ?? defaultPrTitleTemplate,
        prBodyTemplate: readString(githubWriteRaw, "prBodyTemplate", "pr_body_template") ?? defaultPrBodyTemplate,
      },
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
    workspaceCleanup: {
      enabled: config.workspace.cleanup.enabled,
      dryRun: config.workspace.cleanup.dryRun,
      requireManualConfirmation: config.workspace.cleanup.requireManualConfirmation,
      protectActive: config.workspace.cleanup.protectActive,
      protectRecentRunsMs: config.workspace.cleanup.protectRecentRunsMs,
      protectDirtyGit: config.workspace.cleanup.protectDirtyGit,
      deleteTerminalAfterMs: config.workspace.cleanup.deleteTerminalAfterMs,
      deleteOrphanedAfterMs: config.workspace.cleanup.deleteOrphanedAfterMs,
      deleteInterruptedAfterMs: config.workspace.cleanup.deleteInterruptedAfterMs,
      maxWorkspaceAgeMs: config.workspace.cleanup.maxWorkspaceAgeMs,
      maxTotalBytes: config.workspace.cleanup.maxTotalBytes,
      includeTerminalStates: config.workspace.cleanup.includeTerminalStates,
      excludeIdentifiers: config.workspace.cleanup.excludeIdentifiers,
      includeIdentifiers: config.workspace.cleanup.includeIdentifiers,
    },
    maxConcurrentAgents: config.agent.maxConcurrentAgents,
    maxTurns: config.agent.maxTurns,
    hookTimeoutMs: config.hooks.timeoutMs,
    codexCommand: config.codex.command,
    codexModel: config.codex.model,
    providers: {
      codex: {
        enabled: true,
        command: config.codex.command,
        model: config.codex.model,
      },
      claude: {
        enabled: config.claude.enabled,
        command: config.claude.command,
        model: config.claude.model,
        outputFormat: config.claude.outputFormat,
        permissionMode: config.claude.permissionMode,
        allowedTools: config.claude.allowedTools,
        disallowedTools: config.claude.disallowedTools,
        appendSystemPromptConfigured: Boolean(config.claude.appendSystemPrompt),
        extraArgs: config.claude.extraArgs,
        envKeys: Object.keys(config.claude.env).sort(),
        redactedEnvKeys: config.claude.redactedEnvKeys,
        timeoutMs: config.claude.timeoutMs,
        stallTimeoutMs: config.claude.stallTimeoutMs,
        readTimeoutMs: config.claude.readTimeoutMs,
      },
      cursor: {
        enabled: config.cursor.enabled,
        command: config.cursor.command,
        model: config.cursor.model,
        outputFormat: config.cursor.outputFormat,
        force: config.cursor.force,
        extraArgs: config.cursor.extraArgs,
        envKeys: Object.keys(config.cursor.env).sort(),
        redactedEnvKeys: config.cursor.redactedEnvKeys,
        timeoutMs: config.cursor.timeoutMs,
        stallTimeoutMs: config.cursor.stallTimeoutMs,
        readTimeoutMs: config.cursor.readTimeoutMs,
      },
    },
    github: {
      enabled: config.github.enabled,
      endpoint: config.github.endpoint,
      owner: config.github.owner,
      repo: config.github.repo,
      defaultBaseBranch: config.github.defaultBaseBranch,
      remoteName: config.github.remoteName,
      readOnly: config.github.readOnly,
      writeEnabled: config.github.write.enabled,
      allowCreatePr: config.github.write.allowCreatePr,
      tokenConfigured: Boolean(config.github.token),
      pageSize: config.github.pageSize,
      maxPages: config.github.maxPages,
    },
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
  const value = process.env.SYMPHONIA_PROVIDER ?? readString(raw, "provider") ?? readString(agentRaw, "provider") ?? "codex";
  if (value === "codex" || value === "claude" || value === "cursor") return value;
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

function readStringRecord(record: Record<string, unknown>, ...keys: string[]): Record<string, string> {
  for (const key of keys) {
    const value = record[key];
    if (!isRecord(value)) continue;

    const entries = Object.entries(value).filter((entry): entry is [string, string] => {
      return typeof entry[1] === "string";
    });
    return Object.fromEntries(entries);
  }
  return {};
}

function readCliOutputFormat(
  record: Record<string, unknown>,
  fallback: "text" | "json" | "stream-json",
  ...keys: string[]
): "text" | "json" | "stream-json" {
  const value = readString(record, ...keys);
  if (value === "text" || value === "json" || value === "stream-json") return value;
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

function readOptionalNonnegativeInteger(
  record: Record<string, unknown>,
  fallback: number | null,
  ...keys: string[]
): number | null {
  const value = readNumber(record, ...keys);
  if (value === undefined || value === null) return fallback;
  return value;
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
