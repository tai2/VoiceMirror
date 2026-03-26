---
name: implement
description: Execute an approved plan, marking tasks complete as each is finished
argument-hint: <plan file path>
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(pnpm *), Bash(git *)
---

Read the plan file at:

$ARGUMENTS

Implement everything specified in the plan, following the todo list if one exists.

- When done with each task or phase, mark it as completed in the plan document (`- [x]`)
- Do not stop until all tasks and phases are completed
- Do not add unnecessary comments or jsdocs
- Do not use `any` or `unknown` types
- Continuously run `pnpm typecheck` to make sure no new type errors are introduced
- Follow the project's existing patterns (see CLAUDE.md for full conventions)
- If something in the plan is ambiguous, make a reasonable choice and continue — do not stop to ask
