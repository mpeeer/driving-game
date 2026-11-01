import { cn } from '@/lib/utils';
import { clamp } from '../lib/format';

type MeterTone = 'signal' | 'mint' | 'danger' | 'muted';

const toneClass: Record<MeterTone, string> = {
  signal: 'bg-signal',
  mint: 'bg-mint',
  danger: 'bg-danger',
  muted: 'bg-fog/50',
};

export function Meter({
  value,
  tone = 'signal',
  className,
  label,
}: {
  value: number;
  tone?: MeterTone;
  className?: string;
  label?: string;
}) {
  const pct = clamp(value, 0, 1) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn('h-1 w-full overflow-hidden bg-[#22333a]', className)}
    >
      <div
        className={cn('h-full transition-[width] duration-150', toneClass[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
