import { spawn } from "node:child_process";
import { ProviderHealth } from "@symphonia/types";

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
      available: false,
      command: commandLine,
      version: null,
      error: error instanceof Error ? error.message : "Invalid Codex command.",
      hint: "Set SYMPHONIA_CODEX_COMMAND or codex.command to a valid command.",
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
        available: false,
        command: commandLine,
        version: null,
        error: `Timed out while checking command after ${timeoutMs}ms.`,
        hint: "The command exists but did not return help quickly.",
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
        available: false,
        command: commandLine,
        version: null,
        error: error.message,
        hint: "Install the Codex CLI or configure SYMPHONIA_CODEX_COMMAND.",
      });
    });
    child.on("exit", (code) => {
      if (code === 0) {
        finish({
          id: "codex",
          displayName: "Codex app-server",
          available: true,
          command: commandLine,
          version: firstUsefulLine(output) ?? "available",
          error: null,
          hint: "Codex app-server command is available.",
        });
      } else {
        finish({
          id: "codex",
          displayName: "Codex app-server",
          available: false,
          command: commandLine,
          version: null,
          error: firstUsefulLine(errorOutput) ?? `Command exited with code ${code ?? "unknown"}.`,
          hint: "Verify the configured Codex CLI command.",
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
