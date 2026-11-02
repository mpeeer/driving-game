export type UpgradeId = 'engine' | 'grip' | 'brakes' | 'aero';
export type CarId = 'camaro' | 'koenigsegg' | 'mercedes';
export type Units = 'kmh' | 'mph';
export type CameraMode = 'cockpit' | 'chase';
export type Quality = 'low' | 'medium' | 'high';
export type Screen = 'menu' | 'driving' | 'paused' | 'garage';
export type RegionId = 'coast' | 'mountain' | 'valley' | 'city';

export interface Profile {
  credits: number;
  xp: number;
  upgrades: Record<UpgradeId, number>;
  bestSpeed: number;
  bestLap: number | null;
  bestTrial: number | null;
  distance: number;
  laps: number;
}

export interface Settings {
  units: Units;
  muted: boolean;
  quality: Quality;
  shake: boolean;
  region: RegionId;
  camera: CameraMode;
  car: CarId;
}

export interface HudState {
  speed: number;
  rpm: number;
  gear: string;
  region: RegionId;
  regionName: string;
  nextGateDistance: number;
  gateProgress: number;
  mapX: number;
  mapZ: number;
  heading: number;
  drifting: boolean;
  units: Units;
  clock: string;
  phase: string;
  challenge: ChallengeHud | null;
}

export interface ChallengeHud {
  active: boolean;
  finished: boolean;
  time: number;
  objective: string;
  best: number | null;
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

export interface MapRoad {
  id: string;
  kind: 'skyway' | 'roundabout';
  points: Array<[number, number]>;
}

export interface MapData {
  /** Organic coastline of the island, in world metres. */
  coastline: Array<[number, number]>;
  /** The drivable island loop, in world metres. */
  route: Array<[number, number]>;
  /** Driveable branch roads around the two interchanges, in world metres. */
  junctions: MapRoad[];
  regions: Array<{ id: RegionId; name: string; x: number; z: number }>;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}
