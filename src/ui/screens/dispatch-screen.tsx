import { CheckIcon, LockKeyholeIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LineBadge } from '../components/line-badge';
import { LineMap } from '../components/line-map';
import { ScreenShell } from '../components/screen-shell';
import { useEngine, useUiStore } from '../context';
import { lineAccess, ownedTrains, regionAccess, visibleLinesForRegion } from '../lib/derive';
import { formatHM, money } from '../lib/format';
import {
  KIND_LABEL,
  REGIONS,
  getLine,
  getRegion,
  lineStations,
} from '../../content/data';
import { cn } from '@/lib/utils';

export function DispatchScreen() {
  const selectedRegion = useUiStore((state) => state.selectedRegion);
  const selectedLineId = useUiStore((state) => state.selectedLineId);
  const revision = useUiStore((state) => state.revision);
  const { economy, callbacks, actions } = useEngine();

  const region = getRegion(selectedRegion);
  const lines = visibleLinesForRegion(selectedRegion, economy);
  const selected = getLine(selectedLineId) ?? lines[0] ?? null;
  const access = selected ? lineAccess(selected, economy) : null;
  const selectedRegionAccess = regionAccess(region.id, economy);
  const stations = selected ? lineStations(selected, getRegion(selected.regionId)) : [];
  const trains = ownedTrains(economy);
  const activeTrain = trains.find((train) => train.id === economy.activeTrainId) ?? trains[0];

  return (
    <ScreenShell
      title="Service dispatch"
      kicker="Harbour City Division / Working timetable"
      description="Pick a route and a train. Route rights and regional access are checked before the service enters the timetable."
      onBack={callbacks.onMenu}
      actions={
        <div className="flex items-center gap-2">
          <span className="hidden font-mono text-[0.6rem] uppercase tracking-[0.14em] text-fog sm:inline">
            Balance
          </span>
          <span className="font-mono text-sm text-signal">{money(economy.money)}</span>
          <Badge variant="secondary">Level {economy.level}</Badge>
        </div>
      }
    >
      <div className="flex flex-col gap-5" data-revision={revision}>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-3">
          {REGIONS.map((entry) => {
            const entryAccess = regionAccess(entry.id, economy);
            const active = entry.id === region.id;
            return (
              <button
                type="button"
                key={entry.id}
                onClick={() => actions.selectRegion(entry.id)}
                aria-pressed={active}
                className={cn(
                  'flex shrink-0 items-center gap-2 border px-3 py-2 font-mono text-[0.62rem] uppercase tracking-[0.12em] transition-colors',
                  active
                    ? 'border-signal/60 bg-signal/10 text-paper'
                    : 'border-border bg-transparent text-muted-foreground hover:border-fog/60 hover:text-paper',
                )}
              >
                <span className="size-1.5" style={{ backgroundColor: entry.accent }} />
                {entry.name}
                {entryAccess.owned ? (
                  <CheckIcon className="size-3 text-mint" aria-label="Network unlocked" />
                ) : (
                  <LockKeyholeIcon className="size-3 text-fog" aria-label="Network locked" />
                )}
              </button>
            );
          })}
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(300px,370px)_minmax(0,1fr)] xl:items-start">
          <section className="panel-flat flex min-h-0 flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <div className="data-label">{KIND_LABEL[region.kind]} network</div>
                <h2 className="headline mt-1 text-xl text-paper">{region.name}</h2>
              </div>
              <span className="font-mono text-[0.62rem] text-fog">{lines.length} services</span>
            </div>
            <div className="screen-scroll max-h-[min(62dvh,42rem)]">
              {lines.map((entry) => {
                const entryAccess = lineAccess(entry, economy);
                const active = selected?.id === entry.id;
                return (
                  <Button
                    key={entry.id}
                    variant="ghost"
                    onClick={() => actions.selectLine(entry.id)}
                    aria-pressed={active}
                    className={cn(
                      'h-auto w-full justify-start gap-3 rounded-none border-b border-border/70 px-3.5 py-3 text-left whitespace-normal hover:bg-white/[0.04]',
                      active && 'bg-white/[0.055]',
                    )}
                  >
                    <LineBadge code={entry.code} color={entry.color} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.82rem] font-medium text-paper">{entry.name}</span>
                      <span className="mt-0.5 block text-[0.66rem] text-muted-foreground">
                        {entry.lengthKm.toFixed(1)} km / {entry.stationCount} stops
                        {entry.generated ? ' / new survey' : ''}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'shrink-0 font-mono text-[0.58rem] uppercase tracking-[0.08em]',
                        entryAccess.owned ? 'text-mint' : 'text-fog',
                      )}
                    >
                      {entryAccess.owned ? 'Ready' : entryAccess.regionOwned ? money(entry.unlockCost) : 'Region'}
                    </span>
                  </Button>
                );
              })}
            </div>
            {!selectedRegionAccess.owned ? (
              <div className="border-t border-border bg-signal/[0.04] p-4">
                <div className="data-label text-signal">Regional access required</div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{selectedRegionAccess.reason}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  disabled={!selectedRegionAccess.canUnlock}
                  onClick={() => callbacks.onUnlockRegion(region.id)}
                >
                  <LockKeyholeIcon data-icon="inline-start" />
                  Unlock {region.name} · {money(region.unlockCost)}
                </Button>
              </div>
            ) : null}
          </section>

          {selected && access ? (
            <section className="panel min-w-0">
              <div className="flex flex-wrap items-start gap-4 border-b border-border p-5">
                <LineBadge code={selected.code} color={selected.color} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="data-label">
                    {KIND_LABEL[selected.kind]} / {region.name}
                  </div>
                  <h2 className="headline mt-1 text-3xl text-paper">{selected.name}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    {selected.blurb}
                  </p>
                </div>
                <Badge variant={access.owned ? 'success' : 'secondary'}>
                  {access.owned ? 'Route rights owned' : 'Route locked'}
                </Badge>
              </div>

              <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
                <div className="min-w-0">
                  <LineMap line={selected} region={region} />

                  <div className="mt-4 grid grid-cols-3 divide-x divide-border border-y border-border/80 py-3">
                    <RouteFact label="Distance" value={`${selected.lengthKm.toFixed(1)} km`} />
                    <RouteFact label="Stations" value={String(selected.stationCount).padStart(2, '0')} />
                    <RouteFact label="Line speed" value={`${selected.maxSpeedKph} km/h`} />
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="data-label">Station sequence</span>
                      <span className="font-mono text-[0.58rem] text-fog">{stations.length} stops</span>
                    </div>
                    <ol className="mt-2 grid max-h-56 grid-cols-1 gap-x-6 overflow-y-auto pr-2 sm:grid-cols-2">
                      {stations.map((station, index) => (
                        <li
                          key={`${station}-${index}`}
                          className="flex items-baseline gap-2 border-b border-border/50 py-1.5"
                        >
                          <span className="w-5 shrink-0 font-mono text-[0.58rem] text-fog">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <span className="truncate text-xs text-paper/80">{station}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                <aside className="flex min-w-0 flex-col gap-3">
                  <div className="panel-flat p-4">
                    <div className="data-label">Service facts</div>
                    <dl className="mt-3 space-y-2">
                      <FactRow label="First departure" value={formatHM(selected.startHour * 3600)} />
                      <FactRow label="Fare index" value={`×${selected.fareMultiplier.toFixed(2)}`} />
                      <FactRow label="Traction" value={region.traction === 'electric' ? 'Electric' : 'Diesel'} />
                      <FactRow label="Route rights" value={access.owned ? 'Owned' : money(selected.unlockCost)} />
                    </dl>
                  </div>

                  <div className="panel-flat p-4">
                    <label className="data-label" htmlFor="dispatch-train">
                      Assigned train
                    </label>
                    <Select
                      value={activeTrain?.id}
                      onValueChange={(value) => {
                        if (typeof value === 'string') callbacks.onSelectTrain(value);
                      }}
                    >
                      <SelectTrigger id="dispatch-train" className="mt-2 h-9 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {trains.map((train) => (
                            <SelectItem key={train.id} value={train.id}>
                              {train.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="sm" className="mt-2 w-full justify-start px-0" onClick={callbacks.onDepot}>
                      Manage rolling stock
                    </Button>
                  </div>

                  <div className="border-t border-border pt-3">
                    <div className="data-label">{access.owned ? 'Ready to depart' : 'Access check'}</div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{access.reason}</p>
                    {!access.owned && access.regionOwned ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full"
                        disabled={!access.canUnlock}
                        onClick={() => callbacks.onUnlockLine(selected.id)}
                      >
                        <LockKeyholeIcon data-icon="inline-start" />
                        Unlock route · {money(selected.unlockCost)}
                      </Button>
                    ) : null}
                    {!access.regionOwned ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full"
                        disabled={!selectedRegionAccess.canUnlock}
                        onClick={() => callbacks.onUnlockRegion(region.id)}
                      >
                        <LockKeyholeIcon data-icon="inline-start" />
                        Unlock {region.name}
                      </Button>
                    ) : null}
                  </div>
                </aside>
              </div>

              <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-[#080d10]/95 p-4 backdrop-blur-md">
                <div className="flex items-center gap-3">
                  <span className="size-1.5 bg-signal" />
                  <div>
                    <div className="data-label">Assigned traction</div>
                    <div className="mt-1 text-sm text-paper">{activeTrain?.name ?? 'No train available'}</div>
                  </div>
                </div>
                <Button
                  size="lg"
                  disabled={!access.owned}
                  onClick={() => callbacks.onStartService(selected.id)}
                  className="min-w-44 justify-between"
                >
                  {access.owned ? `Start ${selected.code} service` : 'Route locked'}
                </Button>
              </div>
            </section>
          ) : (
            <div className="panel grid min-h-72 place-items-center p-8 text-center">
              <div>
                <div className="headline text-2xl text-paper">No service selected</div>
                <p className="mt-2 text-sm text-muted-foreground">Choose a line from the working timetable.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </ScreenShell>
  );
}

function RouteFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 first:pl-0 last:pr-0">
      <div className="data-label">{label}</div>
      <div className="mt-1 font-mono text-sm text-paper">{value}</div>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-[0.68rem] text-paper">{value}</dd>
    </div>
  );
}
