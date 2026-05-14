# Manual GitHub Draft PR Verification

Milestone 15C-V verifies the first external write path for Symphonia without broadening write automation. This milestone permits at most one real GitHub draft PR and no Linear writes.

The safe default outcome is a pause at the confirmation boundary. A real PR may be created only after a human explicitly confirms the exact target, branch, payload, and write-mode posture.

There is no user-facing Demo Mode in this milestone.

## Allowed External Write

The only allowed external write is one GitHub draft pull request created through:

```text
POST /runs/:id/github/pr/create
```

The request must use the generated `github_pr_create` preview, matching payload hash, matching idempotency key, `draft: true`, and the exact configured confirmation phrase.

## Forbidden Writes

These remain forbidden:

- Linear comments.
- Linear issue status updates.
- Linear label, assignee, description, or state changes.
- GitHub auto-merge.
- Non-draft pull requests.
- Force-pushes.
- Pushes to default or protected branches.
- Cleanup writes such as closing the verification PR or deleting its branch.
- Background or autonomous external writes.

## Safe Completed Run Selection

Choose a run only when all of these are true:

- The run is completed with final state `succeeded`.
- Approval evidence has no missing evidence reasons.
- Review artifact status is `ready`.
- Changed files are visible and match the live workspace diff.
- The workspace path belongs to the selected run and is not accidentally the main development checkout.
- The workspace is a git repository with a safe non-base branch.
- The target remote matches the configured GitHub repository.
- No unexpected files or secrets are present in the diff.
- No existing PR or remote branch makes idempotency ambiguous.
- The target repository, base branch, and head branch are explicit.

If any of those checks fail, do not create a PR. Select a different safe run or pause with the exact blocker.

## Approval Evidence Check

Before write mode is enabled, verify:

- `GET /runs/:id/approval-evidence` returns final run state, workspace path, changed files, file summary source, event summary, review artifact status, and missing evidence reasons.
- `missingEvidenceReasons` is empty.
- `evidenceSummary.eventCount` is nonzero.
- `reviewArtifactStatus` is `ready`.
- `changedFiles` is non-empty for PR creation.

The PR route must block when approval evidence is missing or incomplete.

## Changed Files And Review Artifact Check

Compare the approval evidence changed-file list with live git status in the run workspace. The write is unsafe if:

- approval evidence names files that are no longer changed;
- live git status includes files not represented in approval evidence;
- the diff includes unrelated milestone implementation files;
- the diff includes local cleanup or progress files not related to the run;
- the workspace resolves to the parent development checkout instead of an isolated run workspace.

The review artifact should be treated as the review snapshot, not as permission to write stale or unrelated local changes.

## PR Preview Check

`GET /runs/:id/write-actions` must include a `github_pr_create` preview with:

- target repository;
- base branch;
- proposed head branch;
- draft PR title;
- PR body preview;
- changed-file list;
- review artifact reference;
- approval evidence source;
- payload hash;
- idempotency key;
- confirmation phrase;
- blocking reasons;
- risk warnings.

The payload hash and idempotency key must be copied from the current preview. Do not use stale values.

## Target Repo And Branch Check

The target repository must match `WORKFLOW.md` and the workspace remote. The base branch must be known and safe, usually `main`. The head branch must not be the base branch and must not be a protected branch.

If branch publication is needed, `github.write.allow_push` must be explicitly enabled. Pushes are non-force only.

## Enabling Manual GitHub Write Mode

GitHub writes are read-only by default. Manual draft PR creation requires an explicit local workflow posture:

```yaml
github:
  read_only: false
  write:
    enabled: true
    require_confirmation: true
    allow_create_pr: true
    draft_pr_by_default: true
```

If the run workspace needs to publish a branch, this must also be explicit:

```yaml
github:
  write:
    allow_push: true
```

Do not enable Linear writes while verifying GitHub PR creation.

## Confirmation

The default confirmation phrase is:

```text
CREATE GITHUB PR
```

The UI or API request must include the exact phrase. The route must block incorrect confirmation.

## Local Audit Records

Before the GitHub write transport is called, the daemon must persist a local immutable approval record containing:

- run id;
- issue id and identifier;
- action kind `github_pr_create`;
- target repository;
- base branch;
- head branch;
- preview payload hash;
- approval evidence source;
- review artifact source;
- changed files;
- PR title and body summary;
- typed confirmation metadata;
- approved timestamp;
- idempotency key.

During and after execution, the daemon must persist a local execution record containing:

- approval record id;
- run id;
- preview id;
- target repository;
- base branch;
- head branch;
- payload hash;
- idempotency key;
- status;
- PR number and URL when successful;
- failure reason when failed.

These records are local evidence. They must not contain tokens or secrets.

## Idempotency

Retry behavior must be:

- same idempotency key and successful result: return the existing PR result without creating another PR;
- same idempotency key in progress: block;
- same idempotency key with a different payload hash: reject;
- failure before external write: allow a safe retry;
- failure after external write: reconcile before attempting another write.

## Linear Write Prevention

Verify:

- Linear previews remain read-only or blocked.
- `POST /runs/:id/linear/comment/create` returns disabled guidance.
- No Linear status execution route becomes executable.
- GitHub PR creation does not call Linear mutation transports.

## Success Verification

If a human-confirmed PR is created, verify:

- exactly one PR exists;
- the PR is draft;
- the target repository, base branch, and head branch match the approved preview;
- title and body match the approved preview;
- changed files match approval evidence;
- local approval record exists;
- local execution record stores the PR number and URL;
- idempotent retry returns the existing PR result;
- Linear writes remain impossible.

Do not merge, close, comment on, or delete anything as part of verification.

## Failure Handling

If the run, workspace, diff, branch, PR state, evidence, credentials, write mode, or confirmation is unsafe or ambiguous, stop before the write. Record the exact blocker and the human action needed to continue.

For the current candidate real run `05e74792-72ff-4890-90be-fea430104134`, verification pauses because the workspace resolves to the main repository checkout, GitHub write mode is read-only, the preview branch has existing PR state, and the live diff is not the same safe run diff represented by approval evidence.
