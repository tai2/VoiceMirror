import { render, screen } from '@testing-library/react-native';
import { PhaseDisplay } from '../PhaseDisplay';

describe('PhaseDisplay', () => {
  it('shows "Listening…" in idle phase', () => {
    render(<PhaseDisplay phase="idle" />);
    expect(screen.getByText('Listening…')).toBeTruthy();
  });

  it('shows "Recording" in recording phase', () => {
    render(<PhaseDisplay phase="recording" />);
    expect(screen.getByText('Recording')).toBeTruthy();
  });

  it('shows "Playing back" in playing phase', () => {
    render(<PhaseDisplay phase="playing" />);
    expect(screen.getByText('Playing back')).toBeTruthy();
  });

  it('shows "Paused" in paused phase', () => {
    render(<PhaseDisplay phase="paused" />);
    expect(screen.getByText('Paused')).toBeTruthy();
  });
});
