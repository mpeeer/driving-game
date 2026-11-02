import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Route } from './route';
import { BRIDGE, MAP_SCALE, REGIONS, ROAD, WORLD } from './config';
import { Atmosphere } from './atmosphere';
import { RoadNetwork, type DrivePath } from './roads';
import {
  makeAsphaltTexture,
  makeGlowTexture,
  makeSunPathTexture,
  makeWaterTexture,
  makeWindowTexture,
} from './textures';
import type { Quality } from './types';

const UP = new THREE.Vector3(0, 1, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const TERRAIN_SIZE = 3200 * MAP_SCALE;
const SEA_LEVEL = -18.5;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function transformed(
  geometry: THREE.BufferGeometry,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.BufferGeometry {
  const clone = geometry.clone();
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
  clone.applyMatrix4(matrix);
  return clone;
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('Unable to merge world geometry');
  return merged;
}

interface InstanceSpec {
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: [number, number, number];
  color?: THREE.Color;
}

/**
 * A deliberately lightweight open world: vertex-coloured terrain, one flat
 * water plane, instanced trees and towers, one directional light and no
 * shadow maps. The expensive part of the old build was not the island, it was
 * the PBR road, PMREM probe and real-time shadows. All three are gone.
 */
export class DrivingWorld {
  readonly scene: THREE.Scene;
  private readonly route: Route;
  private quality: Quality;
  private time = 0;
  private activeGate = 0;
  private gateGlow!: THREE.Mesh;
  private gateGlowMaterial!: THREE.MeshBasicMaterial;
  private sunPath!: THREE.Mesh;
  private sunPathMaterial!: THREE.MeshBasicMaterial;
  private waterTexture!: THREE.CanvasTexture;
  private water!: THREE.Mesh;
  private waterMaterial!: THREE.MeshPhongMaterial;
  private cityWindowMaterial!: THREE.MeshLambertMaterial;
  private readonly ridgeMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly atmosphere: Atmosphere;
  private readonly roads: RoadNetwork;
  private bridgeStart = 0;
  private bridgeEnd = 0;

  constructor(scene: THREE.Scene, route: Route, quality: Quality, roads: RoadNetwork) {
    this.scene = scene;
    this.route = route;
    this.quality = quality;
    this.roads = roads;
    this.bridgeStart = route.length * BRIDGE.start;
    this.bridgeEnd = route.length * BRIDGE.end;

    scene.fog = new THREE.Fog(WORLD.fogColor, WORLD.fogNear, WORLD.fogFar);
    this.atmosphere = new Atmosphere(scene);

    this.buildTerrain();
    this.buildWater();
    this.buildRoad();
    this.buildRoadVerge();
    this.buildMarkings();
    this.buildRailings();
    this.buildBridge();
    this.buildGates();
    this.buildRegionSigns();
    this.buildRoadside();
    this.buildBeach();
    this.buildRoadNetwork();
    this.buildCity();
    this.buildDistantRidge();

    this.setQuality(quality);
  }

  get nightFactor(): number {
    return this.atmosphere.nightFactor;
  }

  get exposure(): number {
    return this.atmosphere.exposure;
  }

  get clockLabel(): string {
    return this.atmosphere.clock;
  }

  get phaseLabel(): string {
    return this.atmosphere.phaseLabel;
  }

  // ---------------------------------------------------------------- terrain

  private coastAt(z: number): number {
    const localZ = z / MAP_SCALE;
    return MAP_SCALE * (
      -820 +
      Math.sin(localZ * 0.0019) * 56 +
      Math.cos(localZ * 0.00072 + 1.2) * 30
    );
  }

  private naturalHeight(x: number, z: number): number {
    const lx = x / MAP_SCALE;
    const lz = z / MAP_SCALE;
    const coast = this.coastAt(z);
    if (x < coast) return SEA_LEVEL - 7 + (x - coast) * 0.02;
    if (x < coast + 30 * MAP_SCALE) {
      const t = (x - coast) / (30 * MAP_SCALE);
      return SEA_LEVEL - 2 + t * 2;
    }
    if (x < coast + 76 * MAP_SCALE) {
      const t = (x - coast - 30 * MAP_SCALE) / (46 * MAP_SCALE);
      return SEA_LEVEL + t * -SEA_LEVEL;
    }

    const north = smoothstep(430, 1120, -lz);
    const east = smoothstep(680, 1210, lx);
    const ridge = Math.max(north, east * 0.92);
    const rolling = Math.sin(lx * 0.0071 + 1.4) * 2.9 + Math.cos(lz * 0.0063 - 0.8) * 2.3;
    const fields = Math.max(0, Math.sin(lx * 0.0036 + 1.1) + Math.cos(lz * 0.0042)) * 4.2;
    const land = (1.8 + rolling + fields * 0.55 + ridge * (70 + Math.sin(lx * 0.011) * 26 + Math.cos(lz * 0.009) * 18)) * 1.35;

    // Beyond the playable coast the terrain falls back below the waterline, so
    // the larger map does not end in a flat green shelf at the mesh boundary.
    const border = 1 - smoothstep(1270, 1580, Math.hypot(lx, lz));
    return SEA_LEVEL - 8 + (land - (SEA_LEVEL - 8)) * border;
  }

  private routeSample(x: number, z: number): { distance: number; elevation: number; along: number } {
    let best = Infinity;
    let bestIndex = 0;
    const frames = this.route.frames;
    for (let i = 0; i < frames.length; i += 2) {
      const p = frames[i].position;
      const dx = x - p.x;
      const dz = z - p.z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        bestIndex = i;
      }
    }
    return {
      distance: Math.sqrt(best),
      elevation: frames[bestIndex].position.y,
      along: frames[bestIndex].distance,
    };
  }

  /** Strength of the bay under the suspension bridge, 0 outside, 1 in water. */
  private bridgeBay(along: number, lateral: number): number {
    if (along < this.bridgeStart - 150 || along > this.bridgeEnd + 150) return 0;
    const span =
      smoothstep(this.bridgeStart - 150, this.bridgeStart, along) *
      (1 - smoothstep(this.bridgeEnd, this.bridgeEnd + 150, along));
    const width = 1 - smoothstep(105, 340, lateral);
    return span * width;
  }

  private routeDistanceSq(x: number, z: number): number {
    const sample = this.routeSample(x, z);
    return sample.distance * sample.distance;
  }

  private terrainHeight(x: number, z: number): number {
    const natural = this.naturalHeight(x, z);
    const road = this.routeSample(x, z);
    // Blend the natural island into the elevated road shelf. The transition is
    // intentionally wide: it gives the pass cuttings and fills instead of a
    // floating ribbon, while the 28 m flat margin keeps the shoulders readable.
    const alpine = smoothstep(320, 540, -z);
    const shelf = smoothstep(32, 110 + alpine * 90, road.distance);
    // Drop the grid below the road corridor so a coarse triangle can never
    // poke through the asphalt on a climb. A separate roadside verge mesh
    // covers the lip between shoulder and terrain.
    const undercut = 0.8 * (1 - smoothstep(24, 50, road.distance));
    const base = road.elevation - undercut;
    const dry = base + (natural - base) * shelf;
    const bay = this.bridgeBay(road.along, road.distance);
    return bay > 0 ? THREE.MathUtils.lerp(dry, SEA_LEVEL - 4, bay) : dry;
  }

  private terrainColor(x: number, z: number, height: number): THREE.Color {
    const coast = this.coastAt(z);
    const lx = x / MAP_SCALE;
    const lz = z / MAP_SCALE;
    const grass = new THREE.Color(0x79a651);
    const darkGrass = new THREE.Color(0x537a40);
    const alpineGrass = new THREE.Color(0x465b3b);
    const sunGrass = new THREE.Color(0xa2ba5a);
    const sand = new THREE.Color(0xd8bf8d);
    const wetSand = new THREE.Color(0xa99b77);
    const rock = new THREE.Color(0x8c8d7d);
    const darkRock = new THREE.Color(0x6d7068);
    const snow = new THREE.Color(0xedf2ed);
    const city = new THREE.Color(0x9ca18d);

    // A broad sand belt now meets the coast road, turning the west shoreline
    // into an actual beach rather than a thin strip of colour in the distance.
    if (x < coast + 30 * MAP_SCALE) {
      const wet = smoothstep(SEA_LEVEL - 1, SEA_LEVEL + 10, height);
      return wetSand.clone().lerp(sand, wet);
    }

    const mountain = smoothstep(26, 132, height);
    let color = grass.clone();
    const variation = Math.sin(lx * 0.017 + lz * 0.008) * 0.5 + 0.5;
    color.lerp(darkGrass, variation * 0.34);

    // The north side is alpine forest: cooler, darker turf with rock showing
    // through on the steeper ground around the pass.
    const alpine = smoothstep(300, 610, -lz);
    if (alpine > 0.01) {
      color.lerp(alpineGrass, alpine * 0.78);
      const outcrop = Math.sin(lx * 0.041 + lz * 0.028) + Math.cos(lx * 0.017 - lz * 0.033);
      if (outcrop > 1.0) color.lerp(rock, (outcrop - 1.0) * 0.24 * alpine);
    }

    if (lx > 175 && lx < 720 && lz > -520) {
      const field = Math.sin(lx * 0.021 + 0.4) + Math.cos(lz * 0.014 - 0.7);
      if (field > 0.9) color.lerp(sunGrass, 0.44);
    }

    if (lx > 90 && lz > 220) color.lerp(city, 0.2);

    if (mountain > 0.02) {
      color.lerp(rock, mountain * 0.8);
      color.lerp(darkRock, Math.max(0, Math.sin(lx * 0.026 + lz * 0.019)) * 0.22 * mountain);
    }
    if (height > 132) color.lerp(snow, smoothstep(132, 205, height) * 0.86);

    return color;
  }

  private buildTerrain(): void {
    const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 300, 300);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(position.count * 3);
    const color = new THREE.Color();

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const y = this.terrainHeight(x, z);
      position.setY(i, y);
      color.copy(this.terrainColor(x, z, y));
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const normals = geometry.attributes.normal as THREE.BufferAttribute;
    const colorBuffer = geometry.attributes.color as THREE.BufferAttribute;
    const cliffColor = new THREE.Color(0x73776b);
    const cliffDark = new THREE.Color(0x565d53);
    const steepColor = new THREE.Color();
    for (let i = 0; i < normals.count; i++) {
      const steep = 1 - THREE.MathUtils.clamp(normals.getY(i), 0, 1);
      if (steep < 0.16) continue;
      const grain = Math.sin(i * 2.17) * 0.5 + 0.5;
      steepColor.setRGB(colorBuffer.getX(i), colorBuffer.getY(i), colorBuffer.getZ(i));
      steepColor.lerp(cliffColor, smoothstep(0.16, 0.58, steep) * (0.62 + grain * 0.14));
      steepColor.lerp(cliffDark, smoothstep(0.58, 0.95, steep) * 0.22);
      colorBuffer.setXYZ(i, steepColor.r, steepColor.g, steepColor.b);
    }
    colorBuffer.needsUpdate = true;

    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const terrain = new THREE.Mesh(geometry, material);
    terrain.name = 'island-terrain';
    this.scene.add(terrain);
  }

  // ------------------------------------------------------------------ water

  private buildWater(): void {
    this.waterTexture = makeWaterTexture();
    this.waterMaterial = new THREE.MeshPhongMaterial({
      map: this.waterTexture,
      color: 0xffffff,
      specular: 0xffe9c6,
      shininess: 80,
      emissive: 0x06232b,
      emissiveIntensity: 0.22,
    });
    const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE * 1.8, TERRAIN_SIZE * 1.8);
    geometry.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geometry, this.waterMaterial);
    this.water.position.set(0, SEA_LEVEL, 0);
    this.water.name = 'sea';
    this.scene.add(this.water);

    this.sunPathMaterial = new THREE.MeshBasicMaterial({
      map: makeSunPathTexture(),
      color: 0xffd8a0,
      transparent: true,
      opacity: 0.68,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const sunPath = new THREE.Mesh(new THREE.PlaneGeometry(3600, 1500), this.sunPathMaterial);
    sunPath.rotation.x = -Math.PI / 2;
    sunPath.position.set(-3000, SEA_LEVEL + 0.07, -350);
    sunPath.renderOrder = 2;
    this.sunPath = sunPath;
    this.scene.add(sunPath);

    // A thin foam line where the beach meets the sea.
    const foamPositions: number[] = [];
    for (let z = -2700; z <= 2700; z += 26) {
      const x = this.coastAt(z) + 27 * MAP_SCALE;
      foamPositions.push(x - 3.6, SEA_LEVEL + 0.08, z, x + 3.6, SEA_LEVEL + 0.08, z);
    }
    const foam = new THREE.BufferGeometry();
    foam.setAttribute('position', new THREE.Float32BufferAttribute(foamPositions, 3));
    const indices: number[] = [];
    for (let i = 0; i < foamPositions.length / 6 - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    foam.setIndex(indices);
    const surf = new THREE.Mesh(
      foam,
      new THREE.MeshBasicMaterial({
        color: 0xe9fffa,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    surf.renderOrder = 3;
    this.scene.add(surf);
  }

  // ------------------------------------------------------------------- road

  private ribbon(minOffset: number, maxOffset: number, y: number, alongScale = 0.1): THREE.BufferGeometry {
    const frames = this.route.frames;
    const n = frames.length;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= n; i++) {
      const frame = frames[i % n];
      const distance = i === n ? this.route.length : frame.distance;
      for (const offset of [minOffset, maxOffset]) {
        positions.push(
          frame.position.x + frame.right.x * offset,
          frame.position.y + y,
          frame.position.z + frame.right.z * offset,
        );
        uvs.push(offset === minOffset ? 0 : 1, distance * alongScale);
      }
    }

    for (let i = 0; i < n; i++) {
      const a0 = i * 2;
      const b0 = a0 + 1;
      const a1 = a0 + 2;
      const b1 = a0 + 3;
      indices.push(a0, b0, a1, b0, b1, a1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private dashedBand(offset: number, width: number, dash: number, gap: number): THREE.BufferGeometry {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const steps = 2;

    for (let start = 0; start < this.route.length; start += dash + gap) {
      const base = positions.length / 3;
      for (let s = 0; s <= steps; s++) {
        const distance = start + (s / steps) * dash;
        const frame = this.route.frameAt(distance);
        for (const edge of [-1, 1]) {
          const lateral = offset + edge * width * 0.5;
          positions.push(
            frame.position.x + frame.right.x * lateral,
            frame.position.y + 0.036,
            frame.position.z + frame.right.z * lateral,
          );
          uvs.push(edge > 0 ? 1 : 0, s / steps);
        }
      }
      for (let s = 0; s < steps; s++) {
        const a0 = base + s * 2;
        const b0 = a0 + 1;
        const a1 = a0 + 2;
        const b1 = a0 + 3;
        indices.push(a0, b0, a1, b0, b1, a1);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private buildRoad(): void {
    const asphalt = makeAsphaltTexture();
    const road = new THREE.Mesh(
      this.ribbon(-ROAD.halfWidth, ROAD.halfWidth, 0.022, 0.085),
      new THREE.MeshLambertMaterial({ map: asphalt, color: 0xd9d5cc }),
    );
    road.name = 'highway';
    this.scene.add(road);

    const shoulderParts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const inner = side * (ROAD.halfWidth + 0.02);
      const outer = side * (ROAD.halfWidth + ROAD.shoulder);
      shoulderParts.push(this.ribbon(Math.min(inner, outer), Math.max(inner, outer), 0.018, 0.12));
    }
    const shoulders = new THREE.Mesh(
      mergeParts(shoulderParts),
      new THREE.MeshLambertMaterial({ color: 0xb4a98b }),
    );
    this.scene.add(shoulders);
  }

  /** Flat grass embankment that carries the eye from shoulder to terrain. */
  private buildRoadVerge(): void {
    const parts: THREE.BufferGeometry[] = [];
    const inner = ROAD.halfWidth + ROAD.shoulder + 0.02;
    const outer = 26;
    const frames = this.route.frames;

    for (const side of [-1, 1] as const) {
      const positions: number[] = [];
      const indices: number[] = [];
      for (let i = 0; i <= frames.length; i++) {
        const frame = frames[i % frames.length];
        for (const [offset, drop] of [[inner, 0.015], [outer, 0.5]] as const) {
          positions.push(
            frame.position.x + frame.right.x * side * offset,
            frame.position.y - drop,
            frame.position.z + frame.right.z * side * offset,
          );
        }
      }
      for (let i = 0; i < frames.length; i++) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      parts.push(geometry);
    }

    const verge = new THREE.Mesh(
      mergeParts(parts),
      new THREE.MeshLambertMaterial({ color: 0x6f8d4e, side: THREE.DoubleSide }),
    );
    verge.name = 'road-verge';
    this.scene.add(verge);
  }

  private buildMarkings(): void {
    const parts: THREE.BufferGeometry[] = [];
    for (const boundary of [-ROAD.laneWidth, ROAD.laneWidth]) {
      parts.push(this.dashedBand(boundary, 0.13, 5.4, 8.8));
    }
    for (const edge of [-7.32, 7.32]) {
      parts.push(this.ribbon(edge - 0.07, edge + 0.07, 0.032, 0.15));
    }

    const material = new THREE.MeshLambertMaterial({
      color: 0xf3ecd8,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const lines = new THREE.Mesh(mergeParts(parts), material);
    lines.name = 'lane-markings';
    this.scene.add(lines);

    const centre = new THREE.Mesh(
      mergeParts([
        this.ribbon(-0.19, -0.07, 0.034, 0.15),
        this.ribbon(0.07, 0.19, 0.034, 0.15),
      ]),
      new THREE.MeshLambertMaterial({
        color: 0xf0c66f,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    centre.name = 'centre-line';
    this.scene.add(centre);
  }

  private railBand(offset: number, y0: number, y1: number): THREE.BufferGeometry {
    const frames = this.route.frames;
    const n = frames.length;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= n; i++) {
      const frame = frames[i % n];
      const distance = i === n ? this.route.length : frame.distance;
      const x = frame.position.x + frame.right.x * offset;
      const z = frame.position.z + frame.right.z * offset;
      const deck = frame.position.y;
      positions.push(x, deck + y0, z, x, deck + y1, z);
      uvs.push(distance * 0.08, 0, distance * 0.08, 1);
    }

    for (let i = 0; i < n; i++) {
      const a0 = i * 2;
      const b0 = a0 + 1;
      const a1 = a0 + 2;
      const b1 = a0 + 3;
      indices.push(a0, a1, b0, b0, a1, b1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private railIntervals(side: number): Array<[number, number]> {
    const gaps = this.roads.mainGaps
      .filter((gap) => gap.side === side)
      .sort((a, b) => a.start - b.start);
    if (gaps.length === 0) return [[0, this.route.length]];
    const intervals: Array<[number, number]> = [];
    let cursor = 0;
    for (const gap of gaps) {
      const start = THREE.MathUtils.clamp(gap.start, 0, this.route.length);
      const end = THREE.MathUtils.clamp(gap.end, 0, this.route.length);
      if (start > cursor + 0.5) intervals.push([cursor, start]);
      cursor = Math.max(cursor, end);
    }
    if (cursor < this.route.length - 0.5) intervals.push([cursor, this.route.length]);
    return intervals;
  }

  private railBandRange(offset: number, y0: number, y1: number, start: number, end: number): THREE.BufferGeometry {
    const steps = Math.max(1, Math.ceil((end - start) / 5));
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= steps; i++) {
      const distance = start + ((end - start) * i) / steps;
      const frame = this.route.frameAt(distance);
      const x = frame.position.x + frame.right.x * offset;
      const z = frame.position.z + frame.right.z * offset;
      const deck = frame.position.y;
      positions.push(x, deck + y0, z, x, deck + y1, z);
      uvs.push(distance * 0.08, 0, distance * 0.08, 1);
    }
    for (let i = 0; i < steps; i++) {
      const a0 = i * 2;
      indices.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private buildRailings(): void {
    const railParts: THREE.BufferGeometry[] = [];
    const postPositions: Array<{ x: number; y: number; z: number; yaw: number }> = [];
    for (const side of [-1, 1] as const) {
      const offset = side * ROAD.railOffset;
      for (const [start, end] of this.railIntervals(side)) {
        railParts.push(this.railBandRange(offset, 0.44, 0.72, start, end));
        railParts.push(this.railBandRange(offset, 0.75, 0.82, start, end));
        for (let distance = start + 4; distance < end; distance += 9) {
          const frame = this.route.frameAt(distance);
          postPositions.push({
            x: frame.position.x + frame.right.x * offset,
            y: frame.position.y + 0.41,
            z: frame.position.z + frame.right.z * offset,
            yaw: Math.atan2(frame.tangent.x, frame.tangent.z),
          });
        }
      }
    }

    const rail = new THREE.Mesh(
      mergeParts(railParts),
      new THREE.MeshPhongMaterial({
        color: 0xb7c1c4,
        specular: 0xffffff,
        shininess: 42,
        side: THREE.DoubleSide,
      }),
    );
    rail.name = 'guardrails';
    this.scene.add(rail);

    const posts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.09, 0.82, 0.09),
      new THREE.MeshLambertMaterial({ color: 0x7e898c }),
      postPositions.length,
    );
    const dummy = new THREE.Object3D();
    postPositions.forEach((post, index) => {
      dummy.position.set(post.x, post.y, post.z);
      dummy.rotation.set(0, post.yaw, 0);
      dummy.updateMatrix();
      posts.setMatrixAt(index, dummy.matrix);
    });
    posts.count = postPositions.length;
    posts.instanceMatrix.needsUpdate = true;
    posts.frustumCulled = false;
    this.scene.add(posts);
  }

  // ----------------------------------------------------------------- bridge

  private buildBridge(): void {
    const span = this.bridgeEnd - this.bridgeStart;
    if (span <= 0) return;

    const deckParts: THREE.BufferGeometry[] = [];
    const pierParts: THREE.BufferGeometry[] = [];
    const towerParts: THREE.BufferGeometry[] = [];
    const cableVertices: number[] = [];
    const deckBeam = new THREE.BoxGeometry(ROAD.railOffset * 2 + 2.4, 0.34, 1.7);
    const pier = new THREE.BoxGeometry(1.25, 1, 1.25);
    const tower = new THREE.BoxGeometry(1.35, 26, 1.35);
    const towerCap = new THREE.BoxGeometry(ROAD.railOffset * 2 + 5.2, 0.8, 1.8);

    for (let distance = this.bridgeStart; distance <= this.bridgeEnd; distance += 24) {
      const frame = this.route.frameAt(distance);
      const yaw = Math.atan2(-frame.right.z, frame.right.x);
      deckParts.push(transformed(deckBeam, [frame.position.x, frame.position.y - 0.19, frame.position.z], [0, yaw, 0]));

      if (Math.round((distance - this.bridgeStart) / 24) % 2 === 0) {
        for (const side of [-1, 1] as const) {
          const base = SEA_LEVEL - 4;
          const top = frame.position.y - 0.2;
          const height = Math.max(1, top - base);
          pierParts.push(
            transformed(pier, [
              frame.position.x + frame.right.x * side * (ROAD.railOffset - 0.6),
              base + height / 2,
              frame.position.z + frame.right.z * side * (ROAD.railOffset - 0.6),
            ], [0, yaw, 0], [1, height, 1]),
          );
        }
      }
    }

    const towerDistances = [this.bridgeStart + span * 0.34, this.bridgeStart + span * 0.68];
    for (const distance of towerDistances) {
      const frame = this.route.frameAt(distance);
      const yaw = Math.atan2(-frame.right.z, frame.right.x);
      for (const side of [-1, 1] as const) {
        towerParts.push(
          transformed(tower, [
            frame.position.x + frame.right.x * side * (ROAD.railOffset + 2.7),
            frame.position.y + 12.4,
            frame.position.z + frame.right.z * side * (ROAD.railOffset + 2.7),
          ]),
        );
        const topX = frame.position.x + frame.right.x * side * (ROAD.railOffset + 2.7);
        const topZ = frame.position.z + frame.right.z * side * (ROAD.railOffset + 2.7);
        for (let d = this.bridgeStart; d <= this.bridgeEnd; d += 28) {
          const anchor = this.route.frameAt(d);
          cableVertices.push(
            topX, frame.position.y + 24.1, topZ,
            anchor.position.x + anchor.right.x * side * ROAD.railOffset,
            anchor.position.y + 1.1,
            anchor.position.z + anchor.right.z * side * ROAD.railOffset,
          );
        }
      }
      towerParts.push(
        transformed(towerCap, [
          frame.position.x,
          frame.position.y + 24.6,
          frame.position.z,
        ], [0, yaw, 0]),
      );
    }

    const concrete = new THREE.MeshLambertMaterial({ color: 0x9ca39b });
    const deck = new THREE.Mesh(mergeParts(deckParts), new THREE.MeshLambertMaterial({ color: 0x5b6362 }));
    const piers = new THREE.Mesh(mergeParts(pierParts), concrete);
    const towers = new THREE.Mesh(mergeParts(towerParts), new THREE.MeshLambertMaterial({ color: 0xb4b8ae }));
    deck.name = 'suspension-bridge-deck';
    piers.name = 'suspension-bridge-piers';
    towers.name = 'suspension-bridge-towers';
    this.scene.add(deck, piers, towers);

    const cableGeometry = new THREE.BufferGeometry();
    cableGeometry.setAttribute('position', new THREE.Float32BufferAttribute(cableVertices, 3));
    const cables = new THREE.LineSegments(
      cableGeometry,
      new THREE.LineBasicMaterial({ color: 0xd5e0dc, transparent: true, opacity: 0.72 }),
    );
    cables.name = 'suspension-bridge-cables';
    this.scene.add(cables);

    deckBeam.dispose();
    pier.dispose();
    tower.dispose();
    towerCap.dispose();
  }

  // ------------------------------------------------------------------ gates

  private gateFrameQuaternion(tangent: THREE.Vector3): THREE.Quaternion {
    return new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(new THREE.Vector3(), tangent, UP),
    );
  }

  private buildGates(): void {
    const frameParts: THREE.BufferGeometry[] = [];
    const postGeometry = new THREE.BoxGeometry(0.17, 5.55, 0.17);
    const beamGeometry = new THREE.BoxGeometry(16.35, 0.17, 0.22);

    for (const distance of this.route.gateDistances) {
      const frame = this.route.frameAt(distance);
      const yaw = Math.atan2(-frame.right.z, frame.right.x);
      const deck = frame.position.y;
      for (const side of [-1, 1]) {
        frameParts.push(
          transformed(postGeometry, [
            frame.position.x + frame.right.x * side * (ROAD.railOffset - 0.35),
            deck + 2.78,
            frame.position.z + frame.right.z * side * (ROAD.railOffset - 0.35),
          ]),
        );
      }
      frameParts.push(
        transformed(beamGeometry, [frame.position.x, deck + 5.48, frame.position.z], [0, yaw, 0]),
      );
    }

    const gates = new THREE.Mesh(
      mergeParts(frameParts),
      new THREE.MeshLambertMaterial({ color: 0x6d7778 }),
    );
    gates.name = 'sector-gates';
    this.scene.add(gates);
    postGeometry.dispose();
    beamGeometry.dispose();

    this.gateGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd18b,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.gateGlow = new THREE.Mesh(new THREE.BoxGeometry(15.8, 0.07, 0.12), this.gateGlowMaterial);
    this.gateGlow.renderOrder = 4;
    this.scene.add(this.gateGlow);
    this.setActiveGate(0);
  }

  private makeSignTexture(title: string, subtitle: string, accent: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 224;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is unavailable');
    ctx.fillStyle = '#15272b';
    ctx.fillRect(0, 0, 512, 224);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 18, 224);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(36, 36, 440, 1);
    ctx.fillStyle = '#f7f0df';
    ctx.font = '700 42px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title.toUpperCase(), 42, 106);
    ctx.fillStyle = accent;
    ctx.font = '500 17px "IBM Plex Mono", monospace';
    ctx.fillText(subtitle.toUpperCase(), 42, 144);
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    ctx.font = '500 14px "IBM Plex Mono", monospace';
    ctx.fillText('ISLAND ROUTE', 42, 184);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  private buildRegionSigns(): void {
    const postGeometry = new THREE.CylinderGeometry(0.06, 0.08, 2.8, 6);
    const postParts: THREE.BufferGeometry[] = [];

    for (const region of REGIONS) {
      const distance = this.route.regionStart(region.id) + 26;
      const frame = this.route.frameAt(distance);
      const offset = ROAD.railOffset + 7.4;
      const x = frame.position.x + frame.right.x * offset;
      const z = frame.position.z + frame.right.z * offset;
      const ground = this.terrainHeight(x, z);

      for (const side of [-1, 1]) {
        postParts.push(
          transformed(postGeometry, [x + frame.right.x * side * 1.45, ground + 1.35, z + frame.right.z * side * 1.45]),
        );
      }

      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(3.1, 1.36),
        new THREE.MeshBasicMaterial({
          map: this.makeSignTexture(region.name, region.tagline, region.color),
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      panel.position.set(x, ground + 2.2, z);
      panel.quaternion.copy(this.gateFrameQuaternion(frame.tangent));
      panel.name = `region-sign-${region.id}`;
      this.scene.add(panel);
    }

    const posts = new THREE.Mesh(
      mergeParts(postParts),
      new THREE.MeshLambertMaterial({ color: 0x4b5556 }),
    );
    this.scene.add(posts);
    postGeometry.dispose();
  }

  // ---------------------------------------------------------------- beach

  private beachSurfaceY(distance: number, lateral: number): number {
    const frame = this.route.frameAt(distance);
    const t = THREE.MathUtils.clamp((lateral - ROAD.railOffset) / 62, 0, 1);
    const x = frame.position.x - frame.right.x * lateral;
    const z = frame.position.z - frame.right.z * lateral;
    return Math.max(
      frame.position.y - 0.12 - t * 3.4,
      this.terrainHeight(x, z) + 0.08,
      SEA_LEVEL + 0.35,
    );
  }

  private buildBeach(): void {
    const rng = makeRng(0x8f31d0a7);
    const coastEnd = this.route.regionStart('valley');
    const ranges: Array<[number, number]> = [
      [2, Math.max(10, this.bridgeStart - 90)],
      [Math.min(this.bridgeEnd + 90, coastEnd - 10), Math.max(this.bridgeEnd + 100, coastEnd - 20)],
    ];
    const rows = [8.2, 21, 36, 52, 68];
    const positions: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const dry = new THREE.Color(0xe3cb98);
    const wet = new THREE.Color(0xb7a57d);

    for (const [from, to] of ranges) {
      if (to <= from) continue;
      const start = positions.length / 3;
      let rowCount = 0;
      for (let distance = from; distance <= to; distance += 7) {
        const frame = this.route.frameAt(distance);
        rows.forEach((lateral, row) => {
          const x = frame.position.x - frame.right.x * lateral;
          const z = frame.position.z - frame.right.z * lateral;
          positions.push(x, this.beachSurfaceY(distance, lateral), z);
          const color = wet.clone().lerp(dry, 1 - row / (rows.length - 1) * 0.35);
          colors.push(color.r, color.g, color.b);
          uvs.push(row / (rows.length - 1) * 2, distance * 0.025);
        });
        rowCount++;
      }
      for (let i = 0; i < rowCount - 1; i++) {
        for (let row = 0; row < rows.length - 1; row++) {
          const a = start + i * rows.length + row;
          const b = a + rows.length;
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const shelf = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    );
    shelf.name = 'coastal-beach';
    this.scene.add(shelf);

    const umbrellaPoles: InstanceSpec[] = [];
    const umbrellaTops: InstanceSpec[] = [];
    const towels: InstanceSpec[] = [];
    const beachColors = [0xffb46e, 0xf06d55, 0x8ec9bb, 0xf2d48a, 0x7c9fcc];

    for (const [from, to] of ranges) {
      for (let distance = from + 12; distance < to - 8; distance += 17) {
        for (const lateral of [ROAD.railOffset + 8 + rng() * 22, ROAD.railOffset + 36 + rng() * 22]) {
          if (rng() > 0.78) continue;
          const frame = this.route.frameAt(distance);
          const x = frame.position.x - frame.right.x * lateral;
          const z = frame.position.z - frame.right.z * lateral;
          const y = this.beachSurfaceY(distance, lateral) + 0.03;
          const rotation = rng() * Math.PI * 2;
          umbrellaPoles.push({ x, y, z, rotation, scale: [1, 2.45, 1] });
          umbrellaTops.push({
            x, y: y + 2.36, z, rotation,
            scale: [1.55, 0.9, 1.55],
            color: new THREE.Color(beachColors[Math.floor(rng() * beachColors.length)]),
          });
          towels.push({
            x: x + Math.cos(rotation) * 2.1,
            y: y + 0.06,
            z: z + Math.sin(rotation) * 2.1,
            rotation: rotation + 0.25,
            scale: [1, 1, 1],
            color: new THREE.Color(beachColors[Math.floor(rng() * beachColors.length)]),
          });
        }
      }
    }

    const poleGeometry = new THREE.CylinderGeometry(0.055, 0.07, 1, 6);
    poleGeometry.translate(0, 0.5, 0);
    const canopyGeometry = new THREE.ConeGeometry(1, 1, 9);
    const towelGeometry = new THREE.BoxGeometry(1.25, 0.028, 2.2);
    this.createInstanced(poleGeometry, new THREE.MeshLambertMaterial({ color: 0xe7dcc1 }), umbrellaPoles);
    this.createInstanced(canopyGeometry, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), umbrellaTops);
    this.createInstanced(towelGeometry, new THREE.MeshLambertMaterial({ color: 0xffffff }), towels);

    // A striped lifeguard hut gives the beach a clear destination from the road.
    const hutDistance = this.route.length * 0.012;
    if (hutDistance > this.bridgeStart - 60) return;
    const frame = this.route.frameAt(hutDistance);
    const lateral = 34;
    const x = frame.position.x - frame.right.x * lateral;
    const z = frame.position.z - frame.right.z * lateral;
    const y = this.beachSurfaceY(hutDistance, lateral);
    const yaw = Math.atan2(-frame.tangent.x, -frame.tangent.z);
    const hut = new THREE.Group();
    hut.position.set(x, y, z);
    hut.rotation.y = yaw;
    const timber = new THREE.MeshLambertMaterial({ color: 0xe9dfc7 });
    const red = new THREE.MeshLambertMaterial({ color: 0xd85645 });
    for (const sx of [-1.7, 1.7]) {
      for (const sz of [-1.35, 1.35]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.5, 0.16), timber);
        leg.position.set(sx, 1.25, sz);
        hut.add(leg);
      }
    }
    const platform = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.22, 3.6), timber);
    platform.position.y = 2.55;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.1, 2.5), timber);
    cabin.position.y = 3.7;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.1, 4), red);
    roof.position.y = 5.25;
    roof.rotation.y = Math.PI / 4;
    const shutter = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.65, 0.04), red);
    shutter.position.set(0, 3.9, 1.27);
    hut.add(platform, cabin, roof, shutter);
    this.scene.add(hut);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 4.4, 6), timber);
    pole.position.set(1.75, 4.25, 1.1);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.72), red);
    flag.position.set(2.5, 6.1, 1.1);
    hut.add(pole, flag);

    const sign = this.makeSignTexture('Golden Coast', 'beach access · lifeguard', '#ffbe73');
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 1.5),
      new THREE.MeshBasicMaterial({ map: sign, side: THREE.DoubleSide, toneMapped: false }),
    );
    const signDistance = hutDistance - 20;
    const signFrame = this.route.frameAt(signDistance);
    panel.position.set(
      signFrame.position.x - signFrame.right.x * (ROAD.railOffset + 4),
      signFrame.position.y + 2.4,
      signFrame.position.z - signFrame.right.z * (ROAD.railOffset + 4),
    );
    panel.quaternion.copy(this.gateFrameQuaternion(signFrame.tangent));
    this.scene.add(panel);
  }

  // -------------------------------------------------------- roadside network

  private curveRibbon(curve: THREE.CatmullRomCurve3, width: number, lift = 0): THREE.BufferGeometry {
    const segments = Math.max(28, Math.ceil(curve.getLength() / 2.6));
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const point = curve.getPoint(t);
      const tangent = curve.getTangent(t);
      const right = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      for (const side of [-1, 1] as const) {
        positions.push(
          point.x + right.x * side * width * 0.5,
          point.y + lift,
          point.z + right.z * side * width * 0.5,
        );
        uvs.push(side > 0 ? 1 : 0, t * curve.getLength() * 0.06);
      }
    }
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private curveBarrier(curve: THREE.CatmullRomCurve3, width: number): THREE.BufferGeometry {
    const segments = Math.max(28, Math.ceil(curve.getLength() / 2.6));
    const positions: number[] = [];
    const indices: number[] = [];
    for (const side of [-1, 1] as const) {
      const base = positions.length / 3;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const point = curve.getPoint(t);
        const tangent = curve.getTangent(t);
        const right = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const x = point.x + right.x * side * width * 0.5;
        const z = point.z + right.z * side * width * 0.5;
        positions.push(x, point.y + 0.04, z, x, point.y + 1.0, z);
      }
      for (let i = 0; i < segments; i++) {
        const a = base + i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private buildRoundabout(distance: number, centerOffset = 49): void {
    const frame = this.route.frameAt(distance);
    const center = frame.position.clone().addScaledVector(frame.right, centerOffset);
    const y = frame.position.y + 0.05;
    const ground = this.terrainHeight(center.x, center.z);
    const baseHeight = Math.max(0.4, y - ground + 0.45);
    const concrete = new THREE.MeshLambertMaterial({ color: 0xaaa99c });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(23.5, 24.0, baseHeight, 48), concrete);
    base.position.set(center.x, y - baseHeight / 2, center.z);
    this.scene.add(base);

    const asphalt = new THREE.MeshLambertMaterial({ map: makeAsphaltTexture(), color: 0xd7d2c7 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(10.6, 23, 56, 1), asphalt);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(center.x, y + 0.05, center.z);
    ring.name = 'seaview-roundabout';
    this.scene.add(ring);

    const white = new THREE.MeshBasicMaterial({ color: 0xf3ecd8 });
    for (const [inner, outer] of [[22.45, 22.75], [10.85, 11.05]]) {
      const line = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 56, 1), white);
      line.rotation.x = -Math.PI / 2;
      line.position.set(center.x, y + 0.08, center.z);
      this.scene.add(line);
    }

    const island = new THREE.Mesh(
      new THREE.CylinderGeometry(10.25, 10.55, 1.25, 40),
      new THREE.MeshLambertMaterial({ color: 0x6f914c }),
    );
    island.position.set(center.x, y + 0.55, center.z);
    this.scene.add(island);

    const sculptureParts: THREE.BufferGeometry[] = [];
    for (const [dx, dz, height, tilt] of [[-1.6, 0.5, 7.5, -0.18], [1.2, 0.2, 9.5, 0.12], [0.2, -1.8, 5.6, 0.24]]) {
      sculptureParts.push(
        transformed(new THREE.ConeGeometry(1.15, height, 4), [center.x + dx, y + 1.6 + height / 2, center.z + dz], [tilt, 0.4, tilt * 0.5]),
      );
    }
    const sculpture = new THREE.Mesh(
      mergeParts(sculptureParts),
      new THREE.MeshLambertMaterial({ color: 0xd8d3c2 }),
    );
    sculpture.name = 'roundabout-sculpture';
    this.scene.add(sculpture);

    const armMaterial = new THREE.MeshLambertMaterial({ map: makeAsphaltTexture(), color: 0xd7d2c7 });
    const addArm = (direction: THREE.Vector3, from: number, length: number) => {
      const dir = direction.clone().normalize();
      const road = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.12, length), armMaterial);
      road.position.set(
        center.x + dir.x * (from + length / 2),
        y + 0.04,
        center.z + dir.z * (from + length / 2),
      );
      road.rotation.y = Math.atan2(dir.x, dir.z);
      this.scene.add(road);
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.014, length * 0.92), white);
      line.position.copy(road.position);
      line.position.y = y + 0.11;
      line.rotation.copy(road.rotation);
      this.scene.add(line);
    };

    const towardRoad = frame.right.clone().multiplyScalar(-1);
    addArm(towardRoad, 21.5, 18);
    for (const angle of [Math.PI * 2 / 3, -Math.PI * 2 / 3]) {
      const dir = towardRoad.clone().applyAxisAngle(Y_AXIS, angle);
      addArm(dir, 21.5, 62);
    }

    const lampMaterial = new THREE.MeshLambertMaterial({ color: 0x3f4949 });
    const bulbMaterial = new THREE.MeshBasicMaterial({ color: 0xffd59c });
    for (const angle of [0.3, 2.5, 4.6]) {
      const x = center.x + Math.cos(angle) * 25.5;
      const z = center.z + Math.sin(angle) * 25.5;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 6.4, 6), lampMaterial);
      post.position.set(x, y + 3.2, z);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 7, 5), bulbMaterial);
      bulb.position.set(x, y + 6.45, z);
      this.scene.add(post, bulb);
    }

    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 1.95),
      new THREE.MeshBasicMaterial({
        map: this.makeSignTexture('Seaview Roundabout', 'beach road · island loop', '#ffbd73'),
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    panel.position.set(center.x - frame.right.x * 12, y + 3.2, center.z - frame.right.z * 12);
    panel.lookAt(frame.position.x, y + 3.2, frame.position.z);
    this.scene.add(panel);
  }

  private buildInterchange(distance: number): void {
    const frame = this.route.frameAt(distance);
    const t = frame.tangent;
    const r = frame.right;
    const y = frame.position.y;
    const point = (side: number, along: number, lift: number) =>
      new THREE.Vector3(
        frame.position.x + r.x * side + t.x * along,
        y + lift,
        frame.position.z + r.z * side + t.z * along,
      );
    const points = [
      point(62, -150, 1.6),
      point(56, -80, 4.4),
      point(46, -18, 9.2),
      point(23, 34, 12.8),
      point(-4, 74, 13.8),
      point(-30, 114, 11.8),
      point(-52, 168, 7.2),
      point(-58, 230, 1.6),
    ];
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.18);
    const asphalt = new THREE.MeshLambertMaterial({
      map: makeAsphaltTexture(),
      color: 0xd7d2c7,
      side: THREE.DoubleSide,
    });
    const deck = new THREE.Mesh(this.curveRibbon(curve, 8.8, 0.05), asphalt);
    deck.name = 'skyway-flyover';
    this.scene.add(deck);

    const edge = new THREE.Mesh(
      this.curveBarrier(curve, 8.8),
      new THREE.MeshLambertMaterial({ color: 0xb8b8aa, side: THREE.DoubleSide }),
    );
    this.scene.add(edge);
    const centreLine = new THREE.Mesh(
      this.curveRibbon(curve, 0.24, 0.11),
      new THREE.MeshBasicMaterial({ color: 0xf0c66f, side: THREE.DoubleSide }),
    );
    this.scene.add(centreLine);

    const columnParts: THREE.BufferGeometry[] = [];
    const columnGeometry = new THREE.BoxGeometry(1.35, 1, 1.05);
    for (let i = 1; i < 22; i++) {
      const p = curve.getPoint(i / 22);
      const ground = this.terrainHeight(p.x, p.z);
      const height = p.y - ground;
      if (height < 3.2) continue;
      if (this.routeSample(p.x, p.z).distance < ROAD.railOffset + 4.5) continue;
      const tangent = curve.getTangent(i / 22);
      columnParts.push(
        transformed(columnGeometry, [p.x, ground + height / 2, p.z], [0, Math.atan2(-tangent.z, tangent.x), 0], [1, height, 1]),
      );
    }
    columnGeometry.dispose();
    if (columnParts.length > 0) {
      const columns = new THREE.Mesh(mergeParts(columnParts), new THREE.MeshLambertMaterial({ color: 0xa9aca2 }));
      columns.name = 'skyway-supports';
      this.scene.add(columns);
    }

    const poleParts: THREE.BufferGeometry[] = [];
    const poleGeometry = new THREE.CylinderGeometry(0.08, 0.11, 7, 6);
    for (const at of [0.17, 0.36, 0.55, 0.74, 0.9]) {
      const p = curve.getPoint(at);
      poleParts.push(transformed(poleGeometry, [p.x, p.y + 4.2, p.z]));
    }
    poleGeometry.dispose();
    const poles = new THREE.Mesh(mergeParts(poleParts), new THREE.MeshLambertMaterial({ color: 0x465050 }));
    this.scene.add(poles);

    // Direction sign on the approach to the interchange.
    const signDistance = distance - 86;
    const signFrame = this.route.frameAt(signDistance);
    const gantryParts: THREE.BufferGeometry[] = [];
    const gantryPost = new THREE.BoxGeometry(0.18, 6.2, 0.18);
    for (const side of [-1, 1]) {
      gantryParts.push(
        transformed(gantryPost, [
          signFrame.position.x + signFrame.right.x * side * (ROAD.railOffset + 0.8),
          signFrame.position.y + 3.1,
          signFrame.position.z + signFrame.right.z * side * (ROAD.railOffset + 0.8),
        ]),
      );
    }
    gantryPost.dispose();
    this.scene.add(new THREE.Mesh(mergeParts(gantryParts), new THREE.MeshLambertMaterial({ color: 0x5f6b6a })));
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(6.8, 2.1),
      new THREE.MeshBasicMaterial({
        map: this.makeSignTexture('Coastal Interchange', 'skyway · seaview · beaches', '#8fd9ff'),
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    panel.position.set(signFrame.position.x, signFrame.position.y + 5.8, signFrame.position.z);
    panel.rotation.y = Math.atan2(-signFrame.tangent.x, -signFrame.tangent.z);
    this.scene.add(panel);
  }

  // ------------------------------------------------------- driveable network

  private pathRibbon(
    path: DrivePath,
    width: number,
    lift = 0.04,
    taperStart = 0,
    taperEnd = 0,
  ): THREE.BufferGeometry {
    const samples = path.samples;
    const count = path.closed ? samples.length + 1 : samples.length;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < count; i++) {
      const sample = samples[i % samples.length];
      let localWidth = width;
      if (!path.closed) {
        const startFactor = taperStart > 0 ? smoothstep(0, taperStart, sample.distance) : 1;
        const endFactor = taperEnd > 0 ? smoothstep(0, taperEnd, path.length - sample.distance) : 1;
        localWidth = Math.max(1.4, width * Math.min(startFactor, endFactor));
      }
      for (const side of [-1, 1] as const) {
        positions.push(
          sample.position.x + sample.right.x * side * localWidth * 0.5,
          sample.position.y + lift,
          sample.position.z + sample.right.z * side * localWidth * 0.5,
        );
        uvs.push(side > 0 ? 1 : 0, sample.distance * 0.075);
      }
    }
    for (let i = 0; i < count - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private pathBand(
    path: DrivePath,
    offset: number,
    width: number,
    lift = 0.07,
    trimStart = 0,
    trimEnd = 0,
  ): THREE.BufferGeometry {
    const samples = trimStart > 0 || trimEnd > 0
      ? path.samples.filter((sample) => sample.distance >= trimStart && sample.distance <= path.length - trimEnd)
      : path.samples;
    const count = path.closed && trimStart === 0 && trimEnd === 0 ? samples.length + 1 : samples.length;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < count; i++) {
      const sample = samples[i % samples.length];
      for (const side of [-1, 1] as const) {
        positions.push(
          sample.position.x + sample.right.x * (offset + side * width * 0.5),
          sample.position.y + lift,
          sample.position.z + sample.right.z * (offset + side * width * 0.5),
        );
      }
    }
    for (let i = 0; i < count - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private pathBarrier(path: DrivePath, trimStart = 0, trimEnd = 0): THREE.BufferGeometry {
    const samples = trimStart > 0 || trimEnd > 0
      ? path.samples.filter((sample) => sample.distance >= trimStart && sample.distance <= path.length - trimEnd)
      : path.samples;
    const count = path.closed && trimStart === 0 && trimEnd === 0 ? samples.length + 1 : samples.length;
    const positions: number[] = [];
    const indices: number[] = [];
    for (const side of [-1, 1] as const) {
      const base = positions.length / 3;
      for (let i = 0; i < count; i++) {
        const sample = samples[i % samples.length];
        const x = sample.position.x + sample.right.x * side * path.halfWidth;
        const z = sample.position.z + sample.right.z * side * path.halfWidth;
        positions.push(x, sample.position.y + 0.03, z, x, sample.position.y + 0.95, z);
      }
      for (let i = 0; i < count - 1; i++) {
        const a = base + i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private buildPathSupports(path: DrivePath, spacing = 5): void {
    const parts: THREE.BufferGeometry[] = [];
    const columnGeometry = new THREE.BoxGeometry(1.15, 1, 0.9);
    for (let i = spacing; i < path.samples.length - spacing; i += spacing) {
      const sample = path.samples[i];
      if (this.routeSample(sample.position.x, sample.position.z).distance < ROAD.railOffset + 5) continue;
      const ground = this.terrainHeight(sample.position.x, sample.position.z);
      const height = sample.position.y - ground;
      if (height < 1.6) continue;
      parts.push(
        transformed(
          columnGeometry,
          [sample.position.x, ground + height / 2, sample.position.z],
          [0, Math.atan2(-sample.tangent.z, sample.tangent.x), 0],
          [1, height, 1],
        ),
      );
    }
    columnGeometry.dispose();
    if (parts.length === 0) return;
    const supports = new THREE.Mesh(mergeParts(parts), new THREE.MeshLambertMaterial({ color: 0xa9aca2 }));
    supports.name = `${path.id}-supports`;
    this.scene.add(supports);
  }

  private buildSkyway(): void {
    const path = this.roads.skyway;
    const asphalt = new THREE.MeshLambertMaterial({
      map: makeAsphaltTexture(),
      color: 0xd7d2c7,
      side: THREE.DoubleSide,
    });
    const road = new THREE.Mesh(this.pathRibbon(path, path.halfWidth * 2, 0.05, 24, 24), asphalt);
    road.name = 'skyway-ramp';
    this.scene.add(road);

    const white = new THREE.MeshBasicMaterial({ color: 0xf3ecd8, side: THREE.DoubleSide });
    for (const offset of [-(path.halfWidth - 0.22), path.halfWidth - 0.22]) {
      const line = new THREE.Mesh(this.pathBand(path, offset, 0.14, 0.1, 26, 26), white);
      this.scene.add(line);
    }
    const centre = new THREE.Mesh(this.pathBand(path, 0, 0.15, 0.1, 26, 26), white);
    this.scene.add(centre);

    const barrier = new THREE.Mesh(
      this.pathBarrier(path, 22, 22),
      new THREE.MeshLambertMaterial({ color: 0xb8b8aa, side: THREE.DoubleSide }),
    );
    barrier.name = 'skyway-barriers';
    this.scene.add(barrier);
    this.buildPathSupports(path, 6);

    const lampMaterial = new THREE.MeshLambertMaterial({ color: 0x465050 });
    const bulbMaterial = new THREE.MeshBasicMaterial({ color: 0xffd59c });
    for (const at of [0.16, 0.33, 0.5, 0.67, 0.84]) {
      const placement = this.roads.placeOnPath(path, path.length * at, -(path.halfWidth + 0.25));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 6.6, 6), lampMaterial);
      pole.position.set(placement.position.x, placement.position.y + 3.3, placement.position.z);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 7, 5), bulbMaterial);
      bulb.position.set(placement.position.x, placement.position.y + 6.6, placement.position.z);
      this.scene.add(pole, bulb);
    }

    // Advance direction sign before the on-ramp.
    const signFrame = this.route.frameAt(this.roads.skywayStart - 48);
    const gantryParts: THREE.BufferGeometry[] = [];
    const gantryPost = new THREE.BoxGeometry(0.18, 6.2, 0.18);
    for (const side of [-1, 1]) {
      gantryParts.push(
        transformed(gantryPost, [
          signFrame.position.x + signFrame.right.x * side * (ROAD.railOffset + 0.8),
          signFrame.position.y + 3.1,
          signFrame.position.z + signFrame.right.z * side * (ROAD.railOffset + 0.8),
        ]),
      );
    }
    gantryPost.dispose();
    this.scene.add(new THREE.Mesh(mergeParts(gantryParts), new THREE.MeshLambertMaterial({ color: 0x5f6b6a })));
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(6.8, 2.1),
      new THREE.MeshBasicMaterial({
        map: this.makeSignTexture('Skyway Interchange', 'on-ramp · coast route', '#8fd9ff'),
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    panel.position.set(signFrame.position.x, signFrame.position.y + 5.8, signFrame.position.z);
    panel.rotation.y = Math.atan2(-signFrame.tangent.x, -signFrame.tangent.z);
    this.scene.add(panel);
  }

  private buildSeaviewRoundabout(): void {
    const center = this.roads.roundaboutCenter;
    const y = this.roads.roundaboutHeight;
    const ground = this.terrainHeight(center.x, center.z);
    const baseHeight = Math.max(0.5, y - ground + 0.45);
    const concrete = new THREE.MeshLambertMaterial({ color: 0xaaa99c });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(24.1, 24.6, baseHeight, 48), concrete);
    base.position.set(center.x, y - baseHeight / 2, center.z);
    this.scene.add(base);

    const asphalt = new THREE.MeshLambertMaterial({
      map: makeAsphaltTexture(),
      color: 0xd7d2c7,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(
      this.pathRibbon(this.roads.roundaboutRing, this.roads.roundaboutRing.halfWidth * 2, 0.05),
      asphalt,
    );
    ring.name = 'seaview-roundabout';
    this.scene.add(ring);

    const white = new THREE.MeshBasicMaterial({ color: 0xf3ecd8, side: THREE.DoubleSide });
    for (const offset of [-(this.roads.roundaboutRing.halfWidth - 0.18), this.roads.roundaboutRing.halfWidth - 0.18]) {
      this.scene.add(new THREE.Mesh(this.pathBand(this.roads.roundaboutRing, offset, 0.15, 0.1), white));
    }
    this.scene.add(new THREE.Mesh(this.pathBand(this.roads.roundaboutRing, 0, 0.12, 0.1), white));

    for (const path of [this.roads.roundaboutEntry, this.roads.roundaboutExit]) {
      const access = new THREE.Mesh(this.pathRibbon(path, path.halfWidth * 2, 0.05, 18, 18), asphalt);
      access.name = path.id;
      this.scene.add(access);
      for (const offset of [-(path.halfWidth - 0.2), path.halfWidth - 0.2]) {
        this.scene.add(new THREE.Mesh(this.pathBand(path, offset, 0.13, 0.1, 20, 20), white));
      }
      this.buildPathSupports(path, 7);
    }

    const island = new THREE.Mesh(
      new THREE.CylinderGeometry(10.25, 10.55, 1.25, 40),
      new THREE.MeshLambertMaterial({ color: 0x6f914c }),
    );
    island.position.set(center.x, y + 0.55, center.z);
    this.scene.add(island);

    const sculptureParts: THREE.BufferGeometry[] = [];
    for (const [dx, dz, height, tilt] of [[-1.6, 0.5, 7.5, -0.18], [1.2, 0.2, 9.5, 0.12], [0.2, -1.8, 5.6, 0.24]]) {
      sculptureParts.push(
        transformed(new THREE.ConeGeometry(1.15, height, 4), [center.x + dx, y + 1.6 + height / 2, center.z + dz], [tilt, 0.4, tilt * 0.5]),
      );
    }
    const sculpture = new THREE.Mesh(
      mergeParts(sculptureParts),
      new THREE.MeshLambertMaterial({ color: 0xd8d3c2 }),
    );
    sculpture.name = 'roundabout-sculpture';
    this.scene.add(sculpture);

    const lampMaterial = new THREE.MeshLambertMaterial({ color: 0x3f4949 });
    const bulbMaterial = new THREE.MeshBasicMaterial({ color: 0xffd59c });
    for (const angle of [0.3, 2.5, 4.6]) {
      const x = center.x + Math.cos(angle) * 25.5;
      const z = center.z + Math.sin(angle) * 25.5;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 6.4, 6), lampMaterial);
      post.position.set(x, y + 3.2, z);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 7, 5), bulbMaterial);
      bulb.position.set(x, y + 6.45, z);
      this.scene.add(post, bulb);
    }

    const frame = this.route.frameAt(this.route.length * 0.104);
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 1.95),
      new THREE.MeshBasicMaterial({
        map: this.makeSignTexture('Seaview Roundabout', 'coast road · island loop', '#ffbd73'),
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    panel.position.set(center.x - frame.right.x * 12, y + 3.2, center.z - frame.right.z * 12);
    panel.lookAt(frame.position.x, y + 3.2, frame.position.z);
    this.scene.add(panel);
  }

  private buildRoadNetwork(): void {
    this.buildSkyway();
    this.buildSeaviewRoundabout();
  }

  // ------------------------------------------------------------ vegetation

  private createInstanced(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    specs: InstanceSpec[],
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, specs.length);
    const dummy = new THREE.Object3D();
    specs.forEach((spec, index) => {
      dummy.position.set(spec.x, spec.y, spec.z);
      dummy.rotation.set(0, spec.rotation, 0);
      dummy.scale.set(...spec.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      if (spec.color) mesh.setColorAt(index, spec.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  private buildRoadside(): void {
    const rng = makeRng(0x51a7c0de);

    const coniferTrunks: InstanceSpec[] = [];
    const coniferCrowns: InstanceSpec[] = [];
    const broadTrunks: InstanceSpec[] = [];
    const broadCrowns: InstanceSpec[] = [];
    const palmTrunks: InstanceSpec[] = [];
    const palmCrowns: InstanceSpec[] = [];
    const rocks: InstanceSpec[] = [];

    const pineGreens = [0x3f6b43, 0x4d7850, 0x335d3a, 0x5f8451];
    const leafGreens = [0x5d914b, 0x75a656, 0x4b8044, 0x8ab45e];
    const palmGreens = [0x548c45, 0x6aa34f, 0x427c3c];

    for (let distance = 8; distance < this.route.length; distance += 11) {
      const frame = this.route.frameAt(distance);
      const region = this.route.regionAt(distance);
      const density =
        region.id === 'mountain' ? 0.94 :
        region.id === 'valley' ? 0.66 :
        region.id === 'city' ? 0.25 : 0.55;

      for (const side of [-1, 1]) {
        if (rng() > density) continue;
        const offset = side * (ROAD.railOffset + 9 + rng() * (region.id === 'mountain' ? 92 : 46));
        const x = frame.position.x + frame.right.x * offset;
        const z = frame.position.z + frame.right.z * offset;
        if (x < this.coastAt(z) + 120 * MAP_SCALE) continue;
        if (this.roads.nearBranch(x, z, 6)) continue;
        const y = this.terrainHeight(x, z);
        if (y < SEA_LEVEL + 1 || y > 132) continue;
        const rotation = rng() * Math.PI * 2;

        let style: 'pine' | 'leaf' | 'palm' = 'leaf';
        if (region.id === 'mountain') style = rng() < 0.83 ? 'pine' : 'leaf';
        else if (region.id === 'coast') style = rng() < 0.58 ? 'palm' : 'leaf';
        else if (region.id === 'city') style = rng() < 0.5 ? 'palm' : 'leaf';
        else style = rng() < 0.45 ? 'pine' : 'leaf';

        if (style === 'pine') {
          const height = 7 + rng() * 9;
          const width = 1.25 + rng() * 0.8;
          coniferTrunks.push({
            x, y, z, rotation,
            scale: [0.95 + rng() * 0.3, height * 0.38, 0.95 + rng() * 0.3],
          });
          coniferCrowns.push({
            x, y: y + height * 0.16, z, rotation,
            scale: [width, height, width],
            color: new THREE.Color(pineGreens[Math.floor(rng() * pineGreens.length)]),
          });
        } else if (style === 'palm') {
          const height = 7.5 + rng() * 5;
          const lean = (rng() - 0.5) * 0.18;
          palmTrunks.push({
            x, y, z, rotation,
            scale: [0.8, height, 0.8],
          });
          palmCrowns.push({
            x: x + Math.sin(rotation) * lean * height,
            y: y + height * 0.97,
            z: z + Math.cos(rotation) * lean * height,
            rotation,
            scale: [1.2 + rng() * 0.55, 1.1 + rng() * 0.4, 1.2 + rng() * 0.55],
            color: new THREE.Color(palmGreens[Math.floor(rng() * palmGreens.length)]),
          });
        } else {
          const height = 5 + rng() * 6.5;
          const width = 1.75 + rng() * 1.5;
          broadTrunks.push({
            x, y, z, rotation,
            scale: [1.05 + rng() * 0.4, height * 0.56, 1.05 + rng() * 0.4],
          });
          broadCrowns.push({
            x, y: y + height * 0.68, z, rotation,
            scale: [width, width * (0.78 + rng() * 0.26), width],
            color: new THREE.Color(leafGreens[Math.floor(rng() * leafGreens.length)]),
          });
        }
      }

      // Larger grey outcrops give the pass a rocky shoulder instead of a
      // continuous mown verge.
      if (region.id === 'mountain' && rng() < 0.58) {
        const side = rng() < 0.5 ? -1 : 1;
        const offset = side * (ROAD.railOffset + 4.2 + rng() * 12);
        const x = frame.position.x + frame.right.x * offset;
        const z = frame.position.z + frame.right.z * offset;
        if (this.roads.nearBranch(x, z, 5)) continue;
        const y = this.terrainHeight(x, z);
        if (y > SEA_LEVEL + 1) {
          const scale = 1.8 + rng() * 3.5;
          rocks.push({
            x, y: y + scale * 0.3, z, rotation: rng() * Math.PI,
            scale: [scale * 1.35, scale * 0.82, scale],
            color: new THREE.Color(rng() < 0.45 ? 0x7c7e73 : 0x939181),
          });
        }
      }

      // A handful of shoreline boulders and mountain scree.
      if (rng() < 0.2) {
        const side = rng() < 0.5 ? -1 : 1;
        const offset = side * (ROAD.railOffset + 4 + rng() * 22);
        const x = frame.position.x + frame.right.x * offset;
        const z = frame.position.z + frame.right.z * offset;
        if (this.roads.nearBranch(x, z, 5)) continue;
        const y = this.terrainHeight(x, z);
        if (y > SEA_LEVEL + 1) {
          const scale = 0.7 + rng() * 2.5;
          rocks.push({
            x, y: y + scale * 0.22, z, rotation: rng() * Math.PI,
            scale: [scale, scale * 0.65, scale],
            color: new THREE.Color(region.id === 'mountain' ? 0x85877d : 0xb4a98d),
          });
        }
      }
    }

    const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x745844 });
    const pineMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const leafMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const palmMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, flatShading: true });
    const rockMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });

    const trunkGeometry = new THREE.CylinderGeometry(0.13, 0.2, 1, 5);
    trunkGeometry.translate(0, 0.5, 0);
    const pineCrownGeometry = mergeGeometries([
      transformed(new THREE.ConeGeometry(0.62, 0.82, 6), [0, 0.42, 0]),
      transformed(new THREE.ConeGeometry(0.47, 0.7, 6), [0, 0.68, 0]),
      transformed(new THREE.ConeGeometry(0.29, 0.56, 6), [0, 0.92, 0]),
    ], false);
    if (!pineCrownGeometry) throw new Error('Unable to build pine crown');
    const leafCrownGeometry = mergeGeometries([
      transformed(new THREE.IcosahedronGeometry(0.72, 0), [0, 0.62, 0]),
      transformed(new THREE.IcosahedronGeometry(0.54, 0), [0.43, 0.52, 0.12]),
      transformed(new THREE.IcosahedronGeometry(0.48, 0), [-0.38, 0.54, -0.18]),
    ], false);
    if (!leafCrownGeometry) throw new Error('Unable to build leaf crown');
    const palmTrunkGeometry = new THREE.CylinderGeometry(0.1, 0.16, 1, 5);
    palmTrunkGeometry.translate(0, 0.5, 0);
    const frondParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) {
      const frond = new THREE.PlaneGeometry(0.26, 2.2, 1, 1);
      frond.translate(0, -1.1, 0);
      frond.rotateX(-0.42);
      frond.rotateY((i / 8) * Math.PI * 2);
      frondParts.push(frond);
    }
    const palmCrownGeometry = mergeGeometries(frondParts, false);
    if (!palmCrownGeometry) throw new Error('Unable to build palm crown');
    const rockGeometry = new THREE.DodecahedronGeometry(1, 0);

    this.createInstanced(trunkGeometry, trunkMaterial, coniferTrunks);
    this.createInstanced(pineCrownGeometry, pineMaterial, coniferCrowns);
    this.createInstanced(trunkGeometry, trunkMaterial, broadTrunks);
    this.createInstanced(leafCrownGeometry, leafMaterial, broadCrowns);
    this.createInstanced(palmTrunkGeometry, trunkMaterial, palmTrunks);
    this.createInstanced(palmCrownGeometry, palmMaterial, palmCrowns);
    this.createInstanced(rockGeometry, rockMaterial, rocks);
  }

  // ------------------------------------------------------------------- city

  private buildCity(): void {
    const rng = makeRng(0x1f0c17a3);
    const specs: InstanceSpec[] = [];
    const sq = (x: number, z: number) => this.routeDistanceSq(x, z);
    const cityStart = this.route.regionStart('city');

    for (let i = 0; i < 250; i++) {
      const distance = cityStart + (rng() - 0.46) * 1500;
      const frame = this.route.frameAt(distance);
      const side = rng() < 0.5 ? -1 : 1;
      const offset = side * (ROAD.railOffset + 20 + Math.pow(rng(), 0.72) * 300);
      const x = frame.position.x + frame.right.x * offset;
      const z = frame.position.z + frame.right.z * offset;
      if (sq(x, z) < 31 * 31) continue;
      const ground = this.terrainHeight(x, z);
      if (ground < -1.5 || ground > 40) continue;
      const height = 16 + Math.pow(rng(), 1.85) * 125;
      const width = 9 + rng() * 24;
      const depth = 9 + rng() * 24;
      const palette = [0xb2b5a9, 0x9caaa9, 0xc6bcaa, 0x879b9f, 0xa9a28d];
      specs.push({
        x, y: ground, z, rotation: rng() * Math.PI,
        scale: [width, height, depth],
        color: new THREE.Color(palette[Math.floor(rng() * palette.length)]),
      });
    }

    // A taller downtown cluster inside the south-east corner of the loop.
    for (let i = 0; i < 70; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = (60 + Math.sqrt(rng()) * 300) * MAP_SCALE;
      const x = 300 * MAP_SCALE + Math.cos(angle) * radius;
      const z = 390 * MAP_SCALE + Math.sin(angle) * radius * 0.72;
      if (sq(x, z) < 42 * 42) continue;
      const ground = this.terrainHeight(x, z);
      if (ground < -1) continue;
      const height = 32 + Math.pow(rng(), 1.5) * 140;
      const width = 12 + rng() * 24;
      specs.push({
        x, y: ground, z, rotation: rng() * Math.PI,
        scale: [width, height, width * (0.7 + rng() * 0.5)],
        color: new THREE.Color([0x9ea9a6, 0xb8b7a8, 0x8799a0][Math.floor(rng() * 3)]),
      });
    }

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const windowMap = makeWindowTexture();
    windowMap.repeat.set(2, 4);
    this.cityWindowMaterial = new THREE.MeshLambertMaterial({
      map: windowMap,
      color: 0xffffff,
      emissiveMap: windowMap,
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });
    this.createInstanced(box, this.cityWindowMaterial, specs);

    // Rooftop blocks break up the boxes at skyline distance.
    const roofs: InstanceSpec[] = specs
      .filter((_, index) => index % 4 === 0)
      .map((spec) => ({
        x: spec.x,
        y: spec.y + spec.scale[1],
        z: spec.z,
        rotation: spec.rotation,
        scale: [spec.scale[0] * 0.42, 1.4, spec.scale[2] * 0.42],
        color: new THREE.Color(0x6e7a78),
      }));
    this.createInstanced(box.clone(), new THREE.MeshLambertMaterial({ color: 0xffffff }), roofs);

    this.buildCityOverpass(cityStart + 310);
  }

  private buildCityOverpass(distance: number): void {
    const frame = this.route.frameAt(distance);
    const yaw = Math.atan2(-frame.right.z, frame.right.x);
    const roadY = frame.position.y;
    const parts: THREE.BufferGeometry[] = [];
    const deck = new THREE.BoxGeometry(30, 1.1, 7.2);
    parts.push(transformed(deck, [frame.position.x, roadY + 7.7, frame.position.z], [0, yaw, 0]));
    deck.dispose();
    const pillar = new THREE.BoxGeometry(1.5, 7.2, 1.5);
    for (const side of [-1, 1]) {
      parts.push(
        transformed(pillar, [
          frame.position.x + frame.right.x * side * 10.8,
          roadY + 3.6,
          frame.position.z + frame.right.z * side * 10.8,
        ]),
      );
    }
    pillar.dispose();

    const concrete = new THREE.Mesh(
      mergeParts(parts),
      new THREE.MeshLambertMaterial({ color: 0xd0c9b5 }),
    );
    this.scene.add(concrete);

    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(6.8, 1.75),
      new THREE.MeshBasicMaterial({
        map: this.makeSignTexture('Harbor City', 'waterfront district', '#8fd9ff'),
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    panel.position.set(
      frame.position.x - frame.tangent.x * 3.62,
      roadY + 8.65,
      frame.position.z - frame.tangent.z * 3.62,
    );
    panel.quaternion.copy(this.gateFrameQuaternion(frame.tangent));
    this.scene.add(panel);
  }

  // --------------------------------------------------------------- mountains


  // --------------------------------------------------------------- skyline

  private buildDistantRidge(): void {
    const haze = new THREE.Color(WORLD.fogColor);
    const starts = THREE.MathUtils.degToRad(205);
    const ends = THREE.MathUtils.degToRad(400);
    const samples = 90;
    const layers = [
      { radius: 2760, height: 320, seed: 2.4, haze: 0.12, base: 0x40574c, mid: 0x687e73, high: 0xaebfb4 },
      { radius: 3080, height: 385, seed: 7.1, haze: 0.3, base: 0x61766d, mid: 0x879a90, high: 0xc7d2ca },
    ];
    const baseY = -40;

    layers.forEach((layer, layerIndex) => {
      const positions: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];
      const base = new THREE.Color(layer.base);
      const mid = new THREE.Color(layer.mid);
      const high = new THREE.Color(layer.high);
      const color = new THREE.Color();

      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const angle = starts + (ends - starts) * t;
        const envelope = smoothstep(0, 0.08, t) * smoothstep(1, 0.92, t);
        const wave =
          Math.sin(angle * 3.1 + layer.seed) * 0.28 +
          Math.sin(angle * 7.3 - layer.seed * 1.4) * 0.14 +
          Math.cos(angle * 13.1 + layer.seed * 2.1) * 0.06 +
          Math.sin(angle * 27.7 - layer.seed * 2.8) * 0.032;
        const ridge = THREE.MathUtils.clamp(0.46 + wave, 0.08, 1) * (0.35 + envelope * 0.65);
        const peak = baseY + layer.height * ridge;
        const radius = layer.radius * (1 + Math.sin(angle * 3.7 + layer.seed) * 0.025);
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const heights = [baseY, baseY + (peak - baseY) * 0.62, peak];

        for (let row = 0; row < 3; row++) {
          positions.push(x, heights[row], z);
          if (row === 0) color.copy(base);
          else if (row === 1) color.copy(mid);
          else color.copy(high);
          color.lerp(haze, layer.haze);
          colors.push(color.r, color.g, color.b);
        }
      }

      for (let i = 0; i < samples; i++) {
        const a = i * 3;
        const b = a + 3;
        indices.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        fog: true,
        toneMapped: false,
      });
      this.ridgeMaterials.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `distant-ridge-${layerIndex}`;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    });
  }

  // --------------------------------------------------------------- quality

  setQuality(quality: Quality): void {
    this.quality = quality;
    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) {
      fog.near = quality === 'low' ? 190 : quality === 'medium' ? 300 : 380;
      fog.far = quality === 'low' ? 1700 : quality === 'medium' ? 2850 : 3400;
    }
  }

  setActiveGate(index: number): void {
    this.activeGate = index;
    const distance = this.route.gateDistances[index];
    if (distance == null) return;
    const frame = this.route.frameAt(distance);
    this.gateGlow.position.set(frame.position.x, frame.position.y + 5.4, frame.position.z);
    this.gateGlow.quaternion.copy(this.gateFrameQuaternion(frame.tangent));
    this.gateGlowMaterial.color.setHex(0xffd18b);
  }

  update(dt: number, camera: THREE.Camera | null = null): void {
    this.time += dt;
    this.atmosphere.update(dt, camera);
    this.waterTexture.offset.x = (this.waterTexture.offset.x + dt * 0.0022) % 1;
    this.waterTexture.offset.y = (this.waterTexture.offset.y + dt * 0.0038) % 1;
    const sunMap = this.sunPathMaterial.map;
    if (sunMap) sunMap.offset.y = (sunMap.offset.y + dt * 0.006) % 1;

    this.waterMaterial.color.copy(this.atmosphere.waterTint);
    this.waterMaterial.emissiveIntensity = 0.22 * (1 - this.atmosphere.nightFactor * 0.45);
    this.sunPathMaterial.opacity = 0.68 * (1 - this.atmosphere.nightFactor) * (0.72 + this.atmosphere.windowGlow * 0.1);
    this.cityWindowMaterial.emissiveIntensity = this.atmosphere.windowGlow * 0.9;
    for (const material of this.ridgeMaterials) material.color.copy(this.atmosphere.ridgeTint);

    this.gateGlowMaterial.opacity = 0.72 + Math.sin(this.time * 4.2) * 0.16;
  }
}
