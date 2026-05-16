# GitHub PR Payload Hash Stability

Milestone 15C-H performs no GitHub or Linear writes.

## Why This Exists

Milestone 15C-V4 stopped before the first real PR because enabling the confirmed GitHub write gates changed the executable preview hash.

The confirmed packet used payload hash:

```text
c58d244320944f9c048cbacc73d01a6fc2b410703108a13001517c447ee6ea67
```

After GitHub write gates were temporarily enabled, the executable preview reported:

```text
9c9e757699b9799e953b58207335390bf08f67c66a776c5418c6d0f82296250e
```

That was the correct safety stop. A confirmed hash must not be silently replaced before an external write.

## Root Cause

The old `payloadHash` was computed from a preview object that included mutable readiness state through GitHub PR blockers and warnings. Those fields changed when GitHub moved from read-only/write-disabled to manual write mode with push and PR creation enabled.

The intended PR payload did not change:

- target repository;
- base branch;
- head branch;
- title;
- body;
- draft state;
- changed files;
- review artifact identity;
- approval evidence identity;
- idempotency key inputs.

Only execution availability changed.

## Hash Model

Symphonía uses a two-hash model for GitHub PR previews.

### `writePayloadHash`

Stable. This is the hash the human confirms.

It covers the intended external mutation and evidence identity:

- action kind;
- run and issue identity;
- target repository;
- base branch;
- head branch;
- PR title;
- PR body;
- draft flag;
- changed files;
- approval evidence identity and hash;
- review artifact identity;
- canonical payload version.

It excludes mutable readiness state.

The legacy `payloadHash` field remains a backwards-compatible alias for `writePayloadHash`.

### `previewStateHash`

Mutable. This describes the current preview/preflight availability state.

It may change when these change:

- GitHub write mode;
- read-only status;
- push allowance;
- PR creation allowance;
- blocking reasons;
- warnings;
- availability status;
- confirmation posture.

It is not the human-approved external write identity.

### `approvalEvidenceHash`

Stable for a fixed evidence snapshot. This covers the approval evidence and review artifact identity used to justify the write.

If evidence changes in a payload-affecting way, `approvalEvidenceHash` and therefore `writePayloadHash` change.

## Branch Freshness

Branch freshness is validated by PR preflight. `fresh` is acceptable. `stale_no_overlap` remains a warning that requires explicit human acceptance if policy permits it. `stale_overlap` and `unknown` block execution regardless of hash state.

Branch freshness blocker/warning state belongs to preflight/preview state unless product policy explicitly makes an accepted warning part of the write payload.

## Confirmation Packet

The UI/API must show:

- write payload hash: must be confirmed;
- preview state hash: current readiness state, may change;
- idempotency key: must be confirmed;
- target repository/base/head: must be confirmed;
- current write gates: must be enabled before execution;
- current preflight status: must pass before execution.

The confirmation packet must not imply that read-only blockers or gate state are part of the external PR payload.

## Execution Validation

`POST /runs/:id/github/pr/create` validates:

- confirmed `writePayloadHash` through the legacy `payloadHash` request field;
- idempotency key;
- target repository;
- base branch;
- head branch;
- confirmation phrase;
- preflight pass;
- workspace isolation;
- live diff/evidence parity;
- review artifact readiness;
- branch freshness policy;
- GitHub write gates.

Execution must reject changed `writePayloadHash`. It must not reject solely because `previewStateHash` changed when GitHub gates moved from read-only to manual-enabled.

## Deferred

Deferred to later milestones:

- real PR creation after V5 confirmation;
- Linear comment writeback;
- automatic write-mode management;
- broad cleanup or branch lifecycle automation.
