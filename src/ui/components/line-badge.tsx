import { cn } from '@/lib/utils';

type BadgeSize = 'sm' | 'md' | 'lg' | 'xl';

const sizeClass: Record<BadgeSize, string> = {
  sm: 'h-7 min-w-8 px-1.5 text-[0.8rem]',
  md: 'h-9 min-w-10 px-2 text-[1rem]',
  lg: 'h-12 min-w-14 px-2.5 text-[1.35rem]',
  xl: 'h-16 min-w-[4.5rem] px-3 text-[1.8rem]',
};

export function LineBadge({
  code,
  color,
  size = 'md',
  className,
}: {
  code: string;
  color: string;
  size?: BadgeSize;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center font-display font-bold uppercase leading-none tracking-[0.01em] text-ink',
        sizeClass[size],
        className,
      )}
      style={{ backgroundColor: color }}
      aria-label={`Line ${code}`}
    >
      {code}
    </span>
  );
}
