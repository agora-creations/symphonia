import { describe, expect, it } from "vitest";
import {
  createNotification,
  createRequest,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  parseJsonRpcLine,
} from "../src/index";

describe("codex app-server protocol helpers", () => {
  it("creates and parses requests", () => {
    const request = createRequest(1, "thread/start", { cwd: "/tmp/workspace" });
    const parsed = parseJsonRpcLine(JSON.stringify(request));

    expect(isJsonRpcRequest(parsed)).toBe(true);
    expect(parsed).toMatchObject({ id: 1, method: "thread/start" });
  });

  it("creates and parses notifications", () => {
    const notification = createNotification("initialized");
    const parsed = parseJsonRpcLine(JSON.stringify(notification));

    expect(isJsonRpcNotification(parsed)).toBe(true);
    expect(parsed).toMatchObject({ method: "initialized" });
  });

  it("parses success and error responses by id", () => {
    const success = parseJsonRpcLine(JSON.stringify({ id: "req-1", result: { ok: true } }));
    const failure = parseJsonRpcLine(JSON.stringify({ id: "req-2", error: { code: -32000, message: "boom" } }));

    expect(isJsonRpcResponse(success)).toBe(true);
    expect(isJsonRpcResponse(failure)).toBe(true);
    expect(failure).toMatchObject({ id: "req-2", error: { message: "boom" } });
  });

  it("rejects malformed or unknown message shapes", () => {
    expect(() => parseJsonRpcLine("{bad")).toThrow();
    expect(() => parseJsonRpcLine(JSON.stringify({ result: true }))).toThrow();
  });
});
