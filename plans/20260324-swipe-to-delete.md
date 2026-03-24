# Plan: Swipe-to-Delete Recordings

> Date: 2026-03-24

## Goal

Allow users to delete recordings by swiping left on a recording row. Two gestures:

1. **Partial swipe** — reveals a red trash icon button; tapping it deletes the recording.
2. **Full swipe** — swipe past a threshold to delete immediately in one motion.

---

## Approach: `react-native-gesture-handler` Swipeable

React Native's built-in `PanResponder` is low-level and requires manual animation. `react-native-gesture-handler` provides a `Swipeable` component (backed by `ReanimatedSwipeable` or the legacy `Swipeable`) that handles both partial and full swipe patterns out of the box.

Since the project already uses `react-native-audio-api` (a native module requiring dev builds), adding another native dependency is no additional burden — the app already can't run in Expo Go.

### Alternative considered: plain `Animated` + `PanResponder`

This would avoid a new dependency but requires ~100 lines of gesture math, snapping logic, and manual threshold handling. `Swipeable` encapsulates all of this. Given the project's preference for simplicity, the library is the better trade-off.

---

## Step 1: Install `react-native-gesture-handler`

```sh
npx expo install react-native-gesture-handler
```

Wrap the app root with `<GestureHandlerRootView>` in `App.tsx`:

```tsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// In the render:
<GestureHandlerRootView style={{ flex: 1 }}>
  <ServicesProvider services={services}>
    <VoiceMirrorScreen />
  </ServicesProvider>
</GestureHandlerRootView>
```

> This is required for gestures to work. It must be at or near the root of the component tree.

---

## Step 2: Add `deleteRecording` to `useRecordings`

### 2-1. Add `deleteRecording` to `RecordingsState`

`src/hooks/useRecordings.ts`:

```typescript
export type RecordingsState = {
  recordings: Recording[];
  playState: PlayState;
  addRecording: (filePath: string, durationMs: number) => void;
  deleteRecording: (id: string) => void;
  togglePlay: (recording: Recording) => void;
};
```

### 2-2. Implement `deleteRecording`

Inside `useRecordings`:

```typescript
const deleteRecording = useCallback((id: string) => {
  const recording = recordingsRef.current.find(r => r.id === id);
  if (!recording) return;

  // Stop playback if this recording is currently playing
  if (playState?.recordingId === id) {
    stopCurrentPlayer(true);
  }

  // Remove the audio file from disk
  repository.deleteFile(recording.filePath.replace('file://', ''));

  // Update state and persist
  const next = recordingsRef.current.filter(r => r.id !== id);
  setRecordings(next);
  repositoryRef.current.save(next);
}, [playState, repository, stopCurrentPlayer]);
```

### 2-3. Return it

```typescript
return { recordings, playState, addRecording, deleteRecording, togglePlay };
```

---

## Step 3: Add `onDelete` prop through `RecordingsList`

### 3-1. Update `RecordingsList` props

`src/components/RecordingsList.tsx`:

```typescript
type Props = {
  recordings: Recording[];
  playState: PlayState;
  onTogglePlay: (r: Recording) => void;
  onDelete: (r: Recording) => void;
  disabled: boolean;
};
```

Pass it through to `RecordingItem`:

```tsx
<RecordingItem
  recording={item}
  playState={playState}
  onTogglePlay={() => onTogglePlay(item)}
  onDelete={() => onDelete(item)}
  disabled={disabled}
/>
```

### 3-2. Update `VoiceMirrorScreen`

```tsx
const { recordings, playState, addRecording, deleteRecording, togglePlay } = useRecordings(
  { onWillPlay: stableSuspend, onDidStop: stableResume },
  audioContext,
  recordingsRepository,
  decoderService,
);

// ...

<RecordingsList
  recordings={recordings}
  playState={playState}
  onTogglePlay={togglePlay}
  onDelete={(r) => deleteRecording(r.id)}
  disabled={phase === 'recording'}
/>
```

---

## Step 4: Implement swipe-to-delete in `RecordingItem`

This is the core UI change. Wrap the existing row content in a `Swipeable` from `react-native-gesture-handler`.

### 4-1. Full `RecordingItem.tsx` replacement

```tsx
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useRef } from 'react';
import type { Recording } from '../lib/recordings';
import type { PlayState } from '../hooks/useRecordings';

// formatDate, formatDuration unchanged...

const DELETE_THRESHOLD = 0.5; // ratio of row width — full-swipe triggers at 50%

type Props = {
  recording: Recording;
  playState: PlayState;
  onTogglePlay: () => void;
  onDelete: () => void;
  disabled: boolean;
};

export function RecordingItem({ recording, playState, onTogglePlay, onDelete, disabled }: Props) {
  const isPlaying = playState?.recordingId === recording.id && playState.isPlaying;
  const swipeableRef = useRef<Swipeable>(null);

  function renderRightActions(
    progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
  ) {
    const translateX = dragX.interpolate({
      inputRange: [-80, 0],
      outputRange: [0, 80],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View style={[styles.deleteAction, { transform: [{ translateX }] }]}>
        <Pressable
          onPress={() => {
            swipeableRef.current?.close();
            onDelete();
          }}
          style={styles.deleteButton}
        >
          <Text style={styles.deleteIcon}>🗑</Text>
          <Text style={styles.deleteLabel}>Delete</Text>
        </Pressable>
      </Animated.View>
    );
  }

  function handleFullSwipe() {
    onDelete();
  }

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      rightThreshold={80 * DELETE_THRESHOLD}
      onSwipeableWillOpen={(direction) => {
        if (direction === 'right') handleFullSwipe();
      }}
      overshootRight={false}
      enabled={!disabled}
    >
      <View style={styles.row}>
        <Pressable
          testID={`play-recording-${recording.id}`}
          accessibilityLabel={`play-recording-${recording.id}`}
          onPress={onTogglePlay}
          disabled={disabled}
          style={({ pressed }) => [
            styles.playButton,
            disabled && styles.playButtonDisabled,
            pressed && styles.playButtonPressed,
          ]}
          hitSlop={8}
        >
          <Text style={styles.playIcon}>{isPlaying ? '■' : '▶'}</Text>
        </Pressable>
        <View style={styles.meta}>
          <Text style={styles.date}>{formatDate(recording.recordedAt)}</Text>
          <Text style={styles.duration}>{formatDuration(recording.durationMs)}</Text>
        </View>
      </View>
    </Swipeable>
  );
}
```

### 4-2. Additional styles

```typescript
// Add to existing StyleSheet.create:
deleteAction: {
  width: 80,
  backgroundColor: '#FF3B30',
  justifyContent: 'center',
  alignItems: 'center',
},
deleteButton: {
  flex: 1,
  justifyContent: 'center',
  alignItems: 'center',
  width: '100%',
},
deleteIcon: {
  fontSize: 20,
},
deleteLabel: {
  color: '#FFF',
  fontSize: 11,
  marginTop: 2,
},
```

### 4-3. Key behaviors

| Gesture | What happens |
|---------|-------------|
| Swipe left < 80pt | Springs back, no action |
| Swipe left ≥ 40pt (half of 80) and release | Snaps open, reveals red delete button |
| Tap the delete button | Closes the swipeable, calls `onDelete()` |
| Swipe left past full threshold | `onSwipeableWillOpen('right')` fires, calls `onDelete()` immediately |
| `disabled={true}` (during recording phase) | Swipe gesture is disabled |

> Note: `Swipeable`'s `onSwipeableWillOpen` with direction `'right'` means the right actions are being revealed (i.e., user swiped left). The naming refers to which action panel opens, not swipe direction.

---

## Step 5: Add `deleteRecording` to `IRecordingsRepository`

The `deleteFile` method already exists on the repository, but it takes a raw path. The `deleteRecording` logic in the hook uses it correctly. No interface changes needed — `deleteFile(path)` already covers this.

However, note that `Recording.filePath` stores `file://`-prefixed URIs. The `deleteFile` call must strip the prefix:

```typescript
repository.deleteFile(recording.filePath.replace('file://', ''));
```

This is already how `RealRecordingsRepository.deleteFile` works — it re-adds `file://` internally:

```typescript
deleteFile(path: string): void {
  new File('file://' + path).delete();
}
```

---

## Step 6: Unit Tests

### 6-1. `useRecordings` — deleteRecording tests

Add to `src/hooks/__tests__/useRecordings.test.ts`:

```typescript
describe('useRecordings — deleteRecording', () => {
  it('removes the recording from the list', async () => {
    const r1 = makeRecording({ id: '1' });
    const r2 = makeRecording({ id: '2', filePath: 'file:///tmp/recording_2.m4a' });
    const { result } = setup([r1, r2]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(2));

    act(() => { result.current.deleteRecording('1'); });

    expect(result.current.recordings).toHaveLength(1);
    expect(result.current.recordings[0].id).toBe('2');
  });

  it('calls repository.deleteFile with the path (file:// stripped)', async () => {
    const r = makeRecording({ id: '1', filePath: 'file:///tmp/recording_1.m4a' });
    const { result, repository } = setup([r]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    act(() => { result.current.deleteRecording('1'); });

    expect(repository.deleteFile).toHaveBeenCalledWith('/tmp/recording_1.m4a');
  });

  it('calls repository.save with the updated list', async () => {
    const r = makeRecording({ id: '1' });
    const { result, repository } = setup([r]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    act(() => { result.current.deleteRecording('1'); });

    const lastSaveCall = repository.save.mock.calls[repository.save.mock.calls.length - 1];
    expect(lastSaveCall[0]).toHaveLength(0);
  });

  it('stops playback if the deleted recording is currently playing', async () => {
    const r = makeRecording({ id: '1' });
    const { result, onDidStop } = setup([r]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    await act(async () => { result.current.togglePlay(r); });
    expect(result.current.playState?.recordingId).toBe('1');

    act(() => { result.current.deleteRecording('1'); });

    expect(result.current.playState).toBeNull();
    expect(onDidStop).toHaveBeenCalled();
  });

  it('is a no-op for a non-existent id', async () => {
    const r = makeRecording({ id: '1' });
    const { result, repository } = setup([r]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    act(() => { result.current.deleteRecording('nonexistent'); });

    expect(result.current.recordings).toHaveLength(1);
    expect(repository.deleteFile).not.toHaveBeenCalled();
  });
});
```

### 6-2. `RecordingItem` — swipeable rendering test

Since `Swipeable` gesture simulation is complex in JSDOM, focus on verifying the component renders without errors and the delete action is present. Full swipe behavior is better covered by E2E tests.

Add to `src/components/__tests__/RecordingItem.test.tsx`:

```typescript
import { render } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { RecordingItem } from '../RecordingItem';

// Wrap in GestureHandlerRootView for Swipeable to work
function renderWithGesture(ui: React.ReactElement) {
  return render(<GestureHandlerRootView>{ui}</GestureHandlerRootView>);
}

it('renders without crashing with onDelete prop', () => {
  renderWithGesture(
    <RecordingItem
      recording={{ id: '1', filePath: 'file:///test.m4a', recordedAt: '2026-03-24T10:00:00Z', durationMs: 1000 }}
      playState={null}
      onTogglePlay={jest.fn()}
      onDelete={jest.fn()}
      disabled={false}
    />,
  );
});
```

---

## Step 7: E2E Tests

Add a new `describe` block to `e2e/specs/voiceMirror.spec.ts`. The test must first produce a recording (drive the voice-mirror loop to completion), then perform the swipe gesture on it.

### 7-1. Helper: create a recording

Extract the record-and-wait-for-idle sequence into a reusable helper since it's already repeated in existing tests:

```typescript
async function createRecording(bridge: E2EAudioBridge) {
  await bridge.sendVoice(VOICE_ONSET_MS + 200);
  await $("~phase-recording").waitForDisplayed({ timeout: 5_000 });
  await bridge.sendVoice(MIN_RECORDING_MS + 200);
  await bridge.sendSilence(SILENCE_DURATION_MS + 500);
  await $("~phase-playing").waitForDisplayed({ timeout: 10_000 });
  await $("~phase-idle").waitForDisplayed({ timeout: 15_000 });
}
```

### 7-2. Helper: find recording elements

```typescript
function recordingSelector() {
  return browser.isAndroid
    ? 'android=new UiSelector().descriptionStartsWith("play-recording-")'
    : '-ios predicate string:name BEGINSWITH "play-recording-"';
}
```

### 7-3. Swipe-to-delete test spec

WebdriverIO's `element.touchAction` or `driver.action('pointer')` can perform swipe gestures. Use the W3C Actions API for cross-platform swipe:

```typescript
async function swipeLeft(element: WebdriverIO.Element, distance: number) {
  const location = await element.getLocation();
  const size = await element.getSize();
  const startX = location.x + size.width - 10;
  const startY = location.y + size.height / 2;
  const endX = startX - distance;

  await driver.action('pointer', {
    parameters: { pointerType: 'touch' },
  })
    .move({ x: startX, y: startY })
    .down()
    .move({ x: endX, y: startY, duration: 300 })
    .up()
    .perform();
}

describe("VoiceMirror — swipe to delete", () => {
  beforeEach(async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: 10_000 });
  });

  it("partial swipe reveals delete button, tap deletes recording", async () => {
    await createRecording(bridge);

    const items = $$(recordingSelector());
    expect(items).toBeElementsArrayOfSize({ gte: 1 });
    const firstItem = items[0];

    // Partial swipe left (~80px) to reveal delete button
    await swipeLeft(firstItem, 80);

    // Tap the delete button
    const deleteButton = $("~delete-recording");
    await deleteButton.waitForDisplayed({ timeout: 3_000 });
    await deleteButton.click();

    // Verify the recording is removed
    await browser.waitUntil(
      async () => (await $$(recordingSelector())).length === 0,
      { timeout: 5_000, timeoutMsg: "Recording was not deleted" },
    );
  });

  it("full swipe left deletes recording immediately", async () => {
    await createRecording(bridge);

    const items = $$(recordingSelector());
    expect(items).toBeElementsArrayOfSize({ gte: 1 });
    const firstItem = items[0];

    // Get the element width to compute a full swipe distance
    const size = await firstItem.getSize();

    // Swipe most of the row width to trigger full-swipe delete
    await swipeLeft(firstItem, size.width * 0.75);

    // Verify the recording is removed
    await browser.waitUntil(
      async () => (await $$(recordingSelector())).length === 0,
      { timeout: 5_000, timeoutMsg: "Recording was not deleted by full swipe" },
    );
  });
});
```

### 7-4. Accessibility labels needed

For the E2E tests to locate the delete button, add `accessibilityLabel` to the delete `Pressable` in `RecordingItem`:

```tsx
<Pressable
  accessibilityLabel="delete-recording"
  onPress={() => {
    swipeableRef.current?.close();
    onDelete();
  }}
  style={styles.deleteButton}
>
```

---

## Step 8: Verification

- [x] `pnpm typecheck` — no type errors
- [x] `pnpm lint` — no lint violations
- [x] `pnpm test:ci` — all unit tests pass
- [ ] E2E tests pass on iOS simulator (requires device build)
- [ ] E2E tests pass on Android emulator (requires device build)
- [ ] Manual test on iOS: partial swipe reveals delete button, tap deletes
- [ ] Manual test on iOS: full swipe deletes immediately
- [ ] Manual test: deleting a currently-playing recording stops playback
- [ ] Manual test: swipe is disabled during recording phase
- [ ] Manual test on Android: same behaviors confirmed

---

## Todo List

### Phase 1 — Dependencies & Root Setup ✅
- [x] Install `react-native-gesture-handler`
- [x] Wrap app root with `<GestureHandlerRootView>` in `App.tsx`

### Phase 2 — Hook Logic (`src/hooks/useRecordings.ts`) ✅
- [x] Add `deleteRecording` to `RecordingsState` type
- [x] Implement `deleteRecording(id)`: stop playback if needed, delete file, update state, persist
- [x] Return `deleteRecording` from the hook

### Phase 3 — Component: `RecordingItem` ✅
- [x] Import `Swipeable` from `react-native-gesture-handler`
- [x] Add `onDelete` to Props
- [x] Wrap row content in `<Swipeable>` with `renderRightActions`
- [x] Implement `renderRightActions` — red background with trash icon
- [x] Wire `onSwipeableWillOpen('right')` for full-swipe delete
- [x] Disable swipeable when `disabled` is true
- [x] Add delete-related styles

### Phase 4 — Component: `RecordingsList` ✅
- [x] Add `onDelete` to Props
- [x] Pass `onDelete` through to `RecordingItem`

### Phase 5 — Screen: `VoiceMirrorScreen` ✅
- [x] Destructure `deleteRecording` from `useRecordings`
- [x] Pass `onDelete={(r) => deleteRecording(r.id)}` to `RecordingsList`

### Phase 6 — Unit Tests ✅
- [x] Add `deleteRecording` unit tests to `useRecordings.test.ts`
- [x] Add render test for `RecordingItem` with `onDelete` prop
- [x] Run `pnpm typecheck && pnpm lint && pnpm test:ci`

### Phase 7 — E2E Tests ✅
- [x] Add `accessibilityLabel="delete-recording"` to delete button in `RecordingItem`
- [x] Extract `createRecording` and `recordingSelector` helpers in E2E spec
- [x] Add "partial swipe reveals delete button, tap deletes" E2E test
- [x] Add "full swipe deletes immediately" E2E test
- [ ] Run E2E tests on iOS simulator and Android emulator (requires device build)

### Phase 8 — Manual Verification
- [ ] Test partial swipe + tap on iOS and Android
- [ ] Test full swipe on iOS and Android
- [ ] Test deleting while playing
- [ ] Test swipe disabled during recording
