# Linear Status Transition Preview

Milestone 15E adds a preview-only contract for future Linear issue status transitions. It does not execute Linear status updates. It only shows what Symphonia would propose later, why the proposal is safe or blocked, and what evidence would have to be confirmed before a future execution milestone.

Milestone 15E does not execute Linear status updates. It only previews them.

## Forbidden Writes

The preview must not:

- update a Linear issue state;
- mutate Linear labels, assignee, priority, description, or comments;
- post a new Linear comment;
- create, update, merge, close, or clean up a GitHub PR;
- push a branch;
- enable automatic external writes.

Linear status execution remains unavailable even when a preview is complete.

## Preview Inputs

A status transition preview is derived from:

- the completed run and final run state;
- approval evidence and changed files;
- the review artifact snapshot;
- the target Linear issue identity;
- the current Linear issue state when it can be read through the app-authenticated Linear client;
- the successful GitHub PR execution record;
- live GitHub PR state when it can be verified;
- the successful Linear comment execution record when policy requires prior comment writeback;
- configured target-state mapping;
- current read-only/write-gate state.

Shell access to `LINEAR_API_KEY` is not required when the app auth layer can read Linear state.

## PR State Policy

The preview is PR-state-aware:

- merged PR: intent `pr_merged`;
- open non-draft PR: intent `pr_ready_for_review`;
- open draft PR: intent `pr_draft`;
- closed unmerged PR: intent `pr_closed_unmerged` and blocked by default;
- unavailable or unknown PR: intent `unknown` and blocked.

The preview must not propose a target that contradicts live PR state. A merged PR must not produce draft or review-needed wording.

## Target State Policy

Target Linear statuses must be explicit. Symphonia does not silently guess team-specific workflow names.

The current preview source is the existing configured state mapping:

- `pr_merged` uses `tracker.write.move_to_state_on_success`;
- `pr_draft` uses `tracker.write.move_to_state_on_start`;
- `pr_closed_unmerged` and `run_failed` use `tracker.write.move_to_state_on_failure`;
- `pr_ready_for_review` remains blocked until a review-specific target is configured by a later policy.

These configured names may be read for preview while `allow_state_transitions` remains false. That lets the UI show a future target without enabling execution. If a target is missing, the preview is blocked with a clear reason such as `No Linear target status is configured for pr_merged.`

If the current Linear status already equals the proposed target, the preview returns `already_satisfied`.

## Hashes

`writePayloadHash` identifies the future mutation payload: action kind, run, target Linear issue, proposed target status, transition intent, PR reference, linked comment execution, changed files, approval evidence, and review artifact identity.

`previewStateHash` identifies mutable readiness and live-state data: current Linear status, live PR state, blockers, warnings, write-gate state, confirmation requirements, and availability. It may change when Linear or GitHub live state changes.

`approvalEvidenceHash` identifies the evidence snapshot used to justify the preview.

The idempotency key is derived from `linear_status_update`, the run ID, and `writePayloadHash`. It is metadata only in this milestone because no status execution route is enabled.

## Blocking And Availability

The preview is blocked or unavailable when:

- approval evidence or review artifacts are missing;
- no successful GitHub PR execution record exists;
- live PR state is unavailable, unknown, contradictory, or closed without merge;
- no successful Linear comment execution record exists when policy requires comment writeback first;
- current Linear issue status cannot be read or inferred;
- target status is not configured;
- target status cannot be validated for future execution;
- Linear tracker is read-only or writes are disabled;
- Linear state transitions are disabled;
- credentials are unavailable.

Read-only mode still allows preview generation. It blocks execution only.

## UI Contract

The UI must show:

- action name: Linear status transition preview;
- target Linear issue;
- current Linear status and source;
- proposed target status;
- transition intent;
- PR state and PR reference;
- linked Linear comment execution record when present;
- approval evidence and review artifact source;
- `writePayloadHash`, `previewStateHash`, and idempotency key;
- blocking reasons and risk warnings;
- a preview-only/read-only badge.

The UI must not expose an executable status update button in 15E.

## Deferred

Future Milestone 15F may add a manually confirmed execution route only after target-state mapping is explicit, current Linear issue state can be read through guarded auth, and the preview remains PR-state-aware.
