# Milestone 15D - Manual Linear Comment Writeback Progress

## Checkpoint 0 - Initial State

- Current checkpoint: Required first step inspection.
- What changed: Created the 15D progress ledger.
- What was verified: The milestone starts from 15C-V6 Outcome B: PR #34 exists for run `5172045d-e87f-4405-8fee-74fca3f0c59b`; the current Linear comment execution route is still disabled before 15D implementation.
- Remaining work: Implement or harden Linear comment preview/execution, UI display, tests, revalidation, and final confirmation packet.
- Blockers or risks: No human confirmation for a real Linear comment has been provided, so the milestone must stop at the Linear write boundary unless confirmation arrives later.

## Checkpoint 1 - Linear Comment Writeback Contract

- Current checkpoint: Contract created.
- What changed: Added `docs/MANUAL_LINEAR_COMMENT_WRITEBACK.md`.
- What was verified: The contract limits 15D to one manually confirmed Linear comment and explicitly keeps Linear status changes and GitHub writes forbidden.
- Remaining work: Add execution types, route, gating, UI, tests, and validation.
- Blockers or risks: None for implementation; real Linear mutation remains blocked without explicit confirmation.

## Checkpoint 2 - Linear Comment Execution Types

- Current checkpoint: Shared execution types hardened.
- What changed: Added Linear comment execution request/response schemas and generalized local write approval/execution records for `linear_comment_create`.
- What was verified: Existing GitHub approval/execution records remain parseable with nullable Linear fields.
- Remaining work: Route, UI, tests, selected-run revalidation, and final status.
- Blockers or risks: None for local implementation.

## Checkpoint 3 - Linear Comment Preview and Payload

- Current checkpoint: Stable Linear comment preview hardened.
- What changed: Linear comment previews now require a successful GitHub draft PR execution record for the same run before becoming eligible. The comment body references the run, PR URL, changed files, evidence status, and review requirement without local workspace paths.
- What was verified: `writePayloadHash` covers the target issue, comment body, run identity, PR reference, changed files, evidence identity, and review artifact identity. Mutable gate state remains represented by `previewStateHash`.
- Remaining work: Execution route verification and selected-run final packet/blocker.
- Blockers or risks: Live PR state must remain open draft; otherwise the preview/execution blocks.

## Checkpoint 4 - Linear Comment Execution Route

- Current checkpoint: Route implemented.
- What changed: Replaced the placeholder HTTP 405 for `POST /runs/:id/linear/comment/create` with a confirmation-gated execution route for `linear_comment_create` only.
- What was verified: The route validates preview ID, action kind, `writePayloadHash`, idempotency key, target issue, comment body, exact confirmation phrase, Linear manual comment gates, approval evidence, review artifact, and successful GitHub PR execution record. The route persists a local approval record and in-progress execution record before calling the Linear transport.
- Remaining work: UI display, selected-run revalidation, and broader validation.
- Blockers or risks: Linear status updates remain disabled and are not executable in this milestone.

## Checkpoint 5 - UI Confirmation Flow

- Current checkpoint: UI/API updated.
- What changed: Added a web API client for Linear comment creation and updated the write preview UI to show Linear comment execution status, idempotency, payload hashes, and a `POST LINEAR COMMENT` confirmation action when gates are satisfied.
- What was verified: The UI action is unavailable while preview blockers or read-only gates remain in force. Linear status previews remain non-executable.
- Remaining work: Selected-run revalidation and validation commands.
- Blockers or risks: None for UI display.

## Checkpoint 8 - Selected Run and PR Revalidation

- Current checkpoint: Selected ALV-6 run and PR checked.
- What changed: Revalidated run `5172045d-e87f-4405-8fee-74fca3f0c59b` through the local daemon and checked PR #34 live with GitHub.
- What was verified: The run exists and is succeeded, approval evidence is ready, review artifact is ready, changed files are limited to `docs/pr-write-verification-smoke.md`, GitHub gates are read-only/disabled, Linear gates are read-only/disabled, and no Linear comment execution record exists for 15D.
- Remaining work: Validation commands and final report.
- Blockers or risks: Live GitHub PR #34 is no longer an open draft. It is `MERGED` and `isDraft=false`, so the 15D comment packet that says the PR remains draft is no longer valid. No Linear comment was posted.

## Checkpoint 9 - Final Human Confirmation Packet

- Current checkpoint: Packet not issued.
- What changed: The packet was intentionally withheld because the PR state changed after 15C-V6.
- What was verified: The local preview still references PR #34, but live PR state is now merged. Posting the planned comment would misrepresent the PR as draft/open.
- Remaining work: Decide whether to create a new draft PR candidate or define a separate post-merge Linear comment policy.
- Blockers or risks: This milestone is blocked for the selected run unless the product explicitly changes the comment contract for already-merged PRs.

## Checkpoint 16 - Tests

- Current checkpoint: Focused daemon tests passed.
- What changed: Added coverage for the manual Linear comment path with fake transports.
- What was verified: `pnpm --filter @symphonia/daemon test -- http.test.ts` and `pnpm --filter @symphonia/daemon test` passed. Coverage includes read-only/blocking behavior, successful fake Linear comment creation after a GitHub PR execution record, audit-before-transport persistence, idempotent retry, duplicate idempotency conflict, no GitHub mutation during Linear comment execution, no Linear status mutation, and live PR state validation.
- Remaining work: Full validation command set.
- Blockers or risks: None caused by the implementation.

## Checkpoint 17 - Validation

- Current checkpoint: Validation complete.
- What changed: Ran the required validation commands for the 15D implementation.
- What was verified: `pnpm --filter @symphonia/daemon test`, `pnpm --filter @symphonia/daemon lint`, `pnpm --filter @symphonia/web lint`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm desktop:build`, `git diff --check`, and escalated `pnpm validate:ci` passed. `pnpm harness:scan --path .` passed when rerun with escalation after sandbox-only `tsx` IPC pipe `EPERM`.
- Remaining work: None for local validation.
- Blockers or risks: The only selected-run blocker remains PR #34 live state: merged and no longer draft/open.

## Final Status - Outcome C

- Current checkpoint: Blocked.
- What changed: 15D implementation and docs were added, but no real Linear write was performed.
- What was verified: The selected run/evidence/review state remains usable, but live PR #34 is merged and no longer draft/open.
- Remaining work: A focused follow-up should either use a new open draft PR candidate for the first Linear comment writeback or explicitly define a post-merge comment policy.
- Blockers or risks: The original 15D comment body would be false because it says the PR remains draft and requires review.
