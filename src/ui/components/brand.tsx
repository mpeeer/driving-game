import { cn } from '@/lib/utils';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn('size-10', className)} aria-hidden="true" fill="none">
      <path d="M13 43 20 5" stroke="currentColor" strokeWidth="3.2" />
      <path d="M35 43 28 5" stroke="currentColor" strokeWidth="3.2" />
      <path d="M17 34h14M18.8 24h10.4M20.4 14h7.2" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark className={compact ? 'size-7 text-signal' : 'size-9 text-signal'} />
      <div className="leading-none">
        <div className={cn('font-display uppercase tracking-[0.01em] text-paper', compact ? 'text-xl' : 'text-2xl')}>
          Railbound
        </div>
        <div className="mt-1 font-mono text-[0.55rem] uppercase tracking-[0.2em] text-fog">
          Transit simulator
        </div>
      </div>
    </div>
  );
}
