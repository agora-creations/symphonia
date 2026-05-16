# Milestone 15C-V4 Create One Draft PR Progress

## Checkpoint 0 - Current State Inspection

- Current checkpoint: completed.
- What changed: no product behavior changed before inspection.
- What was verified: inspected `git status`, the 15C-R3 runbook/progress docs, 15C-V3/V2 draft PR verification docs, GitHub branch freshness and preflight docs, workspace isolation docs, manual PR creation docs, write approval docs, approval evidence docs, shared execution/preflight schemas, workspace manager, integration write helpers, event store persistence, daemon preflight/execution routes, web API helpers, write preview UI, write-mode configuration, idempotency implementation, and package validation scripts.
- Remaining work: create the V4 execution runbook, revalidate the selected run, reconstruct the final confirmation packet, and stop unless explicit human confirmation is complete.
- Blockers or risks: main checkout has uncommitted milestone documentation. No GitHub or Linear write has been confirmed for this milestone.

## Checkpoint 1 - Draft PR Execution Runbook

- Current checkpoint: completed.
- What changed: created `docs/CREATE_ONE_DRAFT_PR_EXECUTION.md`.
- What was verified: the runbook defines why 15C-V4 follows 15C-R3, the selected run, the one allowed GitHub draft PR write, forbidden Linear/GitHub writes, required revalidation, GitHub write gates, confirmation phrase, approval record, execution record, idempotency, post-write verification, write-gate restoration/documentation, and changed-state stop behavior.
- Remaining work: revalidate selected run `a0d316a8-eb83-47a3-b8fe-498ec2077ac3` without mutation.
- Blockers or risks: no external write occurred.

## Checkpoint 2 - Revalidate Selected Run Without Mutation

- Current checkpoint: completed.
- What changed: restarted the local daemon with the configured Codex app-server command override and refreshed the selected run's review artifact.
- What was verified: daemon health was `ok`; connected status reported daemon, repository, workspace, Linear, GitHub, Codex provider, event store, and board ready; GitHub and Linear write modes remained `read_only`; run `a0d316a8-eb83-47a3-b8fe-498ec2077ac3` still exists and is `succeeded`; workspace path is `/Users/diegomarono/.symphonia/workspaces/ALV-5-a0d316a8`; workspace kind is `git_worktree`; ownership metadata is durable with metadata version 1; stored base commit is `3cd141a1d276d58f99b34d644bc74c9476ff5414`; provider cwd events show `/Users/diegomarono/.symphonia/workspaces/ALV-5-a0d316a8`; approval evidence endpoint works; event count is 1221; changed file list is available; review artifact is `ready`; write-action previews include GitHub PR, Linear comment, and Linear status previews; Linear previews remain read-only; Linear comment execution returns HTTP 405 and Linear status execution is not exposed.
- Remaining work: revalidate workspace diff/evidence parity and PR preflight.
- Blockers or risks: no GitHub or Linear mutation occurred.

## Checkpoint 3 - Revalidate Workspace, Diff, and Evidence

- Current checkpoint: completed.
- What changed: inspected the isolated run workspace and refreshed review artifact snapshot.
- What was verified: git top-level resolves to `/Users/diegomarono/.symphonia/workspaces/ALV-5-a0d316a8`; remote is `https://github.com/agora-creations/symphonia`; current branch/head branch is `codex/alv-5-a0d316a8`; base branch is `main`; live changed files contain only `apps/daemon/test/http.test.ts`; approval evidence changed files contain only `apps/daemon/test/http.test.ts`; both report status `M`, +47, -2; no extra files; no missing files; no unrelated dirty files; no secret-like or local runtime files in the diff; review artifact corresponds to this run and was refreshed at `2026-05-16T13:38:53.308Z`.
- Remaining work: revalidate PR preflight and branch freshness.
- Blockers or risks: none for workspace/diff/evidence parity.

## Checkpoint 4 - Revalidate PR Preflight and Branch Freshness

- Current checkpoint: completed.
- What changed: ran non-mutating GitHub PR preflight for `a0d316a8-eb83-47a3-b8fe-498ec2077ac3`.
- What was verified: workspace isolation checks pass; ownership metadata checks pass; live diff/evidence parity passes; preview hash matches; review artifact is ready; remote branch is absent; existing PR is absent; branch state is unambiguous; branch freshness is `fresh`; stored base commit and current remote base commit both equal `3cd141a1d276d58f99b34d644bc74c9476ff5414`; upstream changed files are empty; overlapping changed files are empty; preflight created no approval/execution record; write history remains empty; Linear transports were not called.
- Remaining work: record final human confirmation packet and pause unless confirmation is explicit.
- Blockers or risks: `canExecute` is false only because expected write gates remain disabled: GitHub read-only, GitHub writes disabled, PR creation disabled, branch push disabled, and `WORKFLOW.md` not enabled for draft PR creation.

## Checkpoint 5 - Final Human Confirmation Packet

- Current checkpoint: completed; paused at the write boundary.
- What changed: reconstructed the confirmation packet from current API responses and the R3 packet.
- What was verified: all non-write gates passed; branch freshness is still `fresh`; the packet values match the selected run; GitHub write mode is still `read_only`; Linear writes remain disabled.
- Remaining work: receive explicit human confirmation before enabling any GitHub write gate.
- Blockers or risks: human confirmation is not complete, so no external write can occur.

### Confirmation Packet

- Run ID: `a0d316a8-eb83-47a3-b8fe-498ec2077ac3`
- Issue: `ALV-5` - `Symphonia test`
- Target GitHub repository: `agora-creations/symphonia`
- Base branch: `main`
- Proposed head branch: `codex/alv-5-a0d316a8`
- Draft: `true`
- Proposed PR title: `ALV-5: Symphonia test`
- Proposed PR body summary: Symphonia run for ALV-5 with issue link, review artifacts/run timeline for changed files and validation, and hidden run id `a0d316a8-eb83-47a3-b8fe-498ec2077ac3`.
- Changed file count: 1
- Changed files: `apps/daemon/test/http.test.ts`
- Review artifact: `ready` (`review-artifact:a0d316a8-eb83-47a3-b8fe-498ec2077ac3`)
- Approval evidence: `succeeded`, 1221 events, no missing evidence reasons
- Branch freshness: `fresh`
- Stored base commit: `3cd141a1d276d58f99b34d644bc74c9476ff5414`
- Current remote base commit: `3cd141a1d276d58f99b34d644bc74c9476ff5414`
- Upstream changed files: none
- Overlapping changed files: none
- Preview ID: `write-preview-a0d316a8-eb83-47a3-b8fe-498ec2077ac3-github_pr_create-c58d24432094`
- Payload hash: `c58d244320944f9c048cbacc73d01a6fc2b410703108a13001517c447ee6ea67`
- Idempotency key: `preview:github_pr_create:a0d316a8-eb83-47a3-b8fe-498ec2077ac3:c58d244320944f9c048cbacc`
- Current GitHub write mode: `read_only`
- Required write-mode change: enable GitHub manual write mode for this single action
- Required branch push gate: enable non-force branch push for this single action
- Required PR creation gate: enable draft PR creation for this single action
- Exact confirmation phrase: `CREATE GITHUB PR`
- Exact API request if confirmed: `POST /runs/a0d316a8-eb83-47a3-b8fe-498ec2077ac3/github/pr/create` with the preview id, action kind `github_pr_create`, payload hash, idempotency key, target repository, base branch, head branch, `draft: true`, and confirmation text.
- Linear writes remain disabled.

Required human confirmation before continuing:

```text
I approve enabling GitHub manual write mode, non-force branch push, and draft PR creation for this single action only.
Target repo: agora-creations/symphonia
Base branch: main
Head branch: codex/alv-5-a0d316a8
Payload hash: c58d244320944f9c048cbacc73d01a6fc2b410703108a13001517c447ee6ea67
Idempotency key: preview:github_pr_create:a0d316a8-eb83-47a3-b8fe-498ec2077ac3:c58d244320944f9c048cbacc
Branch freshness: fresh
Confirmation phrase: CREATE GITHUB PR
```

## Checkpoint 6 - Enable GitHub Write Gates Only If Confirmed

- Current checkpoint: intentionally not performed.
- What changed: no write gates were enabled.
- What was verified: human confirmation was not explicit and complete in this turn.
- Remaining work: enable only the minimum GitHub gates after exact confirmation.
- Blockers or risks: enabling gates without confirmation would bypass the safety boundary.

## Checkpoint 7 - Create Exactly One Draft PR

- Current checkpoint: intentionally not performed.
- What changed: no PR creation request was sent.
- What was verified: no branch was pushed, no PR was created, and no approval/execution record was created.
- Remaining work: after explicit confirmation, call `POST /runs/a0d316a8-eb83-47a3-b8fe-498ec2077ac3/github/pr/create` once with the exact packet values.
- Blockers or risks: crossing this boundary mutates GitHub.

## Checkpoint 8 - Post-Write Verification

- Current checkpoint: not applicable.
- What changed: no external write occurred.
- What was verified: no PR number or URL exists for this milestone because no PR was created.
- Remaining work: verify PR existence, draft state, target/base/head, title/body, changed files, approval record, execution record, UI result, and Linear prevention only after a confirmed write.
- Blockers or risks: none for the no-write outcome.

## Checkpoint 9 - Idempotency Verification

- Current checkpoint: not applicable.
- What changed: no execution occurred, so no idempotent retry was attempted.
- What was verified: write history is empty before the write boundary.
- Remaining work: after one confirmed PR is created, repeat the same request and verify it returns the existing result without another PR.
- Blockers or risks: none for the no-write outcome.

## Checkpoint 10 - Restore or Document Write Gates

- Current checkpoint: completed for no-write outcome.
- What changed: no temporary write gates were enabled, so no restoration was required.
- What was verified: GitHub remains `read_only`; branch push remains disabled; PR creation remains disabled; Linear writes remain disabled.
- Remaining work: if a later confirmed write temporarily enables gates, restore or document gate state after post-write verification.
- Blockers or risks: none.

## Checkpoint 11 - Blocked-Path Verification

- Current checkpoint: completed where applicable before confirmation.
- What changed: no unsafe write path was exercised.
- What was verified: PR preflight reports read-only/write/push/create-PR gate blockers; Linear comment execution remains HTTP 405; Linear status execution is not exposed; Linear previews remain read-only; write history remains empty.
- Remaining work: after a confirmed write, verify idempotent retry and payload-hash conflict behavior.
- Blockers or risks: intentionally did not call the GitHub execution route because the milestone paused before human confirmation.

## Checkpoint 12 - Tests

- Current checkpoint: completed with no new test changes.
- What changed: no implementation/test code was added because verification exposed no coverage gap before the confirmation boundary.
- What was verified: existing daemon tests already cover manual GitHub draft PR success with fake transport, audit-first persistence, idempotency, read-only blocks, stale/unknown freshness blocks, and Linear route prevention.
- Remaining work: add tests only if a future confirmed write exposes a gap.
- Blockers or risks: none.

## Checkpoint 13 - Validation

- Current checkpoint: completed.
- What changed: ran the required validation commands for the paused V4 outcome.
- What was verified:
  - `pnpm --filter @symphonia/daemon test` passed: 47 daemon tests.
  - `pnpm --filter @symphonia/daemon lint` passed.
  - `pnpm --filter @symphonia/web lint` passed.
  - `pnpm lint` passed.
  - `pnpm test` passed: packages and app tests passed, including daemon, core, db, types, and desktop suites.
  - `pnpm build` passed.
  - `pnpm desktop:build` passed.
  - `pnpm harness:scan --path .` passed after rerunning outside the sandbox because the first sandboxed attempt failed on the known `tsx` IPC pipe `EPERM`.
  - `git diff --check` passed.
  - `pnpm validate:ci` passed after rerunning outside the sandbox because the first sandboxed attempt reached the harness step and failed on the same `tsx` IPC pipe `EPERM`.
- Remaining work: none for the paused no-write outcome.
- Blockers or risks: sandbox-only `tsx` IPC restrictions affect harness execution; escalated validation passed.

## Final Status

- Outcome: Outcome A - safe pause at final write boundary.
- Run revalidated: `a0d316a8-eb83-47a3-b8fe-498ec2077ac3`.
- Workspace revalidated: `/Users/diegomarono/.symphonia/workspaces/ALV-5-a0d316a8`, `git_worktree`, isolated from the main checkout.
- Ownership metadata: present and durable.
- Provider cwd: matched the isolated workspace.
- Approval evidence: succeeded, 1221 events, no missing evidence reasons.
- Review artifact: ready.
- Live diff vs approval evidence: exact match on `apps/daemon/test/http.test.ts`.
- Branch freshness: `fresh`; stored base and current remote base both `3cd141a1d276d58f99b34d644bc74c9476ff5414`.
- PR preflight: all non-write gates pass; execution remains blocked by expected GitHub write gates only.
- Confirmation packet: recorded above with preview id, payload hash, idempotency key, head branch, and exact confirmation phrase.
- External writes: none. No branch was pushed, no PR was created, and no GitHub mutation occurred.
- Approval/execution records: none created for PR execution.
- Idempotency verification: deferred until after exactly one confirmed PR execution.
- GitHub write gates: remained `read_only` / disabled; no restoration was required.
- Linear writes: remain disabled; Linear comment execution returned HTTP 405 and Linear previews remain read-only.

## Continuation - Explicit Human Confirmation Received

- Current checkpoint: completed.
- What changed: the human provided explicit confirmation for exactly one GitHub draft PR using the recorded packet values:
  - run `a0d316a8-eb83-47a3-b8fe-498ec2077ac3`;
  - target repository `agora-creations/symphonia`;
  - base branch `main`;
  - head branch `codex/alv-5-a0d316a8`;
  - payload hash `c58d244320944f9c048cbacc73d01a6fc2b410703108a13001517c447ee6ea67`;
  - idempotency key `preview:github_pr_create:a0d316a8-eb83-47a3-b8fe-498ec2077ac3:c58d244320944f9c048cbacc`;
  - branch freshness `fresh`;
  - confirmation phrase `CREATE GITHUB PR`.
- What was verified: before enabling gates, preflight still matched the confirmed packet and still blocked only on expected GitHub write gates. `WORKFLOW.md` was then temporarily changed to set GitHub `read_only: false`, `write.enabled: true`, `allow_push: true`, and `allow_create_pr: true`; Linear gates were not changed.
- Remaining work: do not create the PR with the stale confirmation packet; require a refreshed confirmation packet if product policy allows the new executable hash.
- Blockers or risks: after restarting the daemon with the temporary GitHub gates enabled, non-mutating preflight passed structurally, but the preview id and payload hash changed:
  - temporary-gate preview id: `write-preview-a0d316a8-eb83-47a3-b8fe-498ec2077ac3-github_pr_create-9c9e757699b9`;
  - temporary-gate payload hash: `9c9e757699b9799e953b58207335390bf08f67c66a776c5418c6d0f82296250e`.
  Because this did not match the human-confirmed payload hash, PR execution stopped before any GitHub write route was called.

## Continuation - Gate Restoration

- Current checkpoint: completed.
- What changed: restored `WORKFLOW.md` GitHub gates to the safer pre-confirmation state: `read_only: true`, `write.enabled: false`, `allow_push: false`, and `allow_create_pr: false`.
- What was verified: restarted the daemon after restoration; `/writes/status` reports GitHub `enabled: false`, `readOnly: true`, allowed kinds empty; Linear remains `enabled: false`, `readOnly: true`; write-actions for the selected run remain preview-only; write history remains empty; the restored read-only preflight again reports the original confirmed payload hash `c58d244320944f9c048cbacc73d01a6fc2b410703108a13001517c447ee6ea67`.
- Remaining work: fix or explicitly account for payload-hash dependence on write-gate state before the first real PR write, then produce a new confirmation packet.
- Blockers or risks: no branch was pushed, no PR was created, and no local approval/execution record was created.

## Updated Final Status After Confirmation Attempt

- Outcome: Outcome C - PR creation remains blocked.
- Exact blocker: enabling the confirmed GitHub write gates changed the executable preflight preview id and payload hash before execution. The confirmed hash was `c58d244320944f9c048cbacc73d01a6fc2b410703108a13001517c447ee6ea67`; the gate-enabled hash was `9c9e757699b9799e953b58207335390bf08f67c66a776c5418c6d0f82296250e`.
- External writes: none. The GitHub PR creation route was not called, no branch was pushed, no PR was created, and no GitHub mutation occurred.
- Approval/execution records: none created.
- Idempotency verification: not applicable because no execution occurred.
- GitHub write gates: restored to `read_only` / disabled and verified through `/writes/status`.
- Linear writes: remained disabled throughout; no Linear mutation occurred.
- Recommended next milestone: a focused 15C-H hash-stability hardening step so write-mode gate changes do not invalidate the human-approved content payload, or so the confirmation packet explicitly binds both preview hash states before execution.
