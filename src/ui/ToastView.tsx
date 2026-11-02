import type { Toast } from '../game/types';

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ToastView({ toast }: { toast: Toast | null }) {
  if (!toast) return null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-[78px] z-40 w-full max-w-[560px] -translate-x-1/2 px-4">
      <div key={toast.id} className="animate-toast hud-shadow mx-auto text-center">
        <div
          className={`text-[12px] leading-tight ${
            toast.kind === 'error' ? 'text-[#d9a99f]' : 'text-white/80'
          }`}
        >
          {titleCase(toast.title)}
        </div>
        {toast.detail && (
          <div className="mt-1 text-balance text-[10px] leading-relaxed text-white/45">
            {toast.detail}
          </div>
        )}
      </div>
    </div>
  );
}
