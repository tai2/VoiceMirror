# Plan: Pause / Resume Toggle

## Todo List

### Phase 1 — Types ✅
- [x] Add `'paused'` to the `Phase` union in `src/hooks/types.ts`
- [x] Add `togglePause: () => void` field to `VoiceMirrorState` in `src/hooks/types.ts`

### Phase 2 — Hook logic (`src/hooks/useVoiceMirror.ts`) ✅
- [x] Add `playerNodeRef` (`useRef<... | null>(null)`) alongside the other refs
- [x] In `stopAndPlay`: assign `playerNodeRef.current = playerNode` before calling `playerNode.start`
- [x] In `stopAndPlay`: clear `playerNodeRef.current = null` inside the `onEnded` callback
- [x] Implement `pauseMonitoring`:
  - [x] If `playerNodeRef.current` is set: null out `onEnded`, call `.stop()`, clear the ref
  - [x] Call `recorder.clearOnAudioReady()`
  - [x] Call `await recorder.stop()`
  - [x] Call `await AudioManager.setAudioSessionActivity(false)`
  - [x] Set `phaseRef.current = 'paused'`
  - [x] Call `setPhase('paused')`
  - [x] Call `setLevelHistory(new Array(LEVEL_HISTORY_SIZE).fill(0))` to blank the meter
- [x] Implement `resumeMonitoring`: delegate to `startMonitoring()`
- [x] Implement `togglePause`: call `resumeMonitoring` if paused, else `pauseMonitoring`
- [x] Add `togglePause` to the hook's return value

### Phase 3 — Components ✅
- [x] `src/components/PhaseDisplay.tsx`: add `paused: 'Paused'` entry to `PHASE_LABEL`
- [x] `src/components/PhaseDisplay.tsx`: add `paused: '#AAAAAA'` entry to `PHASE_COLOR`
- [x] `src/components/AudioLevelMeter.tsx`: add `paused: '#AAAAAA'` entry to `PHASE_COLOR`

### Phase 4 — Screen (`src/screens/VoiceMirrorScreen.tsx`) ✅
- [x] Import `Pressable` from `react-native`
- [x] Destructure `togglePause` from `useVoiceMirror()`
- [x] Derive `isPaused = phase === 'paused'` local variable
- [x] Replace the static hint `<Text>` with one that switches message when paused
- [x] Add a `<Pressable>` button below the meter that calls `togglePause` on press
- [x] Label the button `"Pause"` when active, `"Resume"` when paused
- [x] Add `pauseButton`, `pauseButtonPressed`, and `pauseButtonLabel` entries to `StyleSheet.create`

### Phase 5 — Verification ✅
- [x] Run `pnpm run typecheck` — confirm zero type errors (especially exhaustive `Record<Phase, ...>` checks)
- [ ] Manual test: tap Pause while **idle** — meter goes blank, dot turns grey, label shows "Paused"
- [ ] Manual test: tap Pause while **recording** — take is discarded, transitions to "Paused"
- [ ] Manual test: tap Pause while **playing** — playback stops immediately, transitions to "Paused"
- [ ] Manual test: tap Resume from any paused state — returns to "Listening…" and detects voice normally
- [ ] Manual test: pause → background app → foreground → resume — audio session restores correctly

---

## Goal

Add a button that lets the user suspend monitoring at any time and resume it later. While paused, the microphone is released, audio processing stops, and the UI reflects the dormant state.

---

## Design Decisions

### What "paused" means

- The recorder is stopped and its callback is cleared.
- If paused mid-recording, the in-progress take is **discarded** (not played back). This keeps the interaction model simple: pause interrupts the current cycle cleanly.
- If paused mid-playback, playback is stopped immediately.
- The `AudioContext` is **kept alive** (not closed) so resume is instant — no teardown/recreate overhead.
- `AudioManager.setAudioSessionActivity(false)` is called on pause so iOS releases the audio session and other apps can use the mic.

### New phase value

Add `'paused'` to the `Phase` union. This flows naturally through all existing phase-keyed display maps with a single new entry each.

```
idle | recording | playing | paused
```

Alternatively, pause could be tracked as a separate boolean outside the phase. However, using a phase value is cleaner because:
- `PhaseDisplay` and `AudioLevelMeter` already key off `Phase` for colors/labels.
- `tickStateMachine` guards on `phaseRef.current` — it naturally ignores audio callbacks if they somehow fire while paused.

### Button placement

A single `TouchableOpacity` (or `Pressable`) below the level meter in `VoiceMirrorScreen`. It shows **"Pause"** when active and **"Resume"** when paused.

### Hook API change

`useVoiceMirror` adds one new field to `VoiceMirrorState`:

```ts
togglePause: () => void;
```

The screen calls this on button press.

---

## Files to Change

| File | Change |
|------|--------|
| `src/hooks/types.ts` | Add `'paused'` to `Phase`; add `togglePause` to `VoiceMirrorState` |
| `src/hooks/useVoiceMirror.ts` | Implement `pauseMonitoring`, `resumeMonitoring`, `togglePause`; wire into `stopAndPlay` restart |
| `src/components/PhaseDisplay.tsx` | Add label and color entry for `'paused'` |
| `src/components/AudioLevelMeter.tsx` | Add color entry for `'paused'` |
| `src/screens/VoiceMirrorScreen.tsx` | Render pause/resume button; destructure `togglePause` |

---

## Step-by-Step Implementation

---

### Step 1 — `src/hooks/types.ts`

Add `'paused'` to the union and `togglePause` to the state type.

```ts
// before
export type Phase = 'idle' | 'recording' | 'playing';

export type VoiceMirrorState = {
  phase: Phase;
  levelHistory: number[];
  hasPermission: boolean;
  permissionDenied: boolean;
};

// after
export type Phase = 'idle' | 'recording' | 'playing' | 'paused';

export type VoiceMirrorState = {
  phase: Phase;
  levelHistory: number[];
  hasPermission: boolean;
  permissionDenied: boolean;
  togglePause: () => void;
};
```

---

### Step 2 — `src/hooks/useVoiceMirror.ts`

#### 2a. Add `pauseMonitoring`

Stops the recorder, clears its callback, deactivates the audio session, and sets `phase` to `'paused'`. Handles all three active phases: idle (just listening), recording (discard take), playing (stop playback).

```ts
async function pauseMonitoring() {
  const recorder = audioRecorderRef.current!;

  // If a playerNode is running we need to stop it.
  // Track the active node so we can call stop() on it.
  if (playerNodeRef.current) {
    playerNodeRef.current.onEnded = null; // prevent auto-restart
    playerNodeRef.current.stop();
    playerNodeRef.current = null;
  }

  recorder.clearOnAudioReady();
  await recorder.stop();
  await AudioManager.setAudioSessionActivity(false);

  phaseRef.current = 'paused';
  setPhase('paused');
  setLevelHistory(new Array(LEVEL_HISTORY_SIZE).fill(0)); // blank the meter
}
```

> **Note:** this requires tracking the active `BufferSourceNode` in a new ref `playerNodeRef`.

#### 2b. Add `playerNodeRef`

```ts
const playerNodeRef = useRef<ReturnType<AudioContext['createBufferSource']> | null>(null);
```

Update `stopAndPlay` to assign and clear this ref:

```ts
async function stopAndPlay() {
  // ... existing buffer assembly code ...

  const playerNode = ctx.createBufferSource();
  playerNodeRef.current = playerNode;          // ← store reference
  playerNode.buffer = audioBuffer;
  playerNode.connect(ctx.destination);
  playerNode.onEnded = () => {
    playerNodeRef.current = null;              // ← clear on natural end
    void startMonitoring();
  };
  playerNode.start(0, voiceStartSecs);
}
```

#### 2c. Add `resumeMonitoring`

Simply calls `startMonitoring()`, which already resets all state and restarts the recorder. No other logic needed.

```ts
async function resumeMonitoring() {
  await startMonitoring();
}
```

#### 2d. Add `togglePause`

```ts
function togglePause() {
  if (phaseRef.current === 'paused') {
    void resumeMonitoring();
  } else {
    void pauseMonitoring();
  }
}
```

#### 2e. Return `togglePause` from the hook

```ts
return { phase, levelHistory, hasPermission, permissionDenied, togglePause };
```

#### 2f. Full diff sketch for `useVoiceMirror.ts`

```ts
// New ref, placed alongside the other refs:
const playerNodeRef = useRef<ReturnType<AudioContext['createBufferSource']> | null>(null);

// ── pauseMonitoring ──────────────────────────────────────────────
async function pauseMonitoring() {
  if (playerNodeRef.current) {
    playerNodeRef.current.onEnded = null;
    playerNodeRef.current.stop();
    playerNodeRef.current = null;
  }
  const recorder = audioRecorderRef.current!;
  recorder.clearOnAudioReady();
  await recorder.stop();
  await AudioManager.setAudioSessionActivity(false);
  phaseRef.current = 'paused';
  setPhase('paused');
  setLevelHistory(new Array(LEVEL_HISTORY_SIZE).fill(0));
}

// ── resumeMonitoring ─────────────────────────────────────────────
async function resumeMonitoring() {
  await startMonitoring();
}

// ── togglePause ──────────────────────────────────────────────────
function togglePause() {
  if (phaseRef.current === 'paused') {
    void resumeMonitoring();
  } else {
    void pauseMonitoring();
  }
}

// ── updated stopAndPlay (relevant lines only) ────────────────────
const playerNode = ctx.createBufferSource();
playerNodeRef.current = playerNode;
playerNode.buffer = audioBuffer;
playerNode.connect(ctx.destination);
playerNode.onEnded = () => {
  playerNodeRef.current = null;
  void startMonitoring();
};
playerNode.start(0, voiceStartSecs);

// ── updated return ───────────────────────────────────────────────
return { phase, levelHistory, hasPermission, permissionDenied, togglePause };
```

---

### Step 3 — `src/components/PhaseDisplay.tsx`

Add entries for `'paused'` in the two record literals.

```ts
const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Listening…',
  recording: 'Recording',
  playing: 'Playing back',
  paused: 'Paused',           // ← new
};

const PHASE_COLOR: Record<Phase, string> = {
  idle: '#4A9EFF',
  recording: '#FF4444',
  playing: '#44BB44',
  paused: '#AAAAAA',          // ← new (grey, visually inactive)
};
```

The pulse animation already stops for any non-idle phase, so no animation changes are needed — the grey dot will sit still.

---

### Step 4 — `src/components/AudioLevelMeter.tsx`

Add the same color entry:

```ts
const PHASE_COLOR: Record<Phase, string> = {
  idle: '#4A9EFF',
  recording: '#FF4444',
  playing: '#44BB44',
  paused: '#AAAAAA',          // ← new
};
```

When paused the hook zeros out `levelHistory`, so all bars will be at minimum height (2 px) in grey.

---

### Step 5 — `src/screens/VoiceMirrorScreen.tsx`

Destructure `togglePause` and render the button.

```tsx
import { View, Text, StyleSheet, SafeAreaView, Pressable } from 'react-native';
import { useVoiceMirror } from '../hooks/useVoiceMirror';
import { AudioLevelMeter } from '../components/AudioLevelMeter';
import { PhaseDisplay } from '../components/PhaseDisplay';

export function VoiceMirrorScreen() {
  const { phase, levelHistory, hasPermission, permissionDenied, togglePause } = useVoiceMirror();

  // ... permission guards unchanged ...

  const isPaused = phase === 'paused';

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}>
        <PhaseDisplay phase={phase} />
        <View style={styles.meterContainer}>
          <AudioLevelMeter history={levelHistory} phase={phase} />
        </View>
        <Text style={styles.hint}>
          {isPaused ? 'Monitoring paused.' : 'Speak to begin. Silence ends the take.'}
        </Text>
        <Pressable
          onPress={togglePause}
          style={({ pressed }) => [styles.pauseButton, pressed && styles.pauseButtonPressed]}
        >
          <Text style={styles.pauseButtonLabel}>{isPaused ? 'Resume' : 'Pause'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// Additional styles to add to StyleSheet.create({...}):
const additionalStyles = {
  pauseButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 30,
    backgroundColor: '#EEEEEE',
  },
  pauseButtonPressed: {
    backgroundColor: '#DDDDDD',
  },
  pauseButtonLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#555555',
  },
};
```

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Pause pressed while **recording** | Take is discarded, recorder stops, phase → `'paused'` |
| Pause pressed while **playing** | `playerNode.stop()` called, `onEnded` is nulled out (no auto-restart), phase → `'paused'` |
| Pause pressed during **permission request** | `hasPermission` is false, button is not rendered — not reachable |
| Resume pressed | `startMonitoring()` resets all state and restarts recorder as if freshly opened |
| App unmounted while paused | `useEffect` cleanup calls `recorder.stop()` (safe to call on already-stopped recorder) and `ctx.close()` — no change needed |

---

## State Transition Diagram (updated)

```
                  ┌───────────────────────────────────┐
                  │           [togglePause]            │
                  ▼                                    │
┌──────────┐  voice onset  ┌───────────┐  silence   ┌─────────┐
│   idle   │ ────────────► │ recording │ ──────────► │ playing │
└──────────┘  (250 ms)     └───────────┘ (1500 ms)   └─────────┘
     ▲                           │                        │
     │                           │ [togglePause]          │ [togglePause]
     │                           ▼                        ▼
     │                      ┌──────────────────────────────┐
     │    [togglePause]      │            paused            │
     └───────────────────────┴──────────────────────────────┘
                                          │
                               [togglePause / resume]
                                          │
                                          ▼
                                        idle
```

---

## Summary of New Code

- **~10 lines** in `types.ts` (type changes)
- **~25 lines** in `useVoiceMirror.ts` (three new functions + `playerNodeRef`)
- **2 lines** in `PhaseDisplay.tsx` (new map entries)
- **2 lines** in `AudioLevelMeter.tsx` (new map entry)
- **~15 lines** in `VoiceMirrorScreen.tsx` (button + styles)

No new files, no new dependencies.
