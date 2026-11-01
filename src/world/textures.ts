import * as THREE from 'three';
import { Rng, clamp } from '../core/util';

const cache = new Map<string, THREE.CanvasTexture>();

function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { c, ctx };
}

function finish(c: HTMLCanvasElement, repeatX = 1, repeatY = 1, srgb = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function gravelTexture(): THREE.CanvasTexture {
  const key = 'gravel';
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = makeCanvas(256, 256);
  const rng = new Rng(9182);
  ctx.fillStyle = '#6d6a64';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const x = rng.range(0, 256);
    const y = rng.range(0, 256);
    const r = rng.range(1.0, 4.4);
    const v = Math.floor(rng.range(70, 150));
    ctx.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 350; i++) {
    ctx.fillStyle = `rgba(${rng.int(30, 90)},${rng.int(30, 85)},${rng.int(28, 80)},0.5)`;
    ctx.fillRect(rng.range(0, 256), rng.range(0, 256), rng.range(1, 4), rng.range(1, 4));
  }
  const t = finish(c, 1, 1);
  cache.set(key, t);
  return t;
}

export function concreteTexture(tint = '#b9b6ad'): THREE.CanvasTexture {
  const key = `concrete-${tint}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = makeCanvas(256, 256);
  const rng = new Rng(551);
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const v = Math.floor(rng.range(-18, 18));
    ctx.fillStyle = `rgba(${128 + v},${128 + v},${128 + v},0.10)`;
    ctx.fillRect(rng.range(0, 256), rng.range(0, 256), rng.range(1, 3), rng.range(1, 3));
  }
  ctx.strokeStyle = 'rgba(30,30,30,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.lineTo(256, 128);
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.stroke();
  const t = finish(c);
  cache.set(key, t);
  return t;
}

export function windowTexture(): THREE.CanvasTexture {
  const key = 'windows';
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = makeCanvas(256, 256);
  ctx.fillStyle = '#2b3038';
  ctx.fillRect(0, 0, 256, 256);
  const cols = 8;
  const rows = 10;
  const rng = new Rng(2211);
  const cw = 256 / cols;
  const ch = 256 / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * cw + 4;
      const py = y * ch + 4;
      const lit = rng.chance(0.4);
      ctx.fillStyle = lit ? 'rgba(255,214,150,0.85)' : 'rgba(120,146,168,0.55)';
      ctx.fillRect(px, py, cw - 8, ch - 9);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(px, py + ch - 9, cw - 8, 3);
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let x = 0; x <= cols; x++) ctx.fillRect(x * cw, 0, 1.5, 256);
  for (let y = 0; y <= rows; y++) ctx.fillRect(0, y * ch, 256, 1.5);
  const t = finish(c);
  cache.set(key, t);
  return t;
}

export function cloudTexture(): THREE.CanvasTexture {
  const key = 'cloud';
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = makeCanvas(256, 128);
  ctx.clearRect(0, 0, 256, 128);
  const rng = new Rng(778);
  for (let i = 0; i < 55; i++) {
    const x = rng.range(30, 226);
    const y = rng.range(45, 90);
    const r = rng.range(16, 46);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = finish(c, 1, 1);
  cache.set(key, t);
  return t;
}

export function glowTexture(): THREE.CanvasTexture {
  const key = 'glow';
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,244,214,0.75)');
  g.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = finish(c);
  cache.set(key, t);
  return t;
}

export function textTexture(text: string, opts: {
  width?: number; height?: number; bg?: string; fg?: string;
  font?: string; sub?: string; subColor?: string;
} = {}): THREE.CanvasTexture {
  const width = opts.width ?? 512;
  const height = opts.height ?? 128;
  const key = `text-${text}-${width}-${height}-${opts.bg}-${opts.fg}-${opts.sub}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = makeCanvas(width, height);
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }
  ctx.fillStyle = opts.fg ?? '#ffffff';
  ctx.font = opts.font ?? `700 ${Math.floor(height * 0.46)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (opts.sub) {
    ctx.fillText(text, width / 2, height * 0.38);
    ctx.font = `500 ${Math.floor(height * 0.2)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = opts.subColor ?? opts.fg ?? '#ffffff';
    ctx.fillText(opts.sub, width / 2, height * 0.78);
  } else {
    ctx.fillText(text, width / 2, height / 2);
  }
  const t = finish(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, t);
  return t;
}

export function speedBoardTexture(limit: number): THREE.CanvasTexture {
  const key = `speed-${limit}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = makeCanvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.beginPath();
  ctx.arc(128, 128, 112, 0, Math.PI * 2);
  ctx.fillStyle = '#f4f1e8';
  ctx.fill();
  ctx.lineWidth = 16;
  ctx.strokeStyle = '#1a1a1a';
  ctx.stroke();
  ctx.fillStyle = '#121212';
  ctx.font = '700 108px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(limit), 128, 138);
  const t = finish(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, t);
  return t;
}

export function stationSignTexture(name: string, code: string, color: string): THREE.CanvasTexture {
  const key = `station-${name}-${code}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = makeCanvas(768, 192);
  ctx.fillStyle = '#11161d';
  ctx.fillRect(0, 0, 768, 192);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 768, 14);
  ctx.fillStyle = '#f3f6fa';
  ctx.font = '700 76px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 34, 106);
  ctx.fillStyle = color;
  ctx.font = '700 42px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(code, 730, 160);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(0, 178, 768, 2);
  const t = finish(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, t);
  return t;
}

export function woodTexture(): THREE.CanvasTexture {
  const key = 'wood';
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, ctx } = makeCanvas(128, 128);
  ctx.fillStyle = '#6b4f37';
  ctx.fillRect(0, 0, 128, 128);
  const rng = new Rng(31);
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = `rgba(${rng.int(40, 90)},${rng.int(25, 60)},${rng.int(15, 40)},0.4)`;
    ctx.lineWidth = rng.range(1, 3);
    ctx.beginPath();
    ctx.moveTo(0, rng.range(0, 128));
    ctx.bezierCurveTo(30, rng.range(0, 128), 90, rng.range(0, 128), 128, rng.range(0, 128));
    ctx.stroke();
  }
  const t = finish(c);
  cache.set(key, t);
  return t;
}

export function canvasTexture(canvas: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function updateCanvasTexture(tex: THREE.CanvasTexture): void {
  tex.needsUpdate = true;
}

export function clearTextureCache(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

export function lerpColor(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return a.clone().lerp(b, clamp(t, 0, 1));
}
