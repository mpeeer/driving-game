import type { CarSpec } from './physics';
import type { Profile, UpgradeDef, UpgradeId } from './types';

export const BASE_FOV = 80;
export const MAX_FOV = 94;

export const ROAD = {
  halfWidth: 7.4,
  shoulder: 2,
  laneWidth: 3.6,
  laneCenters: [3.6, 0, -3.6],
  railOffset: 7.75,
  startOffset: 3.6,
  sectorCount: 12,
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
  fogColor: 0x0a1018,
  fogNear: 90,
  fogFar: 640,
  groundColor: 0x05070b,
  lampColor: 0xffb066,
  headlightColor: 0xeaf4ff,
};

export const PROFILE_KEY = 'nightshift.profile.v1';
export const SETTINGS_KEY = 'nightshift.settings.v1';

export const START_CREDITS = 650;

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'engine',
    name: 'Engine',
    blurb: 'Longer legs, harder pull out of the bends.',
    effect: '+7% torque per stage',
    costs: [700, 1500, 2800, 4600, 7000],
  },
  {
    id: 'grip',
    name: 'Tyres',
    blurb: 'Wet-weather compound with a softer shoulder.',
    effect: '+5.5% lateral grip per stage',
    costs: [650, 1400, 2600, 4200, 6400],
  },
  {
    id: 'brakes',
    name: 'Brakes',
    blurb: 'Bigger discs and braided lines.',
    effect: '+7% braking force per stage',
    costs: [600, 1300, 2400, 3900, 6000],
  },
  {
    id: 'lights',
    name: 'Lights',
    blurb: 'A brighter, wider cut through the dark.',
    effect: '+10% beam reach per stage',
    costs: [500, 1100, 2000, 3400, 5200],
  },
];

const RANKS = [
  'Night Owl',
  'Wheelman',
  'Line Runner',
  'Apex Chaser',
  'Night Shift',
  'Highway Star',
  'Pass Ghost',
  'Midnight Legend',
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
    lights: 1 + upgrades.lights * 0.1,
  };
}
