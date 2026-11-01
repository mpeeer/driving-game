import { clamp } from '../lib/format';

const TICKS = Array.from({ length: 11 }, (_, index) => index);
const START_X = 26;
const START_Y = 126;
const END_X = 234;
const CENTER_X = 130;
const RADIUS = 104;

export function SpeedGauge({
  speed,
  max,
  limit,
  overspeed,
  viewMode,
}: {
  speed: number;
  max: number;
  limit: number;
  overspeed: boolean;
  viewMode: string;
}) {
  const fraction = clamp(speed / Math.max(1, max), 0, 1);
  const limitAngle = Math.PI + clamp(limit / Math.max(1, max), 0, 1) * Math.PI;
  const limitX1 = CENTER_X + Math.cos(limitAngle) * (RADIUS - 10);
  const limitY1 = START_Y + Math.sin(limitAngle) * (RADIUS - 10);
  const limitX2 = CENTER_X + Math.cos(limitAngle) * (RADIUS + 4);
  const limitY2 = START_Y + Math.sin(limitAngle) * (RADIUS + 4);

  return (
    <div
      className="relative flex min-w-0 items-end gap-3"
      role="img"
      aria-label={`Speed ${Math.round(speed)} kilometres per hour, limit ${limit}`}
    >
      <div className="relative w-full max-w-[17rem]">
        <svg viewBox="0 0 260 150" className="block w-full" aria-hidden="true">
          <path
            className="speed-arc speed-arc-track"
            d={`M ${START_X} ${START_Y} A ${RADIUS} ${RADIUS} 0 0 1 ${END_X} ${START_Y}`}
            strokeWidth="7"
            pathLength="100"
          />
          <path
            className={`speed-arc speed-arc-value ${overspeed ? 'over' : ''}`}
            d={`M ${START_X} ${START_Y} A ${RADIUS} ${RADIUS} 0 0 1 ${END_X} ${START_Y}`}
            strokeWidth="7"
            pathLength="100"
            style={{ strokeDasharray: `${fraction * 100} 100` }}
          />
          {TICKS.map((tick) => {
            const angle = Math.PI + (tick / 10) * Math.PI;
            const inner = RADIUS - (tick % 5 === 0 ? 13 : 7);
            const outer = RADIUS - 1;
            return (
              <line
                key={tick}
                x1={CENTER_X + Math.cos(angle) * inner}
                y1={START_Y + Math.sin(angle) * inner}
                x2={CENTER_X + Math.cos(angle) * outer}
                y2={START_Y + Math.sin(angle) * outer}
                stroke={tick % 5 === 0 ? '#8b9ba2' : '#3b4d55'}
                strokeWidth={tick % 5 === 0 ? 1.5 : 1}
              />
            );
          })}
          <line
            x1={limitX1}
            y1={limitY1}
            x2={limitX2}
            y2={limitY2}
            stroke={overspeed ? '#e2745c' : '#e4b05c'}
            strokeWidth="2.5"
          />
          <text
            x={START_X + 2}
            y={START_Y + 16}
            fill="#8b9ba2"
            fontFamily="IBM Plex Mono, monospace"
            fontSize="10"
          >
            0
          </text>
          <text
            x={END_X - 2}
            y={START_Y + 16}
            fill="#8b9ba2"
            textAnchor="end"
            fontFamily="IBM Plex Mono, monospace"
            fontSize="10"
          >
            {max}
          </text>
        </svg>
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center">
          <span className="numeric font-display text-[3.9rem] leading-[0.8] tracking-[-0.02em] text-paper tabular-nums">
            {Math.round(speed)}
          </span>
          <span className="mt-1 font-mono text-[0.58rem] uppercase tracking-[0.2em] text-fog">km/h</span>
        </div>
      </div>
      <div className="mb-2 hidden shrink-0 flex-col gap-2 sm:flex">
        <span className={`flag ${overspeed ? 'danger' : 'on'}`}>{overspeed ? 'Overspeed' : 'Within limit'}</span>
        <span className="font-mono text-[0.58rem] uppercase tracking-[0.14em] text-fog">
          {viewMode} view
        </span>
      </div>
    </div>
  );
}
