import { spawn } from "node:child_process";
import { HookName, HookRun, HookRunSchema } from "@symphonia/types";
import { nowIso } from "./time.js";

export type RunHookOptions = {
  hookName: HookName;
  command: string | null;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
};

export async function runHook(options: RunHookOptions): Promise<HookRun> {
  if (!options.command) {
    return HookRunSchema.parse({
      hookName: options.hookName,
      status: "skipped",
      command: null,
      cwd: options.cwd,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      stdout: "",
      stderr: "",
      error: null,
    });
  }

  const startedAt = nowIso();
  if (options.signal?.aborted) {
    return HookRunSchema.parse({
      hookName: options.hookName,
      status: "failed",
      command: options.command,
      cwd: options.cwd,
      startedAt,
      endedAt: nowIso(),
      exitCode: null,
      stdout: "",
      stderr: "",
      error: "Hook cancelled.",
    });
  }

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let aborted = false;

  return await new Promise<HookRun>((resolve) => {
    const child = spawn("sh", ["-lc", options.command!], {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);

    const killTimer = setTimeout(() => {
      if (timedOut && child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, options.timeoutMs + 1000);

    const abortHandler = () => {
      aborted = true;
      child.kill("SIGTERM");
    };

    options.signal?.addEventListener("abort", abortHandler, { once: true });

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abortHandler);
      resolve(
        HookRunSchema.parse({
          hookName: options.hookName,
          status: "failed",
          command: options.command,
          cwd: options.cwd,
          startedAt,
          endedAt: nowIso(),
          exitCode: null,
          stdout,
          stderr,
          error: error.message,
        }),
      );
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abortHandler);

      const status = timedOut ? "timed_out" : exitCode === 0 ? "succeeded" : "failed";
      const error = timedOut ? "Hook timed out." : aborted ? "Hook cancelled." : exitCode === 0 ? null : `Hook exited with ${exitCode}.`;

      resolve(
        HookRunSchema.parse({
          hookName: options.hookName,
          status,
          command: options.command,
          cwd: options.cwd,
          startedAt,
          endedAt: nowIso(),
          exitCode,
          stdout,
          stderr,
          error,
        }),
      );
    });
  });
}
