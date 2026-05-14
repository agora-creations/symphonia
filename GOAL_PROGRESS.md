# Goal Progress

## Real-Data-Only Platform Hardening

Objective: remove mock provider/tracker and non-real seeded platform surfaces so Symphonia is grounded in real Linear tracking, real provider configuration, real repository workspaces, and real review/harness flows.

## Starting State

- Branch started from clean `main`.
- Runtime still exposed a mock provider, mock tracker, seeded issue data, sample project/team/member pages, mock-first desktop defaults, mock-first harness workflow previews, and mock-first README guidance.
- Automated tests used mock provider and mock tracker behavior as runtime paths.

## Implemented

- Removed `mock` from shared runtime provider IDs.
- Removed `mock` from shared runtime tracker kinds.
- Removed mock provider and mock tracker source modules from `packages/core/src`.
- Replaced the mock-specific cancellation error with neutral `ProviderRunCancelledError`.
- Removed mock provider health from daemon provider listing and provider health routes.
- Removed mock tracker fallback issue loading from daemon run start, issue listing, refresh, workspace inventory, and recovery paths.
- Changed workflow defaults to `codex` provider and `linear` tracker.
- Changed root `WORKFLOW.md` to a real Linear/Codex starter with read-only tracker config and non-mock hooks.
- Changed desktop defaults to Linear/Codex.
- Changed desktop starter workflow generation to Linear/Codex.
- Changed desktop first-run copy and persisted defaults away from mock mode.
- Removed web sample data file and sample Projects, Members, and Teams routes/components.
- Changed the home route to `/issues`.
- Removed mock provider option from the Issues UI.
- Removed mock provider cards and mock tracker fallback text from the UI.
- Changed Harness Builder generated `WORKFLOW.md` previews to Linear/Codex.
- Changed harness scoring to reward real Linear tracker and real provider configuration.
- Updated tests to use real-shaped Linear issues with fake transports and fake provider commands only inside tests.
- Replaced README with current real-data-only setup, safety, API, validation, and known-limitations documentation.

## Validation

- `pnpm test` passed.
- `pnpm lint` passed.
- `pnpm build` passed.
- `pnpm desktop:build` passed.
- `pnpm desktop:package` passed.
- `git diff --check` passed.
- `pnpm harness:scan --path .` passed after rerun outside the restricted sandbox because `tsx` could not create its IPC pipe in the sandbox.

Harness scan result for this repository:

- Overall: 58% (`D`)
- Strong: Workflow Contract, Validation Loop, Provider Readiness, Symphonia Compatibility
- Partial/risky/missing: Repository Map, Documentation System, Safety And Secrets, Review Readiness, Observability And Debuggability, Accessibility And UX

## Runtime Policy

- Runtime providers: `codex`, `claude`, `cursor`.
- Runtime tracker: `linear`.
- No runtime mock provider.
- No runtime mock tracker.
- No sample project/team/member seeded UI.
- Test doubles remain allowed only inside automated tests.
- Real secret values must stay in environment variables or ignored local env files.
- GitHub/Linear writes remain disabled unless explicitly configured and confirmed.
- Workspace cleanup remains disabled and dry-run by default.

## Known Limitations

- Tests still use fake transports, but only as test doubles.
- Real provider runs require locally installed and authenticated provider CLIs.
- Linear/GitHub real-data validation still depends on local credentials/config.
- No GitHub PR creation, auto-push, auto-merge, GitHub comments, Linear comments, or Linear state transitions are enabled by default.
- No cloud/team harness sharing, OAuth onboarding, webhooks, code signing, notarization, auto-update, or Tauri support yet.
