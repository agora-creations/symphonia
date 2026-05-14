import { describe, expect, it } from "vitest";
import {
  isLocalRendererUrl,
  parseExternalUrl,
  parseIpcChannel,
  parseSettingsUpdate,
  parseStarterWorkflowPath,
} from "../src/main/ipc-contracts.js";

describe("desktop IPC contracts", () => {
  it("accepts only allowlisted IPC channels", () => {
    expect(parseIpcChannel("desktop:getStatus")).toBe("desktop:getStatus");
    expect(() => parseIpcChannel("desktop:spawnShell")).toThrow();
  });

  it("validates settings updates", () => {
    expect(parseSettingsUpdate({ defaultProviderId: "claude" }).defaultProviderId).toBe("claude");
    expect(() => parseSettingsUpdate({ defaultProviderId: "danger" })).toThrow();
  });

  it("restricts external links to trusted auth URLs", () => {
    expect(parseExternalUrl("https://linear.app/example")).toBe("https://linear.app/example");
    expect(parseExternalUrl("https://github.com/login/device")).toBe("https://github.com/login/device");
    expect(parseExternalUrl("http://127.0.0.1:4100/auth/linear/callback")).toBe("http://127.0.0.1:4100/auth/linear/callback");
    expect(() => parseExternalUrl("file:///etc/passwd")).toThrow();
    expect(() => parseExternalUrl("https://example.com")).toThrow();
  });

  it("restricts renderer navigation to configured localhost origins", () => {
    expect(isLocalRendererUrl("http://127.0.0.1:3000/issues", ["http://127.0.0.1:3000"])).toBe(true);
    expect(isLocalRendererUrl("https://example.com", ["http://127.0.0.1:3000"])).toBe(false);
  });

  it("validates starter workflow requests", () => {
    expect(parseStarterWorkflowPath({ repositoryPath: "/tmp/repo" })).toBe("/tmp/repo");
    expect(() => parseStarterWorkflowPath({ repositoryPath: "" })).toThrow();
  });
});
