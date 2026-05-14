# Milestone 15C-R Fresh Isolated Run Progress

## Checkpoint 0 - Current State Inspection

- Current checkpoint: required first-step inspection.
- What changed: no product behavior changed before inspection.
- What was verified: inspected git status, 15C-F preflight docs/progress, manual PR creation and verification docs, write approval and approval evidence contracts, daemon run lifecycle, `WorkspaceManager`, workspace inventory, connected status, provider health, tracker/GitHub readiness, write status, approval evidence/preflight endpoints, web API helpers, write preview UI, package scripts, and current workflow configuration.
- Remaining work: create the fresh isolated runbook, record the current connected/preflight state, decide whether a fresh run is safe/useful, run validation, and report the outcome.
- Blockers or risks: `GOAL_PROGRESS.md` remains deleted in the working tree from unrelated prior state and must not be touched. The configured workspace root is `.symphonia/workspaces`, which is inside the main Symphonia checkout.

## Checkpoint 1 - Fresh Isolated Verification Runbook

- Current checkpoint: fresh isolated verification runbook.
- What changed: created `docs/FRESH_ISOLATED_PR_VERIFICATION.md`.
- What was verified: the runbook defines why a fresh run is required, how this differs from old ALV-5 regression, isolated workspace requirements, safe issue selection, repo/base validation, Codex readiness, workspace ownership, diff/evidence parity, review artifact readiness, branch/PR idempotency, GitHub write mode, manual confirmation boundary, one-draft-PR conditions, 15W escalation conditions, and Linear write prevention.
- Remaining work: complete non-mutating environment checks and determine whether a fresh run can safely answer the isolation question.
- Blockers or risks: none.

## Checkpoint 2 - Non-Mutating Environment Check

- Current checkpoint: connected setup and old-run preflight baseline.
- What changed: no external or local write action was executed.
- What was verified: live daemon health is available; connected status reports `completed`; repository is `/Users/diegomarono/symphonía`; workspace root is `/Users/diegomarono/symphonía/.symphonia/workspaces`; Linear is ready with manual auth and 5 cached issues; GitHub is ready for `agora-creations/symphonia` in read-only mode; Codex app-server is available; board status is ready; GitHub and Linear writes are `read_only`; Linear comment execution remains disabled with HTTP 405 guidance.
- Remaining work: decide whether to start a fresh run.
- Blockers or risks: current write mode correctly remains read-only; this is not a blocker for non-mutating preflight verification.

## Checkpoint 3 - Safe Issue Selection

- Current checkpoint: issue selection.
- What changed: no issue was selected for a fresh run.
- What was verified: the current Linear board contains five real issues. ALV-5 is the old completed test issue with unsafe historical workspace state. ALV-1 through ALV-4 are Linear onboarding issues and are not appropriate low-risk Symphonia implementation targets.
- Remaining work: a future fresh run should use a real, small, Symphonia-specific issue once workspace isolation is available.
- Blockers or risks: even with a safe issue, current workspace creation would not produce an isolated git root, so running Codex now would not answer the milestone positively.

## Checkpoint 4 - Fresh Real Codex Run Boundary

- Current checkpoint: fresh run decision.
- What changed: no fresh Codex run was started.
- What was verified: code inspection shows `WorkspaceManager.prepareIssueWorkspace` creates the per-issue directory but does not clone the repo, initialize a git repository, or create a git worktree. The daemon run lifecycle passes that directory directly to Codex. `WORKFLOW.md` configures the workspace root under the main checkout at `.symphonia/workspaces`.
- Remaining work: implement workspace isolation in a separate milestone before retrying a fresh PR verification run.
- Blockers or risks: starting a real Codex run under this architecture would create or reuse a non-isolated directory inside the app checkout. The 15C-F preflight would correctly reject it, and the run could produce ignored or unrelated local files without improving PR eligibility.

## Checkpoint 5 - Workspace Isolation

- Current checkpoint: workspace isolation proof.
- What changed: no workspace files were modified.
- What was verified: old ALV-5 workspace `git rev-parse --show-toplevel` resolves to `/Users/diegomarono/symphonía`, confirming the known main-checkout resolution. The same configured root and creation helper would be used for fresh issue workspaces.
- Remaining work: 15W should add or require an isolated clone/worktree creation step and persist run ownership metadata that preflight can verify.
- Blockers or risks: fresh runs currently lack proper isolated PR write workspaces.

## Checkpoint 6 - Approval Evidence And Review Artifact

- Current checkpoint: old-run evidence baseline only.
- What changed: no review artifact was refreshed and no evidence was mutated.
- What was verified: connected status still points at old ALV-5 run `05e74792-72ff-4890-90be-fea430104134` with review artifact ready. Old-run preflight sees approval evidence with 18 changed files, but the live diff no longer matches it.
- Remaining work: a future fresh isolated run must produce new approval evidence and review artifact inside an isolated workspace.
- Blockers or risks: old-run evidence remains useful as a blocked regression, not as a PR candidate.

## Checkpoint 7 - Diff/Evidence Parity

- Current checkpoint: diff/evidence parity baseline.
- What changed: no diff was changed.
- What was verified: old-run preflight returns `status: blocked`, `canExecute: false`, workspace `isMainCheckout: true`, workspace `isIsolatedRunWorkspace: false`, live changed files only include `GOAL_PROGRESS.md`, approval evidence has 18 files, `matchesApprovalEvidence: false`, and blocking reasons include main-checkout workspace, non-isolated workspace, live diff mismatch, missing evidence files, read-only GitHub, and disabled PR creation.
- Remaining work: fresh isolated runs must produce live diff/evidence parity before PR confirmation can be reached.
- Blockers or risks: the current runtime cannot produce that isolated workspace shape.

## Checkpoint 8 - Branch And PR Preflight

- Current checkpoint: branch and PR preflight baseline.
- What changed: no branch or PR was created.
- What was verified: old-run preflight remains blocked before execution; GitHub write mode is read-only with `allowPush: false` and `allowPrCreate: false`. The current preflight response did not treat the remote branch as owned by a local execution record.
- Remaining work: future isolated workspaces need safe unique branch creation/selection and unambiguous remote branch/PR ownership.
- Blockers or risks: branch/PR idempotency cannot compensate for a non-isolated workspace or evidence mismatch.

## Checkpoint 9 - Manual Confirmation Packet

- Current checkpoint: confirmation boundary.
- What changed: no confirmation packet was produced for a live PR candidate because no fresh isolated run exists.
- What was verified: a confirmation packet would be premature and unsafe while workspace isolation fails before issue execution.
- Remaining work: produce the confirmation packet after 15W enables a fresh isolated run that passes non-write PR preflight gates.
- Blockers or risks: none beyond workspace isolation.

## Checkpoint 10 - Optional Human-Confirmed Draft PR

- Current checkpoint: optional real PR write.
- What changed: no real PR was created.
- What was verified: GitHub writes remain read-only and no human confirmation was requested or used.
- Remaining work: retry only after a fresh isolated run passes preflight.
- Blockers or risks: none.

## Checkpoint 11 - Post-Write Verification

- Current checkpoint: not applicable.
- What changed: no PR exists from this milestone.
- What was verified: no post-write checks were needed because no external write occurred.
- Remaining work: future verification must check PR draft status, target, head/base, audit records, execution record, and idempotent retry only after an explicitly confirmed write.
- Blockers or risks: none.

## Checkpoint 12 - Tests

- Current checkpoint: test decision.
- What changed: no tests were added because this milestone did not change product code.
- What was verified: existing 15C-F tests already cover main-checkout workspace blocking, non-isolated workspace blocking, diff/evidence mismatch, branch/PR ambiguity, execution fail-closed behavior, and Linear write prevention.
- Remaining work: 15W should add tests for isolated workspace creation and run ownership when that behavior is implemented.
- Blockers or risks: none.

## Checkpoint 13 - Validation

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
  - `pnpm harness:scan --path .` failed in the default sandbox with `listen EPERM` on the `tsx` IPC pipe, then passed with approved escalation.
  - `git diff --check` passed.
  - `pnpm validate:ci` failed in the default sandbox at the same `tsx` IPC boundary after tests, lint, build, and desktop build passed, then passed with approved escalation.
- Remaining work: none for this milestone.
- Blockers or risks: the default-sandbox harness failures are environment-specific and match prior milestones; no milestone-caused validation failures remain.

## Final Status

- Current checkpoint: Outcome C - escalate to 15W.
- What changed: created fresh isolated verification docs and recorded the current non-mutating evidence. No runtime code changed.
- What was verified: the current runtime is connected and read-only, but fresh run workspace setup is systemic: per-issue workspaces are directories under the main checkout, not isolated git clones/worktrees. Old-run preflight remains correctly blocked for main-checkout resolution and diff/evidence mismatch. Full validation passed after rerunning the known sandbox-sensitive `tsx` harness command with escalation.
- Remaining work: Milestone 15W should implement Workspace Isolation and Run Ownership before attempting 15C-R again.
- Blockers or risks: without 15W, starting another real Codex run would not produce a PR-eligible workspace and could add ignored or unrelated local state. No GitHub or Linear mutation occurred.
