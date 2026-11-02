import * as THREE from 'three';
import { JUNCTION, ROAD } from './config';
import { Route } from './route';
import type { MapRoad } from './types';

const UP = new THREE.Vector3(0, 1, 0);

export type PathKind = 'ring' | 'access' | 'skyway' | 'detour';

export interface PathSample {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  distance: number;
  /** dY / dDistance in the path's forward direction. */
  grade: number;
}

export interface DrivePath {
  id: string;
  kind: PathKind;
  samples: PathSample[];
  length: number;
  halfWidth: number;
  closed: boolean;
  /** Detour paths are for AI only; the visible road is made of other paths. */
  driveable: boolean;
  startMainDistance?: number;
  endMainDistance?: number;
}

export interface RoadSurface {
  kind: 'main' | 'branch';
  path: DrivePath | null;
  offset: number;
  height: number;
  grade: number;
  tangent: THREE.Vector3;
  halfWidth: number;
  distance: number;
}

export interface MainGap {
  start: number;
  end: number;
  side: 1 | -1;
}

interface PathOptions {
  closed?: boolean;
  driveable?: boolean;
  startMainDistance?: number;
  endMainDistance?: number;
}

interface NearestSample {
  index: number;
  lateral: number;
  distance: number;
}

interface MainCandidate {
  score: number;
  offset: number;
  height: number;
  grade: number;
  tangent: THREE.Vector3;
  distance: number;
  along: number;
}

interface BranchCandidate extends MainCandidate {
  path: DrivePath;
  index: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The driveable surface graph around the two landmark junctions. The player and
 * traffic both sample these same centerlines, so what is visible is what can be
 * driven. The main loop is special-cased because it is authored by Route and
 * already has the most accurate long-distance lookup.
 */
export class RoadNetwork {
  readonly route: Route;
  readonly skyway: DrivePath;
  readonly roundaboutRing: DrivePath;
  readonly roundaboutEntry: DrivePath;
  readonly roundaboutExit: DrivePath;
  readonly roundaboutDetour: DrivePath;
  readonly branchPaths: DrivePath[];
  readonly trafficPaths: DrivePath[];
  readonly mainGaps: MainGap[];

  readonly skywayStart: number;
  readonly skywayEnd: number;
  readonly roundaboutCenter: THREE.Vector3;
  readonly roundaboutHeight: number;
  readonly roundaboutRadius: number;
  readonly roundaboutAccessStart: number;
  readonly roundaboutAccessEnd: number;

  constructor(route: Route) {
    this.route = route;
    const length = route.length;

    this.skywayStart = length * JUNCTION.skyway.start;
    this.skywayEnd = length * JUNCTION.skyway.end;
    this.roundaboutAccessStart = length * JUNCTION.roundabout.accessStart;
    this.roundaboutAccessEnd = length * JUNCTION.roundabout.accessEnd;
    this.roundaboutRadius = JUNCTION.roundabout.radius;

    const roundaboutFrame = route.frameAt(length * JUNCTION.roundabout.center);
    this.roundaboutHeight = roundaboutFrame.position.y;
    this.roundaboutCenter = roundaboutFrame.position
      .clone()
      .addScaledVector(roundaboutFrame.right, JUNCTION.roundabout.centerOffset);

    const skyStart = this.skywayStart;
    const skyEnd = this.skywayEnd;
    const skyMid = (skyStart + skyEnd) * 0.5;
    const skyPoints = [
      this.mainPoint(skyStart, 7.2, 0.03),
      this.mainPoint(skyStart + 16, 10.5, 1.4),
      this.mainPoint(skyStart + 45, 22, 4.8),
      this.mainPoint(skyMid, 33, 7.4),
      this.mainPoint(skyEnd - 45, 22, 4.8),
      this.mainPoint(skyEnd - 16, 10.5, 1.4),
      this.mainPoint(skyEnd, 7.2, 0.03),
    ];
    this.skyway = this.makePath(
      'skyway',
      new THREE.CatmullRomCurve3(skyPoints, false, 'catmullrom', 0.18),
      4.6,
      { startMainDistance: skyStart, endMainDistance: skyEnd },
    );

    this.roundaboutRing = this.makePath(
      'roundabout-ring',
      new THREE.CatmullRomCurve3(this.ringPoints(72), true, 'catmullrom', 0.2),
      6.0,
      { closed: true },
    );

    // Two real entries into the roundabout. The first comes from behind the
    // circle, the second rejoins the highway further ahead, so the player can
    // leave and rejoin the loop instead of entering a dead end.
    const entryRing = this.ringPoint(-Math.PI * 0.36);
    const exitRing = this.ringPoint(Math.PI * 0.36);
    const entryPoints = [
      this.mainPoint(this.roundaboutAccessStart, 7.2, 0.03),
      this.mainPoint(this.roundaboutAccessStart + 16, 11.5, 0.22),
      this.mainPoint(this.roundaboutAccessStart + 36, 24, 0.48),
      entryRing,
    ];
    const exitPoints = [
      exitRing,
      this.mainPoint(this.roundaboutAccessEnd - 36, 24, 0.48),
      this.mainPoint(this.roundaboutAccessEnd - 16, 11.5, 0.22),
      this.mainPoint(this.roundaboutAccessEnd, 7.2, 0.03),
    ];
    this.roundaboutEntry = this.makePath(
      'roundabout-entry',
      new THREE.CatmullRomCurve3(entryPoints, false, 'catmullrom', 0.2),
      4.2,
      {
        startMainDistance: this.roundaboutAccessStart,
        endMainDistance: this.roundaboutAccessEnd,
      },
    );
    this.roundaboutExit = this.makePath(
      'roundabout-exit',
      new THREE.CatmullRomCurve3(exitPoints, false, 'catmullrom', 0.2),
      4.2,
      {
        startMainDistance: this.roundaboutAccessStart,
        endMainDistance: this.roundaboutAccessEnd,
      },
    );

    // A single AI-friendly line through the entry, the near half of the ring
    // and the exit. It is deliberately not rendered: it follows the visible
    // ring and access meshes and gives junction traffic a clean route.
    const detourPoints = [
      ...entryPoints.slice(0, -1),
      this.ringPoint(-Math.PI * 0.26),
      this.ringPoint(0),
      this.ringPoint(Math.PI * 0.26),
      exitRing,
      ...exitPoints.slice(1),
    ];
    this.roundaboutDetour = this.makePath(
      'roundabout-detour',
      new THREE.CatmullRomCurve3(detourPoints, false, 'catmullrom', 0.2),
      4.2,
      {
        driveable: false,
        startMainDistance: this.roundaboutAccessStart,
        endMainDistance: this.roundaboutAccessEnd,
      },
    );

    this.branchPaths = [
      this.skyway,
      this.roundaboutEntry,
      this.roundaboutRing,
      this.roundaboutExit,
    ];
    this.trafficPaths = [
      this.skyway,
      this.roundaboutRing,
      this.roundaboutDetour,
    ];

    this.mainGaps = [
      { start: skyStart, end: skyStart + 8, side: 1 },
      { start: skyEnd - 8, end: skyEnd, side: 1 },
      { start: this.roundaboutAccessStart - 8, end: this.roundaboutAccessStart + 8, side: 1 },
      { start: this.roundaboutAccessEnd - 8, end: this.roundaboutAccessEnd + 8, side: 1 },
    ];
  }

  private mainPoint(distance: number, offset: number, lift = 0): THREE.Vector3 {
    const frame = this.route.frameAt(distance);
    return frame.position.clone().addScaledVector(frame.right, offset).setY(frame.position.y + lift);
  }

  private ringPoint(angle: number): THREE.Vector3 {
    const frame = this.route.frameAt(this.route.length * JUNCTION.roundabout.center);
    return this.roundaboutCenter
      .clone()
      .addScaledVector(frame.right, -Math.cos(angle) * JUNCTION.roundabout.radius)
      .addScaledVector(frame.tangent, Math.sin(angle) * JUNCTION.roundabout.radius)
      .setY(this.roundaboutHeight + 0.03);
  }

  private ringPoints(count: number): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) points.push(this.ringPoint((i / count) * Math.PI * 2));
    return points;
  }

  private makePath(
    id: string,
    curve: THREE.CatmullRomCurve3,
    halfWidth: number,
    options: PathOptions = {},
  ): DrivePath {
    const closed = options.closed ?? false;
    const sampleCount = Math.max(32, Math.ceil(curve.getLength() / 2.4));
    const points = curve.getSpacedPoints(sampleCount);
    if (closed) points.pop();

    const distances: number[] = [];
    let total = 0;
    for (let i = 0; i < points.length; i++) {
      if (i > 0) total += points[i].distanceTo(points[i - 1]);
      distances.push(total);
    }
    if (closed) total += points[0].distanceTo(points[points.length - 1]);

    const samples: PathSample[] = points.map((position, index) => {
      const prev = points[(index - 1 + points.length) % points.length];
      const next = points[(index + 1) % points.length];
      const tangent = closed
        ? next.clone().sub(prev).normalize()
        : next.clone().sub(prev).normalize();
      const right = tangent.clone().cross(UP).normalize();
      let grade = 0;
      if (closed) {
        const previousDistance = index === 0 ? total : distances[index];
        const nextDistance = index === points.length - 1 ? total : distances[index + 1];
        grade = (next.y - prev.y) / Math.max(0.5, nextDistance - previousDistance);
      } else if (index > 0 && index < points.length - 1) {
        grade = (next.y - prev.y) / Math.max(0.5, distances[index + 1] - distances[index - 1]);
      } else if (index === 0 && points.length > 1) {
        grade = (points[1].y - points[0].y) / Math.max(0.5, distances[1]);
      } else if (index > 0) {
        grade = (points[index].y - points[index - 1].y) / Math.max(0.5, distances[index] - distances[index - 1]);
      }
      return {
        position: position.clone(),
        tangent,
        right,
        distance: distances[index],
        grade,
      };
    });

    return {
      id,
      kind: id === 'skyway' ? 'skyway' : id === 'roundabout-ring' ? 'ring' : 'access',
      samples,
      length: total,
      halfWidth,
      closed,
      driveable: options.driveable ?? true,
      startMainDistance: options.startMainDistance,
      endMainDistance: options.endMainDistance,
    };
  }

  isMainGap(distance: number, side: number): boolean {
    for (const gap of this.mainGaps) {
      if (gap.side !== side) continue;
      if (distance >= gap.start - 2 && distance <= gap.end + 2) return true;
    }
    return false;
  }

  nearBranch(x: number, z: number, margin = 5): boolean {
    const point = new THREE.Vector2(x, z);
    for (const path of this.branchPaths) {
      for (const sample of path.samples) {
        const dx = sample.position.x - x;
        const dz = sample.position.z - z;
        if (dx * dx + dz * dz < (path.halfWidth + margin) ** 2) return true;
      }
    }
    return false;
  }

  /**
   * Pick the road surface under the car. Main is always a candidate; branches
   * only win when they are genuinely close. The current visual height is part
   * of the score so an elevated deck cannot kidnap a car travelling underneath.
   */
  surfaceAt(position: THREE.Vector3, currentHeight: number, hint = -1): RoadSurface {
    const nearest = this.route.nearest(position, hint);
    const mainHeight = this.route.elevationAt(nearest.distanceAlong);
    const mainOffset = nearest.offset;
    let best: BranchCandidate | MainCandidate = {
      score: Math.abs(mainOffset) + Math.abs(mainHeight - currentHeight) * 1.7,
      offset: mainOffset,
      height: mainHeight,
      grade: this.route.gradeAt(nearest.distanceAlong),
      tangent: nearest.frame.tangent.clone(),
      distance: nearest.distanceAlong,
      along: nearest.along,
    };

    for (const path of this.branchPaths) {
      if (!path.driveable) continue;
      const sample = this.nearestSample(path, position);
      if (!sample) continue;
      // `distance` is distance along the path; the car must be close to the
      // centerline laterally. Using the along-path value here would let a
      // distant branch qualify simply because its nearest sample is early.
      const lateral = Math.abs(sample.lateral);
      if (lateral > path.halfWidth + 2.2) continue;
      if (!path.closed && (sample.distance < -1.5 || sample.distance > path.length + 1.5)) continue;
      const point = path.samples[sample.index];
      const vertical = Math.abs(point.position.y - currentHeight);
      const score = lateral + vertical * 1.7;
      if (score < best.score) {
        best = {
          score,
          offset: sample.lateral,
          height: point.position.y,
          grade: point.grade,
          tangent: point.tangent.clone(),
          distance: point.distance,
          along: sample.lateral,
          path,
          index: sample.index,
        };
      }
    }

    if ('path' in best) {
      return {
        kind: 'branch',
        path: best.path,
        offset: best.offset,
        height: best.height,
        grade: best.grade,
        tangent: best.tangent,
        halfWidth: best.path.halfWidth,
        distance: best.distance,
      };
    }

    return {
      kind: 'main',
      path: null,
      offset: best.offset,
      height: best.height,
      grade: best.grade,
      tangent: best.tangent,
      halfWidth: ROAD.halfWidth,
      distance: best.distance,
    };
  }

  /**
   * Nearest sample on an open/closed path. Returns lateral offset so rails,
   * lane placement and surface queries use the same convention.
   */
  nearestSample(path: DrivePath, position: THREE.Vector3): NearestSample | null {
    let best = Infinity;
    let bestIndex = -1;
    let bestLateral = 0;
    let bestDistance = 0;
    for (let i = 0; i < path.samples.length; i++) {
      const sample = path.samples[i];
      const dx = position.x - sample.position.x;
      const dz = position.z - sample.position.z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        bestIndex = i;
        bestDistance = sample.distance;
        bestLateral = dx * sample.right.x + dz * sample.right.z;
      }
    }
    if (bestIndex < 0) return null;
    return {
      index: bestIndex,
      lateral: bestLateral,
      distance: bestDistance,
    };
  }

  /** Sample a branch path at a distance and lane offset; used by traffic. */
  placeOnPath(path: DrivePath, distance: number, offset: number): {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    grade: number;
    distance: number;
  } {
    const length = path.length;
    let d = path.closed ? ((distance % length) + length) % length : THREE.MathUtils.clamp(distance, 0, length);
    let index = 0;
    for (let i = 0; i < path.samples.length - 1; i++) {
      if (path.samples[i + 1].distance > d) {
        index = i;
        break;
      }
      index = i;
    }
    if (path.closed && d >= path.samples[path.samples.length - 1].distance) {
      index = path.samples.length - 1;
    }
    const a = path.samples[index];
    const b = path.samples[(index + 1) % path.samples.length];
    const span = b.distance > a.distance ? b.distance - a.distance : Math.max(0.01, length - a.distance);
    const t = THREE.MathUtils.clamp((d - a.distance) / span, 0, 1);
    const position = a.position.clone().lerp(b.position, t);
    const tangent = a.tangent.clone().lerp(b.tangent, t).normalize();
    const right = tangent.clone().cross(UP).normalize();
    position.addScaledVector(right, offset);
    const matrix = new THREE.Matrix4().lookAt(new THREE.Vector3(), tangent, UP);
    return {
      position,
      quaternion: new THREE.Quaternion().setFromRotationMatrix(matrix),
      grade: lerp(a.grade, b.grade, t),
      distance: d,
    };
  }

  /** Sampled centerlines for the title-screen and in-car maps. */
  mapRoads(): MapRoad[] {
    return [
      this.mapRoad(this.skyway, 'skyway'),
      this.mapRoad(this.roundaboutRing, 'roundabout'),
      this.mapRoad(this.roundaboutEntry, 'roundabout'),
      this.mapRoad(this.roundaboutExit, 'roundabout'),
    ];
  }

  private mapRoad(path: DrivePath, kind: MapRoad['kind']): MapRoad {
    return {
      id: path.id,
      kind,
      points: path.samples
        .filter((_, index) => index % 3 === 0)
        .map((sample): [number, number] => [
          Number(sample.position.x.toFixed(1)),
          Number(sample.position.z.toFixed(1)),
        ]),
    };
  }

  /** Ramp merge distance for a path starting/ending on the main road. */
  pathEndMainDistance(path: DrivePath): number {
    return path.endMainDistance ?? this.route.length;
  }
}
