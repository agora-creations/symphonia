# Workspace Isolation And Run Ownership

Milestone 15W makes one invariant explicit:

A run that may ever produce a PR must own an isolated git workspace. It must never rely on a plain directory under the main checkout.

Milestone 15W does not create PRs, push branches, or enable external writes.

There is no user-facing Demo Mode in this milestone.

## Why Directory-Only Workspaces Are Not PR-Capable

A plain directory under the main checkout can resolve upward into the app repository. When that happens, git status and diff are taken from the developer checkout instead of a run-owned workspace. That can expose unrelated implementation changes, local progress files, deleted files, or secrets.

Directory-only workspaces are acceptable as historical run locations and local read contexts. They are not acceptable as sources for external GitHub writes.

## Isolated Run Workspace

An isolated run workspace is PR-capable only when:

- it has persisted ownership metadata for the run;
- it belongs to the selected run id and issue;
- it has its own git worktree or git clone working tree;
- `git rev-parse --show-toplevel` inside the workspace resolves to the workspace path;
- it does not resolve to the main Symphonia checkout;
- its remote matches the configured target repository;
- it has a safe generated head branch;
- its base branch and base commit are known;
- live diff and approval evidence can be compared by path.

The preferred workspace kind is `git_worktree`. A `git_clone` fallback is acceptable only when worktree creation is not practical and the fallback is explicit, typed, tested, and still isolated.

## Legacy Or Non-Isolated Workspace

A legacy workspace is any workspace that lacks durable ownership metadata or is only a directory. A legacy workspace remains readable for run history, approval evidence, review artifacts, and timeline reconstruction, but GitHub PR preflight must block it.

Legacy classification includes:

- old `.symphonia/workspaces/<issue>` directories;
- paths that resolve upward into the main checkout;
- paths outside the configured or persisted workspace root;
- workspaces missing ownership metadata;
- workspaces whose git top-level is not the workspace path.

Old runs are not silently migrated.

## Git Worktree Isolation

For new git-backed runs, Symphonia prepares a git worktree:

1. Detect the source repository git root.
2. Resolve the configured target repository and remote.
3. Choose a PR-capable workspace root outside the source checkout.
4. Generate a run-specific workspace path.
5. Generate a safe run-specific head branch.
6. Resolve the base branch or base commit.
7. Run `git worktree add -b <head> <workspace> <base>`.
8. Verify the workspace git top-level equals the workspace path.
9. Persist ownership metadata before provider execution.

The provider runs inside the isolated workspace path.

## Clone Fallback

Clone fallback is deferred unless worktree creation proves impractical. If implemented later, it must preserve the same ownership, branch, remote, and top-level checks as worktrees.

## Workspace Root

Workspace roots inside the source checkout are unsafe by default because directory-only workspaces there can inherit the parent checkout's git root.

The recommended root is outside the source repository, for example:

```yaml
workspace:
  root: "~/.symphonia/workspaces"
```

If a configured root points inside the source checkout, Symphonia must not consider directory-only workspaces PR-eligible. It may choose a documented external root for worktree creation, or block with a clear reason. It must not delete or move old workspace directories.

## Ownership Metadata

Ownership metadata is persisted locally before provider execution and includes:

- workspace id;
- run id;
- issue id and key;
- source repository path and git root;
- workspace path and git root;
- workspace kind;
- isolation status;
- PR eligibility;
- base branch;
- head branch;
- base commit;
- remote name and URL;
- target repository;
- creation and preparation timestamps;
- owner;
- metadata version;
- blocking reasons and warnings.

This metadata survives daemon restart through the local event store.

## Restart Reconstruction

After daemon restart, run history is reconstructed from persisted run records and events. Workspace ownership is reconstructed from the persisted ownership record. If a run has a workspace path but no ownership metadata, it remains readable and PR-blocked.

## PR Preflight Integration

GitHub PR preflight uses ownership metadata as the workspace authority. It blocks when:

- ownership metadata is missing;
- workspace kind is `directory`;
- isolation status is not `isolated`;
- PR eligibility is `blocked`;
- workspace does not belong to the run;
- workspace resolves to the main checkout;
- workspace git top-level is not the workspace path;
- target repository, remote, base branch, or head branch does not match ownership metadata;
- branch or PR ownership is ambiguous;
- live diff does not match approval evidence;
- GitHub write mode is read-only or disabled.

Preflight may pass workspace-isolation checks only for `git_worktree` or `git_clone` workspaces with durable ownership metadata.

## Branch Naming

Generated branches use this shape:

```text
codex/<issue-key-or-slug>-<run-short-id>
```

Branch names must be specific enough to avoid ownership ambiguity and must not target protected/default branches.

## Target Repo And Base Branch

The target repository comes from `WORKFLOW.md` GitHub configuration. The base branch comes from `github.default_base_branch`. Worktree creation resolves the base commit from `origin/<base>`, `<base>`, or `HEAD`, in that order.

## Cleanup

Workspace cleanup remains conservative and deferred. This milestone does not delete existing user workspaces, remove old worktrees, or migrate old runs. Future cleanup must be preview-first and respect ownership metadata.

## Implemented In This Milestone

- Typed workspace ownership and validation shapes.
- Durable local ownership persistence.
- Isolated git worktree preparation for new git-backed runs.
- Provider startup against isolated workspace paths.
- PR preflight enforcement using persisted ownership metadata.
- UI surfacing for workspace kind, isolation status, ownership metadata, and PR eligibility.
- Tests with temporary git repositories and fake transports.

## Deferred

- Real GitHub PR creation.
- Branch push enablement.
- Linear comments or status updates.
- Clone fallback beyond explicit test fixtures.
- Migration of old workspaces.
- Broad runtime management and cleanup automation.
