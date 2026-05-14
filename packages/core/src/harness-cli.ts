import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { scanHarnessRepository } from "./harness-scanner.js";

type CliOptions = {
  path: string;
  json: boolean;
  output: string | null;
  includePreviews: boolean;
};

const options = parseArgs(process.argv.slice(2));
const result = scanHarnessRepository({
  repositoryPath: resolve(options.path),
  includeGitStatus: true,
  includeDocs: true,
  includeScripts: true,
  includePackageMetadata: true,
  includeWorkflow: true,
  includeAgentsMd: true,
  includeCi: true,
  includeSecurity: true,
  includeAccessibility: true,
  includeGeneratedPreviews: options.includePreviews,
});

if (options.output) {
  writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

if (options.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(`Agent readiness: ${result.score.percentage}% (${result.grade})\n`);
  for (const category of result.categories) {
    process.stdout.write(`- ${category.label}: ${Math.round((category.score / category.max) * 100)}% ${category.status}\n`);
  }
  if (result.warnings.length > 0) {
    process.stdout.write(`Warnings:\n${result.warnings.map((warning) => `- ${warning}`).join("\n")}\n`);
  }
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {
    path: ".",
    json: false,
    output: null,
    includePreviews: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--path") {
      parsed.path = args[++index] ?? ".";
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--output") {
      parsed.output = args[++index] ?? null;
    } else if (arg === "--include-previews") {
      parsed.includePreviews = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: pnpm harness:scan --path <repo> [--json] [--output report.json] [--include-previews]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}
