# Milestone 13 Connected Golden Path Progress

## Checkpoint 0 - Current Repo Inspection

- Current checkpoint: required first-step inspection.
- What changed: no product files changed yet; inspected scripts, app surfaces, daemon entry points, daemon status endpoints, issue/tracker code, Linear/GitHub integration code, workspace selection, run lifecycle, event streaming, provider abstractions, Codex provider, SQLite event store, review artifacts, auth/status code, write gates, tests, docs, README, and CI.
- What was verified: the repo already has real Linear issue fetch/cache, `/issues`, `/runs`, `/runs/:id/events/stream`, provider health, auth status, GitHub health, workspace inventory, review artifacts, SQLite persistence, and confirmation-gated GitHub/Linear write actions.
- Remaining work: add the connected status contract, first-run connected gateway, board readiness states, Codex CTA hardening, proof/evidence polish, internal test coverage, and validation.
- Blockers or risks: browser-only mode cannot open a native folder chooser; desktop mode can. The connected gateway must surface this clearly without adding Demo Mode.

## Checkpoint 1 - Connected Golden Path Contract

- Current checkpoint: connected golden path contract.
- What changed: created `docs/CONNECTED_GOLDEN_PATH.md` with first-run and returning connected journeys, normalized issue/run/event/review models, onboarding state machine, implemented/deferred scope, missing-requirement surfacing, and write-safety gates.
- What was verified: the document explicitly states there is no user-facing Demo Mode in this milestone.
- Remaining work: implement the daemon/API status surface and connected gateway.
- Blockers or risks: none.

## Checkpoint 2 - Connected Golden Path Status

- Current checkpoint: connected golden path status.
- What changed: added typed connected status schemas in `@symphonia/types`, exposed `GET /connected/status` and `GET /golden-path/status` from the daemon, and added the web API client helper.
- What was verified: code inspection confirms the status summarizes daemon, repository/workflow, workspace, Linear readiness, GitHub readiness, Codex provider readiness, event store, board readiness, review artifact readiness, write posture, next action, and blockers.
- Remaining work: run type/test validation after the internal fixture test is added.
- Blockers or risks: GitHub validation is intentionally treated as a connected prerequisite, so default `github.enabled: false` keeps the gateway active until the user configures GitHub.

## Checkpoint 3 - First-Run Connected Gateway

- Current checkpoint: first-run connected gateway.
- What changed: augmented the Issues first screen with a connected setup gateway that has no Demo Mode, no sample data, and rows for runtime, repo/workspace, GitHub, Linear, Codex, board readiness, and write safety.
- What was verified: code inspection confirms the gateway uses connected status and points to real settings/refresh actions instead of a demo route or seeded workspace.
- Remaining work: validate in browser/build and ensure status/empty states pass type checking.
- Blockers or risks: browser-only mode cannot open a native folder picker; the gateway routes repository fixes through Settings and desktop mode keeps native chooser support.

## Checkpoint 4 - Real Issue Board Readiness

- Current checkpoint: real issue board readiness.
- What changed: made the Issues surface the connected issue board by default, added issue-scope/count copy, real empty states, refresh/retry messaging, inline gateway warnings, and disabled issue-creation affordances because intake is deferred.
- What was verified: `curl http://127.0.0.1:3013/issues` shows the connected setup and "No real issues loaded" state; `curl http://localhost:4100/connected/status` reports the current issue scope and blocking reasons. Product code does not seed fake issues or expose a demo workspace action.
- Remaining work: none for this checkpoint.
- Blockers or risks: without real Linear credentials the local manual runtime check remains in a connected-blocked state, which is expected.

## Checkpoint 5 - Run With Codex Action

- Current checkpoint: Run with Codex action.
- What changed: made each issue card/list row expose a primary `Run with Codex` action, validate connected status before launch, call the existing `/runs` path with provider `codex`, and reveal the run proof screen after a run starts.
- What was verified: the new daemon fixture test starts a Codex run through `POST /runs` after connected prerequisites are represented by internal fixtures. The UI action is `Run with Codex`; there is no `Run Demo Agent` action.
- Remaining work: none for this checkpoint.
- Blockers or risks: the product intentionally blocks run launch until GitHub, Linear, workspace, board, and Codex provider status are ready.

## Checkpoint 6 - Run Proof Screen

- Current checkpoint: run detail/proof screen.
- What changed: hardened the run detail modal with a proof-state banner, workspace/provider status, event stream error messaging, evidence summaries, provider output/errors, hook/test output, changed-file summaries through review artifacts, and final completed/needs-review/failed messaging.
- What was verified: `pnpm test` passes the daemon end-to-end fixture that records workspace, prompt, provider, events, review artifacts, and final run state.
- Remaining work: none for this checkpoint.
- Blockers or risks: browser automation was not available in this session because the Browser plugin's required JavaScript control tool was not exposed; HTTP route checks and automated tests covered the reachable surface.

## Checkpoint 7 - Review Artifact

- Current checkpoint: review artifact visibility.
- What changed: kept the existing review-artifact generation path and surfaced artifact metadata in the proof screen: issue, run, provider, workspace, status, and next review action. Gated future actions remain separate from artifact review.
- What was verified: the golden path fixture waits for run completion, reads `/runs/:id/review-artifacts`, and confirms the artifact is present. No PR creation or Linear write is enabled by this milestone.
- Remaining work: none for this checkpoint.
- Blockers or risks: none.

## Checkpoint 8 - Runtime Recovery Basics

- Current checkpoint: runtime recovery basics.
- What changed: connected status now reports daemon, repo/workflow, workspace, Linear, GitHub, provider, event store, board, review artifact, write posture, next action, and blockers. The UI displays missing daemon, missing Linear, disabled/missing GitHub validation, provider errors, empty issue sets, stream disconnects, and missing review artifacts.
- What was verified: local runtime status reported `needs_linear`, ready repo/workspace, missing Linear auth, disabled GitHub validation, ready Codex provider, read-only writes, and blocking reasons. The `/issues` route renders the connected setup without sample data.
- Remaining work: none for this checkpoint.
- Blockers or risks: full runtime management remains deferred by design.

## Checkpoint 9 - Internal Test Fixtures Without Demo Mode

- Current checkpoint: internal fixture coverage.
- What changed: added a daemon integration test that uses fake Linear/GitHub/Codex transports, a temporary repository, temporary workspace root, temporary database, deterministic events, and deterministic review artifacts.
- What was verified: `pnpm --filter @symphonia/daemon test` and `pnpm test` pass; the fixture proves connected prerequisites, board population, `Run with Codex`, event persistence, review artifact readiness, and final `completed` state. Assertions also guard against user-facing Demo Mode labels in the connected status response.
- Remaining work: none for this checkpoint.
- Blockers or risks: none.

## Checkpoint 10 - Validation

- Current checkpoint: validation.
- What changed: ran the discovered package/CI validation commands and rebuilt the native SQLite dependency after the first daemon test attempt exposed a stale `better-sqlite3` Node ABI.
- What was verified:
  - `pnpm --filter @symphonia/daemon test` passed after `pnpm --filter @symphonia/db rebuild better-sqlite3`.
  - `pnpm --filter @symphonia/web lint` passed.
  - `pnpm lint` passed.
  - `pnpm test` passed.
  - `pnpm build` passed.
  - `pnpm desktop:build` passed.
  - `git diff --check` passed.
  - `pnpm harness:scan --path .` passed outside the sandbox; inside the sandbox it failed because `tsx` could not create its IPC pipe under `/var/folders/...`, which is an environment permission issue.
  - `pnpm validate:ci` passed outside the sandbox. The sandbox run reached tests, lint, build, and desktop build, then failed at the same `tsx` IPC permission boundary.
- Remaining work: final review and handoff.
- Blockers or risks: no milestone-caused validation failures remain.

## Final Status

- Current checkpoint: Milestone 13 completion review.
- What changed: implemented the connected golden path contract, status API, first-run gateway, real issue board readiness, `Run with Codex` primary action, proof/evidence/review artifact display, recovery messaging, and internal fixture test coverage.
- What was verified: full validation passed with `pnpm validate:ci` outside the sandbox; product surfaces remain real-data-first and do not add a user-facing Demo Mode.
- Remaining work: Milestone 14 should exercise this same loop against real Linear, real Codex, and a real local repo instead of internal fixtures.
- Blockers or risks: current local manual status is blocked on missing Linear auth and disabled GitHub validation in `WORKFLOW.md`, which is expected until real credentials/configuration are provided.
