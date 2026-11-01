import * as THREE from 'three';
import { Rng, clamp, lerp, smoothstep } from '../core/util';
import { LineDef, RegionDef, stationNamesFor } from '../content/data';

export const TRACK_STEP = 2;

export interface TrackPoint {
  x: number;
  y: number;
  z: number;
  h: number;
  grade: number;
  s: number;
}

export interface StationPlan {
  id: string;
  name: string;
  index: number;
  s: number;
  demand: number;
  side: 1;
  size: number;
}

export interface TrackPlan {
  line: LineDef;
  points: TrackPoint[];
  stations: StationPlan[];
  length: number;
  theme: RegionDef['theme'];
}

export interface SamplePoint {
  x: number;
  y: number;
  z: number;
  h: number;
  grade: number;
}

const MAX_GRADE: Record<string, number> = {
  urban: 0.022,
  valley: 0.014,
  oldtown: 0.018,
  mountain: 0.036,
  coast: 0.016,
};

const MIN_RADIUS: Record<string, number> = {
  metro: 300,
  lightrail: 165,
  regional: 620,
  express: 1250,
  freight: 460,
};

function stationWeight(rng: Rng, size: number): number {
  return 0.6 + rng.float() * 0.9 + size * 0.3;
}

function smoothKnots(vals: number[], t: number): number {
  const n = vals.length - 1;
  const x = clamp(t, 0, 0.9999) * n;
  const i = Math.floor(x);
  const f = x - i;
  const sm = f * f * (3 - 2 * f);
  return lerp(vals[i], vals[Math.min(i + 1, n)], sm);
}

export function buildTrackPlan(line: LineDef, region: RegionDef): TrackPlan {
  const rng = new Rng(line.seed);
  const length = Math.max(600, line.lengthKm * 1000);
  const names = stationNamesFor(line, region);
  const stationCount = Math.max(2, Math.min(line.stationCount, names.length + 4));

  // Lay stations out along the alignment with natural irregular spacing.
  const startPad = 240;
  const endPad = 300;
  const usable = Math.max(200, length - startPad - endPad);
  const weights: number[] = [];
  for (let i = 0; i < stationCount; i++) weights.push(stationWeight(rng, i === 0 || i === stationCount - 1 ? 1 : 0.4));
  const wsum = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  const stations: StationPlan[] = [];
  for (let i = 0; i < stationCount; i++) {
    acc += weights[i];
    const s = startPad + (i === stationCount - 1 ? usable : (acc / wsum) * usable);
    const demandBase = region.theme === 'urban' ? 115 : region.theme === 'coast' ? 95 : region.theme === 'mountain' ? 55 : 70;
    const size = i === 0 || i === stationCount - 1 ? 1.25 : rng.range(0.55, 1.1);
    stations.push({
      id: `${line.id}-st${i}`,
      name: names[i] ?? `Halt ${i + 1}`,
      index: i,
      s,
      demand: Math.round(demandBase * size * rng.range(0.8, 1.25)),
      side: 1,
      size,
    });
  }

  const stationS = stations.map((s) => s.s);
  const flat = (s: number): number => {
    let factor = 1;
    for (const st of stationS) {
      const d = Math.abs(s - st);
      if (d < 110) return 0;
      factor = Math.min(factor, smoothstep(110, 300, d));
    }
    return factor;
  };

  // Random but smooth curvature / grade signals.
  const gradeKnots: number[] = [0];
  for (let i = 0; i < Math.ceil(length / 420) + 3; i++) gradeKnots.push(rng.range(-1, 1));
  gradeKnots.push(0);
  const curveKnots: number[] = [0];
  for (let i = 0; i < Math.ceil(length / 520) + 3; i++) curveKnots.push(rng.range(-1, 1));
  curveKnots.push(0);

  const maxGrade = MAX_GRADE[region.theme] ?? 0.02;
  const maxK = 1 / (MIN_RADIUS[line.kind] ?? 500);

  let h = rng.range(0, Math.PI * 2);
  let x = 0;
  let y = 0;
  let z = 0;
  const points: TrackPoint[] = [];
  const count = Math.ceil(length / TRACK_STEP) + 1;

  for (let i = 0; i < count; i++) {
    const s = i * TRACK_STEP;
    points.push({ x, y, z, h, grade: 0, s });
    const flatness = flat(s);
    let grade = smoothKnots(gradeKnots, s / (length / (gradeKnots.length - 1))) * maxGrade * flatness;
    grade -= y * 0.000018;
    const k = smoothKnots(curveKnots, s / (length / (curveKnots.length - 1))) * maxK * flatness;
    points[i].grade = grade;
    h += k * TRACK_STEP;
    y += grade * TRACK_STEP;
    x += Math.sin(h) * TRACK_STEP;
    z += Math.cos(h) * TRACK_STEP;
  }

  // Center the alignment on the origin for nicer map thumbnails.
  let cx = 0;
  let cz = 0;
  for (const p of points) {
    cx += p.x;
    cz += p.z;
  }
  cx /= points.length;
  cz /= points.length;
  for (const p of points) {
    p.x -= cx;
    p.z -= cz;
  }

  return { line, points, stations, length, theme: region.theme };
}

export function makeShowcasePlan(): TrackPlan {
  const line: LineDef = {
    id: 'showcase', code: 'M1', name: 'Harbour Loop', regionId: 'harbour', kind: 'metro',
    color: '#4da3ff', lengthKm: 0.8, stationCount: 2, seed: 1, unlockCost: 0, levelReq: 1,
    maxSpeedKph: 80, fareMultiplier: 1, startHour: 7.5, blurb: '',
  };
  const points: TrackPoint[] = [];
  for (let s = 0; s <= 900; s += TRACK_STEP) {
    const h = 0;
    points.push({ x: 0, y: 0, z: s - 450, h, grade: 0, s });
  }
  return {
    line,
    points,
    stations: [
      { id: 'sc-0', name: 'Central Quay', index: 0, s: 240, demand: 150, side: 1, size: 1.3 },
      { id: 'sc-1', name: 'Marlin Street', index: 1, s: 640, demand: 120, side: 1, size: 1 },
    ],
    length: 900,
    theme: 'urban',
  };
}

export class TrackPath {
  readonly plan: TrackPlan;
  readonly length: number;
  readonly maxSpeedKph: number;
  private points: TrackPoint[];
  private stationS: number[];
  private offsetS: number;
  private step = TRACK_STEP;
  private limitCache: number[] = [];
  private limitStep = 25;

  constructor(plan: TrackPlan) {
    this.plan = plan;
    this.points = plan.points;
    this.length = plan.length;
    this.maxSpeedKph = Math.min(plan.line.maxSpeedKph, 340);
    this.stationS = plan.stations.map((s) => s.s);
    this.offsetS = plan.stations.length ? plan.stations[0].s * 0 : 0;
    this.buildLimits();
  }

  private buildLimits(): void {
    const n = Math.ceil(this.length / this.limitStep) + 1;
    for (let i = 0; i < n; i++) {
      const s = i * this.limitStep;
      this.limitCache.push(this.computeLimit(s));
    }
  }

  private computeLimit(s: number): number {
    const k = Math.abs(this.curvatureAt(s));
    const lineLimit = this.maxSpeedKph;
    let v = lineLimit;
    if (k > 1e-7) {
      const latAccel = 1.55;
      v = Math.min(v, (Math.sqrt(latAccel / k) * 3.6));
    }
    for (const st of this.stationS) {
      const d = Math.abs(s - st);
      if (d < 360) {
        const corridor = smoothstep(360, 170, d);
        const platform = this.plan.line.kind === 'express' ? 120 : this.plan.line.kind === 'regional' ? 90 : this.plan.line.kind === 'freight' ? 85 : 62;
        v = Math.min(v, lerp(lineLimit, platform, 0.35 + corridor * 0.65));
      }
    }
    return Math.max(15, Math.round(v / 5) * 5);
  }

  sample(s: number, lateral = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const i = clamp(Math.floor(s / this.step), 0, this.points.length - 1);
    const j = Math.min(i + 1, this.points.length - 1);
    const t = clamp((s - this.points[i].s) / this.step, 0, 1);
    const a = this.points[i];
    const b = this.points[j];
    const x = lerp(a.x, b.x, t);
    const y = lerp(a.y, b.y, t);
    const z = lerp(a.z, b.z, t);
    const heading = a.h;
    out.set(x + Math.cos(heading) * lateral, y, z - Math.sin(heading) * lateral);
    return out;
  }

  /** Base point on the alignment (no lateral offset). */
  pointAt(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.sample(s, 0, out);
  }

  headingAt(s: number): number {
    const i = clamp(Math.floor(s / this.step), 0, this.points.length - 1);
    return this.points[i].h;
  }

  gradeAt(s: number): number {
    const i = clamp(Math.floor(s / this.step), 0, this.points.length - 1);
    return this.points[i].grade;
  }

  tangentAt(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    const h = this.headingAt(s);
    return out.set(Math.sin(h), 0, Math.cos(h)).normalize();
  }

  rightAt(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    const h = this.headingAt(s);
    return out.set(Math.cos(h), 0, -Math.sin(h));
  }

  curvatureAt(s: number): number {
    const i = clamp(Math.round(s / this.step), 1, this.points.length - 2);
    const a = this.points[i - 1];
    const b = this.points[i + 1];
    return (b.h - a.h) / (2 * TRACK_STEP);
  }

  limitAt(s: number): number {
    const i = clamp(Math.round(s / this.limitStep), 0, this.limitCache.length - 1);
    return this.limitCache[i];
  }

  /** Lowest limit in the next `lookahead` metres. */
  advisoryLimit(s: number, lookahead = 500): number {
    let v = this.limitAt(s);
    for (let d = 50; d <= lookahead; d += 50) {
      v = Math.min(v, this.limitAt(s + d));
    }
    return v;
  }

  /** First point ahead where the limit is lower than now, for HUD warnings. */
  nextRestriction(s: number, range = 1200): { s: number; limit: number } | null {
    const current = this.limitAt(s);
    for (let d = 25; d < range; d += 25) {
      const l = this.limitAt(s + d);
      if (l < current - 5) return { s: s + d, limit: l };
    }
    return null;
  }

  limitSections(): { s: number; limit: number }[] {
    const out: { s: number; limit: number }[] = [];
    let last = this.limitCache[0];
    out.push({ s: 0, limit: last });
    for (let i = 1; i < this.limitCache.length; i++) {
      const l = this.limitCache[i];
      if (Math.abs(l - last) >= 5) {
        out.push({ s: i * this.limitStep, limit: l });
        last = l;
      }
    }
    return out;
  }

  nearestStation(s: number): { station: StationPlan; distance: number } | null {
    if (!this.plan.stations.length) return null;
    let best = this.plan.stations[0];
    let bd = Math.abs(s - best.s);
    for (const st of this.plan.stations) {
      const d = Math.abs(s - st.s);
      if (d < bd) {
        bd = d;
        best = st;
      }
    }
    return { station: best, distance: s - best.s };
  }

  stationAhead(s: number): StationPlan | null {
    for (const st of this.plan.stations) if (st.s > s + 0.5) return st;
    return null;
  }

  bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of this.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    return { minX, maxX, minZ, maxZ };
  }
}

export interface FieldHit {
  dist: number;
  lateral: number;
  trackY: number;
  s: number;
  heading: number;
  grade: number;
}

/** Spatial index for finding the nearest point on the alignment (terrain, props). */
export class TrackField {
  private cell = 90;
  private buckets = new Map<string, number[]>();
  private coarse: { x: number; y: number; z: number; s: number; h: number; grade: number }[] = [];

  constructor(plan: TrackPlan, strideMeters = 16) {
    const stride = Math.max(1, Math.round(strideMeters / TRACK_STEP));
    for (let i = 0; i < plan.points.length; i += stride) {
      const p = plan.points[i];
      this.coarse.push({ x: p.x, y: p.y, z: p.z, s: p.s, h: p.h, grade: p.grade });
    }
    for (let i = 0; i < this.coarse.length; i++) {
      const p = this.coarse[i];
      const key = this.key(p.x, p.z);
      let arr = this.buckets.get(key);
      if (!arr) {
        arr = [];
        this.buckets.set(key, arr);
      }
      arr.push(i);
    }
  }

  private key(x: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }

  nearest(x: number, z: number, maxRing = 3): FieldHit | null {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r <= maxRing; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const arr = this.buckets.get(`${cx + dx},${cz + dz}`);
          if (!arr) continue;
          for (const idx of arr) {
            const p = this.coarse[idx];
            const dd = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
            if (dd < bestD) {
              bestD = dd;
              best = idx;
            }
          }
        }
      }
      if (best >= 0 && bestD < (r * this.cell) * (r * this.cell)) break;
    }
    if (best < 0) return null;
    const p = this.coarse[best];
    const dx = x - p.x;
    const dz = z - p.z;
    const lateral = dx * Math.cos(p.h) - dz * Math.sin(p.h);
    return {
      dist: Math.hypot(dx, dz),
      lateral,
      trackY: p.y,
      s: p.s,
      heading: p.h,
      grade: p.grade,
    };
  }
}
