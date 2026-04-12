# VoiceMirror — Claude Code Guide

## Project Overview

VoiceMirror is a React Native/Expo app that implements a voice mirror: it listens for your voice, records until silence, then immediately plays the recording back.

## Tooling & Setup

- mise shims are in PATH — use `pnpm` directly
- **EAS CLI**: used via `npx eas-cli@latest` (not installed globally)

## Verification

- `pnpm typecheck` to check types
- `pnpm lint` to check code styles
  - Don't disable rule unless explicitly asked by developer
- `pnpm test:ci` to run unit tests
- `pnpm e2e:ios` and `pnpm e2e:android` to run E2E tests
- `pnpm e2e:{ios,android} --mochaOpts.grep 'Test case title'` to run specific test cases of E2E tests

## Design and unit testing

- Extract meaningful functionality unit which depends on uncontrollable API(e.g. `react-native-audio-api`, 
  `expo-file-system`) as service under @src/services or repository under @src/repositories so that we can replace it
  with stub in unit testing. Those services should be injected through arguments as dependency to custom hooks. This
  allows us to focus on testing application logic.
- On UI components, services should be injected through context provider and its hook. This allows us to switch it with
  stub in unit testing.

## Native development

- Stick to CNG. Don't touch native projects directly.