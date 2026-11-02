import { useEffect, useState } from 'react';
import { hud, ui } from '../game/store';
import { levelInfo } from '../game/config';
import { displaySpeed, formatCredits, formatTime, machineName } from '../game/format';
import { useStore } from './useStore';

function phaseName(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function ChallengeReadout() {
  const telemetry = useStore(hud);
  const run = telemetry.challenge;
  if (!run) return null;

  return (
    <div className="hud-shadow absolute left-5 top-5 max-w-[240px] md:left-8 md:top-7">
      <div className="flex items-center gap-2 text-[11px] text-white/50">
        <span className={`h-1 w-1 rounded-full ${run.finished ? 'bg-[#a9c6b4]' : 'bg-[#d5a36a]'}`} />
        Interchange trial
      </div>
      <div className="mt-1.5 flex items-baseline gap-2.5">
        <span className="font-display text-[28px] font-medium leading-none tabular-nums text-white/90">
          {formatTime(run.time)}
        </span>
        {run.best != null && (
          <span className="font-mono text-[8px] text-white/28">Best {formatTime(run.best)}</span>
        )}
      </div>
      <div className={`mt-1 text-[10px] ${run.finished ? 'text-[#a9c6b4]' : 'text-white/48'}`}>
        {run.objective}
      </div>
    </div>
  );
}

function StatusReadout() {
  const app = useStore(ui);
  const telemetry = useStore(hud);
  const level = levelInfo(app.profile.xp);

  return (
    <div className="hud-shadow absolute right-5 top-5 text-right md:right-8 md:top-7">
      <div className="flex items-baseline justify-end gap-2 font-mono">
        <span className="text-[9px] tracking-[0.06em] text-white/38">Level {machineName(level.level)}</span>
        <span className="text-white/15">·</span>
        <span className="text-[12px] tabular-nums text-white/75">{formatCredits(app.profile.credits)}</span>
        <span className="text-[8px] text-white/30">cr</span>
      </div>
      {app.sessionCredits > 0 && (
        <div className="mt-1 font-mono text-[8px] tracking-[0.04em] text-[#d5a36a]">
          +{formatCredits(app.sessionCredits)} this drive
        </div>
      )}
      <div className="mt-1 font-mono text-[8px] tracking-[0.04em] text-white/25">
        {telemetry.clock} <span className="text-white/15">·</span> {phaseName(telemetry.phase)}
      </div>
    </div>
  );
}

function ChaseReadout() {
  const telemetry = useStore(hud);

  return (
    <div className="hud-shadow absolute bottom-6 left-1/2 -translate-x-1/2 md:bottom-8">
      <div className="flex items-baseline gap-1.5">
        <span className="font-display text-[30px] font-medium leading-none tabular-nums text-white/85">
          {displaySpeed(telemetry.speed, telemetry.units)}
        </span>
        <span className="font-mono text-[9px] text-white/38">
          {telemetry.units === 'mph' ? 'mph' : 'km/h'}
        </span>
        <span className="mx-1 font-mono text-[9px] text-white/15">·</span>
        <span className="font-mono text-[9px] text-white/30">gear {telemetry.gear}</span>
      </div>
    </div>
  );
}

/**
 * The car carries the detailed readouts. The overlay stays almost invisible:
 * one line of status, a borderless trial timer, and a small speed readout in
 * chase view. Everything else is left to the road.
 */
export function Hud() {
  const app = useStore(ui);
  const [hintVisible, setHintVisible] = useState(true);

  useEffect(() => {
    setHintVisible(true);
    const timer = window.setTimeout(() => setHintVisible(false), 8500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none">
      <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(4,12,14,0.24),transparent)]" />
      <div className="absolute inset-x-0 bottom-0 h-20 bg-[linear-gradient(0deg,rgba(4,12,14,0.2),transparent)]" />

      <ChallengeReadout />
      <StatusReadout />

      <div
        className={`absolute bottom-6 left-5 max-w-[calc(100vw-2.5rem)] transition-opacity duration-700 md:bottom-8 md:left-8 ${
          hintVisible && app.screen === 'driving' ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="hud-shadow font-mono text-[8px] leading-relaxed tracking-[0.04em] text-white/32">
          WASD drive <span className="mx-1 text-white/15">·</span> Space handbrake{' '}
          <span className="mx-1 text-white/15">·</span> R recover{' '}
          <span className="mx-1 text-white/15">·</span> C camera{' '}
          <span className="mx-1 text-white/15">·</span> Esc pause
        </div>
      </div>

      {app.screen === 'driving' && app.settings.camera === 'chase' && <ChaseReadout />}
    </div>
  );
}
