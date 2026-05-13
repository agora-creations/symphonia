# Symphonia Goal Progress

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
