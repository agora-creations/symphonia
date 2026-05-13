import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { AgentEvent, ProviderId } from "@symphonia/types";
import { splitCommandLine } from "./command-utils.js";
import { nowIso } from "./time.js";

const defaultMaxLineLength = 64_000;
const defaultKillGraceMs = 3000;

export class CliStreamRunnerError extends Error {
  constructor(
    message: string,
    readonly code: "spawn_failed" | "timeout" | "stalled" | "read_timeout" | "aborted" | "malformed_json" | "nonzero_exit",
  ) {
    super(message);
    this.name = "CliStreamRunnerError";
  }
}

export type CliStreamRunnerResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  malformedJsonCount: number;
};

export type CliStreamRunnerOptions = {
  provider: Extract<ProviderId, "claude" | "cursor">;
  runId: string;
  commandLine: string;
  args: string[];
  cwd: string;
  input: string;
  outputFormat: "text" | "json" | "stream-json";
  timeoutMs: number;
  stallTimeoutMs: number;
  readTimeoutMs: number;
  signal: AbortSignal;
  env?: Record<string, string>;
  maxLineLength?: number;
  emit: (event: AgentEvent) => Promise<void> | void;
  onJson: (value: unknown) => Promise<void> | void;
  onText?: (line: string) => Promise<void> | void;
  onMalformedJson?: (line: string, error: Error) => Promise<void> | void;
};

export async function runCliStream(options: CliStreamRunnerOptions): Promise<CliStreamRunnerResult> {
  const parsed = splitCommandLine(options.commandLine);
  const maxLineLength = options.maxLineLength ?? defaultMaxLineLength;
  const child = spawn(parsed.command, [...parsed.args, ...options.args], {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ["pipe", "pipe", "pipe"],
  });

  await options.emit(
    buildProviderStartedEvent({
      runId: options.runId,
      provider: options.provider,
      command: formatCommandForDisplay(options.commandLine, options.args),
      pid: child.pid ?? null,
    }),
  );

  let malformedJsonCount = 0;
  let settled = false;
  let sawOutput = false;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let rejectRun: ((error: Error) => void) | null = null;
  let abortRequested = options.signal.aborted;
  const pending: Array<Promise<void>> = [];

  const killChild = () => {
    if (child.killed) return;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, defaultKillGraceMs).unref();
  };

  const totalTimer = setTimeout(() => {
    killChild();
    rejectRun?.(new CliStreamRunnerError(`Provider command timed out after ${options.timeoutMs}ms.`, "timeout"));
  }, options.timeoutMs);

  const readTimer = setTimeout(() => {
    killChild();
    rejectRun?.(new CliStreamRunnerError(`Provider command produced no output after ${options.readTimeoutMs}ms.`, "read_timeout"));
  }, options.readTimeoutMs);

  let stallTimer = setTimeout(() => {
    killChild();
    rejectRun?.(new CliStreamRunnerError(`Provider command stalled after ${options.stallTimeoutMs}ms without output.`, "stalled"));
  }, options.stallTimeoutMs);

  const clearTimers = () => {
    clearTimeout(totalTimer);
    clearTimeout(readTimer);
    clearTimeout(stallTimer);
  };

  const markOutput = () => {
    sawOutput = true;
    clearTimeout(readTimer);
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      killChild();
      rejectRun?.(new CliStreamRunnerError(`Provider command stalled after ${options.stallTimeoutMs}ms without output.`, "stalled"));
    }, options.stallTimeoutMs);
  };

  const abort = () => {
    abortRequested = true;
    killChild();
    rejectRun?.(new CliStreamRunnerError("Provider command was aborted.", "aborted"));
  };

  options.signal.addEventListener("abort", abort, { once: true });

  child.stdin.setDefaultEncoding("utf8");
  child.stdin.end(options.input);

  const stdout = readline.createInterface({ input: child.stdout });
  const stderr = readline.createInterface({ input: child.stderr });

  stdout.on("line", (line) => {
    const handled = (async () => {
      markOutput();
      const bounded = boundLine(line, maxLineLength);
      if (options.outputFormat === "stream-json" || options.outputFormat === "json") {
        try {
          await options.onJson(JSON.parse(bounded));
        } catch (error) {
          malformedJsonCount += 1;
          await options.onMalformedJson?.(bounded, error instanceof Error ? error : new Error("Malformed JSON line."));
        }
      } else {
        await options.onText?.(bounded);
      }
    })();
    pending.push(handled);
  });

  stderr.on("line", (line) => {
    const handled = (async () => {
      markOutput();
      const bounded = boundLine(line, maxLineLength);
      await options.emit(
        buildProviderStderrEvent({
          runId: options.runId,
          provider: options.provider,
          message: bounded,
        }),
      );
    })();
    pending.push(handled);
  });

  return new Promise<CliStreamRunnerResult>((resolve, reject) => {
    rejectRun = (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      options.signal.removeEventListener("abort", abort);
      stdout.close();
      stderr.close();
      reject(error);
    };

    if (abortRequested) {
      rejectRun(new CliStreamRunnerError("Provider command was aborted.", "aborted"));
      return;
    }

    child.on("error", (error) => {
      rejectRun?.(new CliStreamRunnerError(error.message, "spawn_failed"));
    });

    child.on("exit", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
    });

    child.on("close", () => {
      void (async () => {
      if (settled) return;
      settled = true;
      clearTimers();
      options.signal.removeEventListener("abort", abort);
      stdout.close();
      stderr.close();
      await Promise.allSettled(pending);

      if (options.signal.aborted) {
        reject(new CliStreamRunnerError("Provider command was aborted.", "aborted"));
        return;
      }

      if (!sawOutput && options.outputFormat !== "text") {
        reject(new CliStreamRunnerError("Provider command exited without output.", "read_timeout"));
        return;
      }

      if (malformedJsonCount > 0) {
        reject(new CliStreamRunnerError(`Provider emitted ${malformedJsonCount} malformed JSON line(s).`, "malformed_json"));
        return;
      }

      if (exitCode !== 0) {
        reject(new CliStreamRunnerError(`Provider command exited with code ${exitCode ?? "unknown"}.`, "nonzero_exit"));
        return;
      }

      resolve({ exitCode, signal: exitSignal, malformedJsonCount });
      })();
    });
  });
}

function buildProviderStartedEvent(input: {
  runId: string;
  provider: Extract<ProviderId, "claude" | "cursor">;
  command: string;
  pid: number | null;
}) {
  return {
    id: randomUUID(),
    runId: input.runId,
    type: "provider.started" as const,
    timestamp: nowIso(),
    provider: input.provider,
    command: input.command,
    pid: input.pid,
  };
}

function buildProviderStderrEvent(input: {
  runId: string;
  provider: Extract<ProviderId, "claude" | "cursor">;
  message: string;
}) {
  return {
    id: randomUUID(),
    runId: input.runId,
    type: "provider.stderr" as const,
    timestamp: nowIso(),
    provider: input.provider,
    message: input.message,
  };
}

function formatCommandForDisplay(commandLine: string, args: string[]): string {
  return [commandLine, ...args.map(quoteForDisplay)].join(" ");
}

function quoteForDisplay(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function boundLine(line: string, maxLength: number): string {
  if (line.length <= maxLength) return line;
  return `${line.slice(0, maxLength)}\n[truncated ${line.length - maxLength} characters]`;
}
