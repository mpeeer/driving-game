import { ui } from '../game/store';
import type { GameApi } from '../game/api';
import { useStore } from './useStore';
import { Hud } from './Hud';
import { StartScreen } from './StartScreen';
import { PauseScreen } from './PauseScreen';
import { GarageScreen } from './GarageScreen';
import { ToastView } from './ToastView';

export function App({ api }: { api: GameApi }) {
  const state = useStore(ui);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="vignette pointer-events-none absolute inset-0 z-10" />
      {state.screen !== 'menu' && <Hud api={api} />}
      <ToastView toast={state.toast} />
      {state.screen === 'menu' && <StartScreen api={api} state={state} />}
      {state.screen === 'paused' && <PauseScreen api={api} state={state} />}
      {state.screen === 'garage' && <GarageScreen api={api} state={state} />}
    </div>
  );
}
