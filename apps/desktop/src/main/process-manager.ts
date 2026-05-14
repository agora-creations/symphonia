import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import type { ManagedProcessStatus } from "../shared/schemas.js";
import { LogBuffer, redactSecrets } from "./log-buffer.js";
import { findAvailablePort, isPortAvailable } from "./port-utils.js";
import { nowIso } from "./path-utils.js";

export type SpawnedProcess = Pick<ChildProcessByStdio<null, Readable, Readable>, "pid" | "kill" | "on" | "stdout" | "stderr">;
export type SpawnFunction = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => SpawnedProcess;
export type HealthFetch = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>;

export type ManagedProcessOptions = {
  name: string;
  command: string;
  args: string[];
  cwd: string | (() => string);
  env?: NodeJS.ProcessEnv;
  preferredPort: number;
  healthPath: string;
  portEnvVar?: string;
  autoSelectPort?: boolean;
  checkPortAvailability?: boolean;
  spawnFn?: SpawnFunction;
  fetchFn?: HealthFetch;
  logs?: LogBuffer;
  startupTimeoutMs?: number;
};

export class ManagedProcess {
  private child: SpawnedProcess | null = null;
  private stopping = false;
  private status: ManagedProcessStatus;
  private readonly logs: LogBuffer;
  private readonly spawnFn: SpawnFunction;
  private readonly fetchFn: HealthFetch;

  constructor(private readonly options: ManagedProcessOptions) {
    this.logs = options.logs ?? new LogBuffer();
    this.spawnFn =
      options.spawnFn ??
      ((command, args, spawnOptions) =>
        spawn(command, args, {
          cwd: spawnOptions.cwd,
          env: spawnOptions.env,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        }));
    this.fetchFn =
      options.fetchFn ??
      (async (url, init) => {
        const response = await fetch(url, init);
        return { ok: response.ok, status: response.status };
      });
    this.status = {
      state: "stopped",
      pid: null,
      port: null,
      url: null,
      startedAt: null,
      stoppedAt: null,
      exitCode: null,
      signal: null,
      error: null,
    };
  }

  getStatus(): ManagedProcessStatus {
    return { ...this.status };
  }

  getLogs(): string[] {
    return this.logs.snapshot();
  }

  async start(extraEnv: NodeJS.ProcessEnv = {}): Promise<ManagedProcessStatus> {
    if (this.child && (this.status.state === "running" || this.status.state === "starting")) {
      return this.getStatus();
    }

    const port =
      this.options.autoSelectPort === false
        ? this.options.preferredPort
        : await findAvailablePort(this.options.preferredPort);
    if (this.options.autoSelectPort === false && this.options.checkPortAvailability !== false && !(await isPortAvailable(port))) {
      throw new Error(`${this.options.name} port ${port} is already in use.`);
    }

    const url = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      ...this.options.env,
      ...extraEnv,
      PORT: String(port),
      ...(this.options.portEnvVar ? { [this.options.portEnvVar]: String(port) } : {}),
      SYMPHONIA_DESKTOP_MANAGED: "1",
    };

    this.logs.append(`${this.options.name}: starting ${this.options.command} ${this.options.args.join(" ")} on ${url}`);
    this.status = {
      state: "starting",
      pid: null,
      port,
      url,
      startedAt: nowIso(),
      stoppedAt: null,
      exitCode: null,
      signal: null,
      error: null,
    };

    try {
      const child = this.spawnFn(this.options.command, this.options.args, {
        cwd: this.getCwd(),
        env,
      });
      this.child = child;
      this.stopping = false;
      this.status = { ...this.status, pid: child.pid ?? null };
      child.stdout.on("data", (chunk) => this.logs.appendChunk(`${this.options.name}:stdout`, chunk));
      child.stderr.on("data", (chunk) => this.logs.appendChunk(`${this.options.name}:stderr`, chunk));
      child.on("error", (error) => {
        this.logs.append(`${this.options.name}: error ${redactSecrets(error.message)}`);
        this.status = { ...this.status, state: "crashed", error: redactSecrets(error.message), stoppedAt: nowIso() };
      });
      child.on("close", (code, signal) => {
        const state = this.stopping ? "stopped" : "crashed";
        this.logs.append(`${this.options.name}: ${state} code=${code ?? "null"} signal=${signal ?? "null"}`);
        this.status = {
          ...this.status,
          state,
          exitCode: code,
          signal,
          stoppedAt: nowIso(),
          error: state === "crashed" ? `${this.options.name} exited unexpectedly.` : null,
        };
        this.child = null;
      });
      await this.waitForHealth();
      this.status = { ...this.status, state: "running", error: null };
      return this.getStatus();
    } catch (error) {
      this.status = {
        ...this.status,
        state: "crashed",
        error: redactSecrets(error instanceof Error ? error.message : String(error)),
        stoppedAt: nowIso(),
      };
      throw error;
    }
  }

  async stop(): Promise<ManagedProcessStatus> {
    if (!this.child) {
      this.status = { ...this.status, state: "stopped", stoppedAt: nowIso() };
      return this.getStatus();
    }

    this.stopping = true;
    this.status = { ...this.status, state: "stopping" };
    this.killChild("SIGTERM");
    await delay(500);
    if (this.child) {
      this.killChild("SIGKILL");
    }
    return this.getStatus();
  }

  async restart(extraEnv: NodeJS.ProcessEnv = {}): Promise<ManagedProcessStatus> {
    await this.stop();
    return this.start(extraEnv);
  }

  private async waitForHealth(): Promise<void> {
    const timeoutMs = this.options.startupTimeoutMs ?? 45_000;
    const started = Date.now();
    const url = `${this.status.url}${this.options.healthPath}`;

    while (Date.now() - started < timeoutMs) {
      if (this.status.state === "crashed") {
        throw new Error(this.status.error ?? `${this.options.name} crashed during startup.`);
      }
      try {
        const response = await this.fetchFn(url, { cache: "no-store" });
        if (response.ok || response.status < 500) return;
      } catch {
        // Keep polling until the process is ready or the startup timeout expires.
      }
      await delay(500);
    }

    throw new Error(`${this.options.name} did not become healthy at ${url} within ${timeoutMs}ms.`);
  }

  private getCwd(): string {
    return typeof this.options.cwd === "function" ? this.options.cwd() : this.options.cwd;
  }

  private killChild(signal: NodeJS.Signals): void {
    const child = this.child;
    if (!child) return;

    if (process.platform !== "win32" && typeof child.pid === "number") {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // Fall through to direct child kill if the process group is already gone.
      }
    }

    child.kill(signal);
  }
}
