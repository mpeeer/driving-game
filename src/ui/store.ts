import type { UiState } from './types';

export function createUiState(selectedLineId: string, selectedRegion: string): UiState {
  return {
    screen: 'menu',
    selectedRegion,
    selectedLineId,
    depotTab: 'lines',
    session: null,
    hud: null,
    summary: null,
    revision: 0,
    settingsRevision: 0,
    loading: false,
    stopToast: null,
  };
}

type Updater = Partial<UiState> | ((state: UiState) => Partial<UiState>);

/**
 * Small external store. The engine can keep mutating its own domain objects;
 * this is only the presentation state React needs to draw.
 */
export class UiStore {
  private state: UiState;
  private listeners = new Set<() => void>();

  constructor(initial: UiState) {
    this.state = initial;
  }

  readonly getSnapshot = (): UiState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  patch(update: Updater): void {
    const partial = typeof update === 'function' ? update(this.state) : update;
    const next = { ...this.state, ...partial };
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  bumpRevision(): void {
    this.patch((state) => ({ revision: state.revision + 1 }));
  }

  bumpSettings(): void {
    this.patch((state) => ({ settingsRevision: state.settingsRevision + 1 }));
  }
}
