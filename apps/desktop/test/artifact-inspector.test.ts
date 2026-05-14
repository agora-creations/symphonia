import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type ArtifactReport = {
  failures: string[];
  warnings: string[];
};

describe("desktop artifact inspector", () => {
  it("accepts a package tree with app metadata and no denied runtime data", async () => {
    const root = makePackageTree();

    const report = await inspect(root);

    expect(report.failures).toEqual([]);
  });

  it("rejects environment files in package output", async () => {
    const root = makePackageTree();
    writeFileSync(resolve(root, "Symphonia.app", "Contents", "Resources", ".env.local"), "TOKEN=secret\n");

    const report = await inspect(root);

    expect(report.failures.join("\n")).toContain("environment file");
  });

  it("rejects test files inside app.asar", async () => {
    const root = makePackageTree(["dist/main/index.js", "test/fixture.test.js"]);

    const report = await inspect(root);

    expect(report.failures.join("\n")).toContain("test or fixture file");
  });
});

async function inspect(root: string): Promise<ArtifactReport> {
  const module = (await import("../scripts/inspect-artifact.mjs")) as {
    inspectArtifact(rootPath: string): ArtifactReport;
  };
  return module.inspectArtifact(root);
}

function makePackageTree(asarFiles = ["dist/main/index.js", "package.json"]): string {
  const root = mkdtempSync(resolve(tmpdir(), "symphonia-artifact-"));
  const contents = resolve(root, "Symphonia.app", "Contents");
  const macos = resolve(contents, "MacOS");
  const resources = resolve(contents, "Resources");
  mkdirSync(macos, { recursive: true });
  mkdirSync(resources, { recursive: true });
  writeFileSync(resolve(contents, "Info.plist"), "<plist></plist>");
  writeFileSync(resolve(macos, "Symphonia"), "#!/bin/sh\n");
  chmodSync(resolve(macos, "Symphonia"), 0o755);
  writeFileSync(resolve(resources, "app.asar"), makeAsarHeader(asarFiles));
  return root;
}

function makeAsarHeader(paths: string[]): Buffer {
  const header = { files: treeFromPaths(paths) };
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const buffer = Buffer.alloc(16 + json.length);
  buffer.writeUInt32LE(4, 0);
  buffer.writeUInt32LE(json.length + 12, 4);
  buffer.writeUInt32LE(json.length + 8, 8);
  buffer.writeUInt32LE(json.length, 12);
  json.copy(buffer, 16);
  return buffer;
}

function treeFromPaths(paths: string[]): Record<string, unknown> {
  const root: Record<string, { files?: Record<string, unknown>; size?: number; offset?: string }> = {};
  for (const path of paths) {
    const parts = path.split("/");
    let cursor = root;
    for (const [index, part] of parts.entries()) {
      const isFile = index === parts.length - 1;
      if (isFile) {
        cursor[part] = { size: 0, offset: "0" };
        continue;
      }
      const existing = cursor[part];
      if (!existing || !("files" in existing)) {
        cursor[part] = { files: {} };
      }
      cursor = cursor[part].files as Record<string, { files?: Record<string, unknown>; size?: number; offset?: string }>;
    }
  }
  return root;
}
