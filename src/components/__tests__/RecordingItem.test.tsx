import { render, screen, fireEvent } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { setupTestI18n } from '../../__tests__/helpers/setupI18n';
import { RecordingItem } from '../RecordingItem';
import type { Recording } from '../../lib/recordings';

jest.mock('react-native-gesture-handler', () => {
  const RN = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Swipeable: RN.View,
    GestureHandlerRootView: RN.View,
  };
});

const i18n = setupTestI18n();

const makeRecording = (overrides?: Partial<Recording>): Recording => ({
  id: '1',
  filePath: 'file:///tmp/recording_1.m4a',
  recordedAt: '2026-03-22T10:30:00.000Z',
  durationMs: 75000,
  ...overrides,
});

function renderItem(props: Partial<React.ComponentProps<typeof RecordingItem>> = {}) {
  const defaultProps: React.ComponentProps<typeof RecordingItem> = {
    recording: makeRecording(),
    playState: null,
    onTogglePlay: jest.fn(),
    onDelete: jest.fn(),
    disabled: false,
    ...props,
  };
  return render(
    <I18nextProvider i18n={i18n}>
      <RecordingItem {...defaultProps} />
    </I18nextProvider>,
  );
}

describe('RecordingItem', () => {
  it('shows play icon when not playing', () => {
    renderItem();
    expect(screen.getByText('▶')).toBeTruthy();
  });

  it('shows stop icon when this recording is playing', () => {
    renderItem({
      recording: makeRecording({ id: '1' }),
      playState: { recordingId: '1', isPlaying: true },
    });
    expect(screen.getByText('■')).toBeTruthy();
  });

  it('shows play icon when a different recording is playing', () => {
    renderItem({
      recording: makeRecording({ id: '1' }),
      playState: { recordingId: '2', isPlaying: true },
    });
    expect(screen.getByText('▶')).toBeTruthy();
  });

  it('displays a formatted duration', () => {
    renderItem({ recording: makeRecording({ durationMs: 75000 }) });
    expect(screen.getByText('1:15')).toBeTruthy();
  });

  it('calls onTogglePlay when button is pressed', () => {
    const onTogglePlay = jest.fn();
    renderItem({ onTogglePlay });
    fireEvent.press(screen.getByText('▶'));
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it('does not call onTogglePlay when disabled', () => {
    const onTogglePlay = jest.fn();
    renderItem({ onTogglePlay, disabled: true });
    fireEvent.press(screen.getByText('▶'));
    expect(onTogglePlay).not.toHaveBeenCalled();
  });

  it('renders without crashing with onDelete prop', () => {
    renderItem();
  });
});
