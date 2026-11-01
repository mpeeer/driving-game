import { TRAINS, allEndlessLines, getLine, getRegion } from '../../content/data';
import type { LineDef, RegionDef, TrainDef } from '../../content/data';
import type { Economy } from '../../systems/economy';

export interface RegionAccess {
  region: RegionDef;
  owned: boolean;
  levelOk: boolean;
  affordable: boolean;
  canUnlock: boolean;
  reason: string;
}

export interface LineAccess {
  line: LineDef;
  region: RegionDef;
  regionOwned: boolean;
  owned: boolean;
  levelOk: boolean;
  affordable: boolean;
  canUnlock: boolean;
  reason: string;
}

export function visibleLinesForRegion(regionId: string, economy: Economy): LineDef[] {
  const region = getRegion(regionId);
  const base = economy.linesForRegion(regionId);
  const generated = allEndlessLines(region, 14).filter(
    (line) => line.levelReq <= economy.level + 3 && !base.some((entry) => entry.id === line.id),
  );
  return [...base, ...generated];
}

export function resolveLineSelection(regionId: string, requestedId: string, economy: Economy): string {
  const lines = visibleLinesForRegion(regionId, economy);
  if (lines.some((line) => line.id === requestedId)) return requestedId;
  const firstOwned = lines.find((line) => economy.isLineUnlocked(line));
  return (firstOwned ?? lines[0])?.id ?? requestedId;
}

export function regionAccess(regionId: string, economy: Economy): RegionAccess {
  const region = getRegion(regionId);
  const owned = economy.isRegionUnlocked(region.id);
  const levelOk = economy.level >= region.levelReq;
  const affordable = economy.money >= region.unlockCost;
  const reason = owned
    ? 'Network access owned'
    : !levelOk
      ? `Requires level ${region.levelReq}`
      : !affordable
        ? `Requires ${region.unlockCost.toLocaleString('en-IE')} credits`
        : 'Available to unlock';
  return { region, owned, levelOk, affordable, canUnlock: !owned && levelOk && affordable, reason };
}

export function lineAccess(line: LineDef, economy: Economy): LineAccess {
  const region = getRegion(line.regionId);
  const regionOwned = economy.isRegionUnlocked(region.id);
  const owned = economy.isLineUnlocked(line);
  const levelOk = economy.level >= line.levelReq;
  const affordable = economy.money >= line.unlockCost;
  const reason = owned
    ? 'Route rights owned'
    : !regionOwned
      ? `Unlock ${region.name} first`
      : !levelOk
        ? `Requires level ${line.levelReq}`
        : !affordable
          ? `Requires ${line.unlockCost.toLocaleString('en-IE')} credits`
          : 'Available to unlock';
  return {
    line,
    region,
    regionOwned,
    owned,
    levelOk,
    affordable,
    canUnlock: !owned && regionOwned && levelOk && affordable,
    reason,
  };
}

export function ownedTrains(economy: Economy): TrainDef[] {
  return TRAINS.filter((train) => economy.ownsTrain(train.id));
}

export function menuLine(economy: Economy): LineDef {
  return getLine(economy.data.lastLine) ?? getLine('hbr-m1')!;
}
