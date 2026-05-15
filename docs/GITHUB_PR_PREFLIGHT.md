# GitHub PR Preflight

Milestone 15C-F hardens the GitHub draft PR write path with an explicit preflight. This milestone does not create a real PR. It hardens the preflight that must pass before a future manual PR write.

There is no user-facing Demo Mode in this milestone.

## What Preflight Is

GitHub PR preflight is a non-mutating verification step between preview and execution:

1. Preview: Symphonia shows what it would write.
2. Preflight: Symphonia verifies the live workspace, branch, diff, evidence, preview, write mode, and remote state.
3. Execute: only after preflight passes and the user explicitly confirms, Symphonia may persist local approval/execution records and create one draft PR.

Preflight is a fail-closed gate. A PR write is unavailable until preflight proves the write target is isolated, evidence-backed, and unambiguous.

## When Preflight Runs

Preflight runs:

- when the run proof surface loads a GitHub PR preview;
- when a user refreshes write previews;
- immediately inside `POST /runs/:id/github/pr/create` before any local approval record is persisted;
- during non-mutating regression checks for completed runs.

The preflight endpoint is read-only. It must not create branches, push commits, create PRs, update Linear, or persist write execution records.

## Checks

Preflight checks:

- run and issue context exist;
- approval evidence is complete;
- review artifact is ready;
- the current preview payload hash matches the request or query;
- workspace path exists;
- workspace is a git repository;
- workspace belongs to the selected run;
- workspace is isolated from the main Symphonia app checkout;
- workspace remote matches the configured GitHub repository;
- base branch is known;
- head branch is present, safe, and not protected;
- live git diff matches approval evidence by path;
- no extra unrelated dirty files are present;
- disallowed local files such as secret/env/database artifacts are not included;
- existing remote branch state is unambiguous;
- existing PR state is unambiguous;
- branch freshness against the current target base is known;
- stale base changes do not overlap approval-evidence changed files;
- GitHub write posture is explicitly manual-enabled before execution;
- idempotency records do not conflict.

## Eligible Run Workspace

A run workspace is eligible for a PR write only when:

- the run has a persisted `workspacePath`;
- the workspace path exists;
- the workspace path is the expected per-issue workspace for that run;
- git top-level resolves to the workspace path itself;
- git top-level does not resolve to the main Symphonia checkout;
- the workspace is inside the configured workspace root;
- live changed files are scoped to the workspace.

The main app checkout must not be used as a PR write workspace. A checkout that resolves upward into `/Users/.../symphonia` can expose unrelated dirty files and implementation changes. That state is acceptable for local development, but unsafe as the source of a run-owned external write.

Old runs that used a non-isolated workspace should remain preflight-blocked with a clear reason. They should not be silently repaired.

## Live Diff And Evidence Parity

Preflight collects live git status/diff from the run workspace and compares it with approval evidence.

The comparison normalizes paths and compares sets of changed paths. It reports:

- files present in both live diff and approval evidence;
- files missing from live diff;
- files extra in live diff;
- whether unrelated dirty files are present;
- whether the changed-file sets match.

A matching file count is not enough. Path mismatch blocks execution.

An accepted equivalence may be documented later, such as ignoring generated lockfile metadata. No such equivalence is accepted in 15C-F.

## Missing Or Extra Files

Missing files mean approval evidence says a file changed, but the live workspace no longer has that changed path.

Extra files mean the live workspace has changes not represented by approval evidence. Extra files are treated as unrelated dirty files and block execution.

Secret-like or local-runtime files also block, including `.env` files, `.data` files, SQLite databases, auth-token stores, desktop packaging output, and `node_modules`.

## Review Artifact

Review artifact status must be `ready` before execution. A missing or errored review artifact blocks preflight.

The review artifact is a snapshot, not authority to write stale or unrelated live changes.

## Preview Payload Hash

Preflight compares the current generated GitHub PR preview payload hash with the supplied hash when present. A mismatch blocks execution.

Execution must use the current preview id, payload hash, idempotency key, target repository, base branch, and head branch.

## Target Repo And Branch Safety

Preflight checks:

- target repository matches `WORKFLOW.md`;
- workspace remote matches the target repository;
- base branch is known;
- head branch is not the base branch;
- head branch is not protected;
- head branch has a non-empty, specific name;
- local branch matches the preview head branch.

Branch creation and broad branch management remain deferred. 15C-F uses the current safe workspace branch or blocks.

## Branch Freshness

Preflight compares the workspace ownership stored base commit with the current remote base branch commit. It reports `fresh`, `stale_no_overlap`, `stale_overlap`, or `unknown`.

`fresh` means the run workspace was prepared from the current remote base.

`stale_no_overlap` means the base advanced, but upstream changes do not touch approval-evidence changed files. This is a warning.

`stale_overlap` means the base advanced and upstream touched approval-evidence changed files. This blocks execution.

`unknown` means freshness could not be verified. Unknown is blocking.

The check is read-only. It may fetch base-branch commit objects to compare file paths, but it must not push, create branches, create PRs, or change the worktree.

## Remote Branch And PR Idempotency

Preflight checks remote branch and PR state without mutating GitHub.

Remote branch or PR state is safe only when:

- no existing remote branch or PR conflicts with the preview, or
- a local successful execution record with the same idempotency key proves the existing result belongs to the same write.

If a remote branch or PR exists and ownership cannot be tied to the same execution record, preflight blocks.

## Write Mode

GitHub `read_only` or disabled write mode blocks execution. If all workspace/evidence checks pass but write mode remains read-only, the UI should show that the local preflight is otherwise clean and that manual write mode is still required.

Linear write mode is not part of GitHub PR preflight. Linear comments and Linear status updates remain disabled.

## Blocking Failures

Blocking failures include:

- missing run or preview;
- missing approval evidence;
- review artifact not ready;
- workspace missing or not a git repository;
- workspace resolves to the main checkout;
- workspace does not belong to the run;
- remote repository mismatch;
- unsafe or protected head branch;
- live diff does not match approval evidence;
- unrelated dirty files;
- disallowed local files in the diff;
- preview payload hash mismatch;
- branch freshness is `stale_overlap`;
- branch freshness is `unknown`;
- GitHub read-only or writes disabled;
- existing branch/PR ambiguity;
- conflicting idempotency record.

## Warnings

Warnings may include:

- preflight could not verify an optional remote detail because credentials are unavailable;
- branch publication would be needed when push is disabled;
- target base advanced without overlapping approval-evidence files;
- preflight passed local checks but write mode still requires manual enablement.

Warnings must never override blockers.

## UI

The run proof/write preview UI should show:

- preflight status;
- whether execution can proceed;
- workspace isolation and ownership;
- repository/remote match;
- base/head branch state;
- live diff vs approval evidence counts;
- missing and extra files;
- review artifact status;
- preview hash status;
- write mode status;
- remote branch/PR ambiguity;
- branch freshness status;
- blocking reasons and warnings.

When preflight fails, `Create draft PR` must remain hidden or disabled.

## Deferred

Deferred until later milestones:

- creating a real PR from this hardening pass;
- automatic branch creation;
- migrating old non-isolated runs;
- Linear comments;
- Linear status updates;
- auto-merge;
- broad runtime workspace productionization.
