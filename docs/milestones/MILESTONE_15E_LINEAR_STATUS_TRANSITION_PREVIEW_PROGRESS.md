# Milestone 15E - Manual Linear Status Transition Preview Progress

## Checkpoint 0 - Initial State

- Current checkpoint: Required first step inspection.
- What changed: Created the 15E progress ledger after inspecting the repo state, write-gate posture, 15D/15D-P docs, shared types, daemon routes, UI preview cards, Linear/GitHub readback code, local write audit persistence, and validation scripts.
- What was verified: The checkout was clean on `main`; `WORKFLOW.md` has Linear writes read-only/disabled and Linear status transitions disabled; the existing write-actions endpoint already renders GitHub PR and Linear comment previews plus a simple `linear_status_update` stub; 15D-P recorded the real merged-PR Linear comment write for run `5172045d-e87f-4405-8fee-74fca3f0c59b`.
- Remaining work: Define the preview-only status transition contract, harden schemas, generate PR-state-aware status previews, keep execution impossible, add UI coverage, add focused tests, run validation, and revalidate the real 15D run if safely available.
- Blockers or risks: No Linear status update may be executed in this milestone.

## Checkpoint 1 - Status Transition Preview Contract

- Current checkpoint: Contract created.
- What changed: Added `docs/LINEAR_STATUS_TRANSITION_PREVIEW.md`.
- What was verified: The contract defines preview-only semantics, forbidden writes, PR-state-aware intents, target-state configuration behavior, hash/idempotency metadata, blocking reasons, UI requirements, and the deferred 15F execution boundary.
- Remaining work: Implement the contract in shared types, daemon preview generation, UI, and tests.
- Blockers or risks: Target Linear status names are not guessed; missing config must block with a clear reason.

## Checkpoint 2 - Typed Status Preview Schemas

- Current checkpoint: Shared schemas updated.
- What changed: Added `LinearStatusTransitionIntent`, `LinearIssueStatusSnapshot`, expanded `LinearStatusUpdatePreview`, and added `already_satisfied` as a write preview status.
- What was verified: The preview model can represent current Linear status, proposed target status, transition intent, run state, live PR state, linked Linear comment execution, evidence/review identifiers, changed files, dry-run status, blockers, and warnings.
- Remaining work: Wire those fields into daemon preview generation and UI rendering.
- Blockers or risks: No executable status update request type was added.

## Checkpoint 3 - Status Policy Source

- Current checkpoint: Preview policy source hardened.
- What changed: The workflow parser now preserves configured `move_to_state_on_*` values for preview even when `allow_state_transitions` remains false.
- What was verified: Status execution is still controlled by `allow_state_transitions`; retaining target names only lets the preview explain a future transition without enabling it.
- Remaining work: Generate status previews that use these mappings by PR/run intent.
- Blockers or risks: Actual `WORKFLOW.md` does not configure target mappings, so real-run previews may block with missing target status until a policy is configured.

## Checkpoint 4 - Preview Generation

- Current checkpoint: Daemon preview generation updated.
- What changed: `GET /runs/:id/write-actions` now builds a PR-state-aware Linear status transition preview from run evidence, review artifacts, live PR context, current Linear issue state, local GitHub PR execution, and local Linear comment execution.
- What was verified: The preview derives intents including `pr_merged`, `pr_draft`, `pr_ready_for_review`, `pr_closed_unmerged`, `run_failed`, `evidence_missing`, and `unknown`; it records `writePayloadHash`, `previewStateHash`, and `approvalEvidenceHash` separately.
- Remaining work: Keep execution impossible, update UI, and add tests.
- Blockers or risks: Live Linear issue state falls back to cached state with a warning if app-authenticated readback fails.

## Checkpoint 5 - Live-State Awareness

- Current checkpoint: Live-state inputs separated from payload identity.
- What changed: `writePayloadHash` covers the future mutation payload and supporting PR/comment/evidence identity; `previewStateHash` covers mutable current Linear status, live PR state, blockers, warnings, and gate state.
- What was verified: If the Linear issue is already in the proposed target state, the status preview reports `already_satisfied`; changing current status changes `previewStateHash` without changing `writePayloadHash` for the same target mutation.
- Remaining work: Add regression tests and UI display.
- Blockers or risks: None.

## Checkpoint 6 - Execution Remains Impossible

- Current checkpoint: Status execution remains disabled.
- What changed: No Linear status execution route or mutation transport call was added.
- What was verified: The daemon still only has guarded GitHub PR creation and Linear comment creation write routes; `linear_status_update` remains preview-only through write-actions.
- Remaining work: Add tests that fail if preview generation calls Linear status mutation transports.
- Blockers or risks: None.

## Checkpoint 7 - UI Preview

- Current checkpoint: UI preview rendering updated.
- What changed: The run write-preview card now shows status intent, current state source, target status ID/name, PR state/reference, linked comment execution, and a preview-only note for Linear status transitions.
- What was verified: The UI still exposes no status update button; existing GitHub PR and Linear comment buttons remain limited to their respective action kinds.
- Remaining work: Run lint/build validation.
- Blockers or risks: None.

## Checkpoint 8 - 15D Real-Run Regression

- Current checkpoint: Real run revalidated.
- What changed: Started a temporary daemon on port `4115` against `apps/daemon/.data/agentboard.sqlite` and the app auth store, then queried `GET /runs/5172045d-e87f-4405-8fee-74fca3f0c59b/write-actions`.
- What was verified: The real run exposes a `linear_status_update` preview with `transitionIntent: pr_merged`, live PR #34 state `merged`, linked Linear comment execution `write-execution-7ec26b6790e98266f808df30`, current Linear status `Done` from live Linear readback, changed file `docs/pr-write-verification-smoke.md`, and no status execution route. The preview is `read_only` and blocked because Linear writes/status transitions remain disabled and no `pr_merged` target status mapping is configured in `WORKFLOW.md`.
- Remaining work: Configure an explicit target status policy before any 15F execution milestone.
- Blockers or risks: Direct shell Linear GraphQL auth remains unavailable without `LINEAR_API_KEY`; daemon/app auth readback worked. The temporary daemon was stopped.

## Checkpoint 9 - Tests

- Current checkpoint: Focused tests passed.
- What changed: Added daemon coverage for PR-state-aware Linear status previews, including merged PR intent, draft/closed intent handling, read-only/non-enabled status transition blockers, no Linear status mutation during preview, stable `writePayloadHash`, changing `previewStateHash`, and `already_satisfied`.
- What was verified: `pnpm --filter @symphonia/daemon test` passed with 51 tests. Full `pnpm test` also passed.
- Remaining work: None.
- Blockers or risks: None.

## Checkpoint 10 - Validation and Final Status

- Current checkpoint: Outcome A - preview-only Linear status transition contracts complete.
- What changed: Ran the required validation ladder and confirmed the selected real run produces a PR-state-aware, preview-only Linear status transition contract.
- What was verified: No Linear status update occurred, no new Linear comment was posted, no GitHub mutation occurred, Linear/GitHub write gates remain read-only/disabled, and UI/API display the status preview as preview-only.
- Remaining work: 15F can define manual Linear status transition execution only after a target status mapping is explicit.
- Blockers or risks: The real ALV-6 preview is blocked by missing `pr_merged` target status mapping in `WORKFLOW.md`, which is expected and safe for 15E.

Validation results:

- `pnpm build:packages` - passed.
- `pnpm --filter @symphonia/daemon test` - passed.
- `pnpm --filter @symphonia/daemon lint` - passed.
- `pnpm --filter @symphonia/web lint` - passed.
- `pnpm lint` - passed.
- `pnpm test` - passed.
- `pnpm build` - passed.
- `pnpm desktop:build` - passed.
- `pnpm harness:scan --path .` - sandbox run failed with `listen EPERM` for the `tsx` IPC pipe; rerun with escalation passed.
- `git diff --check` - passed.
- `pnpm validate:ci` - sandbox run failed at `pnpm harness:scan --path .` with the same `tsx` IPC `listen EPERM`; rerun with escalation passed.

Final status:

- Status transition preview contract: implemented.
- Selected run: `5172045d-e87f-4405-8fee-74fca3f0c59b`.
- Selected issue: `ALV-6 - PR write verification smoke change`.
- GitHub PR reference: `#34` / `https://github.com/agora-creations/symphonia/pull/34`.
- Live PR state used: `merged`, not draft.
- Current Linear status result: live readback returned `Done`.
- Proposed Linear target status result: not configured; preview blocks with `No Linear target status is configured for pr_merged.`
- Linear status execution: not implemented and not exposed.
- New Linear comment posted: no.
- GitHub mutation: no.
- Demo Mode or fake product issue: no.
