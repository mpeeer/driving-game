import * as THREE from 'three';
import { ROAD } from './config';

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

function buildCurve(): THREE.CatmullRomCurve3 {
  const radii = [252, 286, 312, 294, 258, 222, 205, 228, 268, 292, 276, 244];
  const points = radii.map((radius, i) => {
    const angle = (i / radii.length) * Math.PI * 2;
    return new THREE.Vector3(
      Math.cos(angle) * radius,
      0,
      Math.sin(angle) * radius,
    );
  });
  return new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.55);
}

export class Route {
  readonly curve: THREE.CatmullRomCurve3;
  readonly frames: Frame[] = [];
  readonly length: number;
  readonly sectorLength: number;
  readonly gateDistances: number[] = [];
  private readonly sampleCount = 900;

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
    this.sectorLength = this.length / ROAD.sectorCount;
    for (let i = 1; i <= ROAD.sectorCount; i++) {
      this.gateDistances.push((this.sectorLength * i) % this.length);
    }
  }

  wrap(distance: number): number {
    return ((distance % this.length) + this.length) % this.length;
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
      for (let k = -36; k <= 36; k++) {
        const i = (hint + k + total) % total;
        const d = this.frames[i].position.distanceToSquared(position);
        if (d < bestDist) {
          bestDist = d;
          bestIndex = i;
        }
      }
      // If the hint drifted away (respawn, teleport), fall back to a full scan.
      if (bestDist > 900) bestDist = Infinity;
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
}
