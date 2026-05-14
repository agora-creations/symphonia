# Fresh Isolated Run To PR Boundary

Milestone 15C-R2 retries the manual GitHub PR verification after Milestone 15W made fresh runs use isolated, run-owned git worktrees.

This milestone may create at most one real GitHub draft PR, and only after explicit human confirmation. Otherwise it stops at the manual confirmation boundary.

There is no user-facing Demo Mode in this milestone.

## Why This Is Retried After 15W

Milestone 15C-R and 15C-V correctly blocked the old ALV-5 run because its workspace resolved upward into the main Symphonia checkout. Milestone 15W added the missing invariant:

```text
fresh run -> isolated git worktree -> durable ownership metadata -> PR preflight can trust workspace identity
```

15C-R2 verifies that invariant with one fresh real Codex run.

## PR-Eligible Isolated Workspace

A workspace is PR-eligible only when:

- it is a `git_worktree` or `git_clone`;
- the workspace path exists;
- `git rev-parse --show-toplevel` inside the workspace resolves to the workspace path;
- it is not the main Symphonia checkout;
- persisted ownership metadata belongs to the run;
- the ownership metadata includes source repo, target repo, base branch, head branch, and base commit;
- the workspace remote matches the configured GitHub repository;
- the head branch is generated, safe, and not protected;
- no unrelated dirty files are visible.

Directory-only or legacy workspaces remain readable for history but blocked for PR writes.

## Safe Issue Selection

Use exactly one existing Linear issue. Prefer a low-risk issue such as:

- documentation clarification;
- copy-only improvement;
- tiny test or fixture adjustment;
- harmless UI wording change;
- narrow bug fix.

Do not create a new Linear issue unless the human explicitly instructs it. Do not choose issues that require secrets, production credentials, broad refactors, dependency changes, Linear mutation, or GitHub mutation before confirmation.

## Connected Readiness

Before starting the run, verify:

- daemon health is available;
- connected status is usable;
- Linear is ready and issues are loaded;
- GitHub is ready for read-only repository validation;
- GitHub write mode remains read-only unless the human explicitly changes it;
- Codex is ready;
- board state is ready;
- old ALV-5 preflight remains blocked as a legacy workspace;
- Linear write routes remain disabled.

## Run Verification

Start the selected issue with `Run with Codex` through the existing connected golden path. Verify:

- the run starts through the real Codex provider path;
- the workspace path is assigned before provider execution;
- workspace ownership metadata is persisted before provider execution;
- the provider runs in the isolated workspace path;
- events persist;
- the run reaches `succeeded`, `completed`, `needs-review`, or `failed` with a clear reason;
- the review artifact refreshes after completion or needs-review.

## Ownership Metadata

Durable ownership metadata should include:

- workspace id;
- run id;
- issue id and key;
- source repository path and git root;
- workspace path and git root;
- workspace kind;
- isolation status;
- PR eligibility;
- base branch;
- head branch;
- base commit;
- remote name and URL;
- target repository;
- prepared timestamp;
- metadata version;
- blockers and warnings.

After daemon restart, PR preflight should still be able to reconstruct this metadata.

## Provider Workspace Check

Provider execution is considered isolated only when provider events show the same workspace path that ownership metadata records. For Codex runs, `codex.thread.started.cwd` should equal the isolated workspace path.

If provider execution occurs in the main checkout or a directory-only workspace, stop. Do not bypass preflight.

## Approval Evidence

Approval evidence must show:

- final run state;
- workspace path;
- nonzero event count;
- changed files or an explicit no-change state;
- file summary or explicit missing reasons;
- review artifact status;
- hook or test output when available;
- missing evidence reasons.

No-change runs may prove the run loop, but they are not useful for PR verification unless a later contract permits no-change PRs.

## Review Artifact

The review artifact should be `ready` before a manual PR confirmation packet is produced. If it is missing or errored, the PR boundary must remain blocked with an explicit reason.

## Live Diff And Evidence Parity

GitHub PR preflight must compare live git changed paths against approval evidence. Continue only when:

- live changed files are collected from the isolated workspace;
- evidence changed files are available;
- every live changed file appears in evidence;
- every evidence changed file appears in the live diff;
- no unrelated dirty files are present;
- no disallowed local files are present;
- path comparison matches, not just file count.

If parity fails, document the exact mismatch and do not proceed to PR confirmation.

## Branch, Remote, And Idempotency

Preflight must verify:

- target repository matches `WORKFLOW.md`;
- workspace remote matches the target repository;
- base branch is known and safe;
- head branch is safe, specific, and not protected;
- local branch equals the preview head branch;
- remote branch state is unambiguous;
- existing PR state is unambiguous;
- idempotency key is stable.

Existing branch or PR state is safe only when a local execution record proves the same idempotency key and payload hash owns it.

## Write Mode

GitHub remains read-only by default. A fresh run can reach the manual confirmation boundary while GitHub write mode is still read-only. Actual draft PR creation requires explicit manual write mode and confirmation.

Linear writes remain disabled. This milestone must not comment in Linear, update Linear status, change labels, assign users, or mutate Linear in any way.

## Manual Confirmation Packet

When all non-write gates pass, produce a packet containing:

- run id;
- issue key and title;
- target GitHub repository;
- base branch;
- proposed head branch;
- `draft: true`;
- proposed PR title;
- proposed PR body summary;
- changed file count and list;
- review artifact status or identifier;
- approval evidence status;
- payload hash;
- idempotency key;
- preflight status;
- GitHub write mode;
- required write-mode change, if any;
- exact confirmation phrase;
- exact UI action or API request that would create the PR;
- statement that Linear writes remain disabled.

Stop at this boundary unless the human explicitly confirms the exact write.

## Conditions For One Real Draft PR

Exactly one real GitHub draft PR is permitted only when:

- the fresh run is isolated and owned;
- provider execution occurred in the isolated workspace;
- approval evidence is complete;
- review artifact is ready or explicitly accounted for;
- live diff matches evidence;
- branch and PR state are unambiguous;
- payload hash matches;
- GitHub manual write mode is enabled;
- the human confirms repo, base branch, head branch, payload hash, idempotency key, and confirmation phrase;
- local approval and execution records can be persisted.

Do not merge, close, comment on, or delete the PR as part of this milestone.

## Must Remain Blocked

The following remain blocked:

- Linear comments;
- Linear status updates;
- Linear labels, assignees, descriptions, or state changes;
- non-draft PR creation;
- auto-merge;
- force-push;
- push to protected/default branches;
- PR creation from main checkout or legacy directory workspaces;
- PR creation with evidence mismatch;
- PR creation with ambiguous branch or PR ownership.

## Deferred

Deferred until later milestones:

- manual Linear comment writeback;
- Linear issue status writeback;
- broader runtime management;
- issue intake;
- no-change PR policy;
- automated cleanup of run worktrees;
- multi-provider review comparison.
