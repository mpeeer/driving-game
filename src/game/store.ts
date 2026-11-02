import {
  LEGACY_PROFILE_KEY,
  LEGACY_SETTINGS_KEY,
  PROFILE_KEY,
  REGIONS,
  SETTINGS_KEY,
  START_CREDITS,
} from './config';
import type { CarId, HudState, Profile, RegionId, Settings, UiState, UpgradeId } from './types';

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
    return () => {
      this.listeners.delete(listener);
    };
  };
}

const DEFAULT_PROFILE: Profile = {
  credits: START_CREDITS,
  xp: 0,
  upgrades: { engine: 0, grip: 0, brakes: 0, aero: 0 },
  bestSpeed: 0,
  bestLap: null,
  bestTrial: null,
  distance: 0,
  laps: 0,
};

const DEFAULT_SETTINGS: Settings = {
  units: 'kmh',
  muted: false,
  quality: 'medium',
  shake: true,
  region: 'coast',
  camera: 'cockpit',
  car: 'camaro',
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

function isRegion(value: unknown): value is RegionId {
  return REGIONS.some((region) => region.id === value);
}

function isCar(value: unknown): value is CarId {
  return value === 'camaro' || value === 'koenigsegg' || value === 'mercedes';
}

export function loadProfile(): Profile {
  const current = readJson<Profile>(PROFILE_KEY);
  const legacy = current ? null : readJson<Profile & { upgrades?: Record<string, number> }>(LEGACY_PROFILE_KEY);
  const raw = current ?? legacy;
  if (!raw) return { ...DEFAULT_PROFILE, upgrades: { ...DEFAULT_PROFILE.upgrades } };

  const upgrades = (raw.upgrades ?? {}) as Record<string, number>;
  return {
    credits: Number.isFinite(raw.credits) ? Math.max(0, Number(raw.credits)) : START_CREDITS,
    xp: Number.isFinite(raw.xp) ? Math.max(0, Number(raw.xp)) : 0,
    upgrades: {
      engine: clampUpgrade(upgrades.engine),
      grip: clampUpgrade(upgrades.grip),
      brakes: clampUpgrade(upgrades.brakes),
      // Old saves had a lights line. Fold it into the new aero line.
      aero: clampUpgrade(upgrades.aero ?? upgrades.lights),
    },
    bestSpeed: Number.isFinite(raw.bestSpeed) ? Math.max(0, Number(raw.bestSpeed)) : 0,
    bestLap: typeof raw.bestLap === 'number' && Number.isFinite(raw.bestLap) ? raw.bestLap : null,
    bestTrial:
      typeof raw.bestTrial === 'number' && Number.isFinite(raw.bestTrial)
        ? Math.max(0, raw.bestTrial)
        : null,
    distance: Number.isFinite(raw.distance) ? Math.max(0, Number(raw.distance)) : 0,
    laps: Number.isFinite(raw.laps) ? Math.max(0, Number(raw.laps)) : 0,
  };
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Storage can be unavailable in private browsing; the drive still runs.
  }
}

export function loadSettings(): Settings {
  const current = readJson<Settings>(SETTINGS_KEY);
  const legacy = current ? null : readJson<Settings>(LEGACY_SETTINGS_KEY);
  const raw = current ?? legacy;
  if (!raw) return { ...DEFAULT_SETTINGS };

  // The old build defaulted to high quality with full PBR and shadows. Drop
  // legacy "high" to medium so returning players get the smooth version first.
  const quality =
    raw.quality === 'low' || raw.quality === 'medium'
      ? raw.quality
      : legacy
        ? 'medium'
        : 'high';

  return {
    units: raw.units === 'mph' ? 'mph' : 'kmh',
    muted: Boolean(raw.muted),
    quality,
    shake: raw.shake !== false,
    region: isRegion(raw.region) ? raw.region : 'coast',
    camera: raw.camera === 'chase' ? 'chase' : 'cockpit',
    car: isCar(raw.car) ? raw.car : DEFAULT_SETTINGS.car,
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
  region: 'coast',
  regionName: 'Golden Coast',
  nextGateDistance: 0,
  gateProgress: 0,
  mapX: -680,
  mapZ: 300,
  heading: 0,
  drifting: false,
  units: 'kmh',
  clock: '16:04',
  phase: 'DAYLIGHT',
  challenge: null,
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
