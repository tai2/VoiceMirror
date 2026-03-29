# Fix Orphaned Recordings Files -- Implementation Plan

## Goal

Eliminate orphaned `.m4a` files that accumulate in the `recordings/` directory without corresponding entries in `index.json`. These files consume storage indefinitely and are invisible to the user. The fix addresses both the reactive problem (cleaning up orphans that already exist or get created) and the proactive problem (preventing new orphans from being created in the first place).

## Architecture / Approach

The research identified six concrete scenarios that create orphaned files. The fix is a two-pronged strategy:

1. **Startup orphan scan**: On app load, scan the `recordings/` directory for `.m4a` files that have no matching entry in `index.json`, and delete them. This is the primary safety net -- it catches orphans regardless of how they were created (crash, failed encoding, interrupted pause, etc.).

2. **Proactive cleanup in `pauseMonitoring`**: When the user pauses during an active recording, properly finalize or discard the in-progress encoding and delete the pending file. This prevents the most concrete orphan-creation bug identified in the research (Scenario 7).

### Why not fix every scenario individually?

The research identified scenarios involving failed `deleteFile` calls (Scenarios 5, 6), failed index writes (Scenario 4), and app crashes (Scenario 1). Adding try/catch around every `deleteFile` and `save` call would add complexity but still could not handle crashes or force-quits. The startup scan approach is a single, universal safety net that handles all of these cases. It runs once per app launch and the cost is negligible (one directory listing + set comparison).

### Where the scan runs

The scan is placed in `loadRecordings()` in `src/lib/recordings.ts`. This function already runs on app start (called by `repository.load()` from `useRecordings`), and it already performs the inverse operation (pruning index entries whose files are missing). Adding the forward scan here means both directions of inconsistency are resolved in the same place, at the same time.

### How the scan works

The expo-file-system `Directory` class provides a `list()` method that returns an array of `File` and `Directory` instances. The scan:

1. Calls `recordingsDir().list()` to get all entries in the `recordings/` directory
2. Filters for `File` instances whose names end in `.m4a`
3. Builds a `Set` of file URIs from the loaded (and already-validated) index entries
4. Deletes any `.m4a` file whose URI is not in the set

### How `pauseMonitoring` cleanup works

When `pauseMonitoring()` is called while `phaseRef.current === 'recording'`, there is an active encoding session with a file being written. The fix adds cleanup logic: if `pendingFilePathRef.current` is set, call `encoderService.stopEncoding()` (to finalize/close the native encoder), then delete the partially-written file via `repository.deleteFile()`, and clear the ref.

### Data flow

```
App startup
  -> useRecordings mounts
  -> repository.load()
  -> loadRecordings()
    1. Read index.json -> recordings[]
    2. Prune stale entries (file missing for index entry)   [existing]
    3. Scan recordings/ directory for .m4a files            [NEW]
    4. Build set of valid file URIs from pruned recordings
    5. Delete any .m4a file not in the set                  [NEW]
    6. Return cleaned recordings[]
```

```
User taps pause while recording
  -> pauseMonitoring()
    1. Stop player node if active                           [existing]
    2. Stop recorder                                        [existing]
    3. If pendingFilePathRef.current is set:                 [NEW]
       a. Try encoderService.stopEncoding() (ignore result)
       b. repository.deleteFile(pendingFilePathRef.current)
       c. Clear pendingFilePathRef.current
    4. Set phase to 'paused'                                [existing]
```

## Code Changes

### 1. Add orphan scan to `loadRecordings()` in `src/lib/recordings.ts`

The `loadRecordings` function already validates index entries against the filesystem. After that validation, add a reverse scan that checks the filesystem against the index.

The `recordingsDir()` helper already exists and returns a `Directory` instance. The `Directory.list()` method returns `(Directory | File)[]`. We filter for `File` instances ending in `.m4a`, compare their URIs against the set of valid recording file paths, and delete any that are not referenced.

```typescript
export async function loadRecordings(): Promise<Recording[]> {
  ensureDir();
  const file = indexFile();
  if (!file.exists) return [];
  const json = await file.text();
  const recordings = JSON.parse(json) as Recording[];

  // Prune stale index entries (file missing on disk)
  const valid: Recording[] = [];
  for (const recording of recordings) {
    const audioFile = new File(recording.filePath);
    if (audioFile.exists) {
      valid.push(recording);
    } else {
      console.warn(
        `[recordings] Removing stale entry: ${recording.filePath} (file not found on disk)`,
      );
    }
  }

  if (valid.length !== recordings.length) {
    saveRecordings(valid);
  }

  // Delete orphaned .m4a files (on disk but not in index)
  const validUris = new Set(valid.map(r => r.filePath));
  const dir = recordingsDir();
  for (const entry of dir.list()) {
    if (entry instanceof File && entry.uri.endsWith('.m4a') && !validUris.has(entry.uri)) {
      console.warn(
        `[recordings] Deleting orphaned file: ${entry.uri} (not in index)`,
      );
      entry.delete();
    }
  }

  return valid;
}
```

Note: `recording.filePath` values are stored with the `file://` prefix (e.g. `file:///path/to/recording.m4a`), and `entry.uri` from `Directory.list()` also uses the `file://` prefix. So the comparison works directly -- no prefix stripping needed.

### 2. Add encoding cleanup to `pauseMonitoring()` in `src/hooks/useVoiceMirror.ts`

When the user pauses during an active recording, the pending file must be cleaned up. The encoder needs to be stopped (to release native resources) and the partially-written file deleted.

```typescript
async function pauseMonitoring() {
  if (playerNodeRef.current) {
    playerNodeRef.current.onEnded = null;
    playerNodeRef.current.stop();
    playerNodeRef.current = null;
  }
  const recorder = audioRecorderRef.current!;
  recorder.clearOnAudioReady();
  recorder.stop();

  // Clean up in-progress encoding if paused during recording
  if (pendingFilePathRef.current) {
    const filePath = pendingFilePathRef.current;
    pendingFilePathRef.current = null;
    if (!encoderFailedRef.current) {
      try {
        await encoderService.stopEncoding();
      } catch (e) {
        console.error('[AudioEncoder] stopEncoding failed during pause cleanup:', e);
      }
    }
    repository.deleteFile(filePath);
  }

  await recordingService.setAudioSessionActivity(false);
  phaseRef.current = 'paused';
  setPhase('paused');
  setLevelHistory(new Array(LEVEL_HISTORY_SIZE).fill(0));
}
```

Key details:
- We capture `pendingFilePathRef.current` and immediately clear it, matching the pattern in `stopAndPlay()`.
- If the encoder had not already failed (`encoderFailedRef` is false), we call `stopEncoding()` to properly finalize the native encoder state. The return value (duration) is discarded since we are throwing away this recording.
- If the encoder had already failed (a chunk error occurred), we skip `stopEncoding()` -- same logic as in `stopAndPlay()`.
- We then delete the file via `repository.deleteFile()`.
- This must happen before `setAudioSessionActivity(false)` since we need to finalize the encoder first.

### 3. Add `listFiles` to `IRecordingsRepository` and `RealRecordingsRepository`

The orphan scan in `loadRecordings` uses `Directory.list()` directly from `expo-file-system`, which is fine since `loadRecordings` already depends on `expo-file-system` directly. No repository change is needed for this.

However, we should consider: the repository interface does not need to grow for this feature because the orphan scan is entirely contained within the `recordings.ts` library module, which already owns the filesystem interaction layer. The repository is a thin wrapper and its consumers (hooks) do not need to know about the scan.

### 4. Update tests for `loadRecordings` in `src/lib/__tests__/recordings.test.ts`

The mock for `expo-file-system` needs to be extended so that `MockDirectory` supports a `list()` method that returns `MockFile` instances for files that exist in the mock `store` under the recordings directory path.

```typescript
jest.mock('expo-file-system', () => {
  class MockFile {
    private key: string;
    constructor(parentOrUri: { uri?: string } | string, name?: string) {
      if (typeof parentOrUri === 'string') {
        this.key = parentOrUri.replace('file://', '');
      } else {
        const parentUri = (parentOrUri as { uri?: string }).uri ?? '';
        this.key = `${parentUri.replace('file://', '')}/${name ?? ''}`;
      }
    }
    get uri() { return 'file://' + this.key; }
    get exists() { return this.key in store; }
    async text() { return store[this.key] ?? '[]'; }
    write(content: string) { store[this.key] = content; }
    delete() { delete store[this.key]; }
  }

  return {
    Paths: { document: '/mock/documents' },
    Directory: class MockDirectory {
      parent: string;
      name: string;
      constructor(parent: { uri?: string } | string, name: string) {
        this.parent = typeof parent === 'string' ? parent : (parent as { uri?: string }).uri ?? '';
        this.name = name;
      }
      get uri() { return `file://${this.parent}/${this.name}`; }
      get exists() {
        return (`${this.parent}/${this.name}`) in store || true;
      }
      create(_opts?: { intermediates?: boolean }) {}
      list() {
        const dirPath = `${this.parent}/${this.name}`;
        return Object.keys(store)
          .filter(k => k.startsWith(dirPath + '/') && k.endsWith('.m4a'))
          .map(k => new MockFile('file://' + k));
      }
    },
    File: MockFile,
  };
});
```

Key changes:
- Extract `MockFile` to a named class so `MockDirectory.list()` can reference it.
- Add `uri` getter to `MockDirectory` (needed for consistency, and `list()` returns `File` instances constructed from URIs).
- Add `list()` method to `MockDirectory` that scans the `store` for keys under the directory path ending in `.m4a`.
- The `instanceof File` check in `loadRecordings` will work because the mock `File` class is used consistently.

New test cases:

```typescript
describe('loadRecordings -- orphan cleanup', () => {
  it('deletes .m4a files in the recordings directory that are not in the index', async () => {
    const recordings = [
      { id: '1', filePath: 'file:///mock/documents/recordings/a.m4a', recordedAt: '2026-01-01T00:00:00.000Z', durationMs: 1000 },
    ];
    saveRecordings(recordings);
    // a.m4a is referenced by the index
    store['/mock/documents/recordings/a.m4a'] = 'audio-data';
    // orphan.m4a is NOT referenced by the index
    store['/mock/documents/recordings/orphan.m4a'] = 'orphan-audio-data';

    await loadRecordings();

    expect(store['/mock/documents/recordings/a.m4a']).toBe('audio-data');
    expect('/mock/documents/recordings/orphan.m4a' in store).toBe(false);
  });

  it('does not delete non-.m4a files in the recordings directory', async () => {
    saveRecordings([]);
    store['/mock/documents/recordings/index.json'] = '[]';
    store['/mock/documents/recordings/notes.txt'] = 'some notes';

    await loadRecordings();

    // The list() mock only returns .m4a files, so non-.m4a files are untouched
    expect(store['/mock/documents/recordings/notes.txt']).toBe('some notes');
  });

  it('logs a warning for each orphaned file deleted', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    saveRecordings([]);
    store['/mock/documents/recordings/orphan.m4a'] = 'orphan-data';

    await loadRecordings();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Deleting orphaned file'),
    );
    warnSpy.mockRestore();
  });
});
```

### 5. Update tests for `pauseMonitoring` cleanup in `src/hooks/__tests__/useVoiceMirror.test.ts`

Add a test that verifies when the user pauses during the recording phase, the pending file is cleaned up:

```typescript
describe('useVoiceMirror -- pause during recording cleanup', () => {
  it('calls stopEncoding and deleteFile when paused during recording', async () => {
    const { result, recordingService, encoderService, repository } = await setupWithPermission();

    // Drive the state machine to recording phase
    act(() => { simulateVoiceOnset(recordingService); });
    expect(result.current.phase).toBe('recording');

    // Pause while recording
    await act(async () => { result.current.togglePause(); });

    expect(result.current.phase).toBe('paused');
    expect(encoderService.stopEncoding).toHaveBeenCalledTimes(1);
    expect(repository.deleteFile).toHaveBeenCalledTimes(1);
    expect(repository.deleteFile).toHaveBeenCalledWith(expect.stringContaining('.m4a'));
  });

  it('skips stopEncoding but still deletes file when encoder had failed', async () => {
    const { result, recordingService, encoderService, repository } = await setupWithPermission();

    // Make encodeChunk fail so encoderFailedRef becomes true
    encoderService.encodeChunk.mockImplementation(() => { throw new Error('encode failed'); });

    act(() => { simulateVoiceOnset(recordingService); });
    expect(result.current.phase).toBe('recording');

    // Feed one more chunk to trigger the error in onAudioReady handler
    act(() => {
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeLoudChunk());
    });

    await act(async () => { result.current.togglePause(); });

    expect(result.current.phase).toBe('paused');
    expect(encoderService.stopEncoding).not.toHaveBeenCalled();
    expect(repository.deleteFile).toHaveBeenCalledTimes(1);
  });

  it('does not call stopEncoding or deleteFile when paused from idle', async () => {
    const { result, encoderService, repository } = await setupWithPermission();

    expect(result.current.phase).toBe('idle');

    await act(async () => { result.current.togglePause(); });

    expect(result.current.phase).toBe('paused');
    expect(encoderService.stopEncoding).not.toHaveBeenCalled();
    expect(repository.deleteFile).not.toHaveBeenCalled();
  });
});
```

Note: The `beginEncoding` function in `useVoiceMirror` calls `encoderService.encodeChunk` for retroactive pre-voice chunks. If we make `encodeChunk` throw immediately, `encoderFailedRef` gets set to `true` during `beginEncoding` itself. The second test case needs to account for this -- the `encodeChunk` mock should only start failing after `beginEncoding` completes, or we accept that `encoderFailedRef` will already be true from the retroactive chunk encoding in `beginEncoding`. Either way, the important assertion is that `stopEncoding` is NOT called when the encoder had failed, and `deleteFile` IS called regardless.

## Files That Need Modification

| File | Change |
|------|--------|
| `src/lib/recordings.ts` | Add orphan file scan after stale entry cleanup in `loadRecordings()` |
| `src/hooks/useVoiceMirror.ts` | Add encoding cleanup logic to `pauseMonitoring()` when paused during recording |
| `src/lib/__tests__/recordings.test.ts` | Extend mock to support `Directory.list()`, add orphan cleanup test cases |
| `src/hooks/__tests__/useVoiceMirror.test.ts` | Add test cases for pause-during-recording cleanup |

## Considerations and Trade-offs

### Startup scan vs. periodic background scan

**Chosen**: Run the orphan scan once during `loadRecordings()` at app startup.

**Alternative**: A periodic background scan (e.g., every N minutes). This is unnecessary because orphans can only be created during app operation (recording, encoding), and the app restarts frequently enough on mobile that a startup scan catches them promptly. A periodic scan adds timer management complexity and would run during normal operation when the recordings directory is actively being written to, creating potential race conditions.

### Scan location: `loadRecordings()` vs. a separate function

**Chosen**: Inline the scan in `loadRecordings()`. Both the forward scan (stale entries) and backward scan (orphan files) are logically part of "loading recordings and ensuring consistency." Keeping them together makes the consistency guarantees clear and means there is a single function responsible for all reconciliation.

**Alternative**: A separate `cleanOrphanedFiles()` function called alongside `loadRecordings()`. This would be cleaner from a single-responsibility perspective but would require callers to remember to call both functions, and the orphan scan needs the list of valid recordings to know which files to keep -- duplicating the load logic or passing data between functions.

### `instanceof File` check reliability in the orphan scan

The `Directory.list()` method returns `(Directory | File)[]`. The orphan scan uses `entry instanceof File` to distinguish files from subdirectories. This works because both the calling code and the returned instances use the same `File` class from `expo-file-system`. In tests, the mock must ensure the same mock `File` class is used for `list()` results and the `File` export, which is achieved by extracting the class definition.

### Making `pauseMonitoring` async

`pauseMonitoring()` is already an `async` function. Adding `await encoderService.stopEncoding()` does not change its signature. However, `stopEncoding()` returns a `Promise<number>` (the duration), and we discard it. The `await` is needed to ensure the native encoder is properly finalized before we delete the file.

### Race condition: what if a new recording starts while the orphan scan is running?

This cannot happen. `loadRecordings()` runs during the initial mount of `useRecordings`, before the voice mirror cycle begins recording. By the time the user can trigger a recording, the scan has already completed. Additionally, `loadRecordings` is synchronous in its filesystem operations (only the index file read is async via `file.text()`), so the scan completes atomically from the perspective of the main thread.

### Error handling around orphan deletion

If `entry.delete()` throws for an orphaned file (e.g., permission error), we should not crash the app or prevent recordings from loading. The deletion should be wrapped in a try/catch that logs the error and continues. This matches the defensive style already used throughout the codebase.

```typescript
for (const entry of dir.list()) {
  if (entry instanceof File && entry.uri.endsWith('.m4a') && !validUris.has(entry.uri)) {
    console.warn(
      `[recordings] Deleting orphaned file: ${entry.uri} (not in index)`,
    );
    try {
      entry.delete();
    } catch (e) {
      console.error(`[recordings] Failed to delete orphaned file: ${entry.uri}`, e);
    }
  }
}
```

### Why not also fix `deleteFile` error handling (Scenarios 5, 6)?

Adding try/catch to `deleteFile` in `deleteRecording` and FIFO eviction would be a good hardening measure, but it is not strictly necessary when the startup scan exists. The startup scan catches any files that `deleteFile` failed to remove. Adding error handling to `deleteFile` would prevent the orphan from being created in the first place, but the file would be cleaned up on next launch regardless. This plan focuses on the two highest-impact changes; `deleteFile` error handling can be added as a follow-up if desired.

### Why not fix `saveRecordings` error handling (Scenario 4)?

Similarly, wrapping `saveRecordings` in try/catch would prevent the in-memory/on-disk divergence that creates orphans when the index write fails. But a failed index write on a mobile device typically indicates a serious storage problem (disk full), and the startup scan will catch any resulting orphans. This is left as a potential follow-up.

### Impact on `index.json` itself

The `index.json` file also lives in the `recordings/` directory. The orphan scan filters by `.m4a` extension, so `index.json` is never touched by the scan. This is important -- deleting the index file would wipe all recording metadata.

## Todo

### Phase 1: Startup orphan scan in `loadRecordings()`

- [x] In `src/lib/recordings.ts`, after the existing stale-entry pruning loop in `loadRecordings()`, build a `Set<string>` of valid file URIs from the pruned `valid` array
- [x] Call `recordingsDir().list()` to enumerate all entries in the recordings directory
- [x] Iterate over entries, filtering for `instanceof File` with `.m4a` extension
- [x] Delete any `.m4a` file whose URI is not in the valid set
- [x] Wrap each `entry.delete()` call in a try/catch that logs the error and continues (defensive error handling)
- [x] Add `console.warn` logging for each orphaned file deleted

### Phase 2: Encoding cleanup in `pauseMonitoring()`

- [x] In `src/hooks/useVoiceMirror.ts`, inside `pauseMonitoring()`, add a check for `pendingFilePathRef.current` being set
- [x] Capture the pending file path and immediately clear `pendingFilePathRef.current`
- [x] If `encoderFailedRef.current` is false, call `await encoderService.stopEncoding()` wrapped in try/catch
- [x] Call `repository.deleteFile(filePath)` to remove the partially-written file
- [x] Ensure this cleanup block runs before `recordingService.setAudioSessionActivity(false)`

### Phase 3: Update test mock for `expo-file-system` in `src/lib/__tests__/recordings.test.ts`

- [x] Extract the anonymous `MockFile` class to a named class definition so `MockDirectory.list()` can reference it
- [x] Add a `uri` getter to `MockDirectory` returning `file://` prefixed path
- [x] Add a `list()` method to `MockDirectory` that scans the mock `store` for keys under its directory path ending in `.m4a` and returns `MockFile` instances
- [x] Verify that `instanceof File` checks work correctly with the mock classes

### Phase 4: Add orphan cleanup tests in `src/lib/__tests__/recordings.test.ts`

- [x] Add test: deletes `.m4a` files in the recordings directory that are not in the index
- [x] Add test: does not delete `.m4a` files that are referenced by the index
- [x] Add test: does not delete non-`.m4a` files in the recordings directory
- [x] Add test: logs a warning for each orphaned file deleted

### Phase 5: Add pause-during-recording cleanup tests in `src/hooks/__tests__/useVoiceMirror.test.ts`

- [x] Add test: calls `stopEncoding` and `deleteFile` when paused during recording phase
- [x] Add test: skips `stopEncoding` but still calls `deleteFile` when encoder had previously failed
- [x] Add test: does not call `stopEncoding` or `deleteFile` when paused from idle phase

### Phase 6: Verification

- [x] Run `pnpm typecheck` and confirm no type errors
- [x] Run `pnpm lint` and confirm no lint errors
- [x] Run `pnpm test:ci` and confirm all tests pass (existing and new)
