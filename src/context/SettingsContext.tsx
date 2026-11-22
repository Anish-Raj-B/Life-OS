import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { NavItem, PlatformSettings } from '@/lib/types';

export const DEFAULT_NAV: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/' },
  { key: 'myday', label: 'My Day', path: '/my-day' },
  { key: 'tasks', label: 'Tasks', path: '/tasks' },
  { key: 'timetable', label: 'Timetable', path: '/timetable' },
  { key: 'analytics', label: 'Analytics', path: '/analytics' },
  { key: 'learning', label: 'Learning', path: '/learning' },
  { key: 'sections', label: 'Sections', path: '/sections' },
  { key: 'paths', label: 'Learning Paths', path: '/paths' },
  { key: 'flashcards', label: 'Flashcards', path: '/flashcards' },
  { key: 'challenges', label: 'Challenges', path: '/challenges' },
  { key: 'diary', label: 'Diary', path: '/diary' },
  { key: 'goals', label: 'Goals', path: '/goals' },
  { key: 'resources', label: 'Resources', path: '/resources' },
  { key: 'integrations', label: 'Integrations', path: '/integrations' },
  { key: 'profile', label: 'Profile', path: '/profile' },
  { key: 'settings', label: 'Settings', path: '/settings' },
  { key: 'admin', label: 'Administration', path: '/admin', adminOnly: true },
];

export const DEFAULT_MODULES: Record<string, boolean> = {
  myday: true, tasks: true, timetable: true, analytics: true, learning: true,
  sections: true, paths: true, flashcards: true, challenges: true, diary: true,
  goals: true, resources: true, integrations: true,
};

interface SettingsValue {
  settings: PlatformSettings | null;
  loading: boolean;
  nav: NavItem[];
  theme: PlatformSettings['theme'];
  modules: Record<string, boolean>;
  announcement: string | null;
  appName: string;
  registrationEnabled: boolean;
  refresh: () => Promise<void>;
}

const SettingsContext = createContext<SettingsValue | null>(null);

function hexToRgb(hex?: string): string | null {
  if (!hex) return null;
  const match = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return null;
  const int = parseInt(match[1], 16);
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
}

function applyTheme(theme: PlatformSettings['theme']) {
  const root = document.documentElement;
  const accent = hexToRgb(theme.accent);
  const accent2 = hexToRgb(theme.accent2);
  const base = hexToRgb(theme.base);
  const surface = hexToRgb(theme.surface);
  if (accent) root.style.setProperty('--c-accent', accent);
  if (accent2) root.style.setProperty('--c-accent2', accent2);
  if (base) root.style.setProperty('--c-base', base);
  if (surface) root.style.setProperty('--c-surface', surface);
  if (theme.fontSans) root.style.setProperty('--font-sans', `${theme.fontSans}, ui-sans-serif, system-ui, sans-serif`);
  const radius = theme.radius;
  if (radius) {
    root.style.setProperty('--radius', radius);
    document.querySelectorAll<HTMLElement>('[data-card]').forEach((el) => {
      el.style.borderRadius = radius;
    });
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const { data } = await supabase.from('platform_settings').select('*').eq('id', 1).maybeSingle();
    if (data) setSettings(data as PlatformSettings);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    // Global configuration is administrator-controlled; poll occasionally so a
    // long-lived session picks up a published theme/navigation change.
    const timer = setInterval(() => void refresh(), 120_000);
    return () => clearInterval(timer);
  }, []);

  const theme = settings?.theme ?? {};
  useEffect(() => {
    applyTheme(theme);
  }, [theme.accent, theme.accent2, theme.base, theme.surface, theme.fontSans, theme.radius]);

  const value = useMemo<SettingsValue>(() => {
    const modules = { ...DEFAULT_MODULES, ...(settings?.modules ?? {}) };
    const configured = settings?.navigation?.length ? settings.navigation : null;
    const base = configured ?? DEFAULT_NAV;
    const seen = new Set<string>();
    const nav = base
      .map((item) => {
        const fallback = DEFAULT_NAV.find((d) => d.key === item.key);
        return { ...fallback, ...item } as NavItem;
      })
      .filter((item) => {
        if (!item?.path || !item?.key) return false;
        if (item.adminOnly) return true;
        const enabled = modules[item.key] ?? true;
        if (!enabled || seen.has(item.key)) return false;
        seen.add(item.key);
        return true;
      });

    return {
      settings,
      loading,
      nav,
      theme,
      modules,
      announcement: settings?.announcement ?? null,
      appName: settings?.app_name ?? 'LIFE OS',
      registrationEnabled: settings?.public_registration_enabled ?? false,
      refresh,
    };
  }, [settings, loading]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
