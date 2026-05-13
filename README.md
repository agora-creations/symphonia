# Symphonia

Symphonia is a local-first visual orchestration prototype for coding-agent work. It is a Linear-like control plane for starting, watching, stopping, and retrying agent runs against repo-owned workflow configuration.

Milestone 3 keeps the mock tracker and `WORKFLOW.md` runtime from earlier milestones, then adds a production-shaped Codex app-server provider. Users can choose mock or Codex mode from the UI, run preparation hooks in real per-issue workspaces, stream provider events into the timeline, respond to Codex approval requests, interrupt active Codex turns, and refresh the page without losing persisted run events.

This prototype still does not integrate Linear, GitHub PR/CI, Claude Code, Cursor, auth, billing, cloud tenancy, Electron, or Tauri.

Reference: the Codex app-server integration follows the official OpenAI developer docs at <https://developers.openai.com/codex/app-server/>.

## What Milestone 3 Includes

- The Milestone 1 mock tracker/provider loop remains available for tests and demos.
- The Milestone 2 `WORKFLOW.md` parser, config resolver, prompt renderer, workspace manager, and hook runner remain in the run lifecycle.
- Provider selection for `mock` or `codex` through the UI, run API, workflow config, or environment override.
- Provider health APIs and UI status for mock and Codex.
- A stdio JSONL Codex app-server client using initialize, thread/start, turn/start, turn/interrupt, and server-request responses.
- Codex event mapping into the Symphonia timeline for thread/turn metadata, assistant deltas, items, usage, stderr diagnostics, errors, and approvals.
- Approval APIs and UI cards for accept, accept for session, decline, and cancel decisions.
- SQLite append-only persistence for workflow, workspace, prompt, hook, mock, and Codex events.
- Fake app-server tests, so automated validation does not require real Codex, network access, or OpenAI credentials.

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
- `SYMPHONIA_PROVIDER`: `mock` or `codex`; overrides workflow default provider.
- `SYMPHONIA_CODEX_COMMAND`: Codex app-server command, defaults to `codex app-server`.

## Validate

```bash
pnpm test
pnpm lint
pnpm build
```

## WORKFLOW.md

`WORKFLOW.md` has optional YAML front matter followed by a Markdown prompt template. The starter file uses the mock tracker, harmless hooks, and a Codex config block that can be used when the local Codex CLI is installed and authenticated.

```yaml
---
provider: mock
tracker:
  kind: mock
workspace:
  root: ".symphonia/workspaces"
hooks:
  timeout_ms: 30000
codex:
  command: "codex app-server"
  model: null
  approval_policy: "on-request"
  turn_sandbox_policy: "workspaceWrite"
---
```

Supported config groups:

- `provider`: `mock` or `codex`.
- `tracker`: `kind`, `endpoint`, `api_key`, `project_slug`, `active_states`, `terminal_states`.
- `polling`: `interval_ms`.
- `workspace`: `root`.
- `hooks`: `after_create`, `before_run`, `after_run`, `before_remove`, `timeout_ms`.
- `agent`: `max_concurrent_agents`, `max_turns`, `max_retry_backoff_ms`, `max_concurrent_agents_by_state`.
- `codex`: `command`, `model`, `approval_policy`, `thread_sandbox`, `turn_sandbox_policy`, `turn_timeout_ms`, `read_timeout_ms`, `stall_timeout_ms`.

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

## Workspaces

Each run creates or reuses a real per-issue workspace:

- The key is derived from `issue.identifier`.
- Characters outside `[A-Za-z0-9._-]` become `_`.
- The path is `<workspace.root>/<workspace_key>`.
- Workspaces are reused on later runs and are not deleted after successful runs.
- Path handling prevents issue identifiers from escaping the configured root.

## Hooks

Hooks execute locally with `sh -lc` in the issue workspace directory. Symphonia captures stdout, stderr, exit code, start/end timestamps, and timeout status.

- `after_create`: runs only when the workspace directory is created for the first time.
- `before_run`: runs before every mock or Codex provider run.
- `after_run`: runs after the provider finishes, fails, or is cancelled; failures are logged without replacing the provider terminal status.
- `before_remove`: implemented for future cleanup paths, but normal successful runs do not delete workspaces.

Hooks are trusted repo configuration and can run shell commands on your machine. Review workflow changes before running hooks from untrusted repos.

## Codex Provider

The Codex provider uses the local Codex CLI app-server over stdio JSONL. It does not run in automated tests unless a fake app-server test fixture is being used.

Prerequisites for real Codex validation:

- Codex CLI installed.
- Local Codex environment authenticated.
- `WORKFLOW.md` points workspaces at a safe local directory.
- The UI or run request selects provider `codex`.

Manual flow:

1. Run `pnpm dev`.
2. Open the web app.
3. Confirm daemon and workflow status are healthy.
4. Confirm provider health shows Codex available.
5. Select `Codex`.
6. Start a run.
7. Open the run detail panel.
8. Confirm workspace path, rendered prompt, thread id, turn id, Codex events, and terminal status.
9. Respond to approval cards if Codex requests command or file-change approval.
10. Use `Interrupt Codex` to stop an active turn.

Troubleshooting:

- `codex command not found`: install Codex or set `SYMPHONIA_CODEX_COMMAND`.
- `Codex unavailable`: check provider health in the header or `GET /providers/codex/health`.
- `app-server failed to initialize`: run the configured command manually and check authentication.
- `malformed provider output`: inspect `provider.stderr` and `codex.error` events in the timeline.
- `approval request stuck`: use the run approval panel or `POST /approvals/:approvalId/respond`.

## Daemon Endpoints

- `GET /healthz`
- `GET /issues`
- `GET /runs`
- `GET /runs/:runId`
- `GET /runs/:runId/events`
- `GET /runs/:runId/events/stream`
- `GET /runs/:runId/prompt`
- `POST /runs` with `{ "issueId": "...", "provider": "mock" | "codex" }`
- `POST /runs/:runId/stop`
- `POST /runs/:runId/retry`
- `GET /workflow/status`
- `GET /workflow/config`
- `POST /workflow/reload`
- `GET /workspaces`
- `GET /workspaces/:issueIdentifier`
- `GET /providers`
- `GET /providers/mock/health`
- `GET /providers/codex/health`
- `GET /approvals`
- `GET /runs/:runId/approvals`
- `POST /approvals/:approvalId/respond`

Workflow config responses are summaries and do not expose API keys or secrets.

## Manual Validation Flow

1. Run `pnpm dev`.
2. Open the web app.
3. Confirm daemon and workflow status are healthy.
4. Confirm provider list shows mock and Codex.
5. Start a mock run and confirm the timeline still streams workflow, workspace, prompt, hook, and mock provider events.
6. Refresh and confirm persisted events remain visible.
7. Select Codex provider.
8. If Codex CLI is unavailable, confirm the UI shows unavailable or the run fails gracefully with a clear provider error.
9. If Codex CLI is available, start a Codex run and confirm workspace, rendered prompt, thread id, turn id, Codex events, and terminal status.
10. Respond to approval cards if Codex requests approval.
11. Interrupt an active Codex turn.
12. Retry a failed or cancelled Codex run.
13. Edit `WORKFLOW.md`, click Reload, start another run, and confirm the rendered prompt reflects the edit.

## SQLite Data

Run events are append-only in SQLite. The default path is `./.data/agentboard.sqlite`, relative to the daemon process. Workspaces are real folders under the configured workflow workspace root.

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

## Next Milestone

Milestone 4 - Add Linear adapter and issue-state synchronization while keeping Codex provider stable.
