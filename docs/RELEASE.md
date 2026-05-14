# Release Process

Symphonia release automation is conservative. The default path is to run a dry-run release, inspect artifacts, then create a draft release manually.

## Version Source

The root `package.json` version is the source of truth for release notes and desktop package metadata. `apps/desktop/scripts/package.mjs` copies that version into the staged desktop package.

## Dry Run

Use the `Release Dry Run` workflow from GitHub Actions, or run locally:

```bash
pnpm validate
pnpm validate:packaging
node scripts/release-notes-preview.mjs v0.1.0 > release-notes-preview.md
```

The dry-run workflow uploads:

- desktop package archive
- release notes preview

It does not publish a release.

## Draft Release

The `Draft Release` workflow is manual and gated:

1. Create and push a version tag, for example `v0.1.0`.
2. Open GitHub Actions.
3. Run `Draft Release`.
4. Enter the existing tag as `release_version`.
5. Type `CREATE DRAFT RELEASE` as confirmation.

The workflow runs validation, packages the desktop app, inspects the artifact, and creates a draft GitHub release. It does not publish the release.

## Artifact Inspection

Every release path must pass:

```bash
pnpm desktop:inspect-artifact
```

The inspector rejects `.env` files, SQLite DBs, `.symphonia` workspaces, `.data`, local settings, auth token stores, logs, coverage, tests, fixtures, package-manager cache, and desktop staging output.

## Deferred

- Code signing.
- macOS notarization.
- Windows signing.
- Auto-update feeds.
- Fully automated public release publishing.
- Cross-platform package matrix beyond the currently validated host package.

## Troubleshooting

- Missing tag: create and push the tag before running the draft release workflow.
- Package inspection failed: inspect the forbidden path reported by `pnpm desktop:inspect-artifact`.
- Release confirmation failed: type exactly `CREATE DRAFT RELEASE`.
- Artifact missing: rerun `pnpm validate:packaging` locally and confirm `apps/desktop/out` exists.
