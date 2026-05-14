# CI

Symphonia uses GitHub Actions to make future PRs trustworthy without using real credentials or real external writes.

## Workflows

- `.github/workflows/ci.yml`
  - Runs on pull requests, pushes to `main`, and manual dispatch.
  - Jobs: install/cache, test, lint, build, desktop build, harness scan, and whitespace diff check.
  - Uses workflow-level `permissions: contents: read`.
- `.github/workflows/package-desktop.yml`
  - Runs on manual dispatch and `v*` tags.
  - Builds the desktop package on a macOS host, runs artifact inspection, archives the package, and uploads it as a workflow artifact.
  - Uses `permissions: contents: read`.
- `.github/workflows/release-dry-run.yml`
  - Runs on manual dispatch.
  - Runs full validation, packaging, artifact inspection, and release notes preview.
  - Uploads dry-run artifacts but does not create a GitHub release.
- `.github/workflows/release.yml`
  - Runs on manual dispatch only.
  - Requires the exact confirmation phrase `CREATE DRAFT RELEASE`.
  - Requires an existing tag.
  - Elevates to `contents: write` only inside the gated draft-release job.

## Local Equivalents

```bash
pnpm validate
pnpm validate:packaging
git diff --check
```

Individual CI jobs map to:

```bash
pnpm test
pnpm lint
pnpm build
pnpm desktop:build
pnpm harness:scan --path .
```

## Credentials Policy

CI does not require:

- `LINEAR_API_KEY`
- `GITHUB_TOKEN` or `GITHUB_PAT` for product APIs
- Codex CLI auth
- Claude CLI auth
- Cursor Agent auth
- OpenAI, Anthropic, or Cursor API keys

GitHub Actions receives the platform-provided `GITHUB_TOKEN`, but normal CI jobs are read-only. The draft release job is the only job with `contents: write`.

## Failure Interpretation

- Test failures usually indicate a regression in deterministic fake transports, SQLite persistence, workspace handling, auth, write actions, harnessing, or desktop IPC.
- Lint failures usually indicate TypeScript or ESLint issues.
- Build failures indicate package/app type or bundling errors.
- Harness scan failures indicate the deterministic repository scanner cannot complete.
- Artifact inspection failures indicate forbidden runtime data or missing package structure.

## Platform Limitations

Desktop packaging is currently validated on the macOS host runner. Cross-platform packaging, code signing, notarization, Windows signing, and auto-update are deferred.
