# Create One Draft PR V5 Execution

Milestone 15C-V5 is the first draft PR execution retry after Milestone 15C-H separated stable write payload identity from mutable preview readiness state.

This milestone permits at most one real GitHub draft PR and no Linear writes.

There is no user-facing Demo Mode in this milestone.

## Why This Follows 15C-H

Milestone 15C-V4 stopped correctly because enabling GitHub write gates changed the old human-confirmed payload hash. Milestone 15C-H fixed that by distinguishing:

- `writePayloadHash`: the stable external PR payload identity the human approves;
- `payloadHash`: legacy alias for `writePayloadHash`;
- `previewStateHash`: mutable readiness, gate, blocker, and warning state;
- `approvalEvidenceHash`: stable identity for the evidence snapshot used to justify the write.

V5 must confirm `writePayloadHash`, not `previewStateHash`. `previewStateHash` may change when GitHub gates move from read-only to manual-enabled.

## Selected Run

- Run id: `a0d316a8-eb83-47a3-b8fe-498ec2077ac3`
- Issue: `ALV-5` - `Symphonia test`
- Workspace: `/Users/diegomarono/.symphonia/workspaces/ALV-5-a0d316a8`
- Workspace kind: `git_worktree`
- Target repository: `agora-creations/symphonia`
- Base branch: `main`
- Head branch: `codex/alv-5-a0d316a8`
- Changed file: `apps/daemon/test/http.test.ts`
- Expected write payload hash: `11d23b8f2d009ce1de0921219e86df3677935f37cad6a00a4f58b173a8e1a125`
- Expected idempotency key: `preview:github_pr_create:a0d316a8-eb83-47a3-b8fe-498ec2077ac3:11d23b8f2d009ce1de092121`

If any selected-run value changes, discard the old packet and re-run preview/preflight before any write.

## Allowed External Write

The only allowed external write is one GitHub draft PR through:

```text
POST /runs/a0d316a8-eb83-47a3-b8fe-498ec2077ac3/github/pr/create
```

The request must use the current `github_pr_create` preview id, `writePayloadHash`, legacy `payloadHash`, idempotency key, target repository, base branch, head branch, `draft: true`, and exact confirmation phrase.

## Forbidden Writes

These remain forbidden:

- Linear comments;
- Linear issue status updates;
- Linear labels, assignees, descriptions, or state changes;
- GitHub auto-merge;
- non-draft pull requests;
- force-pushes;
- pushes to default or protected branches;
- copying the isolated worktree diff into the main checkout;
- closing, merging, deleting, or cleaning up the PR or branch;
- background or autonomous external writes.

## Revalidation Before Execution

Before crossing the write boundary, verify:

- run still exists and final state is `succeeded`;
- workspace path exists and git top-level resolves to the workspace path;
- workspace ownership metadata exists, is durable, and belongs to the run;
- provider cwd was the isolated workspace;
- approval evidence is available with no missing evidence reasons;
- review artifact status is `ready`;
- live changed files match approval evidence exactly;
- no extra, missing, unrelated, secret-like, or local runtime files are present;
- remote repository matches `agora-creations/symphonia`;
- base branch is `main`;
- head branch is `codex/alv-5-a0d316a8`;
- branch freshness is `fresh`;
- remote branch and PR state are unambiguous;
- `writePayloadHash` matches the confirmed value;
- `previewStateHash` is treated as mutable readiness state.

If branch freshness becomes `stale_no_overlap`, pause and require explicit human acceptance. If it becomes `stale_overlap` or `unknown`, stop.

## GitHub Write Gates

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

- permission to enable GitHub manual write mode for this single action;
- permission to allow one non-force branch push for this single action;
- permission to allow one draft PR creation for this single action;
- confirmation of target repo `agora-creations/symphonia`;
- confirmation of base branch `main`;
- confirmation of head branch `codex/alv-5-a0d316a8`;
- confirmation of the current `writePayloadHash`;
- confirmation of the current idempotency key;
- confirmation that branch freshness is `fresh`, or explicit acceptance if it becomes `stale_no_overlap`;
- the exact required confirmation phrase.

Without complete confirmation, the correct milestone outcome is a safe pause at the final write boundary. With `stale_overlap` or `unknown` branch freshness, confirmation is not sufficient and execution must stay blocked.

## Approval Record

Before any GitHub write transport is called, the daemon must persist a local immutable approval record containing:

- run id;
- issue id and identifier;
- action kind `github_pr_create`;
- target system `github`;
- target repository;
- base branch;
- head branch;
- write payload hash;
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

The same idempotency key and write payload hash must not create duplicate PRs.

Expected behavior:

- successful prior execution returns the existing PR result;
- in-progress execution blocks duplicate creation;
- same idempotency key with a different write payload hash is rejected;
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
- UI/API shows the PR result;
- Linear routes remain disabled and no Linear mutation occurred.

Do not merge, close, delete the branch, comment in Linear, or update Linear status as part of this milestone.

## Write Gate Restoration

After a successful write and idempotency verification, return temporary GitHub write gates to the safest supported state:

- GitHub read-only enabled;
- branch push disabled;
- PR creation disabled;
- Linear writes disabled.

If gates cannot be restored automatically or safely, document the exact remaining state and the manual action needed to return to read-only.

## If State Changed

If the run, workspace, review artifact, diff, branch freshness, write payload hash, branch state, or remote PR state changed, do not continue with the old confirmation packet. Produce a new packet or document the blocker.

## Deferred

Deferred until later milestones:

- Linear comment writeback;
- Linear issue status writeback;
- automatic PR creation;
- non-draft PRs;
- merge, close, cleanup, branch deletion, reviewer requests, or GitHub comments;
- broader runtime or workspace cleanup automation.
