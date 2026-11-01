import { levelInfo } from '../game/config';
import { formatCredits, formatDistance, formatTime, machineName } from '../game/format';
import type { GameApi } from '../game/api';
import type { UiState } from '../game/types';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="ui-label">{label}</div>
      <div className="mt-1.5 font-mono text-[17px] leading-none tabular-nums text-white/90">{value}</div>
      {sub && <div className="mt-1.5 font-mono text-[8px] uppercase tracking-[0.16em] text-white/25">{sub}</div>}
    </div>
  );
}

export function StartScreen({ api, state }: { api: GameApi; state: UiState }) {
  const profile = state.profile;
  const level = levelInfo(profile.xp);

  return (
    <div className="pointer-events-auto absolute inset-0 z-30 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,5,9,0.98)_0%,rgba(3,5,9,0.9)_38%,rgba(3,5,9,0.32)_72%,rgba(3,5,9,0.05)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(3,5,9,0.9)_0%,transparent_26%,transparent_76%,rgba(3,5,9,0.45)_100%)]" />
      <div className="absolute -left-32 top-1/3 h-[420px] w-[420px] rounded-full bg-signal/[0.07] blur-[110px]" />

      <div className="relative flex h-full flex-col px-6 py-6 md:px-12 md:py-8">
        <header className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rotate-45 bg-signal shadow-[0_0_18px_rgba(255,178,87,0.7)]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/70">Nightshift</span>
          </div>
          <div className="hidden text-right sm:block">
            <div className="ui-label">Wet highway · dusk 21:40</div>
            <div className="ui-label mt-1.5 text-white/20">1.6 km loop · 12 sectors</div>
          </div>
        </header>

        <div className="flex flex-1 items-center">
          <div className="animate-rise w-full max-w-[560px]">
            <div className="mb-5 flex items-center gap-3">
              <span className="h-[2px] w-9 bg-signal" />
              <span className="ui-label text-signal/80">A drive after dark</span>
            </div>

            <h1 className="font-display text-[clamp(68px,10.5vw,124px)] font-semibold uppercase leading-[0.8] tracking-[-0.015em] text-white">
              Night<span className="text-signal">shift</span>
            </h1>

            <p className="mt-6 max-w-[420px] text-[13px] leading-relaxed text-white/45">
              Wet asphalt, sodium light and an empty highway. Keep the car on the line, clear the
              sectors and build a name for yourself one clean lap at a time.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-primary" onClick={() => api.play()}>
                Start drive
                <span aria-hidden className="text-[14px] leading-none">→</span>
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => api.openGarage('menu')}>
                Garage
              </button>
            </div>

            <div className="mt-10 grid max-w-[480px] grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
              <Stat label="Level" value={machineName(level.level)} sub={level.name} />
              <Stat label="Credits" value={`${formatCredits(profile.credits)}`} sub="Garage balance" />
              <Stat label="Best lap" value={formatTime(profile.bestLap)} sub={`${profile.laps} laps driven`} />
              <Stat label="Distance" value={formatDistance(profile.distance)} sub={`${Math.round(profile.bestSpeed)} km/h best`} />
            </div>

            <div className="mt-7 max-w-[480px]">
              <div className="flex items-center justify-between">
                <span className="ui-label">Next level</span>
                <span className="ui-label tabular-nums text-white/30">
                  {Math.round(level.progress * 100)}%
                </span>
              </div>
              <div className="relative mt-2 h-px w-full bg-white/10">
                <div className="h-px bg-signal" style={{ width: `${Math.max(2, level.progress * 100)}%` }} />
              </div>
            </div>
          </div>
        </div>

        <footer className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">
            <span className="flex items-center gap-1.5">
              <kbd className="kbd">W</kbd><kbd className="kbd">A</kbd><kbd className="kbd">S</kbd><kbd className="kbd">D</kbd>
              <span className="ml-1">/ arrows</span>
            </span>
            <span className="flex items-center gap-1.5"><kbd className="kbd">Space</kbd> handbrake</span>
            <span className="flex items-center gap-1.5"><kbd className="kbd">Esc</kbd> pause</span>
          </div>
          <div className="flex items-center gap-4 font-mono text-[8px] uppercase tracking-[0.18em] text-white/20">
            <span>Progress saves locally</span>
            <span className="hidden sm:inline">Headphones recommended</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
