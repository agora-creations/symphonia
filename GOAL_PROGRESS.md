# Symphonia Goal Progress

## Milestone 8 Objective

Package Symphonia as a local desktop app with first-run setup and persistent settings while preserving Mock/Codex/Claude/Cursor providers, Mock/Linear trackers, GitHub review artifacts, `WORKFLOW.md` runtime, restart recovery, workspace cleanup, SQLite/SSE, and the browser web+daemon workflow.

## Milestone 8 Starting Repo State

- Branch at start: `milestone-8-desktop-app`, created from `origin/main`.
- `origin/main` includes the Milestone 7 merge commit `859b75b` (`Merge pull request #5 from agora-creations/milestone-7-recovery-cleanup`).
- Working tree was clean before Milestone 8 changes.
- Root `WORKFLOW.md` remains mock tracker/provider mode by default with cleanup disabled/dry-run.
- Existing browser workflow remains `pnpm dev`; desktop mode must be additive.

## Milestone 8 Planned Checkpoints

1. Add an Electron desktop workspace with TypeScript, Forge packaging, root desktop scripts, and a secure main/preload split.
2. Decide and document the web serving strategy: desktop dev starts local web/daemon processes; packaging produces a reproducible Electron artifact while preserving the browser workflow.
3. Add daemon/web lifecycle management in the Electron main process with auto port selection, health checks, bounded logs, restart, and quit cleanup.
4. Add persistent desktop settings outside the repo with validation, redacted export, and no stored API keys.
5. Add a first-run setup flow using mock tracker/mock provider by default.
6. Add desktop settings and diagnostics UI for daemon, providers, trackers, GitHub, recovery, cleanup, logs, and redacted settings.
7. Implement Electron security defaults: context isolation, no renderer Node integration, sandbox, allowlisted IPC, validated IPC inputs, restricted navigation, and safe external links.
8. Add deterministic tests for settings, redaction, port/process lifecycle, IPC validation, and desktop diagnostics without real provider credentials or a display server.
9. Update README with desktop dev/package instructions, settings locations, secret handling, security baseline, troubleshooting, and limitations.
10. Run final validation: `pnpm test`, `pnpm lint`, `pnpm build`, `pnpm desktop:build`, `pnpm desktop:package`, `git diff --check`, web/daemon smoke, and desktop smoke where feasible.

## Milestone 8 Packaging Strategy

- Use Electron for this milestone because the stack is already Node, Next.js, and local daemon/provider subprocesses.
- Keep Electron Forge config in `apps/desktop`, but use `@electron/packager` directly for the package command because Forge requires a hoisted pnpm linker and this repo keeps the existing pnpm layout.
- Electron main owns desktop lifecycle and starts local daemon/web subprocesses.
- Renderer remains the existing Next.js UI and continues to talk to the daemon over HTTP/SSE.
- Electron IPC is limited to desktop-only operations: settings, path dialogs, daemon/web lifecycle, diagnostics, safe external links, and revealing configured paths.
- Tauri remains deferred for future evaluation.

## Milestone 8 Security Assumptions

- `contextIsolation: true`.
- `nodeIntegration: false`.
- `sandbox: true` unless a compatibility issue is found and documented.
- Renderer cannot spawn providers or read arbitrary files directly.
- IPC channels are allowlisted and inputs are validated.
- External navigation is blocked from the app window and opened through `shell.openExternal` only for validated HTTP(S) URLs.
- Settings store env var names for secrets, not raw secret values.

## Milestone 8 Validation Commands

- `pnpm install` after Electron dependencies are added.
- `pnpm --filter @symphonia/desktop build`
- `pnpm --filter @symphonia/desktop test`
- `pnpm test`
- `pnpm lint`
- `pnpm build`
- `pnpm desktop:build`
- `pnpm desktop:package`
- `git diff --check`
- `pnpm dev` smoke check
- `pnpm desktop:dev` smoke check

## Milestone 8 Checkpoint Progress

### Desktop Scaffold, Settings, Lifecycle, And First-Run UI

- Added `apps/desktop` workspace with Electron, Electron Forge, TypeScript, root desktop scripts, and package config.
- Added settings schemas, persistent settings store, redacted export, validation, and OS-appropriate settings path handling.
- Added managed process lifecycle utilities with localhost port selection, health polling, bounded logs, restart, and stop behavior.
- Added Electron main process, preload bridge, and allowlisted IPC for desktop status, daemon/web lifecycle, settings, diagnostics, path dialogs, safe external links, and starter workflow creation.
- Added web-side desktop bridge, dynamic daemon URL resolution for HTTP/SSE, first-run setup overlay, and a full Settings page for desktop status, persistent settings, providers, trackers, GitHub, recovery, cleanup, and diagnostics.
- Added deterministic desktop tests for settings defaults/persistence/redaction, IPC validation, external URL restrictions, local renderer navigation rules, fake process lifecycle, log redaction, stop cleanup, and startup failure handling.
- Added a staged desktop packaging script that packages compiled desktop code and runtime dependencies without bundling `.symphonia` workspaces, `.data` SQLite files, local output, or secrets.
- Added SIGINT/SIGTERM cleanup so an interrupted desktop dev session stops managed daemon/web child processes.

## Milestone 8 Final Status

Milestone 8 is implemented and validated. Symphonia now has an Electron desktop workspace, first-run setup, persistent local settings outside the repo, desktop diagnostics, daemon/web lifecycle management, dynamic daemon URL wiring for the existing Next.js UI, a secure preload/IPC boundary, and a reproducible unpacked desktop package. The existing browser `pnpm dev` workflow remains unchanged.

## Milestone 8 Implemented Files and Directories

- `.gitignore`
- `README.md`
- `GOAL_PROGRESS.md`
- `package.json`
- `pnpm-lock.yaml`
- `eslint.config.js`
- `apps/desktop/`
- `apps/web/app/settings/page.tsx`
- `apps/web/components/desktop-setup.tsx`
- `apps/web/components/issues-view.tsx`
- `apps/web/components/main-layout.tsx`
- `apps/web/lib/api.ts`
- `apps/web/lib/desktop.ts`

## Milestone 8 Final Command Results

- `CI=true pnpm install --no-frozen-lockfile` - passed after adding Electron dependencies.
- `node node_modules/.pnpm/electron@39.8.10/node_modules/electron/install.js` - passed; downloaded the Electron binary for local smoke/package validation.
- `pnpm --filter @symphonia/desktop test` - passed; 12 tests.
- `pnpm test` - passed; 158 tests across types, core, db, daemon, and desktop.
- `pnpm lint` - passed.
- `pnpm build` - passed. Next.js still prints the existing warning that the Next.js ESLint plugin was not detected.
- `pnpm desktop:build` - passed.
- `pnpm desktop:package` - passed.
- `git diff --check` - passed.
- `pnpm dev` web/daemon smoke - passed on `SYMPHONIA_DAEMON_PORT=4114`, `PORT=3006`, `NEXT_PUBLIC_DAEMON_URL=http://localhost:4114`.
- `pnpm desktop:dev` smoke - passed with `SYMPHONIA_DESKTOP_SETTINGS_DIR=/private/tmp/symphonia-desktop-settings-smoke` and `SYMPHONIA_REPO_ROOT=/Users/diegomarono/symphonía`.

## Milestone 8 Desktop Smoke Result

- Electron desktop dev launched.
- Desktop settings were persisted at `/private/tmp/symphonia-desktop-settings-smoke/settings.json`.
- Desktop-managed daemon responded on `http://127.0.0.1:4100/healthz`.
- Desktop-managed web UI responded on `http://127.0.0.1:3000/issues`.
- Desktop-managed daemon started mock run `05c3e35f-13b8-4e58-b8e5-e98efd03be81`; it reached `succeeded`.
- SIGINT shutdown stopped both desktop-managed localhost ports. A leftover daemon from the earlier pre-fix smoke was explicitly killed and the port was verified closed.

## Milestone 8 Web/Daemon Smoke Result

- `GET /healthz` returned OK.
- `GET /providers` returned Mock, Codex, Claude, and Cursor provider entries.
- `GET /issues` returned mock tracker issues.
- Web `/settings` returned HTTP 200.
- Mock run `ed3d3369-a462-4cbf-8f9c-d3da04f97d8d` reached `succeeded`.
- `GET /runs/:runId/events` returned persisted timeline events.
- `POST /runs/:runId/review-artifacts/refresh` returned local git review artifacts.
- `GET /daemon/status` and `GET /workspaces/cleanup/plan` returned recovery/workspace cleanup state.

## Milestone 8 Packaging Result

- Package artifact: `apps/desktop/out/Symphonia-darwin-arm64/Symphonia.app`.
- Packaging uses `apps/desktop/.desktop-package` as a temporary staged app directory.
- The staged package includes compiled desktop code and runtime `zod`, and excludes local workspace data, SQLite data, package output, and secrets.

## Milestone 8 Settings Location

- Default macOS settings path: `~/Library/Application Support/Symphonia/settings.json`.
- Test smoke path: `/private/tmp/symphonia-desktop-settings-smoke/settings.json`.
- Settings store repository/workflow/workspace/database paths, provider/tracker defaults, cleanup defaults, and integration toggles.
- Settings store env var names such as `LINEAR_API_KEY` and `GITHUB_TOKEN`, not raw API keys.

## Milestone 8 Security Baseline Result

- Electron renderer uses `contextIsolation: true`.
- Renderer `nodeIntegration` is disabled.
- Renderer sandboxing is enabled.
- Preload exposes a narrow `window.symphoniaDesktop` API.
- IPC channels are allowlisted and validated with zod.
- External navigation/new windows are blocked from the app window and opened through `shell.openExternal` only for HTTP(S) URLs.
- Renderer has no direct command execution or arbitrary filesystem read bridge.
- File and directory selection happen through main-process OS dialogs.
- Revealing paths is limited to configured Symphonia paths.

## Milestone 8 Known Limitations

- Code signing is not implemented.
- Notarization is not implemented.
- Auto-update is not implemented.
- Platform installers are not implemented; Milestone 8 produces an unpacked desktop artifact.
- Tauri packaging is deferred.
- The packaged desktop shell uses a local Symphonia repository checkout to start the daemon and web server; fully bundled daemon/web runtime distribution is deferred.
- The desktop app does not reattach to provider processes after daemon restart.
- Real provider availability still depends on local CLI installation and authentication.
- Linear/GitHub credentials still use environment variables by default.
- GitHub PR creation remains deferred.
- GitHub and Linear writes remain disabled by default.
- Workspace cleanup remains manual and policy-gated.
- Cloud accounts and multi-tenancy are not implemented.

## Milestone 8 Recommended Next Milestone

Milestone 9 - Add guided harness builder and agent-readiness scoring for repositories.

## Milestone 7 Objective

Add daemon restart reconstruction, durable run recovery, and safe workspace cleanup policies while preserving Mock/Codex/Claude/Cursor providers, Mock/Linear trackers, GitHub review artifacts, `WORKFLOW.md` runtime, workspaces, hooks, SQLite/SSE, UI run controls, and all previous milestone behavior. The daemon should restart cleanly, reconstruct historical runs from SQLite, mark interrupted in-flight runs safely, rebuild issue/workspace status, expose recovery state in the UI, support cleanup previews, and keep destructive cleanup disabled unless explicitly configured and confirmed.

## Milestone 7 Starting Repo State

- Branch at start: `milestone-6-cli-providers...origin/milestone-6-cli-providers`, clean working tree.
- Current baseline commit at branch start: `df21109` (`Cleanup deletions in TanStack/Vite-looking app`), which sits on top of Milestone 6 commit `00b106e`.
- Milestone 7 branch: `milestone-7-recovery-cleanup`.
- Root `WORKFLOW.md` remains safe in mock tracker/provider mode by default and must stay that way.
- Existing Milestone 6 behavior present: Mock/Codex/Claude/Cursor provider selection, Mock/Linear trackers, workflow parser/runtime, workspace manager, hooks, SQLite run events, SSE streams, approvals, stop/retry, GitHub review artifacts, provider health, tracker status, and UI provider/timeline/review panels.

## Milestone 7 Planned Checkpoints

1. Add a durable SQLite run registry with recovery fields while keeping append-only run events unchanged.
2. Reconstruct persisted runs on daemon startup, mark prior non-terminal runs interrupted/orphaned, append recovery events, and preserve terminal runs.
3. Recover stale pending approvals safely so old Codex approvals are not actionable after restart.
4. Add workspace inventory rebuilt from disk with active/recent/orphan/protection status.
5. Extend `WORKFLOW.md` workspace cleanup policy with disabled/dry-run/manual defaults.
6. Add a pure cleanup planner that previews candidates and protections without deleting files.
7. Add manual cleanup execution guarded by policy, explicit confirmation, path containment, symlink safety, and before_remove hooks.
8. Expose daemon/recovery, workspace inventory, cleanup plan, and cleanup execution APIs.
9. Update the UI with recovery status, recovered run badges, workspace inventory, cleanup preview, and gated cleanup execution.
10. Add deterministic restart/recovery, registry, workspace, and cleanup tests using temporary DBs and workspace roots.
11. Document recovery, cleanup policy, API changes, manual validation, and known limitations.
12. Run final validation: `pnpm test`, `pnpm lint`, `pnpm build`, `git diff --check`, and `pnpm dev` smoke.

## Milestone 7 Validation Commands

- `pnpm --filter @symphonia/types test`
- `pnpm --filter @symphonia/core test`
- `pnpm --filter @symphonia/db test`
- `pnpm --filter @symphonia/daemon test`
- `pnpm test`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- `pnpm dev` smoke check

## Milestone 7 Recovery Assumptions

- Provider subprocesses from an old daemon instance are not safe to reattach.
- Startup recovery should reconstruct history, mark prior non-terminal runs interrupted by restart, release active claims, preserve events, and allow manual retry.
- Recovery must never turn an interrupted run into success and must never auto-retry by default.
- Stale approvals from prior daemon instances should be visible in history but not actionable.

## Milestone 7 Cleanup Safety Policy

- Cleanup is disabled by default.
- Cleanup planning is preview-only and deletes nothing.
- Cleanup execution requires `workspace.cleanup.enabled: true`, `dry_run: false`, and explicit manual confirmation.
- Active workspaces, recent runs, dirty git workspaces, path traversal targets, symlink escapes, and the workspace root itself are protected by default.
- No automatic workspace deletion is allowed in this milestone.

## Milestone 7 Checkpoint Progress

### Durable Run Registry, Startup Recovery, and Cleanup Core

- Added durable SQLite `run_records` persistence alongside append-only `run_events`.
- Extended run records with tracker/provider metadata, attempts, retry linkage, workspace path, prompt event reference, provider metadata, terminal reason, recovery state, daemon instance ids, and recovery timestamps.
- Daemon startup now generates a daemon instance id, reconstructs persisted run records, preserves terminal runs, marks previous non-terminal runs `interrupted` or `orphaned`, appends `run.recovered`, and keeps old timelines intact.
- Stale pending approval events from recovered runs are marked with `approval.recovered` and `approval.resolved` cancellation events; the restarted daemon does not expose them as pending actions.
- Retry works for recovered runs and marks the previous recovered run `manually_retried`.
- Added workspace cleanup policy schema under `workspace.cleanup`, with disabled/dry-run/manual/protected defaults.
- Added workspace inventory and cleanup planning core logic with active/recent/dirty/orphan/terminal protection and candidate reasons.
- Added manual cleanup execution in the daemon, gated by policy, dry-run, confirmation text, active-run recheck, workspace-root containment, symlink protection, and before_remove hook success.

Validation so far:

- `pnpm --filter @symphonia/types build` - passed.
- `pnpm --filter @symphonia/core build` - passed.
- `pnpm --filter @symphonia/db build` - passed.
- `pnpm --filter @symphonia/daemon build` - passed.
- `pnpm --filter @symphonia/types test` - passed; 9 tests.
- `pnpm --filter @symphonia/core test` - passed; 103 tests.
- `pnpm --filter @symphonia/db test` - passed; 6 tests.
- `pnpm --filter @symphonia/daemon test` - passed; 27 tests.

## Milestone 7 Final Status

Milestone 7 is implemented and validated. Symphonia now persists durable run records, reconstructs historical runs on daemon startup, marks old active runs interrupted/orphaned with recovery events, makes stale approvals non-actionable, supports manual retry of recovered runs, rebuilds workspace inventory from disk, previews cleanup plans, and executes cleanup only when explicitly enabled, non-dry-run, confirmed, and safe.

Root `WORKFLOW.md` remains mock-safe by default. Workspace cleanup is present but disabled and dry-run by default.

## Milestone 7 Implemented Files and Directories

- `README.md`
- `GOAL_PROGRESS.md`
- `WORKFLOW.md`
- `apps/daemon/src/daemon.ts`
- `apps/daemon/test/http.test.ts`
- `apps/web/components/issues-view.tsx`
- `apps/web/lib/api.ts`
- `packages/core/src/index.ts`
- `packages/core/src/run-state.ts`
- `packages/core/src/workflow.ts`
- `packages/core/src/workspace-cleanup.ts`
- `packages/core/test/workflow.test.ts`
- `packages/core/test/workspace-cleanup.test.ts`
- `packages/db/src/event-store.ts`
- `packages/db/test/event-store.test.ts`
- `packages/types/src/index.ts`

## Milestone 7 Final Command Results

- `pnpm --filter @symphonia/types build` - passed.
- `pnpm --filter @symphonia/core build` - passed.
- `pnpm --filter @symphonia/db build` - passed.
- `pnpm --filter @symphonia/daemon build` - passed.
- `pnpm --filter @symphonia/web build` - passed.
- `pnpm --filter @symphonia/types test` - passed; 9 tests.
- `pnpm --filter @symphonia/core test` - passed; 104 tests.
- `pnpm --filter @symphonia/db test` - passed; 6 tests.
- `pnpm --filter @symphonia/daemon test` - passed; 27 tests.
- `pnpm test` - passed; 146 total tests across types/core/db/daemon.
- `pnpm lint` - passed.
- `pnpm build` - passed. Next.js still prints the existing warning that the Next.js ESLint plugin was not detected.
- `git diff --check` - passed.
- `pnpm dev` smoke - passed on `SYMPHONIA_DAEMON_PORT=4113`, `PORT=3005`, `NEXT_PUBLIC_DAEMON_URL=http://localhost:4113`. The first sandboxed attempt failed because `tsx watch` could not create its IPC pipe; rerunning outside the sandbox succeeded.

## Milestone 7 Recovery Test Results

- DB tests cover durable run save/fetch/update.
- Daemon tests cover active persisted run reconstruction after simulated restart.
- Startup recovery marks old active runs `interrupted` with `recoveryState: interrupted_by_restart`.
- Terminal succeeded runs remain unchanged after restart.
- Recovery appends `run.recovered`.
- Retry of a recovered run succeeds and marks the old run `manually_retried`.
- Pending Codex approvals from a prior daemon instance are recovered/cancelled and are not exposed as pending.

## Milestone 7 Workspace Cleanup Validation Results

- Core tests cover empty inventory, active/recent protection, old terminal candidates, cleanup-disabled protection, and dirty-git protection.
- Daemon tests cover `/daemon/status`, inventory, dry-run cleanup no deletion, and confirmed cleanup deletion when policy allows it.
- Dev smoke verified `GET /workspaces` and `GET /workspaces/cleanup/plan`; the committed root workflow reports cleanup disabled/dry-run/manual-confirmation required.

## Milestone 7 Provider Regression Validation

- Mock provider run succeeded in tests and dev smoke.
- Codex fake app-server tests still pass, including approvals and interrupt behavior.
- Claude fake CLI tests still pass.
- Cursor fake CLI tests still pass.
- Linear fake tests still pass.
- GitHub review artifact fake/local tests still pass, and review artifacts refreshed after the dev smoke mock run.

## Milestone 7 How To Inspect Recovery State

- Use `GET /daemon/status` or `GET /recovery/status` for daemon instance id, startup time, recovered/orphaned/active run counts, safe DB path, workspace root, workflow status, tracker status, and provider summary.
- Use `GET /runs` to list reconstructed run records.
- Use `GET /runs/:runId/events` to inspect `run.recovered`, `approval.recovered`, and persisted historical events.
- In the UI, open the Workflow panel for recovery counts and open a run detail to see recovery state and recovery timeline events.

## Milestone 7 How To Retry Recovered Runs

- Open a recovered/interrupted/orphaned run in the UI and click Retry run.
- Or call `POST /runs/:runId/retry`.
- Symphonia does not auto-retry after restart.

## Milestone 7 How To Preview Workspace Cleanup

- Use `GET /workspaces` or `POST /workspaces/refresh` to rebuild inventory.
- Use `GET /workspaces/cleanup/plan` to preview candidates, protected workspaces, reasons, warnings, and estimated bytes.
- In the UI, open the Workflow panel, click Refresh inventory, then Preview cleanup.

## Milestone 7 How To Execute Cleanup Safely

- Keep cleanup disabled/dry-run by default.
- For a safe local test only, configure `workspace.cleanup.enabled: true` and `workspace.cleanup.dry_run: false`.
- Preview first.
- Execute with `POST /workspaces/cleanup/execute` and confirmation `delete workspaces`, or use the UI confirmation input.
- Active workspaces, dirty git workspaces, recent runs, path escapes, symlink escapes, and the workspace root remain protected by default.

## Milestone 7 Known Limitations

- Real provider process reattachment after daemon restart is not implemented.
- Codex/Claude/Cursor resume or continue after restart is not implemented.
- Automatic retry after restart is disabled by default.
- Automatic workspace deletion is disabled by default.
- Cleanup execution is manual and policy-gated.
- GitHub PR creation remains deferred.
- GitHub writes remain disabled by default.
- Linear writes remain disabled/deferred.
- Electron/Tauri packaging is not implemented.
- Multi-machine or distributed daemon recovery is not implemented.
- Cloud multi-tenancy is not implemented.

## Milestone 7 Recommended Next Milestone

Milestone 8 - Package Symphonia as a local desktop app with first-run setup and settings.

## Milestone 6 Objective

Add Claude Code and Cursor Agent provider adapters through the established provider interface while preserving Mock provider, Codex provider, Mock tracker, Linear tracker, GitHub review artifacts, `WORKFLOW.md` runtime, workspace lifecycle, hooks, SQLite/SSE, approvals, stop/retry, and UI behavior. Users should be able to select Mock, Codex, Claude, or Cursor from the UI, run Claude/Cursor against mock or Linear issues, stream provider events into the timeline, stop/retry runs, persist events, refresh review artifacts after completion, and validate without requiring real Claude or Cursor credentials.

## Milestone 6 Starting Repo State

- Branch at start: `milestone-5-github-review-artifacts...origin/milestone-5-github-review-artifacts`, clean working tree.
- Milestone 5 checkpoint commit: `bc4c152` (`Add GitHub review artifacts`).
- Milestone 6 branch: `milestone-6-cli-providers`.
- `main` is still behind the Milestone 4/5 branches in this checkout, so Milestone 6 is intentionally based on the committed Milestone 5 branch to preserve the GitHub review-artifact baseline.
- Root `WORKFLOW.md` remains in safe mock tracker mode by default and should stay that way.
- Existing Milestone 5 behavior present: mock tracker, Linear tracker, mock provider, Codex provider, workflow parsing, workspace manager, hooks, SQLite event/issue/review-artifact persistence, SSE event streams, provider health for mock/Codex, approvals, stop/retry, tracker status/health/refresh, polling/reconciliation, GitHub status/health, and review artifact UI.

## Milestone 6 Planned Checkpoints

1. Extend provider IDs, shared schemas, workflow config resolution, safe summaries, and docs progress for Claude and Cursor config.
2. Add a shared CLI stream runner that spawns commands without a shell, parses NDJSON, captures stderr diagnostics, handles timeouts/abort, bounds payloads, and avoids secret exposure.
3. Implement Claude Code provider command building, health, stream-json mapping, stop/retry behavior, and fake CLI tests.
4. Implement Cursor Agent provider command building, health, stream-json mapping, stop/retry behavior, and fake CLI tests.
5. Update provider health APIs and provider list to include mock, Codex, Claude, and Cursor with safe config summaries.
6. Wire Claude/Cursor into daemon run lifecycle, SSE event persistence, retry/stop, Linear reconciliation cancellation, and review artifact refresh after completion.
7. Represent Claude/Cursor pre-run permissions clearly while keeping Codex live approvals unchanged.
8. Update the UI provider selector, provider status panel, run cards, run detail metadata, and timeline rendering for Claude/Cursor events.
9. Keep root `WORKFLOW.md` safe and update README examples/troubleshooting for Claude/Cursor.
10. Add deterministic tests using fake CLI scripts; no real Claude, Cursor, Anthropic, Cursor, Linear, GitHub, OpenAI, or network credentials required.
11. Perform manual provider validation only if local `claude` and/or `cursor-agent` commands and auth are available.
12. Run final validation: `pnpm test`, `pnpm lint`, `pnpm build`, `git diff --check`, and `pnpm dev` smoke.

## Milestone 6 Validation Commands

- `pnpm --filter @symphonia/types test`
- `pnpm --filter @symphonia/core test`
- `pnpm --filter @symphonia/daemon test`
- `pnpm test`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- `pnpm dev` smoke check

## Milestone 6 External Dependency Notes

- Real Claude manual validation requires a local Claude Code CLI installation and local authentication.
- Real Cursor manual validation requires a local Cursor Agent CLI installation and local authentication or `CURSOR_API_KEY`.
- Automated tests must not require real Claude/Cursor credentials, real provider APIs, network access, Linear credentials, GitHub credentials, or OpenAI/Codex credentials.
- Claude/Cursor must use safe permission defaults; do not enable dangerous Claude skip-permissions or Cursor force mode by default.
- Claude/Cursor live approval protocols are out of scope; Codex app-server approvals remain the only live approval flow.
- GitHub PR creation, auto-push, auto-merge, comments, and Linear writes remain out of scope.

## Milestone 6 Checkpoint Progress

### Starting State Recorded

- Verified the Milestone 5 branch is clean and committed at `bc4c152`.
- Created branch `milestone-6-cli-providers` from the Milestone 5 baseline.
- Verified root `WORKFLOW.md` remains mock by default.
- Checked current official CLI references for command-shape assumptions:
  - Claude Code CLI supports `-p/--print`, `--output-format text|json|stream-json`, `--max-turns`, `--model`, `--permission-mode`, `--allowedTools`, `--disallowedTools`, `--append-system-prompt`, `--resume`, and `--continue`.
  - Cursor Agent CLI supports `--print`, `--output-format text|json|stream-json`, `--api-key`, `CURSOR_API_KEY`, `--resume`, `--model`, and `--force`, with `stream-json` as the default print-mode output format.

### Provider Config, CLI Runner, and Adapter Slice

- Extended shared provider IDs to `mock | codex | claude | cursor`.
- Added Claude and Cursor workflow config schemas with safe defaults, command/model settings, stream output format, timeouts, extra args, env maps, redacted env keys, and provider-specific permission flags.
- Extended workflow config resolution and summaries for Claude/Cursor without exposing env values or secrets.
- Added Claude/Cursor timeline event schemas for system init, assistant/user messages, tool events, results, usage, and provider errors.
- Added a shared CLI stream runner that spawns commands without a shell, writes prompts through stdin, parses NDJSON, captures stderr diagnostics, enforces read/stall/total timeouts, supports abort cleanup, and bounds large line payloads.
- Implemented Claude Code provider command building, health checks, stream mapping, stop/cancel handling, and fake CLI tests.
- Implemented Cursor Agent provider command building, health checks, stream mapping, stop/cancel handling, and fake CLI tests.
- Wired daemon provider health and run lifecycle to recognize Claude and Cursor.
- Added daemon tests for Claude fake CLI runs, Cursor fake CLI runs, stop/cancel, retry with current workflow config, and review artifact refresh after provider completion.

Validation so far:

- `pnpm --filter @symphonia/types build` - passed.
- `pnpm --filter @symphonia/core build` - passed.
- `pnpm --filter @symphonia/daemon build` - passed.
- `pnpm --filter @symphonia/types test` - passed; 9 tests.
- `pnpm --filter @symphonia/core test` - passed; 98 tests.
- `pnpm --filter @symphonia/daemon test` - passed; 22 tests.

## Milestone 6 Final Status

Milestone 6 is implemented and validated. Symphonia now supports four provider IDs: `mock`, `codex`, `claude`, and `cursor`. Mock and Codex behavior remain intact, Claude and Cursor are optional CLI-stream providers, root `WORKFLOW.md` remains safe in mock mode, and automated tests use fake CLI scripts rather than real Claude/Cursor credentials.

Claude and Cursor live approvals are intentionally not modeled as Codex app-server approvals. Codex remains the live approval provider. Claude and Cursor expose pre-run permission/configuration status and surface permission failures as provider diagnostics or errors.

## Milestone 6 Implemented Files and Directories

- `README.md`
- `GOAL_PROGRESS.md`
- `apps/daemon/src/daemon.ts`
- `apps/daemon/test/http.test.ts`
- `apps/web/components/issues-view.tsx`
- `packages/core/src/claude-provider.ts`
- `packages/core/src/cli-stream-runner.ts`
- `packages/core/src/command-utils.ts`
- `packages/core/src/cursor-provider.ts`
- `packages/core/src/index.ts`
- `packages/core/src/provider.ts`
- `packages/core/src/workflow.ts`
- `packages/core/test/cli-providers.test.ts`
- `packages/core/test/cli-stream-runner.test.ts`
- `packages/core/test/workflow.test.ts`
- `packages/types/src/index.ts`
- `packages/types/test/schemas.test.ts`

## Milestone 6 Final Command Results

- `pnpm --filter @symphonia/types build` - passed.
- `pnpm --filter @symphonia/core build` - passed.
- `pnpm --filter @symphonia/daemon build` - passed.
- `pnpm --filter @symphonia/types test` - passed; 9 tests.
- `pnpm --filter @symphonia/core test` - passed; 98 tests.
- `pnpm --filter @symphonia/daemon test` - passed; 22 tests.
- `pnpm test` - passed; packages rebuilt and 134 total tests passed across types/core/db/daemon.
- `pnpm lint` - passed.
- `pnpm build` - passed. Next.js still prints the existing warning that the Next.js ESLint plugin was not detected.
- `git diff --check` - passed.
- `pnpm dev` smoke - passed on alternate ports with `SYMPHONIA_DAEMON_PORT=4112`, `PORT=3004`, and `NEXT_PUBLIC_DAEMON_URL=http://localhost:4112`. Verified daemon health, web `/issues` HTTP 200, provider list including mock/Codex/Claude/Cursor, mock issues, mock run success, persisted run events, review artifact fetch, and manual review artifact refresh.

## Milestone 6 Fake Provider Validation Results

- Fake Claude CLI tests cover command health available/unavailable, system init mapping, assistant message mapping, tool event mapping, result success, result error, nonzero exit, cancellation, and event persistence through daemon run lifecycle.
- Fake Cursor CLI tests cover command health available/unavailable, system init mapping, assistant deltas/messages, tool call/result mapping, result success, result failure, nonzero exit, cancellation, and event persistence through daemon run lifecycle.
- Shared CLI stream runner tests cover successful NDJSON streams, stderr diagnostics, malformed JSON diagnostics, nonzero exit, read timeout, abort cleanup, and large-line truncation.
- Daemon tests cover provider health for all four providers, Claude/Cursor fake runs, stop/cancel, retry against the current workflow, and review artifact refresh after Claude/Cursor completion.
- Existing mock provider, Codex fake app-server, Linear fake tracker, GitHub fake client, SQLite persistence, and SSE/event lifecycle tests remain green.

## Milestone 6 Real Provider Validation Results

Claude Code:

- `claude` is installed at `/Users/diegomarono/.local/bin/claude`.
- `claude --version` returned `2.1.126 (Claude Code)`.
- Direct CLI smoke showed that installed Claude Code requires `--verbose` with `--output-format stream-json` in print mode; the Claude provider now adds `--verbose` automatically for stream-json unless already supplied.
- A real Claude run was not completed because the CLI reported no active login: `Not logged in - Please run /login`. The sandbox also blocked a Claude hook directory write under `~/.claude`. Automated fake CLI validation remains complete.

Cursor Agent:

- `cursor-agent` was not found on `PATH`.
- Real Cursor validation was not performed. Automated fake CLI validation remains complete.

No provider credentials, tokens, API keys, or environment values were written to logs, docs, UI payloads, or persisted artifacts.

## Milestone 6 How To Run Providers

Mock provider:

1. Keep root `WORKFLOW.md` as committed.
2. Run `pnpm dev`.
3. Open `http://localhost:3000/issues`.
4. Select `Mock` and start a run from any mock issue.

Codex provider:

1. Ensure the Codex app-server command in `WORKFLOW.md` is available.
2. Run `pnpm dev`.
3. Select `Codex` from the provider selector.
4. Start a run. Codex live approval requests continue to appear through the existing approval UI.

Claude provider:

1. Install and authenticate Claude Code locally.
2. Add or use a local workflow override with `claude.enabled: true`.
3. Keep `output_format: "stream-json"` and safe `permission_mode`/tool allowlists.
4. Run `pnpm dev`, select `Claude Code`, and start a run.

Cursor provider:

1. Install and authenticate Cursor Agent locally, or set `CURSOR_API_KEY`.
2. Add or use a local workflow override with `cursor.enabled: true`.
3. Keep `force: false` unless intentionally testing force mode.
4. Run `pnpm dev`, select `Cursor Agent`, and start a run.

## Milestone 6 Provider Permission Behavior

- Codex uses the existing app-server approval protocol and can surface live approval requests.
- Claude uses pre-run CLI configuration: `permission_mode`, `allowed_tools`, `disallowed_tools`, and optional extra args.
- Cursor uses pre-run CLI configuration and `force` remains disabled by default.
- Claude/Cursor permission denials are surfaced as stderr/result diagnostics and provider errors; the UI does not imply live approval requests exist for those providers.

## Milestone 6 Known Limitations

- Claude/Cursor live approval protocols are not implemented like Codex app-server approvals.
- Claude/Cursor continuation/resume is stored only as metadata when emitted; automatic resume/continue is not implemented.
- Real Claude validation depends on local Claude Code installation and authentication.
- Real Cursor validation depends on local Cursor Agent installation and authentication or `CURSOR_API_KEY`.
- Provider stream event mapping covers the practical Milestone 6 subset and may need expansion as real CLI event shapes evolve.
- GitHub PR creation remains deferred.
- GitHub writes remain disabled by default.
- Linear writes remain disabled/deferred.
- Electron/Tauri packaging is not implemented.
- Daemon restart reconstruction of active provider processes remains incomplete.
- Workspace cleanup remains manual.

## Milestone 6 Recommended Next Milestone

Milestone 7 - Add daemon restart reconstruction, run recovery, and workspace cleanup policies.

## Milestone 5 Objective

Add GitHub as the first review-artifact integration while preserving mock tracker, Linear tracker, mock provider, Codex provider, `WORKFLOW.md` runtime, workspace lifecycle, hooks, SQLite/SSE event flow, approvals, stop/retry, and UI behavior. The milestone is read-first: users should be able to inspect local git status, changed files, branch metadata, matching GitHub PRs, PR files, combined commit status, check runs, and workflow runs from the run detail view. GitHub writes must remain disabled by default, with PR creation either safely gated behind explicit config or explicitly deferred.

## Milestone 5 Starting Repo State

- Branch at start: `milestone-4-linear-tracker...origin/milestone-4-linear-tracker`, clean working tree.
- Milestone 4 checkpoint commit: `d7a1c38` (`Add Linear tracker adapter`).
- Milestone 5 branch: `milestone-5-github-review-artifacts`.
- Root `WORKFLOW.md` is in safe mock tracker mode by default and should stay that way.
- Existing Milestone 4 behavior present: mock tracker, Linear tracker, mock provider, Codex provider, workflow parsing, workspace manager, hooks, SQLite event and issue-cache persistence, SSE run event streams, provider health, approvals, stop/retry, tracker status/health, issue refresh/cache, polling, reconciliation, and UI tracker controls.

## Milestone 5 Planned Checkpoints

1. Add shared review-artifact schemas for GitHub config, git repository state, changed files, diffs, PR summaries, commit status, check runs, workflow runs, snapshots, and GitHub event variants.
2. Extend `WORKFLOW.md` config resolution with optional GitHub settings, token environment indirection, redacted summaries, pagination bounds, and write guards.
3. Implement a local git inspector that works without GitHub credentials and handles non-git, clean, dirty, untracked, branch, diff, timeout, and failure cases.
4. Implement a small GitHub REST client with injectable fetch, auth headers, pagination, rate-limit diagnostics, PR/status/check/workflow operations, and write guards.
5. Build a review artifact service that combines local git inspection and optional GitHub API data into bounded `ReviewArtifactSnapshot` payloads and append-only events.
6. Persist latest review snapshots in SQLite and expose daemon endpoints for GitHub status/health and run review artifact fetch/refresh.
7. Refresh review artifacts after run completion/failure/cancel where possible and keep refresh failures non-fatal.
8. Keep PR creation disabled by default; implement only if it stays safely user-triggered and gated.
9. Update the UI with GitHub status, local git metadata, changed files, PR summaries, commit status, check runs, workflow runs, refresh controls, and optional gated PR creation state.
10. Update README examples and keep root `WORKFLOW.md` mock/GitHub-disabled by default.
11. Add deterministic tests that do not require GitHub, Linear, network, or real Codex credentials.
12. Run full validation: `pnpm test`, `pnpm lint`, `pnpm build`, `git diff --check`, and `pnpm dev` smoke.

## Milestone 5 Validation Commands

- `pnpm --filter @symphonia/types test`
- `pnpm --filter @symphonia/core test`
- `pnpm --filter @symphonia/db test`
- `pnpm --filter @symphonia/daemon test`
- `pnpm test`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- `pnpm dev` smoke check

## Milestone 5 External Dependency Notes

- Real GitHub manual validation requires `GITHUB_TOKEN` or `GITHUB_PAT` with access to the configured repository.
- Automated tests must not require GitHub credentials, Linear credentials, network access, or real Codex/OpenAI credentials.
- Local git artifact collection should work without a GitHub token.
- GitHub writes must remain disabled unless explicitly configured and user-triggered.
- GitHub webhooks, OAuth, GitHub App installation flow, auto-merge, and auto-push are out of scope.

## Milestone 5 Checkpoint Progress

### Review Artifact Types, Config, and Core Client Slice

- Added shared review artifact schemas and event variants for GitHub health, local git detection, git diffs, PR lookup, PR files, commit status, check runs, workflow runs, refresh snapshots, and GitHub errors.
- Added optional `github` workflow config resolution with `token` env indirection, safe redacted summaries, default `read_only: true`, default `write.enabled: false`, owner/repo validation, pagination bounds, and write guard validation.
- Kept root `WORKFLOW.md` untouched and safe in mock tracker mode.
- Implemented a local git inspector using `git` argument arrays rather than shell strings. It handles non-git workspaces, clean repos, dirty files, untracked files, branch/head/base detection, merge base fallback, local diff summaries, bounded per-file patches, and credential redaction in remote URLs.
- Implemented a small GitHub REST client with injectable `fetch`, repo health, PR lookup, PR files, compare summaries, combined commit status, check runs, workflow runs, rate-limit diagnostics, pagination, and guarded PR creation.
- Implemented a review artifact refresh service that combines local git artifacts with optional GitHub API data and returns partial snapshots on GitHub failures instead of crashing.

Validation so far:

- `pnpm --filter @symphonia/types build` - passed.
- `pnpm --filter @symphonia/types test` - passed; 9 tests.
- `pnpm --filter @symphonia/core test` - passed; 79 tests.
- `pnpm --filter @symphonia/core build` - passed.
- `pnpm --filter @symphonia/db build` - passed.
- `pnpm --filter @symphonia/db test` - passed; 5 tests.
- `pnpm --filter @symphonia/daemon test` - passed; 18 tests.
- `pnpm --filter @symphonia/web lint` - passed.

### Daemon Persistence and UI Slice

- Added SQLite persistence for latest review artifact snapshots by run, issue id, and issue identifier.
- Added daemon GitHub status/health APIs and run/issue review artifact fetch/refresh APIs.
- Wired review artifact refresh into the run lifecycle after workspace preparation and after provider completion/failure/cancel where a workspace exists.
- Review artifact refresh emits append-only events and stores snapshots without replacing terminal provider status.
- Manual review artifact refresh uses the same event stream and persistence path.
- Added web client calls for GitHub status and review artifact fetch/refresh.
- Added a GitHub status indicator and GitHub config/read-only/write status to the workflow panel.
- Added a Review Artifacts section to run details with local git metadata, changed files, patch previews, PR metadata, combined status, check runs, workflow runs, and manual refresh.
- PR creation remains deferred for Milestone 5 to keep the read-first artifact path stable; GitHub writes remain disabled by default.

## Milestone 5 Final Status

Milestone 5 is implemented and validated. Mock tracker mode remains the safe root `WORKFLOW.md` default. GitHub is optional, read-first, and disabled unless configured. GitHub writes and PR creation are deferred; no automatic push, PR creation, comments, reviewer requests, merge, or other GitHub mutations are performed.

## Milestone 5 Implemented Files and Directories

- `README.md`
- `GOAL_PROGRESS.md`
- `apps/daemon/src/daemon.ts`
- `apps/daemon/test/http.test.ts`
- `apps/web/components/issues-view.tsx`
- `apps/web/lib/api.ts`
- `packages/core/src/git-inspector.ts`
- `packages/core/src/github-client.ts`
- `packages/core/src/review-artifacts.ts`
- `packages/core/src/workflow.ts`
- `packages/core/src/index.ts`
- `packages/core/test/git-inspector.test.ts`
- `packages/core/test/github-client.test.ts`
- `packages/core/test/review-artifacts.test.ts`
- `packages/core/test/workflow.test.ts`
- `packages/db/src/event-store.ts`
- `packages/db/test/event-store.test.ts`
- `packages/types/src/index.ts`
- `packages/types/test/schemas.test.ts`

## Milestone 5 Final Command Results

- `pnpm --filter @symphonia/types build` - passed.
- `pnpm --filter @symphonia/types test` - passed; 9 tests.
- `pnpm --filter @symphonia/core test` - passed; 79 tests.
- `pnpm --filter @symphonia/core build` - passed.
- `pnpm --filter @symphonia/db build` - passed.
- `pnpm --filter @symphonia/db test` - passed; 5 tests.
- `pnpm --filter @symphonia/daemon test` - passed; 18 tests.
- `pnpm --filter @symphonia/web lint` - passed.
- `pnpm test` - passed; packages rebuilt and 111 total tests passed across types/core/db/daemon.
- `pnpm lint` - passed.
- `pnpm build` - passed. Next.js still prints the existing warning that the Next.js ESLint plugin was not detected.
- `git diff --check` - passed.
- `pnpm dev` smoke - passed on alternate ports with `SYMPHONIA_DAEMON_PORT=4110`, `PORT=3002`, and `NEXT_PUBLIC_DAEMON_URL=http://localhost:4110` after the default ports were already in use. Verified daemon health, web `/issues` HTTP 200, mock issues, mock run success, persisted events, and review artifact fetch/refresh endpoints.

## Milestone 5 Fake and Local Validation Results

- Fake GitHub REST client tests cover repo health, unauthorized/not found/rate-limit responses, pagination, PR lookup, PR files, compare summaries, combined commit status, check runs, workflow runs, and guarded PR creation.
- Local git inspector tests cover non-git workspace, clean repo, modified file, untracked file, branch/head/base detection, and merge-base fallback.
- Review artifact service tests cover local-only snapshots, missing-token local fallback, GitHub-backed snapshots, no PR found, and partial GitHub API failure.
- Daemon tests cover GitHub status/health, persisted review artifacts, review artifact endpoints, mock/Linear/Codex regressions, stop/retry, approvals, and terminal Linear reconciliation.

## Milestone 5 Real GitHub Validation Result

Real GitHub read-only validation was performed because `GITHUB_TOKEN` was available in the environment. A temporary ignored workflow override enabled GitHub read-only mode for `agora-creations/symphonia`; the root `WORKFLOW.md` was not changed.

- `GET /github/status` showed GitHub enabled with token configured and no secret exposed.
- `GET /github/health` succeeded and returned safe rate-limit diagnostics.
- A mock provider run succeeded with GitHub enabled.
- Review artifact events recorded local git state, changed files, GitHub health, no matching PR for branch `milestone-5-github-review-artifacts`, combined commit status, zero check runs, zero workflow runs, and a persisted snapshot.
- Manual `POST /runs/:runId/review-artifacts/refresh` succeeded.
- No GitHub writes occurred; `read_only: true` and `write.enabled: false` remained active.

## Milestone 5 How To Run

Mock tracker mode:

1. Keep root `WORKFLOW.md` as committed.
2. Run `pnpm dev`.
3. Open `http://localhost:3000/issues`.
4. Start Mock or Codex runs from mock issue cards.

Linear tracker mode:

1. Export `LINEAR_API_KEY`.
2. Use a local workflow override with `tracker.kind: linear`, `api_key: "$LINEAR_API_KEY"`, and a team/project filter.
3. Run `SYMPHONIA_WORKFLOW_PATH=/absolute/path/to/linear.WORKFLOW.md pnpm dev`.
4. Click Refresh issues, then start Mock or Codex runs from Linear cards.

GitHub read-only review artifacts:

1. Export `GITHUB_TOKEN` or `GITHUB_PAT`.
2. Use a local workflow override with `github.enabled: true`, `github.token: "$GITHUB_TOKEN"`, owner/repo, and `read_only: true`.
3. Run `SYMPHONIA_WORKFLOW_PATH=/absolute/path/to/github.WORKFLOW.md pnpm dev`.
4. Start a run, open Run details, and inspect the Review Artifacts section.
5. Click Refresh review artifacts to update local git and GitHub data.

## Milestone 5 Known Limitations

- PR creation is deferred. GitHub writes remain disabled by default and no user-triggered create-PR UI is shipped in Milestone 5.
- Auto-push, auto-merge, GitHub comments, reviewer requests, GitHub OAuth, GitHub App installation flow, and GitHub webhooks are not implemented.
- Claude Code provider is still not implemented.
- Cursor provider is still not implemented.
- Real GitHub validation depends on token/repo access.
- CI/check/workflow visibility depends on GitHub data existing for the branch or head SHA.
- Large diffs are bounded and may be truncated.
- Linear OAuth and Linear webhooks remain unimplemented.
- Daemon restart reconstruction of active runs and approvals is still incomplete.
- Workspace cleanup remains manual.
- Advanced blocker/dependency handling remains partial.

## Recommended Next Milestone

Milestone 6 - Add Claude Code and Cursor provider adapters using the established provider interface.

## Milestone 4 Objective

Add Linear as the first real tracker while preserving mock tracker support, the mock provider, Codex provider, `WORKFLOW.md` runtime, workspace lifecycle, hooks, SQLite/SSE event flow, and UI controls. A user should be able to configure `tracker.kind: linear` with `api_key: "$LINEAR_API_KEY"`, fetch real Linear issues into the board through the daemon, start Mock or Codex runs from those issue cards, reconcile issue state changes through polling, and keep local mock mode safe by default.

## Milestone 4 Starting Repo State

- Branch at start: `main...origin/main`, clean working tree.
- Milestone 4 branch: `milestone-4-linear-tracker`.
- Starting commit for Milestone 4: `8942859`.
- Root `WORKFLOW.md` is in safe mock mode by default and should stay that way.
- Existing Linear support is config-only: `tracker.kind: linear` is partially validated, but the daemon still serves mock issues and run lifecycle resolves issues through the mock tracker.
- Existing Milestone 3 behavior present: mock provider, Codex provider, workflow parsing, workspace manager, hooks, SQLite event persistence, SSE run event streams, provider health, approvals, stop, and retry.

## Milestone 4 Planned Checkpoints

1. Refine the tracker abstraction so mock and Linear trackers share typed capabilities.
2. Extend workflow config resolution for Linear fields, env indirection, validation bounds, read-only defaults, and safe summaries.
3. Use direct GraphQL fetch for Linear behind a small client with fake-fetch tests.
4. Implement Linear issue fetching, pagination, normalization, filtering, sorting, and health checks.
5. Add daemon issue cache, tracker status/health, issue refresh, and safe secret redaction.
6. Add polling and reconciliation so running issues are stopped when tracker state becomes terminal or no longer active.
7. Keep Linear writes disabled by default; defer writes if the read path stability would suffer.
8. Wire run start/retry to tracker-resolved issues for both mock and Linear.
9. Update the UI with tracker status, refresh controls, Linear issue metadata, and tracker timeline details.
10. Update README examples while keeping root `WORKFLOW.md` mock by default.
11. Run automated tests plus lint/build and perform `pnpm dev` smoke validation.

## Milestone 4 Validation Commands

- `pnpm --filter @symphonia/types test`
- `pnpm --filter @symphonia/core test`
- `pnpm --filter @symphonia/daemon test`
- `pnpm test`
- `pnpm lint`
- `pnpm build`
- `pnpm dev` smoke check

## Milestone 4 External Dependency Notes

- Real Linear manual validation requires a valid `LINEAR_API_KEY` and an accessible workspace/team/project filter.
- Automated tests must not require Linear credentials or network access; fake fetch/client coverage is required.
- Linear webhooks are intentionally out of scope because the current app is local-first and webhooks require a publicly reachable HTTPS endpoint.
- Linear writes must remain disabled unless explicitly configured and tested.

## Milestone 4 Checkpoint Progress

### Backend Tracker and Cache Slice

- Added shared Linear-capable tracker config fields with env-resolved `api_key`, team/project scope fields, active/terminal states, pagination bounds, polling interval override, read-only default, and write flags.
- Kept workflow config summaries redacted; summaries do not include `apiKey` or resolved secrets.
- Chose direct GraphQL fetch for Linear. This keeps the adapter small, fakeable in tests, and avoids coupling Milestone 4 to the Linear SDK.
- Added a `LinearGraphqlClient` with injectable `fetch`, viewer health check, issue pagination, single issue fetch, guarded write methods, GraphQL error handling, HTTP error handling, and network error handling.
- Added tracker helpers and adapters for mock and Linear, including state normalization, active/terminal filtering, priority sorting, source metadata, and read-only write protection.
- Added SQLite issue cache support with upsert/list/get-by-id/get-by-identifier/stats.
- Added daemon `/tracker/status`, `/tracker/health`, `/issues`, `/issues/refresh`, `/issues/:issueId`, and `/issues/by-identifier/:identifier` behavior.
- Wired run start/retry to tracker-resolved issues while preserving invalid-workflow behavior where a run is queued and then fails inside lifecycle.
- Added polling timer setup and reconciliation that interrupts active runs when refreshed tracker state becomes terminal or no longer active.
- Added fake Linear daemon tests for refresh, cache, mock run from Linear issue, Codex run from Linear issue, and terminal-state reconciliation.

Validation so far:

- `pnpm --filter @symphonia/types test` - passed; 8 tests.
- `pnpm --filter @symphonia/types build` - passed.
- `pnpm --filter @symphonia/core test` - passed; 60 tests.
- `pnpm --filter @symphonia/db test` - passed; 4 tests.
- `pnpm --filter @symphonia/core build` - passed.
- `pnpm --filter @symphonia/db build` - passed.
- `pnpm --filter @symphonia/daemon test` - passed; 15 tests.

Notes:

- Linear personal API keys are sent as the raw `Authorization` header value, matching Linear's public docs for personal API key auth. OAuth bearer tokens remain a later milestone.
- Advanced Linear blocker/dependency handling is not implemented yet; issue selection handles active/terminal states and duplicate active runs.

## Milestone 4 Final Status

Milestone 4 is implemented and validated with fake Linear coverage. Mock tracker mode remains the safe default in root `WORKFLOW.md`; Linear mode is documented separately in `README.md`.

## Milestone 4 Implemented Files and Directories

- `README.md`
- `GOAL_PROGRESS.md`
- `apps/daemon/src/daemon.ts`
- `apps/daemon/test/http.test.ts`
- `apps/web/components/issues-view.tsx`
- `apps/web/lib/api.ts`
- `packages/core/src/tracker.ts`
- `packages/core/src/linear-client.ts`
- `packages/core/src/linear-tracker.ts`
- `packages/core/src/workflow.ts`
- `packages/core/src/index.ts`
- `packages/core/test/linear-tracker.test.ts`
- `packages/core/test/workflow.test.ts`
- `packages/db/src/event-store.ts`
- `packages/db/test/event-store.test.ts`
- `packages/types/src/index.ts`
- `packages/types/test/schemas.test.ts`

## Milestone 4 Final Command Results

- `pnpm --filter @symphonia/types test` - passed; 8 tests.
- `pnpm --filter @symphonia/types build` - passed.
- `pnpm --filter @symphonia/core test` - passed; 60 tests.
- `pnpm --filter @symphonia/db test` - passed; 4 tests.
- `pnpm --filter @symphonia/core build` - passed.
- `pnpm --filter @symphonia/db build` - passed.
- `pnpm --filter @symphonia/daemon test` - passed; 15 tests.
- `pnpm --filter @symphonia/web lint` - passed.
- `pnpm test` - passed; packages rebuilt, 87 total tests passed across types/core/db/daemon.
- `pnpm lint` - passed.
- `pnpm build` - passed. Next.js still prints the existing warning that the Next.js ESLint plugin was not detected.
- `git diff --check` - passed.

## Milestone 4 Smoke Validation Results

- `pnpm dev` started the daemon on `http://localhost:4100` and web on `http://localhost:3000`.
- `GET /healthz` returned `ok`.
- `GET /workflow/status` returned healthy root `WORKFLOW.md` with `trackerKind: mock`.
- `GET /tracker/status` returned mock tracker healthy and a redacted safe config summary.
- `GET /issues` returned mock issues with tracker metadata and `lastFetchedAt`.
- `GET /tracker/status` after issue load returned `issueCount: 8`.
- Web route `http://localhost:3000/issues` returned HTTP 200.
- Started a mock run for `issue-daemon-api`; it reached `succeeded`.
- Fetched the run events and confirmed workflow, workspace, prompt, hook, mock provider, usage, artifact, and persisted timeline events.
- The dev server was stopped after smoke validation; the final dev command session ended with expected process termination after the smoke checks.

## Milestone 4 Fake Linear Validation Results

- Fake fetch tests cover Linear viewer health success.
- Fake fetch tests cover invalid credential-like GraphQL errors.
- Fake fetch tests cover network failure handling.
- Fake fetch tests cover paginated issue fetching and max-page truncation.
- Fake fetch tests cover issue normalization, priority mapping, label lowercasing, team/project metadata, and source metadata.
- Fake fetch tests cover active-state filtering, terminal-state exclusion, sorting, and duplicate active-run prevention.
- Fake daemon tests cover tracker status, Linear setup errors without secret exposure, issue refresh/cache, Mock run start from a Linear issue, Codex run start from a Linear issue using fake app-server, and terminal-state reconciliation.
- Read-only mode is covered: Linear write attempts are rejected unless write mode is explicitly enabled. Automatic Linear comments/state transitions are deferred.

## Milestone 4 Real Linear Validation Result

Real Linear manual validation was not performed because `LINEAR_API_KEY` is not present in the environment. This does not block the milestone because automated fake Linear tests cover the adapter, daemon, cache, run-start, Codex fake app-server, and reconciliation flows without credentials or network access.

## How To Run Mock Tracker Mode

```bash
pnpm dev
```

Open the web URL printed by Next.js. Root `WORKFLOW.md` uses:

```yaml
tracker:
  kind: mock
provider: mock
```

Use the provider selector to start Mock or Codex runs from mock issue cards.

## How To Run Linear Tracker Mode

1. Export `LINEAR_API_KEY`.
2. Copy the Linear example from `README.md` into a local workflow override or temporarily edit `WORKFLOW.md`.
3. Keep `api_key: "$LINEAR_API_KEY"` and `read_only: true`.
4. Configure `team_key`, `team_id`, `project_slug`, `project_id`, or `allow_workspace_wide: true`.
5. Run `pnpm dev`.
6. Open the issues page and click Refresh issues.

Start Mock or Codex provider runs from Linear cards using the same provider selector. Workspace paths use Linear issue identifiers, and rendered prompts include Linear issue fields when the workflow prompt references them.

## Milestone 4 Known Limitations

- GitHub PR/CI is still not implemented.
- Claude Code provider is still not implemented.
- Cursor provider is still not implemented.
- Linear OAuth is not implemented.
- Linear webhooks are not implemented because Symphonia is local-first for now.
- Linear writes are disabled by default. Config flags and guarded client methods exist, but automatic comment/state-transition hooks are deferred.
- Real Linear validation depends on `LINEAR_API_KEY` and accessible Linear workspace/team/project data.
- Daemon restart reconstruction of active runs and approvals is still incomplete.
- Workspace cleanup remains manual.
- Advanced Linear blocker/dependency handling is partial.

## Recommended Next Milestone

Milestone 5 - Add GitHub PR/CI integration and review artifacts for Linear-backed Codex runs.

## Milestone 3 Objective

Implement a real Codex app-server provider while preserving the mock tracker and `WORKFLOW.md` runtime. A user can choose mock or Codex from the UI, start a Codex-backed run, see streamed and persisted Codex events, respond to approvals from the UI, interrupt active turns, retry terminal Codex runs, and keep validation passing without requiring real Codex for automated tests.

## Starting Repo State

- Branch: `main`
- Starting commit: `1bf679d` (`New commit`)
- Working tree at start: clean.
- Milestone 1 and Milestone 2 behavior were present and committed.
- `WORKFLOW.md` existed at the repo root with mock tracker config and harmless local hooks.
- Current local Codex CLI: `codex-cli 0.130.0`.

## External Dependency Notes

- Official Codex app-server docs confirm default stdio transport uses newline-delimited JSON.
- The app-server protocol uses JSON-RPC-style requests, responses, and notifications with the `jsonrpc` header omitted on the wire.
- Clients send `initialize`, then `initialized`, before later requests.
- Threads start with `thread/start`; work starts with `turn/start`; active turns can be interrupted with `turn/interrupt`.
- App-server streams notifications including turn, item, assistant delta, approval, and usage events.
- Approval prompts arrive as server-initiated requests such as `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`, and the client responds on the same JSON-RPC id.
- `codex app-server generate-ts --experimental --out /private/tmp/symphonia-codex-protocol` succeeded locally for protocol inspection; generated files are version-specific and are not required for the normal test suite.

## Completed Checkpoints

1. Provider abstraction cleanup.
2. Codex provider config and provider selection.
3. Protocol layer for the app-server JSON-RPC subset.
4. Stdio JSONL app-server client with fake server tests.
5. Codex event mapping into Symphonia events.
6. Daemon approval registry and approval endpoints.
7. Daemon Codex run lifecycle wiring.
8. Web provider controls, health, Codex timeline, and approvals.
9. Provider health diagnostics.
10. Real Codex manual validation documentation.
11. Automated test coverage.
12. Final validation and smoke checks.

## Implemented Files and Directories

- `.gitignore`
- `WORKFLOW.md`
- `README.md`
- `apps/daemon/src/daemon.ts`
- `apps/daemon/test/http.test.ts`
- `apps/web/components/app-sidebar.tsx`
- `apps/web/components/issues-view.tsx`
- `apps/web/lib/api.ts`
- `packages/core/src/provider.ts`
- `packages/core/src/command-utils.ts`
- `packages/core/src/codex-protocol.ts`
- `packages/core/src/codex-event-mapper.ts`
- `packages/core/src/codex-client.ts`
- `packages/core/src/codex-provider.ts`
- `packages/core/src/workflow.ts`
- `packages/core/src/run-state.ts`
- `packages/core/src/index.ts`
- `packages/core/test/codex-protocol.test.ts`
- `packages/core/test/codex-client.test.ts`
- `packages/core/test/workflow.test.ts`
- `packages/core/package.json`
- `packages/types/src/index.ts`
- `packages/types/test/schemas.test.ts`
- `pnpm-lock.yaml`

## Completed Work

- Added shared provider, health, approval, Codex config, and Codex event schemas.
- Added workflow provider resolution through `provider`, `agent.provider`, `SYMPHONIA_PROVIDER`, and `SYMPHONIA_CODEX_COMMAND`.
- Added `codex.model` support and safe config summaries.
- Added provider contract types for mock and Codex providers.
- Added command parsing and Codex command health checks.
- Added a minimal app-server JSON-RPC protocol layer.
- Added Codex notification/request mapping into Symphonia timeline and approval events.
- Added a stdio JSONL Codex app-server client.
- Added a Codex provider wrapper that launches app-server, streams events, maps failures, and respects abort.
- Wired daemon `POST /runs` provider selection, provider-preserving retry, Codex lifecycle execution, provider health endpoints, and approval endpoints.
- Added fake app-server tests for initialize, thread/start, turn/start, assistant deltas, usage, approvals, JSON-RPC errors, malformed JSON, process exit handling, and interrupt cleanup.
- Updated the web UI with provider selection, provider health, workflow panel status, Codex metadata, rendered prompt, hook output, stderr/error diagnostics, and approval response controls.
- Kept mock provider behavior available and deterministic.
- Changed remaining visible app branding from Circle to Symphonia.

## Validation Commands Run

- `git status --short --branch` - clean on `main...origin/main` before Milestone 3 edits.
- `codex --version` - succeeded; local CLI is `codex-cli 0.130.0`.
- `codex app-server --help` - succeeded.
- `codex app-server generate-ts --experimental --out /private/tmp/symphonia-codex-protocol` - succeeded.
- `pnpm --filter @symphonia/types test` - passed; 8 tests.
- `pnpm --filter @symphonia/types build` - passed.
- `pnpm --filter @symphonia/core test` - passed; 47 tests.
- `pnpm --filter @symphonia/core build` - passed.
- `pnpm --filter @symphonia/daemon build` - passed.
- `pnpm --filter @symphonia/daemon test` - passed; 10 tests.
- `pnpm --filter @symphonia/web lint` - passed.
- `pnpm test` - passed.
- `pnpm lint` - passed.
- `pnpm build` - passed.
- `pnpm dev` - started daemon on `http://localhost:4100` and web on `http://localhost:3001` because local port `3000` was already occupied.

## Smoke Validation Results

- `GET /healthz` returned `ok`.
- `GET /workflow/status` returned healthy, root `WORKFLOW.md`, default provider `mock`, workspace root `.symphonia/workspaces`, and Codex command `codex app-server`.
- `GET /providers` returned mock available and Codex available in this environment.
- Web route `http://localhost:3001/issues` returned HTTP 200.
- Started a mock run for `issue-daemon-api`; it emitted workflow, workspace, prompt, hook, and mock provider events and reached `succeeded`.
- Fetched the mock run events after completion and confirmed persisted timeline events were available.
- Started a real Codex run for `issue-blocked-looking`; it emitted provider start, stderr diagnostics, `codex.thread.started`, `codex.turn.started`, item events, assistant deltas, usage, and command item summaries.
- Real Codex run exposed thread id `019e2135-0950-7a83-9904-d60f7f3c4613` and turn id `019e2135-0ae9-7070-bdb7-9c188b7e8cc7`.
- Interrupted the real Codex run through the daemon stop endpoint; the timeline recorded `codex.turn.completed` with interrupted status and the run ended `cancelled`.
- SSE replay for the real Codex run returned persisted event-stream data.
- Retried the cancelled Codex run; a new Codex run was created with provider `codex` and could be stopped.
- No real approval request occurred during the short manual Codex run; approval behavior is validated by fake app-server tests and exposed in the UI.

## Failures Encountered

- The thread-level goal tracker was still occupied by a completed Milestone 1 objective, so this file served as the Milestone 3 checkpoint ledger.
- Official OpenAI docs MCP tools were not exposed in this session, so the official web docs plus local CLI schema generation were used.
- `@symphonia/core` needed a direct `zod` dependency for the protocol helper module.
- `pnpm --filter @symphonia/core add zod` hit sandbox DNS warnings for registry metadata but completed using the local store.
- `better-sqlite3` was compiled for Node ABI 137 while the active Node requires ABI 141; `pnpm --filter @symphonia/db rebuild better-sqlite3` rebuilt it successfully.
- Next.js build still reports the existing warning that the Next.js ESLint plugin was not detected in the ESLint configuration; lint and build both pass.

## How To Run

```bash
pnpm dev
```

Open the web URL printed by Next.js. The daemon defaults to `http://localhost:4100`. If port `3000` is occupied, Next chooses the next available port, such as `3001`.

Use the provider selector in the header or run controls:

- `Mock`: deterministic fake provider for tests and demos.
- `Codex`: local Codex app-server provider using `codex app-server` by default.

## How To Inspect Workflow, Workspace, and Provider Behavior

- Workflow health: `GET /workflow/status`.
- Safe workflow config: `GET /workflow/config`.
- Reload workflow: `POST /workflow/reload`.
- Provider list: `GET /providers`.
- Codex health: `GET /providers/codex/health`.
- Workspace list: `GET /workspaces`.
- Run events: `GET /runs/:runId/events`.
- Run event stream: `GET /runs/:runId/events/stream`.
- Run approvals: `GET /runs/:runId/approvals`.
- Respond to approval: `POST /approvals/:approvalId/respond`.

## Known Limitations

- Linear adapter is still not implemented.
- GitHub PR/CI adapter is still not implemented.
- Claude Code provider is still not implemented.
- Cursor provider is still not implemented.
- Real Codex validation depends on local Codex CLI installation and authentication.
- App-server event mapping covers the practical subset needed for Milestone 3, not every possible app-server event.
- WebSocket app-server transport is intentionally not implemented.
- Daemon restart reconstruction of active runs and approvals is not implemented yet.
- Workspace cleanup is not automatic.
- Assistant deltas are displayed compactly as timeline events rather than fully aggregated chat bubbles.
- Hooks execute trusted local shell commands.

## Final Acceptance Status

Milestone 3 is complete. Mock provider behavior still works, Codex provider behavior is implemented and validated with fake app-server tests, real local Codex app-server smoke validation succeeded, approval handling is implemented and test-covered, stop/retry paths work, SQLite persistence and SSE streaming are intact, and `pnpm test`, `pnpm lint`, and `pnpm build` pass.

## Recommended Next Goal

Milestone 4 - Add Linear adapter and issue-state synchronization while keeping Codex provider stable.
