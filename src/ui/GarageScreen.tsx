import { UPGRADES, levelInfo, upgradeCost } from '../game/config';
import { CAR_MODELS } from '../game/carModels';
import { formatCredits, machineName } from '../game/format';
import type { GameApi } from '../game/api';
import type { UiState } from '../game/types';

export function GarageScreen({ api, state }: { api: GameApi; state: UiState }) {
  const profile = state.profile;
  const level = levelInfo(profile.xp);

  return (
    <div className="pointer-events-auto absolute inset-0 z-30 overflow-y-auto bg-[#03050a]/78 p-4 backdrop-blur-[7px] md:p-8">
      <div className="mx-auto w-full max-w-[780px]">
        <div className="ui-panel animate-rise overflow-hidden">
          <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-5">
            <div>
              <div className="ui-label">Service bay · island tune</div>
              <h2 className="mt-2 font-display text-[42px] font-semibold uppercase leading-none tracking-wide">
                Garage
              </h2>
              <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-white/30">
                Level {machineName(level.level)} · {level.name}
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => api.closeGarage()}>
              Back
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] px-6 py-4">
            <div className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rotate-45 bg-signal/80" />
              <span className="font-mono text-[20px] tabular-nums text-white/90">
                {formatCredits(profile.credits)}
              </span>
              <span className="ui-label ml-1 text-white/25">credits available</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="ui-label text-white/25">Next level</span>
              <div className="h-px w-28 bg-white/10">
                <div className="h-px bg-signal" style={{ width: `${level.progress * 100}%` }} />
              </div>
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                {Math.round(level.progress * 100)}%
              </span>
            </div>
          </div>

          <div className="border-b border-white/[0.06] px-6 py-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="ui-label">Bodywork · choose a car</span>
              <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-white/22">
                Shown in chase view · press C
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {CAR_MODELS.map((model) => {
                const selected = state.settings.car === model.id;
                return (
                  <button
                    key={model.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => api.setCar(model.id)}
                    className={`group flex min-w-0 flex-col rounded-[5px] border px-3.5 py-3 text-left transition-colors ${
                      selected
                        ? 'border-signal/60 bg-signal/[0.07]'
                        : 'border-white/10 bg-white/[0.015] hover:border-white/20 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span
                        className={`truncate font-display text-[21px] uppercase leading-none tracking-wide ${
                          selected ? 'text-white' : 'text-white/65'
                        }`}
                      >
                        {model.name}
                      </span>
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          selected ? 'bg-signal' : 'bg-white/15 group-hover:bg-white/30'
                        }`}
                      />
                    </div>
                    <span className="mt-2 font-mono text-[8px] uppercase tracking-[0.12em] text-white/28">
                      {model.eyebrow}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            {UPGRADES.map((upgrade, index) => {
              const stage = profile.upgrades[upgrade.id];
              const nextStage = stage + 1;
              const maxed = stage >= 5;
              const locked = !maxed && level.level < nextStage;
              const cost = upgradeCost(upgrade.id, stage);
              const affordable = profile.credits >= cost;

              return (
                <div
                  key={upgrade.id}
                  className="grid gap-4 border-t border-white/[0.06] px-6 py-5 first:border-t-0 sm:grid-cols-[24px_1fr_142px] sm:items-center"
                >
                  <div className="hidden font-mono text-[10px] tabular-nums text-white/20 sm:block">
                    {machineName(index + 1)}
                  </div>

                  <div>
                    <div className="flex flex-wrap items-baseline gap-2.5">
                      <h3 className="font-display text-[26px] uppercase leading-none tracking-wide text-white">
                        {upgrade.name}
                      </h3>
                      <span className="ui-label">Stage {stage} / 5</span>
                    </div>
                    <p className="mt-1.5 max-w-[380px] text-[11px] leading-relaxed text-white/35">
                      {upgrade.blurb}
                    </p>
                    <div className="mt-3 flex items-center gap-1.5">
                      {[1, 2, 3, 4, 5].map((pip) => (
                        <span
                          key={pip}
                          className={`h-[3px] w-7 rounded-full ${pip <= stage ? 'bg-signal' : 'bg-white/10'}`}
                        />
                      ))}
                      <span className="ml-2 font-mono text-[8px] uppercase tracking-[0.14em] text-white/25">
                        {upgrade.effect}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
                    {maxed ? (
                      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-signal">
                        Maxed
                      </span>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[13px] tabular-nums text-white/75">
                            {formatCredits(cost)}
                          </span>
                          <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-white/25">cr</span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          disabled={locked || !affordable}
                          onClick={() => api.buyUpgrade(upgrade.id)}
                        >
                          {locked ? `Level ${nextStage}` : affordable ? 'Install' : 'Need credits'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-6 py-4">
            <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-white/25">
              Upgrades save immediately · stages unlock with driver level · setup carries everywhere
            </span>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => api.closeGarage()}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
