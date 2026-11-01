import { useEffect, useState, type ReactNode } from 'react';
import { hud, ui } from '../game/store';
import { levelInfo } from '../game/config';
import { displaySpeed, formatCredits, formatTime, machineName } from '../game/format';
import type { GameApi } from '../game/api';
import { useStore } from './useStore';

function Key({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Hud({ api }: { api: GameApi }) {
  const state = useStore(hud);
  const app = useStore(ui);
  const level = levelInfo(app.profile.xp);
  const [hintVisible, setHintVisible] = useState(true);

  useEffect(() => {
    setHintVisible(true);
    const timer = window.setTimeout(() => setHintVisible(false), 9000);
    return () => window.clearTimeout(timer);
  }, []);

  const speed = displaySpeed(state.speed, app.settings.units);
  const speedText = String(speed).padStart(3, '0');
  const rpmRatio = Math.min(1, state.rpm / 7600);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none">
      {/* Sector + lap */}
      <div className="absolute left-6 top-6 w-[236px] md:left-9 md:top-8">
        <div className="flex items-center gap-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-signal shadow-[0_0_10px_rgba(255,178,87,0.9)]" />
          <span className="ui-label">Nightshift</span>
          <span className="ui-label ml-auto text-white/20">Wet loop</span>
        </div>

        <div className="mt-5 flex items-baseline gap-1.5">
          <span className="font-mono text-[22px] leading-none text-white/90 tabular-nums">
            {machineName(state.sector)}
          </span>
          <span className="ui-label pb-0.5 text-white/30">/ {machineName(state.sectors)} sectors</span>
        </div>

        <div className="relative mt-2.5 h-px w-full bg-white/10">
          <div
            className="absolute inset-y-0 left-0 bg-signal transition-[width] duration-200 ease-out"
            style={{ width: `${Math.max(0, Math.min(1, state.sectorProgress)) * 100}%` }}
          />
          <span className="absolute -top-[2px] right-0 h-[5px] w-px bg-white/20" />
        </div>

        <div className="mt-3 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">
          <span>Lap {state.lap}</span>
          <span className="text-white/15">/</span>
          <span className="tabular-nums text-white/55">{formatTime(state.lapTime)}</span>
          <span className="ml-auto tabular-nums">Best {formatTime(state.bestLap)}</span>
        </div>
      </div>

      {/* Career chip */}
      <div className="absolute right-6 top-6 text-right md:right-9 md:top-8">
        <div className="ui-label">
          Level {machineName(level.level)} <span className="text-white/20">·</span> {level.name}
        </div>
        <div className="mt-2 flex items-center justify-end gap-2">
          <span className="inline-block h-1.5 w-1.5 rotate-45 bg-signal/80" />
          <span className="font-mono text-[17px] tabular-nums text-white/90">{formatCredits(app.profile.credits)}</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">credits</span>
        </div>
        <div className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-signal/70">
          +{formatCredits(app.sessionCredits)} this run
        </div>
      </div>

      {/* Speed cluster */}
      <div className="absolute bottom-7 right-6 text-right md:bottom-9 md:right-9">
        <div className="mb-2.5 flex items-center justify-end gap-2.5">
          <span className="ui-label">RPM</span>
          <div className="relative h-[3px] w-32 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-ice via-signal to-[#ff7054] transition-[width] duration-100 ease-linear"
              style={{ width: `${rpmRatio * 100}%` }}
            />
            <span className="absolute inset-y-0 right-[17%] w-px bg-black/60" />
          </div>
          <span className="w-8 font-mono text-[9px] tabular-nums text-white/30">{Math.round(state.rpm)}</span>
        </div>

        <div className="flex items-end justify-end gap-4">
          <div className="relative">
            {state.drifting && (
              <div className="absolute -top-6 right-1 animate-[drift-in_180ms_ease-out] font-mono text-[9px] uppercase tracking-[0.24em] text-signal">
                drift
              </div>
            )}
            <div className="font-mono text-[76px] leading-[0.72] tracking-[-0.08em] tabular-nums text-white hud-shadow md:text-[96px]">
              {speedText}
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                title="Toggle units (U)"
                onClick={() => api.setUnits(app.settings.units === 'kmh' ? 'mph' : 'kmh')}
                className="pointer-events-auto cursor-pointer border-b border-dotted border-white/20 pb-px font-mono text-[9px] uppercase tracking-[0.22em] text-white/45 transition-colors hover:text-signal"
              >
                {app.settings.units === 'kmh' ? 'km/h' : 'mph'}
              </button>
              <span className="h-[3px] w-[3px] rounded-full bg-white/20" />
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/25">digital</span>
            </div>
          </div>

          <div className="mb-0.5 flex h-[64px] w-[52px] flex-col items-center justify-center rounded-md border border-white/15 bg-black/30 backdrop-blur-sm">
            <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-white/30">Gear</span>
            <span
              key={state.gear}
              className={`animate-gear font-display text-[32px] font-semibold leading-none ${state.gear === 'N' ? 'text-white/50' : 'text-white'}`}
            >
              {state.gear}
            </span>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-end gap-3 font-mono text-[9px] uppercase tracking-[0.16em] text-white/20">
          <span>{Math.round(state.throttle * 100)}% throttle</span>
          <span>{Math.round(state.brake * 100)}% brake</span>
        </div>
      </div>

      {/* Controls */}
      <div
        className={`absolute bottom-8 left-6 hidden transition-opacity duration-700 sm:block md:left-9 ${
          hintVisible && app.screen === 'driving' ? 'opacity-70' : 'opacity-0'
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[9px] uppercase tracking-[0.16em] text-white/45">
          <span className="flex items-center gap-1.5">
            <Key>W</Key>
            <Key>A</Key>
            <Key>S</Key>
            <Key>D</Key>
            <span className="ml-1">drive</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Key>Space</Key>
            <span>handbrake</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Key>R</Key>
            <span>recover</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Key>Esc</Key>
            <span>pause</span>
          </span>
        </div>
        <div className="mt-2 font-mono text-[8px] uppercase tracking-[0.16em] text-white/20">
          U units · M sound
        </div>
      </div>
    </div>
  );
}
