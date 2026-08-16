---
name: grok-cli-runtime
description: Internal helper contract for calling the grok-companion runtime from Codex
user-invocable: false
---

# Grok Runtime

Use through the Grok MCP tools. If MCP is unavailable, call the companion directly with `node plugins/grok/scripts/grok-companion.mjs <command> ...`.

Supported Grok CLI line: **1.0.x**. Minimum: **1.0.0**; recommended: **1.0.4** or newer 1.0.x.

Default code-task policy: **`grok-4.6` with `effort=high`**. The compatibility aliases `fast`, `default`, `deep`, and `grok` all resolve to this model and effort so an alias cannot silently select an older model.

## Workspace

Installed Codex plugin MCP servers start from the plugin cache. Pass `cwd` with the active project
directory on every Grok MCP call so Grok inspects, edits, and stores artifacts in the intended
workspace rather than the cached plugin directory. Direct companion calls can use `--cwd <path>`.

## Concurrency

- **Multiple companion jobs may run at once.** There is no global single-agent lock.
- Prefer `background: true` or `--background` when a Codex turn is launching more than one Grok job.
- Each MCP call should make exactly one companion invocation.
- Parallelism = multiple background companion jobs, not a serialized queue.
- When several jobs are running, always pass job ids to `status` / `result` / `cancel`.
- Parallel writers in one shared worktree must have disjoint file scopes. Run repository-wide verification only after every writer has stopped.

## Control flags (most write/plan commands)

MCP input keys map to companion flags:

| MCP property | Companion flag |
| --- | --- |
| `sandbox` | `--sandbox` |
| `planMode` | `--plan` |
| `permissionMode` | `--permission-mode` |
| `agent` | `--agent` |
| `noSubagents` | `--no-subagents` |
| `memory` / `noMemory` | `--memory` / `--no-memory` |
| `allow` / `deny` | `--allow` / `--deny` (repeatable) |
| `disableWebSearch` | `--disable-web-search` |
| `forkSession` | `--fork-session` |
| `maxTurns` | `--max-turns` |

## CLI posture

- Valid built-in sandbox profiles are `off`, `workspace`, `read-only`, `strict`, and `devbox`. Use `workspace` for ordinary repository writes; `workspace-write` is not valid.
- Prefer **denylist** (`--disallowed-tools`) over a version-sensitive tools allowlist. Grok exposes `run_terminal_command` to the model, but the documented filter ID remains `run_terminal_cmd`.
- Headless writes use `--always-approve` inside the selected sandbox. Do not use `permissionMode=acceptEdits` for unattended jobs.
- Media: no always-approve / no tools allowlist.
- `--dry-run` / `--validate-only` / babysit `list`: **read-only** (no always-approve).
- Write-capable default for rescue/design/execute/babysit add|check|remove.

## Depth notes

- `grok_execute_plan` with `latest=true` resolves newest `.grok-designs/*.md`.
- Design/workflow/plan/document jobs harvest copies into `.grok-designs/` / `.grok-workflows/` / `.grok-plans/` / `.grok-docs/`.
- Review `postPending=true`: skips empty findings; empty/oversize diffs fail closed and save findings under `.grok-reviews/`.
- Plan results prefer harvested `plan.md` body over narration.
- Stop-gate uses sandbox `read-only` + denylist (no always-approve).

## State env

- Default job state: `~/.grok/codex-plugin/state/`
- Override: `GROK_CODEX_PLUGIN_STATE`
- Host plugin data: `CODEX_PLUGIN_DATA` only when the dir basename is trusted (`grok` / `grok-*`)
- Does **not** share Claude plugin state (`GROK_CLAUDE_PLUGIN_STATE` / `claude-plugin`)

## Task (`grok_rescue`)

- Exactly one `task` invocation per handoff
- Pin `grok-4.6` with `effort=high`; compatibility aliases resolve to the same pair.
- `resume` → `--resume-last`; `resumeSession` → resume that id; `fresh` → no resume
- Pass `worktree` and `bestOfN` through when present.
- `check` is accepted only for caller compatibility and is not forwarded because Grok CLI 1.0.x has no `--check` flag. Run verification independently after the job finishes.
- Default write-capable; `readOnly` only when requested
- Write completion requires a structured, completed `search_replace` or `write` event with a reported edit path. Narration and literal tool-marker text are not completion evidence; inspect the Git diff independently.

## Plan (`grok_plan`)

- Forces plan permission mode; harvests `.grok-plans/`

## Review (`grok_review` / `grok_adversarial_review`)

- Read-only; never apply patches
- `postPending` + `pr` posts a GitHub PENDING review

## Workflow / design / execute / babysit / document / sessions

- `grok_workflow` — `action=list|run`; list and `validateOnly` are read-only
- `grok_design` — design-doc writer/reviewer loop
- `grok_execute_plan` — PR Plan DAG; `dryRun` is read-only
- `grok_babysit` — `action=add|list|check|remove`; list is read-only
- `grok_document` — `type=pptx|pdf|docx`
- `grok_sessions` — `action=list|search|export`

## Media (`grok_image` / `grok_video`)

- Artifacts under `.grok-media/image/` and `.grok-media/video/`

## Jobs

- `grok_status` / `grok_result` / `grok_cancel`
- Status shows accumulated stream progress (text + thought tails); whitespace-only stays `running`
- Result includes usage and artifacts when present
- For write jobs, result includes `editSummary` with completed editor count, tool names, and reported paths.
- Trust only a completed result plus an independently inspected diff and verification commands. Thought/text narration is never proof that a file changed.
