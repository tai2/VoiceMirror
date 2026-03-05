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

## Register a device (iOS internal distribution)

```sh
pnpm run device:register
```

Open the URL or scan the QR code on the target iPhone to install the registration profile.
