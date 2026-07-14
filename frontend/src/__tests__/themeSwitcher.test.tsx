import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { DEFAULT_THEME, THEMES, THEME_STORAGE_KEY } from '@/lib/theme';

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('renders every Omarchy theme', () => {
    render(<ThemeSwitcher />);
    for (const theme of THEMES) {
      // Query by swatch rather than by accessible name: "Catppuccin" is a
      // prefix of "Catppuccin Latte", so a name regex would match two buttons.
      expect(screen.getByTestId(`swatch-${theme.id}`)).toBeInTheDocument();
      expect(screen.getByText(theme.name)).toBeInTheDocument();
    }
  });

  it('marks the stored theme as active on mount', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'nord');
    render(<ThemeSwitcher />);
    expect(await screen.findByRole('button', { name: /Nord/, pressed: true })).toBeInTheDocument();
  });

  it('defaults to Tokyo Night when nothing is stored', async () => {
    render(<ThemeSwitcher />);
    expect(
      await screen.findByRole('button', { name: /Tokyo Night/, pressed: true }),
    ).toBeInTheDocument();
    expect(DEFAULT_THEME).toBe('tokyo-night');
  });

  it('selecting a theme sets data-theme on the document and persists it', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    await user.click(screen.getByRole('button', { name: /Catppuccin Latte/ }));

    expect(document.documentElement.dataset.theme).toBe('catppuccin-latte');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('catppuccin-latte');
    expect(
      await screen.findByRole('button', { name: /Catppuccin Latte/, pressed: true }),
    ).toBeInTheDocument();
  });

  it('each swatch carries its own theme so it previews that palette', () => {
    render(<ThemeSwitcher />);
    expect(screen.getByTestId('swatch-gruvbox')).toHaveAttribute('data-theme', 'gruvbox');
    expect(screen.getByTestId('swatch-tokyo-night')).toHaveAttribute('data-theme', 'tokyo-night');
  });
});
