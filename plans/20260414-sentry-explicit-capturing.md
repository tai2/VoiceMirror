# Add Explicit Sentry Exception and Message Capturing

## Goal

Enhance the Sentry integration beyond automatic unhandled-exception capture by adding explicit `captureException`, `captureMessage`, and `addBreadcrumb` calls at every known error/warning site in the application. Currently, Sentry only captures unhandled JS exceptions and native crashes. All caught exceptions in the codebase are silently swallowed with `console.error` -- invisible to Sentry. This means production failures in audio encoding, decoding, file I/O, and settings persistence go unnoticed unless a user explicitly reports them.

After this change, every caught error and significant application event will be reported to Sentry with structured context (file paths, phases, sample rates, durations), making it possible to diagnose production issues from the Sentry dashboard.

## Architecture / Approach

### Strategy

1. **Create a thin Sentry helper module** (`src/lib/sentryHelpers.ts`) that wraps `Sentry.captureException`, `Sentry.captureMessage`, and `Sentry.addBreadcrumb` with app-specific context. This keeps the Sentry import centralized and makes it easy to no-op in tests (the module can be mocked).

2. **Add `captureException` at every existing `catch` block** that currently only does `console.error`. These represent real failures that should appear as Sentry issues. Each call includes structured context about what operation failed and with what parameters.

3. **Add `captureMessage` for notable non-exception error conditions** -- situations where no exception is thrown but something went wrong (e.g., encoder returned duration 0, encoder skipped due to prior failure).

4. **Add breadcrumbs at key state transitions** in the voice mirror lifecycle (permission granted, recording started, recording stopped, playback started, pause/resume). These appear in the Sentry event timeline and provide critical context for understanding what the user was doing before an error occurred.

5. **Keep `console.error`/`console.warn` calls intact** alongside the Sentry calls. They remain useful for local development debugging where Sentry may not be configured.

### Why a helper module

- Avoids importing `* as Sentry from '@sentry/react-native'` in every file
- Provides type-safe context parameters for common operations
- Can be trivially replaced with no-ops in unit tests (no need to mock the Sentry SDK)
- Single place to adjust severity levels, fingerprinting, or tags later

### Scope of changes

The changes are purely additive: no existing logic is altered. Every modification is adding a Sentry call next to an existing `console.error`, `console.warn`, or at a state transition boundary.

## File Changes

### 1. New file: `src/lib/sentryHelpers.ts`

A lightweight wrapper that provides typed capture functions:

```typescript
import * as Sentry from '@sentry/react-native';

/**
 * Capture a caught exception with structured context.
 * Use this at every catch block that handles a real error.
 */
export function captureException(
  error: unknown,
  context: Record<string, unknown>,
): void {
  Sentry.withScope((scope) => {
    scope.setContext('operation', context);
    Sentry.captureException(error);
  });
}

/**
 * Capture a non-exception error message with structured context.
 * Use for situations where no exception was thrown but something went wrong.
 */
export function captureMessage(
  message: string,
  context: Record<string, unknown>,
  level: Sentry.SeverityLevel = 'error',
): void {
  Sentry.withScope((scope) => {
    scope.setContext('operation', context);
    scope.setLevel(level);
    Sentry.captureMessage(message);
  });
}

/**
 * Record a breadcrumb for a significant app event.
 * Breadcrumbs appear in the timeline of the next Sentry error event.
 */
export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
  level: Sentry.SeverityLevel = 'info',
): void {
  Sentry.addBreadcrumb({
    category,
    message,
    data,
    level,
  });
}
```

### 2. Modify: `src/hooks/useVoiceMirror.ts`

Add Sentry captures at every existing `console.error` site and breadcrumbs at state transitions.

**Add import:**

```typescript
import { captureException, captureMessage, addBreadcrumb } from '../lib/sentryHelpers';
```

**In `beginEncoding()` -- startEncoding failure (line ~88-92):**

```typescript
    } catch (e) {
      console.error('[AudioEncoder] startEncoding failed:', e);
      captureException(e, {
        operation: 'AudioEncoder.startEncoding',
        filePath,
        sampleRate: context.sampleRate,
      });
      return;
    }
```

**In `beginEncoding()` -- encodeChunk failure during catchup (line ~107-111):**

```typescript
      } catch (e) {
        console.error('[AudioEncoder] encodeChunk failed:', e);
        captureException(e, {
          operation: 'AudioEncoder.encodeChunk',
          phase: 'catchup',
          filePath,
        });
        encoderFailedRef.current = true;
      }
```

**In `startMonitoring()` -- encodeChunk failure during streaming (line ~202-206):**

```typescript
          } catch (e) {
            console.error('[AudioEncoder] encodeChunk failed:', e);
            captureException(e, {
              operation: 'AudioEncoder.encodeChunk',
              phase: 'streaming',
            });
            encoderFailedRef.current = true;
          }
```

**In `stopAndPlay()` -- stopEncoding returned 0 (line ~245-246):**

```typescript
        if (durationMs === 0) {
          console.error(`[AudioEncoder] stopEncoding returned 0 for ${filePath}`);
          captureMessage('AudioEncoder stopEncoding returned duration 0', {
            operation: 'AudioEncoder.stopEncoding',
            filePath,
            sampleRate: context.sampleRate,
          });
        }
```

**In `stopAndPlay()` -- stopEncoding threw (line ~248-249):**

```typescript
      } catch (e) {
        console.error(`[AudioEncoder] stopEncoding threw for ${filePath}:`, e);
        captureException(e, {
          operation: 'AudioEncoder.stopEncoding',
          filePath,
          sampleRate: context.sampleRate,
        });
      }
```

**In `stopAndPlay()` -- skipped stopEncoding due to prior chunk error (line ~251-252):**

```typescript
    } else if (filePath && encoderFailedRef.current) {
      console.error(`[AudioEncoder] skipped stopEncoding due to prior chunk error: ${filePath}`);
      captureMessage('AudioEncoder skipped stopEncoding due to prior chunk error', {
        operation: 'AudioEncoder.stopEncoding',
        filePath,
        reason: 'prior_chunk_error',
      }, 'warning');
    }
```

**In `pauseMonitoring()` -- stopEncoding failed during pause cleanup (line ~314-316):**

```typescript
        } catch (e) {
          console.error('[AudioEncoder] stopEncoding failed during pause cleanup:', e);
          captureException(e, {
            operation: 'AudioEncoder.stopEncoding',
            phase: 'pause_cleanup',
            filePath,
          });
        }
```

**Breadcrumbs for state transitions -- add at the appropriate locations:**

In `startMonitoring()`, after the recorder starts (after line ~181):
```typescript
    addBreadcrumb('voicemirror', 'Monitoring started', {
      sampleRate: context.sampleRate,
    });
```

In `tickStateMachine()`, when transitioning to recording (after `setPhase('recording')` around line ~132):
```typescript
          addBreadcrumb('voicemirror', 'Recording started', {
            voiceStartFrame: voiceStartFrameRef.current,
          });
```

In `tickStateMachine()`, when transitioning to playing (after `setPhase('playing')` around lines ~143, ~155):
```typescript
          addBreadcrumb('voicemirror', 'Recording stopped, playing back');
```

In `pauseMonitoring()`, at the start:
```typescript
    addBreadcrumb('voicemirror', 'Monitoring paused');
```

In `resumeMonitoring()`, at the start:
```typescript
    addBreadcrumb('voicemirror', 'Monitoring resumed');
```

### 3. Modify: `src/hooks/useRecordings.ts`

**Add import:**

```typescript
import { captureException, addBreadcrumb } from '../lib/sentryHelpers';
```

**In `togglePlay()` -- decodeAudioData failure (line ~131-133):**

```typescript
    } catch (e) {
      console.error('[useRecordings] decodeAudioData failed:', e);
      captureException(e, {
        operation: 'AudioDecoder.decodeAudioData',
        filePath: recording.filePath,
        recordingId: recording.id,
        sampleRate: audioContext.sampleRate,
      });
      isDecodingRef.current = false;
      setPlayState(null);
      await options.onDidStop();
      return;
    }
```

**Breadcrumb for list playback start -- after `source.start(0)` (line ~151):**

```typescript
    addBreadcrumb('recordings', 'List playback started', {
      recordingId: recording.id,
      durationMs: recording.durationMs,
    });
```

### 4. Modify: `src/lib/recordings.ts`

**Add import:**

```typescript
import { captureException, captureMessage } from './sentryHelpers';
```

**In `loadRecordings()` -- stale entry warning (line ~31-34):**

```typescript
    } else {
      console.warn(
        `[recordings] Removing stale entry: ${recording.filePath} (file not found on disk)`,
      );
      captureMessage('Stale recording entry removed (file missing)', {
        operation: 'loadRecordings',
        filePath: recording.filePath,
        recordingId: recording.id,
      }, 'warning');
    }
```

**In `loadRecordings()` -- orphaned file warning (line ~46-48):**

```typescript
      console.warn(
        `[recordings] Deleting orphaned file: ${entry.uri} (not in index)`,
      );
      captureMessage('Orphaned recording file deleted', {
        operation: 'loadRecordings',
        fileUri: entry.uri,
      }, 'warning');
```

**In `loadRecordings()` -- failed to delete orphaned file (line ~51-53):**

```typescript
      } catch (e) {
        console.error(`[recordings] Failed to delete orphaned file: ${entry.uri}`, e);
        captureException(e, {
          operation: 'deleteOrphanedFile',
          fileUri: entry.uri,
        });
      }
```

### 5. Modify: `src/context/SettingsProvider.tsx`

Settings persistence failures are currently completely silent (the `void` promise is fire-and-forget). Add error handling with Sentry capture.

**Add import:**

```typescript
import { captureException } from '../lib/sentryHelpers';
```

**In `updateSetting` -- wrap the repository.save call (line ~38):**

Change:
```typescript
      void repository.save(key, value);
```

To:
```typescript
      repository.save(key, value).catch((e) => {
        captureException(e, {
          operation: 'SettingsRepository.save',
          key,
          value,
        });
      });
```

**In `resetSettings` -- wrap the repository.resetAll call (line ~44):**

Change:
```typescript
    void repository.resetAll();
```

To:
```typescript
    repository.resetAll().catch((e) => {
      captureException(e, {
        operation: 'SettingsRepository.resetAll',
      });
    });
```

**In the `useEffect` -- wrap the repository.load call (line ~28-30):**

Change:
```typescript
    repository.load().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
```

To:
```typescript
    repository.load().then((s) => {
      setSettings(s);
      setLoaded(true);
    }).catch((e) => {
      captureException(e, {
        operation: 'SettingsRepository.load',
      });
      setLoaded(true); // proceed with defaults
    });
```

### 6. Modify: `src/context/AudioContextProvider.tsx`

The `AudioContext` constructor could theoretically throw. Add a safety net.

**Add import:**

```typescript
import { captureException, addBreadcrumb } from '../lib/sentryHelpers';
```

**Wrap the AudioContext creation (lines ~10-12):**

Change:
```typescript
    const context = new AudioContext();
    setCtx(context);
    return () => { void context.close(); };
```

To:
```typescript
    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch (e) {
      captureException(e, {
        operation: 'AudioContext.create',
      });
      return;
    }
    addBreadcrumb('audio', 'AudioContext created', {
      sampleRate: context.sampleRate,
    });
    setCtx(context);
    return () => { void context.close(); };
```

### 7. Modify: `src/hooks/useVoiceMirror.ts` (additional: permission breadcrumb)

In the `useEffect` that handles permissions (line ~60-73), add breadcrumbs:

After permission granted (after `setHasPermission(true)`, line ~66):
```typescript
      addBreadcrumb('voicemirror', 'Microphone permission granted');
```

When permission denied (after `setPermissionDenied(true)`, line ~64):
```typescript
        addBreadcrumb('voicemirror', 'Microphone permission denied', undefined, 'warning');
```

## Summary of All Files Modified

| File | Changes |
|---|---|
| `src/lib/sentryHelpers.ts` | **New file** -- centralized `captureException`, `captureMessage`, `addBreadcrumb` wrappers |
| `src/hooks/useVoiceMirror.ts` | 6 `captureException` calls, 2 `captureMessage` calls, 5 breadcrumbs |
| `src/hooks/useRecordings.ts` | 1 `captureException` call, 1 breadcrumb |
| `src/lib/recordings.ts` | 1 `captureException` call, 2 `captureMessage` calls |
| `src/context/SettingsProvider.tsx` | 3 `captureException` calls (load, save, resetAll) |
| `src/context/AudioContextProvider.tsx` | 1 `captureException` call, 1 breadcrumb |

## Considerations and Trade-offs

### Event volume and quotas

Adding explicit `captureException` and `captureMessage` calls increases the number of events sent to Sentry. In pathological cases (e.g., the encoder repeatedly failing on every audio chunk during a long recording), this could generate many events quickly. Mitigation: Sentry's built-in rate limiting and deduplication handles this -- the SDK has a `maxQueueSize` of 30 and the server side deduplicates identical issues. The `encodeChunk` failure during streaming also sets `encoderFailedRef.current = true`, which prevents further chunks from being attempted, so in practice only one event is sent per recording attempt.

### Warning-level messages for non-critical conditions

Stale recording entries and orphaned files are captured at `warning` level, not `error`. These represent data consistency issues that self-heal (the app fixes them automatically). They are worth knowing about for patterns (e.g., "are orphaned files increasing?") but should not trigger alerts.

### No changes to the Sentry `init` configuration

The existing configuration with `replaysOnErrorSampleRate: 1` means every error event will include a session replay, which is valuable for debugging. No changes needed to the init call.

### Test impact

The new `src/lib/sentryHelpers.ts` module imports `@sentry/react-native`, which is a native module. In unit tests, this module will need to be mocked. The simplest approach is a Jest module mock:

```typescript
// In jest.setup.js or a __mocks__ file
jest.mock('../src/lib/sentryHelpers', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
```

Since the helper functions are side-effect-only (they return `void`), mocking them as no-ops has zero impact on test assertions. No existing tests need logic changes.

### Why not inject Sentry as a service dependency

The project architecture injects services (AudioRecordingService, AudioEncoderService, etc.) to enable test stubbing. Sentry capturing is a cross-cutting observability concern, not a service the application logic depends on. Making it injectable would add complexity (passing through context, adding to `Services` type) without benefit -- the mock at module level is sufficient and simpler. If a future need arises to verify that specific errors are captured in tests, the mock can be changed to a spy.

### The sentryHelpers module does not wrap `Sentry.init` or `Sentry.wrap`

Those remain in `app/_layout.tsx` where they must run at app startup before any component renders. Only the per-event capturing APIs are centralized.

## Todo

### Phase 1: Create the Sentry helper module

- [x] Create `src/lib/sentryHelpers.ts` with `captureException` wrapper (accepts `error: unknown` and `context: Record<string, unknown>`, uses `Sentry.withScope`)
- [x] Add `captureMessage` wrapper (accepts `message`, `context`, optional `level` defaulting to `'error'`)
- [x] Add `addBreadcrumb` wrapper (accepts `category`, `message`, optional `data`, optional `level` defaulting to `'info'`)

### Phase 2: Add Sentry captures to `src/hooks/useVoiceMirror.ts`

- [x] Add import of `captureException`, `captureMessage`, `addBreadcrumb` from `../lib/sentryHelpers`
- [x] Add `captureException` in `beginEncoding()` catch block for `startEncoding` failure (with `operation`, `filePath`, `sampleRate` context)
- [x] Add `captureException` in `beginEncoding()` catch block for `encodeChunk` failure during catchup (with `operation`, `phase: 'catchup'`, `filePath` context)
- [x] Add `captureException` in `startMonitoring()` catch block for `encodeChunk` failure during streaming (with `operation`, `phase: 'streaming'` context)
- [x] Add `captureMessage` in `stopAndPlay()` when `stopEncoding` returns duration 0 (with `operation`, `filePath`, `sampleRate` context)
- [x] Add `captureException` in `stopAndPlay()` catch block when `stopEncoding` throws (with `operation`, `filePath`, `sampleRate` context)
- [x] Add `captureMessage` in `stopAndPlay()` when stopEncoding is skipped due to prior chunk error (with `operation`, `filePath`, `reason` context, level `'warning'`)
- [x] Add `captureException` in `pauseMonitoring()` catch block for `stopEncoding` failure during pause cleanup (with `operation`, `phase: 'pause_cleanup'`, `filePath` context)
- [x] Add `addBreadcrumb` in `startMonitoring()` after recorder starts ("Monitoring started" with `sampleRate`)
- [x] Add `addBreadcrumb` in `tickStateMachine()` when transitioning to recording ("Recording started" with `voiceStartFrame`)
- [x] Add `addBreadcrumb` in `tickStateMachine()` when transitioning to playing ("Recording stopped, playing back")
- [x] Add `addBreadcrumb` in `pauseMonitoring()` at start ("Monitoring paused")
- [x] Add `addBreadcrumb` in `resumeMonitoring()` at start ("Monitoring resumed")
- [x] Add `addBreadcrumb` in permission `useEffect` when permission granted ("Microphone permission granted")
- [x] Add `addBreadcrumb` in permission `useEffect` when permission denied ("Microphone permission denied", level `'warning'`)

### Phase 3: Add Sentry captures to `src/hooks/useRecordings.ts`

- [x] Add import of `captureException`, `addBreadcrumb` from `../lib/sentryHelpers`
- [x] Add `captureException` in `togglePlay()` catch block for `decodeAudioData` failure (with `operation`, `filePath`, `recordingId`, `sampleRate` context)
- [x] Add `addBreadcrumb` after `source.start(0)` for list playback start (with `recordingId`, `durationMs`)

### Phase 4: Add Sentry captures to `src/lib/recordings.ts`

- [x] Add import of `captureException`, `captureMessage` from `./sentryHelpers`
- [x] Add `captureMessage` in `loadRecordings()` for stale entry removal warning (with `operation`, `filePath`, `recordingId` context, level `'warning'`)
- [x] Add `captureMessage` in `loadRecordings()` for orphaned file deletion warning (with `operation`, `fileUri` context, level `'warning'`)
- [x] Add `captureException` in `loadRecordings()` catch block for failed orphaned file deletion (with `operation`, `fileUri` context)

### Phase 5: Add Sentry captures to `src/context/SettingsProvider.tsx`

- [x] Add import of `captureException` from `../lib/sentryHelpers`
- [x] Change `void repository.save(key, value)` in `updateSetting` to use `.catch()` with `captureException` (with `operation`, `key`, `value` context)
- [x] Change `void repository.resetAll()` in `resetSettings` to use `.catch()` with `captureException` (with `operation` context)
- [x] Add `.catch()` to `repository.load()` in the `useEffect`, calling `captureException` (with `operation` context) and still calling `setLoaded(true)` to proceed with defaults

### Phase 6: Add Sentry captures to `src/context/AudioContextProvider.tsx`

- [x] Add import of `addBreadcrumb` from `../lib/sentryHelpers`
- [x] ~~Wrap `new AudioContext()` in try/catch~~ — skipped, constructor without arguments doesn't throw
- [x] Add `addBreadcrumb` after successful AudioContext creation ("AudioContext created" with `sampleRate`)

### Phase 7: Test setup and verification

- [x] Add `jest.mock('../lib/sentryHelpers')` (or equivalent path) to each test file that imports modules now depending on `sentryHelpers`: `src/hooks/__tests__/useVoiceMirror.test.ts`, `src/hooks/__tests__/useRecordings.test.ts`, `src/lib/__tests__/recordings.test.ts`
- [x] Run `pnpm typecheck` and fix any type errors
- [x] Run `pnpm lint` and fix any lint issues
- [x] Run `pnpm test:ci` and confirm all existing tests pass with the new mocks
