import { clamp, formatClock, formatDistance, formatHM, money } from '../../core/util';

export { money, formatClock, formatHM, formatDistance, clamp };

export function formatDelay(seconds: number): string {
  const s = Math.abs(Math.round(seconds));
  const minutes = Math.floor(s / 60);
  return minutes > 0 ? `${minutes}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

export function signedDelay(seconds: number): string {
  if (Math.abs(seconds) < 20) return 'On time';
  const label = formatDelay(seconds);
  return seconds > 0 ? `+${label} late` : `−${label} early`;
}

export function formatKm(km: number): string {
  return `${km.toFixed(1)} km`;
}

export function formatSpeed(kph: number): string {
  return String(Math.round(kph));
}

export function hexColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

export function routeProgress(progress: number): string {
  return `${Math.round(clamp(progress, 0, 1) * 100)}%`;
}
