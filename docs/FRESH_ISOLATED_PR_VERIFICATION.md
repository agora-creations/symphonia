# Fresh Isolated PR Verification

Milestone 15C-R verifies whether a brand-new real Codex run can produce a PR-eligible workspace after the Milestone 15C-F preflight hardening.

This milestone does not bypass preflight. If fresh runs are not isolated, the correct outcome is to stop and recommend 15W.

There is no user-facing Demo Mode in this milestone.

## Why A Fresh Run Is Required

The old ALV-5 run proves the safety gate works, but it cannot prove the happy path. Its workspace at `.symphonia/workspaces/ALV-5` resolves upward into the main Symphonia checkout, its live diff no longer matches approval evidence, and its head branch has ambiguous existing PR state.

15C-R must answer a narrower question: whether a new run created by the current runtime gets a workspace that is isolated enough for GitHub PR preflight.

## Difference From ALV-5 Regression

The ALV-5 regression checks that old unsafe runs remain blocked. A fresh isolated verification run must instead start from current connected setup and prove:

- the workspace is created for the selected issue;
- the workspace belongs to that run;
- the workspace has its own git root or valid isolated worktree;
- the workspace does not resolve upward into the app checkout;
- live changed files can be compared directly with approval evidence;
- branch and PR state are unambiguous.

## Isolated Run Workspace

A run workspace qualifies as isolated only when:

- the path exists under the configured workspace root;
- the selected run owns the workspace path;
- `git rev-parse --show-toplevel` resolves to the workspace path or a valid isolated worktree root for that run;
- the git root is not the main Symphonia checkout;
- the remote matches the configured GitHub repository;
- the current branch is a safe non-base branch;
- no unrelated dirty files are visible.

An empty directory under `.symphonia/workspaces` is not enough. If git resolves upward into the parent app checkout, the workspace is not PR-eligible.

## Safe Issue Selection

Use exactly one real Linear issue. Prefer a small, low-risk issue:

- documentation clarification;
- copy-only improvement;
- tiny test or fixture adjustment;
- harmless UI wording change;
- narrow bug fix.

Do not create a Linear issue unless the human explicitly instructs it. Do not use issues that require secrets, broad refactors, production credentials, or any Linear writeback.

## Repo And Base Branch

Before any run can be considered PR-eligible:

- the configured repository must be explicit;
- the workspace remote must match that repository;
- the base branch must be known, usually `main`;
- the head branch must not be the base branch;
- the head branch must not be protected;
- the head branch must not have ambiguous existing remote branch or PR ownership.

## Codex Readiness

Codex readiness is verified through the daemon provider health surface. The provider must be available before starting a fresh run, but provider readiness alone does not prove workspace safety.

## Workspace Ownership

Workspace ownership is verified by comparing the run workspace path with the expected per-issue workspace path from the configured workspace root and issue identifier. Ownership fails if the workspace is missing, outside the workspace root, belongs to another issue, or resolves to the main checkout.

## Diff And Evidence Parity

GitHub PR preflight compares live git changed paths with approval evidence changed paths. PR verification may continue only when:

- live changed files are collected from the isolated workspace;
- approval evidence changed files are available;
- every evidence path appears in the live diff;
- no extra live dirty files exist;
- path comparison matches, not just file count;
- disallowed local files are absent.

If the run produces no changed files, it may still prove the product run loop, but it is not valid for PR creation unless a later contract explicitly permits no-change PRs.

## Review Artifact

The review artifact should be ready before a manual PR confirmation packet is produced. If the artifact is missing or errored, the run must show a clear blocker rather than creating a PR from partial evidence.

## Branch And PR Idempotency

Preflight must check local and remote branch state without mutating GitHub. Existing remote branch or PR state is safe only when local execution records prove the existing state belongs to the same idempotency key and payload hash.

Unknown branch or PR ownership blocks the write.

## GitHub Write Mode

GitHub writes remain read-only by default. A fresh run can reach the manual confirmation boundary while GitHub write mode is still read-only, but actual execution requires explicit manual write mode and confirmation.

## Manual Confirmation Boundary

When preflight passes all non-write gates, pause with a confirmation packet containing:

- run id;
- issue key and title;
- target repository;
- base branch;
- proposed head branch;
- draft PR status;
- PR title and body summary;
- changed file count and list;
- review artifact status or identifier;
- approval evidence status;
- payload hash;
- idempotency key;
- preflight status;
- GitHub write mode;
- exact confirmation phrase;
- exact UI action or API request;
- statement that Linear writes remain disabled.

Do not create a real PR unless the human explicitly confirms the exact write.

## Conditions For One Real Draft PR

Exactly one real GitHub draft PR is allowed only when:

- workspace isolation passes;
- live diff matches approval evidence;
- review artifact is ready or explicitly accepted by contract;
- branch and PR state are unambiguous;
- payload hash matches;
- GitHub manual write mode is enabled;
- the human confirms the exact target, branches, payload hash, idempotency key, and confirmation phrase;
- local approval and execution records can be persisted.

## Conditions Requiring 15W

Stop and recommend Milestone 15W - Workspace Isolation and Run Ownership when:

- fresh workspaces are only empty directories under the app checkout;
- fresh workspaces resolve upward to the main checkout;
- the runtime has no git clone/worktree creation step;
- run-to-workspace ownership cannot be proven;
- live diff collection would include unrelated app checkout files;
- fixing the issue would require a broader workspace architecture change.

## Linear Writes

Linear writes remain disabled. This milestone must not comment in Linear, update Linear issue state, alter labels, change assignees, or mutate Linear in any way.

## Current Finding

The current runtime creates per-issue workspace directories with `WorkspaceManager.prepareIssueWorkspace`, but that helper only creates directories. With `workspace.root` configured as `.symphonia/workspaces`, fresh run workspaces are inside the main Symphonia checkout and do not receive an independent git clone or worktree. That means fresh runs currently fail the isolation prerequisite before PR verification can safely continue.
