# Create One Draft PR Verification

Milestone 15C-V3 is the first controlled GitHub write rehearsal after branch freshness was added to PR preflight.

This milestone permits at most one real GitHub draft PR and no Linear writes.

There is no user-facing Demo Mode in this milestone.

## Why This Follows 15C-BF

Milestone 15C-R2 proved that run `43976218-fd29-4c90-bda6-1023ef78cffb` reached the manual PR boundary from an isolated, run-owned git worktree. Milestone 15C-BF added one final freshness guard so preflight can explain whether the run branch was created from the current target base.

The selected run is currently acceptable only if the human explicitly accepts the `stale_no_overlap` warning. That warning is human-acceptable because the target base branch advanced, but the upstream changes do not overlap the run's approval-evidence changed files.

## Selected Run

- Run id: `43976218-fd29-4c90-bda6-1023ef78cffb`
- Issue: `ALV-5` - `Symphonia test`
- Target repository: `agora-creations/symphonia`
- Workspace: `/Users/diegomarono/.symphonia/workspaces/ALV-5-43976218`
- Workspace kind: `git_worktree`
- Base branch: `main`
- Head branch: `codex/alv-5-43976218`
- Changed file: `apps/daemon/test/http.test.ts`

If any of these values change, the old confirmation packet must be discarded and a new preflight/confirmation packet must be produced.

## Allowed External Write

The only allowed external write is one GitHub draft PR through:

```text
POST /runs/43976218-fd29-4c90-bda6-1023ef78cffb/github/pr/create
```

The request must use the current `github_pr_create` preview id, payload hash, idempotency key, target repository, base branch, head branch, `draft: true`, and exact confirmation phrase.

## Forbidden Writes

These remain forbidden:

- Linear comments
- Linear issue status updates
- Linear labels, assignees, descriptions, or state changes
- GitHub auto-merge
- non-draft PR creation
- force-pushes
- pushes to default or protected branches
- copying the isolated worktree diff into the main checkout
- closing, merging, deleting, or cleaning up the created PR or branch
- background or autonomous external writes

## Revalidation Before The Write Boundary

Before crossing the write boundary, verify:

- the run still exists and final state is `succeeded`;
- the workspace path exists;
- workspace kind is `git_worktree` or `git_clone`;
- workspace ownership metadata exists and belongs to the run;
- provider cwd was the isolated workspace;
- approval evidence is available with no missing evidence reasons;
- review artifact status is `ready`;
- live changed files match approval evidence exactly;
- no extra, missing, unrelated, secret-like, or local runtime files are present;
- remote repository matches `agora-creations/symphonia`;
- base branch is `main`;
- head branch is `codex/alv-5-43976218`;
- remote branch and PR state are unambiguous;
- payload hash matches the current preview;
- branch freshness is `fresh` or `stale_no_overlap`.

If freshness is `stale_overlap` or `unknown`, stop. If freshness is `stale_no_overlap`, the human must explicitly accept the warning.

## Stale-No-Overlap Acceptance

`stale_no_overlap` means the target base branch advanced after the run workspace was prepared, but upstream changed files do not overlap approval-evidence changed files.

The write may proceed only when the confirmation includes:

```text
I accept stale_no_overlap for run 43976218-fd29-4c90-bda6-1023ef78cffb.
```

This acceptance does not bypass preflight. It only permits a warning state that has no changed-file overlap. All other gates still have to pass.

## GitHub Write Mode

GitHub remains read-only by default. Creating the draft PR requires explicit local workflow posture:

```yaml
github:
  read_only: false
  write:
    enabled: true
    require_confirmation: true
    allow_push: true
    allow_create_pr: true
    draft_pr_by_default: true
```

Only the minimum GitHub gates needed for this one manual draft PR should be enabled. Linear write gates must remain disabled.

## Confirmation Phrase

The required confirmation phrase is:

```text
CREATE GITHUB PR
```

The human confirmation must explicitly include:

- acceptance of `stale_no_overlap` for the selected run;
- permission to enable GitHub manual write mode for this action;
- permission to allow one non-force branch push for this action;
- permission to allow one draft PR creation for this action;
- confirmation of target repo `agora-creations/symphonia`;
- confirmation of base branch `main`;
- confirmation of head branch `codex/alv-5-43976218`;
- confirmation of the current payload hash;
- confirmation of the current idempotency key;
- the exact required confirmation phrase.

Without that complete confirmation, the correct outcome is a safe pause at the final write boundary.

## Approval Record

Before any GitHub write transport is called, the daemon must persist a local immutable approval record containing:

- run id;
- issue id and identifier;
- action kind `github_pr_create`;
- target system `github`;
- target repository;
- base branch;
- head branch;
- preview payload hash;
- approval evidence source;
- review artifact source;
- changed files;
- PR title and body summary;
- confirmation type and phrase metadata;
- approval timestamp;
- idempotency key;
- approved status.

The record must not contain tokens or secrets.

## Execution Record

The daemon must persist a local execution record before the GitHub transport call and update it after success or failure. The execution record should include:

- approval record id;
- run id;
- preview id;
- target repository;
- base branch;
- head branch;
- payload hash;
- idempotency key;
- status;
- PR number and URL after success;
- failure summary and blocking reasons after failure.

## Idempotency

The same idempotency key and payload hash must not create duplicate PRs.

Expected behavior:

- successful prior execution returns the existing PR result;
- in-progress execution blocks duplicate creation;
- same idempotency key with a different payload hash is rejected;
- failure before external write can be retried safely;
- failure after external write requires reconciliation before another attempt.

## Post-Write Verification

If a PR is created after explicit confirmation, verify:

- exactly one PR exists;
- PR is draft;
- target repository, base branch, and head branch match the approved packet;
- PR title and body match the approved preview;
- changed files match approval evidence;
- local approval record exists and was persisted before the write;
- local execution record exists and contains the PR number and URL;
- idempotent retry returns the same PR result without creating another PR;
- UI shows the PR result;
- Linear routes remain disabled and no Linear mutation occurred.

Do not merge, close, delete the branch, comment in Linear, or update Linear status as part of this milestone.

## If State Changed

If the run, workspace, review artifact, diff, branch freshness, payload hash, branch state, or remote PR state changed, do not continue with the old confirmation packet. Produce a new packet or document the blocker.

## Deferred

Deferred until later milestones:

- Linear comment writeback;
- Linear issue status writeback;
- automatic PR creation;
- non-draft PRs;
- merge, close, cleanup, branch deletion, reviewer requests, or GitHub comments;
- broader runtime or workspace cleanup automation.
