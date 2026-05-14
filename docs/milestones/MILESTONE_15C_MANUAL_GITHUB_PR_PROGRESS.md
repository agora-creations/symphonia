# Milestone 15C Manual GitHub Draft PR Progress

## Checkpoint 0 - Current State Inspection

- Current checkpoint: required first-step inspection.
- What changed: no product behavior changed before inspection.
- What was verified: inspected git status, Milestone 15B write approval contract/progress, approval evidence docs, `WORKFLOW.md`, package validation scripts, shared write schemas, core write helpers, GitHub client, git inspection, daemon write-action routes, event-store write persistence, web API helpers, run proof write-preview UI, and daemon tests. The unrelated `GOAL_PROGRESS.md` deletion and `docs/milestones/GOAL_PROGRESS.md` untracked file remain untouched.
- Remaining work: document the manual PR contract, add execution/audit/idempotency schemas, replace only the GitHub PR create 405 with a gated manual route, add narrow branch preparation, update the UI confirmation flow, keep Linear writes disabled, add tests, run non-mutating real-run regression, and validate.
- Blockers or risks: current 15B route intentionally returns 405 for GitHub PR creation. The new implementation must not create a real PR unless a human explicitly confirms through the product UI or gives a direct instruction after a pause.

## Checkpoint 1 - Manual GitHub PR Creation Contract

- Current checkpoint: manual GitHub PR creation contract.
- What changed: created `docs/MANUAL_GITHUB_PR_CREATION.md`.
- What was verified: the document defines the manual draft PR flow, eligibility, approval evidence requirements, executable preview requirements, write mode gating, confirmation, branch/base rules, draft default, audit records, idempotency, failure handling, deferred work, no Demo Mode, and that Linear writes remain disabled.
- Remaining work: add typed execution/audit models and daemon implementation.
- Blockers or risks: real external PR creation remains intentionally behind the product confirmation boundary.

## Checkpoint 2 - Execution And Audit Types

- Current checkpoint: shared execution and audit types.
- What changed: extended shared schemas with GitHub PR execution requests/responses, local approval records, local execution records, execution statuses, idempotency results, payload-hash verification results, confirmation phrases on preview contracts, and local execution records in write-action history.
- What was verified: `pnpm build:packages` passed after schema updates.
- Remaining work: wire the daemon endpoint and UI confirmation flow.
- Blockers or risks: none for shared types.

## Checkpoint 3 - GitHub Write Mode Gating

- Current checkpoint: GitHub manual write gating.
- What changed: added explicit `manual_enabled` availability state and gated GitHub draft PR execution on `github.read_only: false`, `github.write.enabled: true`, `github.write.allow_create_pr: true`, required confirmation, matching preview hash/idempotency key, ready approval evidence, ready review artifact, safe branches, and valid credentials.
- What was verified: daemon lint passed after gating implementation; tests cover read-only and missing-evidence blocking.
- Remaining work: finish branch mechanics and UI confirmation.
- Blockers or risks: GitHub remains read-only by default in `WORKFLOW.md`.

## Checkpoint 4 - GitHub PR Execution Endpoint

- Current checkpoint: manual GitHub PR execution route.
- What changed: replaced only the GitHub PR create 405 route with a manual confirmation-gated route returning typed execution results. Linear comment execution remains 405. The route validates run, evidence, preview, payload hash, idempotency, target repo, branches, credentials, confirmation, and local audit persistence before calling GitHub.
- What was verified: daemon tests cover wrong confirmation blocking, audit-before-GitHub-call ordering, fake GitHub PR success, persisted PR result, and idempotent retry.
- Remaining work: finish UI and full validation.
- Blockers or risks: real PR creation was not performed autonomously.

## Checkpoint 5 - Branch, Commit, And PR Mechanics

- Current checkpoint: minimal branch mechanics.
- What changed: added safe branch preparation before PR creation. It operates only inside the run workspace, verifies a git repo, verifies the current branch matches the preview, rejects protected/base branches, checks the configured remote against the target repository, rejects unexpected files not represented by approval evidence, commits represented changes when push is explicitly allowed, pushes without force, and then creates a draft PR through the GitHub client.
- What was verified: daemon tests use a temporary real git workspace plus local bare remote and fake GitHub transport to exercise commit/push/PR creation without real credentials or external writes.
- Remaining work: idempotency and UI polish.
- Blockers or risks: broader branch creation/renaming remains deferred; 15C uses the current safe workspace branch or blocks.

## Checkpoint 6 - Idempotency And Duplicate Prevention

- Current checkpoint: idempotent execution.
- What changed: local execution records are keyed by deterministic idempotency key. Retry with the same key and same payload returns the existing PR result, while the same key with a different payload hash is rejected.
- What was verified: daemon test proves the fake GitHub PR create transport is called once, retry returns `already_executed`, and payload-hash conflict is blocked.
- Remaining work: real-run non-mutating regression and full validation.
- Blockers or risks: reconciliation after an external write succeeds but local persistence fails is documented but still narrow; the implemented path persists before write and records success/failure after write.

## Checkpoint 7 - UI Confirmation Flow And Linear Prevention

- Current checkpoint: run proof approval UI.
- What changed: updated the External write previews panel to show manual GitHub draft PR confirmation when gates are satisfied, require the exact phrase, call the GitHub execution route only from the manual button, show PR result/failure, and keep Linear previews non-executable.
- What was verified: `pnpm --filter @symphonia/web lint` passed after UI/API changes.
- Remaining work: real-run regression and final validation.
- Blockers or risks: none. The UI does not expose executable Linear buttons.

## Checkpoint 8 - Tests

- Current checkpoint: automated tests.
- What changed: added/updated daemon tests for read-only GitHub blocking, missing evidence blocking, wrong confirmation blocking, audit persistence before GitHub transport calls, successful fake draft PR creation, persisted PR number/URL, idempotent retry, duplicate idempotency-key payload conflict, and Linear mutation prevention.
- What was verified: `pnpm --filter @symphonia/daemon test` passed with 39 tests.
- Remaining work: real-run regression and full validation commands.
- Blockers or risks: tests use fake transports and temporary repositories only; no user-facing Demo Mode or fake product issues were added.

## Checkpoint 9 - Real-Run Manual Verification Boundary

- Current checkpoint: non-mutating real-run regression.
- What changed: copied `apps/daemon/.data/agentboard.sqlite` to `/private/tmp/symphonia-m15c-regression.sqlite`, inspected Milestone 14 run `05e74792-72ff-4890-90be-fea430104134`, attempted the GitHub PR execution route against the copied database only, and removed the temporary copy.
- What was verified:
  - final run state is `succeeded`;
  - persisted event count is 659;
  - review artifact status is `ready`;
  - changed-file count is 18;
  - file summary source is `review_artifact`;
  - GitHub PR preview remains `read_only`;
  - GitHub execution remains `blocked`;
  - blocking reasons include read-only GitHub, disabled GitHub writes, disabled PR creation, existing PR #24 for the current branch, unpublished local changes with branch push disabled, and create-PR not enabled in `WORKFLOW.md`;
  - Linear previews remain `read_only`;
  - no local execution record was persisted for the blocked real-run attempt;
  - no real external write occurred.
- Remaining work: full validation commands.
- Blockers or risks: the first `tsx` regression attempt hit the known sandbox IPC `EPERM`; rerunning outside the sandbox succeeded.

## Checkpoint 10 - Validation

- Current checkpoint: validation.
- What changed: ran the discovered project validation commands after the 15C API/UI/test changes.
- What was verified:
  - `pnpm --filter @symphonia/daemon test` passed with 39 tests.
  - `pnpm --filter @symphonia/daemon lint` passed.
  - `pnpm --filter @symphonia/web lint` passed.
  - `pnpm lint` initially failed on a milestone-caused unused import, then passed after removing it.
  - `pnpm test` passed.
  - `pnpm build` passed.
  - `pnpm desktop:build` passed.
  - `pnpm harness:scan --path .` failed inside the sandbox with the known `tsx` IPC pipe `EPERM`, then passed outside the sandbox with Agent readiness 68%.
  - `git diff --check` passed.
  - `pnpm validate:ci` failed inside the sandbox at the same `tsx` IPC boundary during harness scan, then passed outside the sandbox.
- Remaining work: final review and handoff.
- Blockers or risks: no milestone-caused validation failures remain.

## Final Status

- Current checkpoint: Milestone 15C completion review.
- What changed: added the manual GitHub PR creation contract doc, typed GitHub PR execution/audit/idempotency schemas, local write execution persistence, GitHub-only manual execution route, safe workspace branch preparation, UI confirmation flow, README safety/API updates, and daemon coverage for the write boundary.
- What was verified: fake transports and temporary git repositories prove the route persists local audit state before GitHub write calls, creates one draft PR, stores PR number/URL, prevents duplicate PR creation, blocks hash mismatches, blocks read-only/missing-evidence states, and keeps Linear writes impossible. The copied real run remains blocked at the manual boundary with no external write.
- Remaining work: none for Milestone 15C.
- Blockers or risks: real GitHub draft PR creation was not performed autonomously. A human must explicitly enable GitHub write mode and confirm through the product UI before a real PR is created.
