# VoiceMirror

## Prerequisites

- [mise](https://mise.jdx.dev/) — manages Node.js and pnpm versions

## Setup

```sh
mise trust
mise install
pnpm install
```

## Development

Start the dev server (requires the development build installed on your device):

```sh
pnpm start
```

## Type checking

```sh
pnpm run typecheck
```

## Builds (EAS)

| Command | Description |
|---|---|
| `pnpm run build:dev:ios` | Development build for iOS |
| `pnpm run build:dev:android` | Development build for Android |
| `pnpm run build:preview` | Preview build for both platforms |
| `pnpm run build:prod` | Production build for both platforms |

Builds are run on EAS. You must be logged in:

```sh
npx eas-cli whoami        # check current login
npx eas-cli login         # log in
```

## Unit tests

```sh
pnpm test:ci
```

## E2E tests

E2E tests use WebDriverIO + Appium to drive the app on a simulator/emulator. An in-app WebSocket bridge replaces the real microphone so tests can inject audio programmatically.

### Prerequisites

- Copy `.env.example` to `.env` and adjust the simulator/emulator names if yours differ.
- An Android emulator or iOS simulator matching the names in `.env` must be available.

### 1. Build the E2E binary

Local builds (recommended for development):

```sh
pnpm run build:e2e:android:local   # → artifacts/VoiceMirror.apk
pnpm run build:e2e:ios:local       # → artifacts/VoiceMirror.app
```

Or build on EAS (cloud):

```sh
pnpm run build:e2e:android
pnpm run build:e2e:ios
```

When using EAS, download the artifact and place it in `artifacts/`.

### 2. Run the tests

```sh
pnpm run e2e:android
pnpm run e2e:ios
```

## Register a device (iOS internal distribution)

```sh
pnpm run device:register
```

Open the URL or scan the QR code on the target iPhone to install the registration profile.
