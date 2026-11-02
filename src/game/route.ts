import * as THREE from 'three';
import { MAP_SCALE, REGIONS, ROAD, regionForDistance, regionById } from './config';
import type { MapData, RegionId } from './types';

export interface Frame {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  distance: number;
}

export interface NearestResult {
  frame: Frame;
  offset: number;
  along: number;
  distanceAlong: number;
  index: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * One large loop around the island. The west side hugs the sea; the north
 * climbs into the pass; the east opens into the valley; the south runs the
 * city waterfront. The shape is deliberately broad so it reads as open world
 * while staying a single, cheap-to-collide ribbon.
 */
const ROUTE_POINTS: Array<[number, number]> = [
  [-680, 300],
  [-735, 60],
  [-735, -190],
  [-610, -410],
  [-400, -560],
  [-140, -640],
  [150, -640],
  [430, -540],
  [620, -370],
  [705, -150],
  [700, 80],
  [640, 300],
  [500, 450],
  [320, 560],
  [80, 610],
  [-180, 580],
  [-430, 480],
];

/**
 * The island is deliberately separate from the road loop. These points give
 * it a ragged west coast, a sheltered bay, a long eastern cape, a southern
 * harbor and a mountainous north shore. The road remains inside the coast.
 */
const ISLAND_COASTLINE: Array<[number, number]> = [
  [-930, 560],
  [-1070, 430],
  [-900, 310],
  [-1040, 140],
  [-930, 10],
  [-1060, -160],
  [-960, -330],
  [-870, -520],
  [-700, -720],
  [-470, -830],
  [-320, -740],
  [-120, -880],
  [70, -830],
  [210, -960],
  [390, -860],
  [540, -930],
  [700, -790],
  [780, -620],
  [930, -540],
  [990, -350],
  [900, -200],
  [1030, -60],
  [980, 120],
  [870, 190],
  [960, 360],
  [1070, 510],
  [910, 650],
  [950, 790],
  [770, 850],
  [610, 770],
  [480, 900],
  [300, 820],
  [180, 970],
  [30, 860],
  [-130, 930],
  [-300, 820],
  [-470, 870],
  [-630, 740],
  [-770, 770],
  [-850, 640],
];

function buildIslandCoastline(): Array<[number, number]> {
  const curve = new THREE.CatmullRomCurve3(
    ISLAND_COASTLINE.map(([x, z]) => new THREE.Vector3(x * MAP_SCALE, 0, z * MAP_SCALE)),
    true,
    'catmullrom',
    0.36,
  );
  const points = curve.getSpacedPoints(220);
  points.pop();
  return points.map((point) => [Number(point.x.toFixed(1)), Number(point.z.toFixed(1))]);
}

function buildCurve(): THREE.CatmullRomCurve3 {
  const points = ROUTE_POINTS.map(([x, z]) => new THREE.Vector3(x * MAP_SCALE, 0, z * MAP_SCALE));
  return new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.38);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * A continuous elevation profile for the loop. It stays gentle on the coast,
 * climbs into the alpine district, rolls through the valley and settles back
 * down into the city. The raised cosine windows keep the joins smooth so the
 * road never steps at a district boundary.
 */
function roadElevation(distance: number, length: number): number {
  const p = ((distance % length) + length) % length / length;
  const rolling = 5.7 + Math.sin(p * Math.PI * 4 + 0.35) * 2.1 + Math.sin(p * Math.PI * 8 - 0.7) * 0.9;
  const alpine = smoothstep(0.19, 0.31, p) * (1 - smoothstep(0.46, 0.58, p));
  const climb =
    alpine * 58 +
    alpine * (Math.sin(p * Math.PI * 12 + 0.4) * 5.8 + Math.cos(p * Math.PI * 20 - 1.1) * 2.8);
  const valley = smoothstep(0.55, 0.67, p) * (1 - smoothstep(0.75, 0.87, p));
  const roll = valley * (Math.sin(p * Math.PI * 10 - 0.8) * 3.6 + 1.1);
  return Math.max(1.6, rolling + climb + roll);
}

export class Route {
  readonly curve: THREE.CatmullRomCurve3;
  readonly frames: Frame[] = [];
  readonly length: number;
  readonly sectorLength: number;
  readonly gateDistances: number[] = [];
  private readonly sampleCount = 1200;

  constructor() {
    this.curve = buildCurve();
    const points = this.curve.getSpacedPoints(this.sampleCount - 1);

    let distance = 0;
    for (let i = 0; i < points.length; i++) {
      const prev = points[(i - 1 + points.length) % points.length];
      const next = points[(i + 1) % points.length];
      const tangent = next.clone().sub(prev).normalize();
      const right = tangent.clone().cross(UP).normalize();
      if (i > 0) distance += points[i].distanceTo(points[i - 1]);
      this.frames.push({
        position: points[i],
        tangent,
        right,
        distance,
      });
    }

    this.length = distance + points[0].distanceTo(points[points.length - 1]);
    // Keep the spline planar for stable x/z nearest-point maths, but give each
    // frame an elevation. The world builds its road ribbon and terrain shelf
    // from this profile, and the car reads it to sit and pitch on the road.
    for (const frame of this.frames) {
      frame.position.y = roadElevation(frame.distance, this.length);
    }
    this.sectorLength = this.length / ROAD.sectorCount;
    for (let i = 1; i <= ROAD.sectorCount; i++) {
      this.gateDistances.push((this.sectorLength * i) % this.length);
    }
  }

  wrap(distance: number): number {
    return ((distance % this.length) + this.length) % this.length;
  }

  elevationAt(distance: number): number {
    return roadElevation(this.wrap(distance), this.length);
  }

  /** dY / dDistance at a point on the loop. */
  gradeAt(distance: number): number {
    const sample = 7;
    return (this.elevationAt(distance + sample) - this.elevationAt(distance - sample)) / (sample * 2);
  }

  frameAt(distance: number): Frame {
    const d = this.wrap(distance);
    const index = this.indexAtDistance(d);
    const frame = this.frames[index];
    const next = this.frames[(index + 1) % this.frames.length];
    const span = next.distance > frame.distance ? next.distance - frame.distance : 1;
    const t = Math.min(1, Math.max(0, (d - frame.distance) / span));
    return {
      position: frame.position.clone().lerp(next.position, t),
      tangent: frame.tangent.clone().lerp(next.tangent, t).normalize(),
      right: frame.right.clone().lerp(next.right, t).normalize(),
      distance: d,
    };
  }

  private indexAtDistance(distance: number): number {
    let lo = 0;
    let hi = this.frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.frames[mid].distance <= distance) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  nearest(position: THREE.Vector3, hint = -1): NearestResult {
    let bestIndex = 0;
    let bestDist = Infinity;

    if (hint >= 0) {
      const total = this.frames.length;
      for (let k = -56; k <= 56; k++) {
        const i = (hint + k + total) % total;
        const d = this.frames[i].position.distanceToSquared(position);
        if (d < bestDist) {
          bestDist = d;
          bestIndex = i;
        }
      }
      if (bestDist > 1600) bestDist = Infinity;
    }

    if (bestDist === Infinity) {
      for (let i = 0; i < this.frames.length; i++) {
        const d = this.frames[i].position.distanceToSquared(position);
        if (d < bestDist) {
          bestDist = d;
          bestIndex = i;
        }
      }
    }

    const frame = this.frames[bestIndex];
    const delta = position.clone().sub(frame.position);
    // x/z projection keeps the route lookup stable while the car is lifted onto
    // a climb; the tangent remains horizontal by design.
    const offset = delta.dot(frame.right);
    const along = delta.dot(frame.tangent);
    return {
      frame,
      offset,
      along,
      distanceAlong: this.wrap(frame.distance + along),
      index: bestIndex,
    };
  }

  /** Place a car on the road at a given distance and lane offset. */
  placement(distance: number, offset: number) {
    const frame = this.frameAt(distance);
    const position = frame.position.clone().addScaledVector(frame.right, offset);
    const matrix = new THREE.Matrix4().lookAt(
      new THREE.Vector3(),
      frame.tangent.clone(),
      UP,
    );
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
    return { position, quaternion, frame };
  }

  regionStart(id: RegionId): number {
    const region = regionById(id);
    return this.wrap(this.sectorLength * region.gateIndex);
  }

  regionAt(distance: number) {
    return regionForDistance(distance, this.sectorLength);
  }

  mapData(): MapData {
    const route: Array<[number, number]> = [];
    for (let i = 0; i < this.frames.length; i += 10) {
      const frame = this.frames[i];
      route.push([Number(frame.position.x.toFixed(1)), Number(frame.position.z.toFixed(1))]);
    }

    const coastline = buildIslandCoastline();
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of coastline) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const pad = 110;
    return {
      coastline,
      route,
      junctions: [],
      regions: REGIONS.map((region) => {
        const frame = this.frameAt(this.regionStart(region.id));
        return {
          id: region.id,
          name: region.name,
          x: frame.position.x,
          z: frame.position.z,
        };
      }),
      bounds: { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad },
    };
  }
}
