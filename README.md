# Symphonia

Symphonia is a local-first visual orchestration prototype for coding-agent work. It is a Linear-like control plane for fetching tracker issues, starting Mock or Codex runs, watching timelines, stopping/retrying work, and reconciling active runs against repo-owned workflow configuration.

Milestone 4 keeps the mock tracker, mock provider, `WORKFLOW.md` runtime, workspaces, hooks, SQLite/SSE event flow, and Codex provider stable, then adds a real read-only Linear tracker adapter. Users can keep running local mock demos, or configure Linear in `WORKFLOW.md`, refresh real Linear issues into the board, start Mock or Codex runs from Linear issue cards, and let polling stop active runs when Linear state becomes terminal or inactive.

This prototype still does not integrate GitHub PR/CI, Claude Code, Cursor, Linear OAuth, Linear webhooks, auth, billing, cloud tenancy, Electron, or Tauri.

Reference: the Codex app-server integration follows the official OpenAI developer docs at <https://developers.openai.com/codex/app-server/>.

## What Milestone 4 Includes

- The Milestone 1 mock tracker/provider loop remains available for tests and demos.
- The Milestone 2 `WORKFLOW.md` parser, config resolver, prompt renderer, workspace manager, and hook runner remain in the run lifecycle.
- Provider selection for `mock` or `codex` through the UI, run API, workflow config, or environment override.
- Tracker selection for `mock` or `linear` through `WORKFLOW.md`.
- Direct Linear GraphQL client with fake-fetch tests, viewer health check, issue pagination, single issue lookup, and defensive GraphQL/network error handling.
- Linear issue normalization into Symphonia issue fields: identifier, title, description, priority, state, branch name, URL, labels, team/project metadata, created/updated timestamps, and source metadata.
- SQLite issue cache so the UI reads through the local daemon instead of calling Linear directly.
- Tracker status, tracker health, issue refresh, issue detail, and by-identifier APIs.
- Polling and reconciliation for active runs. If refreshed Linear state becomes terminal or no longer active, the daemon interrupts the run and records tracker reconciliation events.
- Read-only Linear mode by default. Optional write settings exist in config but agent-driven Linear writes are not enabled by default.
- Provider health APIs and UI status for mock and Codex.
- A stdio JSONL Codex app-server client using initialize, thread/start, turn/start, turn/interrupt, and server-request responses.
- Codex event mapping into the Symphonia timeline for thread/turn metadata, assistant deltas, items, usage, stderr diagnostics, errors, and approvals.
- Approval APIs and UI cards for accept, accept for session, decline, and cancel decisions.
- SQLite append-only persistence for workflow, workspace, prompt, hook, mock, and Codex events.
- Fake app-server tests, so automated validation does not require real Codex, network access, or OpenAI credentials.
- Fake Linear tests, so automated validation does not require Linear credentials, network access, or a real Linear workspace.

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
- `LINEAR_API_KEY`: Linear personal API key used when `tracker.kind: linear` and `tracker.api_key: "$LINEAR_API_KEY"` are configured.

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
- `tracker`: `kind`, `endpoint`, `api_key`, `team_key`, `team_id`, `project_slug`, `project_id`, `allow_workspace_wide`, `active_states`, `terminal_states`, `include_archived`, `page_size`, `max_pages`, `poll_interval_ms`, `read_only`, and `write`.
- `polling`: `interval_ms`.
- `workspace`: `root`.
- `hooks`: `after_create`, `before_run`, `after_run`, `before_remove`, `timeout_ms`.
- `agent`: `max_concurrent_agents`, `max_turns`, `max_retry_backoff_ms`, `max_concurrent_agents_by_state`.
- `codex`: `command`, `model`, `approval_policy`, `thread_sandbox`, `turn_sandbox_policy`, `turn_timeout_ms`, `read_timeout_ms`, `stall_timeout_ms`.

`workspace.root` supports `~`, `$VAR` or `${VAR}`, and relative paths. Relative paths resolve from the `WORKFLOW.md` directory. The effective root is always absolute.

`tracker.kind: mock` runs without credentials. `tracker.kind: linear` requires an API key after environment-variable resolution and at least one practical scope filter: `team_key`, `team_id`, `project_slug`, `project_id`, or `allow_workspace_wide: true`.

Workflow config responses are summaries and never expose `api_key` or resolved secrets.

## Linear Tracker

The root `WORKFLOW.md` remains in mock mode for safe local development and CI. To validate Linear locally, copy the workflow file to a local override or edit it temporarily, export `LINEAR_API_KEY`, and run the daemon with the Linear config.

Linear personal API keys use the raw `Authorization` header value. OAuth bearer tokens and OAuth setup are not implemented in this milestone.

Read-only Linear example:

```yaml
---
provider: mock
tracker:
  kind: linear
  endpoint: "https://api.linear.app/graphql"
  api_key: "$LINEAR_API_KEY"
  team_key: "ENG"
  project_slug: "your-project-slug"
  active_states:
    - "Todo"
    - "In Progress"
    - "Rework"
  terminal_states:
    - "Done"
    - "Closed"
    - "Cancelled"
    - "Canceled"
    - "Duplicate"
  page_size: 50
  max_pages: 5
  read_only: true
polling:
  interval_ms: 30000
workspace:
  root: ".symphonia/workspaces"
agent:
  max_concurrent_agents: 3
  max_turns: 8
  max_retry_backoff_ms: 300000
codex:
  command: "codex app-server"
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000
hooks:
  timeout_ms: 30000
  after_create: |
    printf "Workspace created at $(pwd)\n"
  before_run: |
    printf "Preparing run in $(pwd)\n"
  after_run: |
    printf "Finished run in $(pwd)\n"
---

You are working on issue {{ issue.identifier }}.

Title:
{{ issue.title }}

Description:
{{ issue.description }}

State:
{{ issue.state }}

Labels:
{{ issue.labels }}

Linear URL:
{{ issue.url }}

Attempt:
{{ attempt }}

Instructions:
1. Inspect the workspace context.
2. Make the smallest correct change.
3. Run relevant validation.
4. Report what changed and what was verified.
5. If blocked, explain exactly what information is missing.
6. Hand off to Human Review when ready.
```

Linear mode behavior:

- The frontend never calls Linear directly. It only calls the local daemon.
- `POST /issues/refresh` fetches Linear issues through the daemon and updates the SQLite issue cache.
- `GET /issues` returns the latest cached Linear issues.
- `GET /tracker/status` shows tracker kind, safe config summary, last sync time, issue count, and the last error.
- Polling uses `tracker.poll_interval_ms` when set, otherwise `polling.interval_ms`.
- If Linear refresh fails, active runs keep going and the tracker status becomes stale or unavailable.
- If a running issue refreshes into a terminal state, the daemon interrupts the run and records a `tracker.reconciled` event.
- If a running issue refreshes into a non-active, non-terminal state, the daemon interrupts the run without cleaning up the workspace.
- Linear writes are disabled by default. The current milestone does not auto-transition issues or create comments in read-only mode.

Linear troubleshooting:

- `tracker.api_key is required`: export `LINEAR_API_KEY` in the daemon environment, keep `api_key: "$LINEAR_API_KEY"` in workflow config, then reload.
- Invalid API key: `GET /tracker/health` and the tracker panel show the GraphQL error without exposing the key.
- No issues returned: check `team_key`, `team_id`, `project_slug`, `project_id`, active states, and `include_archived`.
- Wrong team or project filter: use a smaller known-good filter first, or temporarily set `allow_workspace_wide: true` for local validation only.
- Rate limiting or GraphQL errors: the daemon records the tracker error, keeps cached issues, and leaves active runs running.
- Stale issue cache: click Refresh issues or inspect `GET /tracker/status` for `lastSyncAt` and `error`.
- Codex provider with Linear issue: confirm local Codex health, then start the run from the Linear card with provider `Codex`.

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
- `GET /tracker/status`
- `GET /tracker/health`
- `GET /issues`
- `POST /issues/refresh`
- `GET /issues/:issueId`
- `GET /issues/by-identifier/:identifier`
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

Workflow and tracker config responses are summaries and do not expose API keys or secrets.

## Manual Validation Flow

Mock mode:

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

Linear mode, when credentials are available:

1. Export `LINEAR_API_KEY`.
2. Configure `WORKFLOW.md` or `SYMPHONIA_WORKFLOW_PATH` with `tracker.kind: linear`, a small team/project filter, and read-only mode.
3. Run `pnpm dev`.
4. Open the issues page.
5. Confirm tracker status shows Linear and no secret values.
6. Click Refresh issues.
7. Confirm Linear issue cards show identifier, title, state, labels, priority, provider/run status, and a Linear link.
8. Open a Linear issue card and confirm issue URL, current state, last fetched time, workspace, prompt, and timeline sections.
9. Start a Mock run from a Linear issue and confirm the workspace path uses the Linear identifier.
10. Confirm the rendered prompt includes Linear title, description, labels, state, and URL.
11. Refresh the page and confirm the cached issue and persisted run timeline remain visible.
12. If local Codex is safe to run, start a Codex run from the Linear issue, then stop/interrupt it.
13. Change the issue state in Linear manually, refresh or wait for polling, and confirm Symphonia reflects the state change.
14. If a running issue becomes terminal, confirm reconciliation cancels the run and records a tracker event.
15. Confirm no Linear comments or state transitions occur while `read_only: true` and `write.enabled: false`.
16. Restore root `WORKFLOW.md` to mock mode before committing local credential-specific changes.

## SQLite Data

Run events are append-only in SQLite. The default path is `./.data/agentboard.sqlite`, relative to the daemon process. Workspaces are real folders under the configured workflow workspace root.

## Known Limitations

- GitHub PR/CI adapter is still not implemented.
- Claude Code provider is still not implemented.
- Cursor provider is still not implemented.
- Linear OAuth is not implemented.
- Linear webhooks are not implemented because Symphonia is local-first for now.
- Linear writes are disabled by default. Config flags exist, but read-only mode is the supported Milestone 4 path.
- Real Linear validation depends on `LINEAR_API_KEY` and accessible Linear workspace/team/project data.
- Advanced blocker/dependency handling is partial; issue selection does not yet map all Linear relationships.
- Real Codex validation depends on local Codex CLI installation and authentication.
- App-server event mapping covers the practical subset needed for Milestone 3, not every possible app-server event.
- WebSocket app-server transport is intentionally not implemented.
- Daemon restart reconstruction of active runs and approvals is not implemented yet.
- Workspace cleanup is not automatic.
- Assistant deltas are displayed compactly as timeline events rather than fully aggregated chat bubbles.
- Hooks execute trusted local shell commands.

## Next Milestone

Milestone 5 - Add GitHub PR/CI integration and review artifacts for Linear-backed Codex runs.
