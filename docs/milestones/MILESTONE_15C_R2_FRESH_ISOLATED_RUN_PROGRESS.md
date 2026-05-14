# Milestone 15C-R2 Fresh Isolated Run Progress

## Checkpoint 0 - Current State Inspection

- Current checkpoint: required first-step inspection.
- What changed: no product behavior changed before inspection.
- What was verified: inspected git status, `WORKFLOW.md`, workspace isolation, PR preflight, fresh isolated verification, manual PR creation and verification, write approval, approval evidence, 15W progress docs, package scripts, daemon run lifecycle, workspace manager, ownership persistence, provider startup, approval evidence, review artifact refresh, GitHub PR preflight and execution routes, write-action previews, web API, write preview UI, daemon tests, and validation scripts.
- Remaining work: create the 15C-R2 runbook, verify connected readiness, select a safe real issue, start a fresh Codex run, verify isolated workspace ownership and evidence parity, produce a manual confirmation packet or document the blocker, and run validation.
- Blockers or risks: the working tree contains an existing uncommitted `README.md` deletion of the stale "Next Milestone" section; it is unrelated to this milestone and remains untouched.

## Checkpoint 1 - Fresh Isolated Run Verification Runbook

- Current checkpoint: completed.
- What changed: created `docs/FRESH_ISOLATED_RUN_TO_PR_BOUNDARY.md`.
- What was verified: the runbook defines why 15C-R2 follows 15W, PR-eligible isolated workspace requirements, safe issue selection, readiness checks, ownership metadata, provider workspace checks, approval evidence, review artifact readiness, live diff/evidence parity, branch/remote/idempotency checks, write mode, manual confirmation packet contents, one-draft-PR conditions, blocked writes, and deferred work.
- Remaining work: verify the current connected state without external writes.
- Blockers or risks: no GitHub or Linear writes have occurred.

## Checkpoint 2 - Non-Mutating Connected Readiness

- Current checkpoint: completed.
- What changed: no product behavior changed; ran read-only daemon/API checks.
- What was verified: daemon `/healthz` is healthy; `/connected/status` reports onboarding `completed`, repo `/Users/diegomarono/symphonía`, workspace root `/Users/diegomarono/.symphonia/workspaces`, Linear ready through manual auth with 5 issues, GitHub ready for `agora-creations/symphonia` with env credentials, Codex ready, board ready, event store ready, and GitHub/Linear writes both `read_only`. `/writes/status` reports no allowed write kinds. `POST /runs/05e74792-72ff-4890-90be-fea430104134/linear/comment/create` returns HTTP 405. Old ALV-5 PR preflight remains blocked as a legacy directory workspace resolving to the main checkout with live diff/evidence mismatch and read-only GitHub mode.
- Remaining work: select one safe real issue and start a fresh Codex run in the isolated workspace path.
- Blockers or risks: the existing Linear issues are mostly Linear onboarding issues; ALV-5 is the only Symphonia-specific issue but has a sparse title/description, so the fresh run must be treated as a bounded verification run and stopped if Codex attempts broad changes.

## Checkpoint 3 - Select One Safe Real Issue

- Current checkpoint: selected.
- What changed: selected existing real Linear issue `ALV-5` (`Symphonia test`) for the fresh isolated verification run.
- What was verified: ALV-5 is real Linear data, still in `Todo`, has no active run, and was previously used as the Symphonia verification issue. It avoids creating or mutating any Linear issue.
- Remaining work: start one fresh real Codex run through the connected run path and verify the new isolated workspace behavior.
- Blockers or risks: ALV-5 has little issue detail. If the provider run produces no useful diff or broad unsafe changes, PR confirmation must not proceed.

## Checkpoint 4 - Run With Codex In Isolated Workspace

- Current checkpoint: completed.
- What changed: started a fresh real Codex run for ALV-5 through `POST /runs` with provider `codex`.
- What was verified: run `43976218-fd29-4c90-bda6-1023ef78cffb` reached `succeeded`. The daemon prepared `/Users/diegomarono/.symphonia/workspaces/ALV-5-43976218`, emitted `workspace.ownership.recorded` before provider execution, and Codex emitted `codex.thread.started` with `cwd` set to that isolated workspace path. Events persisted through the run and the review artifact refreshed after completion.
- Remaining work: verify workspace isolation, approval evidence, live diff/evidence parity, branch/remote state, and PR preflight.
- Blockers or risks: Codex made a local change only inside the isolated run worktree; it was not copied into the main checkout.

## Checkpoint 5 - Workspace Isolation Verification

- Current checkpoint: completed.
- What changed: inspected the fresh run workspace without mutating GitHub or Linear.
- What was verified: workspace path exists; `git rev-parse --show-toplevel` resolves to `/Users/diegomarono/.symphonia/workspaces/ALV-5-43976218`; workspace kind is `git_worktree`; isolation status is `isolated`; PR eligibility is `eligible`; persisted ownership metadata exists with metadata version 1; source repo is `/Users/diegomarono/symphonía`; target repo is `agora-creations/symphonia`; base branch is `main`; head branch is `codex/alv-5-43976218`; remote is `https://github.com/agora-creations/symphonia`; provider cwd matched the isolated workspace.
- Remaining work: verify approval evidence and review artifact details.
- Blockers or risks: none for workspace isolation.

## Checkpoint 6 - Approval Evidence And Review Artifact

- Current checkpoint: completed.
- What changed: refreshed and read the run review artifact and approval evidence.
- What was verified: approval evidence final state is `succeeded`, event count is 1633, missing evidence reasons are empty, review artifact status is `ready`, file summary is non-null from `review_artifact`, hook output summary contains 6 entries, and changed files contain exactly `apps/daemon/test/http.test.ts`. Review artifact diff reports 1 changed file with +43/-2.
- Remaining work: run PR preflight and compare live diff to evidence.
- Blockers or risks: none for evidence readiness.

## Checkpoint 7 - Live Diff Versus Approval Evidence

- Current checkpoint: completed.
- What changed: ran GitHub PR preflight for the fresh run using the generated PR preview id, payload hash, idempotency key, target repo, base branch, and head branch.
- What was verified: live changed files are `apps/daemon/test/http.test.ts`; approval evidence changed files are `apps/daemon/test/http.test.ts`; `missingFromLiveDiff` is empty; `extraInLiveDiff` is empty; `matchesApprovalEvidence` is true; `hasUnrelatedDirtyFiles` is false; preview payload hash matches; review artifact is ready.
- Remaining work: verify branch, remote, and idempotency state.
- Blockers or risks: none for non-write diff/evidence parity.

## Checkpoint 8 - Branch, Remote, And Idempotency Preflight

- Current checkpoint: completed.
- What changed: inspected the PR preflight branch, remote, and idempotency state.
- What was verified: target repository is `agora-creations/symphonia`; workspace remote matches target; base branch is `main`; head branch is `codex/alv-5-43976218`; head branch exists locally; head branch does not exist remotely; no existing PR was found; remote state is not ambiguous; head branch is safe; protected/default branch rules are respected. Preflight status is `blocked` only because GitHub write mode is read-only, PR creation is disabled, branch push is disabled, and manual write gates are not enabled.
- Remaining work: produce the manual confirmation packet and stop before the external write boundary.
- Blockers or risks: GitHub write mode remains read-only and `github.write.allow_push`/`allow_create_pr` are false by design.

## Checkpoint 9 - Manual Confirmation Packet

- Current checkpoint: manual confirmation boundary reached.
- What changed: produced the non-mutating confirmation packet for a possible future manual draft PR.
- What was verified:
  - runId: `43976218-fd29-4c90-bda6-1023ef78cffb`
  - issue: `ALV-5` - `Symphonia test`
  - target GitHub repository: `agora-creations/symphonia`
  - base branch: `main`
  - proposed head branch: `codex/alv-5-43976218`
  - draft: `true`
  - proposed PR title: `ALV-5: Symphonia test`
  - proposed PR body summary: Symphonia run for ALV-5 with issue link, review artifact/run timeline references, and `symphonia-run-id: 43976218-fd29-4c90-bda6-1023ef78cffb`
  - changed file count: 1
  - changed files: `apps/daemon/test/http.test.ts`
  - review artifact: `ready`, identifier `review-artifact:43976218-fd29-4c90-bda6-1023ef78cffb`
  - approval evidence: `succeeded`, 1633 events, no missing evidence reasons
  - payload hash: `74a4842aeb723a95dd796d2c84f61edbd18cec82e9b102e50b80dd4dc9e7d6f3`
  - idempotency key: `preview:github_pr_create:43976218-fd29-4c90-bda6-1023ef78cffb:74a4842aeb723a95dd796d2c`
  - preflight status: local non-write gates passed; execution blocked by write mode/push/PR gates
  - GitHub write mode: `read_only`
  - required write-mode change: set GitHub read-only false, enable writes, enable `allow_create_pr`, and enable `allow_push` if branch publication remains required
  - exact confirmation phrase: `CREATE GITHUB PR`
  - exact API route: `POST /runs/43976218-fd29-4c90-bda6-1023ef78cffb/github/pr/create`
  - Linear writes: disabled; Linear comment route returned HTTP 405
- Remaining work: run validation. Do not create a PR without explicit human confirmation.
- Blockers or risks: no external write occurred; this milestone stops at Outcome A unless the human explicitly confirms the GitHub write.

## Checkpoint 10 - Optional Human-Confirmed Draft PR

- Current checkpoint: skipped.
- What changed: no GitHub PR was created because no human confirmation was provided and GitHub write mode remains read-only.
- What was verified: no approval/execution write record was created by this verification path, and no GitHub or Linear mutation was attempted.
- Remaining work: validation.
- Blockers or risks: a future manual PR creation attempt must explicitly enable GitHub manual write mode and provide the exact confirmation phrase.

## Checkpoint 11 - Post-Write Verification

- Current checkpoint: not applicable.
- What changed: no post-write checks were run because no real PR was created.
- What was verified: Linear writes remain disabled and no PR number/URL exists for this run.
- Remaining work: validation.
- Blockers or risks: none.

## Checkpoint 12 - Tests

- Current checkpoint: no test changes required.
- What changed: did not add or modify automated tests because the real-run verification did not expose a code gap; 15W already covers isolated worktrees, durable ownership metadata, provider cwd, legacy blocking, diff/evidence parity, and fail-closed execution.
- What was verified: the fresh real run exercised the intended product path with real Linear, real Codex, real local repo, persisted ownership, review artifact, and PR preflight.
- Remaining work: run the project validation stack.
- Blockers or risks: none.

## Checkpoint 13 - Validation

- Current checkpoint: completed.
- What changed: ran the required validation stack from `package.json`.
- What was verified:
  - `pnpm --filter @symphonia/daemon test` passed.
  - `pnpm --filter @symphonia/daemon lint` passed.
  - `pnpm --filter @symphonia/web lint` passed.
  - `pnpm lint` passed.
  - `pnpm test` passed.
  - `pnpm build` passed.
  - `pnpm desktop:build` passed.
  - `pnpm harness:scan --path .` passed when rerun outside the sandbox.
  - `git diff --check` passed.
  - `pnpm validate:ci` passed when rerun outside the sandbox.
- Remaining work: final reporting.
- Blockers or risks: sandboxed `pnpm harness:scan --path .` and sandboxed `pnpm validate:ci` failed only because `tsx` could not create an IPC pipe under `/var/folders/.../tsx-501/*.pipe` with `EPERM`; both passed with escalation. Harness readiness remains 68% (D), matching the scanner advisory output rather than a command failure.

## Final Status

- Current checkpoint: Milestone 15C-R2 complete with Outcome A - fresh isolated run reached the manual PR boundary.
- What changed: created the 15C-R2 runbook and progress log, ran one fresh real Codex run for ALV-5 in an isolated git worktree, refreshed approval evidence and review artifacts, generated GitHub PR preview/preflight, and stopped before any external write.
- What was verified: run `43976218-fd29-4c90-bda6-1023ef78cffb` succeeded; workspace `/Users/diegomarono/.symphonia/workspaces/ALV-5-43976218` is a `git_worktree`, isolated, PR-eligible, and owned by the run; provider cwd matched the isolated workspace; approval evidence has 1633 events, no missing evidence reasons, and one changed file; review artifact is ready; live diff matches approval evidence; branch/remote state is unambiguous; preflight passes all non-write gates and blocks only on GitHub read-only/write disabled/push disabled policy.
- Remaining work: if the human wants to cross the external-write boundary, perform 15C-V2 or explicitly enable manual GitHub write mode and confirm the exact draft PR packet. Linear writeback must still wait.
- Blockers or risks: no real PR was created; no GitHub mutation occurred; no Linear mutation occurred. The main checkout still has an unrelated `README.md` deletion of the stale "Next Milestone" section that was present before this milestone and remains untouched.
