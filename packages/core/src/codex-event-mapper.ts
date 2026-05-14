import { randomUUID } from "node:crypto";
import { AgentEvent } from "@symphonia/types";
import { JsonRpcNotification, JsonRpcRequest } from "./codex-protocol.js";
import { nowIso } from "./time.js";

type MapContext = {
  runId: string;
};

export function mapCodexNotificationToEvents(context: MapContext, notification: JsonRpcNotification): AgentEvent[] {
  const params = isRecord(notification.params) ? notification.params : {};
  const common = () => ({ id: randomUUID(), runId: context.runId, timestamp: nowIso() });

  switch (notification.method) {
    case "thread/started": {
      const thread = readRecord(params, "thread");
      const threadId = readString(thread, "id");
      if (!threadId) return [];
      return [
        {
          ...common(),
          type: "codex.thread.started",
          threadId,
          model: readString(params, "model") ?? null,
          cwd: readString(thread, "cwd") ?? readString(params, "cwd") ?? null,
        },
      ];
    }
    case "turn/started": {
      const turn = readRecord(params, "turn");
      const threadId = readString(params, "threadId");
      const turnId = readString(turn, "id");
      if (!threadId || !turnId) return [];
      return [
        {
          ...common(),
          type: "codex.turn.started",
          threadId,
          turnId,
          status: readString(turn, "status") ?? "inProgress",
        },
      ];
    }
    case "turn/completed": {
      const turn = readRecord(params, "turn");
      const threadId = readString(params, "threadId");
      const turnId = readString(turn, "id");
      if (!threadId || !turnId) return [];
      const status = readString(turn, "status") ?? "completed";
      const errorRecord = readRecord(turn, "error");
      const error = readString(errorRecord, "message") ?? stringifyLimited(turn.error);
      return [
        {
          ...common(),
          type: "codex.turn.completed",
          threadId,
          turnId,
          status,
          error: error ?? null,
        },
        {
          ...common(),
          type: "run.status",
          status: status === "completed" ? "succeeded" : status === "interrupted" ? "cancelled" : "failed",
          message: `Codex turn ${status}.`,
          error: status === "failed" ? (error ?? "Codex turn failed.") : undefined,
        },
      ];
    }
    case "item/started":
    case "item/completed": {
      const item = readRecord(params, "item");
      const threadId = readString(params, "threadId");
      const turnId = readString(params, "turnId");
      const itemId = readString(item, "id");
      const itemType = readString(item, "type");
      if (!threadId || !turnId || !itemId || !itemType) return [];
      return [
        {
          ...common(),
          type: notification.method === "item/started" ? "codex.item.started" : "codex.item.completed",
          threadId,
          turnId,
          itemId,
          itemType,
          summary: summarizeThreadItem(item),
        },
      ];
    }
    case "item/agentMessage/delta": {
      const threadId = readString(params, "threadId");
      const turnId = readString(params, "turnId");
      const itemId = readString(params, "itemId");
      if (!threadId || !turnId || !itemId) return [];
      return [
        {
          ...common(),
          type: "codex.assistant.delta",
          threadId,
          turnId,
          itemId,
          delta: readString(params, "delta") ?? "",
        },
      ];
    }
    case "thread/tokenUsage/updated": {
      const tokenUsage = readRecord(params, "tokenUsage");
      const total = readRecord(tokenUsage, "total");
      const threadId = readString(params, "threadId");
      const turnId = readString(params, "turnId");
      if (!threadId || !turnId) return [];
      return [
        {
          ...common(),
          type: "codex.usage",
          threadId,
          turnId,
          inputTokens: readNumber(total, "inputTokens") ?? 0,
          outputTokens: readNumber(total, "outputTokens") ?? 0,
          totalTokens: readNumber(total, "totalTokens") ?? 0,
        },
      ];
    }
    case "error": {
      const error = readRecord(params, "error");
      return [
        {
          ...common(),
          type: "codex.error",
          message: readString(error, "message") ?? stringifyLimited(params) ?? "Codex app-server error.",
          code: readString(error, "codexErrorInfo") ?? null,
        },
      ];
    }
    default:
      return [];
  }
}

export function mapCodexServerRequestToApproval(
  context: MapContext,
  request: JsonRpcRequest,
): AgentEvent | null {
  const params = isRecord(request.params) ? request.params : {};
  const approvalType = request.method.includes("commandExecution")
    ? "command"
    : request.method.includes("fileChange")
      ? "file_change"
      : "unknown";
  const requestApprovalId = readString(params, "approvalId");
  const approvalId = requestApprovalId ?? `${context.runId}:${String(request.id)}`;
  const command = readString(params, "command");
  const cwd = readString(params, "cwd");
  const reason = readString(params, "reason");
  const fileSummary =
    readString(params, "grantRoot") ??
    readString(params, "fileSummary") ??
    readString(params, "summary") ??
    summarizeFileChangeRequest(params);
  const availableDecisions = readDecisionArray(params.availableDecisions);
  const prompt =
    approvalType === "command"
      ? `Approve command${command ? `: ${command}` : ""}`
      : approvalType === "file_change"
        ? `Approve file changes${fileSummary ? ` under ${fileSummary}` : ""}`
        : "Approve Codex request";

  return {
    id: randomUUID(),
    runId: context.runId,
    type: "approval.requested",
    timestamp: nowIso(),
    approvalId,
    prompt,
    approvalType,
    threadId: readString(params, "threadId") ?? null,
    turnId: readString(params, "turnId") ?? null,
    itemId: readString(params, "itemId") ?? null,
    reason: reason ?? null,
    command: command ?? null,
    cwd: cwd ?? null,
    fileSummary: fileSummary ?? null,
    availableDecisions,
  };
}

export function summarizeThreadItem(item: Record<string, unknown>): string {
  const type = readString(item, "type") ?? "item";

  switch (type) {
    case "agentMessage":
      return readString(item, "text") ?? "Assistant message.";
    case "commandExecution":
      return [
        readString(item, "command") ?? "Command execution",
        readString(item, "aggregatedOutput"),
        readNumber(item, "exitCode") !== undefined ? `exit ${readNumber(item, "exitCode")}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");
    case "fileChange":
      return stringifyLimited(item.changes) ?? "File change.";
    case "mcpToolCall":
      return `MCP tool: ${readString(item, "server") ?? "unknown"}/${readString(item, "tool") ?? "unknown"}`;
    case "dynamicToolCall":
      return `Tool: ${readString(item, "tool") ?? "unknown"}`;
    case "userMessage":
      return "User prompt submitted.";
    case "reasoning":
      return "Reasoning updated.";
    default:
      return type;
  }
}

function readDecisionArray(value: unknown): Array<"accept" | "acceptForSession" | "decline" | "cancel"> {
  if (!Array.isArray(value)) return ["accept", "decline", "cancel"];
  const decisions = value.filter(
    (item): item is "accept" | "acceptForSession" | "decline" | "cancel" =>
      item === "accept" || item === "acceptForSession" || item === "decline" || item === "cancel",
  );
  return decisions.length > 0 ? decisions : ["accept", "decline", "cancel"];
}

function summarizeFileChangeRequest(params: Record<string, unknown>): string | undefined {
  const paths = readStringArray(params.files ?? params.paths);
  if (paths.length > 0) {
    const preview = paths.slice(0, 5).join(", ");
    const remaining = Math.max(0, paths.length - 5);
    return `${paths.length} file change ${paths.length === 1 ? "path" : "paths"}: ${preview}${remaining > 0 ? `, and ${remaining} more` : ""}`;
  }
  return stringifyLimited(params.changes ?? params.edits, 600) ?? undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return isRecord(value) ? value : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function stringifyLimited(value: unknown, limit = 4000): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
