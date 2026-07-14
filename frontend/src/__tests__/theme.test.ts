import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_THEME,
  THEMES,
  THEME_STORAGE_KEY,
  getTheme,
  isThemeId,
  setTheme,
  themeBootstrapScript,
} from '@/lib/theme';

describe('lib/theme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('defaults to Tokyo Night when nothing is stored', () => {
    expect(getTheme()).toBe('tokyo-night');
    expect(DEFAULT_THEME).toBe('tokyo-night');
  });

  it('round-trips a valid theme through localStorage and the document element', () => {
    setTheme('gruvbox');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('gruvbox');
    expect(document.documentElement.dataset.theme).toBe('gruvbox');
    expect(getTheme()).toBe('gruvbox');
  });

  it('falls back to the default when the stored value is not a known theme', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'solarized-hotdog');
    expect(getTheme()).toBe(DEFAULT_THEME);
  });

  it('validates theme ids', () => {
    expect(isThemeId('nord')).toBe(true);
    expect(isThemeId('nope')).toBe(false);
    expect(isThemeId(null)).toBe(false);
  });

  it('ships the seven Omarchy themes, five dark and two light', () => {
    expect(THEMES).toHaveLength(7);
    expect(THEMES.filter((t) => t.dark)).toHaveLength(5);
    expect(THEMES.filter((t) => !t.dark)).toHaveLength(2);
  });

  it('bootstrap script applies the default when localStorage throws', () => {
    // The script must never leave the page unstyled, even in a sandboxed frame
    // where reading localStorage raises a SecurityError.
    const doc = { documentElement: { dataset: {} as Record<string, string> } };
    const throwingStorage = {
      getItem() {
        throw new Error('SecurityError');
      },
    };
    new Function('document', 'localStorage', themeBootstrapScript)(doc, throwingStorage);
    expect(doc.documentElement.dataset.theme).toBe(DEFAULT_THEME);
  });

  it('bootstrap script honours a valid stored theme and rejects an unknown one', () => {
    const run = (stored: string) => {
      const doc = { documentElement: { dataset: {} as Record<string, string> } };
      new Function('document', 'localStorage', themeBootstrapScript)(doc, {
        getItem: () => stored,
      });
      return doc.documentElement.dataset.theme;
    };
    expect(run('everforest')).toBe('everforest');
    expect(run('not-a-theme')).toBe(DEFAULT_THEME);
  });
});
