import { useEffect, useRef } from 'react';
import {
  AlertTriangleIcon,
  CameraIcon,
  DoorOpenIcon,
  LightbulbIcon,
  PauseIcon,
  RadioIcon,
  RotateCcwIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LineBadge } from '../components/line-badge';
import { Meter } from '../components/meter';
import { SpeedGauge } from '../components/speed-gauge';
import { useEngine, useUiStore } from '../context';
import { clamp, formatClock, formatDistance, formatHM, money, routeProgress, signedDelay } from '../lib/format';
import { cn } from '@/lib/utils';

export function DrivingHud() {
  const session = useUiStore((state) => state.session);
  const hud = useUiStore((state) => state.hud);
  const { callbacks } = useEngine();
  const routeListRef = useRef<HTMLDivElement>(null);

  const routeKey = hud?.route.map((stop) => stop.state[0]).join('') ?? '';
  useEffect(() => {
    const container = routeListRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) return;
    const top = active.offsetTop - container.clientHeight / 2 + active.offsetHeight / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [routeKey]);

  if (!session || !hud) return null;

  const load = clamp(hud.passengers / Math.max(1, hud.capacity), 0, 1);
  const stopProgress = hud.nextStationName ? clamp(1 - hud.distanceToNext / 1200, 0, 1) : 1;
  const delayClass = Math.abs(hud.delaySec) < 20 ? 'text-mint' : hud.delaySec > 45 ? 'text-danger' : 'text-signal';
  const routeStops = hud.route.length;
  const passedStops = hud.route.filter((stop) => stop.state === 'passed').length;

  return (
    <div className="hud-root">
      <header className="hud-top">
        <div className="hud-top-rule absolute inset-x-0 bottom-0" />
        <div className="flex min-w-0 items-center gap-3">
          <LineBadge code={session.lineCode} color={session.lineColor} size="md" />
          <div className="min-w-0">
            <div className="headline truncate text-xl text-paper md:text-2xl">{session.lineName}</div>
            <div className="mt-0.5 truncate font-mono text-[0.58rem] uppercase tracking-[0.12em] text-fog">
              Service {session.serviceNumber} / to {session.destination}
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3 md:gap-5">
          <div className="hidden text-right sm:block">
            <div className="font-mono text-lg text-paper numeric">{formatClock(hud.clock)}</div>
            <div className={cn('font-mono text-[0.56rem] uppercase tracking-[0.1em]', delayClass)}>
              {signedDelay(hud.delaySec)}
            </div>
          </div>
          <div className="hidden h-9 w-px bg-border lg:block" />
          <div className="hidden text-right lg:block">
            <div className="font-mono text-sm text-signal">{money(hud.money)}</div>
            <div className="mt-0.5 font-mono text-[0.56rem] uppercase tracking-[0.1em] text-fog">
              Level {hud.level}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="hud-interactive shrink-0"
            onClick={callbacks.onPause}
            aria-label="Pause service"
            title="Pause (Esc)"
          >
            <PauseIcon />
          </Button>
        </div>
      </header>

      <div className="absolute left-3 right-3 top-[4.15rem] z-10 md:hidden">
        <div className="hud-surface flex items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <div className="data-label">Next stop</div>
            <div className="headline mt-0.5 truncate text-2xl text-paper">
              {hud.nextStationName || 'Terminus'}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-sm text-paper">
              {hud.nextStationName ? formatDistance(hud.distanceToNext) : '—'}
            </div>
            <div className="mt-0.5 font-mono text-[0.55rem] uppercase tracking-[0.1em] text-fog">
              {hud.nextStationName ? `Sched ${formatHM(hud.nextStationScheduled)}` : 'Service complete'}
            </div>
          </div>
        </div>
      </div>

      <aside className="absolute bottom-[13.5rem] left-4 top-24 hidden w-52 flex-col xl:flex">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
          <span className="data-label">Route</span>
          <span className="font-mono text-[0.6rem] text-signal">{routeProgress(hud.progress)}</span>
        </div>
        <div ref={routeListRef} className="relative mt-2 flex-1 overflow-y-auto pr-2">
          {hud.route.map((stop, index) => (
            <div
              key={`${stop.name}-${index}`}
              className="route-stop"
              data-state={stop.state}
              data-active={stop.state === 'current' || stop.state === 'next'}
            >
              <span className="route-dot" />
              <span className="min-w-0 truncate text-[0.7rem]">{stop.name}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2 font-mono text-[0.55rem] uppercase tracking-[0.09em] text-fog">
          <span>{passedStops} passed</span>
          <span>{routeStops} stops</span>
        </div>
      </aside>

      <div className="absolute right-4 top-24 hidden w-[min(22rem,calc(100vw-2rem))] flex-col gap-2.5 md:flex">
        <section className="hud-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="data-label">Next stop</span>
            <Badge variant={hud.signal === 'clear' ? 'success' : 'default'}>
              {hud.signal === 'clear' ? 'Clear' : 'Caution'}
            </Badge>
          </div>
          <div className="headline mt-2 truncate text-3xl text-paper">
            {hud.nextStationName || 'Terminus'}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-fog">
            <span>{hud.nextStationName ? formatDistance(hud.distanceToNext) : 'End of line'}</span>
            <span>{hud.nextStationName ? `Sched ${formatHM(hud.nextStationScheduled)}` : 'Complete'}</span>
          </div>
          <Meter value={stopProgress} className="mt-3" label="Progress to next stop" />
          <p className="mt-2.5 text-[0.68rem] leading-relaxed text-paper/65">
            {hud.stopHint || hud.hint}
          </p>
        </section>

        <section className="hud-surface flex items-center gap-4 p-3.5">
          <div className={cn('limit-sign', hud.overspeed && 'over')}>
            <span className="font-display text-3xl leading-none text-[#131a1d]">{hud.limit}</span>
            <span className="absolute bottom-1.5 font-mono text-[0.48rem] uppercase tracking-[0.1em] text-[#394043]">
              km/h
            </span>
          </div>
          <div className="min-w-0">
            <div className="data-label">Line limit</div>
            <div className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-paper">
              Advisory {hud.advisory}
            </div>
            <div className="mt-1 text-[0.65rem] leading-relaxed text-muted-foreground">
              {hud.nextRestriction
                ? `${hud.nextRestriction.limit} km/h in ${Math.max(0, Math.round(hud.nextRestrictionDist))} m`
                : 'No restriction ahead'}
            </div>
          </div>
        </section>

        <section className="hud-surface p-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="data-label">Passengers</span>
            <span className="font-mono text-[0.6rem] text-fog">{Math.round(load * 100)}%</span>
          </div>
          <div className="mt-1 flex items-end justify-between gap-3">
            <span className="font-display text-3xl leading-none text-paper">{hud.passengers}</span>
            <span className="font-mono text-[0.6rem] text-fog">/ {hud.capacity}</span>
          </div>
          <Meter value={load} tone={load > 0.9 ? 'danger' : 'mint'} className="mt-2" label="Train load" />
          <div className="mt-2 text-[0.64rem] text-muted-foreground">
            {hud.boarding ? `Boarding / ${hud.waiting} on the platform` : hud.doorsOpen ? 'Doors open' : `${hud.waiting} waiting at ${hud.stationName}`}
          </div>
        </section>
      </div>

      <section className="hud-console">
        <div className="flex min-w-0 flex-col justify-end">
          <div className="mb-1 flex items-center gap-2">
            <span className="data-label">Speed</span>
            <span className="h-px flex-1 bg-border" />
            <span className="font-mono text-[0.55rem] uppercase tracking-[0.1em] text-fog">
              {hud.speedKph > hud.limit + 5 ? 'Limit exceeded' : `Limit ${hud.limit}`}
            </span>
          </div>
          <SpeedGauge
            speed={hud.speedKph}
            max={hud.maxSpeedKph}
            limit={hud.limit}
            overspeed={hud.overspeed}
            viewMode={hud.viewMode}
          />
        </div>

        <div className="flex min-w-0 flex-col justify-end gap-3">
          <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
            <span className="data-label">Drive desk</span>
            <span className="font-mono text-[0.55rem] uppercase tracking-[0.1em] text-fog">
              {hud.emergency ? 'Emergency applied' : hud.doorsMoving ? 'Doors moving' : 'Ready'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Notch label="Power" value={hud.powerNotch} max={4} />
            <Notch label="Brake" value={hud.brakeNotch} max={5} brake />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className={cn('flag', hud.doorsOpen && 'on', hud.doorsMoving && 'warn')}>
              {hud.doorsOpen ? 'Doors open' : hud.doorsMoving ? 'Doors moving' : 'Doors shut'}
            </span>
            <span className={cn('flag', hud.emergency && 'danger')}>Emergency</span>
            <span className={cn('flag', hud.slip && 'warn')}>Wheelslip</span>
            <span className={cn('flag', hud.headlights > 0 && 'on', hud.headlights === 2 && 'warn')}>
              Lights {hud.headlights === 0 ? 'off' : hud.headlights === 1 ? 'dipped' : 'full'}
            </span>
            {hud.wet > 0.3 ? <span className="flag warn">Wet rail</span> : null}
          </div>
          <div className="border-l border-signal/55 pl-3 text-[0.68rem] leading-relaxed text-paper/65">
            {hud.hint}
          </div>
        </div>

        <div className="flex min-w-0 flex-col justify-end gap-2">
          <div className="grid grid-cols-3 gap-2">
            <DeskButton
              kbd="D"
              label={hud.doorsOpen ? 'Close doors' : 'Open doors'}
              onClick={callbacks.onDoors}
              variant={hud.doorsOpen ? 'outline' : 'default'}
            >
              <DoorOpenIcon className="size-4" />
            </DeskButton>
            <DeskButton kbd="SPACE" label="Horn" hold onHorn={callbacks.onHorn}>
              <RadioIcon className="size-4" />
            </DeskButton>
            <DeskButton kbd="H" label="Lights" onClick={callbacks.onLights}>
              <LightbulbIcon className="size-4" />
            </DeskButton>
            <DeskButton kbd="C" label="Camera" onClick={callbacks.onCamera}>
              <CameraIcon className="size-4" />
            </DeskButton>
            <DeskButton kbd="R" label="Reverser" onClick={callbacks.onReverse}>
              <RotateCcwIcon className="size-4" />
            </DeskButton>
            <DeskButton
              kbd="E"
              label="Emergency"
              variant={hud.emergency ? 'destructive' : 'outline'}
              onClick={callbacks.onEmergency}
            >
              <AlertTriangleIcon className="size-4" />
            </DeskButton>
          </div>
        </div>
      </section>
    </div>
  );
}

function Notch({
  label,
  value,
  max,
  brake = false,
}: {
  label: string;
  value: number;
  max: number;
  brake?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="data-label">{label}</span>
        <span className="font-display text-2xl leading-none text-paper">
          {value}
          <span className="ml-1 font-mono text-[0.55rem] text-fog">/{max}</span>
        </span>
      </div>
      <div className="mt-2 flex gap-1">
        {Array.from({ length: max }, (_, index) => (
          <span
            key={index}
            className={cn('notam-pip flex-1', index < value && 'on', brake && 'brake')}
          />
        ))}
      </div>
    </div>
  );
}

function DeskButton({
  kbd,
  label,
  children,
  onClick,
  hold = false,
  onHorn,
  variant = 'outline',
}: {
  kbd: string;
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  hold?: boolean;
  onHorn?: (down: boolean) => void;
  variant?: 'default' | 'outline' | 'destructive';
}) {
  return (
    <Button
      variant={variant}
      className="hud-interactive h-[4.1rem] flex-col gap-1 px-2"
      onClick={hold ? undefined : onClick}
      onPointerDown={
        hold
          ? (event) => {
              event.preventDefault();
              onHorn?.(true);
            }
          : undefined
      }
      onPointerUp={hold ? () => onHorn?.(false) : undefined}
      onPointerLeave={hold ? () => onHorn?.(false) : undefined}
      onPointerCancel={hold ? () => onHorn?.(false) : undefined}
      aria-label={label}
    >
      {children}
      <span className="text-[0.66rem] leading-none">{label}</span>
      <span className="font-mono text-[0.5rem] uppercase tracking-[0.1em] text-fog">{kbd}</span>
    </Button>
  );
}
