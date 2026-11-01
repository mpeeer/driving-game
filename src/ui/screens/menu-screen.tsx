import { useEffect, useState } from 'react';
import { ArrowRightIcon, TriangleAlertIcon } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Brand } from '../components/brand';
import { LineBadge } from '../components/line-badge';
import { Meter } from '../components/meter';
import { useEngine, useUiStore } from '../context';
import { menuLine } from '../lib/derive';
import { formatHM, money } from '../lib/format';
import { KIND_LABEL, REGIONS, getRegion, lineStations } from '../../content/data';

const TIPS = [
  'Passengers pay more when you arrive on time. They also remember every hard brake.',
  'Every region you unlock opens new generated lines with better fares.',
  'Open the doors only when the train is stopped at a platform and aligned with the stop board.',
  'Regenerative braking recovers energy. Brake gently and early instead of late and hard.',
  'The fifth stop is usually the busiest — expect longer boarding times.',
  'You can reverse the train to correct a missed stop. Passengers will not love it.',
];

export function MenuScreen() {
  const revision = useUiStore((state) => state.revision);
  const { economy, callbacks } = useEngine();
  const [resetOpen, setResetOpen] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTipIndex((current) => (current + 1) % TIPS.length);
    }, 12000);
    return () => window.clearInterval(timer);
  }, []);

  const line = menuLine(economy);
  const region = getRegion(line.regionId);
  const stations = lineStations(line, region);
  const destination = stations[stations.length - 1] ?? 'Terminus';
  const career = economy.data;
  const progress = economy.levelProgress;
  const firstRun = career.totalRuns === 0;

  return (
    <section className="screen screen-menu screen-scroll" data-revision={revision}>
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[1500px] flex-col px-5 py-5 md:px-10 lg:px-14">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Brand />
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="hidden sm:inline-flex">
              Career profile
            </Badge>
            <Button variant="ghost" size="sm" onClick={callbacks.onControls}>
              Controls
            </Button>
          </div>
        </header>

        <div className="grid flex-1 gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-end lg:gap-14">
          <main className="max-w-[760px]">
            <div className="mb-7 flex items-center gap-3">
              <span className="size-1.5 bg-mint shadow-[0_0_0_4px_rgba(101,207,189,0.12)]" />
              <span className="data-label">Network open / {region.name}</span>
              <span className="h-px w-12 bg-border" />
              <span className="data-label">18:42</span>
            </div>

            <h1 className="font-display text-[clamp(3.6rem,15vw,10.2rem)] uppercase leading-[0.74] tracking-[-0.025em] text-paper">
              Railbound
            </h1>

            <div className="mt-6 flex max-w-xl items-start gap-4 border-l border-signal/70 pl-4">
              <p className="text-base leading-relaxed text-paper/80">
                Drive the 06:36 out of Central Quay. Then build the network that comes after.
              </p>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-y border-border/80 py-5 sm:grid-cols-4">
              <MenuFact label="First service" value={formatHM(line.startHour * 3600)} />
              <MenuFact label="Route" value={`${line.lengthKm.toFixed(1)} km`} />
              <MenuFact label="Stations" value={String(line.stationCount).padStart(2, '0')} />
              <MenuFact label="Fleet" value={`${career.ownedTrains.length} trains`} />
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={callbacks.onPlay} className="group min-w-52 justify-between">
                <span>{firstRun ? 'Enter dispatch' : 'Continue career'}</span>
                <ArrowRightIcon data-icon="inline-end" className="transition-transform group-hover:translate-x-0.5" />
              </Button>
              <Button variant="outline" size="lg" onClick={callbacks.onDepot}>
                Depot
              </Button>
              <Button variant="ghost" size="lg" onClick={callbacks.onControls}>
                Driver controls
              </Button>
            </div>

            <p className="mt-4 max-w-lg text-xs leading-relaxed text-fog">
              {firstRun
                ? 'Your first service is ready. The timetable is waiting; the network comes after.'
                : `${career.totalRuns} services logged · ${career.totalKm.toFixed(1)} km run · ${career.totalPassengers.toLocaleString('en-IE')} passengers carried.`}
            </p>
          </main>

          <aside className="w-full max-w-[440px] space-y-4 pb-2 lg:ml-auto">
            <div className="ticket-cut panel p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="data-label">Career record</span>
                <Badge variant="outline">Level {economy.level}</Badge>
              </div>

              <div className="mt-5 flex items-end justify-between gap-4">
                <div>
                  <div className="data-label">Balance</div>
                  <div className="mt-1 font-display text-4xl leading-none text-paper">{money(economy.money)}</div>
                </div>
                <div className="text-right">
                  <div className="data-label">Next level</div>
                  <div className="mt-1 font-mono text-sm text-paper">
                    {Math.round(progress.fraction * 100)}%
                  </div>
                </div>
              </div>

              <Meter value={progress.fraction} className="mt-4" label="Career progress to next level" />

              <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-border/80 pt-4">
                <CareerStat label="Services" value={String(career.totalRuns)} />
                <CareerStat label="Regions" value={`${career.unlockedRegions.length}/${REGIONS.length}`} />
                <CareerStat label="Fleet" value={String(career.ownedTrains.length)} />
              </dl>
            </div>

            <div className="panel-flat p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="data-label">Next departure</span>
                <span className="font-mono text-xs text-signal">{formatHM(line.startHour * 3600)}</span>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <LineBadge code={line.code} color={line.color} size="lg" />
                <div className="min-w-0">
                  <div className="headline truncate text-xl text-paper">{line.name}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {KIND_LABEL[line.kind]} to {destination}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border/80 pt-3">
                <span className="data-label">Platform</span>
                <span className="font-mono text-xs text-paper">CENTRAL QUAY / 2</span>
              </div>
            </div>

            <div className="border-l border-signal/55 pl-4">
              <div className="data-label text-signal">Dispatch note</div>
              <p className="mt-2 text-sm leading-relaxed text-paper/75">{TIPS[tipIndex]}</p>
            </div>

            <div className="flex items-center justify-between gap-4 pt-1">
              <span className="font-mono text-[0.58rem] uppercase tracking-[0.14em] text-fog">
                Local career save
              </span>
              <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
                <AlertDialogTrigger
                  render={
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto px-0 text-[0.68rem] font-normal text-fog hover:text-danger"
                    />
                  }
                >
                  Reset career data
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader className="place-items-start text-left">
                    <AlertDialogMedia className="mb-1">
                      <TriangleAlertIcon />
                    </AlertDialogMedia>
                    <AlertDialogTitle>Reset career data?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Balance, unlocked regions, route rights, rolling stock and upgrade levels will be
                      cleared. The next dispatch starts from the beginning.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep career</AlertDialogCancel>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setResetOpen(false);
                        callbacks.onReset();
                      }}
                    >
                      Reset everything
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </aside>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 py-4">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <FooterFact label="Procedural railway" />
            <FooterFact label="Passenger AI" />
            <FooterFact label="Synthesised audio" />
            <FooterFact label="Endless lines" />
          </div>
          <span className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-fog">
            Harbour City Division / 2026
          </span>
        </footer>
      </div>
    </section>
  );
}

function MenuFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="data-label">{label}</div>
      <div className="mt-1 font-mono text-sm text-paper">{value}</div>
    </div>
  );
}

function CareerStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="data-label">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-paper">{value}</dd>
    </div>
  );
}

function FooterFact({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[0.56rem] uppercase tracking-[0.14em] text-fog">
      <span className="size-1 bg-signal/70" />
      {label}
    </span>
  );
}
