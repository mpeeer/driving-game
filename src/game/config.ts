import type { CarSpec } from './physics';
import type { Profile, RegionId, UpgradeDef, UpgradeId } from './types';

export const GAME_TITLE = 'Coastline';
export const BASE_FOV = 67;
export const MAX_FOV = 77;

/** Horizontal world scale. The island layout is authored at 1x and expanded here. */
export const MAP_SCALE = 2.1;

/** Driver's eye offset from the vehicle centre line (left-hand drive). */
export const DRIVER_X = -0.35;

export const ROAD = {
  halfWidth: 7.6,
  shoulder: 2.1,
  laneWidth: 3.8,
  // Four marked lanes: two in each direction. The player starts in the outer
  // right lane and traffic uses both lanes per direction.
  laneCenters: [5.7, 1.9, -1.9, -5.7],
  railOffset: 8.05,
  startOffset: 5.7,
  sectorCount: 12,
};

/** Fractional route range of the west-coast suspension bridge. */
export const BRIDGE = {
  start: 0.022,
  end: 0.066,
};

/**
 * Driveable junction district after the bridge. Fractions are measured on the
 * main loop; the roundabout sits off the right shoulder, joined by two access
 * roads. The skyway leaves and rejoins the main road on that same shoulder.
 */
export const JUNCTION = {
  skyway: { start: 0.0715, end: 0.0875 },
  roundabout: {
    center: 0.104,
    accessStart: 0.095,
    accessEnd: 0.114,
    centerOffset: 50,
    radius: 17,
  },
};

export const CAR = {
  mass: 1320,
  wheelRadius: 0.36,
  frontAxle: 1.34,
  rearAxle: -1.42,
  trackHalf: 0.84,
  suspensionRest: 0.32,
  startHeight: 0.95,
};

export const WORLD = {
  fogColor: 0xb9d4d8,
  fogNear: 240,
  fogFar: 1350,
  groundColor: 0x7c9a58,
  sunColor: 0xffe0b2,
  skyColor: 0x8ac9e8,
};

/** One complete day. The game opens in the late afternoon and rolls into dusk. */
export const DAY = {
  seconds: 300,
  start: 0.67,
};

export interface RegionDef {
  id: RegionId;
  name: string;
  short: string;
  tagline: string;
  blurb: string;
  gateIndex: number;
  color: string;
}

/** Four districts, spaced evenly around the island loop. */
export const REGIONS: RegionDef[] = [
  {
    id: 'coast',
    name: 'Golden Coast',
    short: 'Coast',
    tagline: 'Sea cliffs · sunset straight',
    blurb: 'Palm-lined cliffs, a turquoise drop and the long road north. The classic coast run.',
    gateIndex: 0,
    color: '#ffc178',
  },
  {
    id: 'mountain',
    name: 'Alpine Pass',
    short: 'Pass',
    tagline: 'Pines · rock walls · cold air',
    blurb: 'A climbing shelf road under snow-capped peaks, with fast sweepers and deep forest.',
    gateIndex: 3,
    color: '#9ed8c1',
  },
  {
    id: 'valley',
    name: 'Vine Valley',
    short: 'Valley',
    tagline: 'Fields · cypress · open bends',
    blurb: 'Warm fields and rows of cypress. Long sight lines and room to stretch the engine.',
    gateIndex: 6,
    color: '#efd37b',
  },
  {
    id: 'city',
    name: 'Harbor City',
    short: 'City',
    tagline: 'Glass towers · overpasses · neon',
    blurb: 'Down into the waterfront grid: billboards, flyovers and a skyline straight ahead.',
    gateIndex: 9,
    color: '#8fd9ff',
  },
];

export function regionById(id: RegionId): RegionDef {
  return REGIONS.find((region) => region.id === id) ?? REGIONS[0];
}

export function regionForDistance(distance: number, sectorLength: number): RegionDef {
  // Nudge exact gate distances forward: floating point otherwise floors a
  // spawn at 3249.187... to the previous district.
  const gate = Math.floor(distance / Math.max(1, sectorLength) + 1e-6);
  const wrapped = ((gate % ROAD.sectorCount) + ROAD.sectorCount) % ROAD.sectorCount;
  let current = REGIONS[0];
  for (const region of REGIONS) {
    if (wrapped >= region.gateIndex) current = region;
  }
  return current;
}

export const PROFILE_KEY = 'coastline.profile.v1';
export const LEGACY_PROFILE_KEY = 'nightshift.profile.v1';
export const SETTINGS_KEY = 'coastline.settings.v1';
export const LEGACY_SETTINGS_KEY = 'nightshift.settings.v1';

export const START_CREDITS = 650;

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'engine',
    name: 'Engine',
    blurb: 'Longer legs and a harder pull out of the bends.',
    effect: '+7% torque per stage',
    costs: [700, 1500, 2800, 4600, 7000],
  },
  {
    id: 'grip',
    name: 'Tyres',
    blurb: 'A softer compound with a predictable shoulder.',
    effect: '+5.5% lateral grip per stage',
    costs: [650, 1400, 2600, 4200, 6400],
  },
  {
    id: 'brakes',
    name: 'Brakes',
    blurb: 'Bigger discs and a firmer pedal for late braking.',
    effect: '+7% braking force per stage',
    costs: [600, 1300, 2400, 3900, 6000],
  },
  {
    id: 'aero',
    name: 'Aero',
    blurb: 'A quiet splitter and rear wing that settle the car at speed.',
    effect: '+10% high-speed stability per stage',
    costs: [550, 1200, 2200, 3600, 5600],
  },
];

const RANKS = [
  'Day Tripper',
  'Coast Runner',
  'Ridge Rider',
  'Switchback',
  'Horizon Chaser',
  'Open Road',
  'Sunset Regular',
  'Island Legend',
];

export function xpForNextLevel(level: number): number {
  return Math.round(420 + 260 * Math.pow(Math.max(0, level - 1), 1.12));
}

export function levelInfo(xp: number) {
  let level = 1;
  let remaining = Math.max(0, xp);
  let span = xpForNextLevel(1);
  while (remaining >= span && level < 60) {
    remaining -= span;
    level += 1;
    span = xpForNextLevel(level);
  }
  return {
    level,
    name: RANKS[Math.min(level - 1, RANKS.length - 1)],
    into: remaining,
    span,
    progress: Math.min(1, remaining / span),
  };
}

export function upgradeCost(id: UpgradeId, level: number): number {
  const def = UPGRADES.find((u) => u.id === id);
  if (!def) return 0;
  return def.costs[Math.min(level, def.costs.length - 1)];
}

export function carSpec(upgrades: Profile['upgrades']): CarSpec {
  return {
    engine: 1 + upgrades.engine * 0.075,
    grip: 1 + upgrades.grip * 0.055,
    brakes: 1 + upgrades.brakes * 0.07,
    aero: 1 + upgrades.aero * 0.1,
  };
}
