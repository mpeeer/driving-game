import type { Economy, ServiceResult } from '../systems/economy';

export type ScreenName = 'menu' | 'dispatch' | 'depot' | 'driving' | 'paused' | 'summary' | 'controls';
export type DepotTab = 'lines' | 'trains' | 'upgrades';
export type Tone = 'good' | 'bad' | 'info';

/** The single translation point between game-facing tones and Sonner's API. */
export const TOAST_KIND = {
  good: 'success',
  bad: 'error',
  info: 'info',
} as const satisfies Record<Tone, string>;

export type ToastKind = (typeof TOAST_KIND)[Tone];

export interface HudCallbacks {
  onPlay: () => void;
  onDepot: () => void;
  onMenu: () => void;
  onControls: () => void;
  onCloseControls: () => void;
  onReset: () => void;
  onStartService: (lineId: string) => void;
  onUnlockLine: (lineId: string) => void;
  onUnlockRegion: (regionId: string) => void;
  onSelectTrain: (trainId: string) => void;
  onBuyTrain: (trainId: string) => void;
  onBuyUpgrade: (upgradeId: string) => void;
  onDepotTab: (tab: DepotTab) => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onCamera: () => void;
  onDoors: () => void;
  onLights: () => void;
  onEmergency: () => void;
  onHorn: (down: boolean) => void;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onAnnouncements: (on: boolean) => void;
  onQuality: (q: 'high' | 'medium' | 'low') => void;
  onHints: (on: boolean) => void;
  onReverse: () => void;
}

export interface SessionInfo {
  lineCode: string;
  lineName: string;
  lineColor: string;
  stations: string[];
  capacity: number;
  destination: string;
  serviceNumber: string;
  startClock: number;
  stationS: number[];
  stopS: number[];
}

export interface RouteItemState {
  name: string;
  state: 'passed' | 'current' | 'next' | 'upcoming';
}

export interface HudState {
  clock: number;
  delaySec: number;
  money: number;
  level: number;
  xpFraction: number;
  speedKph: number;
  maxSpeedKph: number;
  limit: number;
  advisory: number;
  nextRestriction: { s: number; limit: number } | null;
  nextRestrictionDist: number;
  powerNotch: number;
  brakeNotch: number;
  throttle: number;
  brake: number;
  doorsOpen: boolean;
  doorsMoving: boolean;
  doorAligned: boolean;
  emergency: boolean;
  headlights: number;
  stationName: string;
  nextStationName: string;
  nextStationScheduled: number;
  distanceToNext: number;
  passengers: number;
  capacity: number;
  waiting: number;
  stopHint: string;
  stopAccuracy: number | null;
  viewMode: string;
  overspeed: boolean;
  slip: boolean;
  wet: number;
  route: RouteItemState[];
  progress: number;
  hint: string;
  boarding: boolean;
  serviceComplete: boolean;
  signal: 'clear' | 'caution';
}

export interface SummaryView {
  result: ServiceResult;
  lineColor: string;
}

export interface StopToastView {
  id: number;
  message: string;
  tone: Tone;
}

export interface UiState {
  screen: ScreenName;
  selectedRegion: string;
  selectedLineId: string;
  depotTab: DepotTab;
  session: SessionInfo | null;
  hud: HudState | null;
  summary: SummaryView | null;
  revision: number;
  settingsRevision: number;
  loading: boolean;
  stopToast: StopToastView | null;
}

export interface UiActions {
  selectRegion: (regionId: string) => void;
  selectLine: (lineId: string) => void;
  setDepotTab: (tab: DepotTab) => void;
}

export interface UiEngine {
  economy: Economy;
  callbacks: HudCallbacks;
  actions: UiActions;
}
