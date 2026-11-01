import { createRoot, type Root } from 'react-dom/client';
import { toast as notify } from 'sonner';
import { getLine } from '../content/data';
import type { Economy, ServiceResult } from '../systems/economy';
import { UiProvider } from './context';
import { resolveLineSelection, visibleLinesForRegion } from './lib/derive';
import { RailboundUI } from './RailboundUI';
import { createUiState, UiStore } from './store';
import {
  TOAST_KIND,
  type DepotTab,
  type HudCallbacks,
  type HudState,
  type ScreenName,
  type SessionInfo,
  type Tone,
  type UiEngine,
} from './types';

export type {
  DepotTab,
  HudCallbacks,
  HudState,
  RouteItemState,
  ScreenName,
  SessionInfo,
  Tone,
} from './types';

/**
 * Engine-facing facade. The simulation still calls the same methods, but the
 * interface itself is now React subscribed to a typed presentation store.
 */
export class Hud {
  readonly economy: Economy;
  readonly cb: HudCallbacks;
  private readonly store: UiStore;
  private readonly reactRoot: Root;
  private stopToastTimer = 0;
  private stopToastId = 0;

  constructor(root: HTMLElement, economy: Economy, cb: HudCallbacks) {
    this.economy = economy;
    this.cb = cb;

    const firstLine = getLine(economy.data.lastLine) ?? getLine('hbr-m1')!;
    this.store = new UiStore(createUiState(firstLine.id, firstLine.regionId));

    const engine: UiEngine = {
      economy,
      callbacks: cb,
      actions: {
        selectRegion: (regionId) => this.selectRegion(regionId),
        selectLine: (lineId) => this.store.patch({ selectedLineId: lineId }),
        setDepotTab: (tab) => {
          this.store.patch({ depotTab: tab });
          cb.onDepotTab(tab);
        },
      },
    };

    this.reactRoot = createRoot(root);
    this.reactRoot.render(
      <UiProvider store={this.store} engine={engine}>
        <RailboundUI />
      </UiProvider>,
    );
  }

  get selectedRegion(): string {
    return this.store.getSnapshot().selectedRegion;
  }

  set selectedRegion(regionId: string) {
    this.store.patch({ selectedRegion: regionId });
  }

  get selectedLineId(): string {
    return this.store.getSnapshot().selectedLineId;
  }

  set selectedLineId(lineId: string) {
    this.store.patch({ selectedLineId: lineId });
  }

  get depotTab(): DepotTab {
    return this.store.getSnapshot().depotTab;
  }

  set depotTab(tab: DepotTab) {
    this.store.patch({ depotTab: tab });
  }

  private selectRegion(regionId: string): void {
    const selectedLineId = resolveLineSelection(
      regionId,
      this.store.getSnapshot().selectedLineId,
      this.economy,
    );
    this.store.patch({ selectedRegion: regionId, selectedLineId });
  }

  showScreen(name: ScreenName): void {
    this.store.patch({ screen: name });
  }

  renderMenu(): void {
    this.store.bumpRevision();
  }

  renderDispatch(): void {
    this.store.patch((state) => ({
      selectedLineId: resolveLineSelection(state.selectedRegion, state.selectedLineId, this.economy),
      revision: state.revision + 1,
    }));
  }

  renderDepot(): void {
    this.store.bumpRevision();
  }

  setupSession(info: SessionInfo): void {
    this.store.patch({ session: info, hud: null });
  }

  update(state: HudState): void {
    this.store.patch({ hud: state });
  }

  setLoading(show: boolean): void {
    this.store.patch({ loading: show });
  }

  renderPauseSettings(): void {
    this.store.bumpSettings();
  }

  toast(message: string, type: Tone = 'info'): void {
    const kind = TOAST_KIND[type];
    if (kind === 'success') notify.success(message);
    else if (kind === 'error') notify.error(message);
    else notify.info(message);
  }

  showStopToast(message: string, tone: Tone = 'info'): void {
    window.clearTimeout(this.stopToastTimer);
    if (!message) {
      this.store.patch({ stopToast: null });
      return;
    }
    const id = ++this.stopToastId;
    this.store.patch({ stopToast: { id, message, tone } });
    this.stopToastTimer = window.setTimeout(() => {
      if (this.store.getSnapshot().stopToast?.id === id) {
        this.store.patch({ stopToast: null });
      }
    }, 4200);
  }

  showSummary(result: ServiceResult, lineColor: string): void {
    this.store.patch({ summary: { result, lineColor }, screen: 'summary' });
  }

  get visibleLineIds(): string[] {
    return visibleLinesForRegion(this.selectedRegion, this.economy).map((line) => line.id);
  }

  destroy(): void {
    window.clearTimeout(this.stopToastTimer);
    this.reactRoot.unmount();
  }
}
