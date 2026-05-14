# Real Connected Run

Milestone 14 is the operational acceptance pass for the connected golden path. Milestone 13 proved the loop structurally with internal fixtures; this checklist proves or hardens the same loop with real Linear, real Codex, a real local repository, a real workspace, real daemon events, SQLite persistence, and a visible review artifact.

There is no user-facing Demo Mode in this milestone.

GitHub and Linear writes remain disabled or confirmation-gated. Do not enable GitHub PR creation, Linear comments, Linear state transitions, or any external writeback while running this checklist.

## Prerequisites

- A local Symphonia checkout with dependencies installed.
- A real local repository selected as the working repository. The repository must contain `WORKFLOW.md`.
- The local daemon reachable at the configured daemon URL, usually `http://localhost:4100`.
- A writable local workspace root, usually `.symphonia/workspaces` under the selected repository.
- A writable SQLite event database, usually `.data/agentboard.sqlite`.
- Linear read access through one of:
  - `LINEAR_API_KEY`, or
  - Settings -> Integrations -> Linear OAuth, or
  - Settings -> Integrations -> Linear manual token fallback.
- GitHub read-only repository validation when enabled in `WORKFLOW.md` through one of:
  - `GITHUB_TOKEN`,
  - `GITHUB_PAT`,
  - Settings -> Integrations -> GitHub device flow, or
  - Settings -> Integrations -> GitHub manual token fallback.
- Codex installed and authenticated enough for the configured `codex.command`, usually `codex app-server`.

Secrets must stay in environment variables, the local auth store, or ignored local files. Do not paste secrets into docs, screenshots, logs, tests, or committed configuration.

## Configure Or Validate Linear

1. Keep `tracker.kind: linear` in `WORKFLOW.md`.
2. Keep `tracker.read_only: true` and `tracker.write.enabled: false` for this milestone.
3. Configure a safe issue scope:
   - preferred: `team_key`, `team_id`, `project_slug`, or `project_id`;
   - acceptable for a local beta check: `allow_workspace_wide: true`.
4. Provide read credentials through `LINEAR_API_KEY` or Settings -> Integrations.
5. Run `POST /issues/refresh` or use the board refresh action.
6. Confirm `/connected/status` reports:
   - `linear.status: "ready"` when credentials and scope work;
   - a clear missing or invalid state when credentials or scope are unavailable;
   - `board.issueCount > 0` before selecting an issue.

If Linear auth is missing, stop before trying to run an issue. The correct user action is to set `LINEAR_API_KEY` locally or connect Linear from Settings. Do not substitute fixture or sample issues in the product UI.

## Configure Or Validate GitHub Read-Only State

GitHub validation can be explicitly disabled in `WORKFLOW.md` while writes stay off. If disabled, `/connected/status` must say that repository validation is disabled and keep the board blocked until the operator intentionally enables read-only validation.

For read-only validation:

```yaml
github:
  enabled: true
  owner: "OWNER"
  repo: "REPO"
  read_only: true
  write:
    enabled: false
```

Then provide a token through `GITHUB_TOKEN`, `GITHUB_PAT`, or Settings -> Integrations, and confirm `/github/health` is healthy. Do not set `github.read_only: false`, `github.write.enabled: true`, or `github.write.allow_create_pr: true` for this milestone.

## Select A Local Repo And Workspace

Browser mode uses the repository where the daemon runs or `SYMPHONIA_WORKFLOW_PATH`. Desktop mode can select repository, workflow, workspace root, and database paths from Settings.

Expected connected status when ready:

- `repository.status: "ready"`
- `repository.workflowStatus: "healthy"`
- `workspace.status: "ready"`
- `workspace.exists: true`
- `eventStore.status: "ready"`

If the workspace root is missing, the run path can create it during workspace preparation. If the configured repository or workflow path is wrong, fix Settings or `SYMPHONIA_WORKFLOW_PATH` before continuing.

## Validate Codex Provider Readiness

Confirm `GET /providers/codex/health` reports the configured command available. The default command is:

```bash
codex app-server
```

`/connected/status` should report:

- `provider.kind: "codex"`
- `provider.status: "ready"`
- `provider.available: true`

The current health check proves the command is available. Full Codex auth and runtime behavior are proven only when the first real issue run reaches the app-server JSON-RPC path. If Codex fails at run time because auth is missing, stop and authenticate Codex locally; do not replace `Run with Codex` with a demo provider.

## Choose A Safe First Issue

Pick one small real Linear issue that is safe for a first operational pass:

- documentation clarification;
- small copy change;
- harmless test improvement;
- tiny UI polish;
- narrowly scoped bug fix.

Avoid broad refactors, dependency upgrades, release operations, secret handling, destructive filesystem work, and anything that would require pushing a branch, creating a PR, commenting in Linear, or changing a Linear issue state.

## Expected Connected Status

Before the board opens:

- missing daemon -> daemon unavailable in the UI;
- missing repo/workflow -> `needs_repo`;
- missing Linear auth -> `needs_linear`;
- GitHub disabled or unvalidated -> `needs_github`;
- missing Codex -> `needs_provider`;
- no issues -> `needs_issue_scope`.

When ready to select an issue:

- `onboardingState: "board_ready"`
- `board.status: "ready"`
- `nextAction.kind: "open_board"` or `select_issue`
- `blockingReasons: []`

During and after a run:

- workspace preparation -> `workspace_preparing`;
- provider launch or stream -> `run_starting`, `run_active`, or `evidence_streaming`;
- terminal success with artifact -> `completed`;
- terminal success without artifact -> `review_ready`;
- terminal provider or lifecycle failure -> `failed`.

## Expected Board State

The issue board must show real Linear issues from the active scope. It should show:

- active scope label;
- cached issue count;
- refresh/retry affordance;
- empty state when no real issues are available;
- inline warnings for missing runtime, Linear, GitHub, Codex, or workspace prerequisites.

Each runnable issue card must expose `Run with Codex` as the primary action. Product UI must not show seeded issues, sample teams, fake projects, `Start Demo Workspace`, or `Run Demo Agent`.

## Expected Run Proof State

After `Run with Codex` starts, the proof screen should show:

- issue identifier, title, description, tracker, URL, and current state;
- workspace path and whether it was created or reused;
- provider and run status;
- Codex thread/turn metadata when available;
- persisted event timeline;
- evidence summary with provider output, errors, and hook/test output;
- changed files and local git state when available;
- review artifact status and content.

## Expected Review Artifact State

The review artifact should include:

- issue identity;
- run identity;
- provider;
- workspace path;
- local git state and diff summary;
- GitHub health or disabled/unavailable state;
- existing PR context when present;
- status/result;
- next recommended review action.

The preferred terminal state for this milestone is `Review artifact ready`. Future write actions may be visible only as disabled or gated actions, never as automatic writeback.

## Known Failure Modes And Recovery

- Daemon unavailable: start or restart the daemon and recheck `/healthz`.
- Wrong daemon URL or port conflict: confirm the configured daemon URL and desktop diagnostics.
- Missing repository or workflow: select a repository containing `WORKFLOW.md` or set `SYMPHONIA_WORKFLOW_PATH`.
- Invalid workflow: fix the exact workflow error shown by `/workflow/status`.
- Missing Linear auth: set `LINEAR_API_KEY` or connect Linear in Settings.
- Invalid Linear auth: validate Linear in Settings and refresh issues.
- Empty Linear scope: adjust team/project scope or active states, then refresh issues.
- GitHub disabled: enable read-only GitHub validation in `WORKFLOW.md` when repository validation is required.
- Missing GitHub auth: connect GitHub or set `GITHUB_TOKEN`/`GITHUB_PAT`.
- Missing Codex CLI: install Codex or configure `SYMPHONIA_CODEX_COMMAND`.
- Codex not authenticated: authenticate Codex locally and retry.
- Workspace preparation failure: inspect workspace root permissions and path containment.
- Event stream disconnected: persisted events remain available; reopen or refresh the run proof screen.
- Run failed: read the terminal run state, provider errors, hook output, and review artifact error.
- Review artifact missing: refresh artifacts and inspect local git/GitHub health.

## Manual Acceptance Checklist

1. Start the daemon and web app.
2. Confirm `GET /connected/status` and `GET /golden-path/status` return the same connected status shape.
3. Confirm repository, workflow, workspace, event store, and write posture are visible.
4. Connect or validate Linear read access.
5. Refresh real Linear issues.
6. Enable and validate GitHub read-only repository access, or explicitly document that GitHub validation is disabled in `WORKFLOW.md`.
7. Validate Codex provider readiness.
8. Open the issue board and confirm real issues are shown.
9. Select one safe issue.
10. Click `Run with Codex`.
11. Watch events stream and persist.
12. Confirm workspace path, evidence, and review artifact are visible.
13. Confirm final state is `completed`, `needs-review`, or `failed` with a clear reason.
14. Confirm no GitHub PR, Linear comment, or Linear state transition was created.
15. Run validation commands and document any environment-specific blockers.
