# Write Approval Contract

Milestone 15B defines the preview-only contract for future external writes. It lets a reviewer see exactly what Symphonia would write to GitHub or Linear, what evidence supports that write, why execution is currently blocked, and what approval/audit metadata a future execution milestone must record.

Milestone 15B is preview-only. It does not execute GitHub or Linear writes.

There is no user-facing Demo Mode in this milestone.

## Write Action

A write action is a future external mutation that would affect a connected system outside the local workspace. The initial write action kinds are:

- `github_pr_create`
- `linear_comment_create`
- `linear_status_update`

The action names are intentionally specific. Symphonia should not expose a generic write button that hides the target system, payload, or risk.

## Write Action Preview

A write action preview is a dry-run contract. It is generated from a completed run, approval evidence, review artifacts, the selected issue, workspace state, and the current write policy.

A preview must show:

- target system;
- target repository, branch, issue, or state;
- action kind;
- title, body, or state payload where applicable;
- changed files involved;
- approval evidence source;
- review artifact source;
- required permissions;
- confirmation requirement;
- blocking reasons;
- risk warnings;
- idempotency key;
- generated timestamp;
- dry-run status.

Preview generation may read local event/review data and current local configuration. It must not create a PR, push a branch, post a Linear comment, update a Linear issue, or mutate remote state.

## Approval Contract

An approval contract is the immutable review shape that future write execution will require before mutating an external system. In 15B the contract is typed and rendered, but it is not approved or executed.

Required fields before a future write can ever be enabled:

- run id;
- issue id or identifier;
- action kind;
- target system;
- target identifier;
- exact proposed payload;
- approval evidence source;
- review artifact source;
- changed-file evidence for PR creation;
- final run state;
- blocking reasons or an empty blocked set;
- required permissions;
- confirmation prompt;
- idempotency key;
- generated timestamp;
- dry-run flag.

Optional fields:

- target repository;
- target branch;
- base branch;
- current Linear status;
- proposed Linear status;
- preview expiration;
- local user context.

Derived fields:

- proposed PR title/body from `WORKFLOW.md` templates;
- proposed Linear comment body from `WORKFLOW.md` templates;
- changed-file summary from approval evidence and review artifacts;
- availability status from write policy and missing evidence;
- idempotency key from run, action kind, target, and payload hash.

Unavailable fields must be explicit. The UI should show `blocked`, `unavailable`, `read_only`, or `evidence_missing` with the reason instead of hiding a missing action.

## Evidence Relationship

Write previews depend on the approval evidence surface from Milestone 15A:

- approval records come from persisted `approval.*` events;
- file summaries come from approval events, review artifacts, or `git.diff.generated` events;
- review artifacts provide the latest local git state, diff, GitHub read-only context, and PR lookup;
- hook/test output and event counts explain what was verified.

If approval evidence is missing, the preview status must be `evidence_missing` and execution remains unavailable.

## GitHub PR Preview

The GitHub PR preview must include:

- target owner/repository;
- base branch;
- proposed head branch when known;
- proposed draft PR title;
- proposed PR body;
- changed-file list and summary;
- review artifact reference;
- approval evidence reference;
- required permission: Pull requests write;
- blocking reasons such as read-only mode, writes disabled, PR creation disabled, missing credentials, missing branch, protected branch, existing PR, or missing evidence;
- future confirmation requirement.

Symphonia does not push branches in this milestone. If a future PR action needs a remote branch, the preview must say that branch publication is not part of 15B.

## Linear Comment Preview

The Linear comment preview must include:

- target Linear issue id or identifier;
- proposed comment body;
- run summary and final state;
- review artifact reference;
- approval evidence reference;
- required permission: Linear comment creation;
- blocking reasons such as read-only mode, writes disabled, comments disabled, missing credentials, missing issue identity, or missing evidence;
- future confirmation requirement.

## Linear Status Update Preview

The Linear status update preview must include:

- target Linear issue id or identifier;
- current known issue state;
- proposed future state if configured;
- final run state that selected the proposed state;
- approval evidence reference;
- required permission: Linear issue update;
- blocking reasons such as read-only mode, writes disabled, state transitions disabled, missing configured target status, missing credentials, missing issue identity, or missing evidence;
- future confirmation requirement.

If no target status is configured for the final run state, the preview should still appear as blocked with a clear reason.

## Immutable Preview Fields

Once a preview is persisted or approved in a future milestone, these fields must be treated as immutable:

- run id;
- issue id or identifier;
- action kind;
- target system;
- target identifier;
- payload hash;
- approval evidence source;
- review artifact source;
- idempotency key;
- generated timestamp.

15B may generate previews as a read model without persisting them. If local persistence is added later, it must store preview contracts as local-only audit material and must not imply that the external write occurred.

## Audit Shape

Future local audit records should include:

- run id;
- issue id;
- action kind;
- target system;
- target identifier;
- preview payload hash or stable preview id;
- approval evidence source;
- review artifact source;
- generated timestamp;
- generated-by local user context if available;
- idempotency key;
- status: `previewed`;
- external write id: null.

An audit record for a preview is not an execution record.

## UI Behavior

When a preview is available, the UI should show:

- action name;
- preview-only/read-only badge;
- target system and target object;
- proposed title/body/state payload;
- changed files where applicable;
- evidence and review artifact source;
- required permissions;
- confirmation required;
- current availability;
- blocking reasons;
- risk warnings;
- idempotency key.

When a preview is blocked, the UI should still show the blocked preview and reasons. The user should be able to inspect what would be written if the blockers were removed.

The UI must not show executable buttons such as `Create PR`, `Post comment`, `Update Linear`, `Approve and write`, or `Push branch` in this milestone. Acceptable labels are inspection-only, such as `View PR preview`, `View Linear comment preview`, and `View status update preview`.

## Disabled External Writes

These remain disabled in Milestone 15B:

- GitHub PR creation;
- GitHub branch pushes;
- GitHub issue or PR comments;
- GitHub reviewer requests;
- Linear comments;
- Linear issue status updates;
- Linear label, assignee, or description updates.

Existing read-only validation, review artifacts, and local event/audit data remain allowed.

## Deferred

Actual execution is deferred until a later milestone. Milestone 15C should start with one narrow external write, likely manual GitHub PR creation, after the preview contract has been confirmed and an immutable local approval record exists.
