# Milestone 15A Approval Evidence Progress

## Checkpoint 0 - Current State Inspection

- Current checkpoint: required first-step inspection.
- What changed: no product files changed before inspection.
- What was verified: inspected `docs/REAL_CONNECTED_RUN.md`, `docs/CONNECTED_GOLDEN_PATH.md`, Milestone 14 progress, `WORKFLOW.md`, package scripts, CI workflow, daemon routes, approval registry, persisted event store, review artifact refresh, write-action status/history, web API helpers, issue board/proof UI, type schemas, and daemon tests. The worktree still has the unrelated pre-existing `GOAL_PROGRESS.md` move; it remains untouched.
- Remaining work: document the approval evidence contract, trace the file-summary null root cause, add typed evidence responses, harden daemon/UI surfaces, add tests, run the real-run regression check, and validate.
- Blockers or risks: the old real run data exists in `apps/daemon/.data/agentboard.sqlite`, not the root `.data/agentboard.sqlite`; the root database currently only contains daemon cleanup events.

## Checkpoint 1 - Approval Evidence Contract

- Current checkpoint: approval evidence contract.
- What changed: created `docs/APPROVAL_EVIDENCE_SURFACE.md`.
- What was verified: the contract defines approval records, required evidence before future writes, file-summary source precedence, event/review-artifact relationships, missing-evidence behavior, UI states, implemented scope, deferred scope, no user-facing Demo Mode, and disabled/gated GitHub/Linear writes.
- Remaining work: trace and fix the `fileSummary: null` behavior in the daemon/API and UI.
- Blockers or risks: none for the contract checkpoint.

## Checkpoint 2 - Trace The fileSummary Null Bug

- Current checkpoint: file-summary root cause.
- What changed: inspected the real Milestone 14 run events in `apps/daemon/.data/agentboard.sqlite` and traced the approval mapping path.
- What was verified: run `05e74792-72ff-4890-90be-fea430104134` has two `approval.requested` events with `approvalType: "file_change"` and `fileSummary: null`. The same run has persisted `git.diff.generated` events and a ready review artifact with changed-file data. The mapper only read `grantRoot` from Codex file-change approvals, and daemon approval records were live memory records rather than a durable evidence read model.
- Remaining work: expose durable approval evidence from persisted events and review artifacts.
- Blockers or risks: no product decision needed; the source-of-truth model is event/review derived and avoids duplicating stale summaries.

## Checkpoint 3 - Approval Evidence Data Model

- Current checkpoint: approval evidence data model.
- What changed: added typed schemas for write-action availability, file-summary source, hook output summary, run evidence summary, and `RunApprovalEvidence`.
- What was verified: the schema exposes changed files, file summary, evidence summary, review artifact status/identifier, hook output, event count, final run state, provider, workspace path, write-action availability, missing-evidence reasons, and reconstructed approvals.
- Remaining work: harden daemon/API responses and wire the UI.
- Blockers or risks: none.

## Checkpoint 4 - Daemon/API Evidence Responses

- Current checkpoint: daemon/API hardening.
- What changed: added `GET /runs/:id/approval-evidence`; extended `GET /runs/:id/write-actions` with write-action availability; changed approval listing to reconstruct persisted approvals from `approval.*` events and hydrate missing file summaries from review artifact diff or `git.diff.generated` events; taught the Codex event mapper to capture more file-change summary fields when the provider supplies them.
- What was verified: `pnpm --filter @symphonia/daemon lint` passed after package rebuild; focused daemon tests passed after updating stale-approval recovery expectations.
- Remaining work: complete UI evidence and write-gate rendering.
- Blockers or risks: recovered stale approvals are now visible as resolved/cancelled records instead of disappearing, so the older test expectation was updated.

## Checkpoint 5 - Approval/Review UI Surface

- Current checkpoint: UI evidence surface.
- What changed: the run detail proof view now loads approval evidence, shows run/workspace/review artifact context, file-change summary, changed files, event count, hook/test output, missing-evidence warnings, and write-gate availability. File summaries are never silently displayed as `null`; missing evidence gets an explicit warning.
- What was verified: `pnpm --filter @symphonia/web lint` passed.
- Remaining work: finish write-gate clarity testing and real-run regression.
- Blockers or risks: none.

## Checkpoint 6 - Write-Action Gating Clarity

- Current checkpoint: write-action gating clarity.
- What changed: write availability now reports GitHub and Linear action status as `read_only`, `disabled`, `gated`, `unavailable`, `blocked`, or `enabled`, with reasons and required evidence. Current `WORKFLOW.md` still keeps GitHub and Linear read-only and writes disabled.
- What was verified: the daemon test confirms `/runs/:id/write-actions` returns no executable actions and availability reasons instead. The copied real-run regression reports GitHub PR creation and Linear comments as `read_only`, with read-only and disabled-write reasons.
- Remaining work: full validation commands.
- Blockers or risks: no writes were enabled.

## Checkpoint 7 - Tests

- Current checkpoint: tests.
- What changed: added daemon tests for deriving file summaries from persisted review artifacts, returning explicit missing evidence, surfacing review artifact readiness, exposing write-action availability, and keeping write actions gated/read-only. Updated stale approval recovery coverage to expect visible resolved/cancelled evidence.
- What was verified:
  - `pnpm --filter @symphonia/daemon test` passed with 39 tests.
  - `pnpm --filter @symphonia/daemon lint` passed.
  - `pnpm --filter @symphonia/web lint` passed.
- Remaining work: real-run regression and full validation.
- Blockers or risks: none.

## Checkpoint 8 - Real-Run Regression Check

- Current checkpoint: real-run regression.
- What changed: copied `apps/daemon/.data/agentboard.sqlite` to `/private/tmp` and verified the new approval evidence read model against Milestone 14 run `05e74792-72ff-4890-90be-fea430104134` without mutating the original database.
- What was verified:
  - final state evidence remained available for the run;
  - event count is 659;
  - review artifact status is `ready`;
  - `fileSummary` is now derived as `18 changed files, +1533 -510...`;
  - `fileSummarySource` is `review_artifact`;
  - both file-change approvals now hydrate a non-null file summary;
  - changed-file count is 18;
  - GitHub PR creation availability is `read_only`;
  - Linear comment availability is `read_only`;
  - missing evidence reasons are empty for the copied real run.
- Remaining work: run full validation commands and document results.
- Blockers or risks: the first `tsx` regression command failed inside the sandbox with the known IPC pipe `EPERM`; rerunning outside the sandbox succeeded.

## Checkpoint 9 - Validation

- Current checkpoint: validation.
- What changed: ran the discovered validation commands after the evidence/API/UI/test changes.
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

- Current checkpoint: Milestone 15A completion review.
- What changed: added the approval evidence contract, typed evidence schemas, approval evidence endpoint, persisted approval reconstruction, file-summary derivation from review artifacts/diff events, write-action availability reasons, UI evidence panels, and daemon coverage.
- What was verified: the copied real Milestone 14 run now reports a non-null file summary from review artifact evidence, 659 persisted events, 18 changed files, ready review artifact status, hydrated file-change approval summaries, empty missing-evidence reasons, and read-only GitHub/Linear availability.
- Remaining work: none for Milestone 15A.
- Blockers or risks: future write enablement still requires a separate explicit-approval milestone; no GitHub or Linear writes were enabled here.
