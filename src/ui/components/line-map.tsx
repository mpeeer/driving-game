import { useEffect, useMemo, useRef } from 'react';
import { buildTrackPlan } from '../../world/trackPlan';
import type { LineDef, RegionDef } from '../../content/data';
import { cn } from '@/lib/utils';

export function LineMap({
  line,
  region,
  className,
}: {
  line: LineDef;
  region: RegionDef;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const plan = useMemo(() => {
    try {
      return buildTrackPlan(line, region);
    } catch {
      return null;
    }
  }, [line, region]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !plan) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 640;
    const H = 300;
    canvas.width = W * 2;
    canvas.height = H * 2;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a1418';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(139, 155, 162, 0.11)';
    ctx.lineWidth = 1;
    for (let x = 0.5; x < W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0.5; y < H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    const points = plan.points.filter((_, index) => index % 4 === 0);
    const stations = plan.stations.map((station) => {
      const point = plan.points[Math.min(plan.points.length - 1, Math.round(station.s / 2))];
      return { x: point.x, z: point.z, name: station.name };
    });
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const point of [...points, ...stations]) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
    const pad = 42;
    const scale = Math.min(
      (W - pad * 2) / Math.max(1, maxX - minX),
      (H - pad * 2) / Math.max(1, maxZ - minZ),
    );
    const ox = (W - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = (H - (maxZ - minZ) * scale) / 2 - minZ * scale;
    const map = (point: { x: number; z: number }) => ({
      x: point.x * scale + ox,
      y: point.z * scale + oy,
    });

    const trace = () => {
      ctx.beginPath();
      points.forEach((point, index) => {
        const mapped = map(point);
        if (index === 0) ctx.moveTo(mapped.x, mapped.y);
        else ctx.lineTo(mapped.x, mapped.y);
      });
    };

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = line.color;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 16;
    trace();
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3;
    trace();
    ctx.stroke();

    for (const station of stations) {
      const mapped = map(station);
      ctx.beginPath();
      ctx.arc(mapped.x, mapped.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#0a1418';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#eee9dd';
      ctx.stroke();
    }

    ctx.font = '500 13px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(238, 233, 221, 0.82)';
    stations.forEach((station, index) => {
      if (index !== 0 && index !== stations.length - 1) return;
      const mapped = map(station);
      ctx.textAlign = index === 0 ? 'left' : 'right';
      const label = station.name.toUpperCase();
      ctx.fillText(label, mapped.x + (index === 0 ? 12 : -12), mapped.y + 4);
    });

    ctx.fillStyle = 'rgba(139, 155, 162, 0.8)';
    ctx.font = '500 11px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${line.lengthKm.toFixed(1)} KM`, 14, H - 14);
    ctx.textAlign = 'right';
    ctx.fillText(line.code, W - 14, H - 14);
  }, [line, plan]);

  return (
    <figure className={cn('relative overflow-hidden border border-border bg-[#0a1418]', className)}>
      {plan ? (
        <canvas
          ref={canvasRef}
          className="block h-auto w-full"
          role="img"
          aria-label={`Route map for ${line.name}: ${plan.stations.map((station) => station.name).join(' to ')}`}
        />
      ) : (
        <div className="grid aspect-[2/1] place-items-center p-6 text-center text-sm text-muted-foreground">
          Route survey unavailable for this service.
        </div>
      )}
      <figcaption className="sr-only">
        {line.name} route, {line.lengthKm.toFixed(1)} kilometres, {line.stationCount} stations.
      </figcaption>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-fog">
        <span>{region.name}</span>
        <span className="text-paper">{line.code} / route survey</span>
      </div>
    </figure>
  );
}
