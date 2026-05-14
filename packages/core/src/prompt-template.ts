import { Issue, WorkflowConfigSummary } from "@symphonia/types";

export class PromptTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptTemplateError";
  }
}

export type PromptTemplateInput = {
  issue: Issue;
  attempt?: number | null;
  workflow: WorkflowConfigSummary;
};

export const fallbackPrompt = "You are working on an issue from the configured Linear tracker.";

const tokenPattern = /\{\{\s*([^}]+?)\s*\}\}/g;
const pathPattern = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

export function renderPromptTemplate(template: string, input: PromptTemplateInput): string {
  const source = template.trim().length > 0 ? template : fallbackPrompt;

  return source.replace(tokenPattern, (_match, expression: string) => {
    const path = expression.trim();
    if (!pathPattern.test(path)) {
      throw new PromptTemplateError(`Unsupported template expression: ${path}.`);
    }

    const value = readPath(input, path);
    if (value === undefined) {
      throw new PromptTemplateError(`Unknown template variable: ${path}.`);
    }

    return stringifyTemplateValue(value);
  });
}

function readPath(input: PromptTemplateInput, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = input;

  for (const part of parts) {
    if (!isRecord(current) || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

function stringifyTemplateValue(value: unknown): string {
  if (value === null) return "";
  if (Array.isArray(value)) return value.map((item) => stringifyTemplateValue(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
