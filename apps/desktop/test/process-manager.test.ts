import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { LogBuffer } from "../src/main/log-buffer.js";
import { ManagedProcess, type SpawnFunction } from "../src/main/process-manager.js";

class FakeChild extends EventEmitter {
  pid = 1234;
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit("close", 0, signal ?? "SIGTERM"));
    return true;
  }
}

describe("ManagedProcess", () => {
  it("starts a fake process, waits for health, and redacts logs", async () => {
    const child = new FakeChild();
    const logs = new LogBuffer();
    const spawnFn: SpawnFunction = () => child;
    const manager = new ManagedProcess({
      name: "daemon",
      command: "fake",
      args: ["serve"],
      cwd: process.cwd(),
      preferredPort: 4899,
      healthPath: "/healthz",
      autoSelectPort: false,
      checkPortAvailability: false,
      spawnFn,
      fetchFn: async () => ({ ok: true, status: 200 }),
      logs,
    });

    const status = await manager.start({ GITHUB_TOKEN: "secret-value" });
    expect(status.state).toBe("running");
    expect(status.url).toBe("http://127.0.0.1:4899");
    child.stderr.write("GITHUB_TOKEN=secret-value\n");
    expect(manager.getLogs().join("\n")).toContain("GITHUB_TOKEN=[REDACTED]");
  });

  it("stops only the child it started", async () => {
    const child = new FakeChild();
    const manager = new ManagedProcess({
      name: "web",
      command: "fake",
      args: ["web"],
      cwd: process.cwd(),
      preferredPort: 4901,
      healthPath: "/issues",
      autoSelectPort: false,
      checkPortAvailability: false,
      spawnFn: () => child,
      fetchFn: async () => ({ ok: true, status: 200 }),
    });

    await manager.start();
    await manager.stop();
    expect(child.killed).toBe(true);
  });

  it("reports startup health failures without crashing callers", async () => {
    const manager = new ManagedProcess({
      name: "daemon",
      command: "fake",
      args: [],
      cwd: process.cwd(),
      preferredPort: 4903,
      healthPath: "/healthz",
      autoSelectPort: false,
      checkPortAvailability: false,
      spawnFn: () => new FakeChild(),
      fetchFn: async () => {
        throw new Error("not ready");
      },
      startupTimeoutMs: 20,
    });

    await expect(manager.start()).rejects.toThrow("did not become healthy");
    expect(manager.getStatus().state).toBe("crashed");
  });
});
