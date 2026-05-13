# Symphonia

Symphonia is a local-first visual orchestration prototype for coding-agent work. It is a Linear-like control plane for fetching tracker issues, starting Mock, Codex, Claude Code, or Cursor Agent runs, watching timelines, stopping/retrying work, reconciling active runs against repo-owned workflow configuration, and inspecting review artifacts from local git and GitHub.

Milestone 6 keeps the mock tracker, Linear tracker, mock provider, Codex provider, GitHub review artifacts, `WORKFLOW.md` runtime, workspaces, hooks, SQLite/SSE event flow, approvals, stop/retry, and UI stable, then adds Claude Code and Cursor Agent as CLI-stream providers. Automated tests use fake CLI scripts, so contributors do not need real Anthropic, Cursor, OpenAI, Linear, or GitHub credentials for validation.

This prototype still does not integrate GitHub OAuth, GitHub App installation flow, GitHub webhooks, auto-push, auto-merge, Linear OAuth, Linear webhooks, auth, billing, cloud tenancy, Electron, or Tauri. GitHub writes and PR creation remain disabled by default; PR creation is still deferred.

Reference: the Codex app-server integration follows the official OpenAI developer docs at <https://developers.openai.com/codex/app-server/>.
Claude Code CLI command-shape references: <https://docs.anthropic.com/en/docs/claude-code/cli-reference>. Cursor Agent CLI command-shape references: <https://docs.cursor.com/en/cli/reference/parameters> and <https://docs.cursor.com/en/cli/reference/output-format>.

## What Milestone 6 Includes

- The Milestone 1 mock tracker/provider loop remains available for tests and demos.
- The Milestone 2 `WORKFLOW.md` parser, config resolver, prompt renderer, workspace manager, and hook runner remain in the run lifecycle.
- Provider selection for `mock`, `codex`, `claude`, or `cursor` through the UI, run API, workflow config, or environment override.
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
- Claude Code provider adapter using CLI print mode with `stream-json` output, safe permission defaults, health checks, stderr diagnostics, result/usage metadata, stop/cancel, retry, and fake CLI tests.
- Cursor Agent provider adapter using CLI print mode with `stream-json` output, safe `force: false` default, health checks, stderr diagnostics, result/usage metadata, stop/cancel, retry, and fake CLI tests.
- A shared CLI stream runner for subprocess spawning, stdin prompts, NDJSON parsing, bounded payloads, timeouts, and abort cleanup.
- Provider health APIs and UI status for all four providers.
- SQLite append-only persistence for workflow, workspace, prompt, hook, mock, and Codex events.
- SQLite append-only persistence for Claude and Cursor stream events.
- Fake app-server tests, so automated validation does not require real Codex, network access, or OpenAI credentials.
- Fake Linear tests, so automated validation does not require Linear credentials, network access, or a real Linear workspace.
- Optional GitHub workflow config with token environment indirection and redacted summaries.
- Local git inspector that works without GitHub credentials and reports repo state, branch, base/head SHAs, dirty state, changed files, untracked files, diff stats, and bounded patch previews.
- Small GitHub REST client with fake-fetch tests for repo health, PR lookup, PR files, compare summaries, combined commit status, check runs, workflow runs, pagination, rate-limit diagnostics, and guarded PR creation.
- Review artifact snapshots persisted in SQLite and replayed through the existing run event timeline.
- Daemon APIs for GitHub status/health and review artifact fetch/refresh.
- UI provider controls, provider health, Claude/Cursor permission context, provider metadata, CLI event timelines, GitHub status, and a run detail Review Artifacts section for local git state, changed files, PR metadata, commit status, check runs, workflow runs, and manual refresh.
- GitHub writes remain disabled by default. Automatic PR creation, pushing, commenting, and merging are not part of the Milestone 6 provider-plural path.

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
- `SYMPHONIA_PROVIDER`: `mock`, `codex`, `claude`, or `cursor`; overrides workflow default provider.
- `SYMPHONIA_CODEX_COMMAND`: Codex app-server command, defaults to `codex app-server`.
- `SYMPHONIA_CLAUDE_COMMAND`: Claude Code command, defaults to `claude`.
- `SYMPHONIA_CURSOR_COMMAND`: Cursor Agent command, defaults to `cursor-agent`.
- `LINEAR_API_KEY`: Linear personal API key used when `tracker.kind: linear` and `tracker.api_key: "$LINEAR_API_KEY"` are configured.
- `GITHUB_TOKEN` or `GITHUB_PAT`: GitHub token used when `github.enabled: true` and `github.token: "$GITHUB_TOKEN"` or `"$GITHUB_PAT"` are configured. Local git review artifacts work without a token.
- `CURSOR_API_KEY`: optional Cursor Agent API key when local Cursor login is not used.

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

- `provider`: `mock`, `codex`, `claude`, or `cursor`.
- `tracker`: `kind`, `endpoint`, `api_key`, `team_key`, `team_id`, `project_slug`, `project_id`, `allow_workspace_wide`, `active_states`, `terminal_states`, `include_archived`, `page_size`, `max_pages`, `poll_interval_ms`, `read_only`, and `write`.
- `polling`: `interval_ms`.
- `workspace`: `root`.
- `hooks`: `after_create`, `before_run`, `after_run`, `before_remove`, `timeout_ms`.
- `agent`: `max_concurrent_agents`, `max_turns`, `max_retry_backoff_ms`, `max_concurrent_agents_by_state`.
- `codex`: `command`, `model`, `approval_policy`, `thread_sandbox`, `turn_sandbox_policy`, `turn_timeout_ms`, `read_timeout_ms`, `stall_timeout_ms`.
- `claude`: `enabled`, `command`, `model`, `max_turns`, `output_format`, `permission_mode`, `allowed_tools`, `disallowed_tools`, `append_system_prompt`, `extra_args`, `env`, `redacted_env_keys`, `health_check_command`, `timeout_ms`, `read_timeout_ms`, and `stall_timeout_ms`.
- `cursor`: `enabled`, `command`, `model`, `output_format`, `force`, `extra_args`, `env`, `redacted_env_keys`, `health_check_command`, `timeout_ms`, `read_timeout_ms`, and `stall_timeout_ms`.
- `github`: `enabled`, `endpoint`, `token`, `owner`, `repo`, `default_base_branch`, `remote_name`, `read_only`, `page_size`, `max_pages`, and `write`.

`workspace.root` supports `~`, `$VAR` or `${VAR}`, and relative paths. Relative paths resolve from the `WORKFLOW.md` directory. The effective root is always absolute.

`tracker.kind: mock` runs without credentials. `tracker.kind: linear` requires an API key after environment-variable resolution and at least one practical scope filter: `team_key`, `team_id`, `project_slug`, `project_id`, or `allow_workspace_wide: true`.

Workflow config responses are summaries and never expose `api_key`, GitHub `token`, provider env values, or resolved secrets.

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

## Claude Code and Cursor Providers

The root `WORKFLOW.md` keeps `provider: mock` and does not enable Claude or Cursor. Configure these providers in a local workflow override when the local CLIs are installed and authenticated.

Claude Code example:

```yaml
provider: claude
claude:
  enabled: true
  command: "claude"
  model: "sonnet"
  max_turns: 8
  output_format: "stream-json"
  permission_mode: "default"
  allowed_tools:
    - "Read"
    - "Grep"
    - "Bash(git status:*)"
    - "Bash(git diff:*)"
    - "Bash(pnpm test:*)"
  disallowed_tools:
    - "Bash(rm:*)"
    - "Bash(git push:*)"
  timeout_ms: 3600000
  stall_timeout_ms: 300000
  read_timeout_ms: 5000
```

Cursor Agent example:

```yaml
provider: cursor
cursor:
  enabled: true
  command: "cursor-agent"
  model: null
  output_format: "stream-json"
  force: false
  timeout_ms: 3600000
  stall_timeout_ms: 300000
  read_timeout_ms: 5000
```

Provider behavior:

- Claude and Cursor are CLI-stream providers. Symphonia spawns the configured command in the issue workspace, writes the rendered prompt through stdin, parses newline-delimited JSON, persists events, and streams them over SSE.
- Claude uses `claude -p --output-format stream-json --verbose --max-turns <n>` plus configured model, permission mode, allowed tools, disallowed tools, append-system-prompt, and extra args. The local Claude CLI requires `--verbose` with `stream-json` print mode.
- Cursor uses `cursor-agent --print --output-format stream-json` plus configured model, explicit `force: true` only when configured, and extra args.
- Codex app-server supports live approval requests in this milestone. Claude/Cursor CLI permissions are configured before run start; Symphonia does not fake live approval prompts for them.
- Stop cancels the underlying CLI subprocess and marks the run cancelled. Retry starts a fresh attempt and does not auto-resume Claude or Cursor sessions.
- GitHub review artifacts refresh after Claude/Cursor completion, failure, or cancellation when a workspace exists.
- Automated tests use fake CLI scripts and do not require real Claude or Cursor credentials.

Manual Claude validation:

1. Install and authenticate the local `claude` CLI.
2. Use a local workflow override with `claude.enabled: true`.
3. Run `SYMPHONIA_WORKFLOW_PATH=/absolute/path/to/claude.WORKFLOW.md pnpm dev`.
4. Select Claude Code in the UI, start a mock or Linear issue run, and inspect timeline events, session metadata, stop/retry, and review artifacts.

Manual Cursor validation:

1. Install and authenticate `cursor-agent`, or export `CURSOR_API_KEY`.
2. Use a local workflow override with `cursor.enabled: true` and `force: false`.
3. Run `SYMPHONIA_WORKFLOW_PATH=/absolute/path/to/cursor.WORKFLOW.md pnpm dev`.
4. Select Cursor Agent in the UI, start a mock or Linear issue run, and inspect timeline events, session/request metadata, stop/retry, and review artifacts.

Provider troubleshooting:

- `claude command not found`: install Claude Code or set `SYMPHONIA_CLAUDE_COMMAND`/`claude.command`.
- `cursor-agent command not found`: install Cursor Agent or set `SYMPHONIA_CURSOR_COMMAND`/`cursor.command`.
- Auth missing: complete local CLI login or provide supported provider environment variables in the daemon environment.
- Permission denial: adjust Claude `permission_mode`, `allowed_tools`, and `disallowed_tools`, or Cursor CLI settings. Do not enable dangerous modes casually.
- Malformed `stream-json`: Symphonia records a provider error and fails the run without crashing the daemon.
- Nonzero CLI exit: stderr is captured as diagnostics and the run fails gracefully.
- Long-running or stalled run: tune `timeout_ms`, `stall_timeout_ms`, and `read_timeout_ms`, or stop the run from the UI.
- Provider unavailable in UI: open the Workflow panel, check provider health, command, and enabled/configured state, then reload workflow.

## GitHub Review Artifacts

The root `WORKFLOW.md` keeps GitHub disabled for safe local development and CI. Local git artifact collection still runs without GitHub credentials. Configure GitHub only when you want repository health, existing PR metadata, PR files, combined commit status, check runs, and workflow runs.

Read-only GitHub example:

```yaml
github:
  enabled: true
  endpoint: "https://api.github.com"
  token: "$GITHUB_TOKEN"
  owner: "agora-creations"
  repo: "symphonia"
  default_base_branch: "main"
  remote_name: "origin"
  read_only: true
  page_size: 50
  max_pages: 3
  write:
    enabled: false
```

Optional PR creation config is recognized by the schema, but PR creation is deferred in Milestone 5. Keep these disabled until a later milestone adds a user-triggered create-PR flow:

```yaml
github:
  enabled: true
  token: "$GITHUB_TOKEN"
  owner: "agora-creations"
  repo: "symphonia"
  default_base_branch: "main"
  read_only: true
  write:
    enabled: false
    allow_create_pr: false
```

GitHub behavior:

- The frontend never calls GitHub directly. It only calls the local daemon.
- `GET /github/status` returns enabled/disabled state, safe config summary, last health check, last artifact refresh, and the last error.
- `GET /github/health` checks repository reachability when a token is configured.
- `GET /runs/:runId/review-artifacts` returns the latest persisted snapshot for a run.
- `POST /runs/:runId/review-artifacts/refresh` manually refreshes local git and GitHub artifacts, emits timeline events, and saves the latest snapshot.
- After workspace creation and after provider completion/failure/cancel, the daemon refreshes review artifacts when possible.
- If GitHub is disabled or no token is configured, Symphonia still reports local workspace git state.
- If GitHub API calls fail, refresh returns a partial snapshot and records a `github.error` event without changing the provider terminal status.
- GitHub writes are disabled by default. The daemon does not push, create PRs, comment, request reviewers, merge, or mutate GitHub in Milestone 5.

Minimal GitHub token permissions:

- Public repositories: unauthenticated local artifacts work, but API rate limits are lower. A token improves rate limits and private repo access.
- Private repositories: use a token with read access to repository contents, pull requests, commit statuses/checks, and Actions workflow runs.
- PR creation is deferred. Later write support will require explicit write permissions and explicit workflow flags.

GitHub troubleshooting:

- Token missing: `GET /github/status` shows GitHub unavailable, but local git artifacts still work.
- Token lacks permissions: `GET /github/health` shows the GitHub REST error without exposing the token.
- Repo not found: check `owner`, `repo`, token access, and `endpoint`.
- Branch not pushed: local git artifacts appear, but no matching PR, checks, or workflow runs may be found.
- No PR found: confirm the workspace branch name and that the branch has an open or closed PR in the configured repo.
- Checks missing: GitHub only returns checks/statuses that exist for the branch or PR head SHA.
- Workflow runs missing: Actions data depends on the repo having workflow runs for the branch or head SHA.
- Rate limit: status and timeline errors include safe rate-limit diagnostics; lower `page_size` or `max_pages` if needed.
- Large diffs: patch previews are bounded before being persisted.

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
- `before_run`: runs before every Mock, Codex, Claude, or Cursor provider run.
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
- `GET /github/status`
- `GET /github/health`
- `GET /issues`
- `POST /issues/refresh`
- `GET /issues/:issueId`
- `GET /issues/by-identifier/:identifier`
- `GET /issues/:issueId/review-artifacts`
- `GET /runs`
- `GET /runs/:runId`
- `GET /runs/:runId/events`
- `GET /runs/:runId/events/stream`
- `GET /runs/:runId/prompt`
- `GET /runs/:runId/review-artifacts`
- `POST /runs/:runId/review-artifacts/refresh`
- `POST /runs` with `{ "issueId": "...", "provider": "mock" | "codex" | "claude" | "cursor" }`
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
- `GET /providers/claude/health`
- `GET /providers/cursor/health`
- `GET /approvals`
- `GET /runs/:runId/approvals`
- `POST /approvals/:approvalId/respond`

Workflow, tracker, provider, and GitHub config responses are summaries and do not expose API keys, tokens, provider env values, or secrets.

## Manual Validation Flow

Mock mode:

1. Run `pnpm dev`.
2. Open the web app.
3. Confirm daemon and workflow status are healthy.
4. Confirm provider list shows Mock, Codex, Claude Code, and Cursor Agent.
5. Start a mock run and confirm the timeline still streams workflow, workspace, prompt, hook, and mock provider events.
6. Refresh and confirm persisted events remain visible.
7. Select Codex provider.
8. If Codex CLI is unavailable, confirm the UI shows unavailable or the run fails gracefully with a clear provider error.
9. If Codex CLI is available, start a Codex run and confirm workspace, rendered prompt, thread id, turn id, Codex events, and terminal status.
10. Respond to approval cards if Codex requests approval.
11. Interrupt an active Codex turn.
12. Retry a failed or cancelled Codex run.
13. Edit `WORKFLOW.md`, click Reload, start another run, and confirm the rendered prompt reflects the edit.

Claude/Cursor mode, when local CLIs are available:

1. Configure a local workflow override with `claude.enabled: true` or `cursor.enabled: true`.
2. Run `SYMPHONIA_WORKFLOW_PATH=/absolute/path/to/provider.WORKFLOW.md pnpm dev`.
3. Confirm provider health shows the configured CLI available.
4. Select Claude Code or Cursor Agent in the provider selector.
5. Start a mock or Linear issue run.
6. Confirm workflow, workspace, prompt, hook, provider stream, result, usage, and review artifact events appear in the timeline.
7. Stop a long-running CLI run if safe.
8. Retry a failed or cancelled run.
9. Confirm GitHub review artifacts refresh after provider completion when a workspace exists.
10. Confirm Codex approval UI remains unchanged and Claude/Cursor do not show fake live approval requests.

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

GitHub review artifacts, when credentials are available:

1. Export `GITHUB_TOKEN` or `GITHUB_PAT`.
2. Configure `WORKFLOW.md` or `SYMPHONIA_WORKFLOW_PATH` with `github.enabled: true`, `github.token: "$GITHUB_TOKEN"`, owner/repo, and `read_only: true`.
3. Run `pnpm dev`.
4. Confirm GitHub status shows enabled and no secret values.
5. Confirm GitHub health succeeds.
6. Start a mock provider run from a mock or Linear issue.
7. Open the run detail panel and confirm Review Artifacts shows workspace path, git repo state, branch, base branch, head SHA, dirty/clean state, and changed file count.
8. If the workspace branch has a PR, confirm PR title, number, URL, state, draft/ready status, head/base branches, and PR files appear.
9. Confirm combined commit status, check runs, and workflow runs appear when the configured repo has them for the head SHA.
10. Click Refresh review artifacts and confirm a new timeline event is recorded.
11. Refresh the browser and confirm persisted review artifacts and timeline events remain visible.
12. Start a Codex provider run if safe and confirm artifacts refresh after the run.
13. Keep GitHub writes disabled and confirm no PR is created automatically.

## SQLite Data

Run events are append-only in SQLite. The daemon also stores the latest issue cache and latest review artifact snapshot per run. The default path is `./.data/agentboard.sqlite`, relative to the daemon process. Workspaces are real folders under the configured workflow workspace root.

## Known Limitations

- Claude/Cursor live approval protocols are not implemented like Codex app-server approvals.
- Claude/Cursor continuation and resume are stored only as session/request metadata; automatic continuation is not implemented.
- Real Claude validation depends on local Claude Code installation and authentication.
- Real Cursor validation depends on local Cursor Agent installation and authentication or `CURSOR_API_KEY`.
- Provider stream event mapping covers the practical Milestone 6 subset and ignores unknown future fields.
- GitHub OAuth is not implemented.
- GitHub App installation flow is not implemented.
- GitHub webhooks are not implemented.
- Auto-push, auto-merge, GitHub comments, reviewer requests, and automatic PR creation are not implemented.
- GitHub writes are disabled by default. PR creation is deferred to a later user-triggered write milestone.
- Real GitHub validation depends on `GITHUB_TOKEN` or `GITHUB_PAT` and repository access.
- CI/check visibility depends on the configured repository having statuses, check runs, and workflow runs for the branch or head SHA.
- Large local and PR diffs may be truncated before persistence.
- Linear OAuth is not implemented.
- Linear webhooks are not implemented because Symphonia is local-first for now.
- Linear writes are disabled by default. Config flags exist, but read-only mode is the supported path.
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

Milestone 7 - Add daemon restart reconstruction, run recovery, and workspace cleanup policies.
