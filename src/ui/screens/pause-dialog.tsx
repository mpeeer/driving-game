import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { LineBadge } from '../components/line-badge';
import { useEngine, useUiStore } from '../context';

type Quality = 'high' | 'medium' | 'low';

export function PauseDialog() {
  const { economy, callbacks } = useEngine();
  const session = useUiStore((state) => state.session);
  const settingsRevision = useUiStore((state) => state.settingsRevision);
  const settings = economy.settings;

  const [volume, setVolume] = useState(settings.volume);
  const [announcements, setAnnouncements] = useState(settings.announcements);
  const [hints, setHints] = useState(settings.showHints);
  const [quality, setQuality] = useState<Quality>(settings.quality);

  void settingsRevision;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) callbacks.onResume();
      }}
    >
      <DialogContent className="sm:max-w-[580px]">
        <DialogHeader>
          <div className="data-label">Service halted / settings</div>
          <DialogTitle className="uppercase">Service paused</DialogTitle>
          <DialogDescription>
            The clock stops while you catch your breath. Change the cab settings or return to the dispatch
            board.
          </DialogDescription>
        </DialogHeader>

        {session ? (
          <div className="flex items-center gap-3 border-y border-border py-3">
            <LineBadge code={session.lineCode} color={session.lineColor} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-paper">{session.lineName}</div>
              <div className="mt-0.5 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fog">
                Service {session.serviceNumber} / {session.stations.length} stations
              </div>
            </div>
            <span className="font-mono text-[0.58rem] uppercase tracking-[0.1em] text-signal">In service</span>
          </div>
        ) : null}

        <section className="space-y-4">
          <div className="data-label">Cab settings</div>

          <label className="block">
            <span className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm text-paper">Master volume</span>
              <span className="font-mono text-[0.62rem] text-fog">{Math.round(volume * 100)}%</span>
            </span>
            <Slider
              value={[volume]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value;
                if (typeof next !== 'number') return;
                setVolume(next);
                callbacks.onVolume(next);
              }}
            />
          </label>

          <div className="grid gap-3 border-t border-border/70 pt-4 sm:grid-cols-2">
            <SettingSwitch
              label="Announcements"
              detail="Station and safety calls"
              checked={announcements}
              onCheckedChange={(checked) => {
                setAnnouncements(checked);
                callbacks.onAnnouncements(checked);
              }}
            />
            <SettingSwitch
              label="Driving hints"
              detail="Coaching in the cab"
              checked={hints}
              onCheckedChange={(checked) => {
                setHints(checked);
                callbacks.onHints(checked);
              }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
            <div>
              <div className="text-sm text-paper">Graphics quality</div>
              <div className="mt-0.5 text-[0.68rem] text-muted-foreground">Shadows and pixel density</div>
            </div>
            <Select
              value={quality}
              onValueChange={(value) => {
                if (value === 'high' || value === 'medium' || value === 'low') {
                  setQuality(value);
                  callbacks.onQuality(value);
                }
              }}
            >
              <SelectTrigger className="w-32" aria-label="Graphics quality">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
            <div>
              <div className="text-sm text-paper">Audio</div>
              <div className="mt-0.5 text-[0.68rem] text-muted-foreground">
                {settings.mute ? 'All game audio is muted' : 'Engine, rail and platform sound'}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={callbacks.onToggleMute}>
              {settings.mute ? 'Unmute all' : 'Mute all'}
            </Button>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button onClick={callbacks.onResume}>Resume service</Button>
          <Button variant="outline" onClick={callbacks.onRestart}>
            Restart run
          </Button>
          <Button variant="ghost" className="ml-auto" onClick={callbacks.onQuit}>
            Leave to dispatch
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingSwitch({
  label,
  detail,
  checked,
  onCheckedChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>
        <span className="block text-sm text-paper">{label}</span>
        <span className="mt-0.5 block text-[0.68rem] text-muted-foreground">{detail}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}
