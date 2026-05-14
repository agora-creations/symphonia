# Symphonia

Symphonia is a local-first control plane for real coding-agent work. It connects a real Linear tracker, local real providers (`codex`, `claude`, or `cursor`), local workspaces, SQLite timelines, GitHub review artifacts, and a repository harness builder into one desktop/browser workbench.

The platform is now real-data-first:

- Runtime providers are `codex`, `claude`, and `cursor`.
- Runtime tracking is Linear.
- The UI no longer exposes a mock provider, mock tracker, sample projects, sample teams, or seeded demo issues.
- Automated tests still use fake transports and temporary repositories so CI does not require provider, Linear, or GitHub credentials.
- GitHub and Linear writes remain disabled unless explicitly configured and confirmed.
- Secret values must stay in environment variables or ignored local env files; Symphonia stores env-var names and redacted summaries, not raw secrets.

## Install

```bash
pnpm install
```

If SQLite native bindings are stale after a Node version change:

```bash
pnpm --filter @symphonia/db rebuild better-sqlite3
```

## Real Configuration

`WORKFLOW.md` is the runtime contract. The committed starter is configured for Linear plus Codex:

```yaml
provider: codex

tracker:
  kind: linear
  api_key: "$LINEAR_API_KEY"
  allow_workspace_wide: true
  read_only: true
```

For a tighter beta or production setup, prefer a team or project scope:

```yaml
tracker:
  kind: linear
  api_key: "$LINEAR_API_KEY"
  team_key: "ENG"
  active_states: ["Todo", "In Progress", "Backlog"]
  terminal_states: ["Done", "Closed", "Canceled", "Duplicate"]
  read_only: true
```

Provider selection is controlled by `provider`, `agent.provider`, or `SYMPHONIA_PROVIDER` and must be one of:

- `codex`
- `claude`
- `cursor`

## Run Locally

```bash
pnpm dev
```

Default URLs:

- Web app: `http://localhost:3000`
- Daemon: `http://localhost:4100`

Useful environment variables:

- `LINEAR_API_KEY`
- `GITHUB_TOKEN` or `GITHUB_PAT`
- `SYMPHONIA_PROVIDER`
- `SYMPHONIA_CODEX_COMMAND`
- `SYMPHONIA_CLAUDE_COMMAND`
- `SYMPHONIA_CURSOR_COMMAND`
- `SYMPHONIA_DAEMON_PORT`
- `SYMPHONIA_DB_PATH`
- `SYMPHONIA_WORKFLOW_PATH`

## Desktop App

```bash
pnpm desktop:dev
pnpm desktop:build
pnpm desktop:package
```

Desktop first-run setup stores repository, workspace, database, provider, tracker, GitHub, Linear, and cleanup settings outside the repository. It does not store raw API keys. The renderer still cannot write arbitrary files directly; file writes go through validated daemon/IPC paths.

## Harness Builder

Harness Builder scans a selected repository and reports deterministic agent-readiness scores with evidence. It can preview starter artifacts such as:

- `AGENTS.md`
- `WORKFLOW.md`
- docs under `docs/`
- safe scripts under `scripts/`
- `skills/README.md`
- `.env.example`

Preview generation is read-only. Applying artifacts is dry-run by default and requires the confirmation string:

```text
APPLY HARNESS CHANGES
```

Generated docs are starter/inferred material and must be reviewed before relying on them.

CLI scan:

```bash
pnpm harness:scan --path .
pnpm harness:scan --path . --json
```

## APIs

Selected daemon endpoints:

- `GET /health`
- `GET /workflow/status`
- `POST /workflow/reload`
- `GET /tracker/status`
- `GET /tracker/health`
- `POST /issues/refresh`
- `GET /issues`
- `POST /runs` with `{ "issueId": "...", "provider": "codex" | "claude" | "cursor" }`
- `GET /runs/:runId/events`
- `POST /runs/:runId/stop`
- `POST /runs/:runId/retry`
- `GET /providers`
- `GET /providers/codex/health`
- `GET /providers/claude/health`
- `GET /providers/cursor/health`
- `GET /github/status`
- `GET /github/health`
- `POST /runs/:runId/review-artifacts/refresh`
- `POST /harness/scan`
- `POST /harness/previews`
- `POST /harness/apply`

## Validation

```bash
pnpm test
pnpm lint
pnpm build
pnpm desktop:build
pnpm desktop:package
git diff --check
pnpm harness:scan --path .
```

Automated tests use fake CLIs, fake fetch transports, temp databases, temp workspaces, and temp repositories. They do not require OpenAI, Anthropic, Cursor, Linear, or GitHub credentials.

## Safety

- Linear is read-only by default.
- GitHub is read-only by default.
- GitHub PR creation, push, comments, auto-merge, and Linear writes remain gated/deferred.
- Workspace cleanup is disabled and dry-run by default.
- Generated harness artifacts are never applied automatically.
- Existing files are not overwritten without diff preview and explicit confirmation.
- Scan payloads are bounded and avoid secret values.

## Known Limitations

- Scoring is deterministic and heuristic, not a guarantee of agent success.
- Generated docs are starter/inferred and need human review.
- Provider validation still depends on locally installed/authenticated provider CLIs.
- No cloud accounts, team sharing, OAuth onboarding, GitHub App install flow, Linear webhooks, GitHub webhooks, code signing, notarization, auto-update, or Tauri support yet.
