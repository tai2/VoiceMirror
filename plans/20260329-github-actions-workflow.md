# GitHub Actions CI Workflow -- Implementation Plan

## Goal

Set up a GitHub Actions workflow that automatically runs type checking, linting, and unit tests on every push and pull request. This catches regressions early and ensures all four lightweight verification steps pass before code is merged. The workflow covers the four headless checks identified in `research.md`:

1. `pnpm typecheck` -- TypeScript type checking for the main codebase
2. `pnpm typecheck:e2e` -- TypeScript type checking for E2E test code
3. `pnpm lint` -- ESLint via `expo lint`
4. `pnpm test:ci` -- Jest unit tests (66 tests across 6 suites)

E2E tests and native builds are explicitly excluded -- they require simulators/emulators, native SDKs, or paid EAS cloud builds, none of which are appropriate for a standard CI pipeline on every PR.

## Architecture / Approach

### Single workflow, single job

All four checks run in a single job on an Ubuntu runner. The total runtime for all checks is under 10 seconds (after `pnpm install`), so splitting them into parallel jobs would add overhead (each job needs its own checkout + install) without meaningful time savings. A single job with sequential steps is simpler to maintain and cheaper in terms of GitHub Actions minutes.

### Trigger events

The workflow triggers on:
- **push** to `main` -- catches anything that lands on the default branch
- **pull_request** targeting `main` -- catches issues before merge

This covers the standard development flow where work happens on feature branches and is merged via PRs.

### Toolchain setup

The project requires specific versions of Node.js and pnpm (defined in `mise.toml`):
- **Node.js 24.14.0** -- not the default on GitHub Actions runners (which ship Node 20). The `actions/setup-node@v4` action supports installing any Node.js version.
- **pnpm 10.30.3** -- set up via `corepack enable` + `corepack prepare`. The `actions/setup-node` action has built-in pnpm caching support when `cache: 'pnpm'` is specified.

Using `actions/setup-node` with corepack is the recommended approach for Expo/React Native projects because it avoids installing a separate pnpm action and keeps the version synchronized with what the project declares.

### Dependency caching

The `actions/setup-node` action's built-in `cache: 'pnpm'` option caches the pnpm store directory, keyed on the hash of `pnpm-lock.yaml`. This means:
- First run: full install (~30-60 seconds depending on network)
- Subsequent runs (same lockfile): packages restored from cache, install is near-instant

The `pnpm install --frozen-lockfile` flag ensures CI never modifies the lockfile -- it either installs exactly what is locked or fails. This catches cases where someone forgot to update the lockfile after changing dependencies.

### Version extraction from mise.toml

Rather than hardcoding Node and pnpm versions in the workflow (which would drift from `mise.toml`), the versions are read directly from `mise.toml` at runtime using simple `grep` + `cut` commands. This ensures the CI always uses the same versions as local development without requiring manual synchronization.

## Code Changes

### 1. Create the workflow file

**File: `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    name: Typecheck, Lint & Test
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Read tool versions from mise.toml
        id: versions
        run: |
          echo "node=$(grep '^node' mise.toml | cut -d'"' -f2)" >> "$GITHUB_OUTPUT"
          echo "pnpm=$(grep '^pnpm' mise.toml | cut -d'"' -f2)" >> "$GITHUB_OUTPUT"

      - name: Enable corepack
        run: corepack enable

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ steps.versions.outputs.node }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Typecheck E2E
        run: pnpm typecheck:e2e

      - name: Lint
        run: pnpm lint

      - name: Unit tests
        run: pnpm test:ci
```

### Why corepack enable comes before actions/setup-node

The `actions/setup-node` action with `cache: 'pnpm'` needs to detect the pnpm version to locate the store directory for caching. Corepack must be enabled first so that `pnpm` is available when the action runs its cache key computation. The pnpm version is automatically resolved by corepack from the project's `packageManager` field or via explicit `corepack prepare`. Since this project does not have a `packageManager` field in `package.json`, corepack will use the version specified by the `actions/setup-node` action's own resolution, which reads from `pnpm-lock.yaml`'s lockfile version.

However, to be fully explicit and avoid any version mismatch, we should add a `corepack prepare` step that pins the exact pnpm version read from `mise.toml`. This is done by having `corepack enable` first, then letting `actions/setup-node` set up Node, and then running `corepack prepare` before `pnpm install`.

Updated sequence:

```yaml
      - name: Enable corepack
        run: corepack enable

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ steps.versions.outputs.node }}
          cache: pnpm

      - name: Prepare pnpm
        run: corepack prepare pnpm@${{ steps.versions.outputs.pnpm }} --activate

      - name: Install dependencies
        run: pnpm install --frozen-lockfile
```

### 2. Add packageManager field to package.json (alternative approach)

An alternative to the `corepack prepare` step is to add a `packageManager` field to `package.json`. This is the standard way to declare the package manager version for corepack and is recognized by `actions/setup-node` for cache key computation.

```json
{
  "packageManager": "pnpm@10.30.3"
}
```

However, this creates a second source of truth alongside `mise.toml`. The team already uses mise as the canonical tool version manager. Adding `packageManager` to `package.json` means two places need updating when the pnpm version changes. The `corepack prepare` approach in the workflow (reading from `mise.toml`) avoids this duplication, so the plan does **not** include adding `packageManager` to `package.json`.

## File Paths That Need Modification

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | New file -- the complete CI workflow |

No existing files need modification.

## Final Workflow File

Combining everything above, the complete workflow file is:

**File: `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    name: Typecheck, Lint & Test
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Read tool versions from mise.toml
        id: versions
        run: |
          echo "node=$(grep '^node' mise.toml | cut -d'"' -f2)" >> "$GITHUB_OUTPUT"
          echo "pnpm=$(grep '^pnpm' mise.toml | cut -d'"' -f2)" >> "$GITHUB_OUTPUT"

      - name: Enable corepack
        run: corepack enable

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ steps.versions.outputs.node }}
          cache: pnpm

      - name: Prepare pnpm
        run: corepack prepare pnpm@${{ steps.versions.outputs.pnpm }} --activate

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Typecheck E2E
        run: pnpm typecheck:e2e

      - name: Lint
        run: pnpm lint

      - name: Unit tests
        run: pnpm test:ci
```

## Considerations and Trade-offs

### Single job vs. matrix / parallel jobs

**Chosen**: Single job running all four checks sequentially.

**Alternative**: A matrix strategy or separate jobs for each check. This would allow checks to run in parallel, but each job requires its own checkout + Node setup + pnpm install cycle. Given the checks total under 10 seconds of actual work, the overhead of multiple jobs (30-60 seconds each for setup) would make the overall pipeline slower and consume more GitHub Actions minutes. A single job is the clear winner here.

If any individual check becomes significantly slower in the future (e.g., a large test suite taking minutes), splitting into parallel jobs would become worthwhile.

### Version extraction from mise.toml

**Chosen**: Parse `mise.toml` at runtime with `grep` + `cut`.

**Alternative 1**: Hardcode versions in the workflow. Simpler but creates drift risk -- the team would need to remember to update both `mise.toml` and `ci.yml` when upgrading Node or pnpm.

**Alternative 2**: Install mise on the CI runner and use `mise install` to set up the toolchain. This would be the most faithful reproduction of the local dev environment, but mise adds an extra installation step and dependency. For just Node + pnpm, `actions/setup-node` is simpler, faster, and well-maintained.

**Alternative 3**: Add a `packageManager` field to `package.json`. This is the "corepack-native" approach but creates a second source of truth alongside `mise.toml`.

The `grep`/`cut` approach keeps `mise.toml` as the single source of truth with minimal complexity. The parsing is fragile in theory (it assumes a specific format in `mise.toml`), but `mise.toml` has a simple, stable TOML format and the project's file has exactly two lines under `[tools]`. If the format becomes more complex in the future, switching to a proper TOML parser or mise installation would be straightforward.

### ESLint warnings policy

Currently `pnpm lint` exits 0 despite producing 2 warnings (`import/no-named-as-default-member` on i18next usage). The workflow accepts this behavior -- warnings do not fail the build.

If the team later wants warnings to fail CI, the `lint` script in `package.json` should be changed to `expo lint -- --max-warnings 0`. This is a separate decision from the workflow setup and can be done independently.

### The `--passWithNoTests` flag

The `test:ci` script uses `jest --passWithNoTests`, which means a misconfigured `testMatch` could silently pass with zero tests. Currently 66 tests run, so this is not an issue. If the team is concerned about this, they could add a follow-up step that parses Jest's JSON output and asserts a minimum test count. This is not included in the initial workflow to keep things simple.

### No concurrency control

The workflow does not set a `concurrency` group. This means multiple workflow runs for the same PR can run simultaneously (e.g., if a developer pushes twice quickly). For a lightweight CI job that completes in under 2 minutes, this is fine -- the cost is negligible and the latest run's status is what matters. If the team wants to cancel in-progress runs when a new push arrives, they can add:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

This is a minor optimization and can be added later if desired.

### Ubuntu vs. macOS runner

**Chosen**: `ubuntu-latest`. All four checks are pure JavaScript/TypeScript operations with no native code dependencies. Ubuntu runners are cheaper (free for public repos, lower rate for private repos) and start faster than macOS runners.

macOS runners would only be needed for E2E tests or native builds, which are excluded from this workflow.

### The `file:` dependency (audio-encoder local module)

The `audio-encoder` package is declared as `"file:./modules/audio-encoder"` in `package.json`. On `pnpm install --frozen-lockfile`, pnpm creates a symlink to this local directory. This works correctly on Ubuntu runners as long as the `modules/audio-encoder` directory is present (it is checked into the repo). The lockfile (v9.0) records this as a `link:` dependency, and `--frozen-lockfile` does not prevent symlink creation. No special handling is needed.

### Node 24 availability on GitHub Actions

Node.js 24.14.0 is not pre-installed on GitHub Actions runners (which default to Node 20). The `actions/setup-node@v4` action will download and cache Node 24.14.0 on the first run. This adds a one-time download of ~30MB but is cached for subsequent runs. As of early 2026, Node 24.x is an active LTS release and is fully supported by `actions/setup-node`.

## Todo

### 1. Create directory structure

- [x] Create `.github/workflows/` directory if it does not already exist

### 2. Create the CI workflow file

- [x] Create `.github/workflows/ci.yml` with the complete workflow definition
- [x] Set workflow name to `CI`
- [x] Configure `on.push.branches` trigger for `main`
- [x] Configure `on.pull_request.branches` trigger for `main`
- [x] Define `check` job with `runs-on: ubuntu-latest`
- [x] Add `actions/checkout@v4` step
- [x] Add "Read tool versions from mise.toml" step that extracts `node` and `pnpm` versions from `mise.toml` into `$GITHUB_OUTPUT`
- [x] Add `corepack enable` step (must come before `actions/setup-node`)
- [x] Add `actions/setup-node@v4` step using extracted Node version and `cache: pnpm`
- [x] Add `corepack prepare pnpm@<version> --activate` step using extracted pnpm version
- [x] Add `pnpm install --frozen-lockfile` step
- [x] Add `pnpm typecheck` step
- [x] Add `pnpm typecheck:e2e` step
- [x] Add `pnpm lint` step
- [x] Add `pnpm test:ci` step

### 3. Verify locally

- [x] Confirm `mise.toml` contains `node` and `pnpm` entries in the expected `key = "version"` format so the `grep`/`cut` parsing works
- [x] Run `pnpm typecheck` locally and confirm it passes
- [x] Run `pnpm typecheck:e2e` locally and confirm it passes
- [x] Run `pnpm lint` locally and confirm it passes
- [x] Run `pnpm test:ci` locally and confirm it passes

### 4. Validate workflow syntax

- [x] Verify the YAML is valid (no indentation or syntax errors)
- [x] Confirm all `${{ }}` expression references (e.g. `steps.versions.outputs.node`) match their source step IDs and output names
