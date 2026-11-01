import type { Toast } from '../game/types';

const ACCENT: Record<Toast['kind'], string> = {
  sector: 'bg-signal',
  lap: 'bg-ice',
  level: 'bg-signal',
  error: 'bg-[#ff6f61]',
  info: 'bg-white/50',
};

export function ToastView({ toast }: { toast: Toast | null }) {
  if (!toast) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[92px] z-40 w-full max-w-[520px] -translate-x-1/2 px-4">
      <div
        key={toast.id}
        className="animate-toast mx-auto flex w-fit min-w-[270px] max-w-full items-center gap-3 rounded-md border border-white/10 bg-[#05080d]/88 px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,0.65)] backdrop-blur-md"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ACCENT[toast.kind]}`} />
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/90">{toast.title}</div>
          {toast.detail && (
            <div className="mt-1 truncate font-mono text-[9px] uppercase tracking-[0.16em] text-white/40">
              {toast.detail}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
