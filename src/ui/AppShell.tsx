import type { ReactNode } from 'react';
import { useStore, type Screen } from '../state/store';
import { relativeTime } from './format';

const NAV: { id: Screen; label: string; icon: ReactNode; syncedOnly?: boolean }[] = [
  { id: 'players', label: 'Players', icon: <IconPlayers /> },
  { id: 'matrix', label: 'League', icon: <IconMatrix />, syncedOnly: true },
  { id: 'trade', label: 'Trade', icon: <IconTrade />, syncedOnly: true },
  { id: 'capital', label: 'Capital', icon: <IconPick />, syncedOnly: true },
  { id: 'roster', label: 'Roster', icon: <IconRoster />, syncedOnly: true },
  { id: 'settings', label: 'Settings', icon: <IconSettings /> },
];

export function AppShell({ children }: { children: ReactNode }) {
  const screen = useStore((s) => s.screen);
  const go = useStore((s) => s.go);
  const league = useStore((s) => s.league);
  const mode = useStore((s) => s.mode);
  const simulating = useStore((s) => s.simulating);

  const items = NAV.filter((item) => !item.syncedOnly || mode === 'synced');

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-white/[0.06] px-3 py-5 lg:flex">
        <button
          onClick={() => go('connect')}
          className="focus-ring mb-6 flex items-center gap-2.5 rounded-lg px-2 py-1 text-left"
        >
          <Logo />
          <div className="leading-tight">
            <div className="text-[0.9375rem] font-bold tracking-tight text-ink-100">
              Dynasty FF
            </div>
            <div className="text-[0.6875rem] text-ink-500">value calculator</div>
          </div>
        </button>

        <nav className="flex flex-col gap-0.5">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => go(item.id)}
              className={`focus-ring flex items-center gap-3 rounded-lg px-3 py-2 text-left text-[0.875rem] font-medium transition ${
                screen === item.id
                  ? 'bg-white/[0.08] text-ink-100'
                  : 'text-ink-400 hover:bg-white/[0.04] hover:text-ink-200'
              }`}
            >
              <span className={screen === item.id ? 'text-blend-400' : ''}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto space-y-2 px-2 pt-6">
          {league ? (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <div className="truncate text-[0.8125rem] font-semibold text-ink-100">
                {league.name}
              </div>
              <div className="num mt-0.5 text-[0.6875rem] text-ink-500">
                {league.season} · {league.shape.teams} teams
                {league.shape.superflex ? ' · SF' : ''}
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-[0.6875rem] text-ink-500">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    simulating ? 'bg-now-500' : 'bg-good-500'
                  }`}
                />
                {simulating ? 'Simulating…' : `Synced ${relativeTime(league.syncedAt)}`}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-[0.75rem] leading-relaxed text-ink-400">
              Simulated mode. Connect a Sleeper league for observed replacement level, the
              finish matrix and pick valuation.
            </div>
          )}

          {/* Attribution. The values on every screen are theirs. */}
          <p className="mt-3 px-1 text-[0.6875rem] leading-relaxed text-ink-500">
            Player values from{' '}
            <a
              href="https://keeptradecut.com"
              target="_blank"
              rel="noreferrer noopener"
              className="focus-ring rounded underline underline-offset-2 hover:text-ink-300"
            >
              KeepTradeCut
            </a>
            . Leagues from Sleeper.
          </p>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile header */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/[0.06] bg-ink-950/80 px-4 py-3 backdrop-blur-xl lg:hidden">
          <Logo />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[0.875rem] font-semibold text-ink-100">
              {league?.name ?? 'Dynasty FF'}
            </div>
            <div className="num truncate text-[0.6875rem] text-ink-500">
              {league
                ? `${league.shape.teams} teams · ${simulating ? 'simulating…' : `synced ${relativeTime(league.syncedAt)}`}`
                : 'Simulated mode'}
            </div>
          </div>
          <button
            onClick={() => go('connect')}
            className="focus-ring rounded-lg border border-white/10 px-2.5 py-1.5 text-[0.75rem] text-ink-300"
          >
            League
          </button>
        </header>

        <main className="mx-auto w-full max-w-6xl px-3 pb-28 pt-4 sm:px-5 lg:pb-10 lg:pt-6">
          {children}
        </main>
      </div>

      {/* Mobile bottom bar. Most fantasy football happens on a phone. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.07] bg-ink-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="flex">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => go(item.id)}
              className={`focus-ring flex flex-1 flex-col items-center gap-1 py-2.5 text-[0.625rem] font-medium transition ${
                screen === item.id ? 'text-blend-400' : 'text-ink-500'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="9" fill="#12121e" stroke="rgba(255,255,255,0.09)" />
      <path d="M7 23V9h5.4c4 0 6.6 2.6 6.6 7s-2.6 7-6.6 7H7Z" fill="var(--color-blend-500)" />
      <circle cx="24" cy="12" r="3" fill="var(--color-now-500)" />
      <circle cx="24" cy="21" r="3" fill="var(--color-later-500)" />
    </svg>
  );
}

function IconPlayers() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M3 5.5h14M3 10h14M3 14.5h9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMatrix() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.4" fill="currentColor" opacity=".85" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1.4" fill="currentColor" opacity=".35" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1.4" fill="currentColor" opacity=".35" />
      <rect x="11.5" y="11.5" width="6" height="6" rx="1.4" fill="currentColor" opacity=".85" />
    </svg>
  );
}

function IconTrade() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M3 7h11l-3-3M17 13H6l3 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPick() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M10 2.5 17 6v8l-7 3.5L3 14V6l7-3.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.4" fill="currentColor" />
    </svg>
  );
}

function IconRoster() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="6.5" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.8 17c.7-3.2 3.2-5 6.2-5s5.5 1.8 6.2 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 2.6v2M10 15.4v2M17.4 10h-2M4.6 10h-2M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4M15.2 15.2l-1.4-1.4M6.2 6.2 4.8 4.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
