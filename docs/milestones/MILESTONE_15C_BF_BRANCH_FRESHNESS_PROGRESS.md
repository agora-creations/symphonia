# Milestone 15C-BF Branch Freshness Progress

## Checkpoint 0 - Current State Inspection

- Current checkpoint: required first-step inspection.
- What changed: no product behavior changed before inspection.
- What was verified: inspected `git status`, 15C-V2 verification docs and progress log, fresh isolated run boundary docs, GitHub PR preflight docs, workspace isolation docs, manual GitHub PR creation docs, write approval docs, shared preflight schemas, workspace manager, integration write helpers, event store write-action persistence, daemon GitHub PR preflight and execution routes, web API helpers, write preview UI, daemon tests, helper git fixtures, and validation scripts.
- Remaining work: define the branch freshness contract, add typed preflight fields, implement the non-mutating freshness check, enforce freshness in execution, update the UI, revalidate selected run `43976218-fd29-4c90-bda6-1023ef78cffb`, add tests, and run validation.
- Blockers or risks: no GitHub or Linear writes are permitted in this milestone. Existing untracked 15C-V2 docs remain part of the current working tree.

## Checkpoint 1 - Branch Freshness Contract

- Current checkpoint: completed.
- What changed: created `docs/GITHUB_PR_BRANCH_FRESHNESS.md`.
- What was verified: the document defines why freshness matters, stored base commit source, current remote base resolution, read-only fetch behavior, freshness states, blocking policy, upstream changed-file detection, overlap detection, workspace ownership interaction, evidence parity interaction, idempotency interaction, UI behavior, and deferred work.
- Remaining work: add typed branch freshness fields to the shared GitHub PR preflight schema.
- Blockers or risks: none.

## Checkpoint 2 - Add Typed Branch Freshness Fields

- Current checkpoint: completed.
- What changed: extended the shared GitHub PR preflight schema with `branchFreshness`.
- What was verified: `GitHubPrBranchFreshnessStatus` supports `fresh`, `stale_no_overlap`, `stale_overlap`, and `unknown`; preflight responses now include base branch, stored base commit, current remote base commit, base advancement, upstream changed files, approval changed files, overlapping files, checked timestamp, blockers, and warnings. Existing preflight fields for workspace isolation, evidence parity, review artifact, preview hash, remote state, and write mode remain in place.
- Remaining work: implement the non-mutating freshness check in daemon preflight.
- Blockers or risks: package dist had to be rebuilt before daemon-only tests could see the new schema; normal root validation already builds packages first.

## Checkpoint 3 - Implement Non-Mutating Freshness Check

- Current checkpoint: completed.
- What changed: GitHub PR preflight now resolves the stored base commit from workspace ownership metadata, resolves the current remote base commit with `git ls-remote`, fetches base commit objects only when needed, compares upstream changed paths from stored base to current remote base, and compares those paths against approval-evidence changed files.
- What was verified: the implementation returns `fresh` when commits match, `stale_no_overlap` when upstream changes do not overlap approval files, `stale_overlap` when upstream touches approval files, and `unknown` when the base commit or remote base cannot be verified. The check is read-only with respect to GitHub/Linear and never pushes or creates branches.
- Remaining work: enforce freshness through the existing execution route.
- Blockers or risks: network or DNS failures produce `unknown` and block execution.

## Checkpoint 4 - Enforce Freshness In Execution Route

- Current checkpoint: completed.
- What changed: branch freshness blockers are folded into the existing preflight blocking reasons, and `POST /runs/:id/github/pr/create` already enforces preflight before local approval/audit persistence or GitHub write transport.
- What was verified: `stale_overlap` and `unknown` produce blocking reasons, so execution blocks before audit persistence or GitHub transport. `stale_no_overlap` contributes a warning but does not block by itself. Existing write gates still block as before.
- Remaining work: expose freshness in the UI.
- Blockers or risks: none.

## Checkpoint 5 - UI Branch Freshness Display

- Current checkpoint: completed.
- What changed: updated the run proof/write preview PR preflight panel to show branch freshness status, stored base commit, current remote base commit, base advancement, upstream changed files, overlapping changed files, branch freshness blockers, and warnings.
- What was verified: the UI keeps the existing disabled/available draft PR behavior and adds freshness context without exposing a new executable action.
- Remaining work: revalidate selected run `43976218-fd29-4c90-bda6-1023ef78cffb`.
- Blockers or risks: none.

## Checkpoint 6 - Revalidate Selected Run

- Current checkpoint: completed.
- What changed: ran non-mutating preflight for run `43976218-fd29-4c90-bda6-1023ef78cffb` with the current GitHub PR preview packet.
- What was verified: the run remains `succeeded`; approval evidence is available with event count 1642; review artifact is `ready`; live diff still matches approval evidence exactly for `apps/daemon/test/http.test.ts`; remote branch is absent; existing PR is absent; no approval/execution record exists. Branch freshness is `stale_no_overlap`: stored base commit `5a20ad0dd11f793960ca5d9149c7ae1e9dd2d5c1`, current remote base commit `069e9ff93f0360d8b07720086b696d836c560cd5`, upstream changed files `README.md`, `docs/FRESH_ISOLATED_RUN_TO_PR_BOUNDARY.md`, and `docs/milestones/MILESTONE_15C_R2_FRESH_ISOLATED_RUN_PROGRESS.md`, approval changed file `apps/daemon/test/http.test.ts`, and no overlaps. Execution remains blocked only by GitHub read-only/write/push/create-PR gates.
- Remaining work: tests and validation.
- Blockers or risks: sandboxed direct Node revalidation could not resolve `github.com` and correctly reported freshness `unknown`; the same non-mutating check passed outside the sandbox and reported `stale_no_overlap`.

## Checkpoint 7 - Tests

- Current checkpoint: completed.
- What changed: added daemon tests for branch freshness and updated the manual PR test to assert fresh branch state.
- What was verified: tests cover stored base equals remote base (`fresh`), remote base advanced without overlap (`stale_no_overlap` warning), remote base advanced with approval-file overlap (`stale_overlap` blocker), missing stored base commit (`unknown` blocker), remote base unavailable (`unknown` blocker), stale overlap blocking execution before audit persistence/GitHub transport, existing read-only/write gates, no Linear mutation, and disabled Linear routes.
- Remaining work: run the full validation stack.
- Blockers or risks: none.

## Checkpoint 8 - Validation

- Current checkpoint: completed.
- What changed: no product behavior changed during validation.
- What was verified: `pnpm --filter @symphonia/daemon test`, `pnpm --filter @symphonia/daemon lint`, `pnpm --filter @symphonia/web lint`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm desktop:build`, `pnpm harness:scan --path .`, `git diff --check`, and `pnpm validate:ci` all passed. The first sandboxed `pnpm harness:scan --path .` and `pnpm validate:ci` attempts hit the known `tsx` IPC pipe `EPERM`; both passed when rerun outside the sandbox.
- Remaining work: none for Milestone 15C-BF.
- Blockers or risks: branch freshness for run `43976218-fd29-4c90-bda6-1023ef78cffb` is `stale_no_overlap`, which is warning-only under this contract because upstream changed files do not overlap approval evidence. GitHub write gates still block execution until the human explicitly enables and confirms the future draft PR action.

## Final Status

- Current checkpoint: Milestone 15C-BF complete.
- What changed: GitHub PR preflight now reports branch freshness, the PR execution path enforces branch freshness blockers through preflight, the run proof UI displays freshness state and file overlap details, and focused daemon tests cover fresh, stale, overlap, and unknown states.
- What was verified: selected run `43976218-fd29-4c90-bda6-1023ef78cffb` remains isolated and evidence-matched; its branch freshness is `stale_no_overlap`; no approval/execution record was created; no GitHub branch was pushed; no PR was created; Linear write routes remain disabled.
- Remaining work: move to `15C-V3 - Create One Human-Confirmed Draft PR` if the human accepts `stale_no_overlap` as eligible under the documented policy and explicitly enables the required GitHub write gates.
- Blockers or risks: no current implementation blocker. The next milestone still requires explicit human confirmation before any external write.
