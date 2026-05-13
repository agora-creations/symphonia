# Symphonia

Symphonia is a local-first visual orchestration prototype for coding-agent work. Milestone 1 proves the fake-but-complete product loop: mock tracker issues, mock agent runs, SQLite event persistence, daemon HTTP/SSE APIs, and a Linear-like board UI.

This milestone intentionally does not integrate real Codex, Claude Code, Cursor, Linear, GitHub, PR/CI, auth, billing, cloud tenancy, Electron, or Tauri.

## What Milestone 1 Includes

- `apps/web`: Next.js board UI styled with Tailwind CSS.
- `apps/daemon`: local Node.js TypeScript daemon API.
- `packages/types`: shared zod schemas and TypeScript types.
- `packages/core`: mock tracker, mock provider, and run state helpers.
- `packages/db`: append-only SQLite run event store.
- HTTP and Server-Sent Events from daemon to UI.
- Start, stop, and retry controls for mock runs.
- Tests for schema parsing, event persistence, mock provider behavior, and run state transitions.

## Install

```bash
pnpm install
```

The repo pins approved pnpm native build dependencies for `better-sqlite3`, `esbuild`, and `sharp`. If SQLite bindings are missing after a clean install, run:

```bash
CI=true pnpm install --force
```

## Run Locally

Start both the daemon and the web app from the repo root:

```bash
pnpm dev
```

Default URLs:

- Web app: `http://localhost:3000`
- Daemon: `http://localhost:4100`

Useful daemon environment variables:

- `SYMPHONIA_DAEMON_PORT`: daemon port, defaults to `4100`.
- `SYMPHONIA_DB_PATH`: SQLite file path, defaults to `./.data/agentboard.sqlite`.
- `SYMPHONIA_MOCK_DELAY_MS`: mock provider delay per event, defaults to `450`.

## Validate

```bash
pnpm test
pnpm build
pnpm lint
```

Manual fake-loop validation:

1. Run `pnpm dev`.
2. Open `http://localhost:3000`.
3. Confirm the daemon status reads healthy.
4. Confirm mock issues are grouped by Todo, In Progress, Human Review, Rework, and Done.
5. Start a run from a Todo card.
6. Open the run detail panel and watch events stream.
7. Refresh the page and reopen the card; persisted events are fetched from SQLite.
8. Start another run and stop it before completion.
9. Retry a cancelled or failed run.
10. Start `SYM-6` to see the deterministic failure path; retrying that issue succeeds on the second attempt.

## Mock Behavior

The mock tracker returns eight stable issues covering frontend, daemon, testing, accessibility, rework, human review, done, and blocked-looking work.

The mock provider emits a realistic timeline: workspace preparation, prompt building, mock agent launch, assistant messages, `git status`, `pnpm test`, a diff artifact, usage, and a terminal status. `SYM-6` fails on the first attempt and succeeds on retry.

Retry behavior is intentionally simple: retry creates a new run attempt for the same issue. Previous run events remain append-only and unchanged.

## Accessibility Baseline

- Board columns use semantic sections and headings.
- Cards expose keyboard-reachable detail buttons and action buttons.
- Buttons have visible text and accessible names.
- Status badges include text, not just color.
- The run timeline uses readable labels and timestamps.
- Streaming updates use an `aria-live` timeline and do not move focus.
- Drag-and-drop is not required; all interactions are button based.

Known limitation: this milestone has a keyboard-usable board, not a full screen-reader-optimized production workflow. A later milestone should add automated accessibility checks and deeper announcement tuning.

## Next Milestones

- `WORKFLOW.md` parser.
- Workspace manager.
- Real Codex provider.
- Linear adapter.
- GitHub PR/CI adapter.
- Claude Code and Cursor adapters.
