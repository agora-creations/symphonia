# Approval Evidence Surface

Milestone 15A makes the review and approval surface explicit enough for a human to decide what happened in a completed Codex run before any future GitHub or Linear write action is considered.

GitHub and Linear writes remain disabled/gated in this milestone.

There is no user-facing Demo Mode in this milestone.

## Approval Record

An approval record is the human-reviewable representation of a provider approval request tied to a run. For Codex app-server runs it is sourced from persisted `approval.requested`, `approval.resolved`, and `approval.recovered` events, plus any live in-memory approval request that is still waiting for a user decision.

Approval records include:

- approval id
- run id
- provider
- approval type
- prompt or reason
- command and cwd when the request is command-scoped
- file summary when the request is file-change-scoped and evidence exists
- available decisions
- status and decision
- requested/resolved timestamps

Pending live records may also exist in daemon memory while Codex waits for a response. Completed or restarted runs must not depend on daemon memory; the persisted event stream is the source of truth.

## Required Evidence Before Approval Of Future Writes

Before a future write action can be approved, the review surface must show:

- issue identity
- run identity
- provider identity
- workspace path
- final run state
- persisted event count
- changed files or an explicit no-changes state
- file-change summary or an explicit missing-evidence reason
- hook/test output summary when hooks ran
- review artifact status and identifier
- available write-action posture and blockers

If any required evidence is missing, the UI must say what is missing and why it matters.

## File Summary Source

File summaries are derived in this order:

1. `approval.requested.fileSummary`, when Codex supplies it.
2. The persisted review artifact diff snapshot for the run.
3. The latest persisted `git.diff.generated` event for the run.
4. An explicit missing-evidence reason.

The approval surface must not invent a summary. When a diff exists, the summary is a mechanical summary of the recorded file count, additions, deletions, and leading file paths. When a diff shows no files changed, the UI should show an explicit empty state.

## Relationship To Run Events

Run events remain the chronological source of truth for what happened. The approval evidence package is a derived read model over those events plus the review artifact snapshot. It is intended for review and gating, not for hiding or replacing the timeline.

Relevant event groups:

- `approval.*` for provider approval requests and decisions.
- `workspace.ready` for workspace path.
- `hook.*` for hook/test output.
- `run.status` for final state and errors.
- `git.diff.generated` for local file-change evidence.
- `github.review_artifacts.refreshed` for the review artifact snapshot.
- `integration.write.*` for future write previews/results.

## Review Artifact Relationship

Review artifacts capture a persisted snapshot of local git state, diff summary, GitHub read-only health, PR lookup, checks, workflow runs, and any artifact refresh error. Approval evidence should reference the latest review artifact for the run and expose its status.

The review artifact is not a write action. It is the human review artifact that future write actions can use as evidence.

## Write Gates

Write actions remain governed by `WORKFLOW.md` policy and explicit confirmation gates:

- GitHub PR creation remains unavailable while GitHub is read-only, writes are disabled, PR creation is disabled, credentials are unavailable, evidence is missing, an existing PR conflicts, or the branch policy blocks the action.
- Linear comments remain unavailable while Linear is read-only, writes are disabled, comments are disabled, credentials are unavailable, issue identity is missing, or evidence is missing.
- Linear state transitions, GitHub pushes, GitHub comments, and reviewer requests remain deferred unless a future milestone adds explicit gates for them.

Milestone 15A may show future write actions as read-only, disabled, gated, unavailable, or blocked, but it must not make them executable.

## Field Requirements

Required:

- issue identity
- run identity
- provider
- final run state
- event count
- workspace path or missing workspace reason
- review artifact status
- write-action availability
- missing evidence reasons

Derived:

- changed files
- file summary
- evidence summary
- hook/test output summary
- approval records reconstructed from persisted events

Optional:

- Codex thread, turn, or item ids
- command approval command/cwd
- GitHub checks, statuses, workflow runs, and PR lookup
- review artifact error

Unavailable:

- Any value not supplied by provider events, local git inspection, hook output, review artifacts, or write-gate policy. Unavailable values must be labeled with a missing-evidence reason.

## Missing Evidence Behavior

For completed runs, missing file-change evidence is a review blocker, not a silent null. The UI should say whether:

- no review artifact exists;
- no git diff event exists;
- workspace was unavailable;
- workspace was not a git repository;
- review artifact refresh failed;
- file changes were genuinely empty.

For failed runs, the UI should still show whatever evidence exists and explain that final state is failed.

For partial runs, the UI should show available events and mark missing final evidence as pending or unavailable.

## UI States

Completed:

- Show final state, event count, workspace, changed files, file summary, hook output, review artifact, and gated write actions.

Failed:

- Show failed state, error, event count, available evidence, missing evidence reasons, and gated write actions.

Partial:

- Show active/pending state, available events, pending review artifact state, and disabled write actions.

Evidence missing:

- Show a warning with missing evidence reasons and block future write readiness.

## Implemented In Milestone 15A

- Typed approval evidence response model.
- File-summary derivation from approval events, review artifacts, or diff events.
- Approval reconstruction from persisted events.
- Review/proof UI that shows file changes, file summary, event count, hook output, review artifact status, and missing-evidence reasons.
- Write-action availability explanations that keep writes gated/read-only.

## Deferred

- GitHub PR creation enablement.
- Linear comment enablement.
- Linear state transitions.
- Remote pushes.
- Issue intake.
- Multi-provider comparison.
- Broad runtime productionization.
