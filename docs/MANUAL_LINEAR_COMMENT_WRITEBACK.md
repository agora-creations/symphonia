# Manual Linear Comment Writeback

Milestone 15D follows the first successful human-confirmed GitHub draft PR. The GitHub path has proven that a completed run can produce approval evidence, a review artifact, a draft PR, local approval/execution audit records, and an idempotent retry result. The next external write is intentionally smaller: one manually confirmed Linear comment that links the completed run to the created draft PR.

This milestone permits at most one real Linear comment and no Linear status changes.

## Allowed Write

The only allowed Linear mutation is `linear_comment_create` on the selected issue. The comment must link:

- The completed Symphonia run.
- The created GitHub PR and its live state.
- The run ID.
- The changed file summary.
- The review/evidence status.
- A note that matches the live PR state.

## Forbidden Writes

The following remain forbidden:

- Linear status updates.
- Linear labels, assignees, descriptions, or state transitions.
- Additional Linear comments after the idempotent write.
- GitHub PR creation, push, update, merge, close, or branch cleanup.
- Any automatic external write.

## Eligibility

A run is eligible for comment writeback only when:

- The run exists and has usable approval evidence.
- The review artifact is ready or explicitly accounted for.
- A successful local GitHub PR execution record exists for the same run.
- The PR result includes a PR number or URL that can be referenced.
- If live GitHub read verification is available, the PR state is supported by the PR-state-aware comment policy and points at the expected base/head.
- The target Linear issue is unambiguous.
- The comment preview is available.
- Linear comment writes are manually enabled.
- Linear status update writes remain disabled.

## Comment Body

The comment should be concise and review-friendly. It should include the PR URL, run ID, changed files, evidence/review status, and state-specific wording. Draft/open PRs should ask for review. Merged PRs should say the PR was merged.

The comment must not include raw tokens, local secrets, long event logs, excessive run output, or private filesystem paths. Local paths should be omitted unless the product explicitly decides to expose them.

## Hashing

`writePayloadHash` is the human-approved identity of the Linear comment write. It covers the target issue identity, comment body, run identity, PR reference, changed files, approval evidence identity, and review artifact identity.

`previewStateHash` represents mutable readiness state such as read-only mode, write gates, blockers, warnings, and availability. Enabling Linear manual comment write mode may change `previewStateHash`, but must not change `writePayloadHash` when the target issue and comment body are unchanged.

`approvalEvidenceHash` identifies the evidence snapshot used to justify the write.

The idempotency key is derived from the action kind, run ID, and `writePayloadHash`. Reusing the same key with the same payload returns the existing execution result. Reusing it with a different payload blocks as a conflict.

If a live PR check shows that the PR has changed state, the preview must regenerate a state-specific body and `writePayloadHash`. Execution must block any previously approved payload whose body no longer matches live state.

## Confirmation

Execution requires explicit confirmation with:

- Permission to enable Linear manual comment write mode for this action only.
- Confirmation of the target Linear issue.
- Confirmation of the GitHub PR URL.
- Confirmation of `writePayloadHash`.
- Confirmation of the idempotency key.
- The exact phrase `POST LINEAR COMMENT`.
- An explicit statement that Linear status updates are not approved.

## Local Audit

The approval record must be persisted before the Linear transport is called. It records the run, issue, action kind, target system, target issue, payload hash, evidence/review sources, GitHub PR reference, confirmation type, confirmation phrase, approval time, and idempotency key.

The execution record is persisted before or during the write attempt. It records the approval record, idempotency key, target issue, external write status, Linear comment ID/URL when available, start/completion timestamps, and failure/blocking reasons.

## Verification

After a successful comment write:

- The comment exists on the selected Linear issue when readable.
- The comment body matches the approved preview.
- The comment references PR #34 and run `5172045d-e87f-4405-8fee-74fca3f0c59b`.
- Local approval and execution records exist.
- The approval record was persisted before the Linear write.
- The idempotent retry returns the existing result and creates no duplicate comment.
- Linear status updates remain disabled.
- GitHub write gates remain disabled.

After verification, temporary Linear comment write gates should return to read-only/disabled when the architecture supports it. If they cannot be restored safely, the remaining gate state must be documented and no further external write may proceed.
