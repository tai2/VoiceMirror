# Add Claude Code Skills — Implementation Plan

## Goal

Create five project-level Claude Code skills (slash commands) that codify Boris Tane's workflow into reusable, invocable commands: `/research`, `/plan`, `/feedback`, `/add-todos`, and `/implement`.

## Background

Boris Tane's workflow separates thinking from typing via a strict pipeline: Research → Plan → Annotate → Todo List → Implement. Each phase has specific prompting patterns and guard rails. By encoding these as Claude Code skills, we get consistent, repeatable invocations without re-typing long prompts each session.

## Skills Overview

| Skill | Invocation | Purpose |
|---|---|---|
| research | `/research <target>` | Deep-read a folder/module, write findings to `research.md` |
| plan | `/plan <feature description>` | Write a detailed `plans/*.md` implementation plan |
| feedback | `/feedback` | Process developer's inline annotations in the plan, update without implementing |
| add-todos | `/add-todos` | Add a granular todo checklist to the current plan |
| implement | `/implement <plan file>` | Execute the plan, marking tasks complete as it goes |

## File Structure

```
.claude/skills/
├── research/
│   └── SKILL.md
├── plan/
│   └── SKILL.md
├── feedback/
│   └── SKILL.md
├── add-todos/
│   └── SKILL.md
└── implement/
    └── SKILL.md
```

No changes to `settings.json` are needed — project skills in `.claude/skills/` are auto-discovered.

## Skill Definitions

### 1. `/research <target>`

**File:** `.claude/skills/research/SKILL.md`

```yaml
---
name: research
description: Deep-read a folder, module, or system and write a detailed report to research.md
argument-hint: <folder or module to study>
context: fork
---
```

**Instructions (body):**

- Read `$ARGUMENTS` in depth — understand how it works deeply, what it does, and all its specificities
- Use language signaling thoroughness: study the intricacies, go through everything, trace the full flow
- When done, write a detailed report of learnings and findings in `research.md`
- The report should cover: purpose, architecture, key files, data flow, dependencies, edge cases, and any potential issues discovered
- Do not propose changes or implement anything — this is purely a research phase

**Allowed tools:** Read, Glob, Grep, Bash(git log:*), Bash(git blame:*), Edit(research.md)

### 2. `/plan <feature description>`

**File:** `.claude/skills/plan/SKILL.md`

```yaml
---
name: plan
description: Write a detailed implementation plan document in plans/ based on the actual codebase
argument-hint: <feature or change description>
context: fork
effort: high
---
```

**Instructions (body):**

- Read `research.md` if it exists to build on prior research
- Study the relevant parts of the codebase that relate to `$ARGUMENTS`
- Write a detailed plan document at `plans/<date>-<slug>.md` (use today's date in YYYYMMDD format, derive a short slug from the feature description)
- The plan must include:
  - Goal section
  - Architecture / approach explanation
  - Code snippets showing the actual changes to make
  - File paths that need modification
  - Considerations and trade-offs
- Base the plan on the actual codebase — reference real file paths, real function names, real patterns already in use
- **Do not include a todo list** — that is a separate phase handled by `/add-todos`
- **Do not implement anything.** Only produce the plan document.

**Allowed tools:** Read, Glob, Grep, Bash(git log:*), Bash(pnpm *), Edit(plans/*.md), Write(plans/*.md)

### 3. `/feedback`

**File:** `.claude/skills/feedback/SKILL.md`

```yaml
---
name: feedback
description: Process developer's inline annotations in the plan document and update accordingly without implementing
argument-hint: [plan file path]
context: fork
---
```

**Instructions (body):**

- Read the plan file specified in `$ARGUMENTS` (or the most recently modified file in `plans/` if no argument given)
- Look for inline annotations/notes the developer has added (these may be marked with comments, notes, or simply new text inserted into the plan)
- Address every single note — update the plan to incorporate the developer's feedback
- If a note says to remove a section, remove it
- If a note corrects an assumption, fix the assumption throughout the plan
- If a note adds a constraint, restructure the relevant sections accordingly
- After processing all notes, clean up the document so it reads as a cohesive plan without leftover annotation artifacts
- **Critical: Do not implement anything. Only update the plan document.**

**Allowed tools:** Read, Glob, Grep, Edit(plans/*.md)

### 4. `/add-todos`

**File:** `.claude/skills/add-todos/SKILL.md`

```yaml
---
name: add-todos
description: Add a detailed todo checklist to the current plan with all phases and individual tasks
argument-hint: [plan file path]
context: fork
---
```

**Instructions (body):**

- Read the plan file specified in `$ARGUMENTS` (or the most recently modified file in `plans/` if no argument given)
- Add a `## Todo` section at the end of the plan with a detailed, granular checklist
- Break down every phase into individual tasks using `- [ ]` checkbox format
- Group tasks by phase/step matching the plan's structure
- Each task should be specific and verifiable (not vague like "implement feature")
- Include tasks for: code changes, test updates, type checking, and any migration steps
- **Do not implement anything. Only add the todo list to the plan.**

**Allowed tools:** Read, Edit(plans/*.md)

### 5. `/implement <plan file>`

**File:** `.claude/skills/implement/SKILL.md`

```yaml
---
name: implement
description: Execute an approved plan, marking tasks complete as each is finished
argument-hint: <plan file path>
---
```

**Instructions (body):**

- Read the plan file at `$ARGUMENTS`
- Implement everything specified in the plan, following the todo list if one exists
- When done with each task or phase, mark it as completed in the plan document (`- [x]`)
- Do not stop until all tasks and phases are completed
- Do not add unnecessary comments or jsdocs
- Do not use `any` or `unknown` types
- Continuously run `pnpm typecheck` to make sure no new type errors are introduced
- Follow the project's existing patterns (see CLAUDE.md for full conventions)
- If something in the plan is ambiguous, make a reasonable choice and continue — do not stop to ask

**Allowed tools:** Read, Write, Edit, Glob, Grep, Bash(pnpm *), Bash(git *)

## Implementation Steps

### Step 1: Create the skill directories

Create the five directories under `.claude/skills/`.

### Step 2: Write each SKILL.md

Create each `SKILL.md` file with the frontmatter and instruction body as specified above.

### Step 3: Verify skills are discovered

Run `/research --help` or type `/` in Claude Code to confirm all five skills appear in the autocomplete menu.

## Considerations

- **No settings.json changes needed** — project-level skills in `.claude/skills/` are auto-discovered by Claude Code.
- **`allowed-tools` scoping** — each skill only gets the tools it needs. Research and planning skills cannot write source code. Only `/implement` gets full write access.
- **Guard rails are in the instructions** — every non-implementation skill explicitly says "do not implement anything." This mirrors Boris Tane's critical "don't implement yet" guard.
- **`$ARGUMENTS` for flexibility** — all skills accept arguments so they can target specific folders, features, or plan files.
- **Plan file auto-detection** — `/feedback` and `/add-todos` default to the most recently modified plan file when no argument is given, reducing friction.

## Todo

### Phase 1: Create skill directories
- [x] Create `.claude/skills/research/` directory
- [x] Create `.claude/skills/plan/` directory
- [x] Create `.claude/skills/feedback/` directory
- [x] Create `.claude/skills/add-todos/` directory
- [x] Create `.claude/skills/implement/` directory

### Phase 2: Write SKILL.md files
- [x] Write `.claude/skills/research/SKILL.md` with frontmatter (`context: fork`) and research instructions
- [x] Write `.claude/skills/plan/SKILL.md` with frontmatter (`context: fork`, `effort: high`) and planning instructions
- [x] Write `.claude/skills/feedback/SKILL.md` with frontmatter (`context: fork`) and annotation-processing instructions
- [x] Write `.claude/skills/add-todos/SKILL.md` with frontmatter (`context: fork`) and todo-generation instructions
- [x] Write `.claude/skills/implement/SKILL.md` with frontmatter (no fork) and implementation instructions

### Phase 3: Verify
- [x] Type `/` in Claude Code and confirm all five skills (`research`, `plan`, `feedback`, `add-todos`, `implement`) appear in autocomplete
- [ ] Test `/research src/services` produces a report in `research.md`
