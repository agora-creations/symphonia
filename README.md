# Symphonia

Symphonia is a local-first visual orchestration prototype for coding-agent work. Milestone 2 keeps the Milestone 1 mock tracker/provider loop, then adds the repo-owned `WORKFLOW.md` contract, real per-issue workspaces on disk, prompt rendering, safe local hooks, workflow APIs, and UI visibility for the orchestration preparation phase.

This prototype still does not integrate real Codex app-server, Claude Code, Cursor, Linear, GitHub PR/CI, auth, billing, cloud tenancy, Electron, or Tauri.

## What Milestone 2 Includes

- `WORKFLOW.md` discovery from the repo root or `SYMPHONIA_WORKFLOW_PATH`.
- YAML front matter parsing with typed validation errors.
- Resolved workflow config defaults for tracker, polling, workspace, hooks, agent, and codex settings.
- Strict `{{ path.to.value }}` prompt template rendering.
- Real workspace folders under the configured workspace root.
- Workspace key sanitization: characters outside `[A-Za-z0-9._-]` become `_`.
- Hook execution for `after_create`, `before_run`, `after_run`, and implemented `before_remove` support for future cleanup.
- Captured hook stdout, stderr, exit code, timeout, and error status.
- Daemon endpoints for workflow status/config/reload, workspaces, and rendered prompts.
- UI workflow health panel, reload button, workspace path, prompt preview, and hook log details.
- Tests for workflow parsing, config validation, prompt rendering, workspace management, hook behavior, daemon lifecycle, SQLite events, and Milestone 1 run state behavior.

## Install

```bash
pnpm install
```

The repo pins approved pnpm native build dependencies for `better-sqlite3`, `esbuild`, and `sharp`. If SQLite bindings are missing or compiled for the wrong Node version after switching Node versions, run:

```bash
pnpm --filter @symphonia/db rebuild better-sqlite3
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
- `SYMPHONIA_WORKFLOW_PATH`: explicit workflow file path; defaults to `WORKFLOW.md` in the current repo root.

## Validate

```bash
pnpm test
pnpm build
pnpm lint
```

## WORKFLOW.md

`WORKFLOW.md` has optional YAML front matter followed by a Markdown prompt template. The starter file uses the mock tracker and requires no credentials:

```yaml
---
tracker:
  kind: mock
workspace:
  root: ".symphonia/workspaces"
hooks:
  timeout_ms: 30000
---
```

Supported config groups:

- `tracker`: `kind`, `endpoint`, `api_key`, `project_slug`, `active_states`, `terminal_states`.
- `polling`: `interval_ms`.
- `workspace`: `root`.
- `hooks`: `after_create`, `before_run`, `after_run`, `before_remove`, `timeout_ms`.
- `agent`: `max_concurrent_agents`, `max_turns`, `max_retry_backoff_ms`, `max_concurrent_agents_by_state`.
- `codex`: `command`, `approval_policy`, `thread_sandbox`, `turn_sandbox_policy`, `turn_timeout_ms`, `read_timeout_ms`, `stall_timeout_ms`.

`workspace.root` supports `~`, `$VAR` or `${VAR}`, and relative paths. Relative paths resolve from the `WORKFLOW.md` directory. The effective root is always absolute.

`tracker.kind: mock` runs without credentials. `tracker.kind: linear` is validated but not called yet; it requires `api_key` and `project_slug`.

## Prompt Template

Prompt templates support strict variable interpolation:

```markdown
You are working on issue {{ issue.identifier }}.
Title: {{ issue.title }}
Labels: {{ issue.labels }}
Attempt: {{ attempt }}
```

Template input includes `issue`, `attempt`, and `workflow`. Unknown variables and unsupported helpers/filters fail rendering. Empty prompt bodies use the fallback: `You are working on an issue from the mock tracker.`

## Hooks

Hooks execute locally with `sh -lc` in the issue workspace directory. Symphonia captures stdout, stderr, exit code, start/end timestamps, and timeout status.

- `after_create`: runs only when the workspace directory is created for the first time.
- `before_run`: runs before every mock provider run.
- `after_run`: runs after the mock provider finishes, fails, or is cancelled; failures are logged without replacing the provider terminal status.
- `before_remove`: implemented for future cleanup paths, but normal successful runs do not delete workspaces.

Hooks are trusted repo configuration and can run shell commands on your machine. Keep starter hooks harmless and review changes before running workflows from untrusted repos.

## Daemon Endpoints

- `GET /healthz`
- `GET /issues`
- `GET /runs`
- `GET /runs/:runId`
- `GET /runs/:runId/events`
- `GET /runs/:runId/events/stream`
- `GET /runs/:runId/prompt`
- `POST /runs`
- `POST /runs/:runId/stop`
- `POST /runs/:runId/retry`
- `GET /workflow/status`
- `GET /workflow/config`
- `POST /workflow/reload`
- `GET /workspaces`
- `GET /workspaces/:issueIdentifier`

Workflow config responses are summaries and do not expose API keys or secrets.

## Manual Validation Flow

1. Run `pnpm dev`.
2. Open `http://localhost:3000`.
3. Confirm daemon and workflow status are healthy.
4. Open the workflow panel and confirm the workflow path and workspace root.
5. Start a Todo issue run.
6. Open the run detail panel.
7. Confirm the workspace path appears and exists under `.symphonia/workspaces`.
8. Confirm the rendered prompt appears.
9. Confirm hook logs appear.
10. Confirm mock provider events stream after workflow, workspace, prompt, and hook events.
11. Refresh and confirm persisted events remain visible.
12. Stop a slow run.
13. Retry `SYM-6` and confirm the second attempt succeeds.
14. Edit `WORKFLOW.md`, click Reload, start another run, and confirm the rendered prompt reflects the edit.
15. Temporarily break `WORKFLOW.md` YAML, reload, and confirm invalid workflow status without daemon crash.
16. Restore `WORKFLOW.md` and reload successfully.

## SQLite Data

Run events are append-only in SQLite. The default path is `./.data/agentboard.sqlite`, relative to the daemon process. Workspaces are not stored in SQLite; they are real folders under the configured workflow workspace root.

## Known Limitations

- Real Codex provider is still not implemented.
- Linear adapter is still not implemented.
- GitHub PR/CI adapter is still not implemented.
- Workflow hot reload is manual through the reload endpoint/button.
- Workspace cleanup is not automatic.
- Run metadata is still daemon memory; persisted events survive page refreshes while the daemon is running, but runs are not reconstructed after daemon restart yet.
- Hooks execute trusted local shell commands.

## Next Milestone

Milestone 3 — Implement real Codex app-server provider while keeping mock tracker and `WORKFLOW.md` runtime.
