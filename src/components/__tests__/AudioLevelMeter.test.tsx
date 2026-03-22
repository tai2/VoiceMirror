import { render } from '@testing-library/react-native';
import { View } from 'react-native';
import { AudioLevelMeter } from '../AudioLevelMeter';
import { LEVEL_HISTORY_SIZE } from '../../constants/audio';
import type { Phase } from '../../hooks/types';

const makeHistory = (size = LEVEL_HISTORY_SIZE) => new Array(size).fill(0);

describe('AudioLevelMeter', () => {
  it(`renders ${LEVEL_HISTORY_SIZE} bars`, () => {
    const { UNSAFE_getAllByType } = render(
      <AudioLevelMeter history={makeHistory()} phase="idle" />,
    );
    const bars = UNSAFE_getAllByType(View).filter(
      (el) => el.props.style && JSON.stringify(el.props.style).includes('"width":4'),
    );
    expect(bars).toHaveLength(LEVEL_HISTORY_SIZE);
  });

  const phases: Phase[] = ['idle', 'recording', 'playing', 'paused'];
  it.each(phases)('renders without crashing for phase "%s"', (phase) => {
    expect(() => render(<AudioLevelMeter history={makeHistory()} phase={phase} />)).not.toThrow();
  });
});
