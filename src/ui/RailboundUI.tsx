import { Toaster } from '@/components/ui/sonner';
import { LoadingOverlay } from './components/loading-overlay';
import { StopToast } from './components/stop-toast';
import { useUiStore } from './context';
import { ControlsDialog } from './screens/controls-dialog';
import { DepotScreen } from './screens/depot-screen';
import { DispatchScreen } from './screens/dispatch-screen';
import { DrivingHud } from './screens/driving-hud';
import { MenuScreen } from './screens/menu-screen';
import { PauseDialog } from './screens/pause-dialog';
import { SummaryDialog } from './screens/summary-dialog';

export function RailboundUI() {
  const screen = useUiStore((state) => state.screen);

  return (
    <div className="ui-root">
      {screen === 'menu' ? <MenuScreen /> : null}
      {screen === 'dispatch' ? <DispatchScreen /> : null}
      {screen === 'depot' ? <DepotScreen /> : null}
      {screen === 'driving' ? <DrivingHud /> : null}
      {screen === 'paused' ? (
        <>
          <DrivingHud />
          <PauseDialog />
        </>
      ) : null}
      {screen === 'summary' ? <SummaryDialog /> : null}
      {screen === 'controls' ? <ControlsDialog /> : null}

      <StopToast />
      <LoadingOverlay />
      <Toaster position="bottom-left" closeButton={false} offset={16} />
    </div>
  );
}
