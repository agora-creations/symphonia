# PR-State-Aware Linear Comment Policy

Milestone 15D blocked correctly because the local GitHub execution record was no longer enough to prove the proposed Linear comment was true. The local record still pointed at PR #34, but live GitHub state showed the PR had already been merged and was no longer a draft. Posting a comment that said the PR remained draft and needed review would have been stale and false.

This milestone permits at most one manually confirmed Linear comment and no Linear status changes.

## Supported PR States

Linear comment writeback must derive its comment intent from live GitHub PR state whenever live verification is available:

- `open` + draft: `draft_pr_ready_for_review`
- `open` + not draft: `pr_ready_for_review`
- `merged`: `pr_merged`
- `closed` + not merged: blocked by default
- `unavailable` or `unknown`: blocked

Closed-unmerged PR comments are deferred until a product policy explicitly defines whether they should be posted and what they should say.

## Verification

The local GitHub PR execution record identifies the PR that came from the run. Live GitHub read verification then checks the PR number, URL, title, base branch, head branch, draft flag, open/closed state, and merged flag when available.

If the local record and live PR disagree on base/head branch or the PR cannot be verified, Linear comment execution blocks. The system must not silently rewrite a comment after human approval.

## Comment Intents

`draft_pr_ready_for_review` says a draft PR was created and is ready for human review.

`pr_ready_for_review` says a non-draft PR is open and ready for review.

`pr_merged` says the PR created from the run has already been merged.

`pr_closed_unmerged` is currently blocked by policy.

`unavailable` is used when no safe PR state can be established.

## Hashes

`writePayloadHash` covers the actual Linear comment payload, target issue identity, run identity, PR reference, live PR state, comment intent, changed files, approval evidence identity, and review artifact identity.

Changing the live PR state from draft/open to merged changes the comment body and therefore changes `writePayloadHash`.

`previewStateHash` remains separate. It may change when write gates, blockers, warnings, read-only state, or availability state changes without changing the comment payload.

The idempotency key is derived from the action kind, run ID, and `writePayloadHash`, so each distinct PR-state-aware comment payload gets its own idempotency identity.

## UI

The UI must show the PR number, PR URL, live PR state, comment intent, proposed body, `writePayloadHash`, `previewStateHash`, required confirmation phrase, current gate state, and blockers.

When a PR is merged, the UI must not say the draft PR is awaiting review.

## Execution

Execution requires:

- A target Linear issue.
- Complete run evidence.
- Ready review artifact.
- A successful local GitHub PR execution record.
- Live PR state that matches the current preview intent.
- Matching `writePayloadHash`.
- Matching idempotency key.
- Manual Linear comment write mode.
- Exact confirmation phrase.
- Local approval and execution audit records persisted before transport.

Execution blocks if the PR state is unavailable, ambiguous, closed-unmerged, or contradicts the approved comment body.

Linear status updates remain disabled. GitHub writes remain disabled.
