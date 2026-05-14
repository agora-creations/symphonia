# Milestone 15B Write Approval Contract Progress

## Checkpoint 0 - Current State Inspection

- Current checkpoint: required first-step inspection.
- What changed: no product files changed before inspection.
- What was verified: inspected `docs/APPROVAL_EVIDENCE_SURFACE.md`, `docs/REAL_CONNECTED_RUN.md`, `docs/CONNECTED_GOLDEN_PATH.md`, Milestone 15A progress, `WORKFLOW.md`, package scripts, CI workflow, shared types, daemon approval evidence and write-action routes, web API helpers, run proof/write UI, Codex event mapping, event-store write persistence, GitHub/Linear integration helpers, review artifact refresh, and daemon tests. The worktree still contains the unrelated pre-existing `GOAL_PROGRESS.md` move; it remains untouched.
- Remaining work: document the write approval contract, add typed preview-only schemas, generate preview contracts from completed-run evidence, remove executable UI/API affordances for external writes, cover the contract with tests, run regression checks, and validate.
- Blockers or risks: current code has older gated execution routes for GitHub PR creation and Linear comments; 15B must make the product surface preview-only without weakening evidence or write gates.

## Checkpoint 1 - Write Approval Contract Document

- Current checkpoint: write approval contract.
- What changed: created `docs/WRITE_APPROVAL_CONTRACT.md`.
- What was verified: the contract defines write actions, preview-only write action contracts, approval evidence relationships, GitHub PR previews, Linear comment previews, Linear status update previews, immutable fields, future audit shape, UI behavior, disabled external writes, no Demo Mode, and explicitly states 15B does not execute GitHub or Linear writes.
- Remaining work: add shared preview-only schemas and daemon/API generation.
- Blockers or risks: none for the document checkpoint.

## Checkpoint 2 - Typed Write-Action Preview Schemas

- Current checkpoint: shared preview-only schemas.
- What changed: added typed write-action preview contracts, preview statuses, local audit shape, Linear status update preview payloads, and preview arrays on the `/runs/:id/write-actions` response.
- What was verified: `pnpm build:packages` passed after adding the shared schemas, and `pnpm --filter @symphonia/daemon lint` passed after rebuilding package declarations.
- Remaining work: finish daemon generation, UI rendering, and tests.
- Blockers or risks: older generated package declarations were stale until package rebuild; no schema blocker remains.

## Checkpoint 3 - Generate Preview-Only Write Actions

- Current checkpoint: daemon/API preview generation.
- What changed: extended `GET /runs/:id/write-actions` to return preview-only contracts for GitHub PR creation, Linear comment creation, and Linear status update. The previews derive from approval evidence, review artifacts, issue/run/workspace context, current write policy, credential source, changed files, and blocking reasons.
- What was verified: daemon lint passed and focused daemon tests passed with preview contract coverage.
- Remaining work: harden the UI and document execution blocking.
- Blockers or risks: preview generation intentionally avoids GitHub PR lookup network calls by using current review artifact context; stale review artifacts can still produce stale preview blockers until refreshed.

## Checkpoint 4 - Keep Execution Impossible

- Current checkpoint: write execution disabled.
- What changed: the GitHub PR creation and Linear comment creation API routes now return HTTP 405 with preview-only guidance. The run proof UI no longer imports or calls external write execution helpers.
- What was verified: daemon tests assert the execution routes return 405, no GitHub PR creation fetch is called, no Linear mutation fetch is called, and no write-started/write-succeeded/created events are emitted during preview generation.
- Remaining work: complete the approval contract UI and validation.
- Blockers or risks: lower-level core execution helpers remain in the package for future milestones, but the daemon API and UI do not expose executable external writes in 15B.

## Checkpoint 5 - Approval Contract UI

- Current checkpoint: preview-only UI surface.
- What changed: replaced the run proof write panel with `External write previews`. It renders preview-only cards showing action kind, target system, proposed payload, evidence source, review artifact source, changed files, required permissions, confirmation prompt, blocking reasons, risk warnings, idempotency key, and local audit history. Executable labels and buttons such as create/post/update were removed from the product UI.
- What was verified: `pnpm --filter @symphonia/web lint` passed after the UI/API changes.
- Remaining work: finish local audit shape documentation/testing and real-run regression.
- Blockers or risks: none.

## Checkpoint 6 - Local Approval/Audit Intent Shape

- Current checkpoint: future audit shape.
- What changed: typed a local preview audit object on each preview contract with run id, issue id, action kind, target system, target identifier, payload hash, approval evidence source, review artifact source, generated timestamp, generated-by local context, idempotency key, status `previewed`, and `externalWriteId: null`.
- What was verified: daemon tests parse the response through shared schemas and assert idempotency/evidence fields are present.
- Remaining work: no persistence was added; if 15C persists approvals, it should persist this contract shape before execution.
- Blockers or risks: preview audit records are response contracts only in 15B, not durable local approval records.

## Checkpoint 7 - Tests

- Current checkpoint: preview contract tests.
- What changed: replaced older executable write-route tests with preview-only tests. Added coverage for GitHub PR previews, Linear comment previews, Linear status update previews, read-only blockers, missing-evidence preview states, dry-run-only flags, redaction, and no transport mutation calls during preview generation.
- What was verified:
  - `pnpm --filter @symphonia/daemon test` passed with 38 tests.
  - `pnpm --filter @symphonia/daemon lint` passed.
  - `pnpm --filter @symphonia/web lint` passed.
- Remaining work: real-run regression check and full validation commands.
- Blockers or risks: none.

## Checkpoint 8 - Real-Run Regression Check

- Current checkpoint: real-run regression.
- What changed: copied `apps/daemon/.data/agentboard.sqlite` to `/private/tmp` and verified preview-only write contracts against Milestone 14 run `05e74792-72ff-4890-90be-fea430104134` without mutating the original database.
- What was verified:
  - final run state is `succeeded`;
  - event count is 659;
  - review artifact status is `ready`;
  - changed-file count is 18;
  - file summary source remains `review_artifact`;
  - three preview contracts are generated: `github_pr_create`, `linear_comment_create`, and `linear_status_update`;
  - all previews are `dryRunOnly: true`;
  - all previews are currently `read_only`;
  - GitHub PR preview is blocked by read-only/write-disabled policy, PR creation disabled, and an existing PR for the branch;
  - Linear comment and status previews are blocked by read-only/write-disabled policy and unavailable write permissions/configuration.
- Remaining work: run full validation commands and document results.
- Blockers or risks: the first `tsx` regression command failed inside the sandbox with the known IPC pipe `EPERM`; rerunning outside the sandbox succeeded.

## Checkpoint 9 - Validation

- Current checkpoint: validation.
- What changed: ran the discovered validation commands after the preview-contract API/UI/test changes.
- What was verified:
  - `pnpm --filter @symphonia/daemon test` passed.
  - `pnpm --filter @symphonia/daemon lint` passed.
  - `pnpm --filter @symphonia/web lint` passed.
  - `pnpm lint` passed.
  - `pnpm test` passed.
  - `pnpm build` passed.
  - `pnpm desktop:build` passed.
  - `pnpm harness:scan --path .` failed inside the sandbox with the known `tsx` IPC pipe `EPERM`, then passed outside the sandbox with Agent readiness 68%.
  - `git diff --check` passed.
  - `pnpm validate:ci` failed inside the sandbox at the same `tsx` IPC boundary during harness scan, then passed outside the sandbox.
- Remaining work: final review and handoff.
- Blockers or risks: no milestone-caused validation failures remain. The only failed attempts were environment-specific sandbox IPC failures for `tsx`.

## Final Status

- Current checkpoint: Milestone 15B completion review.
- What changed: added the write approval contract doc, typed preview-only write action contracts, preview generation on `/runs/:id/write-actions`, Linear status update previews, preview-only UI cards, local audit/intention metadata, disabled execution routes, README write-preview clarification, and daemon coverage proving no write transports are called.
- What was verified: the copied real Milestone 14 run now generates three dry-run preview contracts from the 659-event evidence package and ready review artifact. All previews remain read-only/blocked with explicit reasons under current policy. Focused and full validation passed.
- Remaining work: none for Milestone 15B.
- Blockers or risks: future write execution still needs a separate milestone to persist an immutable approval record and deliberately re-enable one narrow execution route.
