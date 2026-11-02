import { GAME_TITLE, REGIONS, levelInfo } from '../game/config';
import { carModelName } from '../game/carModels';
import { formatCredits, formatTime, machineName } from '../game/format';
import type { GameApi } from '../game/api';
import type { UiState } from '../game/types';

export function StartScreen({ api, state }: { api: GameApi; state: UiState }) {
  const profile = state.profile;
  const level = levelInfo(profile.xp);
  const selected = state.settings.region;
  const region = REGIONS.find((item) => item.id === selected) ?? REGIONS[0];

  return (
    <div className="pointer-events-auto absolute inset-0 z-30 overflow-y-auto bg-[#071315]/[0.96]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 72% 16%, rgba(213, 163, 106, 0.07), transparent 54%), linear-gradient(180deg, rgba(9, 24, 26, 0.24), transparent 38%, rgba(4, 12, 13, 0.38))',
        }}
      />

      <div className="relative mx-auto flex min-h-full w-full max-w-[720px] flex-col px-6 py-6 md:px-10 md:py-8">
        <header className="flex items-center gap-2.5 text-[11px] text-white/35">
          <span className="h-1.5 w-1.5 rotate-45 bg-[#d5a36a]" />
          Halcyon Island
        </header>

        <main className="flex flex-1 items-center py-12 md:py-16">
          <div className="w-full max-w-[560px]">
            <h1 className="font-display text-[clamp(64px,10vw,108px)] font-medium leading-[0.88] tracking-[-0.015em] text-[#f1ede3]">
              {GAME_TITLE}
            </h1>

            <p className="mt-5 max-w-[390px] text-[15px] leading-relaxed text-white/42">
              Four districts, one open road. Pick a place to start.
            </p>

            <section className="mt-10">
              <div className="text-[11px] text-white/32">Start in</div>
              <div className="mt-3 flex flex-wrap gap-x-7 gap-y-3">
                {REGIONS.map((item) => {
                  const active = item.id === selected;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => api.setRegion(item.id)}
                      aria-pressed={active}
                      className="group flex items-center gap-2 text-[14px]"
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full transition-opacity ${
                          active ? 'opacity-100' : 'opacity-30 group-hover:opacity-60'
                        }`}
                        style={{ backgroundColor: item.color }}
                      />
                      <span
                        className={`border-b pb-1 transition-colors ${
                          active
                            ? 'border-white/25 text-white'
                            : 'border-transparent text-white/35 group-hover:text-white/65'
                        }`}
                      >
                        {item.name}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] text-white/26">{region.tagline}</p>
            </section>

            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
              <button
                type="button"
                onClick={() => api.play()}
                className="inline-flex h-11 items-center justify-center rounded-[3px] bg-[#d5a36a] px-6 text-[13px] font-medium text-[#1b1710] transition-colors hover:bg-[#e1b27e]"
              >
                Start driving
              </button>
              <button
                type="button"
                onClick={() => api.startChallenge()}
                className="text-[13px] text-white/48 underline decoration-white/10 underline-offset-4 transition-colors hover:text-white hover:decoration-white/35"
              >
                Interchange trial
              </button>
              <button
                type="button"
                onClick={() => api.openGarage('menu')}
                className="text-[13px] text-white/48 underline decoration-white/10 underline-offset-4 transition-colors hover:text-white hover:decoration-white/35"
              >
                Garage
              </button>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[9px] text-white/28">
              <span>{carModelName(state.settings.car)}</span>
              <span>Level {machineName(level.level)}</span>
              <span>{formatCredits(profile.credits)} credits</span>
              <span>Best lap {formatTime(profile.bestLap)}</span>
              <span>Trial best {formatTime(profile.bestTrial)}</span>
            </div>
          </div>
        </main>

        <footer className="border-t border-white/[0.06] pt-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[9px] text-white/26">
            <span><span className="text-white/46">WASD</span> drive</span>
            <span><span className="text-white/46">Space</span> handbrake</span>
            <span><span className="text-white/46">R</span> recover</span>
            <span><span className="text-white/46">C</span> camera</span>
            <span><span className="text-white/46">Esc</span> pause</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
