# Goal Progress

## Milestone 12 Starting State — 2026-05-14

Objective:

- Add CI workflows, release automation, production packaging hardening, contributor quality gates, and artifact inspection while preserving Milestones 1 through 11 behavior.

Starting repo state:

- Current branch at start: `milestone-11-safe-writes`.
- New working branch: `milestone-12-ci-release`.
- Base commit: `d7367e9` (`Fix write-action audit edge cases`), clean working tree before edits.
- No `.github/workflows` directory existed at start, so pull requests currently have no repository-defined CI checks.
- Milestone 11 safe write actions are committed on the branch; GitHub/Linear writes remain disabled by default and must stay that way in CI.

Verified CI and packaging documentation:

- GitHub Actions workflow syntax: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
  - Workflows are YAML files with triggers, jobs, steps, and `workflow_dispatch` inputs.
  - `permissions` can be set at workflow and job level.
- GitHub `GITHUB_TOKEN` permissions: https://docs.github.com/en/actions/security-guides/automatic-token-authentication
  - Least privilege should be enforced by limiting token permissions to the minimum required.
- GitHub Actions `setup-node`: https://github.com/actions/setup-node
  - pnpm caching must be configured explicitly with `cache: pnpm` and a dependency path.
- GitHub artifact upload: https://github.com/marketplace/actions/upload-a-build-artifact
  - Uploaded artifacts must be deliberately scoped and validated before upload.
- Electron Packager options: https://electron.github.io/packager/main/interfaces/Options.html
  - `ignore` patterns control files copied into the app bundle.

Planned checkpoints:

1. Add root validation scripts that local contributors and CI can share.
2. Add deterministic desktop artifact inspection and package exclusion tests.
3. Add least-privilege PR/push CI, packaging, release dry-run, and gated draft-release workflows.
4. Add contributor, CI, release, packaging, security, changelog, and version metadata docs.
5. Keep review artifacts check-state copy clear for “no checks” and check result states.
6. Run focused validation after tooling changes and full validation before publish.

CI strategy:

- PR/push CI should require no external credentials, no real provider CLIs, no real GitHub/Linear writes, and no network beyond dependency install.
- Default workflow permissions should be `contents: read`.
- Release workflow permissions should elevate to `contents: write` only in the gated release job.
- CI should run the same deterministic surface as local validation: tests, lint, build, desktop build, harness scan, and whitespace diff check.

Release strategy:

- Add package artifact and release dry-run workflows with `workflow_dispatch`.
- Add a gated draft-release workflow only with explicit inputs and draft release creation.
- Do not publish public releases, auto-update feeds, signed/notarized artifacts, or automatic releases in this milestone.

Packaging hardening strategy:

- Inspect packaged desktop output after `pnpm desktop:package`.
- Fail if package artifacts contain `.env` files, SQLite DBs, `.symphonia` workspaces, settings/auth files, logs, coverage, or test fixtures.
- Record package size and app metadata.
- Preserve the current staged Electron Packager approach while documenting that fully bundled runtime, signing, notarization, and auto-update remain deferred.

Validation commands:

- Focused: `pnpm desktop:inspect-artifact`, `pnpm --filter @symphonia/desktop test`, and package/tooling builds.
- Final: `pnpm validate`, `pnpm test`, `pnpm lint`, `pnpm build`, `pnpm desktop:build`, `pnpm desktop:package`, `pnpm desktop:inspect-artifact`, `pnpm harness:scan --path .`, `git diff --check`, web smoke, and desktop smoke.

Known release limitations:

- Code signing, notarization, Windows signing, and auto-update are not implemented.
- Cross-platform packaging is expected to begin with the currently realistic macOS packaging path.
- Real remote GitHub Actions validation depends on pushing this branch/PR; local validation cannot prove remote runner behavior.

Checkpoint 1, 6, 10, and 13 progress:

- Added root validation scripts: `validate`, `validate:packages`, `validate:web`, `validate:daemon`, `validate:desktop`, `validate:harness`, `validate:packaging`, and `validate:ci`.
- Added `pnpm desktop:inspect-artifact` backed by `apps/desktop/scripts/inspect-artifact.mjs`.
- Artifact inspection checks physical package files and `app.asar` contents for `.env`, `.symphonia`, `.data`, SQLite DBs, settings/auth token JSON, logs, coverage, tests, fixtures, package-manager cache, and desktop staging output.
- Hardened desktop packaging by deriving the package version from root `package.json`, expanding Electron Packager ignore patterns, and pruning dependency source/test material from staged `zod`.
- Added desktop tests for package inspection success, environment-file rejection, and `app.asar` test-file rejection.
- Focused validation:
  - `pnpm --filter @symphonia/desktop test`: passed.
  - `pnpm --filter @symphonia/daemon build`: passed.
  - `pnpm --filter @symphonia/web lint`: passed.
  - `pnpm --filter @symphonia/desktop build`: passed.
  - `pnpm validate:packaging`: passed; artifact inspection reported 275 physical files, 389 `app.asar` files, 436.9 MiB, and package exclusions passed.

Checkpoint 2 through 5 and 12 progress:

- Added `.github/workflows/ci.yml` with PR, push-to-main, and manual triggers.
- CI jobs cover install/cache, test, lint, build, desktop build, harness scan, and whitespace diff check.
- Normal CI permissions are `contents: read`.
- Added `.github/workflows/package-desktop.yml` for manual/tag desktop packaging on the current macOS host runner with artifact upload after package inspection.
- Added `.github/workflows/release-dry-run.yml` for manual validation, packaging, release-notes preview, and safe artifact upload without publishing.
- Added `.github/workflows/release.yml` as a manual gated draft-release workflow. It requires an existing tag and the exact confirmation phrase `CREATE DRAFT RELEASE`; only that job has `contents: write`.
- Release workflow inputs are validated and passed through step environment variables before shell use.
- Added `.github/dependabot.yml` with monthly npm and GitHub Actions update PRs and no auto-merge.
- Added `.github/release.yml` release-note categories.
- Added `scripts/release-notes-preview.mjs`.
- Workflow YAML parsing smoke passed using the repo `yaml` dependency.

Checkpoint 7 and 11 progress:

- Daemon `/healthz` now includes the root package version.
- Desktop package metadata is derived from the root package version.
- Review artifacts UI now renders a clear no-checks state: “No GitHub checks are currently reported” plus refresh guidance.

Checkpoint 8 and documentation progress:

- Added `CONTRIBUTING.md`.
- Added `docs/CI.md`.
- Added `docs/RELEASE.md`.
- Added `docs/PACKAGING.md`.
- Added `docs/SECURITY.md`.
- Added `CHANGELOG.md`.
- Updated `README.md` with validation commands, CI workflows, packaging inspection, release paths, least-privilege permissions, and known release limitations.
- Focused validation:
  - `pnpm lint`: passed.

Checkpoint 9, 14, and 15 validation:

- CI-safe test audit:
  - Existing automated tests continue to use fake GitHub/Linear transports, fake provider CLIs, temporary repositories, temporary DBs, and temporary workspaces.
  - No tests require real provider CLIs or real GitHub/Linear credentials.
  - Desktop managed-process cleanup was hardened after smoke testing exposed an orphan daemon process when stopping Electron dev with SIGINT.
  - `ManagedProcess` now starts non-Windows children in a process group and stops the process group to clean up nested pnpm/tsx/Next children.
- Full local validation:
  - `pnpm test`: passed.
  - `pnpm lint`: passed.
  - `pnpm build`: passed.
  - `pnpm desktop:build`: passed.
  - `pnpm validate`: passed after escalated rerun because sandboxed `tsx` cannot create its IPC pipe.
  - `pnpm validate:packaging`: passed.
  - `pnpm desktop:package`: passed.
  - `pnpm desktop:inspect-artifact`: passed.
  - `pnpm harness:scan --path .`: passed after escalated rerun because sandboxed `tsx` cannot create its IPC pipe.
  - `git diff --check`: passed.
- Harness scan:
  - Result: 68% (`D`).
  - Strong: Workflow Contract, Validation Loop, Provider Readiness, Review Readiness, Symphonia Compatibility.
  - Partial/missing/risky: Repository Map, Documentation System, Safety And Secrets, Observability And Debuggability, Accessibility And UX.
  - Warning: skipped large file content for `symphonia/public/banner.png`.
- Packaging artifact:
  - Current package: `apps/desktop/out/Symphonia-darwin-arm64`.
  - Inspection result: 275 physical files, 389 `app.asar` files, 436.9 MiB, metadata present, app binary present, `app.asar` present, package exclusions passed.
- Web/daemon smoke:
  - Escalated `SYMPHONIA_DAEMON_PORT=4112 PORT=3012 NEXT_PUBLIC_DAEMON_URL=http://127.0.0.1:4112 pnpm dev`.
  - Daemon `GET /healthz`: 200.
  - Daemon `GET /auth/status`: 200.
  - Daemon `GET /writes/status`: 200.
  - Web `GET /issues`: 200.
  - Web `GET /harness`: 200.
  - Web `GET /settings`: 200.
  - Dev processes stopped with SIGINT.
- Desktop smoke:
  - Escalated `SYMPHONIA_DESKTOP_SETTINGS_DIR=/private/tmp/symphonia-m12-desktop-settings-2 pnpm desktop:dev`.
  - Daemon `GET /healthz`: 200.
  - Daemon `GET /auth/status`: 200.
  - Daemon `GET /writes/status`: 200.
  - Web `GET /settings`: 200.
  - After shutdown, `:4100` and `:3000` no longer had listeners.
- Remote CI validation:
  - First PR run reported checks successfully.
  - Initial `Harness scan` job failed because it ran `pnpm harness:scan --path .` before building `@symphonia/types`; the scanner imports the workspace package `dist` output in CI.
  - Fixed `.github/workflows/ci.yml` to run `pnpm build:packages` before the harness scan job.
  - Remote rerun on PR #12 passed: Install and cache, Test, Lint, Build, Desktop build, Harness scan, and Whitespace diff check all passed.

Final implemented files/directories:

- `.github/workflows/ci.yml`
- `.github/workflows/package-desktop.yml`
- `.github/workflows/release-dry-run.yml`
- `.github/workflows/release.yml`
- `.github/dependabot.yml`
- `.github/release.yml`
- `scripts/release-notes-preview.mjs`
- `apps/desktop/scripts/inspect-artifact.mjs`
- `apps/desktop/test/artifact-inspector.test.ts`
- `CONTRIBUTING.md`
- `docs/CI.md`
- `docs/RELEASE.md`
- `docs/PACKAGING.md`
- `docs/SECURITY.md`
- `CHANGELOG.md`
- Updates to `README.md`, `package.json`, `apps/desktop/package.json`, `apps/desktop/scripts/package.mjs`, `apps/desktop/src/main/process-manager.ts`, `apps/daemon/src/daemon.ts`, and `apps/web/components/issues-view.tsx`.

Known Milestone 12 limitations:

- Code signing is not implemented.
- macOS notarization is not implemented.
- Windows signing is not implemented.
- Auto-update is not implemented.
- Fully bundled daemon/web runtime remains deferred; desktop development still starts managed processes from the configured checkout.
- Cross-platform packaging is partial; current artifact validation covers the macOS host package.
- Real GitHub Actions validation depends on pushing the branch/PR.
- Release workflow creates a draft release only and requires an existing tag plus manual confirmation.
- External GitHub/Linear write actions remain explicit and disabled by default.

Recommended next milestone:

`Milestone 13 — Bundle the daemon/web runtime inside the desktop package and add signing/notarization preparation.`

## Milestone 11 Starting State — 2026-05-14

Objective:

- Safely enable explicit GitHub PR creation and Linear run comments using connected/env/manual auth, with write previews, confirmation-gated execution, persisted audit history, run timeline events, and UI controls.

Starting repo state:

- Current branch: `milestone-11-safe-writes`.
- Base commit: `21551a3` (`main` / `origin/main`), merge of PR #10.
- Working tree at start: clean.
- Milestone 10 auth layer is committed on `main`.
- GitHub/Linear reads, auth, Harness Builder, desktop, daemon, SQLite/SSE, recovery, cleanup, and provider behavior must remain stable.

Verified write documentation:

- GitHub REST pull requests: https://docs.github.com/en/rest/pulls/pulls
  - `POST /repos/{owner}/{repo}/pulls` creates pull requests.
  - Fine-grained tokens need `Pull requests` repository permission for writes.
  - Listing pull requests requires `Pull requests` read permission.
- GitHub REST issue comments: https://docs.github.com/en/rest/issues/comments
  - Pull requests are issues for top-level PR comments.
  - `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` creates issue/PR comments and can trigger notifications.
- Linear GraphQL API and SDK docs: https://linear.app/developers/graphql and https://linear.app/developers/sdk-fetching-and-modifying-data
  - API endpoint is `https://api.linear.app/graphql`.
  - SDK exposes `createComment({ issueId })`; GraphQL mutation is `commentCreate`.
- Linear OAuth/PKCE docs: https://linear.app/developers/oauth-2-0-authentication
  - PKCE token exchange can use `client_id` and `code_verifier`; `client_secret` is optional for PKCE and must not be embedded.

Planned checkpoints:

1. Add shared write-action schemas/events and workflow write-policy defaults.
2. Add write preflight, GitHub PR client/service, and Linear comment client/service.
3. Persist write previews/results and expose daemon APIs.
4. Add run-detail Write Actions UI and settings guidance.
5. Update README and final milestone notes.
6. Run focused tests after each checkpoint and full validation at the end.

Write-safety policy:

- Writes remain disabled by default.
- `github.read_only: true`, `github.write.enabled: false`, `github.write.allow_create_pr: false`, and `github.write.allow_push: false` block GitHub writes unless explicitly changed.
- `tracker.write.enabled: false`, `tracker.write.allow_comments: false`, and `tracker.write.allow_state_transitions: false` block Linear writes unless explicitly changed.
- Every write requires preview, visible blockers/warnings, confirmation phrase, immediate preflight revalidation, redacted persisted history, and timeline events.
- No auto-merge, no force-push, no automatic GitHub/Linear comments, and no Linear state transitions.
- Branch push is deferred unless it can be safely gated; PR preview warns that the branch must already be present on GitHub, and GitHub returns an actionable create failure when it is not.
- Renderer must never receive raw tokens; APIs/events/SQLite/diagnostics store only redacted credential/source summaries.

Validation commands:

- Focused: package/type builds and targeted Vitest files for each checkpoint.
- Final: `pnpm test`, `pnpm lint`, `pnpm build`, `pnpm desktop:build`, `pnpm desktop:package`, `pnpm harness:scan --path .`, `git diff --check`, web smoke, desktop smoke.

Known starting limitations:

- Real GitHub/Linear write validation will require connected credentials and safe test resources; fake tests must cover the milestone without credentials.
- Auto-push is expected to remain disabled/deferred unless a safe explicit push service is implemented.
- GitHub comments/reviewer requests, GitHub issue creation, Linear issue creation, and Linear state transitions remain out of scope.

Checkpoint 1 and 2 progress:

- Added shared write-action schemas for policies, previews, execution requests, results, GitHub PR payloads, branch-push preview payloads, Linear comment payloads, write API responses, and write timeline events.
- Extended workflow config resolution with explicit default-disabled GitHub and Linear write policies.
- Updated root `WORKFLOW.md` to document safe disabled write defaults.
- Branch push remains deferred and disabled by default.
- Focused validation:
  - `pnpm --filter @symphonia/types build`: passed.
  - `pnpm --filter @symphonia/core build`: passed after rebuilding types.
  - `pnpm --filter @symphonia/core test -- workflow`: passed.
  - `pnpm --filter @symphonia/types test`: passed.

Checkpoint 3 through 12 progress:

- Added deterministic write orchestration in `packages/core/src/integration-writes.ts` for GitHub PR previews/creates and Linear comment previews/creates.
- Extended `packages/core/src/linear-client.ts` with the verified `commentCreate` mutation for issue comments.
- Reused the existing GitHub REST client `POST /repos/{owner}/{repo}/pulls` operation behind service-level policy and confirmation guards.
- Added SQLite persistence for `integration_write_actions`, including redacted previews, results, external IDs/URLs, and idempotency-key lookup.
- Added daemon write APIs:
  - `GET /writes/status`
  - `GET /runs/:runId/write-actions`
  - `POST /runs/:runId/github/pr/preview`
  - `POST /runs/:runId/github/pr/create`
  - `POST /runs/:runId/linear/comment/preview`
  - `POST /runs/:runId/linear/comment/create`
- Added timeline events for write preview, blockers, confirmation, start, success/failure, GitHub PR creation, and Linear comment creation.
- Added run-detail Write Actions UI backed by the daemon APIs. The panel shows provider policy, credential source, blockers, warnings, preview body, confirmation input, result URL, and write history.
- GitHub branch push remains deferred. Symphonia does not push, force-push, push tags, or auto-merge.
- GitHub comments/reviewer requests and Linear state transitions remain deferred.

Focused validation:

- `pnpm --filter @symphonia/db build`: passed.
- `pnpm --filter @symphonia/db test`: passed.
- `pnpm --filter @symphonia/daemon build`: passed.
- `pnpm --filter @symphonia/daemon test`: passed, including fake GitHub PR create and fake Linear comment create API coverage.
- `pnpm --filter @symphonia/web lint`: passed.

Final Milestone 11 validation:

- `pnpm test`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed.
- `pnpm desktop:build`: passed.
- `pnpm desktop:package`: passed.
- `git diff --check`: passed.
- `pnpm harness:scan --path .`: passed after escalated rerun because `tsx` IPC pipe creation is blocked by the sandbox.

Harness scan validation:

- Result: 55% (`D`).
- Strong: Workflow Contract, Validation Loop, Provider Readiness, Symphonia Compatibility.
- Missing/partial/risky: Repository Map, Documentation System, Safety And Secrets, Review Readiness, Observability And Debuggability, Accessibility And UX.
- Warning: skipped large file content for `symphonia/public/banner.png`.

Web/daemon smoke:

- First sandboxed `pnpm dev` attempt failed because `tsx` could not create its IPC pipe.
- Escalated `SYMPHONIA_DAEMON_PORT=4111 PORT=3011 NEXT_PUBLIC_DAEMON_URL=http://127.0.0.1:4111 pnpm dev`: daemon started and web loaded.
- `GET http://127.0.0.1:4111/healthz`: 200.
- `GET http://127.0.0.1:4111/auth/status`: 200, redacted auth state only.
- `GET http://127.0.0.1:4111/writes/status`: 200, GitHub and Linear writes disabled by default.
- `GET http://127.0.0.1:3011/issues`: 200.
- `GET http://127.0.0.1:3011/harness`: 200.
- `GET http://127.0.0.1:3011/settings`: 200.
- `GET http://127.0.0.1:3011/projects`: 200.
- Dev processes were stopped with SIGINT after smoke validation.

Desktop smoke:

- Temporary desktop settings directory: `/private/tmp/symphonia-m11-desktop-settings`.
- `SYMPHONIA_DESKTOP_SETTINGS_DIR=/private/tmp/symphonia-m11-desktop-settings pnpm desktop:dev`: Electron built and launched; managed daemon/web processes started.
- `GET http://127.0.0.1:4120/healthz`: 200.
- `GET http://127.0.0.1:4120/auth/status`: 200, redacted auth state only.
- `GET http://127.0.0.1:4120/writes/status`: 200, writes disabled by default.
- `GET http://127.0.0.1:3000/settings`: 200.
- Settings persisted `lastOpenedAt`.
- Desktop app was stopped with SIGINT; follow-up curls to `:4120` and `:3000` failed to connect, confirming no orphaned managed processes.

Fake write validation:

- GitHub PR preview/create daemon test uses a temporary git workspace, fake GitHub fetch, env-token credential source, explicit `CREATE GITHUB PR` confirmation, idempotency key, persisted write history, and timeline events. It verifies the wrong confirmation is rejected and no token is serialized in responses/events.
- Linear comment preview/create daemon test uses fake Linear GraphQL, env-token credential source, explicit `POST LINEAR COMMENT` confirmation, idempotency key, persisted write history, and timeline events. It verifies the wrong confirmation is rejected and no token is serialized in responses/events.
- Core tests cover disabled writes, missing credentials, protected branch blocker, existing PR blocker, unknown template variable blocker, branch-push deferral warning, Linear disabled/no-token blockers, Linear state-transition rejection, and redaction.

Real write validation:

- Not performed in this milestone run. Real GitHub PR creation and Linear comment posting require connected credentials plus an explicitly safe repository/branch and Linear issue with writes enabled in `WORKFLOW.md`.

Implemented files/directories:

- `packages/types/src/index.ts`
- `packages/core/src/integration-writes.ts`
- `packages/core/src/linear-client.ts`
- `packages/core/src/workflow.ts`
- `packages/core/src/index.ts`
- `packages/db/src/event-store.ts`
- `apps/daemon/src/daemon.ts`
- `apps/web/lib/api.ts`
- `apps/web/components/issues-view.tsx`
- `WORKFLOW.md`
- `README.md`
- Tests in `packages/types/test`, `packages/core/test`, `packages/db/test`, and `apps/daemon/test`.

Known Milestone 11 limitations:

- Auto-merge is not implemented.
- Auto-push is not implemented. Symphonia does not push branches; push a throwaway branch manually before creating a PR.
- GitHub top-level comments, reviewer requests, issue creation, and branch deletion are deferred.
- Linear issue creation and state transitions remain disabled/deferred.
- Real write validation depends on connected credentials and safe test resources.
- Provider auth for Codex, Claude, and Cursor remains separate.
- Browser-only mode still has weaker secure-storage guarantees than desktop.

Recommended next milestone:

`Milestone 12 — Add CI workflows, release automation, and production packaging hardening.`

## Milestone 10 Implementation Status — 2026-05-14

Implemented files/directories:

- `packages/types/src/index.ts`: auth provider/method/status/connection/start/poll/callback/disconnect/validation schemas plus redacted auth event variants.
- `packages/core/src/token-storage.ts`: memory token store and encrypted local-file token store with redacted fingerprints.
- `packages/core/src/auth-manager.ts`: AuthManager for GitHub device flow, Linear PKCE loopback, manual token mode, env fallback, validation, refresh, disconnect, and credential resolution.
- `apps/daemon/src/daemon.ts`: `/auth/*` APIs, auth event emission, connected-token wiring for GitHub health/review artifacts and Linear issue refresh.
- `apps/web/app/settings/page.tsx`, `apps/web/lib/api.ts`: Settings -> Integrations cards for connect, validate, refresh, disconnect, manual token submission, and credential-source status.
- `apps/web/components/desktop-setup.tsx`: optional first-run integration checks.
- `apps/desktop/src/shared/schemas.ts`, `apps/desktop/src/main/desktop-services.ts`: trusted auth URL allowlist and desktop auth store placement.
- `packages/db/src/event-store.ts`: skips legacy incompatible run rows instead of crashing daemon startup.
- Tests added/updated in `packages/types/test`, `packages/core/test`, `packages/db/test`, `apps/daemon/test`, and `apps/desktop/test`.

Verified auth documentation:

- GitHub device flow and GitHub App user tokens: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- GitHub OAuth App device flow: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
- Linear OAuth 2.0 and PKCE: https://linear.app/developers/oauth-2-0-authentication

Auth methods implemented:

- GitHub: device flow with configurable `SYMPHONIA_GITHUB_CLIENT_ID`, env fallback through `GITHUB_TOKEN`/`GITHUB_PAT`, manual token fallback, validation, disconnect, and refresh when a refresh token is present.
- Linear: OAuth PKCE loopback with configurable `SYMPHONIA_LINEAR_CLIENT_ID` and `SYMPHONIA_LINEAR_REDIRECT_URI`, optional locally supplied `SYMPHONIA_LINEAR_CLIENT_SECRET` for developer-owned apps, env fallback through `LINEAR_API_KEY`, manual token fallback, validation, revoke-on-disconnect best effort, disconnect, and refresh when a refresh token is present.

Secret storage strategy:

- Renderer never receives raw stored tokens after submission.
- Auth APIs return redacted connection metadata only.
- Settings JSON stores non-secret preferences only.
- Desktop-managed daemon uses an encrypted local auth store beside desktop settings.
- Browser/dev daemon uses env/manual token modes plus the same daemon-owned encrypted local auth store when configured.
- OS keychain storage remains a documented future improvement; no client secret is embedded in the app.

Final validation results:

- `pnpm --filter @symphonia/types build`: passed.
- `pnpm --filter @symphonia/core build`: passed.
- `pnpm --filter @symphonia/daemon build`: passed.
- `pnpm --filter @symphonia/web build`: passed.
- `pnpm --filter @symphonia/desktop build`: passed.
- `pnpm --filter @symphonia/core test`: passed.
- `pnpm --filter @symphonia/db test`: passed.
- `pnpm --filter @symphonia/daemon test`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed.
- `pnpm test`: passed.
- `pnpm desktop:build`: passed.
- `pnpm desktop:package`: passed.
- `git diff --check`: passed.
- `pnpm harness:scan --path .`: passed after rerun outside the sandbox because `tsx` could not create its IPC pipe inside the sandbox.

Smoke validation:

- Web/daemon isolated smoke on `SYMPHONIA_DAEMON_PORT=4110` and `PORT=3010`: daemon health 200, auth status 200, Settings 200, Harness 200.
- Existing daemon on `:4100`: health 200 and auth status 200.
- Desktop dev smoke with temporary settings directory: Electron build completed and app launched; process was manually stopped with SIGINT after startup.

Harness scan validation:

- Result: 55% (`D`).
- Strong: Workflow Contract, Validation Loop, Provider Readiness, Symphonia Compatibility.
- Missing/partial/risky: Repository Map, Documentation System, Safety And Secrets, Review Readiness, Observability And Debuggability, Accessibility And UX.

Known limitations:

- GitHub writes remain disabled by default and PR creation remains deferred.
- Linear writes remain disabled/deferred.
- GitHub App install selection and richer repository permission summaries are not implemented yet.
- Linear workspace/team/project summaries are minimal during auth validation; tracker configuration still controls issue scope.
- Browser/dev mode does not provide OS keychain storage.
- Provider auth for Codex, Claude, and Cursor remains separate.
- No hosted OAuth token broker, cloud accounts, team auth, webhooks, code signing, notarization, auto-update, or Tauri support yet.

Recommended next milestone:

`Milestone 11 — Safely enable explicit GitHub PR creation and Linear run comments with connected auth.`
