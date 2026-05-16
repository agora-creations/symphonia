# Fresh Run From Current Main To PR Boundary

Milestone 15C-R3 retries the fresh isolated run path after Milestone 15C-V3 correctly blocked the previous run because the target base branch advanced and touched the same file.

This milestone does not create a PR unless a human explicitly confirms the exact write.

There is no user-facing Demo Mode in this milestone.

## Why 15C-R3 Is Needed

Run `43976218-fd29-4c90-bda6-1023ef78cffb` was isolated and evidence-backed, but it is no longer safe for the first GitHub draft PR. Its stored base commit was:

```text
5a20ad0dd11f793960ca5d9149c7ae1e9dd2d5c1
```

The current remote target base moved to:

```text
3cd141a1d276d58f99b34d644bc74c9476ff5414
```

Upstream changed `apps/daemon/test/http.test.ts`, which is also the selected run's approval-evidence changed file. Branch freshness is therefore `stale_overlap`, and PR creation must remain blocked.

15C-R3 creates a new run from the current target base so branch freshness can be `fresh` before the manual PR boundary.

## Current Target Base

The target repository and base branch come from `WORKFLOW.md`:

- target repository: `agora-creations/symphonia`
- base branch: `main`

The current base commit should be determined by a read-only remote-ref check, preferably:

```text
git ls-remote origin refs/heads/main
```

A read-only `git fetch` is allowed when needed to update local remote-tracking refs. Do not pull, reset, or rebase the main checkout to determine the base.

## Dirty Main Checkout Safety

The main checkout may contain unrelated or in-progress files. Do not use local dirty state as the source of a PR-eligible run workspace.

Safe approaches:

- read the current remote base with `git ls-remote`;
- fetch remote refs without changing the worktree;
- create the run worktree from the current remote-tracking base commit;
- pause if a current-base worktree cannot be created without touching the main checkout.

Do not pull, reset, rebase, restore, or otherwise modify the main checkout just to make a base current.

## Isolated Current-Base Worktree

A PR-eligible fresh run workspace must:

- be a `git_worktree` or `git_clone`;
- be created from the current target base commit;
- persist workspace ownership metadata before provider execution;
- store the selected base commit;
- have git top-level resolve to the workspace path;
- not resolve to the main checkout;
- use a safe run-specific head branch;
- map to the target repository;
- keep unrelated main-checkout dirty files out of the run workspace.

## Branch Freshness

Branch freshness is `fresh` when the stored base commit in workspace ownership metadata equals the current remote base commit.

If remote base advances again after the run starts:

- `stale_no_overlap` is warning-only and may reach the confirmation boundary with explicit warning;
- `stale_overlap` blocks confirmation and PR creation;
- `unknown` blocks confirmation and PR creation.

## Safe Issue Selection

Use exactly one existing Linear issue. Prefer:

- documentation clarification;
- tiny test adjustment;
- harmless UI wording change;
- narrow bug fix.

Do not create a new Linear issue unless the human explicitly asks. Do not select an issue that requires secrets, production credentials, broad refactors, dependency changes, Linear mutation, or GitHub mutation before confirmation.

## Provider Cwd Verification

Provider execution is isolated only if provider events show the selected workspace path. For Codex runs, `codex.thread.started.cwd` should equal the isolated workspace path.

If the provider runs in the main checkout or a directory-only workspace, stop and report.

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

No-change runs may prove provider execution, but they are not useful for GitHub PR verification unless a later contract permits no-change PRs.

## Live Diff And Evidence Parity

GitHub PR preflight must show:

- live changed files collected from the isolated workspace;
- approval evidence changed files collected from persisted events/review artifacts;
- matched files correct;
- `missingFromLiveDiff` empty;
- `extraInLiveDiff` empty;
- `matchesApprovalEvidence` true;
- no unrelated dirty files.

If parity fails, do not proceed to confirmation.

## Review Artifact

The review artifact should be `ready` before a manual confirmation packet is produced. If missing, errored, or stale, the PR boundary remains blocked with a clear reason.

## PR Preflight

Preflight must verify:

- workspace isolation;
- durable ownership metadata;
- target repo and remote match;
- base branch and head branch safety;
- live diff/evidence parity;
- review artifact readiness;
- preview payload hash;
- branch freshness;
- remote branch/PR ambiguity;
- idempotency state;
- GitHub write gates.

The expected non-write result is a clean preflight where only GitHub read-only/write/push/create-PR gates block execution.

## Manual Confirmation Boundary

When all non-write gates pass, record a packet containing:

- run id;
- issue key and title;
- target GitHub repository;
- base branch;
- proposed head branch;
- `draft: true`;
- proposed PR title and body summary;
- changed file count and list;
- review artifact status or identifier;
- approval evidence status;
- branch freshness status;
- stored base commit;
- current remote base commit;
- upstream changed files and overlaps;
- payload hash;
- idempotency key;
- preflight status;
- GitHub write mode;
- required write-mode change, branch-push gate, and PR-creation gate;
- exact confirmation phrase;
- exact UI action or API request;
- statement that Linear writes remain disabled.

Stop at this boundary unless the human explicitly confirms the exact GitHub write.

## Linear Writes

Linear writes remain disabled. This milestone must not comment in Linear, update Linear status, change labels, assign users, edit descriptions, or mutate Linear in any way.

## Deferred

Deferred until later milestones:

- creating the real GitHub draft PR without explicit human confirmation;
- Linear comment writeback;
- Linear status writeback;
- branch cleanup;
- PR merge/close/delete flows;
- broader runtime productionization.
