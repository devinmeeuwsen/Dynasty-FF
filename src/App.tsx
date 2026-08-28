import { useEffect } from 'react';
import { AppShell } from './ui/AppShell';
import { ConnectView } from './ui/views/ConnectView';
import { PlayersView } from './ui/views/PlayersView';
import { MatrixView } from './ui/views/MatrixView';
import { TradeView } from './ui/views/TradeView';
import { CapitalView } from './ui/views/CapitalView';
import { RosterView } from './ui/views/RosterView';
import { SettingsView } from './ui/views/SettingsView';
import { useStore } from './state/store';

export function App() {
  const screen = useStore((s) => s.screen);
  const hydrate = useStore((s) => s.hydrateFromUrl);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <AppShell>
      {screen === 'connect' ? <ConnectView /> : null}
      {screen === 'players' ? <PlayersView /> : null}
      {screen === 'matrix' ? <MatrixView /> : null}
      {screen === 'trade' ? <TradeView /> : null}
      {screen === 'capital' ? <CapitalView /> : null}
      {screen === 'roster' ? <RosterView /> : null}
      {screen === 'settings' ? <SettingsView /> : null}
    </AppShell>
  );
}
