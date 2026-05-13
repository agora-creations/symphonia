import { spawn } from "node:child_process";
import { ProviderHealth, ProviderId } from "@symphonia/types";
import { nowIso } from "./time.js";

export type ParsedCommand = {
  command: string;
  args: string[];
};

export function splitCommandLine(input: string): ParsedCommand {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) current += "\\";
  if (quote) throw new Error("Unclosed quote in command.");
  if (current.length > 0) tokens.push(current);
  if (tokens.length === 0) throw new Error("Command must not be empty.");

  return { command: tokens[0]!, args: tokens.slice(1) };
}

export async function checkCodexCommandHealth(commandLine: string, timeoutMs = 3000): Promise<ProviderHealth> {
  let parsed: ParsedCommand;
  try {
    parsed = splitCommandLine(commandLine);
  } catch (error) {
    return {
        id: "codex",
        displayName: "Codex app-server",
        enabled: true,
        configured: true,
        available: false,
        command: commandLine,
        model: null,
        status: "invalid_config",
        version: null,
        error: error instanceof Error ? error.message : "Invalid Codex command.",
        hint: "Set SYMPHONIA_CODEX_COMMAND or codex.command to a valid command.",
        lastCheckedAt: nowIso(),
      };
  }

  return new Promise((resolve) => {
    const child = spawn(parsed.command, [...parsed.args, "--help"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    let settled = false;

    const finish = (health: ProviderHealth) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(health);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        id: "codex",
        displayName: "Codex app-server",
        enabled: true,
        configured: true,
        available: false,
        command: commandLine,
        model: null,
        status: "unavailable",
        version: null,
        error: `Timed out while checking command after ${timeoutMs}ms.`,
        hint: "The command exists but did not return help quickly.",
        lastCheckedAt: nowIso(),
      });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      errorOutput += chunk;
    });
    child.on("error", (error) => {
      finish({
          id: "codex",
          displayName: "Codex app-server",
          enabled: true,
          configured: true,
          available: false,
          command: commandLine,
          model: null,
          status: "unavailable",
          version: null,
          error: error.message,
          hint: "Install the Codex CLI or configure SYMPHONIA_CODEX_COMMAND.",
          lastCheckedAt: nowIso(),
        });
    });
    child.on("exit", (code) => {
      if (code === 0) {
        finish({
          id: "codex",
          displayName: "Codex app-server",
          enabled: true,
          configured: true,
          available: true,
          command: commandLine,
          model: null,
          status: "available",
          version: firstUsefulLine(output) ?? "available",
          error: null,
          hint: "Codex app-server command is available.",
          lastCheckedAt: nowIso(),
        });
      } else {
        finish({
          id: "codex",
          displayName: "Codex app-server",
          enabled: true,
          configured: true,
          available: false,
          command: commandLine,
          model: null,
          status: "unavailable",
          version: null,
          error: firstUsefulLine(errorOutput) ?? `Command exited with code ${code ?? "unknown"}.`,
          hint: "Verify the configured Codex CLI command.",
          lastCheckedAt: nowIso(),
        });
      }
    });
  });
}

export type CliHealthOptions = {
  id: Extract<ProviderId, "claude" | "cursor">;
  displayName: string;
  commandLine: string;
  enabled: boolean;
  model?: string | null;
  healthCheckCommand?: string | null;
  timeoutMs?: number;
  unavailableHint: string;
  config?: Record<string, unknown>;
};

export async function checkCliCommandHealth(options: CliHealthOptions): Promise<ProviderHealth> {
  if (!options.enabled) {
    return {
      id: options.id,
      displayName: options.displayName,
      enabled: false,
      configured: true,
      available: false,
      command: options.commandLine,
      model: options.model ?? null,
      status: "disabled",
      version: null,
      error: null,
      hint: `${options.displayName} is disabled in WORKFLOW.md.`,
      lastCheckedAt: nowIso(),
      config: options.config,
    };
  }

  const commandLine = options.healthCheckCommand ?? `${options.commandLine} --version`;
  let parsed: ParsedCommand;
  try {
    parsed = splitCommandLine(commandLine);
  } catch (error) {
    return {
      id: options.id,
      displayName: options.displayName,
      enabled: true,
      configured: false,
      available: false,
      command: options.commandLine,
      model: options.model ?? null,
      status: "invalid_config",
      version: null,
      error: error instanceof Error ? error.message : `Invalid ${options.displayName} command.`,
      hint: options.unavailableHint,
      lastCheckedAt: nowIso(),
      config: options.config,
    };
  }

  const timeoutMs = options.timeoutMs ?? 3000;

  return new Promise((resolve) => {
    const child = spawn(parsed.command, parsed.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    let settled = false;

    const finish = (health: ProviderHealth) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(health);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        id: options.id,
        displayName: options.displayName,
        enabled: true,
        configured: true,
        available: false,
        command: options.commandLine,
        model: options.model ?? null,
        status: "unavailable",
        version: null,
        error: `Timed out while checking command after ${timeoutMs}ms.`,
        hint: "The command exists but did not return version/help quickly.",
        lastCheckedAt: nowIso(),
        config: options.config,
      });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      errorOutput += chunk;
    });
    child.on("error", (error) => {
      finish({
        id: options.id,
        displayName: options.displayName,
        enabled: true,
        configured: true,
        available: false,
        command: options.commandLine,
        model: options.model ?? null,
        status: "unavailable",
        version: null,
        error: error.message,
        hint: options.unavailableHint,
        lastCheckedAt: nowIso(),
        config: options.config,
      });
    });
    child.on("exit", (code) => {
      if (code === 0) {
        finish({
          id: options.id,
          displayName: options.displayName,
          enabled: true,
          configured: true,
          available: true,
          command: options.commandLine,
          model: options.model ?? null,
          status: "available",
          version: firstUsefulLine(output) ?? firstUsefulLine(errorOutput) ?? "available",
          error: null,
          hint: `${options.displayName} command is available.`,
          lastCheckedAt: nowIso(),
          config: options.config,
        });
      } else {
        finish({
          id: options.id,
          displayName: options.displayName,
          enabled: true,
          configured: true,
          available: false,
          command: options.commandLine,
          model: options.model ?? null,
          status: "unavailable",
          version: null,
          error: firstUsefulLine(errorOutput) ?? firstUsefulLine(output) ?? `Command exited with code ${code ?? "unknown"}.`,
          hint: options.unavailableHint,
          lastCheckedAt: nowIso(),
          config: options.config,
        });
      }
    });
  });
}

function firstUsefulLine(value: string): string | null {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("WARNING:")) ?? null;
}
