# Security Notes

Symphonia is local-first, but it handles repository data, local workspaces, integration credentials, and explicit external write actions. Security defaults must stay conservative.

## Credentials

- Renderer code must not receive raw GitHub or Linear tokens.
- Auth APIs return redacted metadata only.
- Settings exports must omit raw tokens.
- Diagnostics must omit Authorization headers and secret values.
- CI must not require product credentials.
- `.env` and `.env.*` files must not be committed or packaged.

## External Writes

GitHub and Linear writes are disabled by default. Any write must be:

1. Previewed.
2. Shown with blockers and warnings.
3. Confirmed with the configured phrase.
4. Revalidated immediately before execution.
5. Persisted as a redacted audit record.

Symphonia does not auto-merge, force-push, auto-push, create Linear issues, or transition Linear issue states.

## Packaging

Desktop artifacts must exclude:

- workspaces
- SQLite databases
- local settings
- auth token stores
- logs
- coverage
- test fixtures
- `.env` files

Use:

```bash
pnpm validate:packaging
```

## CI Permissions

Normal CI workflows use `contents: read`. The draft release workflow elevates to `contents: write` only in the manually confirmed release job.
