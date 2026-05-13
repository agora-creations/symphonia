import packager from "@electron/packager";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import electronPackage from "electron/package.json" with { type: "json" };

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(import.meta.url);
const electronVersion = electronPackage.version;
const electronZipDir = process.env.ELECTRON_ZIP_DIR ?? findElectronZipDir(electronVersion);
const stageDir = resolve(appRoot, ".desktop-package");

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(resolve(stageDir, "node_modules"), { recursive: true });
cpSync(resolve(appRoot, "dist"), resolve(stageDir, "dist"), { recursive: true });
copyDependency("zod");
writeFileSync(
  resolve(stageDir, "package.json"),
  `${JSON.stringify(
    {
      name: "symphonia-desktop",
      productName: "Symphonia",
      version: "0.1.0",
      type: "module",
      main: "./dist/main/index.js",
      dependencies: {
        zod: "^3.24.2",
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

await packager({
  dir: stageDir,
  name: "Symphonia",
  out: resolve(appRoot, "out"),
  overwrite: true,
  asar: true,
  prune: false,
  electronVersion,
  ...(electronZipDir ? { electronZipDir } : {}),
  ignore: [/^\/\.data($|\/)/u, /^\/\.symphonia($|\/)/u],
});

function copyDependency(name) {
  const packagePath = require.resolve(`${name}/package.json`);
  cpSync(dirname(packagePath), resolve(stageDir, "node_modules", name), {
    recursive: true,
    dereference: true,
  });
}

function findElectronZipDir(version) {
  const roots = [
    resolve(homedir(), "Library", "Caches", "electron"),
    resolve(homedir(), ".cache", "electron"),
    process.env.LOCALAPPDATA ? resolve(process.env.LOCALAPPDATA, "electron", "Cache") : null,
  ].filter(Boolean);
  const zipNamePart = `electron-v${version}-${platform()}`;

  for (const root of roots) {
    const found = findZip(root, zipNamePart);
    if (found) return found;
  }
  return null;
}

function findZip(root, zipNamePart) {
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findZip(entryPath, zipNamePart);
      if (nested) return nested;
    }
    if (entry.isFile() && entry.name.includes(zipNamePart) && entry.name.endsWith(".zip")) {
      return root;
    }
  }
  return null;
}
