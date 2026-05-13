# Symphonia Goal Progress

## Milestone 2 Objective

Implement the repo-owned `WORKFLOW.md` system and real local workspace lifecycle while preserving the Milestone 1 mock tracker/provider loop.

## Current Checkpoint

Checkpoint 12 - documentation and final validation complete.

## Completed Work

- Inspected the Milestone 1 baseline: `README.md`, `GOAL_PROGRESS.md`, root scripts, workspace config, daemon, web app, shared types, core package, and SQLite package.
- Added shared zod schemas and exported TypeScript types for workflow definitions, workflow config, workflow status, workspace info, hook runs, prompt responses, workspace responses, and workflow event variants.
- Extended persisted/SSE agent events with `workflow.loaded`, `workflow.invalid`, `workspace.ready`, `hook.started`, `hook.succeeded`, `hook.failed`, `hook.timed_out`, and `prompt.rendered`.
- Added `yaml` to `@symphonia/core`.
- Implemented `WORKFLOW.md` discovery, including upward repo-root discovery when the daemon is launched from `apps/daemon`.
- Implemented YAML front matter parsing, prompt-only files, typed workflow errors, empty prompt bodies, and unknown-key tolerance.
- Implemented workflow config resolution with defaults, mock/linear validation, env var expansion, `~` expansion, relative workspace root resolution, and secret-safe summaries.
- Implemented strict `{{ path.to.value }}` prompt rendering with unknown variable/helper failures and a fallback prompt.
- Implemented per-issue workspace manager with deterministic key sanitization, root containment checks, creation, reuse, listing, and future before-remove target support.
- Implemented POSIX hook runner with `sh -lc`, timeout handling, abort handling, stdout/stderr capture, exit code capture, and structured hook results.
- Wired workflow, workspace, prompt, hooks, and existing mock provider into the daemon run lifecycle.
- Added daemon APIs: `GET /workflow/status`, `GET /workflow/config`, `POST /workflow/reload`, `GET /workspaces`, `GET /workspaces/:issueIdentifier`, and `GET /runs/:runId/prompt`.
- Preserved run concurrency protection, stop, retry, SSE streaming, and append-only SQLite event persistence.
- Updated the Next.js UI with workflow health, a workflow panel, reload button, workspace path, rendered prompt preview, hook log details, and new timeline event labels.
- Added root `WORKFLOW.md` configured for the mock tracker with harmless local hooks.
- Updated README with Milestone 2 behavior, config format, hook safety, prompt variables, endpoints, validation, and limitations.
- Added `.symphonia` and a local legacy scaffold copy to `.gitignore`.

## Implemented Files and Directories

- `WORKFLOW.md`
- `packages/types/src/index.ts`
- `packages/types/test/schemas.test.ts`
- `packages/core/src/workflow.ts`
- `packages/core/src/prompt-template.ts`
- `packages/core/src/workspace-manager.ts`
- `packages/core/src/hook-runner.ts`
- `packages/core/test/workflow.test.ts`
- `apps/daemon/src/daemon.ts`
- `apps/daemon/test/http.test.ts`
- `apps/web/app/page.tsx`
- `apps/web/lib/api.ts`
- `README.md`
- `GOAL_PROGRESS.md`

## Validation Commands Run

- `pnpm --filter @symphonia/types test` - succeeded; 7 tests passed.
- `pnpm --filter @symphonia/types build` - succeeded.
- `pnpm --filter @symphonia/core test` - succeeded; 33 tests passed.
- `pnpm --filter @symphonia/core build` - succeeded.
- `pnpm --filter @symphonia/daemon test` - succeeded; 5 tests passed.
- `pnpm --filter @symphonia/daemon build` - succeeded.
- `pnpm --filter @symphonia/web build` - succeeded.
- `pnpm --filter @symphonia/db test` - succeeded; 3 tests passed.
- `pnpm test` - succeeded; all package and daemon tests passed.
- `pnpm lint` - succeeded.
- `pnpm build` - succeeded. Next.js still emits the existing non-blocking warning that the Next ESLint plugin is not detected in the root flat ESLint config.
- `pnpm dev` - succeeded; daemon started on `http://localhost:4100`, web started on `http://localhost:3001` because port `3000` was already occupied by another process.

## Manual Validation Results

- `GET /healthz` returned healthy daemon status.
- `GET /workflow/status` returned `healthy` with root `WORKFLOW.md` and workspace root `.symphonia/workspaces`.
- Web app responded with HTTP 200 on the available Next.js dev port.
- Starting `SYM-1` created `.symphonia/workspaces/SYM-1`.
- `GET /runs/:runId/events` showed `workflow.loaded`, `workspace.ready`, `prompt.rendered`, hook events, mock provider events, `succeeded`, and `afterRun` hook logs.
- `GET /runs/:runId/prompt` returned the rendered prompt with issue data.
- SSE endpoint replayed and streamed `agent-event` records for an active run; the `curl --max-time` command exited with code 28 after receiving expected events.
- Refresh-style validation via repeated `GET /runs/:runId/events` confirmed persisted timeline events remained available.
- `SYM-6` failed deterministically on first attempt and succeeded after `POST /runs/:runId/retry`.
- A slower mock run returned `cancelled` from `POST /runs/:runId/stop`; retry of that cancelled run queued a new attempt.
- Temporary prompt edit plus `POST /workflow/reload` produced a rendered prompt containing the edit.
- Temporary invalid YAML plus `POST /workflow/reload` returned `invalid` workflow status without daemon crash.
- Restoring `WORKFLOW.md` plus `POST /workflow/reload` returned `healthy`.

## Failures Encountered

- The goal tracker still contains the completed Milestone 1 objective and did not allow creating a second thread goal in this conversation. This file acted as the Milestone 2 checkpoint ledger.
- `pnpm --filter @symphonia/core add yaml` first hit pnpm store mismatch. Retrying against the existing store completed, though sandbox DNS prevented registry metadata refreshes.
- First core test run consumed stale built exports from `@symphonia/types`; rebuilding the types package fixed it.
- SQLite native bindings were compiled for a different Node ABI after dependency work; `pnpm --filter @symphonia/db rebuild better-sqlite3` fixed tests.
- Automated HTTP tests could not bind a local port in the sandbox, so daemon tests exercise the same daemon methods directly; manual smoke validation covered real HTTP/SSE with `curl`.
- Initial dev smoke found workflow discovery looking in `apps/daemon/WORKFLOW.md`; fixed by walking upward to the repo root.
- `tsx watch` hit a sandbox IPC `EPERM` on one dev run; rerunning dev with escalation started successfully.
- Node `fetch` to localhost was blocked by sandbox networking during smoke scripting; `curl` validation worked.

## How To Run The App

```bash
pnpm install
pnpm dev
```

Open the Next.js URL printed by the dev server. The daemon defaults to `http://localhost:4100`. If SQLite native bindings are stale after changing Node versions, run:

```bash
pnpm --filter @symphonia/db rebuild better-sqlite3
```

## How To Inspect Workflow And Workspace Behavior

- `GET http://localhost:4100/workflow/status`
- `GET http://localhost:4100/workflow/config`
- `POST http://localhost:4100/workflow/reload`
- `GET http://localhost:4100/workspaces`
- `GET http://localhost:4100/workspaces/SYM-1`
- `GET http://localhost:4100/runs/<runId>/prompt`
- Workspace folders are under `.symphonia/workspaces` by default.
- Run events are persisted in SQLite at `./.data/agentboard.sqlite` by default.

## Known Limitations

- Real Codex provider is still not implemented.
- Linear adapter is still not implemented.
- GitHub PR/CI adapter is still not implemented.
- Workflow hot reload is manual through the reload endpoint/button.
- Workspace cleanup is not automatic.
- Run metadata is still in daemon memory and is not reconstructed after daemon restart, though events persist in SQLite.
- Hooks execute trusted local shell commands from repo configuration.
- Next.js build emits the existing non-blocking root ESLint plugin warning.

## Recommended Next /goal Prompt Title

Milestone 3 — Implement real Codex app-server provider while keeping mock tracker and `WORKFLOW.md` runtime.

## Final Acceptance Status

Complete for Milestone 2.
