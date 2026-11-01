import { LINES, REGIONS, TRAINS, UPGRADES, getLine, getRegion, getTrain, getUpgrade, LineDef } from '../content/data';
import { clamp } from '../core/util';

export interface SaveSettings {
  volume: number;
  mute: boolean;
  announcements: boolean;
  quality: 'high' | 'medium' | 'low';
  showHints: boolean;
}

export interface SaveData {
  version: number;
  money: number;
  xp: number;
  ownedTrains: string[];
  activeTrain: string;
  unlockedRegions: string[];
  unlockedLines: string[];
  upgrades: Record<string, number>;
  settings: SaveSettings;
  lastLine: string;
  totalRuns: number;
  totalPassengers: number;
  totalKm: number;
  tutorialSeen: boolean;
  createdAt: number;
}

export interface ServiceResult {
  lineId: string;
  lineName: string;
  lineCode: string;
  trainName: string;
  fares: number;
  punctualityBonus: number;
  accuracyBonus: number;
  penalties: number;
  energyCost: number;
  maintenance: number;
  crewCost: number;
  net: number;
  xp: number;
  passengers: number;
  passengerKm: number;
  stops: number;
  perfectStops: number;
  onTimeStops: number;
  delaySeconds: number;
  distanceKm: number;
  overspeedEvents: number;
  harshBrakes: number;
  satisfaction: number;
  durationSeconds: number;
  levelsGained: number;
  newLevel: number;
}

const SAVE_KEY = 'railbound.save.v1';

function defaultSave(): SaveData {
  return {
    version: 1,
    money: 1600,
    xp: 0,
    ownedTrains: ['cityrunner'],
    activeTrain: 'cityrunner',
    unlockedRegions: ['harbour'],
    unlockedLines: ['hbr-m1'],
    upgrades: {},
    settings: { volume: 0.75, mute: false, announcements: true, quality: 'high', showHints: true },
    lastLine: 'hbr-m1',
    totalRuns: 0,
    totalPassengers: 0,
    totalKm: 0,
    tutorialSeen: false,
    createdAt: Date.now(),
  };
}

export function xpForLevel(level: number): number {
  return Math.round(900 * Math.pow(Math.max(0, level - 1), 1.55));
}

export class Economy {
  data: SaveData;

  constructor() {
    this.data = this.load();
  }

  private load(): SaveData {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultSave();
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      const base = defaultSave();
      return {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings ?? {}) },
        upgrades: { ...(parsed.upgrades ?? {}) },
        ownedTrains: parsed.ownedTrains?.length ? parsed.ownedTrains : base.ownedTrains,
        unlockedRegions: parsed.unlockedRegions?.length ? parsed.unlockedRegions : base.unlockedRegions,
        unlockedLines: parsed.unlockedLines?.length ? parsed.unlockedLines : base.unlockedLines,
      };
    } catch {
      return defaultSave();
    }
  }

  save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable */
    }
  }

  reset(): void {
    this.data = defaultSave();
    this.save();
  }

  get money(): number {
    return this.data.money;
  }

  addMoney(v: number): void {
    this.data.money = Math.max(0, this.data.money + v);
    this.save();
  }

  get xp(): number {
    return this.data.xp;
  }

  get level(): number {
    let level = 1;
    while (this.data.xp >= xpForLevel(level + 1) && level < 99) level++;
    return level;
  }

  get levelProgress(): { current: number; next: number; fraction: number } {
    const lvl = this.level;
    const start = xpForLevel(lvl);
    const next = xpForLevel(lvl + 1);
    return { current: this.data.xp - start, next: next - start, fraction: clamp((this.data.xp - start) / Math.max(1, next - start), 0, 1) };
  }

  addXp(amount: number): number {
    const before = this.level;
    this.data.xp = Math.max(0, this.data.xp + Math.max(0, amount));
    const after = this.level;
    this.save();
    return after - before;
  }

  get settings(): SaveSettings {
    return this.data.settings;
  }

  updateSettings(patch: Partial<SaveSettings>): void {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
  }

  isRegionUnlocked(regionId: string): boolean {
    return this.data.unlockedRegions.includes(regionId);
  }

  regionUnlockRequirement(regionId: string): { cost: number; level: number } {
    const r = getRegion(regionId);
    return { cost: r.unlockCost, level: r.levelReq };
  }

  canUnlockRegion(regionId: string): boolean {
    const r = getRegion(regionId);
    return !this.isRegionUnlocked(regionId) && this.money >= r.unlockCost && this.level >= r.levelReq;
  }

  unlockRegion(regionId: string): boolean {
    if (!this.canUnlockRegion(regionId)) return false;
    const r = getRegion(regionId);
    this.data.money -= r.unlockCost;
    this.data.unlockedRegions.push(regionId);
    const firstLine = LINES.find((l) => l.regionId === regionId && l.unlockCost === 0);
    if (firstLine && !this.data.unlockedLines.includes(firstLine.id)) this.data.unlockedLines.push(firstLine.id);
    this.save();
    return true;
  }

  isLineUnlocked(line: LineDef): boolean {
    if (!this.isRegionUnlocked(line.regionId)) return false;
    if (line.unlockCost === 0) return true;
    return this.data.unlockedLines.includes(line.id);
  }

  canUnlockLine(line: LineDef): { ok: boolean; reason: string } {
    if (this.isLineUnlocked(line)) return { ok: false, reason: 'Owned' };
    if (!this.isRegionUnlocked(line.regionId)) return { ok: false, reason: 'Region locked' };
    if (this.level < line.levelReq) return { ok: false, reason: `Requires level ${line.levelReq}` };
    if (this.money < line.unlockCost) return { ok: false, reason: 'Not enough money' };
    return { ok: true, reason: '' };
  }

  unlockLine(lineId: string): boolean {
    const line = getLine(lineId);
    if (!line) return false;
    const check = this.canUnlockLine(line);
    if (!check.ok) return false;
    this.data.money -= line.unlockCost;
    this.data.unlockedLines.push(lineId);
    this.save();
    return true;
  }

  ownsTrain(id: string): boolean {
    return this.data.ownedTrains.includes(id);
  }

  get activeTrainId(): string {
    return this.data.activeTrain;
  }

  setActiveTrain(id: string): void {
    if (this.ownsTrain(id)) {
      this.data.activeTrain = id;
      this.save();
    }
  }

  canBuyTrain(id: string): { ok: boolean; reason: string } {
    const train = getTrain(id);
    if (this.ownsTrain(id)) return { ok: false, reason: 'Owned' };
    if (this.level < train.levelReq) return { ok: false, reason: `Requires level ${train.levelReq}` };
    if (this.money < train.price) return { ok: false, reason: 'Not enough money' };
    return { ok: true, reason: '' };
  }

  buyTrain(id: string): boolean {
    const check = this.canBuyTrain(id);
    if (!check.ok) return false;
    const train = getTrain(id);
    this.data.money -= train.price;
    this.data.ownedTrains.push(id);
    this.data.activeTrain = id;
    this.save();
    return true;
  }

  upgradeLevel(id: string): number {
    return this.data.upgrades[id] ?? 0;
  }

  upgradeCost(id: string): number {
    const def = getUpgrade(id);
    if (!def) return 0;
    const lvl = this.upgradeLevel(id);
    return Math.round(def.baseCost * Math.pow(def.costScale, lvl));
  }

  canBuyUpgrade(id: string): { ok: boolean; reason: string } {
    const def = getUpgrade(id);
    if (!def) return { ok: false, reason: 'Unknown' };
    const lvl = this.upgradeLevel(id);
    if (lvl >= def.maxLevel) return { ok: false, reason: 'Max level' };
    if (this.money < this.upgradeCost(id)) return { ok: false, reason: 'Not enough money' };
    return { ok: true, reason: '' };
  }

  buyUpgrade(id: string): boolean {
    const check = this.canBuyUpgrade(id);
    if (!check.ok) return false;
    this.data.money -= this.upgradeCost(id);
    this.data.upgrades[id] = this.upgradeLevel(id) + 1;
    this.save();
    return true;
  }

  modifiers(): { traction: number; brakes: number; comfort: number; fareBonus: number; trainer: number } {
    return {
      traction: 1 + 0.06 * this.upgradeLevel('traction'),
      brakes: 1 + 0.07 * this.upgradeLevel('brakes'),
      comfort: this.upgradeLevel('suspension'),
      fareBonus: 1 + 0.04 * this.upgradeLevel('hvac') + 0.02 * this.upgradeLevel('suspension'),
      trainer: this.upgradeLevel('trainer'),
    };
  }

  completeService(result: Omit<ServiceResult, 'newLevel' | 'levelsGained'>): ServiceResult {
    this.data.money = Math.max(0, this.data.money + result.net);
    const beforeLevel = this.level;
    this.data.xp += Math.max(0, Math.round(result.xp));
    const afterLevel = this.level;
    this.data.totalRuns += 1;
    this.data.totalPassengers += result.passengers;
    this.data.totalKm += result.distanceKm;
    this.data.lastLine = result.lineId;
    this.save();
    return { ...result, newLevel: afterLevel, levelsGained: Math.max(0, afterLevel - beforeLevel) };
  }

  linesForRegion(regionId: string): LineDef[] {
    return [...LINES.filter((l) => l.regionId === regionId)];
  }

  allRegions(): typeof REGIONS {
    return REGIONS;
  }

  allTrains(): typeof TRAINS {
    return TRAINS;
  }

  allUpgrades(): typeof UPGRADES {
    return UPGRADES;
  }
}
