# Stable Target Fresh Run To PR Boundary

Milestone 15C-R4 retries the first GitHub draft PR readiness path with a stable, low-churn target after repeated `stale_overlap` blocks on `apps/daemon/test/http.test.ts`.

This milestone does not create a PR unless a human explicitly confirms the exact write.

There is no user-facing Demo Mode in this milestone.

## Why 15C-R4 Is Needed

The GitHub PR write path is now correctly fail-closed. The repeated blocker is target selection:

```text
approved run changes apps/daemon/test/http.test.ts
origin/main also changes apps/daemon/test/http.test.ts
-> stale_overlap
-> PR blocked
```

The previous run cannot be PR'd because the stored base is older than the current remote target base and upstream changed the same approval-evidence file. That means the approved diff is no longer a clean first-write candidate.

15C-R4 keeps the write safety rules unchanged and instead chooses a stable, low-churn verification target.

## Why Not Use `apps/daemon/test/http.test.ts`

`apps/daemon/test/http.test.ts` is currently a hot implementation and regression-test file. It has changed repeatedly across the GitHub PR hardening milestones. Using it for the first real PR keeps introducing stale-overlap risk before the PR can be created.

The first draft PR verification should minimize moving parts:

- fresh current base;
- one isolated worktree;
- one low-churn file;
- one evidence-backed diff;
- one manual confirmation boundary.

## Current Target Base

The target repository and base branch come from `WORKFLOW.md`:

- target repository: `agora-creations/symphonia`;
- base branch: `main`.

Determine the current base with a read-only remote-ref check:

```text
git ls-remote origin refs/heads/main
```

A read-only `git fetch` is allowed if needed to update remote-tracking refs. Do not pull, reset, rebase, or modify the main checkout to make the base current.

## Dirty Main Checkout Safety

The main checkout may contain uncommitted milestone docs or other local work. Do not use dirty local branch state as the source of a PR-eligible run workspace.

Safe behavior:

- read the current remote base without mutating GitHub;
- fetch remote refs without changing the worktree when needed;
- create the run worktree from the selected remote base commit;
- keep uncommitted main-checkout implementation work out of the run workspace.

## Stable Low-Churn Target Selection

Use exactly one existing real Linear issue. Prefer an issue that naturally leads to:

- a docs-only clarification;
- a small verification note with clear project purpose;
- copy-only improvement in a stable file;
- a tiny change outside active implementation, tests, package files, lockfiles, generated files, auth files, and config files.

Avoid:

- `apps/daemon/test/http.test.ts`;
- files touched by current milestone implementation work;
- files recently changed on `origin/main`;
- broad code paths;
- package files and lockfiles;
- generated files;
- auth/config files;
- files that may contain secrets.

If no safe issue exists, pause and ask for a real issue shaped like:

```text
Title: PR write verification smoke change

Description:
Make a small docs-only change in a dedicated low-churn project document so Symphonía can verify the manual GitHub draft PR path. Do not modify code, tests, package files, auth files, or generated files.
```

Do not create or edit Linear issues in this milestone unless the human explicitly
instructs a one-off issue creation before R4 resumes. After issue selection,
Linear comments, status changes, labels, assignees, and description edits remain
disabled.

## Isolated Current-Base Worktree

A PR-eligible R4 run workspace must:

- be a `git_worktree` or `git_clone`;
- be created from the current target base commit;
- persist workspace ownership metadata before provider execution;
- store the selected base commit;
- have git top-level resolve to the workspace path;
- not resolve to the main checkout;
- use a safe run-specific head branch;
- map to `agora-creations/symphonia`;
- exclude unrelated dirty files from the main checkout.

## Provider Cwd Verification

Provider execution is isolated only if provider events show the selected workspace path. For Codex runs, `codex.thread.started.cwd` or equivalent provider cwd evidence should equal the isolated workspace path.

If the provider runs in the main checkout, stop and report.

## Approval Evidence

Approval evidence must show:

- final run state;
- workspace path;
- nonzero event count;
- changed files or explicit no-change state;
- file summary or explicit missing reasons;
- review artifact status;
- hook/test output when available;
- reconstructable approval records.

No-change runs may prove provider execution, but they are not useful for GitHub PR verification unless the contract later permits no-change PRs.

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

## Branch Freshness

Expected R4 freshness is `fresh`, because the run should be created from the current target base and touch a low-churn file.

If remote base advances again after run creation:

- `stale_no_overlap` is warning-only and can reach the confirmation boundary with explicit warning;
- `stale_overlap` blocks confirmation and PR creation;
- `unknown` blocks confirmation and PR creation.

Do not weaken or override branch freshness for the first real PR.

## PR Preflight

Preflight must verify:

- workspace isolation;
- durable ownership metadata;
- target repo and remote match;
- base branch and head branch safety;
- live diff/evidence parity;
- review artifact readiness;
- write payload hash;
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
- write payload hash;
- preview state hash;
- approval evidence hash;
- idempotency key;
- preflight status;
- GitHub write mode;
- required write-mode change, branch-push gate, and PR-creation gate;
- exact confirmation phrase;
- exact UI action or API request;
- statement that Linear writes remain disabled.

Stop at this boundary unless the human explicitly confirms the exact GitHub write.

## Exactly One Draft PR

One real GitHub draft PR is permitted only after explicit human confirmation of the exact packet. The write must use the GitHub PR creation route, persist local approval/execution records before transport, push non-force only if allowed, create one draft PR, and verify idempotency.

Do not merge, close, delete the branch, comment in Linear, or update Linear status as part of this milestone.

## Linear Writes

Linear writes remain disabled. This milestone must not comment in Linear, update Linear status, change labels, assign users, edit descriptions, or mutate Linear in any way.

## Deferred

Deferred until later milestones:

- stale-overlap recovery policy;
- automatic rebase or rerun;
- Linear comment writeback;
- Linear status writeback;
- branch cleanup;
- PR merge/close/delete flows;
- broader runtime productionization.
