import { hashString, Rng } from '../core/util';

export type Theme = 'urban' | 'valley' | 'mountain' | 'coast' | 'oldtown';
export type Traction = 'electric' | 'diesel';
export type LineKind = 'metro' | 'lightrail' | 'regional' | 'express' | 'freight';

export interface RegionDef {
  id: string;
  name: string;
  short: string;
  blurb: string;
  theme: Theme;
  accent: string;
  unlockCost: number;
  levelReq: number;
  stationNames: string[];
  kind: LineKind;
  traction: Traction;
  maxSpeedKph: number;
  fareRate: number;
}

export interface LineDef {
  id: string;
  code: string;
  name: string;
  regionId: string;
  kind: LineKind;
  color: string;
  lengthKm: number;
  stationCount: number;
  seed: number;
  unlockCost: number;
  levelReq: number;
  maxSpeedKph: number;
  fareMultiplier: number;
  startHour: number;
  blurb: string;
  generated?: boolean;
  endlessIndex?: number;
}

export interface TrainDef {
  id: string;
  name: string;
  maker: string;
  cars: number;
  carLength: number;
  massPerCar: number;
  powerKW: number;
  maxSpeedKph: number;
  maxTEkN: number;
  brakeDecel: number;
  comfort: number;
  price: number;
  levelReq: number;
  traction: Traction;
  bodyColor: number;
  accentColor: number;
  roofColor: number;
  blurb: string;
  energyCost: number;
}

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  maxLevel: number;
  baseCost: number;
  costScale: number;
  icon: string;
}

export const REGIONS: RegionDef[] = [
  {
    id: 'harbour',
    name: 'Harbour City',
    short: 'HBR',
    blurb: 'A dense port metropolis of glass towers, quays and midnight freight. The network never sleeps.',
    theme: 'urban',
    accent: '#4da3ff',
    unlockCost: 0,
    levelReq: 1,
    kind: 'metro',
    traction: 'electric',
    maxSpeedKph: 80,
    fareRate: 1,
    stationNames: [
      'Central Quay', 'Marlin Street', 'Dockside', 'Anchor Park', 'Lighthouse Point',
      'Fishmarket', 'Seabrook', 'Customs House', 'North Pier', 'Saltworks',
      'Gullwing', 'Foundry Lane', 'Cathedral Square', 'Brickfields', 'Tideway',
      'Harbour East', 'Beacon Hill', 'Union Dock', 'Copperworks', 'Westgate',
      'Kingsway', 'Old Ferry', 'Meridian', 'Southbank',
    ],
  },
  {
    id: 'verdant',
    name: 'Verdant Valley',
    short: 'VDV',
    blurb: 'Rolling pasture, stone bridges and sleepy halts. Regional services where the timetable is a promise.',
    theme: 'valley',
    accent: '#7ed08a',
    unlockCost: 5000,
    levelReq: 4,
    kind: 'regional',
    traction: 'electric',
    maxSpeedKph: 145,
    fareRate: 1.35,
    stationNames: [
      'Meadowford', 'Ashcombe', 'Willow Halt', 'Grange End', 'Bramble Wood',
      'Riverside', 'Millbrook', 'Oakhurst', 'Fenwick', 'Larkspur',
      'Hollowfield', 'Stonebridge', 'Elmswater', 'Cranmore', 'Thistledown',
      'Harrowgate', 'Beechworth', 'Lowfield',
    ],
  },
  {
    id: 'oldtown',
    name: 'Old Town',
    short: 'OLD',
    blurb: 'Cobbles, cathedrals and tight corners. Light rail threading through a city that predates the railway.',
    theme: 'oldtown',
    accent: '#f0b35a',
    unlockCost: 9000,
    levelReq: 5,
    kind: 'lightrail',
    traction: 'electric',
    maxSpeedKph: 70,
    fareRate: 1.15,
    stationNames: [
      'Old Town Square', 'Cobble Lane', 'Cathedral', 'Riverside Walk', 'Guildhall',
      'Museum Row', 'The Vaults', 'Millpond', 'Weaver Street', 'Castle Gate',
      'Bathhouse Road', 'Willow Green', 'Market Cross', 'Abbey Fields',
    ],
  },
  {
    id: 'copper',
    name: 'Copper Ridge',
    short: 'CPR',
    blurb: 'Thin air and 3% grades. A diesel-worked mountain division with trestles, tunnels and weather.',
    theme: 'mountain',
    accent: '#d1855c',
    unlockCost: 16000,
    levelReq: 7,
    kind: 'freight',
    traction: 'diesel',
    maxSpeedKph: 110,
    fareRate: 1.55,
    stationNames: [
      'Copper Ridge', 'Anvil Falls', 'Shaft Nine', 'Gearhart', 'High Pass',
      'Iron Gulch', 'Pinecrest', 'Trestle Creek', 'Ravenswood', 'Smelter Row',
      'Dynamite Point', 'Lode Mountain', 'Coldwater', 'Switchback',
    ],
  },
  {
    id: 'azure',
    name: 'Azure Coast',
    short: 'AZC',
    blurb: 'Sea walls, palm-lined promenades and 200 km/h running. The flagship of the network.',
    theme: 'coast',
    accent: '#62d9d0',
    unlockCost: 32000,
    levelReq: 10,
    kind: 'express',
    traction: 'electric',
    maxSpeedKph: 200,
    fareRate: 1.9,
    stationNames: [
      'Azure Bay', 'Palm Terrace', 'Coral Sands', 'Marina Vista', 'Sunset Pier',
      'Cliffside', 'Laguna Heights', 'Bluewater', 'Seaview', 'Palmetto',
      'Lighthouse Cove', 'Dune Park', 'Harbour Lights',
    ],
  },
];

export const LINES: LineDef[] = [
  {
    id: 'hbr-m1',
    code: 'M1',
    name: 'Harbour Loop',
    regionId: 'harbour',
    kind: 'metro',
    color: '#4da3ff',
    lengthKm: 7.2,
    stationCount: 8,
    seed: 1101,
    unlockCost: 0,
    levelReq: 1,
    maxSpeedKph: 80,
    fareMultiplier: 1,
    startHour: 6.6,
    blurb: 'The original harbour circle. Tight curves, heavy crowding and a platform at every mood.',
  },
  {
    id: 'hbr-m2',
    code: 'M2',
    name: 'Docklands Line',
    regionId: 'harbour',
    kind: 'metro',
    color: '#7ee0b8',
    lengthKm: 9.4,
    stationCount: 10,
    seed: 2207,
    unlockCost: 1800,
    levelReq: 1,
    maxSpeedKph: 80,
    fareMultiplier: 1.08,
    startHour: 7.4,
    blurb: 'Container cranes, new-build apartments and the busiest interchange on the network.',
  },
  {
    id: 'hbr-m3',
    code: 'M3',
    name: 'Northgate Line',
    regionId: 'harbour',
    kind: 'metro',
    color: '#ff9f6e',
    lengthKm: 11.8,
    stationCount: 12,
    seed: 3313,
    unlockCost: 5200,
    levelReq: 3,
    maxSpeedKph: 80,
    fareMultiplier: 1.15,
    startHour: 17.1,
    blurb: 'A long north-south axis through the old industrial belt. Evening peak rules here.',
  },
  {
    id: 'vdv-v1',
    code: 'V1',
    name: 'Valley Line',
    regionId: 'verdant',
    kind: 'regional',
    color: '#7ed08a',
    lengthKm: 19.5,
    stationCount: 10,
    seed: 4409,
    unlockCost: 0,
    levelReq: 1,
    maxSpeedKph: 145,
    fareMultiplier: 1.35,
    startHour: 8.2,
    blurb: 'The main line up the valley. Long straights, gentle curves and a lot of sheep.',
  },
  {
    id: 'vdv-v2',
    code: 'V2',
    name: 'Lakeside Branch',
    regionId: 'verdant',
    kind: 'regional',
    color: '#a8dc74',
    lengthKm: 13.2,
    stationCount: 8,
    seed: 5519,
    unlockCost: 4600,
    levelReq: 5,
    maxSpeedKph: 120,
    fareMultiplier: 1.4,
    startHour: 12.7,
    blurb: 'A single-track branch that twists around the lake. Timed to the minute.',
  },
  {
    id: 'old-l1',
    code: 'L1',
    name: 'Riverside Loop',
    regionId: 'oldtown',
    kind: 'lightrail',
    color: '#f0b35a',
    lengthKm: 9.8,
    stationCount: 11,
    seed: 6631,
    unlockCost: 0,
    levelReq: 1,
    maxSpeedKph: 70,
    fareMultiplier: 1.15,
    startHour: 10.1,
    blurb: 'Tight street running past the cathedral. Sharp curves and short platforms.',
  },
  {
    id: 'cpr-c1',
    code: 'C1',
    name: 'Copper Pass',
    regionId: 'copper',
    kind: 'freight',
    color: '#d1855c',
    lengthKm: 23.6,
    stationCount: 9,
    seed: 7717,
    unlockCost: 0,
    levelReq: 1,
    maxSpeedKph: 100,
    fareMultiplier: 1.55,
    startHour: 5.4,
    blurb: 'Climbs 380 metres through switchbacks and a mile of snowshed. Diesels only.',
  },
  {
    id: 'azc-a1',
    code: 'A1',
    name: 'Coast Express',
    regionId: 'azure',
    kind: 'express',
    color: '#62d9d0',
    lengthKm: 31.5,
    stationCount: 8,
    seed: 8819,
    unlockCost: 0,
    levelReq: 1,
    maxSpeedKph: 200,
    fareMultiplier: 1.9,
    startHour: 15.8,
    blurb: 'The flagship coastal run. Sea views, 200 km/h and a very expensive cup of coffee.',
  },
];

export const TRAINS: TrainDef[] = [
  {
    id: 'cityrunner',
    name: 'CT-200 Cityrunner',
    maker: 'Harbour Works',
    cars: 4,
    carLength: 18.6,
    massPerCar: 38,
    powerKW: 1480,
    maxSpeedKph: 100,
    maxTEkN: 190,
    brakeDecel: 1.18,
    comfort: 2,
    price: 0,
    levelReq: 1,
    traction: 'electric',
    bodyColor: 0xe8ecef,
    accentColor: 0x1f6fd0,
    roofColor: 0x9aa4ad,
    blurb: 'The dependable workhorse of the metro. Quick off the mark, cheap to keep.',
    energyCost: 1,
  },
  {
    id: 'metropolitan',
    name: 'CT-400 Metropolitan',
    maker: 'Harbour Works',
    cars: 6,
    carLength: 19.4,
    massPerCar: 39,
    powerKW: 2900,
    maxSpeedKph: 120,
    maxTEkN: 310,
    brakeDecel: 1.25,
    comfort: 3,
    price: 14000,
    levelReq: 3,
    traction: 'electric',
    bodyColor: 0xf1f4f6,
    accentColor: 0x0f9c8a,
    roofColor: 0x8c979f,
    blurb: 'Six cars, wide gangways and regenerative braking. Built for busy trunk routes.',
    energyCost: 1.1,
  },
  {
    id: 'lrv',
    name: 'LRV-1 Riverside',
    maker: 'Old Town Carriage Co.',
    cars: 3,
    carLength: 15.2,
    massPerCar: 22,
    powerKW: 720,
    maxSpeedKph: 80,
    maxTEkN: 96,
    brakeDecel: 1.5,
    comfort: 2,
    price: 6200,
    levelReq: 2,
    traction: 'electric',
    bodyColor: 0xf3e6cd,
    accentColor: 0xd9822b,
    roofColor: 0x8a7f72,
    blurb: 'Light, nimble and very quick on the brakes. Perfect for street-level stops.',
    energyCost: 0.8,
  },
  {
    id: 'vectis',
    name: 'Vectis 350 EMU',
    maker: 'Vectis Rail Systems',
    cars: 5,
    carLength: 21.8,
    massPerCar: 41,
    powerKW: 3900,
    maxSpeedKph: 160,
    maxTEkN: 260,
    brakeDecel: 1.1,
    comfort: 4,
    price: 38000,
    levelReq: 6,
    traction: 'electric',
    bodyColor: 0xf6f7f8,
    accentColor: 0xbd2f4a,
    roofColor: 0x7d8790,
    blurb: 'Intercity comfort with metro punctuality. Air suspension keeps the coffee in the cup.',
    energyCost: 1.25,
  },
  {
    id: 'ironhorse',
    name: 'DH-40 Ironhorse',
    maker: 'Copper Ridge Engine Works',
    cars: 3,
    carLength: 20.4,
    massPerCar: 60,
    powerKW: 2600,
    maxSpeedKph: 130,
    maxTEkN: 380,
    brakeDecel: 1.02,
    comfort: 2,
    price: 47000,
    levelReq: 8,
    traction: 'diesel',
    bodyColor: 0xc9d0c4,
    accentColor: 0x8a5a2b,
    roofColor: 0x5f665f,
    blurb: 'A diesel bruiser with mountains of low-end torque. Built for grades and bad weather.',
    energyCost: 1.5,
  },
  {
    id: 'aster',
    name: 'Aster 400',
    maker: 'Azure Dynamics',
    cars: 8,
    carLength: 24.6,
    massPerCar: 50,
    powerKW: 9800,
    maxSpeedKph: 330,
    maxTEkN: 480,
    brakeDecel: 1.05,
    comfort: 5,
    price: 118000,
    levelReq: 12,
    traction: 'electric',
    bodyColor: 0xf7f8f9,
    accentColor: 0x0d7fb8,
    roofColor: 0x9ba6ae,
    blurb: 'The flagship. 330 km/h, whisper-quiet motors and a cab like an airliner.',
    energyCost: 1.7,
  },
];

export const UPGRADES: UpgradeDef[] = [
  { id: 'traction', name: 'Traction Software', desc: 'Sharper inverter control. +6% tractive effort per level.', maxLevel: 5, baseCost: 1200, costScale: 1.75, icon: '⚡' },
  { id: 'brakes', name: 'Brake Package', desc: 'Higher-rate friction brakes and better blending. +7% braking per level.', maxLevel: 5, baseCost: 1400, costScale: 1.8, icon: '◎' },
  { id: 'suspension', name: 'Air Suspension', desc: 'Smoother ride quality. Passengers pay more when they are comfortable.', maxLevel: 5, baseCost: 1100, costScale: 1.7, icon: '⌁' },
  { id: 'hvac', name: 'Climate Control', desc: 'Better HVAC and ambience. +4% fare satisfaction per level.', maxLevel: 5, baseCost: 900, costScale: 1.6, icon: '❄' },
  { id: 'trainer', name: 'Cab Telemetry', desc: 'Predictive braking guidance and earlier limit warnings.', maxLevel: 3, baseCost: 2600, costScale: 2.1, icon: '▤' },
];

export const KIND_LABEL: Record<LineKind, string> = {
  metro: 'Metro',
  lightrail: 'Light Rail',
  regional: 'Regional',
  express: 'High-Speed',
  freight: 'Heavy Rail',
};

export function getRegion(id: string): RegionDef {
  return REGIONS.find((r) => r.id === id) ?? REGIONS[0];
}

export function getLine(id: string): LineDef | undefined {
  return ALL_LINE_CACHE.get(id);
}

export function getTrain(id: string): TrainDef {
  return TRAINS.find((t) => t.id === id) ?? TRAINS[0];
}

export function getUpgrade(id: string): UpgradeDef | undefined {
  return UPGRADES.find((u) => u.id === id);
}

const ENDLESS_SUFFIXES = [
  'Extension', 'Relief Line', 'Outer Loop', 'Airport Link', 'Riverside Branch',
  'Orbital', 'Parkway Link', 'Eastern Spur', 'Western Relief', 'Cross-Link',
  'Coastal Link', 'Freight Spur', 'Park & Ride', 'Metro West', 'Broadway Link',
  'Siding Line', 'Terminal Link',
];

const EXTRA_STATIONS = [
  'Parkway', 'Interchange', 'Depot Road', 'New Town', 'Junction',
  'Crossing', 'Fields', 'Wharf', 'Summit', 'Meadow', 'The Yards', 'Hillcrest',
];

/** Deterministic, effectively endless generated line for a region. */
export function endlessLine(region: RegionDef, index: number): LineDef {
  const seed = (hashString(region.id) ^ ((index + 1) * 2654435761)) >>> 0;
  const rng = new Rng(seed);
  const kind = region.kind;
  const baseLen = region.theme === 'urban' ? 6.5 : region.theme === 'mountain' ? 14 : region.theme === 'coast' ? 18 : 10;
  const lengthKm = Math.round((baseLen + index * 1.4 + rng.range(-1.2, 2.4)) * 10) / 10;
  const stationCount = Math.min(16, 6 + Math.floor(lengthKm / (region.theme === 'urban' ? 1.15 : 2.4)));
  const codes: Record<string, string> = { harbour: 'M', verdant: 'V', oldtown: 'L', copper: 'C', azure: 'A' };
  const prefix = codes[region.id] ?? 'X';
  const number = 4 + index;
  const kindName = region.theme === 'mountain' ? 'Mountain' : region.theme === 'coast' ? 'Coast' : region.theme === 'oldtown' ? 'City' : 'Metro';
  const name = `${ENDLESS_SUFFIXES[index % ENDLESS_SUFFIXES.length]} ${number > 8 ? 'II' : ''}`.trim();
  const colorHue = (hashString(region.id) + index * 71) % 360;
  const color = `hsl(${colorHue}, 72%, 62%)`;
  return {
    id: `${region.id}-x${index + 1}`,
    code: `${prefix}${number}`,
    name: `${name} · ${kindName}`,
    regionId: region.id,
    kind,
    color,
    lengthKm,
    stationCount,
    seed: seed >>> 0,
    unlockCost: Math.round((1800 + index * 2400) * (1 + REGIONS.findIndex((r) => r.id === region.id) * 0.45)),
    levelReq: region.levelReq + 2 + index * 2,
    maxSpeedKph: region.maxSpeedKph,
    fareMultiplier: Math.round((1.1 + index * 0.12) * 100) / 100,
    startHour: 5.5 + ((index * 3.3) % 17),
    blurb: `A newly commissioned ${kindName.toLowerCase()} service beyond the original survey. Unpredictable, busy and very profitable.`,
    generated: true,
    endlessIndex: index,
  };
}

function stationNamesFor(line: LineDef, region: RegionDef): string[] {
  const rng = new Rng(line.seed ^ 0x5f3759df);
  const pool = region.stationNames.slice();
  const names = rng.shuffle(pool);
  const out: string[] = [];
  for (let i = 0; i < line.stationCount; i++) {
    if (i < names.length) out.push(names[i]);
    else out.push(`${rng.pick(EXTRA_STATIONS)} ${Math.floor(i / names.length) + 1}`);
  }
  return out;
}

const ALL_LINE_CACHE = new Map<string, LineDef>();
for (const l of LINES) ALL_LINE_CACHE.set(l.id, l);
const ENDLESS_CACHE = new Map<string, LineDef>();

export function allEndlessLines(region: RegionDef, count = 12): LineDef[] {
  const out: LineDef[] = [];
  for (let i = 0; i < count; i++) {
    const key = `${region.id}-x${i + 1}`;
    let l = ENDLESS_CACHE.get(key);
    if (!l) {
      l = endlessLine(region, i);
      ENDLESS_CACHE.set(key, l);
      ALL_LINE_CACHE.set(l.id, l);
    }
    out.push(l);
  }
  return out;
}

/** Every line in a region, including generated ones. */
export function regionLines(regionId: string): LineDef[] {
  const region = getRegion(regionId);
  const base = LINES.filter((l) => l.regionId === regionId);
  return [...base, ...allEndlessLines(region, 8)];
}

export function lineStations(line: LineDef, region: RegionDef): string[] {
  return stationNamesFor(line, region);
}

export { stationNamesFor };
