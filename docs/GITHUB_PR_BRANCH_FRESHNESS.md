# GitHub PR Branch Freshness

Milestone 15C-BF adds one final non-mutating guard before the first real GitHub draft PR.

Milestone 15C-BF performs no GitHub or Linear writes.

There is no user-facing Demo Mode in this milestone.

## Why Branch Freshness Matters

Workspace isolation, approval evidence, review artifacts, live diff parity, and PR preflight can all be correct while the target base branch has moved since the run workspace was created. The first external PR write should also prove that the proposed head branch is based on a known target base and that upstream changes do not touch the same files represented by approval evidence.

Branch freshness answers:

- Was this isolated worktree created from the current target base?
- If the base moved, did upstream touch any approval-evidence changed files?
- Would publishing this branch create a stale or misleading PR?

## Stored Base Commit

The stored base commit comes from persisted workspace ownership metadata. For git worktree runs, this is recorded when `WorkspaceManager.prepareIssueWorkspace` creates the isolated workspace.

If the stored base commit is missing, freshness is `unknown` and PR execution is blocked. Legacy directory workspaces remain blocked by workspace isolation before branch freshness can make them eligible.

## Current Remote Base Commit

The current remote base commit is resolved from the configured git remote and base branch, usually:

```text
git ls-remote origin refs/heads/main
```

If the remote base commit is not already available locally, preflight may run a read-only fetch to obtain the commit object:

```text
git fetch --no-tags origin main
```

This fetch must not push, create branches, create PRs, or change the worktree. If the remote base cannot be determined or fetched, freshness is `unknown` and PR execution is blocked.

## Freshness States

`fresh` means the stored base commit equals the current remote base commit. This state does not add a blocker.

`stale_no_overlap` means the remote base branch advanced, but upstream changes since the stored base do not touch any approval-evidence changed files. This state is a warning, not a blocker, because the run diff remains file-disjoint from upstream changes.

`stale_overlap` means the remote base branch advanced and upstream changes touch at least one approval-evidence changed file. This state blocks PR execution because the run evidence may no longer represent a clean review surface.

`unknown` means preflight could not verify freshness. Unknown is blocking in this milestone.

## Upstream Changed Files

When the base advanced, preflight compares the stored base commit to the current remote base commit:

```text
git diff --name-only <stored-base>..<current-remote-base> --
```

The resulting paths are normalized the same way approval-evidence paths are normalized. Path comparison is set-based and ignores only path formatting differences such as repeated slashes or leading `./`.

## Overlap Detection

Preflight compares upstream changed paths to approval-evidence changed paths. It reports:

- upstream changed files;
- approval changed files;
- overlapping changed files.

Any overlap produces `stale_overlap` and blocks execution. A matching file count is irrelevant; only path overlap matters.

## Relationship To Workspace Ownership

Branch freshness depends on workspace ownership metadata for:

- base branch;
- stored base commit;
- workspace path;
- remote name;
- target repository;
- head branch ownership.

Freshness never makes a legacy or non-isolated workspace PR-eligible. Workspace isolation remains an earlier fail-closed gate.

## Relationship To Evidence

Live diff and approval evidence parity must still pass independently. Branch freshness does not replace evidence parity. It only checks whether upstream moved underneath a still-valid run diff.

If live diff no longer matches approval evidence, preflight blocks even if branch freshness is `fresh`.

## Relationship To Idempotency

Existing execution idempotency still controls duplicate PR prevention. Branch freshness is checked before a new execution may proceed. If an already successful execution is returned idempotently, the execution record remains the authority for the existing PR result.

## UI Behavior

The PR preflight UI should show:

- freshness status;
- stored base commit, shortened;
- current remote base commit, shortened when available;
- whether the base advanced;
- upstream changed files;
- approval changed files;
- overlapping changed files;
- branch freshness blockers and warnings;
- the action required before PR creation.

For `fresh`, show that the branch base is current.

For `stale_no_overlap`, show a warning that the base advanced without overlapping changed files.

For `stale_overlap`, keep draft PR creation unavailable and show the overlapping files.

For `unknown`, keep draft PR creation unavailable and show why freshness could not be verified.

## Deferred

Deferred until later milestones:

- automatic rebase or merge of stale run branches;
- automatic rerun after base movement;
- branch cleanup;
- PR creation;
- Linear comments or status updates;
- broader runtime workspace synchronization.
