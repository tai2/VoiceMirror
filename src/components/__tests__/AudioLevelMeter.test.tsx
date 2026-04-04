import { render } from '@testing-library/react-native';
import { Rect, Line } from 'react-native-svg';
import { AudioLevelMeter, BAR_WIDTH } from '../AudioLevelMeter';
import { LEVEL_HISTORY_SIZE } from '../../constants/audio';
import type { Phase } from '../../hooks/types';

const makeHistory = (size = LEVEL_HISTORY_SIZE) => new Array(size).fill(0);

const defaultProps = {
  history: makeHistory(),
  phase: 'idle' as Phase,
  currentDb: -40,
  voiceThresholdDb: -35,
  silenceThresholdDb: -45,
};

describe('AudioLevelMeter', () => {
  it(`renders ${LEVEL_HISTORY_SIZE} bars`, () => {
    const { UNSAFE_getAllByType } = render(
      <AudioLevelMeter {...defaultProps} />,
    );
    const bars = UNSAFE_getAllByType(Rect).filter(
      (el) => el.props.width === BAR_WIDTH,
    );
    expect(bars).toHaveLength(LEVEL_HISTORY_SIZE);
  });

  const phases: Phase[] = ['idle', 'recording', 'playing', 'paused'];
  it.each(phases)('renders without crashing for phase "%s"', (phase) => {
    expect(() => render(<AudioLevelMeter {...defaultProps} phase={phase} />)).not.toThrow();
  });

  it('renders guide lines during idle phase', () => {
    const { UNSAFE_getAllByType } = render(
      <AudioLevelMeter {...defaultProps} phase="idle" />,
    );
    const lines = UNSAFE_getAllByType(Line);
    expect(lines).toHaveLength(2);
  });

  it('renders guide lines during recording phase', () => {
    const { UNSAFE_getAllByType } = render(
      <AudioLevelMeter {...defaultProps} phase="recording" />,
    );
    const lines = UNSAFE_getAllByType(Line);
    expect(lines).toHaveLength(2);
  });

  it('hides guide lines during playing phase', () => {
    const { UNSAFE_getAllByType } = render(
      <AudioLevelMeter {...defaultProps} phase="playing" />,
    );
    expect(() => UNSAFE_getAllByType(Line)).toThrow();
  });

  it('hides guide lines during paused phase', () => {
    const { UNSAFE_getAllByType } = render(
      <AudioLevelMeter {...defaultProps} phase="paused" />,
    );
    expect(() => UNSAFE_getAllByType(Line)).toThrow();
  });

  it('shows dB label when currentDb is provided and phase is idle', () => {
    const { getByText } = render(
      <AudioLevelMeter {...defaultProps} phase="idle" currentDb={-42} />,
    );
    expect(getByText('-42 dB')).toBeTruthy();
  });

  it('hides dB label when currentDb is null', () => {
    const { queryByText } = render(
      <AudioLevelMeter {...defaultProps} phase="idle" currentDb={null} />,
    );
    expect(queryByText(/dB/)).toBeNull();
  });
});
