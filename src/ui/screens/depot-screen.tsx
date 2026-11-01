import type { LucideIcon } from 'lucide-react';
import {
  CircleGaugeIcon,
  LockKeyholeIcon,
  ScanLineIcon,
  SnowflakeIcon,
  WavesIcon,
  ZapIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LineBadge } from '../components/line-badge';
import { Meter } from '../components/meter';
import { ScreenShell } from '../components/screen-shell';
import { useEngine, useUiStore } from '../context';
import { lineAccess, regionAccess, visibleLinesForRegion } from '../lib/derive';
import { clamp, hexColor, money } from '../lib/format';
import { KIND_LABEL, REGIONS, TRAINS, UPGRADES } from '../../content/data';
import type { DepotTab } from '../types';
import { cn } from '@/lib/utils';

const UPGRADE_ICONS: Record<string, LucideIcon> = {
  traction: ZapIcon,
  brakes: CircleGaugeIcon,
  suspension: WavesIcon,
  hvac: SnowflakeIcon,
  trainer: ScanLineIcon,
};

const DEPOT_TABS: { value: DepotTab; label: string; detail: string }[] = [
  { value: 'lines', label: 'Network rights', detail: 'Regions and routes' },
  { value: 'trains', label: 'Rolling stock', detail: 'Traction and capacity' },
  { value: 'upgrades', label: 'Upgrades', detail: 'Depot fit-out' },
];

export function DepotScreen() {
  const depotTab = useUiStore((state) => state.depotTab);
  const revision = useUiStore((state) => state.revision);
  const { economy, callbacks, actions } = useEngine();

  return (
    <ScreenShell
      title="Depot"
      kicker="Harbour City Division / Asset register"
      description="Network rights, rolling stock and depot upgrades. Everything here changes the economics of the next service."
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
      <div data-revision={revision}>
        <Tabs value={depotTab} onValueChange={(value) => {
          if (value === 'lines' || value === 'trains' || value === 'upgrades') actions.setDepotTab(value);
        }} className="gap-0">
          <TabsList variant="line" className="h-auto w-full justify-start gap-6 overflow-x-auto border-b border-border bg-transparent p-0">
            {DEPOT_TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="h-12 shrink-0 rounded-none px-0 text-left data-active:text-signal"
              >
                <span className="flex flex-col items-start gap-0.5">
                  <span className="font-display text-base uppercase tracking-[0.02em]">{tab.label}</span>
                  <span className="font-mono text-[0.52rem] uppercase tracking-[0.1em] text-fog">{tab.detail}</span>
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="lines" className="pt-5">
            <div className="grid gap-4">
              {REGIONS.map((region) => {
                const access = regionAccess(region.id, economy);
                const lines = visibleLinesForRegion(region.id, economy).slice(0, 6);
                return (
                  <section key={region.id} className="panel">
                    <header className="flex flex-wrap items-start gap-4 border-b border-border p-4">
                      <span className="mt-1.5 size-2.5 shrink-0" style={{ backgroundColor: region.accent }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="headline text-2xl text-paper">{region.name}</h2>
                          <Badge variant="secondary">{KIND_LABEL[region.kind]}</Badge>
                        </div>
                        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{region.blurb}</p>
                      </div>
                      {access.owned ? (
                        <Badge variant="success">Access owned</Badge>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!access.canUnlock}
                          onClick={() => callbacks.onUnlockRegion(region.id)}
                        >
                          <LockKeyholeIcon data-icon="inline-start" />
                          Unlock · {money(region.unlockCost)} · L{region.levelReq}
                        </Button>
                      )}
                    </header>
                    <div className="grid md:grid-cols-2">
                      {lines.map((line) => {
                        const route = lineAccess(line, economy);
                        return (
                          <div
                            key={line.id}
                            className="flex items-center gap-3 border-b border-border/70 px-4 py-3 last:border-b-0 md:border-r md:last:border-r-0 md:[&:nth-child(2n)]:border-r-0"
                          >
                            <LineBadge code={line.code} color={line.color} size="sm" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-medium text-paper">{line.name}</div>
                              <div className="mt-0.5 font-mono text-[0.56rem] text-fog">
                                {line.lengthKm.toFixed(1)} km / {line.stationCount} stops
                                {line.generated ? ' / new' : ''}
                              </div>
                            </div>
                            {route.owned ? (
                              <span className="font-mono text-[0.56rem] uppercase tracking-[0.08em] text-mint">Owned</span>
                            ) : route.regionOwned ? (
                              <Button
                                variant="ghost"
                                size="xs"
                                disabled={!route.canUnlock}
                                onClick={() => callbacks.onUnlockLine(line.id)}
                              >
                                {money(line.unlockCost)}
                              </Button>
                            ) : (
                              <span className="font-mono text-[0.56rem] text-fog">L{line.levelReq}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="trains" className="pt-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {TRAINS.map((train) => {
                const owned = economy.ownsTrain(train.id);
                const active = economy.activeTrainId === train.id;
                const canBuy = economy.canBuyTrain(train.id);
                const stats: [string, number][] = [
                  ['Top speed', clamp(train.maxSpeedKph / 330, 0, 1)],
                  ['Traction', clamp(train.maxTEkN / 480, 0, 1)],
                  ['Power', clamp(train.powerKW / 9800, 0, 1)],
                  ['Braking', clamp(train.brakeDecel / 1.5, 0, 1)],
                  ['Comfort', clamp(train.comfort / 5, 0, 1)],
                ];
                return (
                  <article
                    key={train.id}
                    className="panel flex flex-col p-4"
                    style={{ borderTopColor: hexColor(train.accentColor), borderTopWidth: 2 }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="data-label">{train.maker}</span>
                      <Badge variant="secondary">{train.traction}</Badge>
                    </div>
                    <h2 className="headline mt-3 text-2xl text-paper">{train.name}</h2>
                    <p className="mt-2 min-h-12 text-xs leading-relaxed text-muted-foreground">{train.blurb}</p>
                    <div className="mt-4 space-y-2">
                      {stats.map(([label, value]) => (
                        <div key={label} className="grid grid-cols-[4.8rem_1fr] items-center gap-2">
                          <span className="font-mono text-[0.55rem] uppercase tracking-[0.1em] text-fog">{label}</span>
                          <Meter value={value} tone={label === 'Comfort' ? 'mint' : 'signal'} />
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-y border-border/70 py-2 font-mono text-[0.58rem] text-fog">
                      <span>{train.cars} cars</span>
                      <span>{train.maxSpeedKph} km/h</span>
                      <span>{train.maxTEkN} kN</span>
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                      <div>
                        <div className="data-label">{owned ? 'Fleet status' : 'Price'}</div>
                        <div className="mt-1 font-mono text-sm text-paper">{owned ? (active ? 'In service' : 'Available') : money(train.price)}</div>
                      </div>
                      {owned ? (
                        active ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => callbacks.onSelectTrain(train.id)}>
                            Select
                          </Button>
                        )
                      ) : (
                        <Button
                          size="sm"
                          disabled={!canBuy.ok}
                          title={canBuy.reason || undefined}
                          onClick={() => callbacks.onBuyTrain(train.id)}
                        >
                          {canBuy.ok ? 'Buy train' : canBuy.reason || 'Locked'}
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="upgrades" className="pt-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {UPGRADES.map((upgrade) => {
                const level = economy.upgradeLevel(upgrade.id);
                const cost = economy.upgradeCost(upgrade.id);
                const maxed = level >= upgrade.maxLevel;
                const Icon = UPGRADE_ICONS[upgrade.id] ?? ZapIcon;
                return (
                  <article key={upgrade.id} className="panel flex flex-col p-4">
                    <div className="flex items-start justify-between gap-3">
                      <span className="grid size-9 place-items-center border border-signal/30 bg-signal/10 text-signal">
                        <Icon className="size-4" />
                      </span>
                      <span className="font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fog">
                        {level}/{upgrade.maxLevel}
                      </span>
                    </div>
                    <h2 className="headline mt-3 text-2xl text-paper">{upgrade.name}</h2>
                    <p className="mt-2 min-h-12 text-xs leading-relaxed text-muted-foreground">{upgrade.desc}</p>
                    <div className="mt-3 flex gap-1" aria-label={`Level ${level} of ${upgrade.maxLevel}`}>
                      {Array.from({ length: upgrade.maxLevel }, (_, index) => (
                        <span
                          key={index}
                          className={cn('h-1.5 flex-1', index < level ? 'bg-signal' : 'bg-[#263840]')}
                        />
                      ))}
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-3 border-t border-border/70 pt-4">
                      <div>
                        <div className="data-label">{maxed ? 'Status' : 'Next level'}</div>
                        <div className="mt-1 font-mono text-sm text-paper">{maxed ? 'Complete' : money(cost)}</div>
                      </div>
                      <Button
                        size="sm"
                        variant={maxed ? 'outline' : 'default'}
                        disabled={maxed || economy.money < cost}
                        onClick={() => callbacks.onBuyUpgrade(upgrade.id)}
                      >
                        {maxed ? 'Maxed' : 'Install'}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </ScreenShell>
  );
}
