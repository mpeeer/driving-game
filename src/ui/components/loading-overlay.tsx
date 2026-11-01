import { BrandMark } from './brand';
import { useUiStore } from '../context';

export function LoadingOverlay() {
  const loading = useUiStore((state) => state.loading);
  if (!loading) return null;
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="flex w-full max-w-sm flex-col items-center gap-5 px-6 text-center">
        <BrandMark className="size-12 text-signal" />
        <div>
          <div className="headline text-2xl text-paper">Surveying the line</div>
          <div className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-fog">
            Building track geometry
          </div>
        </div>
        <div className="loading-bar" />
      </div>
    </div>
  );
}
