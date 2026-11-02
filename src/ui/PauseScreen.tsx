import type { ReactNode } from 'react';
import { regionById } from '../game/config';
import { formatTime } from '../game/format';
import type { GameApi } from '../game/api';
import type { CameraMode, UiState, Units, Quality } from '../game/types';

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
            value === option.value ? 'bg-white/12 text-white' : 'text-white/32 hover:text-white/60'
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
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/42">{label}</span>
      {children}
    </div>
  );
}

export function PauseScreen({ api, state }: { api: GameApi; state: UiState }) {
  const region = regionById(state.settings.region);

  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-[#041012]/55 p-4 backdrop-blur-[5px]">
      <div className="ui-panel animate-rise max-h-[92vh] w-full max-w-[400px] overflow-y-auto">
        <div className="border-b border-white/[0.07] px-6 pb-5 pt-6">
          <div className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: region.color }} />
            <span className="ui-label">Parked · {region.name}</span>
          </div>
          <h2 className="mt-3 font-display text-[44px] font-semibold uppercase leading-none tracking-wide text-white">
            Paused
          </h2>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] uppercase tracking-[0.15em] text-white/32">
            <span>{state.profile.laps} island laps</span>
            <span className="text-white/15">/</span>
            <span>{state.profile.credits.toLocaleString('en-US')} credits</span>
            <span className="text-white/15">/</span>
            <span>best {formatTime(state.profile.bestLap)}</span>
            <span className="text-white/15">/</span>
            <span>trial {formatTime(state.profile.bestTrial)}</span>
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
              Restart run
            </button>
          </div>
          <button type="button" className="btn btn-text w-full" onClick={() => api.toMenu()}>
            Return to island map
          </button>
        </div>

        <div className="border-t border-white/[0.07] px-6 py-4">
          <div className="ui-label mb-1">Settings</div>
          <Row label="Camera">
            <Segmented<CameraMode>
              value={state.settings.camera}
              options={[
                { value: 'cockpit', label: 'Cockpit' },
                { value: 'chase', label: 'Chase' },
              ]}
              onChange={(camera) => api.setCamera(camera)}
            />
          </Row>
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
            <Toggle label="Sound" on={!state.settings.muted} onChange={() => api.toggleMute()} />
          </Row>
          <Row label="Camera shake">
            <Toggle
              label="Camera shake"
              on={state.settings.shake}
              onChange={(on) => api.setShake(on)}
            />
          </Row>
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.07] px-6 py-3">
          <span className="ui-label text-white/25">Esc to resume · C camera · M sound</span>
          <span className="font-mono text-[8px] uppercase tracking-[0.13em] text-white/20">adaptive resolution</span>
        </div>
      </div>
    </div>
  );
}
