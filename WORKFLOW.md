---
provider: codex

tracker:
  kind: linear
  api_key: "$LINEAR_API_KEY"
  allow_workspace_wide: true
  read_only: true
  write:
    enabled: false
    require_confirmation: true
    allow_comments: false
    allow_state_transitions: false
    comment_on_run_start: false
    comment_on_run_complete: false
    run_comment_template: |
      Symphonia run update for {{ issue.identifier }}.

      Status: {{ run.status }}
      Provider: {{ run.provider }}

      Summary:
      {{ run.summary }}

      <!-- symphonia-run-id: {{ run.id }} -->
  active_states:
    - "Todo"
    - "In Progress"
    - "Backlog"
    - "Rework"
  terminal_states:
    - "Done"
    - "Closed"
    - "Canceled"
    - "Duplicate"

github:
  enabled: false
  token: "$GITHUB_TOKEN"
  owner: null
  repo: null
  default_base_branch: "main"
  remote_name: "origin"
  read_only: true
  write:
    enabled: false
    require_confirmation: true
    allow_push: false
    allow_create_pr: false
    allow_comment: false
    allow_request_reviewers: false
    draft_pr_by_default: true
    protected_branches:
      - "main"
      - "master"
      - "production"
    pr_title_template: "{{ issue.identifier }}: {{ issue.title }}"
    pr_body_template: |
      ## Summary

      Symphonia run for {{ issue.identifier }}.

      Issue: {{ issue.url }}

      ## What changed

      See review artifacts and run timeline.

      ## Validation

      See Symphonia run timeline.

      <!-- symphonia-run-id: {{ run.id }} -->

polling:
  interval_ms: 30000

workspace:
  root: ".symphonia/workspaces"
  cleanup:
    enabled: false
    dry_run: true
    require_manual_confirmation: true
    protect_active: true
    protect_recent_runs_ms: 86400000
    protect_dirty_git: true

agent:
  max_concurrent_agents: 3
  max_turns: 8
  max_retry_backoff_ms: 300000
  max_concurrent_agents_by_state:
    todo: 2
    in progress: 2
    rework: 1

codex:
  command: "codex app-server"
  model: null
  approval_policy: "on-request"
  turn_sandbox_policy: "workspaceWrite"
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000

hooks:
  timeout_ms: 30000
  after_create: |
    printf "Workspace created at $(pwd)\n"
  before_run: |
    printf "Preparing provider run in $(pwd)\n"
  after_run: |
    printf "Finished provider run in $(pwd)\n"
---

You are working on issue {{ issue.identifier }}.

Title:
{{ issue.title }}

Description:
{{ issue.description }}

State:
{{ issue.state }}

Labels:
{{ issue.labels }}

Attempt:
{{ attempt }}

Instructions:
1. Inspect the workspace context.
2. Make the smallest correct change.
3. Run the relevant validation command.
4. Report what changed and what was verified.
5. If blocked, explain exactly what information is missing.
6. When ready, hand off to Human Review.
