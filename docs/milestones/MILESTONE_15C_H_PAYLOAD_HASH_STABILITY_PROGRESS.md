# Milestone 15C-H Payload Hash Stability Progress

## Checkpoint 0 - Current State Inspection

- Current checkpoint: completed.
- What changed: no product behavior changed before inspection.
- What was verified: inspected `git status`, V4 execution/progress docs, branch freshness and PR preflight docs, write approval docs, approval evidence docs, workspace isolation docs, README context, shared write schemas, integration-write helpers, workspace manager, event store, daemon write preview/preflight/execution routes, web API and UI surfaces, payload hash generation, idempotency key generation, write gate reading, write-actions endpoint, and validation scripts.
- Remaining work: document the hash model, implement stable write payload hashing, update execution validation/UI, add tests, rehearse the V4 gate transition without external writes, and validate.
- Blockers or risks: uncommitted milestone docs from prior checkpoints remain in the working tree. No external write is allowed in this milestone.

## Checkpoint 1 - Payload Hash Stability Contract

- Current checkpoint: completed.
- What changed: created `docs/GITHUB_PR_PAYLOAD_HASH_STABILITY.md`.
- What was verified: the contract defines the V4 stop, root cause, stable `writePayloadHash`, mutable `previewStateHash`, `approvalEvidenceHash`, confirmation packet display, execution validation, branch freshness behavior, and deferred work.
- Remaining work: implement the contract in schemas, preview generation, execution validation, UI, and tests.
- Blockers or risks: none.

## Checkpoint 2 - Identify Current Hash Inputs

- Current checkpoint: completed.
- What changed: traced the existing hash generation path in `previewContractFromIntegrationPreview`.
- What was verified: the old `payloadHash` was computed from an `immutablePayload` that included `payload.githubPr`; `payload.githubPr` included mutable `blockers` and `warnings`. Enabling GitHub gates changed blockers/warnings, which changed the hash even though the intended PR target/title/body/diff/evidence did not change. `generatedAt` was not part of the old hash; write gates affected the hash through preview blockers/warnings.
- Remaining work: replace the single overloaded hash with a stable payload hash plus mutable preview state hash.
- Blockers or risks: none.

## Checkpoint 3 - Define Stable Write Payload Shape

- Current checkpoint: completed.
- What changed: defined a canonical `write_payload` shape in preview generation.
- What was verified: the stable write payload includes action kind, run/issue identity, target repository, base/head branch, PR title/body/draft state, canonical changed files, review artifact identity, approval evidence identity, and `approvalEvidenceHash`. It excludes GitHub write mode, read-only state, `allow_push`, `allow_create_pr`, blockers, warnings, `canExecute`, availability status, timestamps, route health, and `dryRunOnly`.
- Remaining work: wire shared types and execution validation to the new hash model.
- Blockers or risks: none.

## Checkpoint 4 - Shared Hash Types

- Current checkpoint: completed.
- What changed: extended shared write preview and preflight schemas with `writePayloadHash`, `previewStateHash`, `approvalEvidenceHash`, hash version fields, and `hashAlgorithm`, while keeping legacy `payloadHash` for compatibility.
- What was verified: generated GitHub PR previews set `payloadHash` equal to `writePayloadHash`; old clients can continue sending `payloadHash`; preflight preview data now exposes the stable write payload hash and mutable preview state hash.
- Remaining work: update generation, execution validation, and UI consumers.
- Blockers or risks: old stored previews may not have the new fields, so the schema keeps the new fields nullable/defaulted for compatibility.

## Checkpoint 5 - Preview Generation

- Current checkpoint: completed.
- What changed: updated GitHub/Linear write preview contract generation so stable `writePayloadHash` is computed from canonical write payload data, while `previewStateHash` is computed from availability/blocker/warning/readiness state.
- What was verified: `payloadHash` remains a legacy alias for `writePayloadHash`; preview id and idempotency key are derived from `writePayloadHash`, not mutable gate state.
- Remaining work: verify the V4 gate transition shape and update execution validation.
- Blockers or risks: none.

## Checkpoint 6 - Execution Validation

- Current checkpoint: completed.
- What changed: updated GitHub PR preflight and execution hash checks to compare the confirmed request hash with `writePayloadHash` through the legacy `payloadHash` request field.
- What was verified: execution will still reject changed write payload hashes, idempotency conflicts, stale/unknown branch freshness, workspace isolation failures, live diff/evidence mismatch, missing confirmation, and disabled write gates. It no longer rejects solely because mutable preview state changes after write gates are enabled.
- Remaining work: update UI/API display.
- Blockers or risks: none.

## Checkpoint 7 - UI/API Confirmation Display

- Current checkpoint: completed.
- What changed: updated the write preview UI to label the confirmed value as `Write payload hash`, show `Preview state hash` separately, and send `writePayloadHash`/legacy `payloadHash` for preflight and draft PR requests.
- What was verified: the UI no longer implies gate/readiness state is part of the human-approved external write payload.
- Remaining work: test and rehearse the V4 gate transition.
- Blockers or risks: none.

## Checkpoint 8 - Reproduce V4 Gate Transition Non-Mutatingly

- Current checkpoint: completed.
- What changed: rehearsed the selected run `a0d316a8-eb83-47a3-b8fe-498ec2077ac3` through the same gate transition that blocked V4, without calling the PR execution route.
- What was verified:
  - Read-only preview: `payloadHash` / `writePayloadHash` `11d23b8f2d009ce1de0921219e86df3677935f37cad6a00a4f58b173a8e1a125`.
  - Read-only `previewStateHash`: `b5dc3bea1059b20ccc3ea2b5d6fd6a3f20f94ceb313ade643a0a3613a634ecdc`.
  - Read-only idempotency key: `preview:github_pr_create:a0d316a8-eb83-47a3-b8fe-498ec2077ac3:11d23b8f2d009ce1de092121`.
  - Temporary gate-enabled preview kept the same preview id, `writePayloadHash`, and idempotency key.
  - Temporary gate-enabled `previewStateHash` changed to `6da1cb05224020ee6991c7b11fc34e44ea5c7f5ab19810ac495d4006bc4bba17`.
  - Temporary gate-enabled preflight passed with `canExecute: true`, `manual_enabled`, `allowPush: true`, `allowPrCreate: true`, branch freshness `fresh`, and no blockers.
  - No approval/execution record was created; write history remained empty.
  - No branch was pushed, no PR was created, and no Linear write occurred.
  - GitHub gates were restored to `read_only` / disabled and verified through `/writes/status`.
- Remaining work: complete tests and full validation.
- Blockers or risks: the stable hash changed relative to the old V4 packet because the canonical hash model changed; V5 must use the new `writePayloadHash`.

## Checkpoint 9 - Tests

- Current checkpoint: completed.
- What changed: added a daemon regression test for the V4 gate-transition failure shape.
- What was verified: after rebuilding shared packages, `pnpm --filter @symphonia/daemon test` passed with 48 tests. The new test verifies that a read-only preview and manual-enabled preview for the same PR have the same `writePayloadHash`, may have different `previewStateHash`, retain the same idempotency key, and allow fake-transport execution with the originally confirmed stable hash after gates are enabled.
- Remaining work: run the full validation suite.
- Blockers or risks: direct daemon tests require `pnpm build:packages` first so the app imports the updated shared schema.

## Checkpoint 10 - Validation

- Current checkpoint: completed.
- What changed: ran the required validation commands.
- What was verified:
  - `pnpm build:packages` passed.
  - `pnpm --filter @symphonia/daemon test` passed: 48 daemon tests.
  - `pnpm --filter @symphonia/daemon lint` passed.
  - `pnpm --filter @symphonia/web lint` passed.
  - `pnpm lint` passed.
  - `pnpm test` passed.
  - `pnpm build` passed.
  - `pnpm desktop:build` passed.
  - `pnpm harness:scan --path .` passed after rerunning outside the sandbox because the first sandboxed attempt failed on the known `tsx` IPC pipe `EPERM`.
  - `git diff --check` passed.
  - `pnpm validate:ci` passed after rerunning outside the sandbox because the first sandboxed attempt reached the harness step and failed on the same `tsx` IPC pipe `EPERM`.
- Remaining work: none for this milestone.
- Blockers or risks: sandbox-only `tsx` IPC restrictions affect harness execution; escalated validation passed.

## Final Status

- Outcome: completed with no external writes.
- Root cause: old `payloadHash` included mutable GitHub PR preview blockers/warnings, so read-only/write-gate transitions changed the human-confirmed hash.
- Chosen model: stable `writePayloadHash` for external write identity, mutable `previewStateHash` for readiness/gate state, and `approvalEvidenceHash` for evidence identity. Legacy `payloadHash` remains an alias for `writePayloadHash`.
- Execution validation: GitHub PR execution validates the confirmed request hash against `writePayloadHash`; it still blocks changed payloads, read-only mode, disabled write gates, stale/unknown branch freshness, live diff/evidence mismatch, missing confirmation, workspace isolation failures, and idempotency conflicts.
- UI/API: write preview UI labels the stable value as `Write payload hash` and shows `Preview state hash` separately.
- Selected-run rehearsal: run `a0d316a8-eb83-47a3-b8fe-498ec2077ac3` kept `writePayloadHash` `11d23b8f2d009ce1de0921219e86df3677935f37cad6a00a4f58b173a8e1a125` and idempotency key `preview:github_pr_create:a0d316a8-eb83-47a3-b8fe-498ec2077ac3:11d23b8f2d009ce1de092121` across read-only and gate-enabled states. `previewStateHash` changed from `b5dc3bea1059b20ccc3ea2b5d6fd6a3f20f94ceb313ade643a0a3613a634ecdc` to `6da1cb05224020ee6991c7b11fc34e44ea5c7f5ab19810ac495d4006bc4bba17`.
- Gate state: GitHub gates were restored to `read_only` / disabled and verified. Linear remained read-only/disabled.
- External writes: none. No branch was pushed, no PR was created, no approval/execution record was created, and no Linear mutation occurred.
- Recommended next milestone: 15C-V5 - Create One Human-Confirmed Draft PR using the new stable `writePayloadHash`.
