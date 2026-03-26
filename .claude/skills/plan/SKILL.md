---
name: plan
description: Write a detailed implementation plan document in plans/ based on the actual codebase
argument-hint: <feature or change description>
context: fork
effort: high
allowed-tools: Read, Glob, Grep, Bash(git log:*), Bash(pnpm *), Edit, Write
---

The project root is: !`git rev-parse --show-toplevel`

Read `research.md` at the project root if it exists to build on prior research. Study the relevant parts of the codebase that relate to the following:

$ARGUMENTS

Write a detailed plan document at `plans/<date>-<slug>.md` **at the project root** (use today's date in YYYYMMDD format, derive a short slug from the feature description).

The plan must include:

- Goal section
- Architecture / approach explanation
- Code snippets showing the actual changes to make
- File paths that need modification
- Considerations and trade-offs

Base the plan on the actual codebase — reference real file paths, real function names, real patterns already in use.

**Do not include a todo list** — that is a separate phase handled by `/add-todos`.

**Do not implement anything.** Only produce the plan document.
