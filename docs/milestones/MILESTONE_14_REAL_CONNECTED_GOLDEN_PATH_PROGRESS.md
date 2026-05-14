# Milestone 14 Real Connected Golden Path Progress

## Checkpoint 0 - Current State Inspection

- Current checkpoint: required first-step inspection.
- What changed: no product files changed before inspection.
- What was verified: inspected the Milestone 13 contract/progress docs, typed connected status schemas, daemon connected endpoints, web API helper, connected gateway/board/proof UI, daemon fixture test, `WORKFLOW.md`, package scripts, README/CI validation surfaces, auth manager, Linear tracker/client, GitHub client/status, Codex provider/client, workspace manager, run lifecycle, event store, review artifacts, settings, desktop first-run setup, and app routes.
- Remaining work: create the real connected run checklist, document real status, harden narrow copy/status gaps, attempt real connected prerequisites, and run validation.
- Blockers or risks: no Linear credential is available in this environment. GitHub validation is disabled by committed `WORKFLOW.md`. Real issue loading and first real Codex issue run are blocked until Linear auth is provided and GitHub validation is intentionally enabled or accepted as disabled.

## Checkpoint 1 - Real Connected Run Plan

- Current checkpoint: real connected run plan.
- What changed: created `docs/REAL_CONNECTED_RUN.md` as the manual acceptance checklist for Milestone 14.
- What was verified: the checklist defines real prerequisites, Linear setup, GitHub read-only validation, repo/workspace selection, Codex readiness, safe issue selection, expected connected status/board/proof/review states, failure recovery, no user-facing Demo Mode, and gated GitHub/Linear writes.
- Remaining work: verify live connected status endpoints and harden confusing statuses or UI copy.
- Blockers or risks: none for the documentation checkpoint.

## Checkpoint 2 - Connected Status Reality Check

- Current checkpoint: connected status reality check.
- What changed: started the daemon outside the sandbox because `tsx watch` cannot create its IPC pipe inside the sandbox.
- What was verified:
  - `GET /healthz` returned healthy.
  - `GET /connected/status` worked.
  - `GET /golden-path/status` worked as an alias.
  - Repository status is `ready` for `/Users/diegomarono/symphonía`.
  - Workflow path is `/Users/diegomarono/symphonía/WORKFLOW.md` and workflow status is `healthy`.
  - Workspace status is `ready` at `/Users/diegomarono/symphonía/.symphonia/workspaces`.
  - Linear status is `missing_auth`; after issue refresh, tracker error is `Linear tracker config is missing endpoint or api key.`
  - GitHub status is `disabled` because `WORKFLOW.md` has `github.enabled: false`.
  - Codex provider status is `ready` for `codex app-server`.
  - Event store status is `ready`.
  - Writes are `read_only` for both GitHub and Linear.
  - `nextAction.kind` is `connect_linear`.
- Remaining work: continue repo/workspace/Codex checks and validate the narrow hardening.
- Blockers or risks: real Linear issue loading and the first real issue run are blocked until a Linear credential is provided.

## Checkpoint 3 - Real Repo And Workspace Readiness

- Current checkpoint: real repo/workspace readiness.
- What changed: no repo/workspace code changes were required.
- What was verified:
  - The selected repository is the real git checkout at `/Users/diegomarono/symphonía`.
  - `.git` exists.
  - `WORKFLOW.md` is healthy.
  - The configured workspace root exists at `/Users/diegomarono/symphonía/.symphonia/workspaces`.
  - Connected status reports `repository.status: "ready"` and `workspace.status: "ready"`.
- Remaining work: real per-issue workspace preparation still needs a real Linear issue.
- Blockers or risks: first real issue run is blocked by missing Linear auth, not by repo/workspace readiness.

## Checkpoint 4 - Real Linear Readiness

- Current checkpoint: real Linear readiness.
- What changed: hardened connected status blockers so a failed real Linear refresh preserves the specific missing-auth/config message, and hardened gateway guidance to tell the user to set `LINEAR_API_KEY` or connect Linear in Settings.
- What was verified:
  - `POST /auth/linear/validate` returned `status: "unavailable"` with `linear credentials are not configured.`
  - `POST /issues/refresh` returned no issues and recorded the tracker error.
  - `GET /connected/status` now reports `linear.status: "missing_auth"` with `linear.error: "Linear tracker config is missing endpoint or api key."`
  - Blocking reasons now include the specific Linear auth/config error.
  - After the user provided Linear auth, `/auth/status` showed Linear connected through encrypted local manual auth.
  - `POST /auth/linear/validate` showed Linear connected without exposing the token.
  - `GET /issues` loaded five real Linear issues from the workspace-wide read-only scope.
  - `GET /connected/status` reported `linear.status: "ready"` and `linear.issueCount: 5`.
- Remaining work: none for Linear readiness.
- Blockers or risks: the available issue used for the first run, `ALV-5`, has no body or acceptance criteria, so the run needed to stay narrow and review-oriented.

## Checkpoint 5 - Real Codex Readiness

- Current checkpoint: real Codex readiness.
- What changed: no provider code changes were required.
- What was verified:
  - `which codex` resolves to a local Codex CLI.
  - `GET /providers/codex/health` reports `available: true` for `codex app-server`.
  - `GET /connected/status` reports `provider.kind: "codex"` and `provider.status: "ready"`.
  - `Run with Codex` remains blocked while connected prerequisites are missing.
  - After Linear auth and read-only GitHub validation were ready, a real Codex app-server run started from issue `ALV-5`.
- Remaining work: none for provider readiness.
- Blockers or risks: local Codex emitted non-blocking warnings about local plugin/skill metadata during the run; the provider still streamed events and completed.

## Checkpoint 6 - First Real Issue Run

- Current checkpoint: first real issue run.
- What changed: enabled read-only GitHub repository validation in `WORKFLOW.md` for `agora-creations/symphonia`, keeping GitHub and Linear writes disabled/read-only; then launched the real `Run with Codex` path for real Linear issue `ALV-5`.
- What was verified:
  - `GET /connected/status` reached `onboardingState: "board_ready"` before the run.
  - Linear was ready with five real issues.
  - GitHub was ready against `agora-creations/symphonia` in read-only mode.
  - Codex provider was ready.
  - The selected issue was `ALV-5` / `Symphonia test`.
  - The run prepared workspace `/Users/diegomarono/symphonía/.symphonia/workspaces/ALV-5`.
  - The run streamed persisted events for workflow load, workspace readiness, GitHub read-only evidence, prompt rendering, hooks, provider launch, Codex output, approvals, and terminal state.
  - Final run `05e74792-72ff-4890-90be-fea430104134` ended `status: "succeeded"` with `terminalReason: "succeeded"`.
  - Connected status ended at `onboardingState: "completed"` with `nextAction.kind: "review_artifact"`.
- Remaining work: none for the first real issue run.
- Blockers or risks: the first two attempts were interrupted by daemon dev-server restarts, which exposed the runtime watcher issue fixed in the next checkpoint.

## Checkpoint 7 - Failure And Recovery Hardening

- Current checkpoint: failure and recovery hardening.
- What changed:
  - Connected blockers now distinguish missing Linear auth/config from generic Linear not-ready state.
  - Connected blockers now explain disabled GitHub validation in `WORKFLOW.md` and require read-only validation to prove repository access.
  - Gateway copy now gives actionable recovery for missing Linear auth and disabled GitHub validation.
  - Desktop first-run setup now includes `Connect Linear` next to `Connect GitHub`, while preserving env-token fallback and disabled writes.
  - Hardened the daemon dev script to exclude runtime data and per-issue workspaces from `tsx watch`: `.data/**` and `../../.symphonia/**`.
  - Added a small connected-path doc clarification from the real Codex run: empty real tracker issues should be handled as narrow smoke passes, with missing acceptance detail reported rather than invented.
- What was verified:
  - Before the watcher fix, two real Codex attempts were recovered as terminal `interrupted` with `terminalReason: "daemon_startup_recovery"`.
  - After the watcher fix and daemon restart, attempt 3 stayed on the same daemon instance and reached `succeeded`.
  - Approval gates surfaced local file-change requests before applying them.
  - `/runs/:id/write-actions` returned an empty list; no GitHub or Linear write action was executed.
- Remaining work: approval payloads should expose file summaries directly; the event stream contained the file-change summary, but `/approvals` had `fileSummary: null`.
- Blockers or risks: an unrelated exact `GOAL_PROGRESS.md` move was detected in git status; it is not part of this milestone and has not been modified further.

## Checkpoint 8 - Tests

- Current checkpoint: tests.
- What changed: added daemon coverage for explicit real connected blockers when Linear auth is missing and GitHub validation is disabled; extended the workflow test helper so a test can omit the Linear API key without using real credentials.
- What was verified:
  - `pnpm --filter @symphonia/daemon test` passed.
  - `pnpm --filter @symphonia/web lint` passed.
  - After the real-run watcher hardening, `pnpm --filter @symphonia/daemon test` passed again with 37 daemon tests.
  - The existing internal fixture golden path test still uses fake Linear, fake GitHub, fake Codex, temporary repos/workspaces, deterministic events, and deterministic review artifacts.
  - No user-facing Demo Mode or seeded product data was added.
- Remaining work: none.
- Blockers or risks: none caused by the test changes.

## Checkpoint 9 - Validation

- Current checkpoint: validation.
- What changed: ran the discovered project validation commands after the docs/status/UI hardening.
- What was verified:
  - `pnpm --filter @symphonia/daemon test` passed.
  - `pnpm --filter @symphonia/web lint` passed.
  - `pnpm lint` passed.
  - `pnpm test` passed.
  - `pnpm build` passed.
  - `pnpm desktop:build` passed.
  - `pnpm harness:scan --path .` passed outside the sandbox; the sandbox run failed because `tsx` could not create its IPC pipe under `/var/folders/...`, matching the known environment permission boundary.
  - `git diff --check` passed.
  - `pnpm validate:ci` passed outside the sandbox. The sandbox run reached tests, lint, build, and desktop build, then failed at the same `tsx` IPC boundary during harness scan.
  - After the restored real run and watcher fix, focused validation passed:
    - `pnpm --filter @symphonia/daemon test`
    - `pnpm --filter @symphonia/web lint`
    - `pnpm lint`
    - `pnpm build`
    - `pnpm test`
    - `pnpm desktop:build`
    - `git diff --check`
  - `pnpm harness:scan --path .` still fails inside the sandbox with `tsx` IPC `EPERM`, and passes outside the sandbox with Agent readiness 68%.
  - `pnpm validate:ci` passed outside the sandbox after the restored real run and watcher fix.
- Remaining work: final handoff.
- Blockers or risks: no milestone-caused validation failures remain. The sandbox-only `tsx` IPC failure is environment-specific and already documented.

## Final Status

- Current checkpoint: Milestone 14 reality pass.
- What changed: restored the real Milestone 14 run after Linear auth was provided, enabled read-only GitHub validation, fixed the dev daemon watcher restart issue, and completed one real `Run with Codex` attempt from a real Linear issue.
- What was verified:
  - Connected status ended `completed`.
  - Linear ended `ready` with five real issues.
  - GitHub ended `ready` against `agora-creations/symphonia` in read-only mode.
  - Codex ended `ready` and completed run `05e74792-72ff-4890-90be-fea430104134`.
  - Workspace path was visible: `/Users/diegomarono/symphonía/.symphonia/workspaces/ALV-5`.
  - Persisted events reached 659 entries for the final run.
  - Review artifact status ended `ready` and refreshed after run completion.
  - GitHub and Linear write posture remained `read_only`.
  - No GitHub PR, GitHub push/comment, Linear comment, Linear issue update, or Linear state transition was created.
- Remaining work: none for Milestone 14.
- Blockers or risks: approval records do not currently expose the file-change summary even though the event stream has it; this should be hardened next.
