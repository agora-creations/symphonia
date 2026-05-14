# Milestone 10 — Real GitHub and Linear connection flows

## Objective

Add real user-facing authentication paths for GitHub and Linear so users can connect integrations from Symphonia instead of relying only on manually exported environment variables.

This milestone must happen before the next larger product milestone.

## Implementation Status

Started on branch `milestone-10-real-auth-plan`.

Implemented:

- Shared auth domain schemas and secret-free auth event variants.
- Local token storage abstraction with test memory storage and encrypted local-file storage.
- Daemon `AuthManager` with connected/env/manual source priority.
- GitHub device-flow start/poll/validate/refresh/disconnect paths.
- Linear PKCE authorization URL, loopback callback, token exchange, validate/refresh/disconnect paths.
- Manual token mode.
- Daemon auth APIs.
- Settings -> Integrations cards.
- First-run optional integration validation/connect entry.
- Existing GitHub and Linear runtime paths can resolve connected tokens before env/config fallback.

## End State

A user can:

- Open Symphonia desktop or browser/dev mode.
- Go to Settings -> Integrations.
- See GitHub and Linear connection cards.
- Connect GitHub through a local/desktop-safe flow.
- See connected GitHub account and repository access status.
- Use the connected GitHub token for existing GitHub health and review artifact APIs.
- Disconnect GitHub and remove stored credentials.
- Connect Linear only through a flow confirmed safe by current official Linear docs, or use a documented manual/env fallback.
- See connected Linear workspace/user/team/project status.
- Use the connected Linear token for existing Linear tracker APIs.
- Disconnect Linear and remove stored credentials.
- Still use `GITHUB_TOKEN`, `GITHUB_PAT`, and `LINEAR_API_KEY` fallback modes.
- See whether each integration is using a connected token, env token, manual token, or no credential.
- Never see raw secrets in UI, logs, events, settings exports, diagnostics, README, or tests.

## Guardrails

- Do not embed GitHub or Linear client secrets in the packaged app.
- Do not store secrets in plain settings JSON.
- Do not expose tokens through renderer IPC.
- Do not expose tokens through daemon APIs.
- Do not log Authorization headers.
- Do not add GitHub PR creation yet.
- Do not enable GitHub writes by default.
- Do not enable Linear writes by default.
- Do not implement provider auth for Codex/Claude/Cursor in this milestone.
- Do not add cloud accounts or multi-tenancy.
- Do not break browser/web development mode.
- Do not make the frontend call GitHub or Linear directly.
- Do not reintroduce runtime Mock provider/tracker behavior if the real-data-only platform PR lands.

## Documentation Verification Required Before Coding

- Read current official GitHub OAuth/GitHub App docs.
- Read current official Linear OAuth docs.
- Confirm whether Linear supports a safe native/public OAuth flow, PKCE, loopback redirect, refresh tokens, and the required grant types/scopes.
- Record verified Linear behavior in `GOAL_PROGRESS.md`.

## Recommended GitHub Strategy

- Prefer GitHub App user authorization or OAuth device flow for desktop/local usage.
- Device flow is acceptable for local/desktop usage.
- Use least privilege.
- Store access tokens securely.
- Support refresh tokens when the chosen flow returns expiring user tokens.
- Keep env token fallback.

## Recommended Linear Strategy

- Implement Linear OAuth only after verifying official docs.
- If Linear supports safe native/public OAuth with PKCE, implement browser authorization with loopback callback and PKCE.
- If Linear requires a client secret, do not embed it. Use user-provided local OAuth credentials, env/manual token fallback, or document a future hosted token broker.
- Keep `LINEAR_API_KEY` fallback.

## Checkpoints

1. Auth domain model.
2. Secure token storage.
3. Auth manager service and daemon APIs.
4. GitHub auth provider.
5. Linear auth provider or documented safe fallback.
6. Desktop auth bridge.
7. Integrations UI.
8. Wire tokens into GitHub and Linear clients.
9. Token refresh and expiration.
10. Manual token mode.
11. Redacted auth diagnostics.
12. Documentation.
13. Automated tests without real credentials.
14. Manual validation where credentials are available.
15. Final validation.

## Required Validation

- `pnpm test`
- `pnpm lint`
- `pnpm build`
- `pnpm desktop:build`
- `pnpm desktop:package`
- `git diff --check`
- web/daemon smoke
- desktop smoke

## Suggested Next Milestone

Milestone 11 — Safely enable explicit GitHub PR creation and Linear run comments with connected auth.
