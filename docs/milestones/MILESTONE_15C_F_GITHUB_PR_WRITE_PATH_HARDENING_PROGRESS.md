# Milestone 15C-F GitHub PR Write Path Hardening Progress

## Checkpoint 0 - Current State Inspection

- Current checkpoint: required first-step inspection.
- What changed: no product behavior changed before inspection.
- What was verified: inspected git status, manual GitHub PR creation docs, manual verification docs, write approval and approval evidence contracts, 15C and 15C-V progress logs, README write documentation, shared write schemas, core write helpers, event-store write persistence, daemon write-action and PR execution routes, web API helpers, write preview UI, GitHub preview/execution code, workspace manager, git inspector, GitHub client, idempotency implementation, audit persistence, and package validation scripts.
- Remaining work: define the PR preflight contract, add typed schemas, implement a non-mutating preflight endpoint, enforce preflight in execution, harden workspace/diff/branch ambiguity checks, surface preflight in the UI, add tests, run real-run regression, and validate.
- Blockers or risks: `GOAL_PROGRESS.md` is already deleted in the main working tree and the 15C-V docs are uncommitted. These unrelated working tree facts must not be modified or hidden by this milestone.

## Checkpoint 1 - PR Preflight Contract

- Current checkpoint: PR preflight contract.
- What changed: created `docs/GITHUB_PR_PREFLIGHT.md`.
- What was verified: the document defines preflight, when it runs, workspace eligibility, isolation rules, why the main checkout is invalid for PR writes, live diff collection, diff/evidence parity, missing/extra-file reporting, review artifact readiness, preview hash checking, target repo/base/head safety, remote branch/PR idempotency, read-only/manual-enabled behavior, blocking failures, warnings, UI expectations, and deferred work.
- Remaining work: add typed preflight schemas and implementation.
- Blockers or risks: none.

## Checkpoint 2 - Typed Preflight Schemas

- Current checkpoint: typed GitHub PR preflight schemas.
- What changed: added shared schemas and types for GitHub PR preflight status, workspace, repository, branches, diff parity, review artifact, preview hash, remote state, write mode, and full preflight responses. GitHub PR execution responses can now include the blocking preflight result.
- What was verified: `pnpm build:packages` passed, confirming the shared schema exports compile.
- Remaining work: implement the non-mutating daemon/API endpoint and enforce the same preflight in execution.
- Blockers or risks: none.

## Checkpoint 3 - Non-Mutating Preflight Endpoint

- Current checkpoint: daemon/API GitHub PR preflight endpoint.
- What changed: added `GET /runs/:id/github/pr/preflight`. The endpoint loads run context, approval evidence, write previews, workspace metadata, git status/diff, GitHub write mode, local idempotency state, and read-only remote PR state. It returns explicit blockers and warnings without pushing, creating branches, creating PRs, persisting execution records, or mutating Linear.
- What was verified: focused daemon tests exercise the endpoint for passing fake workspaces and blocked paths; the real-run regression used this endpoint logic against a copied event store.
- Remaining work: keep execution fail-closed by requiring the same preflight to pass before any PR write.
- Blockers or risks: remote branch lookup is read-only but depends on network availability; when unavailable, preflight reports the inability to verify branch state as blocking.

## Checkpoint 4 - Execution Route Enforcement

- Current checkpoint: PR execution fail-closed enforcement.
- What changed: `POST /runs/:id/github/pr/create` now runs the same preflight before persisting approval/execution records or calling GitHub write transport. Blocked responses include the preflight result so the UI/API can explain why execution is unavailable.
- What was verified: daemon tests confirm blocked preflight prevents audit persistence and prevents fake GitHub write transport calls.
- Remaining work: validate full project command set.
- Blockers or risks: none.

## Checkpoint 5 - Workspace Isolation Hardening

- Current checkpoint: run workspace ownership and isolation checks.
- What changed: preflight now rejects missing workspaces, workspaces outside the configured workspace root, workspaces that do not match the selected run issue workspace, non-git workspaces, workspaces whose git root is not the workspace path, and workspaces that resolve to the main Symphonia checkout.
- What was verified: tests cover main-checkout and non-isolated workspace blocking. Real-run regression confirms the known ALV-5 workspace resolves to `.symphonia/workspaces/ALV-5` but its git top-level is the main repo checkout, so it is blocked.
- Remaining work: future isolated-run milestone should create fresh workspaces as independent git worktrees/clones before attempting real PR verification.
- Blockers or risks: old runs are not silently repaired; they remain preflight-blocked when their workspace cannot prove isolation.

## Checkpoint 6 - Diff/Evidence Parity

- Current checkpoint: live diff to approval evidence parity.
- What changed: preflight compares normalized live git changed-file paths with approval evidence changed-file paths, reports matched/missing/extra files, marks unrelated dirty files, and fails closed when paths differ.
- What was verified: tests cover matching evidence, missing evidence files, extra unrelated files, and same-count path mismatches. Real-run regression reports 18 approval-evidence files, current live diff files from the main checkout, missing evidence paths, extra current milestone paths, and `matchesApprovalEvidence: false`.
- Remaining work: none for this milestone.
- Blockers or risks: path parity intentionally blocks older runs when current workspace state has drifted.

## Checkpoint 7 - Branch And Remote Ambiguity

- Current checkpoint: branch, remote, and existing PR ambiguity.
- What changed: preflight checks target repository/remote match, base/head branch safety, local branch existence, read-only remote branch existence, existing open PRs for the head branch, and local idempotency ownership. Unknown or unowned remote branch/PR state blocks execution.
- What was verified: tests cover existing branch/PR state without matching idempotency. Real-run regression reports the existing PR for `codex/milestone-13-connected-golden-path` as ambiguous because no matching local execution record owns it.
- Remaining work: none for this milestone.
- Blockers or risks: remote branch lookup may be unavailable in restricted network environments and is treated as blocking rather than guessed.

## Checkpoint 8 - UI Preflight Surface

- Current checkpoint: run proof/write preview UI.
- What changed: the web client can request GitHub PR preflight. The External write previews panel now shows preflight status, can-execute state, workspace isolation, run ownership, remote match, branch state, diff parity, review artifact status, preview hash status, remote ambiguity, blockers, and warnings. `Create draft PR` remains unavailable unless preflight can execute and the other existing gates are satisfied.
- What was verified: `pnpm --filter @symphonia/web lint` passed.
- Remaining work: full validation.
- Blockers or risks: none.

## Checkpoint 9 - Tests

- Current checkpoint: focused preflight and execution tests.
- What changed: added daemon tests for main-checkout workspace blocking, diff/evidence mismatch, stale preview payload hash, existing branch/PR ambiguity, preflight-pass fake workspace behavior, execution fail-closed behavior, and no fake GitHub write call when preflight fails.
- What was verified: `pnpm --filter @symphonia/daemon test` passed with 43 tests.
- Remaining work: run the broader validation set.
- Blockers or risks: none.

## Checkpoint 10 - Real-Run Regression

- Current checkpoint: non-mutating real-run regression for `05e74792-72ff-4890-90be-fea430104134`.
- What changed: no product code changed during regression. The live event store was copied to `/private/tmp` and preflight was run against the copy with a fake read-only GitHub fetch for existing PR lookup.
- What was verified: preflight returns `status: blocked` and `canExecute: false`; review artifact is ready; preview hash matches; write mode is `read_only`; write-action row count stayed `0 -> 0`; the workspace path is `.symphonia/workspaces/ALV-5`, but its git top-level is the main repo checkout; the live diff does not match the 18-file approval evidence; current milestone docs/code appear as extra live changes; older approval-evidence files are missing from the live diff; existing PR `#24` for the head branch is ambiguous because no matching execution record owns it.
- Remaining work: run full validation commands.
- Blockers or risks: `git ls-remote` could not resolve `github.com` in the sandbox, so remote branch existence was treated as unverified/blocking. Existing PR ambiguity was still verified through fake GitHub read data.

## Checkpoint 11 - Validation

- Current checkpoint: validation.
- What changed: no product code changed during validation.
- What was verified:
  - `pnpm --filter @symphonia/daemon test` passed with 43 tests.
  - `pnpm --filter @symphonia/daemon lint` passed.
  - `pnpm --filter @symphonia/web lint` passed.
  - `pnpm lint` passed.
  - `pnpm test` passed.
  - `pnpm build` passed.
  - `pnpm desktop:build` passed.
  - `pnpm harness:scan --path .` failed in the default sandbox with `listen EPERM` on the tsx IPC pipe, then passed with approved escalation.
  - `git diff --check` passed.
  - `pnpm validate:ci` passed with approved escalation for the tsx harness IPC pipe.
- Remaining work: none for this milestone.
- Blockers or risks: the harness scan's first failure is environment/sandbox-specific, not caused by this milestone.

## Final Status

- Current checkpoint: complete.
- What changed: Symphonia now has an explicit non-mutating GitHub PR preflight layer, enforced by the manual PR execution route and visible in the write preview UI.
- What was verified: tests and real-run regression prove main-checkout workspaces, non-isolated workspaces, diff/evidence mismatch, extra dirty files, stale preview hashes, ambiguous branch/PR state, and read-only GitHub mode all block execution before any audit persistence or external write transport call.
- Remaining work: use a future fresh isolated run for real draft PR verification, or split out broader workspace-isolation architecture if fresh isolated runs cannot be produced reliably.
- Blockers or risks: old runs that resolve to the main checkout remain intentionally blocked; remote branch verification still depends on read access to the configured GitHub remote.
