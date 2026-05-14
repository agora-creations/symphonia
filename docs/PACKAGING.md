# Packaging

Symphonia desktop packaging currently uses `@electron/packager` through:

```bash
pnpm desktop:package
```

The package command builds the desktop TypeScript entrypoints, stages a minimal package in `apps/desktop/.desktop-package`, copies the built desktop code and runtime dependency, and writes an Electron package under `apps/desktop/out`.

## Inspection

Run:

```bash
pnpm desktop:inspect-artifact
```

The inspector checks:

- artifact path exists
- app metadata exists
- app binary is present on macOS packages
- `app.asar` exists
- package size and file counts
- forbidden runtime data is absent

Forbidden material:

- `.env` files
- `.symphonia` workspaces
- `.data`
- SQLite DBs and WAL/SHM files
- local settings JSON
- auth token stores and token keys
- logs
- coverage output
- tests and fixtures
- package-manager cache
- desktop staging output

## Current Bundle Shape

The packaged Electron shell contains the desktop main/preload code and its runtime dependency. During desktop development, managed daemon and web processes still run from the configured repository checkout. A fully bundled daemon/web runtime is a future hardening step.

## Known Limitations

- No code signing.
- No macOS notarization.
- No Windows signing.
- No auto-update.
- Cross-platform package output is partial.
- Fully bundled daemon/web runtime is deferred.

## Future Plan

1. Bundle built daemon files inside the desktop package.
2. Bundle static web assets or a production web server inside the package.
3. Replace repository-checkout process management with packaged runtime process management.
4. Add code signing and notarization per platform.
5. Add update feed generation only after signing is complete.
