import { cn } from '@/lib/utils';
import { useUiStore } from '../context';

export function StopToast() {
  const toast = useUiStore((state) => state.stopToast);
  return (
    <div
      className={cn('stop-toast', toast?.tone, toast ? 'show' : '')}
      role="status"
      aria-live="polite"
    >
      {toast?.message ?? ''}
    </div>
  );
}
