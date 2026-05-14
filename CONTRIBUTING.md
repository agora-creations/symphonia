# Contributing To Symphonia

Symphonia is a local-first desktop/browser workbench for real Linear issues, GitHub review artifacts and repository harnessing.

## Prerequisites

- Node.js 22 or newer for CI parity.
- pnpm 10.20.0 through Corepack or a local pnpm install.
- Git.

No OpenAI, Anthropic, Cursor, Linear, or GitHub user credentials are required to run tests. Tests use fake transports, fake provider CLIs, temporary databases, and temporary workspaces.

## Install

```bash
pnpm install
```

If SQLite bindings are stale after changing Node versions:

```bash
pnpm --filter @symphonia/db rebuild better-sqlite3
```

## Validate

Run the shared local validation surface before opening a PR:

```bash
pnpm validate
```

Focused commands:

```bash
pnpm validate:packages
pnpm validate:web
pnpm validate:daemon
pnpm validate:desktop
pnpm validate:harness
pnpm validate:packaging
```

`pnpm validate:packaging` builds the desktop app, creates the package, and inspects the artifact for forbidden runtime data.

## Run Locally

```bash
pnpm dev
```

Default endpoints:

- Web: `http://localhost:3000`
- Daemon: `http://localhost:4100`

Desktop mode:

```bash
pnpm desktop:dev
```

## Integration Safety

- CI must not use real Linear, GitHub, Codex, Claude, or Cursor credentials.
- GitHub and Linear writes remain disabled by default.
- Real write actions require `WORKFLOW.md` write flags plus explicit user confirmation.
- Do not commit `.env`, SQLite DBs, `.symphonia` workspaces, local settings, auth token stores, logs, or package output.

## Pull Requests

- Branch from the current mainline or the active milestone branch.
- Keep product changes separate from release/CI hardening when practical.
- Update `GOAL_PROGRESS.md` when completing milestone checkpoints.
- Include local command results in the PR body when the change affects runtime behavior.
- Do not claim remote CI passed until GitHub Actions reports it.

## Release Work

Release work is documented in [docs/RELEASE.md](docs/RELEASE.md) and [docs/PACKAGING.md](docs/PACKAGING.md). Draft releases are manual and gated. Code signing, notarization, Windows signing, and auto-update remain deferred.
