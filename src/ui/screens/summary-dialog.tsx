import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LineBadge } from '../components/line-badge';
import { Meter } from '../components/meter';
import { useEngine, useUiStore } from '../context';
import { formatDelay, money } from '../lib/format';

export function SummaryDialog() {
  const summary = useUiStore((state) => state.summary);
  const { economy, callbacks } = useEngine();
  if (!summary) return null;

  const { result, lineColor } = summary;
  const netPositive = result.net >= 0;

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent className="sm:max-w-4xl" showCloseButton={false}>
        <DialogHeader>
          <div className="data-label">Service complete / Operations report</div>
          <div className="flex flex-wrap items-start gap-4">
            <LineBadge code={result.lineCode} color={lineColor} size="lg" />
            <div className="min-w-0 flex-1">
              <DialogTitle className="uppercase">{result.lineName}</DialogTitle>
              <DialogDescription>
                {result.trainName} / {result.stops} stops / {result.distanceKm.toFixed(2)} km
              </DialogDescription>
            </div>
            <Badge variant={netPositive ? 'success' : 'destructive'}>
              {netPositive ? 'Profitable service' : 'Service loss'}
            </Badge>
          </div>
        </DialogHeader>

        <div className="flex flex-wrap items-end justify-between gap-4 border-y border-border py-4">
          <div>
            <div className="data-label">Net result</div>
            <div className={`font-display text-5xl leading-none ${netPositive ? 'text-mint' : 'text-danger'}`}>
              {netPositive ? '+' : ''}
              {money(result.net)}
            </div>
          </div>
          <div className="text-right">
            <div className="data-label">XP earned</div>
            <div className="mt-1 font-mono text-lg text-signal">+{result.xp.toLocaleString('en-IE')}</div>
            <div className="mt-1 flex items-center justify-end gap-2">
              <span className="font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fog">
                Level {result.newLevel}
              </span>
              {result.levelsGained > 0 ? <Badge variant="success">+{result.levelsGained} level</Badge> : null}
            </div>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <SummarySection title="Revenue">
            <SummaryRow label="Fares" value={money(result.fares)} />
            <SummaryRow label="Punctuality" value={money(result.punctualityBonus)} />
            <SummaryRow label="Stop accuracy" value={money(result.accuracyBonus)} />
            <SummaryRow label="Penalties" value={`−${money(result.penalties)}`} negative />
          </SummarySection>
          <SummarySection title="Costs">
            <SummaryRow label="Energy" value={`−${money(result.energyCost)}`} />
            <SummaryRow label="Maintenance" value={`−${money(result.maintenance)}`} />
            <SummaryRow label="Crew" value={`−${money(result.crewCost)}`} />
            <SummaryRow label="Total" value={`${netPositive ? '+' : ''}${money(result.net)}`} emphasis />
          </SummarySection>
          <SummarySection title="Service">
            <SummaryRow label="Passengers" value={String(result.passengers)} />
            <SummaryRow label="Passenger-km" value={Math.round(result.passengerKm).toLocaleString('en-IE')} />
            <SummaryRow label="Perfect stops" value={`${result.perfectStops} / ${result.stops}`} />
            <SummaryRow label="On-time stops" value={`${result.onTimeStops} / ${result.stops}`} />
            <SummaryRow
              label="Average delay"
              value={formatDelay(result.stops ? result.delaySeconds / result.stops : 0)}
            />
            <SummaryRow label="Overspeed events" value={String(result.overspeedEvents)} />
          </SummarySection>
        </div>

        <div className="border border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="data-label">Career progress</div>
            <span className="font-mono text-[0.58rem] text-fog">
              {Math.round(economy.levelProgress.fraction * 100)}% to next level
            </span>
          </div>
          <Meter value={economy.levelProgress.fraction} className="mt-3" label="Career progress" />
          <div className="mt-2 flex flex-wrap justify-between gap-2 font-mono text-[0.58rem] uppercase tracking-[0.08em] text-fog">
            <span>Satisfaction {Math.round(result.satisfaction)}%</span>
            <span>Harsh brakes {result.harshBrakes}</span>
            <span>Duration {Math.round(result.durationSeconds / 60)} min</span>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={callbacks.onRestart}>
            Run it again
          </Button>
          <Button onClick={callbacks.onQuit}>Dispatch board</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummarySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="data-label border-b border-border pb-2">{title}</h3>
      <dl className="mt-2 space-y-1.5">{children}</dl>
    </section>
  );
}

function SummaryRow({
  label,
  value,
  negative = false,
  emphasis = false,
}: {
  label: string;
  value: string;
  negative?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${emphasis ? 'border-t border-border pt-2' : ''}`}>
      <dt className="text-[0.7rem] text-muted-foreground">{label}</dt>
      <dd className={`font-mono text-[0.68rem] ${negative ? 'text-danger' : emphasis ? 'text-signal' : 'text-paper'}`}>
        {value}
      </dd>
    </div>
  );
}
