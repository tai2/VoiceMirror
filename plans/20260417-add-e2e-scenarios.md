# Plan: Add E2E Test Scenarios for Uncovered Features

> Date: 2026-04-17

## Goal

Expand the E2E test suite in `e2e/specs/voiceMirror.spec.ts` to cover the most impactful user-facing features that currently have no automated E2E validation. The research report (`research.md`, section 7.3) identifies 13 uncovered scenarios. This plan targets the high-impact subset that exercises real user workflows and avoids low-impact edge cases or scenarios that are impractical to test in E2E (e.g., internationalization requires device locale changes, permission denial requires native dialog interaction).

### Scenarios to add (8 new tests across 3 suites)

| #   | Suite                  | Test                                                                     | Impact                                                                        |
| --- | ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1   | Settings navigation    | Navigate to settings and back                                            | Verifies the only navigation flow in the app                                  |
| 2   | List playback          | Tap play on a recording, verify playing state, tap stop                  | Core user feature with no coverage                                            |
| 3   | List playback          | Tapping play on one recording while another is playing switches playback | Common interaction pattern                                                    |
| 4   | List playback          | Monitoring resumes after list playback ends                              | Verifies suspend/resume coordination between useVoiceMirror and useRecordings |
| 5   | Multiple recordings    | Two full loops produce two recordings in the list                        | Verifies recording accumulation and list rendering                            |
| 6   | Multiple recordings    | Recordings appear in reverse chronological order (newest first)          | Verifies the prepend behavior in addRecording                                 |
| 7   | Pause during recording | Pausing mid-recording discards the recording and transitions to paused   | Verifies the cleanup path in pauseMonitoring                                  |
| 8   | Empty state            | Empty state is shown when no recordings exist                            | Verifies the empty-state placeholder in RecordingsList                        |

### Scenarios deliberately excluded

- **Settings slider interaction**: Appium's slider manipulation is unreliable across platforms and slider position depends on screen DPI. The settings logic is already well covered by the unit-testable `SettingsProvider`.
- **Max recording duration**: Requires waiting the full `maxRecordingMs` (60s default) which would add unacceptable test runtime. Better tested in unit tests.
- **Max recordings cap**: Would require creating 20+ recordings sequentially. Test runtime would be extreme.
- **Permission denied state**: Requires manipulating native OS permission dialogs, which is fragile and platform-specific. The E2E build auto-grants permissions.
- **Recording error display**: Would require injecting encoder failures into the E2E service layer -- not currently supported by the E2E architecture.
- **Internationalization**: Requires changing device locale between tests, which needs session reconfiguration.
- **Recordings persistence across sessions**: Session reload already clears state (by design in `afterEach`), and persistence is tested by the repository unit tests.
- **Swipe disabled during recording**: Very narrow edge case; the `disabled` prop is straightforward React Native behavior.

---

## Architecture / Approach

### Test infrastructure changes

The existing test infrastructure is sufficient. No new helpers, bridges, or services are needed. All new tests use the same `E2EAudioBridge` and `createRecording()` helper already in the spec file.

### New accessibility labels required

Several UI elements need `testID`/`accessibilityLabel` props added so that E2E tests can find them:

1. **Settings gear button** in `app/_layout.tsx` -- needs `accessibilityLabel="settings-button"` so tests can navigate to settings.
2. **Reset button** in `app/settings.tsx` -- needs `accessibilityLabel="reset-settings-button"` for the settings navigation test.
3. **Empty state container** in `src/components/RecordingsList.tsx` -- needs `accessibilityLabel="recordings-empty"` to verify the empty state.
4. **Recordings count badge** in `src/screens/VoiceMirrorScreen.tsx` -- needs `accessibilityLabel="recordings-count"` to verify recording count without querying individual rows.

### Test organization

New tests are organized into new `describe` blocks within the existing `e2e/specs/voiceMirror.spec.ts` file, following the same patterns:

- Each test in a `describe` block shares a `beforeEach` that sends initial silence and waits for idle.
- The existing `createRecording()` helper is reused for creating recordings.
- The existing `recordingSelector()` helper is reused for finding recording rows.

### Platform-specific selectors

The existing `recordingSelector()` helper handles the iOS/Android selector divergence. For new selectors targeting `accessibilityLabel` values (like `~recordings-empty`), the standard WDIO `$("~label")` syntax works on both platforms since the codebase already sets both `testID` and `accessibilityLabel` to the same value.

---

## Code Changes

### 1. Add accessibility labels to UI elements

#### `app/_layout.tsx` -- settings gear button

```typescript
// Before:
            <Pressable
              onPress={() => router.push("/settings")}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <AntDesign
                name="setting"
                size={22}
                color={colors.textSecondary}
              />
            </Pressable>

// After:
            <Pressable
              onPress={() => router.push("/settings")}
              accessibilityLabel="settings-button"
              testID="settings-button"
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <AntDesign
                name="setting"
                size={22}
                color={colors.textSecondary}
              />
            </Pressable>
```

#### `app/settings.tsx` -- reset button

```typescript
// Before:
        <Pressable
          style={({ pressed }) => [
            styles.resetButton,
            pressed && styles.resetButtonPressed,
          ]}
          onPress={handleReset}
        >

// After:
        <Pressable
          accessibilityLabel="reset-settings-button"
          testID="reset-settings-button"
          style={({ pressed }) => [
            styles.resetButton,
            pressed && styles.resetButtonPressed,
          ]}
          onPress={handleReset}
        >
```

#### `src/components/RecordingsList.tsx` -- empty state

```typescript
// Before:
    return (
      <View style={styles.empty}>

// After:
    return (
      <View style={styles.empty} accessibilityLabel="recordings-empty" testID="recordings-empty">
```

#### `src/screens/VoiceMirrorScreen.tsx` -- recordings count badge

```typescript
// Before:
          <View style={styles.recordingsCountBadge}>
            <Text style={styles.recordingsCount}>{recordings.length}</Text>
          </View>

// After:
          <View style={styles.recordingsCountBadge}>
            <Text
              style={styles.recordingsCount}
              accessibilityLabel="recordings-count"
              testID="recordings-count"
            >
              {recordings.length}
            </Text>
          </View>
```

### 2. New E2E test scenarios

All additions go into `e2e/specs/voiceMirror.spec.ts`.

#### Suite: Settings navigation

```typescript
describe("VoiceMirror -- settings navigation", () => {
  it("navigates to settings screen and back", async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });

    // Tap the gear icon to navigate to settings
    await $("~settings-button").click();

    // Verify the reset button is visible (confirms we're on the settings screen)
    await $("~reset-settings-button").waitForDisplayed({ timeout: WAIT_SHORT });

    // Navigate back using the native back button
    if (browser.isAndroid) {
      await driver.back();
    } else {
      // On iOS, the back button is the first navigation bar button
      await $("~VoiceMirror").click();
    }

    // Verify we're back on the main screen
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });
  });
});
```

**Note on iOS back navigation**: Expo Router with `Stack` renders a standard iOS navigation bar. The back button's accessibility label is the title of the previous screen -- `"VoiceMirror"`. This is standard UIKit behavior. If this proves unreliable, an alternative is to use `driver.back()` on iOS as well (XCUITest supports it), or to locate the button by class chain query.

#### Suite: Empty state

```typescript
describe("VoiceMirror -- empty state", () => {
  it("shows empty state when no recordings exist", async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });

    // On fresh session, recordings list should show empty state
    await expect($("~recordings-empty")).toBeDisplayed();
  });
});
```

#### Suite: List playback

```typescript
describe("VoiceMirror -- list playback", () => {
  beforeEach(async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });
  });

  it("plays a recording from the list and shows playing phase", async () => {
    await createRecording();

    const sel = recordingSelector();
    const playButton = $(sel);
    await playButton.waitForExist({ timeout: WAIT_SHORT });

    // Tap the play button on the recording
    await playButton.click();

    // The main monitor should show "playing" phase during list playback
    await $("~phase-playing").waitForDisplayed({ timeout: WAIT_SHORT });

    // Wait for playback to finish and return to idle
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_LONG });
  });

  it("stops playback when tapping the same recording again", async () => {
    await createRecording();

    const sel = recordingSelector();
    const playButton = $(sel);
    await playButton.waitForExist({ timeout: WAIT_SHORT });

    // Start playback
    await playButton.click();
    await $("~phase-playing").waitForDisplayed({ timeout: WAIT_SHORT });

    // Tap again to stop
    await playButton.click();

    // Should return to idle (monitoring resumes)
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_MEDIUM });
  });

  it("resumes monitoring after list playback ends naturally", async () => {
    await createRecording();

    const sel = recordingSelector();
    await $(sel).waitForExist({ timeout: WAIT_SHORT });

    // Play the recording
    await $(sel).click();
    await $("~phase-playing").waitForDisplayed({ timeout: WAIT_SHORT });

    // Wait for playback to end naturally
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_LONG });

    // Verify that monitoring has actually resumed by sending voice and
    // confirming the app transitions to recording
    await bridge.sendVoice(VOICE_ONSET_MS + 200);
    await $("~phase-recording").waitForDisplayed({ timeout: WAIT_SHORT });
  });
});
```

#### Suite: Multiple recordings

```typescript
describe("VoiceMirror -- multiple recordings", () => {
  beforeEach(async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });
  });

  it("accumulates multiple recordings in the list", async () => {
    // Create first recording
    await createRecording();

    const sel = recordingSelector();
    await $(sel).waitForExist({ timeout: WAIT_SHORT });
    const countAfterFirst = await $$(sel).length;
    expect(countAfterFirst).toBe(1);

    // Create second recording
    await createRecording();

    await browser.waitUntil(
      async () => {
        const count = await $$(sel).length;
        return count === 2;
      },
      { timeout: WAIT_SHORT, timeoutMsg: "Expected 2 recordings in the list" },
    );
  });
});
```

#### Suite: Pause during recording

```typescript
describe("VoiceMirror -- pause during recording", () => {
  beforeEach(async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });
  });

  it("discards recording when paused mid-recording", async () => {
    // Confirm empty state initially
    await expect($("~recordings-empty")).toBeDisplayed();

    // Start recording
    await bridge.sendVoice(VOICE_ONSET_MS + 200);
    await $("~phase-recording").waitForDisplayed({ timeout: WAIT_SHORT });

    // Pause while recording is in progress
    await $("~toggle-pause-button").click();
    await $("~phase-paused").waitForDisplayed({ timeout: WAIT_SHORT });

    // The in-progress recording should have been discarded --
    // no recording should appear in the list
    const sel = recordingSelector();
    const count = await $$(sel).length;
    expect(count).toBe(0);

    // Resume and confirm idle
    await $("~toggle-pause-button").click();
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });
  });
});
```

---

## Files That Need Modification

| File                                | Change                                                               |
| ----------------------------------- | -------------------------------------------------------------------- |
| `app/_layout.tsx`                   | Add `accessibilityLabel` and `testID` to settings gear `<Pressable>` |
| `app/settings.tsx`                  | Add `accessibilityLabel` and `testID` to reset button `<Pressable>`  |
| `src/components/RecordingsList.tsx` | Add `accessibilityLabel` and `testID` to empty state `<View>`        |
| `src/screens/VoiceMirrorScreen.tsx` | Add `accessibilityLabel` and `testID` to recordings count `<Text>`   |
| `e2e/specs/voiceMirror.spec.ts`     | Add 8 new test cases across 5 new `describe` blocks                  |

---

## Considerations and Trade-offs

### iOS back navigation approach

The plan uses `$("~VoiceMirror").click()` to navigate back on iOS, relying on UIKit's default behavior of setting the back button's accessibility label to the previous screen's title. If this is unreliable across iOS versions, alternatives include:

- Using `driver.back()` on both platforms (XCUITest supports this via a swipe-from-edge gesture simulation).
- Using an `-ios class chain` query to find the back button element by class hierarchy.

The first approach is simplest and works for the majority case. We should test it during implementation and fall back to `driver.back()` if needed.

### Test execution time

Each `createRecording()` call takes approximately 3--5 seconds of real time (voice onset + recording + silence + playback + return to idle). Tests with two recordings will take 6--10 seconds each. The new suite adds roughly 40--60 seconds to the total E2E run, which is acceptable given the `120_000ms` mocha timeout per test.

### Session reload in afterEach

The existing `afterEach` hook calls `driver.reloadSession()` after every test. This ensures each test starts with a clean state (no persisted recordings, fresh settings). The new tests depend on this behavior -- e.g., the empty state test assumes no recordings exist. This is the correct approach but makes the suite slower; each session reload takes 5--10 seconds on iOS and 10--15 seconds on Android.

### List playback phase display

When a recording is played from the list, the code in `VoiceMirrorScreen.tsx` sets `meterPhase` to `"playing"` (via `isListPlaying`), which causes `PhaseDisplay` to render with `testID="phase-playing"`. This means `$("~phase-playing")` works for both voice mirror playback and list playback, which is desirable for the new list playback tests.

### No WebSocket interaction during list playback

After `suspendForListPlayback()` is called, the audio recorder is stopped, which closes the WebSocket connection. The `E2EAudioBridge.sendChunks()` method silently drops chunks when no client is connected (it returns early from `sendChunk` when `this.client` is null or not in OPEN state). Tests must not call `bridge.sendVoice()` or `bridge.sendSilence()` while list playback is active. The "resumes monitoring after list playback" test only sends voice _after_ confirming the app has returned to idle, at which point the recorder restarts and reconnects.

### Recordings count badge vs. counting rows

The plan adds an `accessibilityLabel="recordings-count"` to the count badge text element. However, the new tests primarily use `$$(recordingSelector()).length` to count recordings (matching the existing test patterns). The count badge label is added as a secondary verification mechanism that could be useful for future tests, but the primary assertions use row counting for consistency with the existing swipe-to-delete tests.

### Pause during recording -- timing sensitivity

The "discards recording when paused mid-recording" test sends voice to trigger recording, then immediately taps the pause button. There is a timing window: the app must be in the "recording" phase when pause is tapped. The test mitigates this by waiting for `$("~phase-recording").waitForDisplayed()` before tapping pause, ensuring the phase transition has occurred.

---

## Todo

### Phase 1: Add accessibility labels to UI elements

- [x] In `app/_layout.tsx`, add `accessibilityLabel="settings-button"` and `testID="settings-button"` to the settings gear `<Pressable>`
- [x] In `app/settings.tsx`, add `accessibilityLabel="reset-settings-button"` and `testID="reset-settings-button"` to the reset button `<Pressable>`
- [x] In `src/components/RecordingsList.tsx`, add `accessibilityLabel="recordings-empty"` and `testID="recordings-empty"` to the empty state `<View>`
- [x] In `src/screens/VoiceMirrorScreen.tsx`, add `accessibilityLabel="recordings-count"` and `testID="recordings-count"` to the recordings count `<Text>`

### Phase 2: Add E2E test suites to `e2e/specs/voiceMirror.spec.ts`

#### Suite: Settings navigation

- [x] Add `describe("VoiceMirror -- settings navigation")` block
- [x] Add test: "navigates to settings screen and back" -- tap gear icon, verify reset button visible, navigate back, verify idle phase
- [x] Handle platform-specific back navigation (Android `driver.back()` vs iOS `$("~VoiceMirror").click()`)

#### Suite: Empty state

- [x] Add `describe("VoiceMirror -- empty state")` block
- [x] Add test: "shows empty state when no recordings exist" -- wait for idle, assert `~recordings-empty` is displayed

#### Suite: List playback

- [x] Add `describe("VoiceMirror -- list playback")` block with `beforeEach` that sends silence and waits for idle
- [x] Add test: "plays a recording from the list and shows playing phase" -- create recording, tap play, verify `~phase-playing`, wait for return to idle
- [x] Add test: "stops playback when tapping the same recording again" -- create recording, tap play, verify playing, tap again, verify idle
- [x] Add test: "resumes monitoring after list playback ends naturally" -- create recording, play it, wait for idle, send voice, verify `~phase-recording`

#### Suite: Multiple recordings

- [x] Add `describe("VoiceMirror -- multiple recordings")` block with `beforeEach` that sends silence and waits for idle
- [x] Add test: "accumulates multiple recordings in the list" -- create two recordings, verify count is 2 using `$$(recordingSelector()).length`

#### Suite: Pause during recording

- [x] Add `describe("VoiceMirror -- pause during recording")` block with `beforeEach` that sends silence and waits for idle
- [x] Add test: "discards recording when paused mid-recording" -- verify empty state, send voice, wait for recording phase, tap pause, verify no recordings appear, resume and confirm idle

### Phase 3: Verification

- [x] Run `pnpm typecheck` to verify no type errors from accessibility label additions
- [x] Run `pnpm lint` to verify no linting issues
- [x] Run `pnpm test:ci` to verify existing unit tests still pass
- [ ] Run `pnpm e2e:ios` to verify all E2E tests pass on iOS (including new scenarios)
- [ ] Run `pnpm e2e:android` to verify all E2E tests pass on Android (including new scenarios)
- [ ] If iOS back navigation via `$("~VoiceMirror").click()` is unreliable, fall back to `driver.back()` on both platforms
