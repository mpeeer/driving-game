import type { Units } from './types';

export function formatTime(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}

export function formatCredits(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export function formatDistance(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres)} m`;
}

export function displaySpeed(speedKmh: number, units: Units): number {
  return Math.round(units === 'mph' ? speedKmh * 0.621371 : speedKmh);
}

export function machineName(value: number, digits = 2): string {
  return String(Math.max(0, Math.floor(value))).padStart(digits, '0');
}
