/* eslint-disable react/only-export-components */
import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'theme-stark-white' | 'theme-stark-black' | 'theme-solarized-light' | 'theme-solarized-dark';

interface ThemeProviderProps {
  children: React.ReactNode;
}

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const initialState: ThemeProviderState = {
  theme: 'theme-stark-white',
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export const DARK_THEMES: ReadonlySet<Theme> = new Set<Theme>(['theme-stark-black', 'theme-solarized-dark']);

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    // storage keys keep the app's former name (blockday-*) so existing preferences survive the rename
    () => (localStorage.getItem('blockday-theme') as Theme) || 'theme-stark-white'
  );

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('theme-stark-white', 'theme-stark-black', 'theme-solarized-light', 'theme-solarized-dark');
    root.classList.add(theme);
    // Tailwind's dark: variants (text-green-600 dark:text-green-400 ...) only apply under a .dark class, and native
    // controls (date pickers, scrollbars) follow color-scheme. Without these, dark themes showed light-mode colours.
    const dark = DARK_THEMES.has(theme);
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
    localStorage.setItem('blockday-theme', theme);
  }, [theme]);

  return (
    <ThemeProviderContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
};
