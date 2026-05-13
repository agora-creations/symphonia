---
provider: mock

tracker:
  kind: mock
  active_states:
    - "Todo"
    - "In Progress"
    - "Rework"
  terminal_states:
    - "Done"
    - "Closed"
    - "Canceled"
    - "Duplicate"

polling:
  interval_ms: 30000

workspace:
  root: ".symphonia/workspaces"

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
    printf "Preparing mock run in $(pwd)\n"
  after_run: |
    printf "Finished mock run in $(pwd)\n"
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
