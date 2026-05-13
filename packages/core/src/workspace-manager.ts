import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { Issue, WorkspaceInfo, WorkspaceInfoSchema } from "@symphonia/types";

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export class WorkspaceManager {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  prepareIssueWorkspace(issue: Issue): WorkspaceInfo {
    const workspaceKey = sanitizeWorkspaceKey(issue.identifier);
    const workspacePath = this.workspacePathForKey(workspaceKey);
    this.assertInsideRoot(workspacePath);

    mkdirSync(this.root, { recursive: true });
    const createdNow = !existsSync(workspacePath);
    mkdirSync(workspacePath, { recursive: true });

    return WorkspaceInfoSchema.parse({
      issueIdentifier: issue.identifier,
      workspaceKey,
      path: workspacePath,
      createdNow,
      exists: true,
    });
  }

  getIssueWorkspace(issueIdentifier: string): WorkspaceInfo {
    const workspaceKey = sanitizeWorkspaceKey(issueIdentifier);
    const workspacePath = this.workspacePathForKey(workspaceKey);
    this.assertInsideRoot(workspacePath);

    return WorkspaceInfoSchema.parse({
      issueIdentifier,
      workspaceKey,
      path: workspacePath,
      createdNow: false,
      exists: existsSync(workspacePath),
    });
  }

  listExistingWorkspaces(issueIdentifiers: string[] = []): WorkspaceInfo[] {
    const knownIdentifiers = new Map(issueIdentifiers.map((identifier) => [sanitizeWorkspaceKey(identifier), identifier]));
    if (!existsSync(this.root)) return [];

    return readdirSync(this.root)
      .filter((entry) => {
        const path = this.workspacePathForKey(entry);
        return this.isInsideRoot(path) && statSync(path).isDirectory();
      })
      .map((entry) =>
        WorkspaceInfoSchema.parse({
          issueIdentifier: knownIdentifiers.get(entry) ?? entry,
          workspaceKey: entry,
          path: this.workspacePathForKey(entry),
          createdNow: false,
          exists: true,
        }),
      );
  }

  getBeforeRemoveTarget(issueIdentifier: string): WorkspaceInfo {
    return this.getIssueWorkspace(issueIdentifier);
  }

  private workspacePathForKey(workspaceKey: string): string {
    return resolve(join(this.root, workspaceKey));
  }

  private assertInsideRoot(path: string): void {
    if (!this.isInsideRoot(path)) {
      throw new WorkspaceError(`Workspace path escaped configured root: ${path}`);
    }
  }

  private isInsideRoot(path: string): boolean {
    const absolute = resolve(path);
    const rootWithSeparator = this.root.endsWith(sep) ? this.root : `${this.root}${sep}`;
    return absolute === this.root || absolute.startsWith(rootWithSeparator) || !relative(this.root, absolute).startsWith("..");
  }
}

export function sanitizeWorkspaceKey(identifier: string): string {
  const sanitized = identifier.replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : "workspace";
}
