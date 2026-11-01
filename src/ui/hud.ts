import { Economy, ServiceResult } from '../systems/economy';
import {
  KIND_LABEL, LineDef, REGIONS, RegionDef, TRAINS, UPGRADES,
  allEndlessLines, getLine, getRegion, getTrain,
} from '../content/data';
import { buildTrackPlan } from '../world/trackPlan';
import { clamp, formatClock, formatHM, money } from '../core/util';

export type ScreenName = 'menu' | 'dispatch' | 'depot' | 'driving' | 'paused' | 'summary' | 'controls';
export type DepotTab = 'lines' | 'trains' | 'upgrades';

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

const KEYS = [
  ['W / ↑', 'Increase power'],
  ['S / ↓', 'Increase brake'],
  ['Z', 'Throttle to coast'],
  ['X', 'Release brake'],
  ['E', 'Emergency brake'],
  ['D', 'Open / close doors'],
  ['SPACE', 'Horn'],
  ['H', 'Headlights'],
  ['F', 'Wipers'],
  ['R', 'Change reverser'],
  ['C', 'Camera view'],
  ['Mouse drag', 'Look around'],
  ['Wheel', 'Zoom camera'],
  ['ESC', 'Pause'],
];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

export class Hud {
  root: HTMLElement;
  economy: Economy;
  cb: HudCallbacks;
  selectedRegion = 'harbour';
  selectedLineId = 'hbr-m1';
  depotTab: DepotTab = 'lines';
  private screens: Record<string, HTMLElement> = {};
  private hudEl!: HTMLElement;
  private cache = new Map<string, string>();
  private routeEls: HTMLElement[] = [];
  private routeSignature = '';
  private toastTimer = 0;
  private mapCache = new Map<string, { points: { x: number; z: number }[]; stations: { x: number; z: number; name: string }[]; length: number }>();

  constructor(root: HTMLElement, economy: Economy, cb: HudCallbacks) {
    this.root = root;
    this.economy = economy;
    this.cb = cb;
    this.build();
    this.selectedLineId = economy.data.lastLine || 'hbr-m1';
    const line = getLine(this.selectedLineId);
    if (line) this.selectedRegion = line.regionId;
  }

  private build(): void {
    this.root.innerHTML = `
      <div class="hud hidden" id="hud">
        <div class="hud-top">
          <div class="hud-brandline">
            <span class="line-pill" id="hud-line-pill">M1</span>
            <div>
              <div class="hud-service" id="hud-line-name">Harbour Loop</div>
              <div class="hud-sub" id="hud-service-code">SERVICE 214</div>
            </div>
          </div>
          <div class="hud-clockbox">
            <div class="hud-clock" id="hud-clock">06:36:00</div>
            <div class="hud-delay" id="hud-delay">ON TIME</div>
          </div>
          <div class="hud-wallet">
            <div class="hud-money" id="hud-money">€1,600</div>
            <div class="hud-xpbar"><div id="hud-xp"></div></div>
            <div class="hud-level" id="hud-level">LV 1</div>
          </div>
          <button class="icon-btn" data-action="pause" title="Pause (Esc)">❚❚</button>
        </div>

        <aside class="panel route-panel">
          <div class="panel-head"><span>ROUTE</span><span class="panel-hint" id="route-progress">0%</span></div>
          <div class="route-strip" id="route-strip"></div>
        </aside>

        <div class="hud-right">
          <div class="panel next-panel">
            <div class="panel-head"><span>NEXT STOP</span><span class="panel-hint" id="next-kind">METRO</span></div>
            <div class="next-name" id="next-name">—</div>
            <div class="next-row"><span id="next-distance">—</span><span id="next-sched">—</span></div>
            <div class="stop-progress"><div id="stop-fill"></div><div class="stop-dot"></div></div>
            <div class="next-hint" id="next-hint">—</div>
          </div>
          <div class="panel limit-panel">
            <div class="limit-main"><span class="panel-head">LIMIT</span><span class="limit-big" id="limit-big">80</span></div>
            <div class="limit-advisory" id="limit-advisory">ADVISORY 80</div>
            <div class="limit-next" id="limit-next">Clear line</div>
          </div>
          <div class="panel load-panel">
            <div class="panel-head"><span>PASSENGERS</span><span class="panel-hint" id="load-pct">0%</span></div>
            <div class="load-big"><span id="load-count">0</span><span id="load-cap">/ 480</span></div>
            <div class="load-bar"><div id="load-fill"></div></div>
            <div class="load-sub" id="load-sub">Awaiting departure</div>
          </div>
        </div>

        <div class="dash">
          <div class="dash-gauge">
            <svg viewBox="0 0 240 132" class="gauge">
              <path class="gauge-track" d="M 28 116 A 92 92 0 0 1 212 116" />
              <path class="gauge-progress" id="gauge-progress" d="M 28 116 A 92 92 0 0 1 212 116" />
              <g id="gauge-ticks"></g>
              <line id="gauge-limit-mark" x1="120" y1="14" x2="120" y2="26" />
            </svg>
            <div class="gauge-readout">
              <span class="gauge-speed" id="speed-value">0</span>
              <span class="gauge-unit">KM/H</span>
            </div>
            <div class="gauge-mode" id="gauge-mode">CAB VIEW</div>
          </div>
          <div class="dash-notches">
            <div class="notch-row"><span class="notch-title">POWER</span><div class="notch-pips" id="power-pips"></div><span class="notch-num" id="power-num">0</span></div>
            <div class="notch-row"><span class="notch-title">BRAKE</span><div class="notch-pips brake" id="brake-pips"></div><span class="notch-num" id="brake-num">0</span></div>
            <div class="dash-flags">
              <span class="flag" id="flag-doors">DOORS</span>
              <span class="flag" id="flag-emergency">EMERG</span>
              <span class="flag" id="flag-slip">SLIP</span>
              <span class="flag" id="flag-lights">LIGHTS</span>
            </div>
          </div>
        </div>

        <div class="actionbar">
          <button class="action" data-action="doors"><b>D</b><span id="doors-label">DOORS</span></button>
          <button class="action" data-action="horn" data-hold="horn"><b>SPACE</b><span>HORN</span></button>
          <button class="action" data-action="lights"><b>H</b><span>LIGHTS</span></button>
          <button class="action" data-action="camera"><b>C</b><span>VIEW</span></button>
          <button class="action warn" data-action="emergency"><b>E</b><span>EMERGENCY</span></button>
        </div>
        <div class="hintbar" id="hintbar">W increase power · S increase brake · D doors · SPACE horn · C camera · ESC pause</div>
        <div class="stop-toast" id="stop-toast"></div>
      </div>

      <section class="screen menu" id="screen-menu">
        <div class="menu-scrim"></div>
        <div class="menu-wrap">
          <div class="brand">
            <svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
              <path d="M14 58 L27 6" stroke="currentColor" stroke-width="4" fill="none"/>
              <path d="M50 58 L37 6" stroke="currentColor" stroke-width="4" fill="none"/>
              <path d="M20 47 H44 M23.5 33 H40.5 M27 19 H37" stroke="currentColor" stroke-width="3"/>
            </svg>
            <div>
              <h1>RAILBOUND</h1>
              <p>Transit Simulator</p>
            </div>
          </div>
          <p class="tagline">Drive the 06:36 out of Central Quay. Then build the network that comes after.</p>
          <div class="career-card" id="menu-career"></div>
          <div class="menu-actions">
            <button class="btn primary" data-action="play">Enter dispatch <span>→</span></button>
            <button class="btn" data-action="depot">Depot</button>
            <button class="btn" data-action="controls">Controls</button>
          </div>
          <div class="menu-meta">
            <span>Procedural railway</span><span>·</span><span>Passenger AI</span><span>·</span><span>Synthesised audio</span><span>·</span><span>Endless lines</span>
          </div>
          <button class="reset-link" data-action="reset">reset career data</button>
        </div>
        <div class="menu-side">
          <div class="menu-tip" id="menu-tip"></div>
        </div>
      </section>

      <section class="screen sheet hidden" id="screen-dispatch">
        <header class="sheet-head">
          <button class="icon-btn" data-action="menu">←</button>
          <div class="sheet-title"><h2>Service Dispatch</h2><p>Pick a line and a train. The timetable is waiting.</p></div>
          <div class="sheet-wallet" id="dispatch-wallet"></div>
        </header>
        <div class="region-tabs" id="region-tabs"></div>
        <div class="dispatch-body">
          <div class="line-list" id="line-list"></div>
          <aside class="dispatch-detail" id="dispatch-detail"></aside>
        </div>
        <footer class="sheet-foot">
          <div class="train-picker" id="train-picker"></div>
          <button class="btn primary big" id="start-btn" data-action="start">Start service →</button>
        </footer>
      </section>

      <section class="screen sheet hidden" id="screen-depot">
        <header class="sheet-head">
          <button class="icon-btn" data-action="menu">←</button>
          <div class="sheet-title"><h2>Depot</h2><p>Rolling stock, route rights and upgrades.</p></div>
          <div class="sheet-wallet" id="depot-wallet"></div>
        </header>
        <div class="region-tabs depot-tabs" id="depot-tabs"></div>
        <div class="depot-body" id="depot-body"></div>
      </section>

      <section class="modal-wrap hidden" id="screen-controls">
        <div class="modal">
          <button class="modal-x" data-action="close-controls">×</button>
          <h3>Driver controls</h3>
          <div class="keys">${KEYS.map(([k, v]) => `<div class="key-row"><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div>
          <p class="modal-note">Tip: real train driving is about planning. Start braking early, and aim for the stop board at the middle of the platform.</p>
        </div>
      </section>

      <section class="modal-wrap hidden" id="screen-pause">
        <div class="modal">
          <h3>Service paused</h3>
          <p class="modal-sub" id="pause-sub">The clock stops while you catch your breath.</p>
          <div class="modal-actions">
            <button class="btn primary" data-action="resume">Resume</button>
            <button class="btn" data-action="restart">Restart run</button>
            <button class="btn ghost" data-action="quit">Leave to dispatch</button>
          </div>
          <div class="settings" id="pause-settings"></div>
        </div>
      </section>

      <section class="modal-wrap hidden" id="screen-summary">
        <div class="modal wide" id="summary-modal"></div>
      </section>

      <div class="toasts" id="toasts"></div>
      <div class="hidden" id="loading">
        <div class="loading-inner"><div class="spinner"></div><p>Surveying the line…</p></div>
      </div>
    `;

    for (const key of ['menu', 'dispatch', 'depot', 'controls', 'pause', 'summary']) {
      this.screens[key] = document.getElementById(`screen-${key}`) as HTMLElement;
    }
    this.hudEl = document.getElementById('hud') as HTMLElement;
    this.buildGauge();
    this.bindEvents();
  }

  private buildGauge(): void {
    const ticks = document.getElementById('gauge-ticks');
    if (!ticks) return;
    const cx = 120;
    const cy = 116;
    let svg = '';
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI + (i / 10) * Math.PI;
      const r1 = i % 5 === 0 ? 80 : 85;
      const r2 = 91;
      const x1 = cx + Math.cos(a) * r1;
      const y1 = cy + Math.sin(a) * r1;
      const x2 = cx + Math.cos(a) * r2;
      const y2 = cy + Math.sin(a) * r2;
      const major = i % 5 === 0 ? 'major' : '';
      svg += `<line class="tick ${major}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    }
    ticks.innerHTML = svg;
    const pips = document.getElementById('power-pips');
    const bpips = document.getElementById('brake-pips');
    if (pips) pips.innerHTML = Array.from({ length: 4 }, () => '<i></i>').join('');
    if (bpips) bpips.innerHTML = Array.from({ length: 5 }, () => '<i></i>').join('');
  }

  private bindEvents(): void {
    this.root.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!target) return;
      const action = target.getAttribute('data-action');
      if (!action) return;
      switch (action) {
        case 'play': this.cb.onPlay(); break;
        case 'depot': this.cb.onDepot(); break;
        case 'menu': this.cb.onMenu(); break;
        case 'controls': this.cb.onControls(); break;
        case 'close-controls': this.cb.onCloseControls(); break;
        case 'reset':
          if (confirm('Reset all career progress? This cannot be undone.')) this.cb.onReset();
          break;
        case 'start': {
          const line = getLine(this.selectedLineId);
          if (line && this.economy.isLineUnlocked(line)) this.cb.onStartService(this.selectedLineId);
          break;
        }
        case 'select-region': {
          const id = target.getAttribute('data-region');
          if (id) {
            this.selectedRegion = id;
            const lines = this.visibleLinesForRegion(id);
            const owned = lines.filter((l) => this.economy.isLineUnlocked(l));
            this.selectedLineId = (owned[0] ?? lines[0])?.id ?? this.selectedLineId;
            this.renderDispatch();
          }
          break;
        }
        case 'select-line': {
          const id = target.getAttribute('data-line');
          if (id) {
            this.selectedLineId = id;
            this.renderDispatch();
          }
          break;
        }
        case 'unlock-line': {
          const id = target.getAttribute('data-line');
          if (id) this.cb.onUnlockLine(id);
          break;
        }
        case 'unlock-region': {
          const id = target.getAttribute('data-region');
          if (id) this.cb.onUnlockRegion(id);
          break;
        }
        case 'depot-tab': {
          const tab = target.getAttribute('data-tab') as DepotTab | null;
          if (tab) {
            this.depotTab = tab;
            this.cb.onDepotTab(tab);
          }
          break;
        }
        case 'select-train': {
          const id = target.getAttribute('data-train');
          if (id) this.cb.onSelectTrain(id);
          break;
        }
        case 'buy-train': {
          const id = target.getAttribute('data-train');
          if (id) this.cb.onBuyTrain(id);
          break;
        }
        case 'buy-upgrade': {
          const id = target.getAttribute('data-upgrade');
          if (id) this.cb.onBuyUpgrade(id);
          break;
        }
        case 'pause': this.cb.onPause(); break;
        case 'resume': this.cb.onResume(); break;
        case 'restart': this.cb.onRestart(); break;
        case 'quit': this.cb.onQuit(); break;
        case 'dispatch': this.cb.onQuit(); break;
        case 'again': this.cb.onRestart(); break;
        case 'camera': this.cb.onCamera(); break;
        case 'doors': this.cb.onDoors(); break;
        case 'lights': this.cb.onLights(); break;
        case 'emergency': this.cb.onEmergency(); break;
        case 'reverse': this.cb.onReverse(); break;
        case 'toggle-mute': this.cb.onToggleMute(); break;
        default: break;
      }
    });

    this.root.addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest('[data-hold="horn"]');
      if (el) {
        e.preventDefault();
        this.cb.onHorn(true);
      }
    });
    const releaseHorn = () => this.cb.onHorn(false);
    this.root.addEventListener('pointerup', releaseHorn);
    this.root.addEventListener('pointercancel', releaseHorn);
    this.root.addEventListener('pointerleave', releaseHorn);

    this.root.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      if (target.id === 'set-volume') this.cb.onVolume(parseFloat(target.value));
      if (target.id === 'set-announce') this.cb.onAnnouncements(target.checked);
      if (target.id === 'set-hints') this.cb.onHints(target.checked);
      if (target.id === 'set-quality') this.cb.onQuality(target.value as 'high' | 'medium' | 'low');
    });
  }

  showScreen(name: ScreenName): void {
    this.hudEl.classList.add('hidden');
    for (const key of Object.keys(this.screens)) this.screens[key].classList.add('hidden');
    if (name === 'driving' || name === 'paused') {
      this.hudEl.classList.remove('hidden');
      if (name === 'paused') this.screens.pause.classList.remove('hidden');
    } else if (name === 'menu') {
      this.screens.menu.classList.remove('hidden');
    } else if (name === 'dispatch' || name === 'depot' || name === 'summary') {
      this.screens[name].classList.remove('hidden');
    } else if (name === 'controls') {
      this.screens.controls.classList.remove('hidden');
    }
  }

  setLoading(show: boolean): void {
    const el = document.getElementById('loading');
    if (el) el.classList.toggle('hidden', !show);
  }

  renderMenu(): void {
    const eco = this.economy;
    const career = document.getElementById('menu-career');
    if (career) {
      const prog = eco.levelProgress;
      career.innerHTML = `
        <div class="career-stat"><span>BALANCE</span><strong>${money(eco.money)}</strong></div>
        <div class="career-stat"><span>LEVEL ${eco.level}</span><strong>${eco.data.totalRuns} runs</strong></div>
        <div class="career-stat"><span>NETWORK</span><strong>${eco.data.unlockedRegions.length}/${REGIONS.length} regions</strong></div>
        <div class="career-xp"><div style="width:${(prog.fraction * 100).toFixed(1)}%"></div></div>
      `;
    }
    const tips = [
      'Passengers pay more when you arrive on time. They also remember every hard brake.',
      'Every region you unlock opens new generated lines with better fares.',
      'Open the doors only when the train is stopped at a platform and aligned with the stop board.',
      'Regenerative braking recovers energy. Brake gently and early instead of late and hard.',
      'The 5th stop is usually the busiest — expect longer boarding times.',
      'You can reverse the train to correct a missed stop. Passengers will not love it.',
    ];
    const tip = document.getElementById('menu-tip');
    if (tip) {
      const idx = Math.floor(Date.now() / 12000) % tips.length;
      tip.innerHTML = `<span class="tip-label">DISPATCH NOTE</span><p>${tips[idx]}</p>`;
    }
  }

  private visibleLinesForRegion(regionId: string): LineDef[] {
    const region = getRegion(regionId);
    const base = this.economy.linesForRegion(regionId);
    const endless = allEndlessLines(region, 14).filter((l) => l.levelReq <= this.economy.level + 3);
    const generated = endless.filter((l) => !base.some((b) => b.id === l.id));
    return [...base, ...generated];
  }

  renderDispatch(): void {
    const eco = this.economy;
    const wallet = document.getElementById('dispatch-wallet');
    if (wallet) wallet.innerHTML = `<span class="chip money">${money(eco.money)}</span><span class="chip">LV ${eco.level}</span>`;

    const tabs = document.getElementById('region-tabs');
    if (tabs) {
      tabs.innerHTML = REGIONS.map((r) => {
        const owned = eco.isRegionUnlocked(r.id);
        const active = this.selectedRegion === r.id ? ' active' : '';
        return `<button class="region-tab${active}${owned ? '' : ' locked'}" data-action="select-region" data-region="${r.id}">
          <span class="dot" style="background:${r.accent}"></span>
          <span>${esc(r.name)}</span>
          ${owned ? '' : `<span class="lock">${r.levelReq > eco.level ? `L${r.levelReq}` : money(r.unlockCost)}</span>`}
        </button>`;
      }).join('');
    }

    const region = getRegion(this.selectedRegion);
    const lines = this.visibleLinesForRegion(region.id);
    if (!lines.some((l) => l.id === this.selectedLineId)) {
      const owned = lines.filter((l) => eco.isLineUnlocked(l));
      this.selectedLineId = (owned[0] ?? lines[0])?.id ?? this.selectedLineId;
    }
    const selected = getLine(this.selectedLineId) ?? lines[0] ?? null;

    const list = document.getElementById('line-list');
    if (list) {
      const regionUnlocked = eco.isRegionUnlocked(region.id);
      list.innerHTML = `
        <div class="list-head">${esc(region.name)} <span>${KIND_LABEL[region.kind]}</span></div>
        ${lines.map((l) => {
          const owned = eco.isLineUnlocked(l);
          const active = selected?.id === l.id ? ' active' : '';
          const locked = !owned;
          return `<button class="line-card${active}${locked ? ' locked' : ''}" data-action="select-line" data-line="${l.id}">
            <span class="line-badge" style="--c:${l.color}">${l.code}</span>
            <span class="line-card-main">
              <span class="line-card-name">${esc(l.name)}</span>
              <span class="line-card-meta">${l.lengthKm.toFixed(1)} km · ${l.stationCount} stops · ${l.generated ? 'NEW' : KIND_LABEL[l.kind]}</span>
            </span>
            <span class="line-card-status">${owned ? '<b class="ok">READY</b>' : regionUnlocked ? money(l.unlockCost) : 'REGION'}</span>
          </button>`;
        }).join('')}
      `;
    }

    const detail = document.getElementById('dispatch-detail');
    if (detail && selected) {
      const owned = eco.isLineUnlocked(selected);
      const regionOwned = eco.isRegionUnlocked(region.id);
      const mapKey = selected.id;
      let stationNames: string[] = [];
      try {
        const plan = buildTrackPlan(selected, region);
        stationNames = plan.stations.map((s) => s.name);
      } catch {
        stationNames = [];
      }
      const levelOk = eco.level >= selected.levelReq;
      const reasons: string[] = [];
      if (!regionOwned) reasons.push(`Unlock ${region.name} first`);
      if (!levelOk) reasons.push(`Level ${selected.levelReq} required`);
      if (owned) reasons.push('Line unlocked');
      detail.innerHTML = `
        <div class="detail-top">
          <span class="line-badge big" style="--c:${selected.color}">${selected.code}</span>
          <div>
            <h3>${esc(selected.name)}</h3>
            <p>${esc(KIND_LABEL[selected.kind])} · ${selected.lengthKm.toFixed(1)} km · ${selected.stationCount} stations</p>
          </div>
        </div>
        <div class="detail-chips">
          <span class="chip">Fare ×${selected.fareMultiplier.toFixed(2)}</span>
          <span class="chip">Max ${selected.maxSpeedKph} km/h</span>
          <span class="chip">Starts ${formatHM(selected.startHour * 3600)}</span>
          ${selected.generated ? '<span class="chip new">PROCEDURAL</span>' : ''}
        </div>
        <p class="detail-blurb">${esc(selected.blurb)}</p>
        <canvas class="line-map" id="line-map" width="640" height="300"></canvas>
        <div class="station-list">${stationNames.map((n, i) => `<span><i>${String(i + 1).padStart(2, '0')}</i>${esc(n)}</span>`).join('')}</div>
        <div class="detail-foot">
          ${owned
            ? `<span class="ok">✓ Route rights owned</span>`
            : `<span class="muted">${reasons.join(' · ')}</span>`}
          ${!owned && regionOwned
            ? `<button class="btn small" data-action="unlock-line" data-line="${selected.id}" ${(!levelOk || eco.money < selected.unlockCost) ? 'disabled' : ''}>Unlock ${money(selected.unlockCost)}</button>`
            : ''}
          ${!regionOwned
            ? `<button class="btn small" data-action="unlock-region" data-region="${region.id}" ${(eco.level < region.levelReq || eco.money < region.unlockCost) ? 'disabled' : ''}>Unlock region ${money(region.unlockCost)}</button>`
            : ''}
        </div>
        ${regionOwned ? '' : `<p class="detail-warning">${esc(region.blurb)}</p>`}
      `;
      const canvas = document.getElementById('line-map') as HTMLCanvasElement | null;
      if (canvas) this.drawLineMap(canvas, mapKey, selected, region);
    }

    const picker = document.getElementById('train-picker');
    if (picker) {
      const active = eco.activeTrainId;
      picker.innerHTML = `<span class="picker-label">TRAIN</span>` + TRAINS.filter((t) => eco.ownsTrain(t.id)).map((t) => `
        <button class="train-chip ${t.id === active ? 'active' : ''}" data-action="select-train" data-train="${t.id}">
          <span class="train-dot" style="background:#${t.accentColor.toString(16).padStart(6, '0')}"></span>
          ${esc(t.name)}
        </button>`).join('') + `<button class="train-chip ghost" data-action="depot">Depot +</button>`;
    }

    const start = document.getElementById('start-btn') as HTMLButtonElement | null;
    if (start) {
      const can = !!selected && eco.isLineUnlocked(selected);
      start.disabled = !can;
      start.textContent = can ? `Start ${selected!.code} service →` : 'Unlock this line to drive';
    }
  }

  private drawLineMap(canvas: HTMLCanvasElement, key: string, line: LineDef, region: RegionDef): void {
    let data = this.mapCache.get(key);
    if (!data) {
      try {
        const plan = buildTrackPlan(line, region);
        data = {
          points: plan.points.filter((_, i) => i % 5 === 0).map((p) => ({ x: p.x, z: p.z })),
          stations: plan.stations.map((st) => {
            const p = plan.points[Math.min(plan.points.length - 1, Math.round(st.s / 2))];
            return { x: p.x, z: p.z, name: st.name };
          }),
          length: plan.length,
        };
        this.mapCache.set(key, data);
      } catch {
        return;
      }
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a1118';
    ctx.fillRect(0, 0, w, h);
    // grid
    ctx.strokeStyle = 'rgba(120,170,200,0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of data.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    for (const s of data.stations) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
    const pad = 34;
    const scale = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxZ - minZ));
    const ox = (w - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = (h - (maxZ - minZ) * scale) / 2 - minZ * scale;
    const map = (p: { x: number; z: number }) => ({ x: p.x * scale + ox, y: p.z * scale + oy });
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    data.points.forEach((p, i) => {
      const m = map(p);
      if (i === 0) ctx.moveTo(m.x, m.y);
      else ctx.lineTo(m.x, m.y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.fillStyle = '#0a1118';
    for (const s of data.stations) {
      const m = map(s);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#dceaf2';
      ctx.stroke();
    }
    ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(210,230,240,0.75)';
    data.stations.forEach((s, i) => {
      if (i !== 0 && i !== data.stations.length - 1) return;
      const m = map(s);
      ctx.textAlign = i === 0 ? 'left' : 'right';
      ctx.fillText(s.name, m.x + (i === 0 ? 12 : -12), m.y + 5);
    });
    ctx.fillStyle = 'rgba(140,180,200,0.55)';
    ctx.font = '500 13px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${(data.length / 1000).toFixed(2)} KM`, 14, h - 14);
  }

  renderDepot(): void {
    const eco = this.economy;
    const wallet = document.getElementById('depot-wallet');
    if (wallet) wallet.innerHTML = `<span class="chip money">${money(eco.money)}</span><span class="chip">LV ${eco.level}</span>`;
    const tabs = document.getElementById('depot-tabs');
    if (tabs) {
      tabs.innerHTML = ([['lines', 'Network rights'], ['trains', 'Rolling stock'], ['upgrades', 'Upgrades']] as [DepotTab, string][]).map(([id, label]) =>
        `<button class="region-tab ${this.depotTab === id ? 'active' : ''}" data-action="depot-tab" data-tab="${id}">${label}</button>`
      ).join('');
    }
    const body = document.getElementById('depot-body');
    if (!body) return;
    if (this.depotTab === 'lines') {
      body.innerHTML = REGIONS.map((r) => {
        const owned = eco.isRegionUnlocked(r.id);
        const req = eco.regionUnlockRequirement(r.id);
        const lines = this.visibleLinesForRegion(r.id).slice(0, 6);
        return `<div class="depot-section">
          <div class="depot-section-head">
            <span class="region-swatch" style="background:${r.accent}"></span>
            <div><h3>${esc(r.name)}</h3><p>${esc(r.blurb)}</p></div>
            ${owned ? '<span class="ok">UNLOCKED</span>' : `<button class="btn small" data-action="unlock-region" data-region="${r.id}" ${(eco.level < req.level || eco.money < req.cost) ? 'disabled' : ''}>Unlock ${money(req.cost)} · L${req.level}</button>`}
          </div>
          <div class="depot-line-grid">
            ${lines.map((l) => `<div class="depot-line">
              <span class="line-badge" style="--c:${l.color}">${l.code}</span>
              <div><b>${esc(l.name)}</b><small>${l.lengthKm.toFixed(1)} km · ${l.stationCount} stops</small></div>
              <span class="depot-line-action">${eco.isLineUnlocked(l) ? '<span class="ok">OWNED</span>' : owned ? `<button class="btn tiny" data-action="unlock-line" data-line="${l.id}" ${(eco.level < l.levelReq || eco.money < l.unlockCost) ? 'disabled' : ''}>${money(l.unlockCost)}</button>` : `<span class="muted">L${l.levelReq}</span>`}</span>
            </div>`).join('')}
          </div>
        </div>`;
      }).join('');
    } else if (this.depotTab === 'trains') {
      body.innerHTML = `<div class="train-grid">${TRAINS.map((t) => {
        const owned = eco.ownsTrain(t.id);
        const check = eco.canBuyTrain(t.id);
        const stats: [string, number][] = [
          ['Top speed', clamp(t.maxSpeedKph / 330, 0, 1)],
          ['Traction', clamp(t.maxTEkN / 480, 0, 1)],
          ['Power', clamp(t.powerKW / 9800, 0, 1)],
          ['Braking', clamp(t.brakeDecel / 1.5, 0, 1)],
          ['Comfort', clamp(t.comfort / 5, 0, 1)],
        ];
        return `<div class="train-card ${eco.activeTrainId === t.id ? 'active' : ''}">
          <div class="train-card-head">
            <div><span class="train-maker">${esc(t.maker)}</span><h3>${esc(t.name)}</h3></div>
            <span class="train-type">${t.traction === 'diesel' ? 'DIESEL' : 'ELECTRIC'}</span>
          </div>
          <p class="train-blurb">${esc(t.blurb)}</p>
          <div class="train-stats">${stats.map(([label, v]) => `<div class="stat-row"><span>${label}</span><div><i style="width:${(v * 100).toFixed(0)}%"></i></div></div>`).join('')}</div>
          <div class="train-facts"><span>${t.cars} cars</span><span>${t.maxSpeedKph} km/h</span><span>${t.maxTEkN} kN</span></div>
          <div class="train-card-foot">
            ${owned ? (eco.activeTrainId === t.id ? '<span class="ok">ACTIVE</span>' : `<button class="btn small" data-action="select-train" data-train="${t.id}">Select</button>`) :
              `<span class="price">${money(t.price)}</span><button class="btn small" data-action="buy-train" data-train="${t.id}" ${check.ok ? '' : 'disabled'}>${check.reason || 'Buy'}</button>`}
          </div>
        </div>`;
      }).join('')}</div>`;
    } else {
      body.innerHTML = `<div class="upgrade-grid">${UPGRADES.map((u) => {
        const lvl = eco.upgradeLevel(u.id);
        const cost = eco.upgradeCost(u.id);
        const maxed = lvl >= u.maxLevel;
        return `<div class="upgrade-card">
          <div class="upgrade-icon">${u.icon}</div>
          <h3>${esc(u.name)}</h3>
          <p>${esc(u.desc)}</p>
          <div class="pips">${Array.from({ length: u.maxLevel }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>
          <div class="upgrade-foot">
            <span>${maxed ? 'MAX LEVEL' : `${money(cost)}`}</span>
            <button class="btn small" data-action="buy-upgrade" data-upgrade="${u.id}" ${maxed || eco.money < cost ? 'disabled' : ''}>${maxed ? 'Complete' : 'Upgrade'}</button>
          </div>
        </div>`;
      }).join('')}</div>`;
    }
  }

  setupSession(info: SessionInfo): void {
    const pill = document.getElementById('hud-line-pill');
    if (pill) {
      pill.textContent = info.lineCode;
      pill.style.setProperty('--c', info.lineColor);
      pill.style.background = info.lineColor;
    }
    this.setText('hud-line-name', info.lineName);
    this.setText('hud-service-code', `SERVICE ${info.serviceNumber} · ${info.destination}`);
    this.setText('hud-line-name', info.lineName);
    this.setText('load-cap', `/ ${info.capacity}`);
    const route = document.getElementById('route-strip');
    if (route) {
      route.innerHTML = info.stations.map((name, i) => `<div class="route-stop" data-i="${i}"><span class="route-dot"></span><span class="route-name">${esc(name)}</span></div>`).join('');
      this.routeEls = Array.from(route.querySelectorAll('.route-stop')) as HTMLElement[];
      this.routeSignature = '';
    }
    this.cache.clear();
    this.showStopToast('');
  }

  setText(id: string, text: string): void {
    if (this.cache.get(id) === text) return;
    const el = document.getElementById(id);
    if (el) el.textContent = text;
    this.cache.set(id, text);
  }

  setHtml(id: string, html: string): void {
    if (this.cache.get(id) === html) return;
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
    this.cache.set(id, html);
  }

  showStopToast(text: string, tone: 'good' | 'bad' | 'info' = 'info'): void {
    const el = document.getElementById('stop-toast');
    if (!el) return;
    if (!text) {
      el.classList.remove('show');
      return;
    }
    el.textContent = text;
    el.className = `stop-toast show ${tone}`;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 4200);
  }

  toast(message: string, type: 'good' | 'bad' | 'info' = 'info'): void {
    const area = document.getElementById('toasts');
    if (!area) return;
    const div = document.createElement('div');
    div.className = `toast ${type}`;
    div.textContent = message;
    area.appendChild(div);
    setTimeout(() => {
      div.classList.add('out');
      setTimeout(() => div.remove(), 400);
    }, 3600);
  }

  update(s: HudState): void {
    this.setText('hud-clock', formatClock(s.clock));
    const delayText = Math.abs(s.delaySec) < 20 ? 'ON TIME' : s.delaySec > 0 ? `+${formatDelay(s.delaySec)}` : `${formatDelay(s.delaySec)} EARLY`;
    this.setText('hud-delay', delayText);
    const delayEl = document.getElementById('hud-delay');
    if (delayEl) delayEl.className = `hud-delay ${Math.abs(s.delaySec) < 20 ? 'ok' : s.delaySec > 45 ? 'bad' : 'warn'}`;
    this.setText('hud-money', money(s.money));
    this.setText('hud-level', `LV ${s.level}`);
    const xp = document.getElementById('hud-xp');
    if (xp) xp.style.width = `${(s.xpFraction * 100).toFixed(1)}%`;

    this.setText('next-name', s.nextStationName || 'Terminus');
    this.setText('next-distance', s.nextStationName ? `${Math.max(0, s.distanceToNext / 1000).toFixed(2)} km to go` : '—');
    this.setText('next-sched', s.nextStationName ? `SCHED ${formatHM(s.nextStationScheduled)}` : '—');
    this.setText('next-hint', s.stopHint || s.hint);
    this.setText('next-kind', s.signal === 'clear' ? 'CLEAR SIGNAL' : 'CAUTION');
    const fill = document.getElementById('stop-fill');
    if (fill) {
      const f = s.nextStationName ? clamp(1 - s.distanceToNext / 900, 0, 1) : 1;
      fill.style.width = `${f * 100}%`;
    }
    this.setText('limit-big', String(s.limit));
    this.setText('limit-advisory', `ADVISORY ${s.advisory}`);
    this.setText('limit-next', s.nextRestriction ? `${s.nextRestriction.limit} km/h in ${Math.max(0, Math.round(s.nextRestrictionDist))} m` : 'No restriction ahead');
    const limitBig = document.getElementById('limit-big');
    if (limitBig) limitBig.className = `limit-big ${s.overspeed ? 'over' : ''}`;

    this.setText('load-count', String(s.passengers));
    this.setText('load-pct', `${Math.round((s.passengers / Math.max(1, s.capacity)) * 100)}%`);
    const loadFill = document.getElementById('load-fill');
    if (loadFill) loadFill.style.width = `${clamp((s.passengers / Math.max(1, s.capacity)) * 100, 0, 100)}%`;
    this.setText('load-sub', s.boarding ? `Boarding · ${s.waiting} waiting at ${s.stationName}` : s.doorsOpen ? 'Doors open' : `${s.waiting} waiting at ${s.stationName}`);

    this.setText('speed-value', String(Math.round(s.speedKph)));
    const arcLen = Math.PI * 92;
    const frac = clamp(s.speedKph / Math.max(1, s.maxSpeedKph), 0, 1);
    const progress = document.getElementById('gauge-progress');
    if (progress) {
      progress.style.strokeDasharray = `${(arcLen * frac).toFixed(1)} ${arcLen.toFixed(1)}`;
      progress.style.stroke = s.overspeed ? '#ff6b5e' : '#6fe3c1';
    }
    const mark = document.getElementById('gauge-limit-mark');
    if (mark) {
      const a = Math.PI + clamp(s.limit / Math.max(1, s.maxSpeedKph), 0, 1) * Math.PI;
      const cx = 120;
      const cy = 116;
      const r = 83;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      mark.setAttribute('x1', String(x));
      mark.setAttribute('y1', String(y));
      mark.setAttribute('x2', String(cx + Math.cos(a) * 98));
      mark.setAttribute('y2', String(cy + Math.sin(a) * 98));
      mark.style.stroke = s.overspeed ? '#ff6b5e' : '#ffcc66';
    }
    this.setText('gauge-mode', s.viewMode.toUpperCase() + ' VIEW');
    this.setText('power-num', String(s.powerNotch));
    this.setText('brake-num', String(s.brakeNotch));
    const pp = document.getElementById('power-pips');
    if (pp) Array.from(pp.children).forEach((el, i) => el.classList.toggle('on', i < s.powerNotch));
    const bp = document.getElementById('brake-pips');
    if (bp) Array.from(bp.children).forEach((el, i) => el.classList.toggle('on', i < s.brakeNotch));

    const doorsFlag = document.getElementById('flag-doors');
    if (doorsFlag) {
      doorsFlag.classList.toggle('on', s.doorsOpen);
      doorsFlag.classList.toggle('warn', s.doorsMoving);
    }
    const emergFlag = document.getElementById('flag-emergency');
    if (emergFlag) emergFlag.classList.toggle('on', s.emergency);
    const slipFlag = document.getElementById('flag-slip');
    if (slipFlag) slipFlag.classList.toggle('on', s.slip);
    const lightFlag = document.getElementById('flag-lights');
    if (lightFlag) {
      lightFlag.classList.toggle('on', s.headlights > 0);
      lightFlag.classList.toggle('warn', s.headlights === 2);
    }

    const doorsBtn = document.getElementById('doors-label');
    if (doorsBtn) doorsBtn.textContent = s.doorsOpen ? 'CLOSE' : 'DOORS';
    const hintbar = document.getElementById('hintbar');
    if (hintbar) hintbar.textContent = s.hint;

    const sig = s.route.map((r) => r.state[0]).join('');
    if (sig !== this.routeSignature) {
      this.routeSignature = sig;
      s.route.forEach((r, i) => {
        const el = this.routeEls[i];
        if (el) el.dataset.state = r.state;
      });
    }
    this.setText('route-progress', `${Math.round(s.progress * 100)}%`);
    this.setText('next-kind', s.signal === 'clear' ? 'CLEAR SIGNAL' : 'CAUTION');

    const over = document.getElementById('flag-emergency');
    void over;
  }

  renderPauseSettings(): void {
    const el = document.getElementById('pause-settings');
    if (!el) return;
    const st = this.economy.settings;
    el.innerHTML = `
      <div class="settings-head">Settings</div>
      <label class="setting-row"><span>Master volume</span><input id="set-volume" type="range" min="0" max="1" step="0.01" value="${st.volume}" /></label>
      <label class="setting-row"><span>Announcements</span><span class="switch"><input id="set-announce" type="checkbox" ${st.announcements ? 'checked' : ''}/><i></i></span></label>
      <label class="setting-row"><span>Driving hints</span><span class="switch"><input id="set-hints" type="checkbox" ${st.showHints ? 'checked' : ''}/><i></i></span></label>
      <label class="setting-row"><span>Graphics</span>
        <select id="set-quality">
          <option value="high" ${st.quality === 'high' ? 'selected' : ''}>High</option>
          <option value="medium" ${st.quality === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="low" ${st.quality === 'low' ? 'selected' : ''}>Low</option>
        </select>
      </label>
      <div class="setting-row mute-row"><span>Mute all audio</span><button class="btn tiny" data-action="toggle-mute">${this.economy.settings.mute ? 'Unmute' : 'Mute'}</button></div>
    `;
  }

  showSummary(r: ServiceResult, lineColor: string): void {
    const modal = document.getElementById('summary-modal');
    if (!modal) return;
    const netClass = r.net >= 0 ? 'good' : 'bad';
    this.showScreen('summary');
    modal.innerHTML = `
      <div class="summary-head">
        <span class="line-badge big" style="--c:${lineColor}">${r.lineCode}</span>
        <div><h3>${esc(r.lineName)}</h3><p>${esc(r.trainName)} · ${r.stops} stops · ${r.distanceKm.toFixed(2)} km</p></div>
        <div class="summary-net ${netClass}">${r.net >= 0 ? '+' : ''}${money(r.net)}</div>
      </div>
      <div class="summary-cols">
        <div class="summary-block">
          <div class="block-title">REVENUE</div>
          <div class="money-row"><span>Fares</span><b>${money(r.fares)}</b></div>
          <div class="money-row"><span>Punctuality</span><b>${money(r.punctualityBonus)}</b></div>
          <div class="money-row"><span>Stop accuracy</span><b>${money(r.accuracyBonus)}</b></div>
          <div class="money-row bad"><span>Penalties</span><b>−${money(r.penalties)}</b></div>
        </div>
        <div class="summary-block">
          <div class="block-title">COSTS</div>
          <div class="money-row"><span>Energy</span><b>−${money(r.energyCost)}</b></div>
          <div class="money-row"><span>Maintenance</span><b>−${money(r.maintenance)}</b></div>
          <div class="money-row"><span>Crew</span><b>−${money(r.crewCost)}</b></div>
          <div class="money-row total"><span>Net result</span><b class="${netClass}">${r.net >= 0 ? '+' : ''}${money(r.net)}</b></div>
        </div>
        <div class="summary-block">
          <div class="block-title">SERVICE</div>
          <div class="money-row"><span>Passengers carried</span><b>${r.passengers}</b></div>
          <div class="money-row"><span>Passenger-km</span><b>${Math.round(r.passengerKm)}</b></div>
          <div class="money-row"><span>Perfect stops</span><b>${r.perfectStops} / ${r.stops}</b></div>
          <div class="money-row"><span>On-time stops</span><b>${r.onTimeStops} / ${r.stops}</b></div>
          <div class="money-row"><span>Average delay</span><b>${r.stops ? formatDelay(r.delaySeconds / r.stops) : '0s'}</b></div>
          <div class="money-row"><span>Overspeed events</span><b>${r.overspeedEvents}</b></div>
        </div>
      </div>
      <div class="summary-xp">
        <div class="summary-level">LEVEL ${r.newLevel}${r.levelsGained > 0 ? ` <span class="levelup">+${r.levelsGained} LEVEL UP</span>` : ''}</div>
        <div class="xp-track"><div style="width:${(this.economy.levelProgress.fraction * 100).toFixed(1)}%"></div></div>
        <div class="xp-gain">+${r.xp.toLocaleString()} XP earned</div>
      </div>
      <div class="modal-actions">
        <button class="btn primary" data-action="dispatch">Dispatch board</button>
        <button class="btn" data-action="again">Run it again</button>
      </div>
    `;
  }
}

function formatDelay(seconds: number): string {
  const s = Math.abs(Math.round(seconds));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}
