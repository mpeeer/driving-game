import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { UiEngine, UiState } from './types';
import type { UiStore } from './store';

const UiStoreContext = createContext<UiStore | null>(null);
const UiEngineContext = createContext<UiEngine | null>(null);

interface UiProviderProps {
  store: UiStore;
  engine: UiEngine;
  children: ReactNode;
}

export function UiProvider({ store, engine, children }: UiProviderProps) {
  return (
    <UiStoreContext.Provider value={store}>
      <UiEngineContext.Provider value={engine}>{children}</UiEngineContext.Provider>
    </UiStoreContext.Provider>
  );
}

export function useUiStore<T>(selector: (state: UiState) => T): T {
  const store = useContext(UiStoreContext);
  if (!store) throw new Error('useUiStore must be used inside UiProvider');

  // Keep the selector current without resubscribing on every render. Selectors
  // must return a primitive or a stable reference from UiState.
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const getSnapshot = useCallback(() => selectorRef.current(store.getSnapshot()), [store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function useEngine(): UiEngine {
  const engine = useContext(UiEngineContext);
  if (!engine) throw new Error('useEngine must be used inside UiProvider');
  return engine;
}
