# Plan: Migrate Android E2E Tests to Real Device over LAN

> Date: 2026-04-16

## Goal

Replace the Android emulator-based E2E test infrastructure with real-device-only support over LAN. The Android emulator is too unstable for reliable QA, so it is being abandoned entirely. All emulator-specific configuration (AVD name, `10.0.2.2` gateway, related env vars) will be removed. The app and test runner will communicate over the local network using the host machine's actual LAN IP.

---

## Architecture / Approach

### Current state

The Android E2E infrastructure is built around the emulator:

1. **WebSocket host** -- `E2EAudioRecordingService.ts` line 13 hardcodes `WS_HOST = "10.0.2.2"` for Android. This is the emulator's special gateway to the host machine's loopback and has no meaning on a real device.
2. **Appium capabilities** -- `wdio.android.conf.ts` sets `appium:avd` to `Pixel_9_API_36` (via `E2E_ANDROID_AVD` env var), which tells Appium to launch a named AVD. This is emulator-only; it has no effect on real devices.
3. **Env vars** -- `.env` and `.env.example` contain `E2E_ANDROID_AVD=Pixel_9_API_36`, which is emulator-specific.
4. **Cleartext traffic** -- Already handled by `plugins/withCleartextTraffic.js` when `EXPO_PUBLIC_E2E=1`. The `network_security_config.xml` uses `<base-config cleartextTrafficPermitted="true"/>`, permitting cleartext to all hosts. No change needed.
5. **Audio bridge** -- `E2EAudioBridge.ts` already binds to `0.0.0.0:9876`, accepting connections from any interface. No change needed.

### Target state

```
Test Runner (host machine, e.g. 192.168.1.42)    Real Android Device (same LAN)
----------------------------------------------    ----------------------------------
WebdriverIO spec                                  E2EAudioRecordingService
  |                                                 |
  +-- E2EAudioBridge (WS server 0.0.0.0:9876)     <--- E2EAudioRecorder (WS client)
  |     sends Float32Array binary frames --->           connects to ws://192.168.1.42:9876
  |                                                     (IP from EXPO_PUBLIC_E2E_WS_HOST)
  +-- Appium/UiAutomator2 commands
        connects to device via ADB
        (USB or `adb connect` over LAN)
```

### Key changes

1. **Make `WS_HOST` configurable via env var** -- Replace the hardcoded `10.0.2.2` with a value read from `EXPO_PUBLIC_E2E_WS_HOST`. This compile-time env var is baked into the APK by Expo's bundler. On iOS (simulator), fall back to `127.0.0.1` as before.

2. **Modify `wdio.android.conf.ts` for real device** -- Remove `appium:avd` (emulator-only). Add `appium:udid` from an env var to target a specific device. Add `appium:autoGrantPermissions: true` to handle OS permission prompts automatically.

3. **Update build script** -- Modify `build:e2e:android:local` to require `E2E_WS_HOST` and pass it through as `EXPO_PUBLIC_E2E_WS_HOST`.

4. **Clean up env vars** -- Remove `E2E_ANDROID_AVD` from `.env` and `.env.example`. Add `E2E_WS_HOST` and `E2E_ANDROID_UDID`.

5. **Update spec comments** -- Remove references to emulator slowness in `voiceMirror.spec.ts`.

---

## Detailed Changes

### 1. `src/services/E2EAudioRecordingService.ts` -- Make WS_HOST configurable

Replace the hardcoded emulator gateway with a configurable host address.

```typescript
// Before (line 13):
const WS_HOST = Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1";

// After:
const WS_HOST =
  process.env.EXPO_PUBLIC_E2E_WS_HOST ??
  (Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1");
```

When `EXPO_PUBLIC_E2E_WS_HOST` is set at build time (e.g., `EXPO_PUBLIC_E2E_WS_HOST=192.168.1.42`), Expo's bundler inlines it as a string literal. The fallback preserves compatibility for any scenario where the env var is unset (e.g., someone running on an emulator for quick local testing), but the primary path is always through the env var.

**File**: `/Users/tai2/VoiceMirror/src/services/E2EAudioRecordingService.ts`, line 13.

### 2. `e2e/wdio.android.conf.ts` -- Convert from emulator to real device

Replace emulator-specific capabilities with real-device ones.

```typescript
// Before:
import path from "path";
import type { Options, Capabilities } from "@wdio/types";
import { config as iosConfig } from "./wdio.ios.conf";

type WdioConfig = Options.Testrunner &
  Capabilities.WithRequestedTestrunnerCapabilities;

export const config: WdioConfig = {
  ...iosConfig,

  capabilities: [
    {
      platformName: "Android",
      "appium:avd": process.env.E2E_ANDROID_AVD ?? "Pixel_9_API_36",
      "appium:automationName": "UiAutomator2",
      "appium:app": path.resolve(__dirname, "../artifacts/VoiceMirror.apk"),
      "appium:noReset": false,
    },
  ],

  mochaOpts: {
    ...iosConfig.mochaOpts,
    timeout: 300_000,
  },
};

// After:
import path from "path";
import type { Options, Capabilities } from "@wdio/types";
import { config as iosConfig } from "./wdio.ios.conf";

type WdioConfig = Options.Testrunner &
  Capabilities.WithRequestedTestrunnerCapabilities;

export const config: WdioConfig = {
  ...iosConfig,

  capabilities: [
    {
      platformName: "Android",
      "appium:automationName": "UiAutomator2",
      "appium:app": path.resolve(__dirname, "../artifacts/VoiceMirror.apk"),
      "appium:udid": process.env.E2E_ANDROID_UDID,
      "appium:autoGrantPermissions": true,
      "appium:noReset": false,
    },
  ],

  mochaOpts: {
    ...iosConfig.mochaOpts,
    timeout: 300_000,
  },
};
```

Key changes:

- **Removed `appium:avd`** -- This capability is emulator-only. It tells Appium to launch a named AVD. For a real device, it is not needed and would cause confusion.
- **Added `appium:udid`** -- Identifies the specific physical device (from `adb devices`). Read from `E2E_ANDROID_UDID` env var. When only one device is connected via ADB, Appium auto-selects it even without this, but being explicit avoids ambiguity when multiple devices/emulators are connected.
- **Added `appium:autoGrantPermissions: true`** -- On a real device, the app may trigger OS-level permission prompts (e.g., microphone). Even though `E2EAudioRecordingService` doesn't use the real mic, the native `react-native-audio-api` initialization may still request it. This capability tells UiAutomator2 to auto-grant all requested permissions at install time.
- **Kept `timeout: 300_000`** -- Real devices are generally faster than emulators, but the generous timeout doesn't hurt and provides headroom for slow Wi-Fi or first-run setup.

**File**: `/Users/tai2/VoiceMirror/e2e/wdio.android.conf.ts`.

### 3. `package.json` -- Update build script

Modify the existing `build:e2e:android:local` script to pass through `E2E_WS_HOST` as `EXPO_PUBLIC_E2E_WS_HOST`.

```jsonc
// Before:
"build:e2e:android:local": "export EXPO_PUBLIC_E2E=1 && npx expo prebuild --platform android && (cd android && ./gradlew assembleRelease) && mkdir -p artifacts && cp android/app/build/outputs/apk/release/app-release*.apk artifacts/VoiceMirror.apk",

// After:
"build:e2e:android:local": "export EXPO_PUBLIC_E2E=1 && export EXPO_PUBLIC_E2E_WS_HOST=${E2E_WS_HOST:?\"Set E2E_WS_HOST to your machine's LAN IP (e.g. 192.168.1.42)\"} && npx expo prebuild --platform android && (cd android && ./gradlew assembleRelease) && mkdir -p artifacts && cp android/app/build/outputs/apk/release/app-release*.apk artifacts/VoiceMirror.apk",
```

The `${E2E_WS_HOST:?...}` syntax causes the script to fail immediately with a clear error if `E2E_WS_HOST` is not set. This prevents accidentally building an APK with the wrong (fallback) WebSocket host. The `E2E_WS_HOST` value comes from the `.env` file (loaded by the shell) or is set directly in the environment before running the command.

**File**: `/Users/tai2/VoiceMirror/package.json`.

### 4. `.env.example` and `.env` -- Update env vars

Remove the emulator-specific `E2E_ANDROID_AVD` and add real-device variables.

```
# Before:
E2E_IOS_DEVICE_NAME=iPhone 17 Pro
E2E_IOS_PLATFORM_VERSION=26.3
E2E_ANDROID_AVD=Pixel_9_API_36

# After:
E2E_IOS_DEVICE_NAME=iPhone 17 Pro
E2E_IOS_PLATFORM_VERSION=26.3
# Host machine's LAN IP for Android real device E2E tests.
# Find it with: ipconfig getifaddr en0 (macOS)
E2E_WS_HOST=192.168.1.42
# Android device serial (from `adb devices`). Optional if only one device is connected.
E2E_ANDROID_UDID=
```

**Files**: `/Users/tai2/VoiceMirror/.env.example`, `/Users/tai2/VoiceMirror/.env`.

### 5. `e2e/specs/voiceMirror.spec.ts` -- Update comments

Remove the emulator-specific comment at the top of the timeout constants.

```typescript
// Before (line 10-11):
// Appium/UiAutomator2 on Android emulators can be extremely slow (10-20s per command).
// These timeouts account for that latency.

// After:
// UiAutomator2 commands can take several seconds.
// These timeouts provide comfortable headroom.
```

**File**: `/Users/tai2/VoiceMirror/e2e/specs/voiceMirror.spec.ts`, lines 10-11.

### 6. Files that need NO changes

- **`plugins/withCleartextTraffic.js`** -- Already permits cleartext to all hosts when `EXPO_PUBLIC_E2E=1`. Works for LAN communication as-is.
- **`e2e/helpers/E2EAudioBridge.ts`** -- Already binds to `0.0.0.0:9876`, accepting connections from any network interface.
- **`eas.json`** -- The `e2e` build profile already produces an APK (`buildType: apk`). No emulator-specific settings here.
- **`tsconfig.e2e.json`** -- No emulator-specific content.

---

## Considerations and Trade-offs

### Build-time vs. runtime host IP

The host IP is baked in at build time via `EXPO_PUBLIC_E2E_WS_HOST`. This means the APK is tied to a specific network configuration. If the host machine's IP changes (e.g., reconnecting to Wi-Fi), the APK must be rebuilt. The alternative -- passing the IP at runtime via an Appium capability or deep link -- would require native code to extract it and pass it to JS, adding complexity disproportionate to the problem. Since E2E builds are already disposable release builds, rebuilding is acceptable.

### ADB connectivity prerequisites

The device must be reachable via ADB before running tests. Two options:

- **USB**: Plug in the device, enable USB debugging. ADB detects it automatically. Simplest and most reliable.
- **Wireless debugging (ADB over Wi-Fi)**: Enable wireless debugging on the device, run `adb pair <device-ip>:<pairing-port>` then `adb connect <device-ip>:<port>`. Same network as the WebSocket bridge. Slightly more fragile but fully wireless.

Either way, `adb devices` must list the device before running `pnpm e2e:android`. The WDIO Appium service does not handle ADB pairing.

### Firewall on the host machine

The host's firewall must allow inbound connections on port 9876 (WebSocket bridge). On macOS, the built-in firewall may prompt to allow Node.js to accept incoming connections on first run. If the WebSocket connection times out, this is the first thing to check.

### Why not a separate config file for real devices

The previous version of this plan proposed creating a new `wdio.android-device.conf.ts` alongside the existing emulator config. Since the emulator is being abandoned entirely, there is no reason to maintain two configs. Modifying `wdio.android.conf.ts` in-place keeps things simple and avoids orphaned files.

### Permission handling on real devices

On a real device with `appium:noReset: false`, app data is cleared between sessions, which means OS permission dialogs (microphone) will appear every session. Adding `appium:autoGrantPermissions: true` tells UiAutomator2 to auto-grant permissions at install time, preventing these dialogs from blocking tests.

### Timeout retention

The 300s Mocha timeout is retained despite real devices generally being faster than emulators. There is no downside to a generous timeout, and real-device test runs over Wi-Fi can occasionally experience latency spikes. Tests that pass complete in the same time regardless of the timeout ceiling.

---

## Files Summary

| File                                       | Action                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `src/services/E2EAudioRecordingService.ts` | Modify line 13: read `EXPO_PUBLIC_E2E_WS_HOST` with fallback                       |
| `e2e/wdio.android.conf.ts`                 | Modify: remove `appium:avd`, add `appium:udid` and `appium:autoGrantPermissions`   |
| `package.json`                             | Modify: update `build:e2e:android:local` to require and pass through `E2E_WS_HOST` |
| `.env.example`                             | Modify: remove `E2E_ANDROID_AVD`, add `E2E_WS_HOST` and `E2E_ANDROID_UDID`         |
| `.env`                                     | Modify: remove `E2E_ANDROID_AVD`, add `E2E_WS_HOST` and `E2E_ANDROID_UDID`         |
| `e2e/specs/voiceMirror.spec.ts`            | Modify: update emulator-specific comment                                           |

---

## Todo

### 1. Make WS_HOST configurable in E2EAudioRecordingService

- [x] In `src/services/E2EAudioRecordingService.ts`, replace hardcoded `WS_HOST` on line 13 with `process.env.EXPO_PUBLIC_E2E_WS_HOST ?? (Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1")`

### 2. Convert wdio.android.conf.ts from emulator to real device

- [x] Remove `"appium:avd": process.env.E2E_ANDROID_AVD ?? "Pixel_9_API_36"` from capabilities
- [x] Add `"appium:udid": process.env.E2E_ANDROID_UDID` to capabilities
- [x] Add `"appium:autoGrantPermissions": true` to capabilities

### 3. Update build script in package.json

- [x] Modify `build:e2e:android:local` script to add `export EXPO_PUBLIC_E2E_WS_HOST=${E2E_WS_HOST:?\"Set E2E_WS_HOST to your machine's LAN IP (e.g. 192.168.1.42)\"}` before `npx expo prebuild`

### 4. Update environment variable files

- [x] In `.env.example`, remove `E2E_ANDROID_AVD=Pixel_9_API_36`
- [x] In `.env.example`, add `E2E_WS_HOST=192.168.1.42` with comment explaining how to find it
- [x] In `.env.example`, add `E2E_ANDROID_UDID=` with comment noting it is optional for single-device setups
- [x] In `.env`, remove `E2E_ANDROID_AVD=Pixel_9_API_36`
- [x] In `.env`, add `E2E_WS_HOST` with the actual LAN IP value
- [x] In `.env`, add `E2E_ANDROID_UDID=`

### 5. Update spec comments

- [x] In `e2e/specs/voiceMirror.spec.ts`, replace emulator-specific timeout comment (lines 10-11) with generic UiAutomator2 wording

### 6. Verification

- [x] Run `pnpm typecheck` to ensure no type errors
- [x] Run `pnpm lint` to ensure no lint violations
- [x] Run `pnpm test:ci` to ensure existing unit tests still pass
