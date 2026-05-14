import { randomUUID } from "node:crypto";
import { AgentEvent, CursorConfig, ProviderHealth } from "@symphonia/types";
import { checkCliCommandHealth } from "./command-utils.js";
import { CliStreamRunnerError, runCliStream } from "./cli-stream-runner.js";
import { ProviderRunCancelledError } from "./provider-errors.js";
import { AgentProvider, ProviderRunContext } from "./provider.js";
import { nowIso } from "./time.js";

export class CursorProviderRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CursorProviderRunError";
  }
}

type CursorRunState = {
  sessionId: string | null;
  requestId: string | null;
  model: string | null;
  resultIsError: boolean;
  assistantText: string;
};

export const cursorProvider: AgentProvider = {
  id: "cursor",
  displayName: "Cursor Agent",
  health: async (config) => checkCursorHealth(config as CursorConfig | undefined),
  start: runCursorAgentProvider,
};

export async function checkCursorHealth(config?: CursorConfig): Promise<ProviderHealth> {
  const resolved = config ?? defaultCursorConfig();
  return checkCliCommandHealth({
    id: "cursor",
    displayName: "Cursor Agent",
    commandLine: resolved.command,
    enabled: resolved.enabled,
    model: resolved.model,
    healthCheckCommand: resolved.healthCheckCommand,
    unavailableHint: "Install and authenticate Cursor Agent, set CURSOR_API_KEY, or configure cursor.command.",
    config: {
      outputFormat: resolved.outputFormat,
      force: resolved.force,
      envKeys: Object.keys(resolved.env).sort(),
      redactedEnvKeys: resolved.redactedEnvKeys,
    },
  });
}

export async function runCursorAgentProvider(context: ProviderRunContext): Promise<void> {
  const config = context.workflowConfig.cursor;
  const state: CursorRunState = {
    sessionId: null,
    requestId: null,
    model: config.model,
    resultIsError: false,
    assistantText: "",
  };

  if (!config.enabled) {
    await emitCursorError(context, "Cursor provider is disabled in WORKFLOW.md.", "disabled", state);
    throw new CursorProviderRunError("Cursor provider is disabled in WORKFLOW.md.");
  }

  await context.emit({
    id: randomUUID(),
    runId: context.run.id,
    type: "run.status",
    timestamp: nowIso(),
    status: "launching_agent",
    message: "Launching Cursor Agent CLI provider.",
  });

  try {
    await runCliStream({
      provider: "cursor",
      runId: context.run.id,
      commandLine: config.command,
      args: buildCursorArgs(config),
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
        const events = mapCursorStreamEvent(context.run.id, value, state);
        for (const event of events) await context.emit(event);
      },
      onText: async (line) => {
        await context.emit({
          id: randomUUID(),
          runId: context.run.id,
          type: "cursor.assistant.message",
          timestamp: nowIso(),
          sessionId: state.sessionId,
          requestId: state.requestId,
          message: line,
        });
      },
      onMalformedJson: async (line, error) => {
        await emitCursorError(context, `Malformed Cursor stream JSON: ${error.message}`, "malformed_json", state);
        await context.emit({
          id: randomUUID(),
          runId: context.run.id,
          type: "provider.stderr",
          timestamp: nowIso(),
          provider: "cursor",
          message: line,
        });
      },
    });

    if (state.resultIsError) {
      throw new CursorProviderRunError("Cursor Agent returned an error result.");
    }

    if (state.assistantText.length > 0) {
      await context.emit({
        id: randomUUID(),
        runId: context.run.id,
        type: "cursor.assistant.message",
        timestamp: nowIso(),
        sessionId: state.sessionId,
        requestId: state.requestId,
        message: state.assistantText,
      });
    }

    await context.emit({
      id: randomUUID(),
      runId: context.run.id,
      type: "run.status",
      timestamp: nowIso(),
      status: "succeeded",
      message: "Cursor Agent run completed successfully.",
    });
  } catch (error) {
    if (context.signal.aborted || (error instanceof CliStreamRunnerError && error.code === "aborted")) {
      throw new ProviderRunCancelledError();
    }

    const message = error instanceof Error ? error.message : "Cursor Agent provider failed.";
    await emitCursorError(context, message, error instanceof CliStreamRunnerError ? error.code : "provider_error", state);
    throw new CursorProviderRunError(message);
  }
}

export function buildCursorArgs(config: CursorConfig): string[] {
  const args = ["--print", "--output-format", config.outputFormat];
  if (config.model) args.push("--model", config.model);
  if (config.force) args.push("--force");
  args.push(...config.extraArgs);
  return args;
}

export function mapCursorStreamEvent(runId: string, value: unknown, state: CursorRunState): AgentEvent[] {
  if (!isRecord(value)) {
    return [cursorErrorEvent(runId, state, "Cursor stream event was not an object.", "invalid_event")];
  }

  const type = stringValue(value.type);
  const subtype = stringValue(value.subtype);
  const sessionId = stringValue(value.session_id) ?? stringValue(value.sessionId) ?? state.sessionId;
  const requestId = stringValue(value.request_id) ?? stringValue(value.requestId) ?? state.requestId;
  if (sessionId) state.sessionId = sessionId;
  if (requestId) state.requestId = requestId;
  const model = stringValue(value.model) ?? state.model;
  if (model) state.model = model;

  if (type === "system" && subtype === "init") {
    return [
      {
        id: randomUUID(),
        runId,
        type: "cursor.system.init",
        timestamp: nowIso(),
        sessionId,
        requestId,
        model,
        cwd: stringValue(value.cwd),
        permissionMode: stringValue(value.permissionMode) ?? stringValue(value.permission_mode),
        apiKeySource: stringValue(value.apiKeySource) ?? stringValue(value.api_key_source),
      },
    ];
  }

  if (type === "assistant") {
    const text = extractMessageText(value);
    if (text.length === 0) return [];
    state.assistantText += text;
    return [
      {
        id: randomUUID(),
        runId,
        type: "cursor.assistant.delta",
        timestamp: nowIso(),
        sessionId,
        requestId,
        delta: text,
      },
    ];
  }

  if (type === "tool_call") {
    return mapCursorToolCall(runId, value, state, subtype);
  }

  if (type === "result") {
    const isError = Boolean(value.is_error) || subtype === "error" || subtype === "failure";
    state.resultIsError = state.resultIsError || isError;
    const usage = readUsage(value.usage);
    return [
      {
        id: randomUUID(),
        runId,
        type: "cursor.result",
        timestamp: nowIso(),
        sessionId,
        requestId,
        model,
        result: stringValue(value.result) ?? "",
        isError,
        durationMs: numberValue(value.duration_ms) ?? numberValue(value.durationMs),
        durationApiMs: numberValue(value.duration_api_ms) ?? numberValue(value.durationApiMs),
      },
      ...(usage
        ? [
            {
              id: randomUUID(),
              runId,
              type: "cursor.usage" as const,
              timestamp: nowIso(),
              sessionId,
              requestId,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
            },
          ]
        : []),
    ];
  }

  if (type === "error") {
    return [cursorErrorEvent(runId, state, stringValue(value.message) ?? "Cursor stream reported an error.", stringValue(value.code))];
  }

  return [];
}

function mapCursorToolCall(
  runId: string,
  value: Record<string, unknown>,
  state: CursorRunState,
  subtype: string | null,
): AgentEvent[] {
  const toolCall = isRecord(value.tool_call) ? value.tool_call : {};
  const nested = firstRecord(toolCall) ?? toolCall;
  const args = isRecord(nested.args) ? nested.args : null;
  const result = isRecord(nested.result) ? nested.result : null;
  const status = subtype === "completed" ? "completed" : subtype === "failed" ? "failed" : "started";
  const callId = stringValue(value.call_id) ?? stringValue(value.callId) ?? stringValue(args?.toolCallId);
  const toolName = toolNameFromCursorEvent(toolCall);

  const events: AgentEvent[] = [
    {
      id: randomUUID(),
      runId,
      type: "cursor.tool.call",
      timestamp: nowIso(),
      sessionId: state.sessionId,
      requestId: state.requestId,
      callId,
      toolName,
      status,
      input: safeJson(args ?? toolCall),
    },
  ];

  if (result || status !== "started") {
    events.push({
      id: randomUUID(),
      runId,
      type: "cursor.tool.result",
      timestamp: nowIso(),
      sessionId: state.sessionId,
      requestId: state.requestId,
      callId,
      status,
      content: safeJson(result ?? {}),
    });
  }

  return events;
}

function toolNameFromCursorEvent(toolCall: Record<string, unknown>): string {
  const key = Object.keys(toolCall).find((item) => item.endsWith("ToolCall"));
  if (!key) return "tool";
  return key.replace(/ToolCall$/, "");
}

function firstRecord(record: Record<string, unknown>): Record<string, unknown> | null {
  for (const value of Object.values(record)) {
    if (isRecord(value)) return value;
  }
  return null;
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

async function emitCursorError(
  context: ProviderRunContext,
  message: string,
  code: string | number | null,
  state: CursorRunState,
): Promise<void> {
  await context.emit(cursorErrorEvent(context.run.id, state, message, code));
}

function cursorErrorEvent(runId: string, state: CursorRunState, message: string, code: string | number | null | undefined): AgentEvent {
  return {
    id: randomUUID(),
    runId,
    type: "cursor.error",
    timestamp: nowIso(),
    sessionId: state.sessionId,
    requestId: state.requestId,
    message,
    code: code ?? null,
  };
}

function defaultCursorConfig(): CursorConfig {
  return {
    enabled: false,
    command: "cursor-agent",
    model: null,
    outputFormat: "stream-json",
    force: false,
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

function extractMessageText(value: Record<string, unknown>): string {
  const message = isRecord(value.message) ? value.message : value;
  const content = Array.isArray(message.content) ? message.content : [];
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
