---
name: grok-workflows
description: When and how to run Grok Rhai multi-agent workflows from Codex
user-invocable: false
---

# Grok workflows

Workflows are deterministic Rhai scripts under `.grok/workflows/` or `~/.grok/workflows/` that orchestrate parallel subagents via Grok’s `workflow` tool.

Workflow orchestration does not prove that an implementation landed. Treat workflow text as advisory until the resulting worktrees/diffs and validation commands are inspected.

## When to use

- Multi-dimension review (correctness + error handling + performance) with adversarial verify
- Bounded fan-out over a known work list
- Repeatable pipelines the user wants by name

Avoid parallel workflow writers in one shared worktree unless their file scopes are explicitly disjoint. Prefer separate worktrees for overlapping or repository-wide changes.

## How

```text
grok_workflow list
grok_workflow run <name> --arg key=value --background
grok_workflow run <name> --validate-only
```

Do **not** reimplement workflow logic in Claude. The companion hands a prompt that tells Grok to use the workflow tool.

## Prefer over multi-rescue when

- The work is a named recipe with structured phases
- You need agent budget caps and deterministic fan-out
