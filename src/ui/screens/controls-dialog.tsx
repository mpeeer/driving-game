import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useEngine } from '../context';

const CONTROL_GROUPS: { title: string; detail: string; keys: [string, string][] }[] = [
  {
    title: 'Driving',
    detail: 'Power and brake are notched independently.',
    keys: [
      ['W / ↑', 'Increase power'],
      ['S / ↓', 'Increase brake'],
      ['Z', 'Throttle to coast'],
      ['X', 'Release brake'],
      ['E', 'Emergency brake'],
      ['R', 'Change reverser'],
    ],
  },
  {
    title: 'At the platform',
    detail: 'Stop on the board before releasing the doors.',
    keys: [
      ['D', 'Open / close doors'],
      ['SPACE', 'Horn'],
      ['H', 'Headlights'],
      ['F', 'Wipers'],
    ],
  },
  {
    title: 'View & system',
    detail: 'The camera is independent of the train controls.',
    keys: [
      ['C', 'Change camera'],
      ['Mouse drag', 'Look around'],
      ['Wheel', 'Zoom camera'],
      ['ESC', 'Pause'],
    ],
  },
];

export function ControlsDialog() {
  const { callbacks } = useEngine();
  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) callbacks.onCloseControls();
    }}>
      <DialogContent className="sm:max-w-3xl" showCloseButton>
        <DialogHeader>
          <div className="data-label">Reference / Driver controls</div>
          <DialogTitle className="uppercase">Take the desk</DialogTitle>
          <DialogDescription>
            Railbound is driven with the keyboard. Start gently, brake early, and only release the doors when
            the train is aligned with the stop board.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 sm:grid-cols-3">
          {CONTROL_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="headline text-xl text-paper">{group.title}</h3>
              <p className="mt-1 min-h-8 text-[0.68rem] leading-relaxed text-muted-foreground">{group.detail}</p>
              <dl className="mt-3 space-y-2">
                {group.keys.map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
                    <dt>
                      <kbd>{key}</kbd>
                    </dt>
                    <dd className="text-right text-[0.68rem] text-paper/75">{label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <div className="border-l border-signal/60 pl-4">
          <div className="data-label text-signal">Stop discipline</div>
          <p className="mt-1.5 text-xs leading-relaxed text-paper/70">
            Real train driving is about planning. Aim for the middle of the platform and let the train settle;
            a gentle stop is worth more than an early one.
          </p>
        </div>

        <div className="flex justify-end border-t border-border pt-4">
          <Button onClick={callbacks.onCloseControls}>Back to the cab</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
