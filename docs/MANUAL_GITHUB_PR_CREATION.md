# Manual GitHub Draft PR Creation

Milestone 15C enables only manual GitHub draft PR creation. It does not enable Linear comments, Linear status updates, auto-merge, or automatic writeback.

There is no user-facing Demo Mode in this milestone.

## Flow

The manual PR flow is:

1. A run reaches a terminal successful state.
2. Approval evidence is available for the run.
3. Review artifacts are ready or an explicit blocker explains why they are missing.
4. A GitHub PR preview is generated from the run, issue, workspace, changed files, and review artifact.
5. The user inspects the exact target repository, base branch, head branch, draft PR title/body, changed files, evidence sources, payload hash, idempotency key, blockers, and risk warnings.
6. GitHub write mode must be explicitly enabled in local workflow configuration.
7. The user must enter the configured confirmation phrase.
8. The daemon verifies that the preview payload hash and idempotency key still match.
9. The daemon persists a local immutable approval/audit record before any GitHub write call.
10. The daemon prepares the branch safely when needed.
11. The daemon creates a GitHub draft PR.
12. The daemon persists the local execution result and returns the PR number and URL.

The goal runner must not create a real PR autonomously. A real external PR write requires the human to explicitly confirm it in the product UI or give a direct instruction after a pause.

## Eligibility

A run is eligible only when all of these are true:

- run status is `succeeded`;
- workspace path is available;
- workspace is a git repository;
- approval evidence has no missing evidence blockers;
- changed files are visible and unambiguous;
- review artifact status is `ready`;
- GitHub integration is enabled;
- GitHub credentials are available;
- GitHub write mode is explicitly enabled;
- `github.read_only` is `false`;
- `github.write.enabled` is `true`;
- `github.write.allow_create_pr` is `true`;
- confirmation is required;
- target repository is configured and validated;
- target head branch is not a protected/default branch;
- local approval/audit persistence succeeds before the external write.

## Approval Evidence

Approval evidence is complete for PR creation when it includes:

- issue identity;
- run identity;
- provider identity;
- workspace path;
- final run state;
- changed files;
- non-null file summary;
- review artifact identifier or explicit blocker;
- event count;
- write-action preview payload hash and idempotency key.

Missing evidence blocks execution. The daemon must return explicit blocking reasons instead of silently creating a PR with partial evidence.

## Executable Preview

A PR preview becomes executable only when:

- the request references a `github_pr_create` preview;
- the request `payloadHash` exactly matches the current preview;
- the request `idempotencyKey` exactly matches the current preview;
- target repository, base branch, head branch, and draft flag match the preview;
- the confirmation phrase is correct;
- no non-confirmation blockers remain;
- local write audit persistence is available.

Linear previews remain preview-only. They must never become executable in 15C.

## GitHub Write Mode

GitHub write mode defaults to read-only. Manual PR creation requires this explicit posture in `WORKFLOW.md`:

```yaml
github:
  read_only: false
  write:
    enabled: true
    require_confirmation: true
    allow_create_pr: true
    draft_pr_by_default: true
```

Branch pushes remain separately gated by `github.write.allow_push`. If branch publication is required and push is not enabled, PR creation blocks with a clear reason.

## Confirmation

The default confirmation phrase is:

```text
CREATE GITHUB PR
```

The UI must require the user to enter the exact configured phrase before calling the execution route. A disabled or blocked preview must not show an executable button.

## Branch Rules

The default head branch is the current workspace branch from the review artifact. The daemon must block if:

- no current branch is available;
- the current branch is the base branch;
- the branch is protected;
- the target branch in the request differs from the preview;
- the remote cannot be associated with the configured GitHub repository;
- changed files in the workspace are not represented by approval evidence;
- branch publication is required but not allowed.

Future milestones may derive and create a new branch name from issue/run/idempotency when the workspace does not already have a safe branch. 15C keeps the branch rule narrow: use the current safe workspace branch or block.

## Base Branch Rules

The base branch defaults to `github.default_base_branch`, usually `main`. The request must match the preview base branch. The daemon must not create a PR targeting an ambiguous or protected head branch.

## Draft Default

The PR is draft by default. 15C should not create a non-draft PR unless the local workflow explicitly changes the preview and the execution request still uses the verified payload hash.

## Audit Record

The local approval/audit record includes:

- run id;
- issue id;
- action kind;
- target system;
- target repository;
- base branch;
- head branch;
- preview payload hash;
- approval evidence source;
- review artifact source;
- changed files;
- generated title/body summary;
- confirmation type;
- approval timestamp;
- idempotency key;
- status.

The local execution record includes:

- approval record id;
- idempotency key;
- execution status;
- external PR number and URL when created;
- start time;
- completion time;
- failure reason when failed.

No secret tokens may be stored in audit records.

## Idempotency

Idempotency behavior:

- same idempotency key and already successful: return the existing PR result;
- same idempotency key and still in progress: return blocked/in-progress status;
- same idempotency key with a different payload hash: reject;
- failed before external write: allow safe retry;
- failed after external write: reconcile local state before attempting a new write;
- existing remote branch not linked to the same execution: block;
- existing PR not linked to the same execution: block.

The idempotency key is derived from run id, action kind, and payload hash.

## Failure Handling

The route returns `blocked` for local prerequisites that are not satisfied and `failed` when a validated external write attempt fails. The UI should show:

- blocking reasons;
- failure summary;
- approval record id when one was persisted;
- execution record id when one exists;
- PR number/URL after success.

## Deferred

Deferred until later milestones:

- Linear comments;
- Linear issue status updates;
- Linear labels, assignees, or description updates;
- GitHub issue/PR comments;
- reviewer requests;
- auto-merge;
- background or automatic external writes;
- broad branch-management workflows;
- issue intake.
