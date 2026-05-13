import { z } from "zod";

export const JsonRpcIdSchema = z.union([z.string(), z.number()]);
export type JsonRpcId = z.infer<typeof JsonRpcIdSchema>;

export const JsonRpcRequestSchema = z.object({
  method: z.string().min(1),
  id: JsonRpcIdSchema,
  params: z.unknown().optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const JsonRpcResponseSchema = z.object({
  id: JsonRpcIdSchema,
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number().optional(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;

export const JsonRpcNotificationSchema = z.object({
  method: z.string().min(1),
  params: z.unknown().optional(),
});
export type JsonRpcNotification = z.infer<typeof JsonRpcNotificationSchema>;

export type CodexProtocolMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export class CodexProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexProtocolError";
  }
}

export function parseJsonRpcLine(line: string): CodexProtocolMessage {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch (error) {
    throw new CodexProtocolError(error instanceof Error ? error.message : "Malformed JSON from app-server.");
  }

  if (!isRecord(decoded)) {
    throw new CodexProtocolError("App-server message must be a JSON object.");
  }

  if ("id" in decoded && ("result" in decoded || "error" in decoded)) {
    return JsonRpcResponseSchema.parse(decoded);
  }

  if ("id" in decoded && "method" in decoded) {
    return JsonRpcRequestSchema.parse(decoded);
  }

  if ("method" in decoded) {
    return JsonRpcNotificationSchema.parse(decoded);
  }

  throw new CodexProtocolError("Unknown app-server JSON-RPC message shape.");
}

export function isJsonRpcResponse(message: CodexProtocolMessage): message is JsonRpcResponse {
  return "id" in message && ("result" in message || "error" in message) && !("method" in message);
}

export function isJsonRpcRequest(message: CodexProtocolMessage): message is JsonRpcRequest {
  return "id" in message && "method" in message;
}

export function isJsonRpcNotification(message: CodexProtocolMessage): message is JsonRpcNotification {
  return "method" in message && !("id" in message);
}

export function createRequest(id: JsonRpcId, method: string, params?: unknown): JsonRpcRequest {
  return params === undefined ? { id, method } : { id, method, params };
}

export function createNotification(method: string, params?: unknown): JsonRpcNotification {
  return params === undefined ? { method } : { method, params };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
