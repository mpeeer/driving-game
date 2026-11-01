import type { Quality, Units, UpgradeId } from './types';

/** Surface the React overlay uses to drive the game. */
export interface GameApi {
  play(): void;
  pause(): void;
  resume(): void;
  toMenu(): void;
  restartRun(): void;
  openGarage(from: 'menu' | 'paused'): void;
  closeGarage(): void;
  buyUpgrade(id: UpgradeId): void;
  setUnits(units: Units): void;
  toggleMute(): void;
  setQuality(quality: Quality): void;
  setShake(on: boolean): void;
}
