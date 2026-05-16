# Milestone 15D-P - PR-State-Aware Linear Comment Policy Progress

## Checkpoint 0 - Initial State

- Current checkpoint: Required first step inspection.
- What changed: Created the 15D-P progress ledger.
- What was verified: 15D implementation exists and correctly blocked the selected ALV-6 comment because live PR #34 was merged while the comment body claimed draft/open review state.
- Remaining work: Add PR-state-aware preview fields, update comment generation/execution gating, update UI, add tests, revalidate ALV-6, and run validation.
- Blockers or risks: No Linear comment may be posted without explicit confirmation.

## Checkpoint 1 - PR-State-Aware Contract

- Current checkpoint: Contract created.
- What changed: Added `docs/PR_STATE_AWARE_LINEAR_COMMENT_POLICY.md`.
- What was verified: The policy supports draft/open, open non-draft, and merged PR comment intents, blocks unavailable/ambiguous PR state, and keeps closed-unmerged comments deferred by default.
- Remaining work: Implement the model in code and tests.
- Blockers or risks: None for implementation.

## Checkpoint 2 - PR State Model

- Current checkpoint: Shared model hardened.
- What changed: Added PR-state and comment-intent fields for Linear comment previews, plus reusable Linear comment execution request/response types and generalized local write audit records for GitHub PR and Linear comment writes.
- What was verified: The model represents PR number, URL, state, draft flag, base/head branches, target repository, verification source, blockers, and warnings.
- Remaining work: Generate PR-state-aware previews and validate execution gating.
- Blockers or risks: None.

## Checkpoint 3 - PR-State-Aware Preview Generation

- Current checkpoint: Linear comment preview generation updated.
- What changed: Linear comment previews now load the successful GitHub PR execution record, verify live GitHub PR state when possible, derive a `commentIntent`, and generate a state-specific body.
- What was verified: Open draft PRs produce `draft_pr_ready_for_review`, open non-draft PRs produce `pr_ready_for_review`, merged PRs produce `pr_merged`, and closed-unmerged PRs block by default.
- Remaining work: Harden execution validation and UI display.
- Blockers or risks: Live GitHub verification must remain read-only; unavailable or ambiguous PR state blocks writeback.

## Checkpoint 4 - Execution Gating

- Current checkpoint: Linear comment execution route updated.
- What changed: `POST /runs/:id/linear/comment/create` now validates the selected preview, payload hash, idempotency key, target Linear issue, comment body, live PR state, confirmation phrase, Linear write gates, and local audit persistence before transport.
- What was verified: Execution blocks when live PR state contradicts the preview, when PR state is unavailable, when the payload hash changes, when confirmation is missing or wrong, and when Linear write mode remains read-only.
- Remaining work: UI display and real selected-run revalidation.
- Blockers or risks: This milestone still does not enable Linear status updates.

## Checkpoint 5 - UI Display

- Current checkpoint: UI/API display updated.
- What changed: The write preview UI shows GitHub PR number, PR URL, live PR state, draft flag, comment intent, verification time, write payload hash, preview state hash, blockers, and the Linear comment confirmation action only when the preview is executable.
- What was verified: The UI copy no longer implies a merged PR is still a draft awaiting review; Linear status updates remain preview-only and blocked.
- Remaining work: Revalidate ALV-6 and PR #34 with the updated daemon.
- Blockers or risks: None.

## Checkpoint 6 - Selected Run and PR State Revalidation

- Current checkpoint: ALV-6 revalidated without external writes.
- What changed: Started an updated daemon on port `4115` against `/Users/diegomarono/symphonía/apps/daemon/.data/agentboard.sqlite` to exercise the current code against the real stored run.
- What was verified: Run `5172045d-e87f-4405-8fee-74fca3f0c59b` exists, issue `ALV-6` is available, approval evidence is ready, review artifact is ready, changed file remains `docs/pr-write-verification-smoke.md`, local GitHub execution record references PR #34, live PR #34 is `MERGED` and not draft, GitHub writes remain disabled, Linear writes remain read-only, and Linear status update remains disabled/non-executable.
- Remaining work: Record the final confirmation packet and complete validation.
- Blockers or risks: A real Linear comment still requires explicit human confirmation and Linear comment gates.

## Checkpoint 7 - Final Human Confirmation Packet

- Current checkpoint: Final Linear write boundary recorded.
- What changed: Generated a PR-state-aware Linear comment preview for the selected run and recorded the manual confirmation packet.
- What was verified: Preview `write-preview-5172045d-e87f-4405-8fee-74fca3f0c59b-linear_comment_create-8cd5917692a8` has `commentIntent: pr_merged`, live PR state `merged`, and does not claim the PR is draft or awaiting review.
- Remaining work: Await explicit human confirmation before any Linear write.
- Blockers or risks: Linear write mode is `read_only`; Linear comments are disabled; no Linear write occurred.

### Confirmation Packet

- Run ID: `5172045d-e87f-4405-8fee-74fca3f0c59b`
- Issue: `ALV-6 - PR write verification smoke change`
- Target Linear issue ID: `ad1441fc-d12f-4d76-88c0-02df11cfcc12`
- Target Linear issue key: `ALV-6`
- GitHub PR: `#34` - `https://github.com/agora-creations/symphonia/pull/34`
- Live PR state: `merged`
- Comment intent: `pr_merged`
- Changed files: `docs/pr-write-verification-smoke.md`
- Review artifact: `ready` (`review-artifact:5172045d-e87f-4405-8fee-74fca3f0c59b`)
- Approval evidence: `ready` (`approval-evidence:review_artifact`)
- writePayloadHash: `8cd5917692a89e86f9ee1e79fb53a77c8b7cf5f19bbb857bf89936887b1468df`
- payloadHash legacy alias: `8cd5917692a89e86f9ee1e79fb53a77c8b7cf5f19bbb857bf89936887b1468df`
- previewStateHash: `ddb9d47d1889139022d967f2ed54050c237b716e18a9908d12a5a5f046adf003`
- approvalEvidenceHash: `5e3769f233a576f347231502ab76b037faf0af88fbb2cfa7973f88fbce0cdd6a`
- Idempotency key: `preview:linear_comment_create:5172045d-e87f-4405-8fee-74fca3f0c59b:8cd5917692a89e86f9ee1e79`
- Current Linear write mode: `read_only`
- Required write-mode change: enable Linear manual comment write mode for this single action only.
- Exact confirmation phrase: `POST LINEAR COMMENT`
- Exact API request: `POST /runs/5172045d-e87f-4405-8fee-74fca3f0c59b/linear/comment/create`
- Linear status updates: disabled and not approved.
- GitHub writes: disabled and not approved.

Proposed comment body:

```text
Symphonia completed a Codex run for ALV-6, and the resulting GitHub PR has been merged.

Merged PR: #34: https://github.com/agora-creations/symphonia/pull/34
Run ID: 5172045d-e87f-4405-8fee-74fca3f0c59b
Changed files:
- docs/pr-write-verification-smoke.md

Review artifact: ready.
Approval evidence: ready.

<!-- symphonia-run-id: 5172045d-e87f-4405-8fee-74fca3f0c59b -->
```

## Checkpoint 8 - Optional Linear Comment

- Current checkpoint: Paused before external write.
- What changed: No Linear comment write was attempted.
- What was verified: A real comment would require explicit confirmation of the packet above, Linear manual comment gates, matching `writePayloadHash`, matching idempotency key, and exact phrase `POST LINEAR COMMENT`.
- Remaining work: Human confirmation is required to continue to Outcome B.
- Blockers or risks: No blocker for preview; the write boundary is intentionally closed.

## Checkpoint 9 - Post-Write Verification

- Current checkpoint: Not executed.
- What changed: No post-write verification ran because no comment was posted.
- What was verified: Not applicable.
- Remaining work: If a comment is explicitly confirmed later, verify the comment exists, matches the merged-PR preview, and references PR #34 and the run ID.
- Blockers or risks: None.

## Checkpoint 10 - Idempotency Verification

- Current checkpoint: Automated/fake transport coverage only.
- What changed: Added focused tests for stale preview blocking and idempotent Linear comment behavior through the existing local write audit path.
- What was verified: A stale draft-review request is blocked after the live PR state becomes merged; existing Linear comment idempotency coverage still verifies replay behavior with fake transport.
- Remaining work: Real idempotent retry only applies after an explicitly confirmed Linear comment write.
- Blockers or risks: None.

## Checkpoint 11 - Write Gate State

- Current checkpoint: Gates remain safe.
- What changed: No gate changes were made.
- What was verified: `/writes/status` reports GitHub `enabled: false`, GitHub `readOnly: true`, Linear `enabled: false`, Linear `readOnly: true`, and no executable Linear status update.
- Remaining work: None unless a later continuation explicitly confirms a Linear comment write.
- Blockers or risks: None.

## Checkpoint 12 - Tests

- Current checkpoint: Focused tests added.
- What changed: Added daemon tests for PR-state-aware Linear comment previews across draft, merged, and closed-unmerged PR states.
- What was verified: Merged PRs generate `pr_merged` comments with a new write payload hash; closed-unmerged PRs block; stale preview execution blocks; fake GitHub/Linear transports are used.
- Remaining work: Run full validation.
- Blockers or risks: None.

## Checkpoint 13 - Validation and Final Status

- Current checkpoint: Outcome A - safe pause at final Linear write boundary.
- What changed: Ran validation, confirmed write gates remain closed, and confirmed no temporary daemon remains on port `4115`.
- What was verified: PR #34 live state is detected as merged; the selected run's Linear comment preview is PR-state-aware; the preview body is a merged-PR comment and does not claim the PR is draft or awaiting review; stable `writePayloadHash` is recorded; Linear status updates remain disabled; GitHub writes remain disabled.
- Remaining work: Human confirmation is required before any Linear comment write.
- Blockers or risks: No product blocker remains for preview. The only intentional blocker is the external Linear write boundary.

Validation results:

- `pnpm --filter @symphonia/daemon test` - passed.
- `pnpm --filter @symphonia/daemon lint` - passed.
- `pnpm --filter @symphonia/web lint` - passed.
- `pnpm lint` - passed.
- `pnpm test` - passed.
- `pnpm build` - passed.
- `pnpm desktop:build` - passed.
- `pnpm harness:scan --path .` - sandbox run failed with `listen EPERM` for the `tsx` temporary IPC pipe; rerun with escalation passed.
- `git diff --check` - passed.
- `pnpm validate:ci` - sandbox run failed at `pnpm harness:scan --path .` with the same `tsx` IPC `listen EPERM`; rerun with escalation passed.

Final confirmation status:

- Final confirmation packet: recorded in Checkpoint 7.
- Real Linear comment created: no.
- Linear approval record created for this comment: no.
- Linear execution record created for this comment: no.
- Linear status update: no.
- GitHub mutation: no.
- Temporary Linear gates: not enabled.
- Temporary GitHub gates: not enabled.

## Checkpoint 14 - Human-Confirmed Linear Comment Write

- Current checkpoint: Outcome B - exactly one human-confirmed PR-state-aware Linear comment created.
- What changed: After explicit human confirmation, temporarily enabled only Linear manual comment creation, restarted the updated daemon against the real run database, revalidated the executable preview, posted one Linear comment, verified idempotency, rejected an idempotency conflict with a different payload hash, restored `WORKFLOW.md`, and restarted the temporary daemon to verify gates returned to read-only/disabled.
- What was verified: The write used `commentIntent: pr_merged`; the approved body says PR #34 has been merged and does not say the PR is draft or awaiting review; target issue is `ALV-6`; write payload hash matched; local approval and execution records exist; idempotent retry returned the existing result; Linear status updates remained disabled; GitHub writes remained disabled.
- Remaining work: None for 15D-P Outcome B.
- Blockers or risks: A direct shell Linear GraphQL readback could not authenticate because the shell does not have `LINEAR_API_KEY`; the guarded daemon route did authenticate through the app auth layer and returned the Linear comment metadata.

Write result:

- Linear comment ID: `a69c99a1-0dd1-44f5-a96f-616588ec0343`
- Linear comment URL: `https://linear.app/alvy-singer/issue/ALV-6/pr-write-verification-smoke-change#comment-a69c99a1`
- Target Linear issue ID: `ad1441fc-d12f-4d76-88c0-02df11cfcc12`
- Target Linear issue key: `ALV-6`
- Approval record: `write-approval-7ec26b6790e98266f808df30`
- Execution record: `write-execution-7ec26b6790e98266f808df30`
- Approval timestamp: `2026-05-16T16:48:55.554Z`
- Execution started: `2026-05-16T16:48:55.554Z`
- Execution completed: `2026-05-16T16:48:56.821Z`
- writePayloadHash: `8cd5917692a89e86f9ee1e79fb53a77c8b7cf5f19bbb857bf89936887b1468df`
- Idempotency key: `preview:linear_comment_create:5172045d-e87f-4405-8fee-74fca3f0c59b:8cd5917692a89e86f9ee1e79`
- Idempotent retry: `already_executed`, returned the same comment URL.
- Different payload hash with same idempotency key: blocked as `conflict`.
- GitHub writes after restore: `enabled: false`, `readOnly: true`.
- Linear writes after restore: `enabled: false`, `readOnly: true`.
- Linear status update preview after restore: `read_only`.
- Temporary daemon on port `4115`: stopped.
- Final validation: `pnpm validate:ci` passed with escalation for the `tsx` harness IPC requirement; `git diff --check` passed.

Posted comment body:

```text
Symphonia completed a Codex run for ALV-6, and the resulting GitHub PR has been merged.

Merged PR: #34: https://github.com/agora-creations/symphonia/pull/34
Run ID: 5172045d-e87f-4405-8fee-74fca3f0c59b
Changed files:
- docs/pr-write-verification-smoke.md

Review artifact: ready.
Approval evidence: ready.

<!-- symphonia-run-id: 5172045d-e87f-4405-8fee-74fca3f0c59b -->
```
