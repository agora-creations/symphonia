# Human-Confirmed Draft PR Verification

Milestone 15C-V2 verifies the first controlled GitHub external write from the fresh isolated run produced in Milestone 15C-R2.

This milestone permits at most one real GitHub draft PR and no Linear writes.

There is no user-facing Demo Mode in this milestone.

## Why This Follows 15C-R2

Milestone 15C-R2 proved the full pre-write chain:

- real Linear issue;
- real Codex run;
- isolated git worktree;
- durable workspace ownership metadata;
- provider execution in the isolated workspace;
- reconstructed approval evidence;
- ready review artifact;
- live diff matching approval evidence;
- GitHub PR preflight passing all non-write gates;
- manual confirmation packet recorded.

15C-V2 exists only to revalidate that state and either stop at the final write boundary or, with explicit human confirmation, create exactly one draft PR through the audited product route.

## Selected Run

The selected run is:

- run id: `43976218-fd29-4c90-bda6-1023ef78cffb`;
- issue: `ALV-5` - `Symphonia test`;
- target repository: `agora-creations/symphonia`;
- workspace: `/Users/diegomarono/.symphonia/workspaces/ALV-5-43976218`;
- workspace kind: `git_worktree`;
- head branch: `codex/alv-5-43976218`;
- base branch: `main`;
- changed file: `apps/daemon/test/http.test.ts`.

If any of these values change before execution, the PR write must remain blocked until a new preview, preflight, and confirmation packet are produced.

## Allowed External Write

The only allowed external write is one GitHub draft PR through:

```text
POST /runs/43976218-fd29-4c90-bda6-1023ef78cffb/github/pr/create
```

The route must receive the current `github_pr_create` preview id, payload hash, idempotency key, target repository, base branch, head branch, `draft: true`, and the exact confirmation phrase.

## Forbidden Writes

These remain forbidden:

- Linear comments;
- Linear issue status updates;
- Linear labels, assignees, descriptions, or state changes;
- GitHub auto-merge;
- non-draft pull requests;
- force-pushes;
- pushes to default or protected branches;
- copying the isolated run diff into the main checkout;
- cleanup writes such as closing the PR or deleting the branch;
- background or autonomous external writes.

## Revalidation Before The Write Boundary

Before enabling write gates or creating a PR, verify:

- run still exists and final state is `succeeded`;
- workspace path exists;
- workspace kind is `git_worktree` or `git_clone`;
- workspace is isolated from the main checkout;
- durable ownership metadata exists and belongs to the run;
- provider cwd was the isolated workspace;
- approval evidence endpoint works;
- changed file list is available;
- review artifact status is `ready`;
- live changed files match approval evidence exactly;
- no extra files, missing files, unrelated dirty files, or disallowed local files are present;
- remote repository matches `agora-creations/symphonia`;
- base branch is `main`;
- head branch is `codex/alv-5-43976218`;
- remote branch and PR state are unambiguous;
- payload hash matches the current preview.

If any evidence, diff, workspace, branch, or preflight state changes, stop. Do not create a PR from stale evidence.

## GitHub Write Mode

GitHub is read-only by default. Creating the draft PR requires explicit local workflow posture:

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

- permission to enable GitHub manual write mode if it is not already enabled;
- permission to allow one non-force branch push for this action;
- permission to allow one draft PR creation for this action;
- confirmation of target repo `agora-creations/symphonia`;
- confirmation of base branch `main`;
- confirmation of head branch `codex/alv-5-43976218`;
- confirmation of the current payload hash;
- confirmation of the current idempotency key;
- the exact required confirmation phrase.

Without that confirmation, the correct milestone outcome is a safe pause at the final write boundary.

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

If the run, workspace, review artifact, diff, payload hash, branch state, or remote PR state changed, do not continue with the old confirmation packet. Produce a new packet or document the blocker.

## Deferred

Deferred until later milestones:

- Linear comment writeback;
- Linear issue status writeback;
- automatic PR creation;
- non-draft PRs;
- merge, close, cleanup, branch deletion, reviewer requests, or GitHub comments;
- broader runtime or workspace cleanup automation.
