import { render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { setupTestI18n } from '../../__tests__/helpers/setupI18n';
import { PhaseDisplay } from '../PhaseDisplay';

const i18n = setupTestI18n();

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe('PhaseDisplay', () => {
  it('shows "Listening…" in idle phase', () => {
    renderWithI18n(<PhaseDisplay phase="idle" />);
    expect(screen.getByText('Listening…')).toBeTruthy();
  });

  it('shows "Recording" in recording phase', () => {
    renderWithI18n(<PhaseDisplay phase="recording" />);
    expect(screen.getByText('Recording')).toBeTruthy();
  });

  it('shows "Playing back" in playing phase', () => {
    renderWithI18n(<PhaseDisplay phase="playing" />);
    expect(screen.getByText('Playing back')).toBeTruthy();
  });

  it('shows "Paused" in paused phase', () => {
    renderWithI18n(<PhaseDisplay phase="paused" />);
    expect(screen.getByText('Paused')).toBeTruthy();
  });
});
