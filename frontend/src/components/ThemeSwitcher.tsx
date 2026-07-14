'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_THEME, getTheme, setTheme, THEMES, type ThemeId } from '@/lib/theme';

export default function ThemeSwitcher() {
  const [current, setCurrent] = useState<ThemeId>(DEFAULT_THEME);

  useEffect(() => {
    setCurrent(getTheme());
  }, []);

  function choose(theme: ThemeId) {
    setTheme(theme);
    setCurrent(theme);
  }

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold">Theme</h2>
      <p className="mb-3 text-xs text-fg-muted">Palettes from Omarchy.</p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {THEMES.map((theme) => {
          const active = theme.id === current;
          return (
            <li key={theme.id}>
              <button
                type="button"
                onClick={() => choose(theme.id)}
                aria-pressed={active}
                className={`flex w-full items-center gap-2 rounded-omarchy border px-3 py-2 text-left text-xs transition-colors ${
                  active
                    ? 'border-accent bg-surface-2'
                    : 'border-border bg-surface hover:border-accent'
                }`}
              >
                <span
                  data-testid={`swatch-${theme.id}`}
                  data-theme={theme.id}
                  className="size-4 shrink-0 rounded-full border border-border bg-accent"
                />
                <span className="truncate">{theme.name}</span>
                <span className="ml-auto text-fg-faint">{theme.dark ? '●' : '○'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
