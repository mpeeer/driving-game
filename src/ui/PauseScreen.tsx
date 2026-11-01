import type { ReactNode } from 'react';
import type { GameApi } from '../game/api';
import type { UiState, Units, Quality } from '../game/types';

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex rounded border border-white/10 bg-black/20 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded px-2 py-1 font-mono text-[8px] uppercase tracking-[0.14em] transition-colors ${
            value === option.value ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-[18px] w-[34px] rounded-full border transition-colors ${
        on ? 'border-signal/50 bg-signal/20' : 'border-white/15 bg-black/30'
      }`}
    >
      <span
        className={`absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all ${
          on ? 'left-[18px] bg-signal' : 'left-[3px] bg-white/35'
        }`}
      />
    </button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40">{label}</span>
      {children}
    </div>
  );
}

export function PauseScreen({ api, state }: { api: GameApi; state: UiState }) {
  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-[#03050a]/60 p-4 backdrop-blur-[6px]">
      <div className="ui-panel animate-rise max-h-[92vh] w-full max-w-[390px] overflow-y-auto">
        <div className="border-b border-white/[0.06] px-6 pb-5 pt-6">
          <div className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-signal" />
            <span className="ui-label">Holding position</span>
          </div>
          <h2 className="mt-3 font-display text-[42px] font-semibold uppercase leading-none tracking-wide text-white">
            Paused
          </h2>
          <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-white/30">
            {state.profile.laps} laps · {state.profile.credits.toLocaleString('en-US')} credits
          </p>
        </div>

        <div className="flex flex-col gap-2 px-6 py-5">
          <button type="button" className="btn btn-primary w-full" onClick={() => api.resume()}>
            Resume drive
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => api.openGarage('paused')}>
              Garage
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => api.restartRun()}>
              Restart
            </button>
          </div>
          <button type="button" className="btn btn-text w-full" onClick={() => api.toMenu()}>
            Return to menu
          </button>
        </div>

        <div className="border-t border-white/[0.06] px-6 py-4">
          <div className="ui-label mb-1">Settings</div>
          <Row label="Units">
            <Segmented<Units>
              value={state.settings.units}
              options={[
                { value: 'kmh', label: 'KM/H' },
                { value: 'mph', label: 'MPH' },
              ]}
              onChange={(units) => api.setUnits(units)}
            />
          </Row>
          <Row label="Quality">
            <Segmented<Quality>
              value={state.settings.quality}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Med' },
                { value: 'high', label: 'High' },
              ]}
              onChange={(quality) => api.setQuality(quality)}
            />
          </Row>
          <Row label="Sound">
            <Toggle
              label="Sound"
              on={!state.settings.muted}
              onChange={() => api.toggleMute()}
            />
          </Row>
          <Row label="Camera shake">
            <Toggle
              label="Camera shake"
              on={state.settings.shake}
              onChange={(on) => api.setShake(on)}
            />
          </Row>
        </div>

        <div className="border-t border-white/[0.06] px-6 py-3 text-center">
          <span className="ui-label text-white/25">Esc to resume · M sound</span>
        </div>
      </div>
    </div>
  );
}
