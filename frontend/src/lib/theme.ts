export const THEMES = [
  { id: 'tokyo-night', name: 'Tokyo Night', dark: true },
  { id: 'catppuccin', name: 'Catppuccin', dark: true },
  { id: 'everforest', name: 'Everforest', dark: true },
  { id: 'gruvbox', name: 'Gruvbox', dark: true },
  { id: 'nord', name: 'Nord', dark: true },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', dark: false },
  { id: 'rose-pine-dawn', name: 'Rosé Pine Dawn', dark: false },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'tokyo-night';
export const THEME_STORAGE_KEY = 'theme';

export function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

export function getTheme(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeId(stored) ? stored : DEFAULT_THEME;
}

export function setTheme(theme: ThemeId) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  document.documentElement.dataset.theme = theme;
}

/**
 * Runs before first paint, inlined in <head>. Keep it dependency-free and
 * defensive: a throw here would leave the page unstyled.
 */
export const themeBootstrapScript = `
(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');
var ok=${JSON.stringify(THEMES.map((t) => t.id))};
document.documentElement.dataset.theme=ok.indexOf(t)>-1?t:'${DEFAULT_THEME}';}
catch(e){document.documentElement.dataset.theme='${DEFAULT_THEME}';}})();
`.trim();
