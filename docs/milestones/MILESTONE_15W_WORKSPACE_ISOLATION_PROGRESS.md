# Milestone 15W Workspace Isolation Progress

## Checkpoint 0 - Current State Inspection

- Current checkpoint: required first-step inspection.
- What changed: no product behavior changed before inspection.
- What was verified: inspected git status, `WORKFLOW.md`, preflight/runbook/write contract docs, 15C-R and 15C-F progress logs, shared schemas, write helpers, event store, daemon run lifecycle, workspace manager, run-to-workspace mapping, provider startup, approval evidence, review artifact refresh, GitHub PR preflight and execution routes, write-action previews, web API, write preview UI, daemon tests, and package validation scripts.
- Remaining work: define the workspace isolation contract, add typed ownership schemas, persist ownership, create isolated git worktrees for fresh runs, integrate preflight/UI, add temporary-git tests, run ALV-5 regression, and validate.
- Blockers or risks: `GOAL_PROGRESS.md` is still deleted in the working tree from unrelated prior state and must not be touched. The previous 15C-R docs are untracked and should be preserved as prerequisite milestone artifacts.

## Checkpoint 1 - Workspace Isolation Contract

- Current checkpoint: workspace isolation contract.
- What changed: created `docs/WORKSPACE_ISOLATION_AND_RUN_OWNERSHIP.md`.
- What was verified: the document defines why directory-only workspaces are not PR-capable, isolated workspace requirements, legacy workspace classification, git worktree behavior, clone fallback rules, external workspace root behavior, ownership metadata, restart reconstruction, PR preflight integration, branch naming, target repo/base branch resolution, cleanup posture, implemented scope, and deferred work.
- Remaining work: add typed ownership schemas and implementation.
- Blockers or risks: none.

## Checkpoint 2 - Define Workspace Ownership Types

- Current checkpoint: completed.
- What changed: added shared workspace kind, isolation status, PR eligibility, run workspace ownership, workspace validation, and expanded GitHub PR preflight workspace schemas in `packages/types/src/index.ts`.
- What was verified: `pnpm --filter @symphonia/types build` passed after the schema changes.
- Remaining work: keep schemas aligned with daemon persistence, preflight, and UI rendering.
- Blockers or risks: none.

## Checkpoint 3 - Persist Run Workspace Ownership

- Current checkpoint: completed.
- What changed: added `run_workspace_ownership` durable storage in the event store, save/load/list methods, `workspace.ownership.recorded` events, daemon run-record ownership fields, startup reconstruction, and workspace metadata hydration for persisted runs.
- What was verified: daemon tests now cover persisted ownership during manual GitHub PR execution and persisted run reconstruction still passes.
- Remaining work: broader validation.
- Blockers or risks: none.

## Checkpoint 4 - Implement Isolated Workspace Creation

- Current checkpoint: completed.
- What changed: updated `WorkspaceManager.prepareIssueWorkspace` to create run-specific git worktrees for git-backed source repositories, generate safe run-specific head branches, verify the workspace git top-level resolves to the workspace path, and return legacy directory ownership only when a git-backed source is unavailable.
- What was verified: temporary-git daemon coverage creates a real source repository and validates a `git_worktree` ownership record with `isolated` status and `eligible` PR eligibility.
- Remaining work: full validation.
- Blockers or risks: none.

## Checkpoint 5 - External Workspace Root Handling

- Current checkpoint: completed.
- What changed: worktree creation chooses an external root when the configured workspace root is inside the source checkout, and `WORKFLOW.md` now recommends `~/.symphonia/workspaces` instead of `.symphonia/workspaces`.
- What was verified: worktree tests use an external workspace root and verify the workspace git root is not the source checkout.
- Remaining work: real-run verification remains a later milestone; old `.symphonia/workspaces` data is preserved.
- Blockers or risks: none.

## Checkpoint 6 - Run Startup Integration

- Current checkpoint: completed.
- What changed: run startup now passes the current repository path, GitHub remote/base metadata, and target repository to workspace preparation; provider execution receives the isolated workspace path; ownership metadata is persisted before provider execution.
- What was verified: daemon tests assert `codex.thread.started` uses the isolated workspace path and that `workspace.ownership.recorded` is emitted before the run proceeds to write previews.
- Remaining work: broader validation.
- Blockers or risks: none.

## Checkpoint 7 - PR Preflight Integration

- Current checkpoint: completed.
- What changed: GitHub PR preflight now reads persisted workspace ownership metadata, reports workspace kind/isolation/PR eligibility, blocks missing ownership, legacy directory workspaces, main-checkout resolution, ownership mismatches, target/base/head mismatches, and keeps execution fail-closed when preflight blocks.
- What was verified: daemon tests cover successful isolated worktree preflight, legacy/main-checkout blocking, diff/evidence mismatch blocking, remote branch/PR ambiguity blocking, payload hash blocking, and execution refusing to persist audit records or call GitHub when blocked.
- Remaining work: old ALV-5 live regression if local run data is available.
- Blockers or risks: none.

## Checkpoint 8 - UI Workspace Isolation Surface

- Current checkpoint: completed.
- What changed: updated the GitHub PR preflight panel to show workspace kind, isolation status, PR eligibility, ownership metadata presence, and existing preflight branch/remote/diff/write-mode states.
- What was verified: `pnpm --filter @symphonia/web lint` and `pnpm build` passed.
- Remaining work: none.
- Blockers or risks: none.

## Checkpoint 9 - Tests With Temporary Git Repositories

- Current checkpoint: completed.
- What changed: updated daemon tests to use a temporary source repository plus bare remote for the manual PR success path, assert isolated worktree creation, persisted ownership, provider cwd, preflight pass, idempotent fake GitHub PR creation, and Linear write prevention. Legacy/main-checkout and mismatch tests remain fail-closed.
- What was verified: `pnpm --filter @symphonia/daemon test` passed.
- Remaining work: full validation stack.
- Blockers or risks: none.

## Checkpoint 10 - Legacy ALV-5 Regression

- Current checkpoint: completed.
- What changed: ran a non-mutating local preflight regression against run `05e74792-72ff-4890-90be-fea430104134`.
- What was verified: the old ALV-5 run remains readable with final state `succeeded`, review artifact `ready`, and 18 evidence changed files. PR preflight reports workspace path `.symphonia/workspaces/ALV-5`, workspace kind `directory`, isolation status `legacy_directory`, PR eligibility `blocked`, missing ownership metadata, git top-level resolving to the main checkout, live diff mismatch, and `canExecute: false`.
- Remaining work: full validation stack.
- Blockers or risks: the regression required an escalated tsx command because sandboxed tsx IPC pipe creation failed with `EPERM`; no GitHub or Linear mutation occurred.

## Checkpoint 11 - Fresh Workspace Verification

- Current checkpoint: completed for internal fixture verification.
- What changed: used temporary git repositories in daemon tests to verify fresh workspace preparation creates isolated git worktrees with run ownership metadata and PR preflight workspace checks passing.
- What was verified: workspace git top-level resolves to the isolated workspace path, not the source checkout; provider startup receives the isolated path; no external GitHub or Linear writes are required.
- Remaining work: optional real connected fresh run belongs in 15C-R2.
- Blockers or risks: no real PR, push, or Linear mutation occurred.

## Checkpoint 12 - Validation

- Current checkpoint: completed.
- What changed: ran the required validation stack.
- What was verified: passed `pnpm --filter @symphonia/daemon test`, `pnpm --filter @symphonia/daemon lint`, `pnpm --filter @symphonia/web lint`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm desktop:build`, `pnpm harness:scan --path .`, `git diff --check`, and `pnpm validate:ci`.
- Remaining work: none for this milestone.
- Blockers or risks: sandboxed `pnpm harness:scan --path .` and sandboxed `pnpm validate:ci` failed only because `tsx` could not create an IPC pipe under `/var/folders/.../tsx-501/*.pipe` with `EPERM`; both passed when rerun with escalation. Harness readiness remains 68% (D), matching the project scanner's advisory output rather than a command failure.

## Final Status

- Current checkpoint: Milestone 15W complete.
- What changed: new git-backed runs now prepare isolated run-owned worktrees with durable ownership metadata; legacy directory-only workspaces remain readable but PR-blocked; GitHub PR preflight consumes ownership metadata; the run proof/write preview UI exposes workspace isolation and PR eligibility.
- What was verified: temporary-git tests prove isolated workspace creation, persisted ownership, provider cwd, preflight pass, idempotent fake GitHub PR creation, and Linear write prevention. Old ALV-5 remains blocked as a legacy main-checkout-resolving workspace. Full validation passed.
- Remaining work: perform 15C-R2 with a fresh real connected Codex run to verify a real isolated workspace reaches the manual PR confirmation boundary.
- Blockers or risks: no real PR was created, no GitHub mutation occurred, and no Linear mutation occurred. The unrelated `GOAL_PROGRESS.md` deletion remains untouched.
