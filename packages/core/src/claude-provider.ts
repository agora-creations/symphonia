import { randomUUID } from "node:crypto";
import { AgentEvent, ClaudeConfig, ProviderHealth } from "@symphonia/types";
import { checkCliCommandHealth } from "./command-utils.js";
import { CliStreamRunnerError, runCliStream } from "./cli-stream-runner.js";
import { MockRunCancelledError } from "./mock-provider.js";
import { AgentProvider, ProviderRunContext } from "./provider.js";
import { nowIso } from "./time.js";

export class ClaudeProviderRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeProviderRunError";
  }
}

type ClaudeRunState = {
  sessionId: string | null;
  model: string | null;
  resultIsError: boolean;
};

export const claudeProvider: AgentProvider = {
  id: "claude",
  displayName: "Claude Code",
  health: async (config) => checkClaudeHealth(config as ClaudeConfig | undefined),
  start: runClaudeAgentProvider,
};

export async function checkClaudeHealth(config?: ClaudeConfig): Promise<ProviderHealth> {
  const resolved = config ?? defaultClaudeConfig();
  return checkCliCommandHealth({
    id: "claude",
    displayName: "Claude Code",
    commandLine: resolved.command,
    enabled: resolved.enabled,
    model: resolved.model,
    healthCheckCommand: resolved.healthCheckCommand,
    unavailableHint: "Install and authenticate Claude Code, or configure claude.command.",
    config: {
      outputFormat: resolved.outputFormat,
      permissionMode: resolved.permissionMode,
      allowedTools: resolved.allowedTools,
      disallowedTools: resolved.disallowedTools,
      envKeys: Object.keys(resolved.env).sort(),
      redactedEnvKeys: resolved.redactedEnvKeys,
    },
  });
}

export async function runClaudeAgentProvider(context: ProviderRunContext): Promise<void> {
  const config = context.workflowConfig.claude;
  const state: ClaudeRunState = { sessionId: null, model: config.model, resultIsError: false };

  if (!config.enabled) {
    await emitClaudeError(context, "Claude provider is disabled in WORKFLOW.md.", "disabled", state.sessionId);
    throw new ClaudeProviderRunError("Claude provider is disabled in WORKFLOW.md.");
  }

  await context.emit({
    id: randomUUID(),
    runId: context.run.id,
    type: "run.status",
    timestamp: nowIso(),
    status: "launching_agent",
    message: "Launching Claude Code CLI provider.",
  });

  try {
    await runCliStream({
      provider: "claude",
      runId: context.run.id,
      commandLine: config.command,
      args: buildClaudeArgs(config),
      cwd: context.workspacePath,
      input: context.renderedPrompt,
      outputFormat: config.outputFormat,
      timeoutMs: config.timeoutMs,
      stallTimeoutMs: config.stallTimeoutMs,
      readTimeoutMs: config.readTimeoutMs,
      env: config.env,
      signal: context.signal,
      emit: context.emit,
      onJson: async (value) => {
        const events = mapClaudeStreamEvent(context.run.id, value, state);
        for (const event of events) await context.emit(event);
      },
      onText: async (line) => {
        await context.emit({
          id: randomUUID(),
          runId: context.run.id,
          type: "claude.assistant.message",
          timestamp: nowIso(),
          sessionId: state.sessionId,
          message: line,
        });
      },
      onMalformedJson: async (line, error) => {
        await emitClaudeError(context, `Malformed Claude stream JSON: ${error.message}`, "malformed_json", state.sessionId);
        await context.emit({
          id: randomUUID(),
          runId: context.run.id,
          type: "provider.stderr",
          timestamp: nowIso(),
          provider: "claude",
          message: line,
        });
      },
    });

    if (state.resultIsError) {
      throw new ClaudeProviderRunError("Claude Code returned an error result.");
    }

    await context.emit({
      id: randomUUID(),
      runId: context.run.id,
      type: "run.status",
      timestamp: nowIso(),
      status: "succeeded",
      message: "Claude Code run completed successfully.",
    });
  } catch (error) {
    if (context.signal.aborted || (error instanceof CliStreamRunnerError && error.code === "aborted")) {
      throw new MockRunCancelledError();
    }

    const message = error instanceof Error ? error.message : "Claude Code provider failed.";
    await emitClaudeError(context, message, error instanceof CliStreamRunnerError ? error.code : "provider_error", state.sessionId);
    throw new ClaudeProviderRunError(message);
  }
}

export function buildClaudeArgs(config: ClaudeConfig): string[] {
  const args = ["-p", "--output-format", config.outputFormat, "--max-turns", String(config.maxTurns)];
  if (config.outputFormat === "stream-json" && !config.extraArgs.includes("--verbose")) args.push("--verbose");
  if (config.model) args.push("--model", config.model);
  if (config.permissionMode) args.push("--permission-mode", config.permissionMode);
  if (config.allowedTools.length > 0) args.push("--allowedTools", ...config.allowedTools);
  if (config.disallowedTools.length > 0) args.push("--disallowedTools", ...config.disallowedTools);
  if (config.appendSystemPrompt) args.push("--append-system-prompt", config.appendSystemPrompt);
  args.push(...config.extraArgs);
  return args;
}

export function mapClaudeStreamEvent(runId: string, value: unknown, state: ClaudeRunState): AgentEvent[] {
  if (!isRecord(value)) {
    return [claudeErrorEvent(runId, state.sessionId, "Claude stream event was not an object.", "invalid_event")];
  }

  const type = stringValue(value.type);
  const subtype = stringValue(value.subtype);
  const sessionId = stringValue(value.session_id) ?? stringValue(value.sessionId) ?? state.sessionId;
  if (sessionId) state.sessionId = sessionId;
  const model = stringValue(value.model) ?? state.model;
  if (model) state.model = model;

  if (type === "system" && subtype === "init") {
    return [
      {
        id: randomUUID(),
        runId,
        type: "claude.system.init",
        timestamp: nowIso(),
        sessionId,
        model,
        cwd: stringValue(value.cwd),
        permissionMode: stringValue(value.permissionMode) ?? stringValue(value.permission_mode),
      },
    ];
  }

  if (type === "assistant" || type === "user") {
    return mapClaudeMessage(runId, type, value, sessionId);
  }

  if (type === "result") {
    const isError = Boolean(value.is_error) || subtype === "error" || subtype === "failure";
    state.resultIsError = state.resultIsError || isError;
    const usage = readUsage(value.usage);
    return [
      {
        id: randomUUID(),
        runId,
        type: "claude.result",
        timestamp: nowIso(),
        sessionId,
        model,
        result: stringValue(value.result) ?? "",
        isError,
        numTurns: numberValue(value.num_turns) ?? numberValue(value.numTurns),
        durationMs: numberValue(value.duration_ms) ?? numberValue(value.durationMs),
        totalCostUsd: numberValue(value.total_cost_usd) ?? numberValue(value.totalCostUsd),
      },
      ...(usage
        ? [
            {
              id: randomUUID(),
              runId,
              type: "claude.usage" as const,
              timestamp: nowIso(),
              sessionId,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
            },
          ]
        : []),
    ];
  }

  if (type === "error") {
    return [claudeErrorEvent(runId, sessionId, stringValue(value.message) ?? "Claude stream reported an error.", stringValue(value.code))];
  }

  return [];
}

function mapClaudeMessage(runId: string, role: "assistant" | "user", value: Record<string, unknown>, sessionId: string | null): AgentEvent[] {
  const message = isRecord(value.message) ? value.message : value;
  const content = Array.isArray(message.content) ? message.content : [];
  const events: AgentEvent[] = [];
  const text = extractText(content.length > 0 ? content : [message]);

  if (text.length > 0) {
    events.push({
      id: randomUUID(),
      runId,
      type: role === "assistant" ? "claude.assistant.message" : "claude.user.message",
      timestamp: nowIso(),
      sessionId,
      message: text,
    });
  }

  for (const item of content) {
    if (!isRecord(item)) continue;
    if (item.type === "tool_use") {
      events.push({
        id: randomUUID(),
        runId,
        type: "claude.tool.use",
        timestamp: nowIso(),
        sessionId,
        toolName: stringValue(item.name) ?? "tool",
        toolUseId: stringValue(item.id),
        input: safeJson(item.input),
      });
    }
    if (item.type === "tool_result") {
      events.push({
        id: randomUUID(),
        runId,
        type: "claude.tool.result",
        timestamp: nowIso(),
        sessionId,
        toolUseId: stringValue(item.tool_use_id) ?? stringValue(item.toolUseId),
        status: stringValue(item.status),
        content: stringValue(item.content) ?? safeJson(item.content),
      });
    }
  }

  return events;
}

function readUsage(value: unknown): { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null {
  if (!isRecord(value)) return null;
  const inputTokens = numberValue(value.input_tokens) ?? numberValue(value.inputTokens);
  const outputTokens = numberValue(value.output_tokens) ?? numberValue(value.outputTokens);
  const totalTokens = numberValue(value.total_tokens) ?? numberValue(value.totalTokens) ?? sumNullable(inputTokens, outputTokens);
  return { inputTokens, outputTokens, totalTokens };
}

function sumNullable(left: number | null, right: number | null): number | null {
  if (left === null || right === null) return null;
  return left + right;
}

async function emitClaudeError(
  context: ProviderRunContext,
  message: string,
  code: string | number | null,
  sessionId: string | null,
): Promise<void> {
  await context.emit(claudeErrorEvent(context.run.id, sessionId, message, code));
}

function claudeErrorEvent(runId: string, sessionId: string | null, message: string, code: string | number | null | undefined): AgentEvent {
  return {
    id: randomUUID(),
    runId,
    type: "claude.error",
    timestamp: nowIso(),
    sessionId,
    message,
    code: code ?? null,
  };
}

function defaultClaudeConfig(): ClaudeConfig {
  return {
    enabled: false,
    command: "claude",
    model: "sonnet",
    maxTurns: 8,
    outputFormat: "stream-json",
    permissionMode: "default",
    allowedTools: [],
    disallowedTools: [],
    appendSystemPrompt: null,
    extraArgs: [],
    env: {},
    redactedEnvKeys: [],
    healthCheckCommand: null,
    timeoutMs: 3600000,
    stallTimeoutMs: 300000,
    readTimeoutMs: 5000,
    cwdBehavior: "workspace",
  };
}

function extractText(content: unknown[]): string {
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (isRecord(item) && typeof item.text === "string") return item.text;
      return "";
    })
    .filter(Boolean)
    .join("");
}

function safeJson(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
