import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Sun, ListChecks, CalendarClock, BarChart3, GraduationCap, Layers,
  Route as RouteIcon, CreditCard, Trophy, NotebookPen, Target, Link2, Plug,
  UserRound, Settings, ShieldCheck, Search, Bell, Menu, X, LogOut, CloudOff,
  RefreshCw, CheckCircle2, AlertTriangle, ChevronLeft, Zap,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useSync } from '@/context/SyncContext';
import { supabase } from '@/lib/supabase';
import { useCollection } from '@/hooks/useCollection';
import type { Notification } from '@/lib/types';
import { initials, prettyDateTime } from '@/lib/utils';
import { SearchPalette } from './SearchPalette';

export const NAV_ICONS: Record<string, React.ComponentType<{ size?: number | string; className?: string }>> = {
  dashboard: LayoutDashboard,
  myday: Sun,
  tasks: ListChecks,
  timetable: CalendarClock,
  analytics: BarChart3,
  learning: GraduationCap,
  sections: Layers,
  paths: RouteIcon,
  flashcards: CreditCard,
  challenges: Trophy,
  diary: NotebookPen,
  goals: Target,
  resources: Link2,
  integrations: Plug,
  profile: UserRound,
  settings: Settings,
  admin: ShieldCheck,
};

function SyncPill() {
  const { state, pending, syncNow, online } = useSync();
  const map = {
    offline: { icon: CloudOff, text: 'Offline', cls: 'text-warn border-warn/30 bg-warn/10' },
    pending: { icon: RefreshCw, text: `${pending} pending`, cls: 'text-warn border-warn/30 bg-warn/10' },
    syncing: { icon: RefreshCw, text: 'Syncing', cls: 'text-accent2 border-accent2/30 bg-accent2/10' },
    error: { icon: AlertTriangle, text: 'Sync issue', cls: 'text-danger border-danger/30 bg-danger/10' },
    online: { icon: CheckCircle2, text: 'Online', cls: 'text-ok border-ok/30 bg-ok/10' },
    synced: { icon: CheckCircle2, text: 'Synced', cls: 'text-ok border-ok/30 bg-ok/10' },
  } as const;
  const item = map[state];
  const Icon = item.icon;
  return (
    <button
      onClick={() => void syncNow()}
      title={online ? 'Click to sync now' : 'Changes are saved locally and will sync when you reconnect'}
      className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium', item.cls)}
    >
      <Icon size={11} className={state === 'syncing' ? 'animate-spin' : undefined} />
      {item.text}
    </button>
  );
}

function NotificationBell() {
  const { data, reload } = useCollection<Notification>('notifications', 'created_at', false);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const unread = data.filter((n) => !n.read_at).length;

  const markAll = async () => {
    const ids = data.filter((n) => !n.read_at).map((n) => n.id);
    if (!ids.length) return;
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
    reload();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="btn btn-ghost relative !p-2"
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-[min(90vw,22rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-line/70 px-3 py-2">
              <span className="text-xs font-semibold text-ink">Notifications</span>
              <button onClick={() => void markAll()} className="text-[10px] text-accent hover:underline">
                Mark all read
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {data.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted">Nothing yet.</p>}
              {data.slice(0, 20).map((n) => (
                <button
                  key={n.id}
                  onClick={async () => {
                    setOpen(false);
                    if (!n.read_at) {
                      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
                      reload();
                    }
                    if (n.url) navigate(n.url);
                  }}
                  className={clsx(
                    'block w-full border-b border-line/40 px-3 py-2.5 text-left transition hover:bg-raised/60',
                    !n.read_at && 'bg-accent/5',
                  )}
                >
                  <span className="flex items-center gap-2">
                    {!n.read_at && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                    <span className="truncate text-xs font-medium text-ink">{n.title}</span>
                  </span>
                  {n.body && <span className="mt-0.5 block text-[11px] leading-snug text-muted">{n.body}</span>}
                  <span className="mt-1 block text-[10px] text-muted/70">{prettyDateTime(n.created_at)}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, isAdmin, signOut } = useAuth();
  const { nav, appName, theme, announcement } = useSettings();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('life-os:slim') === '1');
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      localStorage.setItem('life-os:slim', v ? '0' : '1');
      return !v;
    });
  };

  const primaryMobile = nav.filter((n) => ['/', '/tasks', '/timetable', '/learning', '/flashcards'].includes(n.path));

  return (
    <div className="min-h-screen">
      {/* desktop sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line/60 bg-surface/60 backdrop-blur-xl transition-all lg:flex',
          collapsed ? 'w-[74px]' : 'w-[248px]',
        )}
      >
        <div className={clsx('flex h-16 items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent2 text-white shadow-lg shadow-accent/20">
            <Zap size={16} />
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-ink">{appName}</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted">Personal OS</p>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {nav
            .filter((item) => !item.adminOnly || isAdmin)
            .map((item) => {
              const Icon = NAV_ICONS[item.key] ?? LayoutDashboard;
              return (
                <NavLink
                  key={item.key}
                  to={item.path}
                  end={item.path === '/'}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    clsx(
                      'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition',
                      isActive ? 'bg-accent/15 text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink',
                      collapsed && 'justify-center px-0',
                    )
                  }
                >
                  <Icon size={17} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </NavLink>
              );
            })}
        </nav>

        <div className="border-t border-line/60 p-2">
          <button onClick={toggleCollapsed} className="btn btn-ghost w-full !justify-start !px-2.5 !text-xs text-muted">
            <ChevronLeft size={15} className={clsx('transition-transform', collapsed && 'rotate-180')} />
            {!collapsed && 'Collapse'}
          </button>
        </div>
      </aside>

      {/* mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[264px] flex-col border-r border-line bg-surface">
            <div className="flex h-16 items-center justify-between px-4">
              <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Zap size={16} className="text-accent" /> {appName}
              </span>
              <button onClick={() => setMenuOpen(false)} className="btn btn-ghost !p-1.5" aria-label="Close menu">
                <X size={16} />
              </button>
            </div>
            <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
              {nav
                .filter((item) => !item.adminOnly || isAdmin)
                .map((item) => {
                  const Icon = NAV_ICONS[item.key] ?? LayoutDashboard;
                  return (
                    <NavLink
                      key={item.key}
                      to={item.path}
                      end={item.path === '/'}
                      className={({ isActive }) =>
                        clsx(
                          'flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium',
                          isActive ? 'bg-accent/15 text-ink' : 'text-muted',
                        )
                      }
                    >
                      <Icon size={17} />
                      {item.label}
                    </NavLink>
                  );
                })}
            </nav>
          </aside>
        </div>
      )}

      <div className={clsx('transition-all', collapsed ? 'lg:pl-[74px]' : 'lg:pl-[248px]')}>
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line/60 bg-base/80 px-3 backdrop-blur-xl sm:px-5">
          <button onClick={() => setMenuOpen(true)} className="btn btn-ghost !p-2 lg:hidden" aria-label="Open menu">
            <Menu size={18} />
          </button>

          <button
            onClick={() => setSearchOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line/80 bg-surface/60 px-3 py-1.5 text-left text-xs text-muted transition hover:border-accent/40 sm:max-w-md"
          >
            <Search size={14} />
            <span className="truncate">Search everything…</span>
            <kbd className="ml-auto hidden rounded border border-line px-1.5 py-0.5 text-[10px] text-muted/80 sm:block">⌘K</kbd>
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <div className="hidden sm:block"><SyncPill /></div>
            <NotificationBell />
            <div className="relative">
              <NavLink to="/profile" className="flex items-center gap-2 rounded-full border border-line bg-surface/70 p-0.5 pr-2 transition hover:border-accent/40">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-accent/25 text-[11px] font-semibold text-accent">
                    {initials(profile?.full_name)}
                  </span>
                )}
                <span className="hidden max-w-[110px] truncate text-xs text-ink sm:block">
                  {profile?.full_name?.split(' ')[0] ?? 'Profile'}
                </span>
              </NavLink>
            </div>
            <button onClick={() => void signOut()} className="btn btn-ghost !p-2" aria-label="Sign out" title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </header>

        {announcement && (
          <div className="border-b border-accent/20 bg-accent/10 px-4 py-2 text-center text-xs text-accent">
            {announcement}
          </div>
        )}

        <main className="mx-auto w-full max-w-[1500px] px-3 pb-24 pt-4 sm:px-5 sm:pb-10 lg:pt-6">{children}</main>
      </div>

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-line/70 bg-surface/95 backdrop-blur-xl lg:hidden">
        {primaryMobile.slice(0, 5).map((item) => {
          const Icon = NAV_ICONS[item.key] ?? LayoutDashboard;
          return (
            <NavLink
              key={item.key}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium',
                  isActive ? 'text-accent' : 'text-muted',
                )
              }
            >
              <Icon size={19} />
              {item.label}
            </NavLink>
          );
        })}
        <button
          onClick={() => setMenuOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium text-muted"
        >
          <Menu size={19} />
          More
        </button>
      </nav>

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      {/* theme variables are applied by SettingsProvider */}
      <span className="hidden" data-theme-radius={theme.radius} />
    </div>
  );
}
