import { render, screen, fireEvent } from '@testing-library/react-native';
import { RecordingItem } from '../RecordingItem';
import type { Recording } from '../../lib/recordings';

const makeRecording = (overrides?: Partial<Recording>): Recording => ({
  id: '1',
  filePath: 'file:///tmp/recording_1.m4a',
  recordedAt: '2026-03-22T10:30:00.000Z',
  durationMs: 75000,
  ...overrides,
});

describe('RecordingItem', () => {
  it('shows play icon when not playing', () => {
    render(
      <RecordingItem
        recording={makeRecording()}
        playState={null}
        onTogglePlay={jest.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByText('▶')).toBeTruthy();
  });

  it('shows stop icon when this recording is playing', () => {
    render(
      <RecordingItem
        recording={makeRecording({ id: '1' })}
        playState={{ recordingId: '1', isPlaying: true }}
        onTogglePlay={jest.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByText('■')).toBeTruthy();
  });

  it('shows play icon when a different recording is playing', () => {
    render(
      <RecordingItem
        recording={makeRecording({ id: '1' })}
        playState={{ recordingId: '2', isPlaying: true }}
        onTogglePlay={jest.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByText('▶')).toBeTruthy();
  });

  it('displays a formatted duration', () => {
    render(
      <RecordingItem
        recording={makeRecording({ durationMs: 75000 })}
        playState={null}
        onTogglePlay={jest.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByText('1:15')).toBeTruthy();
  });

  it('calls onTogglePlay when button is pressed', () => {
    const onTogglePlay = jest.fn();
    render(
      <RecordingItem
        recording={makeRecording()}
        playState={null}
        onTogglePlay={onTogglePlay}
        disabled={false}
      />,
    );
    fireEvent.press(screen.getByText('▶'));
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it('does not call onTogglePlay when disabled', () => {
    const onTogglePlay = jest.fn();
    render(
      <RecordingItem
        recording={makeRecording()}
        playState={null}
        onTogglePlay={onTogglePlay}
        disabled={true}
      />,
    );
    fireEvent.press(screen.getByText('▶'));
    expect(onTogglePlay).not.toHaveBeenCalled();
  });
});
