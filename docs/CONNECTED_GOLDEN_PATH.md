# Connected Golden Path

Symphonia's first connected loop is real-data-first. It guides a local operator from runtime readiness through a real Linear issue, a local workspace, a Codex run, streamed evidence, and a human review artifact.

There is no user-facing Demo Mode in this milestone.

## First-Run Connected User Journey

1. Launch Symphonia and confirm the daemon is reachable.
2. Choose or validate the local repository that owns `WORKFLOW.md`.
3. Confirm the workspace root and SQLite event store are configured.
4. Connect or validate Linear credentials.
5. Confirm the Linear issue scope, such as team, project, or workspace-wide read-only scope.
6. Validate GitHub credentials and repository access when GitHub is enabled.
7. Validate Codex provider readiness through the configured `codex app-server` command.
8. Review write-safety posture for GitHub and Linear. Writes remain disabled or confirmation-gated unless `WORKFLOW.md` explicitly enables them.
9. Refresh real Linear issues.
10. Open the issue board once real issues are available.
11. Open one issue card and run it with Codex.
12. Watch workspace preparation, prompt rendering, provider events, evidence, and review artifact refresh.
13. End at a clear `completed`, `needs-review`, or `failed` state.

## Returning Connected User Journey

1. Launch Symphonia and read the connected status surface.
2. If daemon, workflow, credentials, provider, issue scope, or event store readiness changed, show the next recovery action.
3. If prerequisites are ready, land on the issue board.
4. Refresh Linear issues when the cache is stale.
5. Select an issue and run it with Codex.
6. Review the streamed timeline and review artifact.
7. Use gated future actions only when the existing safety policy explicitly permits them.

## Normalized Issue Model

The board needs these fields from the supported real tracker source:

- `id`: stable tracker issue id.
- `identifier`: human-readable key such as `ENG-101`.
- `title` and `description`.
- `state`: tracker state name.
- `labels`, `priority`, `assignee`.
- `url`: external tracker URL.
- `tracker.kind`: currently `linear`.
- `tracker.teamKey`, `tracker.teamName`, `tracker.projectName`, and `tracker.projectSlug` when available.
- `lastFetchedAt`: issue-cache freshness.

Fake or seeded product issues are not part of this model. Tests may create deterministic fixture issues through fake transports.

## Normalized Run Model

A run is tied to one real issue and one provider:

- `id`
- `issueId`, `issueIdentifier`, `issueTitle`
- `trackerKind`
- `provider`, with the Milestone 13 golden path using `codex`
- `status`: queued, preparing workspace, building prompt, launching agent, running, streaming, waiting for approval, succeeded, failed, timed out, stalled, cancelled, interrupted, orphaned, or recovered
- `workspacePath`
- `startedAt`, `updatedAt`, `endedAt`, `lastEventAt`
- `providerMetadata`, including Codex thread and turn ids when available
- `recoveryState`
- `error` and `terminalReason`

## Normalized Event, Evidence, And Review Model

The proof screen uses the persisted event stream and review artifact snapshot:

- Workflow events: workflow loaded or invalid.
- Workspace events: workspace ready and cleanup recovery events.
- Prompt events: rendered prompt.
- Provider events: provider started, Codex thread/turn/item events, assistant deltas, stderr, usage, and errors.
- Hook events: before/after hook status, stdout, stderr, and exit code.
- Approval events: requested, resolved, or recovered.
- Review artifact events: local Git status, local diff, GitHub health, PR lookup, checks, workflow runs, and refresh result.
- Write events: previews, blockers, confirmation required, execution result, and explicit write failures.

The review artifact snapshot must include issue identity, run identity, workspace, provider, Git status, diff summary, PR summary when present, checks, workflow runs, status/error, and the next review action.

## Connected Onboarding State Machine

The connected status surface may report:

- `daemon_unavailable`
- `daemon_ready`
- `needs_repo`
- `repo_ready`
- `needs_linear`
- `linear_ready`
- `needs_github`
- `github_ready`
- `needs_provider`
- `provider_ready`
- `needs_issue_scope`
- `board_ready`
- `issue_selected`
- `workspace_preparing`
- `workspace_ready`
- `run_starting`
- `run_active`
- `evidence_streaming`
- `review_ready`
- `completed`
- `failed`
- `needs_attention`

The UI should make the next action obvious and should not substitute fake data when a state is blocked.

## Implemented In Milestone 13

- A typed connected status endpoint for the UI.
- A first-run connected gateway without Demo Mode.
- Real Linear issue board readiness and empty/error states.
- A dominant `Run with Codex` action on issue cards.
- Existing daemon run lifecycle surfaced as the proof screen.
- Streamed events, evidence summaries, review artifact status, and final state visibility.
- Internal fake transports and temporary repositories for automated tests only.

## Deferred

- User-facing Demo Mode.
- Seeded sample workspaces, teams, or issues.
- Full issue creation and intake.
- Automatic GitHub PR creation or Linear comments.
- Linear state transitions.
- Cloud accounts, team sharing, webhooks, auto-update, signing, notarization, and deployment.
- Full production runtime manager.
- Multi-provider review comparison.

## Missing Requirement Surfacing

- Missing daemon: show daemon unavailable and the configured daemon URL when known.
- Missing repo or workflow: show repository/workflow selection or configuration action.
- Missing Linear credential: show Connect Linear and Validate Linear actions.
- Invalid Linear credential or scope: show tracker error and the active scope.
- Missing GitHub credential or repo: show Validate GitHub and repository configuration guidance.
- Missing Codex CLI/auth: show Check Codex and provider health details.
- No issues: show the active Linear scope, last sync, and Refresh issues.
- Missing workspace: show the workspace root and that the per-issue workspace will be prepared on run start.
- Event stream disconnected: keep persisted events visible and offer refresh/retry.
- Review artifact missing: show refresh action and local Git/GitHub readiness guidance.

## Write Safety

GitHub and Linear writes remain disabled or gated by the existing policy model:

- GitHub PR creation requires GitHub enabled, read-only off, writes enabled, `allow_create_pr`, an unprotected branch, credentials, a preview, and the configured confirmation phrase.
- Linear comments require tracker read-only off, writes enabled, `allow_comments`, credentials, a preview, and the configured confirmation phrase.
- GitHub branch push, GitHub comments, reviewer requests, Linear issue creation, and Linear state transitions remain deferred unless an existing explicit safety gate already blocks them.
