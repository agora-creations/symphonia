# Symphonia Milestone 1 Progress

## Current Checkpoint

Checkpoint 9 - README and final validation complete.

## Completed Work

- Inspected the existing project: it was a root-level TanStack/Vite-style app, not a git repository and not a pnpm monorepo.
- Preserved the existing scaffold files in place.
- Started converting the root into a pnpm TypeScript monorepo that targets `apps/` and `packages/`.
- Created the root `pnpm-workspace.yaml`.
- Created workspace packages under `apps/web`, `apps/daemon`, `packages/types`, `packages/core`, and `packages/db`.
- Added root commands: `pnpm dev`, `pnpm build`, `pnpm test`, and `pnpm lint`.
- Implemented initial Next.js web app shell, daemon shell, shared type package, core package, and database package.
- Ran `pnpm install` successfully.
- Ran `pnpm build` successfully.
- Implemented shared zod schemas and exported TypeScript types in `packages/types`.
- Added schema tests for valid issues, valid runs, valid event variants, and invalid event rejection.
- Implemented append-only SQLite event store in `packages/db` using `better-sqlite3`.
- Added database tests for append/fetch, chronological ordering, and run isolation with temporary databases.
- Implemented stable mock tracker issues across Todo, In Progress, Human Review, Rework, and Done.
- Implemented deterministic mock agent provider event timelines, including first-attempt failure for `SYM-6` and success on retry.
- Implemented core run state helpers for start, stop/cancel, success, failure, and retry.
- Implemented daemon endpoints for health, issues, runs, run events, SSE streams, start, stop, and retry.
- Implemented initial Next.js board UI with daemon status, grouped issue columns, run controls, status badges, and live event detail panel.
- Ran `pnpm test` successfully after native SQLite binding remediation.
- Ran `pnpm lint` successfully.
- Fixed compiled Node ESM runtime imports so `node apps/daemon/dist/index.js` starts correctly.
- Validated daemon HTTP endpoints with local `curl` smoke checks.
- Validated SSE output with `GET /runs/:runId/events/stream`.
- Validated stop and retry behavior against the compiled daemon with a slower mock delay.
- Validated `pnpm dev` starts both the daemon and Next frontend.
- Added README with install, run, validation, storage, mock behavior, accessibility baseline, known limitations, and next milestones.

## Validation Commands Run

- `pwd` - succeeded.
- `ls -la` - succeeded.
- `command -v pnpm` - succeeded.
- `pnpm install` - succeeded.
- `pnpm build` - succeeded.
- `pnpm test` - initially failed because `better-sqlite3` native bindings were not built.
- `CI=true pnpm install --force` with network escalation - succeeded and built `better-sqlite3`.
- `pnpm test` - succeeded after native binding build.
- `pnpm lint` - initially failed because ESLint traversed generated `dist` and `.next` output.
- `pnpm lint` - succeeded after generated-output ignores were fixed.
- `pnpm build` - succeeded after final ESM import fix. Next.js emitted a non-blocking warning that the Next ESLint plugin is not configured in the root flat ESLint config.
- `curl http://localhost:4100/healthz` - succeeded during daemon smoke check.
- `curl http://localhost:4100/issues` - succeeded and returned 8 zod-valid mock issues.
- `POST /runs` for `SYM-1` - succeeded and produced persisted successful timeline events.
- `GET /runs/:runId/events/stream` - returned SSE `agent-event` records; the `curl --max-time` command exited with timeout code 28 after receiving expected stream output.
- `POST /runs/:runId/stop` - succeeded against a slower compiled-daemon smoke run and marked the run `cancelled`.
- `POST /runs/:runId/retry` - succeeded and created a new queued run for the same issue.
- `pnpm dev` - succeeded; daemon reported `http://localhost:4100`, Next reported `http://localhost:3000`, and both responded to local HTTP checks.

## Failures Encountered

- `git status --short` failed because this directory is not a git repository.
- Initial scaffold patch failed on `.gitignore` context and was reapplied in smaller patches.
- `pnpm install` warned that native build scripts for `better-sqlite3`, `esbuild`, and `sharp` were ignored. Build still succeeded; SQLite runtime tests will confirm whether this needs remediation.
- First `pnpm build` surfaced a React hooks cleanup warning from Next.js linting; fixed by copying the ref map inside the effect before cleanup.
- `better-sqlite3` tests failed until pnpm approved native build dependencies were configured with `pnpm.onlyBuiltDependencies` and dependencies were force-refreshed.
- `CI=true pnpm install --force` required escalated network because the sandbox could not resolve `registry.npmjs.org`.
- Root lint initially scanned generated build outputs; fixed by ignoring `**/dist/**`, `**/.next/**`, and generated Next env files.
- Compiled daemon initially failed at runtime because TypeScript emitted extensionless relative ESM imports; fixed source imports to use `.js` relative specifiers.
- `tsx watch` needed escalated execution in this sandbox because its IPC pipe listen failed with `EPERM`; local user shells should be able to run `pnpm dev` normally.
- `curl --max-time` SSE check exits non-zero by design after the timeout, even though it received expected SSE records.

## Remaining Work

- None for Milestone 1.

## Implemented Files and Directories

- `apps/web`: Next.js app router UI, Tailwind global styles, daemon API client.
- `apps/daemon`: Node daemon server with HTTP routes, SSE streaming, run registry, and compiled entrypoint.
- `packages/types`: zod schemas, shared domain types, API response schemas, schema tests.
- `packages/core`: mock tracker, mock provider, run state helpers, provider/state tests.
- `packages/db`: SQLite event store and temporary-database tests.
- `pnpm-workspace.yaml`, root `package.json`, root `tsconfig.json`, root `eslint.config.js`.
- `README.md`.

## How To Run The App

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`. The daemon defaults to `http://localhost:4100` and SQLite defaults to `./.data/agentboard.sqlite`.

## Manual Verification Summary

1. `pnpm dev` starts package builds, daemon, and web.
2. The web app responds on `localhost:3000`.
3. The daemon health endpoint responds on `localhost:4100/healthz`.
4. Mock issues are available from `GET /issues`.
5. `POST /runs` starts a mock run.
6. Events are persisted and returned by `GET /runs/:runId/events`.
7. SSE streams event records from `GET /runs/:runId/events/stream`.
8. Stop marks active runs `cancelled`.
9. Retry creates a new queued run attempt for the same issue.

## Known Limitations

- Runs are kept in daemon memory; persisted events survive page refreshes while the daemon is running, but run metadata is not reconstructed after daemon restart yet.
- The mock provider is deterministic and local only.
- The UI is keyboard usable and labeled, but deeper accessibility testing is deferred.
- Next.js build emits a non-blocking warning about the root flat ESLint config not including the Next plugin.

## Recommended Next /goal Prompt Title

`/goal Implement Symphonia Milestone 2: WORKFLOW.md parser and local workspace manager`

## Final Acceptance Status

Complete for Milestone 1.
