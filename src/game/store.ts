import { PROFILE_KEY, SETTINGS_KEY, START_CREDITS } from './config';
import type { HudState, Profile, Settings, UiState, UpgradeId } from './types';

type Listener = () => void;

export class Store<T> {
  private state: T;
  private listeners = new Set<Listener>();

  constructor(initial: T) {
    this.state = initial;
  }

  get = (): T => this.state;

  set = (patch: Partial<T> | ((state: T) => Partial<T>)): void => {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    let changed = false;
    for (const key of Object.keys(next) as (keyof T)[]) {
      if (this.state[key] !== next[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

const DEFAULT_PROFILE: Profile = {
  credits: START_CREDITS,
  xp: 0,
  upgrades: { engine: 0, grip: 0, brakes: 0, lights: 0 },
  bestSpeed: 0,
  bestLap: null,
  distance: 0,
  laps: 0,
};

const DEFAULT_SETTINGS: Settings = {
  units: 'kmh',
  muted: false,
  quality: 'high',
  shake: true,
};

function readJson<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

function clampUpgrade(value: unknown): number {
  const n = typeof value === 'number' ? value : 0;
  return Math.max(0, Math.min(5, Math.round(n)));
}

export function loadProfile(): Profile {
  const raw = readJson<Profile>(PROFILE_KEY);
  if (!raw) return { ...DEFAULT_PROFILE, upgrades: { ...DEFAULT_PROFILE.upgrades } };
  const upgrades = (raw.upgrades ?? {}) as Record<UpgradeId, number>;
  return {
    credits: Number.isFinite(raw.credits) ? Math.max(0, Number(raw.credits)) : START_CREDITS,
    xp: Number.isFinite(raw.xp) ? Math.max(0, Number(raw.xp)) : 0,
    upgrades: {
      engine: clampUpgrade(upgrades.engine),
      grip: clampUpgrade(upgrades.grip),
      brakes: clampUpgrade(upgrades.brakes),
      lights: clampUpgrade(upgrades.lights),
    },
    bestSpeed: Number.isFinite(raw.bestSpeed) ? Math.max(0, Number(raw.bestSpeed)) : 0,
    bestLap: typeof raw.bestLap === 'number' && Number.isFinite(raw.bestLap) ? raw.bestLap : null,
    distance: Number.isFinite(raw.distance) ? Math.max(0, Number(raw.distance)) : 0,
    laps: Number.isFinite(raw.laps) ? Math.max(0, Number(raw.laps)) : 0,
  };
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Storage can be unavailable in private browsing; the game still runs for this session.
  }
}

export function loadSettings(): Settings {
  const raw = readJson<Settings>(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  return {
    units: raw.units === 'mph' ? 'mph' : 'kmh',
    muted: Boolean(raw.muted),
    quality: raw.quality === 'low' || raw.quality === 'medium' ? raw.quality : 'high',
    shake: raw.shake !== false,
  };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures.
  }
}

export const hud = new Store<HudState>({
  speed: 0,
  rpm: 900,
  gear: 'N',
  sector: 1,
  sectors: 12,
  sectorProgress: 0,
  lap: 0,
  lapTime: 0,
  bestLap: null,
  throttle: 0,
  brake: 0,
  steering: 0,
  drifting: false,
  units: 'kmh',
});

export const ui = new Store<UiState>({
  screen: 'menu',
  garageFrom: 'menu',
  profile: loadProfile(),
  settings: loadSettings(),
  toast: null,
  sessionCredits: 0,
});

export function patchProfile(patch: Partial<Profile>): Profile {
  const current = ui.get().profile;
  const profile = { ...current, ...patch };
  ui.set({ profile });
  return profile;
}
