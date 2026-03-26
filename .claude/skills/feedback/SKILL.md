---
name: feedback
description: Process developer's inline annotations in the plan document and update accordingly without implementing
argument-hint: [plan file path]
context: fork
allowed-tools: Read, Glob, Grep, Edit
---

The project root is: !`git rev-parse --show-toplevel`

Read the plan file specified below (or the most recently modified file in `plans/` at the project root if no argument given):

$ARGUMENTS

Look for inline annotations/notes the developer has added. These may be marked with comments, notes, or simply new text inserted into the plan — typically quoted strings like "note text here" that stand out from the surrounding plan content.

Address every single note:

- If a note says to remove a section, remove it
- If a note corrects an assumption, fix the assumption throughout the plan
- If a note adds a constraint, restructure the relevant sections accordingly

After processing all notes, clean up the document so it reads as a cohesive plan without leftover annotation artifacts.

**Critical: Do not implement anything. Only update the plan document.**
