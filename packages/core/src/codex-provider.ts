import { randomUUID } from "node:crypto";
import { checkCodexCommandHealth } from "./command-utils.js";
import { CodexAppServerClient } from "./codex-client.js";
import { ProviderRunCancelledError } from "./provider-errors.js";
import { AgentProvider, ProviderRunContext } from "./provider.js";
import { nowIso } from "./time.js";

export class CodexProviderRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexProviderRunError";
  }
}

export const codexProvider: AgentProvider = {
  id: "codex",
  displayName: "Codex app-server",
  health: async (config) => checkCodexCommandHealth(config?.command ?? "codex app-server"),
  start: runCodexAgentProvider,
};

export async function runCodexAgentProvider(context: ProviderRunContext): Promise<void> {
  await context.emit({
    id: randomUUID(),
    runId: context.run.id,
    type: "run.status",
    timestamp: nowIso(),
    status: "launching_agent",
    message: "Launching Codex app-server provider.",
  });

  const client = new CodexAppServerClient();

  try {
    await client.run({
      runId: context.run.id,
      command: context.codexConfig.command,
      cwd: context.workspacePath,
      prompt: context.renderedPrompt,
      codexConfig: context.codexConfig,
      signal: context.signal,
      emit: context.emit,
      requestApproval: context.requestApproval,
    });
  } catch (error) {
    if (context.signal.aborted) {
      throw new ProviderRunCancelledError();
    }

    await context.emit({
      id: randomUUID(),
      runId: context.run.id,
      type: "codex.error",
      timestamp: nowIso(),
      message: error instanceof Error ? error.message : "Codex provider failed.",
      code: "provider_error",
    });

    throw new CodexProviderRunError(error instanceof Error ? error.message : "Codex provider failed.");
  }
}
