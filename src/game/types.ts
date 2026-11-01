export type UpgradeId = 'engine' | 'grip' | 'brakes' | 'lights';
export type Units = 'kmh' | 'mph';
export type Quality = 'low' | 'medium' | 'high';
export type Screen = 'menu' | 'driving' | 'paused' | 'garage';

export interface Profile {
  credits: number;
  xp: number;
  upgrades: Record<UpgradeId, number>;
  bestSpeed: number;
  bestLap: number | null;
  distance: number;
  laps: number;
}

export interface Settings {
  units: Units;
  muted: boolean;
  quality: Quality;
  shake: boolean;
}

export interface HudState {
  speed: number;
  rpm: number;
  gear: string;
  sector: number;
  sectors: number;
  sectorProgress: number;
  lap: number;
  lapTime: number;
  bestLap: number | null;
  throttle: number;
  brake: number;
  steering: number;
  drifting: boolean;
  units: Units;
}

export interface Toast {
  id: number;
  kind: 'sector' | 'lap' | 'level' | 'error' | 'info';
  title: string;
  detail?: string;
}

export interface UiState {
  screen: Screen;
  garageFrom: 'menu' | 'paused';
  profile: Profile;
  settings: Settings;
  toast: Toast | null;
  sessionCredits: number;
}

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  blurb: string;
  effect: string;
  costs: number[];
}
