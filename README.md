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

## GitHub And Linear Connections

Milestone 10 adds local integration auth surfaces in Settings -> Integrations:

- GitHub device flow using `SYMPHONIA_GITHUB_CLIENT_ID`.
- Linear OAuth PKCE using `SYMPHONIA_LINEAR_CLIENT_ID` and a configured loopback redirect URI.
- Manual token fallback for local use.
- Environment fallback through `GITHUB_TOKEN`, `GITHUB_PAT`, and `LINEAR_API_KEY`.
- Validate, refresh, and disconnect actions.

The daemon owns integration credentials. The renderer never receives a raw token after submission, and normal settings JSON stores only non-secret preferences. Desktop mode points the daemon at an encrypted local auth store next to the desktop settings file.

GitHub auth follows the official device flow: Symphonia requests a device/user code, opens GitHub device authorization, then polls for completion. Device flow does not require embedding a client secret.

Linear auth follows the current official OAuth PKCE path: Symphonia builds an authorization URL with a code challenge, receives the loopback callback at `/auth/linear/callback`, exchanges the code with `code_verifier`, and stores the resulting token locally. Do not embed a Linear client secret in the app bundle. If your Linear OAuth application requires a secret or a different redirect, configure it locally or use `LINEAR_API_KEY`.

Verified references:

- GitHub device flow and GitHub App user tokens: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- GitHub OAuth App device flow: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
- Linear OAuth 2.0 and PKCE: https://linear.app/developers/oauth-2-0-authentication

Useful local auth variables:

- `SYMPHONIA_GITHUB_CLIENT_ID`
- `SYMPHONIA_LINEAR_CLIENT_ID`
- `SYMPHONIA_LINEAR_REDIRECT_URI`
- `SYMPHONIA_LINEAR_CLIENT_SECRET`, only for local developer-owned OAuth apps that require it
- `SYMPHONIA_AUTH_STORE_PATH`
- `SYMPHONIA_AUTH_STORAGE_KEY`, optional local encryption key override

## APIs

Selected daemon endpoints:

- `GET /health`
- `GET /auth/status`
- `GET /auth/connections`
- `POST /auth/github/start`
- `GET /auth/github/poll/:authSessionId`
- `POST /auth/github/validate`
- `POST /auth/github/refresh`
- `POST /auth/github/disconnect`
- `POST /auth/linear/start`
- `GET /auth/linear/callback`
- `POST /auth/linear/callback`
- `POST /auth/linear/validate`
- `POST /auth/linear/refresh`
- `POST /auth/linear/disconnect`
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
- Integration tokens are not stored in normal settings JSON.
- Auth APIs and events return redacted connection metadata only.
- Desktop external-link IPC is restricted to trusted GitHub, Linear, and local auth callback URLs.

## Known Limitations

- Scoring is deterministic and heuristic, not a guarantee of agent success.
- Generated docs are starter/inferred and need human review.
- Provider validation still depends on locally installed/authenticated provider CLIs.
- OS keychain storage is not wired into the daemon-owned token path yet; local storage uses an encrypted file with a local key and should be treated as local-beta storage.
- Linear workspace/team/project summaries are still minimal during auth validation; tracker configuration controls issue scope.
- GitHub writes remain disabled by default, and GitHub PR creation remains deferred.
- Linear writes remain disabled/deferred.
- Provider auth for Codex, Claude, and Cursor remains separate from GitHub/Linear integration auth.
- No cloud accounts, team sharing, GitHub App install flow, Linear webhooks, GitHub webhooks, code signing, notarization, auto-update, or Tauri support yet.

## Next Milestone

Milestone 11 should be `Safely enable explicit GitHub PR creation and Linear run comments with connected auth`.
