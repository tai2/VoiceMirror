# Auto-Prettify -- Implementation Plan

## Goal

Eliminate unrelated formatting changes from diffs by ensuring all code is consistently formatted. The approach has three parts:

1. **Add a `format` npm script** that runs Prettier on all source files, so formatting can be applied in one command.
2. **Run `format` as a Claude Code hook** after every file edit/write, so that any code Claude produces is immediately formatted before being committed.
3. **Add a CI check** that fails the build if any files are not properly formatted, catching unformatted code from any source (manual edits, other tools, etc.).

This builds on the prior research in `research.md`, which identified the three packages needed (`prettier`, `eslint-config-prettier`, `eslint-plugin-prettier`) and the recommended ESLint integration pattern from the Expo docs.

## Architecture / Approach

### Part 1: Prettier setup and the `format` script

The research document already details the recommended Expo approach: integrate Prettier into ESLint via `eslint-plugin-prettier/recommended`. However, for the hook use case we need a **standalone Prettier CLI command** that can quickly format files without running the full ESLint pipeline. The `format` script will use the Prettier CLI directly.

The ESLint integration (via `eslint-plugin-prettier/recommended`) will also be added so that `pnpm lint` catches formatting violations alongside linting errors. This gives us two complementary tools:

- `pnpm format` -- fast, write-mode formatting (for hooks and manual use)
- `pnpm lint` -- full linting including formatting checks (for CI and editor integration)

#### Packages to install

```
npx expo install prettier eslint-config-prettier eslint-plugin-prettier --dev
```

These three packages are the standard set recommended by the Expo docs (see `research.md` for version details).

#### `.prettierrc` configuration

Since the project currently uses double quotes throughout, Prettier's defaults (which also use double quotes) will minimize churn on the initial formatting commit. A minimal `.prettierrc` is still recommended to make the configuration explicit and prevent parent-directory configs from affecting the project.

**New file: `.prettierrc`**

```json
{
  "singleQuote": false
}
```

This explicitly documents the choice of double quotes. All other options (2-space indent, semicolons, trailing commas, etc.) use Prettier defaults, which already match the project's current style.

#### `format` npm script

**File: `package.json`** -- add to `"scripts"`:

```json
"format": "prettier --write 'src/**/*.{ts,tsx}' 'app/**/*.{ts,tsx}' 'e2e/**/*.ts' '*.{js,ts,json}'"
```

This targets:

- `src/**/*.{ts,tsx}` -- all application source files
- `app/**/*.{ts,tsx}` -- Expo Router page files
- `e2e/**/*.ts` -- E2E test files
- `*.{js,ts,json}` -- root config files (`eslint.config.js`, `tsconfig.json`, `package.json`, etc.)

It deliberately excludes `node_modules`, `dist`, `ios`, `android`, and `artifacts` (all of which are either generated or gitignored).

A corresponding `format:check` script is needed for CI:

```json
"format:check": "prettier --check 'src/**/*.{ts,tsx}' 'app/**/*.{ts,tsx}' 'e2e/**/*.ts' '*.{js,ts,json}'"
```

`--check` mode exits with a non-zero code if any file would be changed, without actually modifying anything.

#### ESLint integration

**File: `eslint.config.js`** -- updated to include the Prettier plugin:

```js
// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const eslintPluginPrettierRecommended = require("eslint-plugin-prettier/recommended");

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  {
    ignores: ["dist/*"],
  },
]);
```

Order matters: `eslintPluginPrettierRecommended` must come after `expoConfig` so it can disable conflicting formatting rules from `eslint-config-expo`.

### Part 2: Claude Code hook

Claude Code hooks allow running commands automatically at specific lifecycle events. The relevant event for auto-formatting is **`PostToolUse`** on the `Edit` and `Write` tools -- i.e., after Claude writes or edits a file, the hook formats it immediately.

The hook is configured in the **project-level** `.claude/settings.json` so it applies to all developers working on the project with Claude Code.

**File: `.claude/settings.json`** -- add `hooks` key:

```json
{
  "permissions": {
    "allow": [
      "Bash(cat:*)",
      "Bash(ls:*)",
      "Bash(grep *)",
      "Bash(find *)",
      "Bash(pnpm *)",
      "Bash(git *)",
      "Bash(aapt dump:*)",
      "Bash(adb logcat:*)",
      "Bash(pod install:*)",
      "Bash(npx expo:*)",
      "Bash(npx eas-cli@latest update *)",
      "Bash(npx eas-cli@latest build:list*)",
      "Bash(npx eas-cli@latest build:cancel*)",
      "Bash(mkdir -p src/*)",
      "Edit(research.md)",
      "Edit(plans/*.md)",
      "WebFetch(domain:docs.expo.dev)",
      "WebFetch(domain:docs.swmansion.com)",
      "WebSearch",
      "Bash(pod install:*)",
      "Bash(npx expo-modules-autolinking:*)",
      "WebFetch(domain:react.i18next.com)",
      "WebFetch(domain:www.i18next.com)",
      "Bash(./gradlew *)",
      "Bash(python3 -m json.tool)"
    ]
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path' | xargs pnpm prettier --write"
          }
        ]
      }
    ]
  }
}
```

#### How the hook works

- **Event**: `PostToolUse` fires after Claude successfully uses a tool.
- **Matcher**: `"Edit|Write"` restricts the hook to fire only after `Edit` or `Write` tool calls (not after `Bash`, `Read`, etc.).
- **Stdin JSON**: Claude Code passes event data as JSON to stdin, containing `tool_input.file_path` with the absolute path of the file that was just edited or written.
- **Command**: `jq -r '.tool_input.file_path' | xargs pnpm prettier --write` extracts the file path from stdin and formats just that single file, keeping the hook fast (sub-second for a single file).

This means every file Claude touches is automatically formatted before the user sees it or it gets committed, preventing formatting-only diffs from leaking into PRs.

### Part 3: CI format check

The existing CI workflow at `.github/workflows/ci.yml` needs a new step that runs `pnpm format:check` to reject PRs containing unformatted code.

**File: `.github/workflows/ci.yml`** -- add a step after "Lint":

```yaml
- name: Lint
  run: pnpm lint

- name: Format check
  run: pnpm format:check

- name: Unit tests
  run: pnpm test:ci
```

The `format:check` step runs `prettier --check`, which:

- Exits 0 if all files are already formatted
- Exits 1 and prints the list of unformatted files if any file would be changed

This is placed after "Lint" because linting is conceptually related (both are style checks), and before "Unit tests" because tests are the most expensive step.

### Initial formatting commit

After setting everything up, the entire codebase must be formatted once via `pnpm format`. This will produce a single commit that touches many files. To preserve `git blame` history:

1. Run `pnpm format` and commit all changes
2. Create a `.git-blame-ignore-revs` file at the project root containing the formatting commit hash
3. GitHub automatically reads this file and hides the commit from blame views

**New file: `.git-blame-ignore-revs`**

```
# Prettier formatting pass
<commit-hash-to-be-filled-after-commit>
```

## File Paths That Need Modification

| File                       | Change                                                                          |
| -------------------------- | ------------------------------------------------------------------------------- |
| `package.json`             | Add `"format"` and `"format:check"` scripts; add three Prettier devDependencies |
| `.prettierrc`              | New file -- Prettier configuration                                              |
| `eslint.config.js`         | Add `eslint-plugin-prettier/recommended` to the config array                    |
| `.claude/settings.json`    | Add `hooks.PostToolUse` for auto-formatting                                     |
| `.github/workflows/ci.yml` | Add "Format check" step                                                         |
| `.git-blame-ignore-revs`   | New file -- list the formatting commit for blame exclusion                      |

## Considerations and Trade-offs

### Standalone Prettier CLI vs. ESLint-only formatting

**Chosen**: Both. `pnpm format` uses the Prettier CLI directly; `pnpm lint` includes Prettier via ESLint plugin.

**Why both**: The Claude Code hook needs a fast single-file formatting command. Running `eslint --fix` on a single file is slower because it loads the full ESLint rule set. The Prettier CLI formats a single file in ~50ms. Meanwhile, having Prettier in ESLint ensures `pnpm lint` catches formatting issues alongside other lint violations, which is the standard Expo-recommended approach.

**Trade-off**: Two code paths for formatting means they must share the same config. Both read from `.prettierrc`, so they are guaranteed to agree. The ESLint plugin passes `usePrettierrc: true` by default, so it uses the same `.prettierrc` as the CLI.

### Hook placement: project vs. user settings

**Chosen**: Project-level `.claude/settings.json`.

The hook is a project concern (ensuring consistent formatting), not a user preference. Placing it in the project settings means every developer using Claude Code on this project gets auto-formatting without additional setup. The user-level settings at `~/.claude/settings.json` already has user-specific hooks (`Stop` and `Notification`), which are appropriately personal.

### `PostToolUse` on Edit|Write vs. a pre-commit hook

**Chosen**: Claude Code hook (`PostToolUse`).

**Alternative**: A Git pre-commit hook (e.g., via `lint-staged` + `husky`) that formats staged files before every commit. This is a more traditional approach and catches all contributors, not just Claude Code.

**Why PostToolUse**: The stated goal is specifically to prevent Claude Code from producing unrelated formatting changes. A `PostToolUse` hook formats immediately after each edit, so the user sees clean diffs in real-time. The CI `format:check` step serves as the universal safety net that catches unformatted code from any source.

A pre-commit hook with `lint-staged` could be added later as a complementary measure for human developers, but it is not part of this plan since the immediate problem is Claude Code-generated diffs.

### `format:check` vs. relying on `pnpm lint`

**Chosen**: A separate `format:check` step using the Prettier CLI.

Since `eslint-plugin-prettier` is added to the ESLint config, `pnpm lint` will also catch formatting issues. However, having a dedicated `pnpm format:check` step in CI provides:

- A clearer failure message (Prettier's output lists exactly which files need formatting)
- Faster feedback (Prettier check is faster than full ESLint with Prettier plugin)
- Independence from ESLint config changes (if someone accidentally removes the Prettier plugin from ESLint, the CI still catches formatting issues)

The redundancy is intentional and low-cost.

### Double quotes vs. single quotes

**Chosen**: Double quotes (Prettier default, matching current codebase).

The research document notes that Expo and React Native community conventions prefer single quotes. However, switching to single quotes would reformat every string in every file, creating a massive diff with no functional benefit. Keeping double quotes minimizes churn in the initial formatting commit. If the team wants to switch to single quotes later, it is a one-line change in `.prettierrc` followed by `pnpm format`.

### Files targeted by `format` script

**Chosen**: Explicit glob patterns targeting `src/`, `app/`, `e2e/`, and root config files.

**Alternative**: `prettier --write .` with a `.prettierignore` file to exclude unwanted directories.

**Why explicit globs**: The project has several directories that should never be formatted (`node_modules`, `ios`, `android`, `dist`, `artifacts`, `.expo`). Using explicit include patterns is safer than trying to exclude everything. It also makes the scope of formatting immediately visible in the script definition. A `.prettierignore` file would be needed alongside `prettier --write .` to avoid formatting these directories, and forgetting an entry would cause unexpected changes.

### `.git-blame-ignore-revs` for the initial formatting commit

The initial `pnpm format` run will change most source files. Without `.git-blame-ignore-revs`, `git blame` would attribute many lines to the formatting commit rather than their original authors. GitHub reads this file automatically. For local use, developers can run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once per clone.

This is a best practice when introducing a formatter to an existing codebase and has no downsides.

## Todo

### Part 1: Prettier setup and the `format` script

- [x] Install dev dependencies: `npx expo install prettier eslint-config-prettier eslint-plugin-prettier --dev`
- [x] Create `.prettierrc` with `{ "singleQuote": false }`
- [x] Add `"format"` script to `package.json`: `prettier --write 'src/**/*.{ts,tsx}' 'app/**/*.{ts,tsx}' 'e2e/**/*.ts' '*.{js,ts,json}'`
- [x] Add `"format:check"` script to `package.json`: `prettier --check 'src/**/*.{ts,tsx}' 'app/**/*.{ts,tsx}' 'e2e/**/*.ts' '*.{js,ts,json}'`
- [x] Update `eslint.config.js`: import `eslint-plugin-prettier/recommended` and add it to the config array after `expoConfig`
- [x] Verify `pnpm lint` runs successfully with the new Prettier ESLint integration

### Part 2: Claude Code hook

- [x] Add `hooks.PostToolUse` entry to `.claude/settings.json` with matcher `"Edit|Write"` and command `pnpm prettier --write $CLAUDE_FILE_PATH`

### Part 3: CI format check

- [x] Add "Format check" step (`pnpm format:check`) to `.github/workflows/ci.yml` after the "Lint" step and before the "Unit tests" step

### Part 4: Initial formatting commit

- [x] Run `pnpm format` to format the entire codebase
- [ ] Commit all formatting changes as a single commit
- [ ] Create `.git-blame-ignore-revs` file at project root containing the formatting commit hash
- [ ] Commit `.git-blame-ignore-revs`

### Verification

- [x] Run `pnpm typecheck` to confirm no type errors
- [x] Run `pnpm lint` to confirm no lint/formatting errors
- [x] Run `pnpm test:ci` to confirm unit tests pass
- [x] Run `pnpm format:check` to confirm all files are formatted
