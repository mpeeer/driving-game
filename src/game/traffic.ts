import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Body } from 'cannon-es';
import { Route } from './route';
import { RoadNetwork, type DrivePath } from './roads';
import { ROAD } from './config';

const UP = new THREE.Vector3(0, 1, 0);
const PITCH_AXIS = new THREE.Vector3(1, 0, 0);
const YAW_PI = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
const TRAFFIC_COUNT = 64;

interface TrafficCar {
  group: THREE.Group;
  distance: number;
  offset: number;
  direction: 1 | -1;
  speed: number;
  baseSpeed: number;
  length: number;
  fastLane: boolean;
  path: DrivePath | null;
  pathDistance: number;
  pathLoop: boolean;
  preferredRoute: 'skyway' | 'roundabout' | null;
}

interface CarStyle {
  paint: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  wheels: THREE.BufferGeometry;
  headlights: THREE.BufferGeometry;
  tails: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  shadow: THREE.BufferGeometry;
  length: number;
}

function wrapDelta(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(x, y, z);
  return geometry;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('Unable to merge traffic car geometry');
  return merged;
}

function makeGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, 'rgba(255,250,225,1)');
  glow.addColorStop(0.18, 'rgba(255,240,190,0.9)');
  glow.addColorStop(0.46, 'rgba(255,206,126,0.28)');
  glow.addColorStop(1, 'rgba(255,190,100,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Dense two-way route traffic. Each car is built from a handful of merged
 * meshes, keeping 36 cars cheap enough to leave room for the larger island.
 * Speeds are stored in m/s and authored in km/h.
 */
export class TrafficSystem {
  private readonly route: Route;
  private readonly roads: RoadNetwork;
  private readonly cars: TrafficCar[] = [];
  private readonly headlightMaterial: THREE.MeshBasicMaterial;
  private readonly tailMaterial: THREE.MeshBasicMaterial;
  private readonly glassMaterial: THREE.MeshPhongMaterial;
  private readonly tireMaterial: THREE.MeshLambertMaterial;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly trimMaterial: THREE.MeshLambertMaterial;
  private readonly glowMaterial: THREE.SpriteMaterial;
  private readonly paintMaterials: THREE.MeshPhongMaterial[] = [
    new THREE.MeshPhongMaterial({ color: 0x8c2f2b, specular: 0xffffff, shininess: 60 }),
    new THREE.MeshPhongMaterial({ color: 0x244a5c, specular: 0xffffff, shininess: 60 }),
    new THREE.MeshPhongMaterial({ color: 0xd3d1c4, specular: 0xffffff, shininess: 60 }),
    new THREE.MeshPhongMaterial({ color: 0x2f493d, specular: 0xffffff, shininess: 60 }),
    new THREE.MeshPhongMaterial({ color: 0x8d6b35, specular: 0xffffff, shininess: 60 }),
    new THREE.MeshPhongMaterial({ color: 0x3e3a46, specular: 0xffffff, shininess: 60 }),
  ];
  private readonly carStyle: CarStyle;
  private readonly vanStyle: CarStyle;
  private night = 0;

  constructor(scene: THREE.Scene, route: Route, roads: RoadNetwork) {
    this.route = route;
    this.roads = roads;

    this.headlightMaterial = new THREE.MeshBasicMaterial({ color: 0xfff0c4, toneMapped: false });
    this.tailMaterial = new THREE.MeshBasicMaterial({ color: 0xff4a32, toneMapped: false });
    this.glassMaterial = new THREE.MeshPhongMaterial({
      color: 0x0a1518,
      specular: 0xb9cec7,
      shininess: 80,
    });
    this.tireMaterial = new THREE.MeshLambertMaterial({ color: 0x111315 });
    this.trimMaterial = new THREE.MeshLambertMaterial({ color: 0x242b2c });
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x020504,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    this.glowMaterial = new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: 0xffedb0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });

    this.carStyle = this.buildStyle(false);
    this.vanStyle = this.buildStyle(true);

    const near = [0.003, 0.008, 0.013, 0.018, 0.024, 0.030, 0.036, 0.043];
    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      const direction: 1 | -1 = i % 2 === 0 ? 1 : -1;
      const laneIndex = Math.floor(i / 2) % 2;
      const fastLane = laneIndex === 1;
      const van = !fastLane && i % 7 === 2;
      const car = van ? this.buildVan(i) : this.buildCar(i);
      const slot =
        i < near.length
          ? near[i] * this.route.length
          : (0.065 + ((i - near.length) / (TRAFFIC_COUNT - near.length)) * 0.92) * this.route.length;
      car.distance = this.route.wrap(slot + ((i * 37) % 13) - 6);
      car.offset = direction === 1 ? (laneIndex === 0 ? 5.7 : 1.9) : (laneIndex === 0 ? -5.7 : -1.9);
      car.direction = direction;
      car.fastLane = fastLane;
      car.speed =
        ((van ? 40 : fastLane ? 64 : 50) + ((i * 19) % 17) - 8) / 3.6;
      car.baseSpeed = car.speed;
      if (direction === 1 && laneIndex === 0) {
        if (i % 12 === 0) car.preferredRoute = 'skyway';
        else if (i % 16 === 4) car.preferredRoute = 'roundabout';
      }
      scene.add(car.group);
      this.cars.push(car);
      this.place(car);
    }

    // Dedicated junction traffic. These follow the actual driveable ramp and
    // circular paths, so exits and the elevated deck are never empty scenery.
    const branchFleets: Array<{ path: DrivePath; count: number; offset: number; speed: number }> = [
      { path: this.roads.skyway, count: 3, offset: 2.1, speed: 48 },
      { path: this.roads.roundaboutRing, count: 4, offset: 2.2, speed: 30 },
    ];
    let branchIndex = 0;
    for (const fleet of branchFleets) {
      for (let i = 0; i < fleet.count; i++) {
        const car = this.buildCar(100 + branchIndex);
        car.path = fleet.path;
        car.pathDistance = fleet.path.length * ((i + 0.35) / fleet.count);
        car.pathLoop = true;
        car.offset = fleet.offset;
        car.speed = (fleet.speed + i * 3) / 3.6;
        car.baseSpeed = car.speed;
        car.direction = 1;
        scene.add(car.group);
        this.cars.push(car);
        this.place(car);
        branchIndex++;
      }
    }
    this.setNight(0);
  }

  private buildStyle(van: boolean): CarStyle {
    const bodyLength = van ? 4.7 : 3.9;
    const bodyWidth = van ? 1.92 : 1.72;
    const front = -bodyLength / 2;
    const rear = bodyLength / 2;

    const paintParts: THREE.BufferGeometry[] = [];
    const glassParts: THREE.BufferGeometry[] = [];
    const wheelParts: THREE.BufferGeometry[] = [];
    const trimParts: THREE.BufferGeometry[] = [];

    if (van) {
      paintParts.push(box(bodyWidth, 0.72, bodyLength, 0, 0.55, 0));
      paintParts.push(box(bodyWidth * 1.01, 1.22, 3.2, 0, 1.42, 0.32));
      glassParts.push(box(bodyWidth * 0.9, 0.48, 0.035, 0, 1.72, front + 0.32));
      glassParts.push(box(bodyWidth * 1.03, 0.42, 1.5, 0, 1.72, -0.98));
      trimParts.push(box(bodyWidth * 0.92, 0.12, 0.12, 0, 0.27, front - 0.02));
      trimParts.push(box(bodyWidth * 0.92, 0.12, 0.12, 0, 0.27, rear + 0.02));
    } else {
      paintParts.push(box(bodyWidth, 0.5, bodyLength, 0, 0.44, 0));
      paintParts.push(box(bodyWidth * 0.83, 0.07, 1.72, 0, 1.07, 0.14));
      paintParts.push(box(bodyWidth * 0.94, 0.045, 1.18, 0, 0.71, 1.36));
      paintParts.push(box(bodyWidth * 0.94, 0.045, 0.8, 0, 0.71, -1.5));
      glassParts.push(box(bodyWidth * 0.79, 0.38, 1.95, 0, 0.85, 0.12));
      trimParts.push(box(bodyWidth * 0.94, 0.1, 0.1, 0, 0.26, front - 0.02));
      trimParts.push(box(bodyWidth * 0.94, 0.1, 0.1, 0, 0.26, rear + 0.02));
    }

    const wheelGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12);
    wheelGeometry.rotateZ(Math.PI / 2);
    for (const side of [-1, 1] as const) {
      for (const z of [-bodyLength * 0.33, bodyLength * 0.33]) {
        wheelParts.push(wheelGeometry.clone().translate(side * (bodyWidth * 0.47), 0.34, z));
      }
    }
    wheelGeometry.dispose();

    const headlightParts = [
      box(0.33, 0.14, 0.035, -bodyWidth * 0.3, van ? 0.68 : 0.5, front - 0.02),
      box(0.33, 0.14, 0.035, bodyWidth * 0.3, van ? 0.68 : 0.5, front - 0.02),
    ];
    const tailParts = [
      box(0.36, 0.12, 0.035, -bodyWidth * 0.3, van ? 0.68 : 0.48, rear + 0.02),
      box(0.36, 0.12, 0.035, bodyWidth * 0.3, van ? 0.68 : 0.48, rear + 0.02),
    ];

    const shadow = new THREE.PlaneGeometry(bodyWidth * 1.22, bodyLength * 1.12);
    shadow.rotateX(-Math.PI / 2);
    shadow.translate(0, 0.015, 0);

    return {
      paint: merge(paintParts),
      glass: merge(glassParts),
      wheels: merge(wheelParts),
      headlights: merge(headlightParts),
      tails: merge(tailParts),
      trim: merge(trimParts),
      shadow: merge([shadow]),
      length: bodyLength,
    };
  }

  private buildCar(index: number): TrafficCar {
    return this.buildVehicle(index, this.carStyle);
  }

  private buildVan(index: number): TrafficCar {
    return this.buildVehicle(index, this.vanStyle);
  }

  private buildVehicle(index: number, style: CarStyle): TrafficCar {
    const group = new THREE.Group();
    group.name = `traffic-${index}`;
    const paint = this.paintMaterials[index % this.paintMaterials.length];

    for (const [geometry, material] of [
      [style.paint, paint],
      [style.glass, this.glassMaterial],
      [style.wheels, this.tireMaterial],
      [style.headlights, this.headlightMaterial],
      [style.tails, this.tailMaterial],
      [style.trim, this.trimMaterial],
      [style.shadow, this.shadowMaterial],
    ] as Array<[THREE.BufferGeometry, THREE.Material]>) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      group.add(mesh);
    }

    const glow = new THREE.Sprite(this.glowMaterial);
    glow.position.set(0, 0.6, -style.length / 2 - 0.06);
    glow.scale.set(2.6, 1.05, 1);
    glow.renderOrder = 5;
    group.add(glow);

    return {
      group,
      distance: 0,
      offset: 0,
      direction: 1,
      speed: 0,
      baseSpeed: 0,
      length: style.length,
      fastLane: false,
      path: null,
      pathDistance: 0,
      pathLoop: false,
      preferredRoute: null,
    };
  }

  private place(car: TrafficCar): void {
    if (car.path) {
      const placement = this.roads.placeOnPath(car.path, car.pathDistance, car.offset);
      car.group.position.copy(placement.position);
      car.group.position.y += 0.035;
      car.group.quaternion.copy(placement.quaternion);
      return;
    }

    const placement = this.route.placement(car.distance, car.offset);
    car.group.position.copy(placement.position);
    car.group.position.y += 0.035;

    car.group.quaternion.copy(placement.quaternion);
    if (car.direction < 0) car.group.quaternion.multiply(YAW_PI);
    const pitch = Math.atan(this.route.gradeAt(car.distance)) * car.direction;
    car.group.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(PITCH_AXIS, pitch));
  }

  update(dt: number, playerDistance: number, playerSpeedKmh: number, playerOffset: number): void {
    const length = this.route.length;
    const playerSpeed = playerSpeedKmh / 3.6;

    for (const car of this.cars) {
      if (car.path) {
        const path = car.path;
        let target = car.baseSpeed;
        for (const other of this.cars) {
          if (other === car || other.path !== path) continue;
          const gap = path.closed
            ? wrapDelta(other.pathDistance - car.pathDistance, path.length)
            : other.pathDistance - car.pathDistance;
          if (gap > 0.1 && gap < 22) {
            target = Math.min(target, Math.max(1.4, other.speed * 0.9), Math.max(1.4, gap * 1.1));
          }
        }
        const rate = target > car.speed ? 2.8 : 7;
        car.speed += THREE.MathUtils.clamp(target - car.speed, -rate * dt, rate * dt);
        car.pathDistance += car.speed * dt;
        if (path.closed) {
          car.pathDistance = ((car.pathDistance % path.length) + path.length) % path.length;
        } else if (car.pathDistance >= path.length) {
          if (car.pathLoop || path.endMainDistance == null) {
            car.pathDistance = 0;
          } else {
            car.path = null;
            car.pathDistance = 0;
            car.distance = path.endMainDistance;
            car.offset = ROAD.startOffset;
            car.direction = 1;
            car.speed *= 0.9;
            this.place(car);
            continue;
          }
        }
        this.place(car);
        continue;
      }

      // Keep the fleet in a moving screen of traffic around the player. Cars
      // are recycled beyond the visible bend rather than thinning out across
      // the whole nine-kilometre loop.
      const ahead = wrapDelta(car.distance - playerDistance, length);
      if (ahead > 1250 && ahead < length - 470) {
        car.distance = this.route.wrap(
          Math.random() < 0.65
            ? playerDistance + 35 + Math.pow(Math.random(), 1.55) * 1160
            : playerDistance - 24 - Math.random() * 330,
        );
        this.place(car);
      }

      let target = car.baseSpeed;

      // Follow the player when they are ahead in the same lane.
      const playerGap =
        car.direction > 0
          ? wrapDelta(playerDistance - car.distance, length)
          : wrapDelta(car.distance - playerDistance, length);
      if (
        car.direction > 0 &&
        playerGap < 42 &&
        Math.abs(playerOffset - car.offset) < 1.9
      ) {
        target = Math.min(target, Math.max(1.2, playerSpeed * 0.82));
        if (playerGap < 14) target = Math.min(target, Math.max(0, playerSpeed - 6));
      }

      for (const other of this.cars) {
        if (other === car || other.direction !== car.direction || Math.abs(other.offset - car.offset) > 1.2) continue;
        const gap =
          car.direction > 0
            ? wrapDelta(other.distance - car.distance, length)
            : wrapDelta(car.distance - other.distance, length);
        if (gap > 0.1 && gap < 24) {
          target = Math.min(target, Math.max(1.2, other.speed * 0.9), Math.max(1.2, gap * 1.05));
        }
      }

      const rate = target > car.speed ? 2.8 : 7;
      car.speed += THREE.MathUtils.clamp(target - car.speed, -rate * dt, rate * dt);
      const previousDistance = car.distance;
      car.distance = this.route.wrap(car.distance + car.direction * car.speed * dt);

      if (car.preferredRoute && car.direction === 1) {
        const entry =
          car.preferredRoute === 'skyway'
            ? this.roads.skywayStart
            : this.roads.roundaboutAccessStart;
        const travelled = car.speed * dt;
        const toEntry = wrapDelta(entry - previousDistance, length);
        if (toEntry >= 0 && toEntry <= travelled + 0.5) {
          car.path = car.preferredRoute === 'skyway' ? this.roads.skyway : this.roads.roundaboutDetour;
          car.pathDistance = 0.15;
          car.offset = -1.2;
          this.place(car);
          continue;
        }
      }

      this.place(car);
    }

    this.setNight(this.night);
  }

  setNight(night: number): void {
    this.night = THREE.MathUtils.clamp(night, 0, 1);
    const lamp = 0.72 + this.night * 1.7;
    this.headlightMaterial.color.setRGB(lamp, lamp * 0.95, lamp * 0.76);
    this.glowMaterial.opacity = this.night * 0.9;
    this.tailMaterial.color.setRGB(0.65 + this.night * 0.6, 0.08 + this.night * 0.1, 0.04);
  }

  /**
   * Soft circular collision. The player still gets a firm shove, but the AI
   * car absorbs most of the impact and the chassis is not teleported off-road.
   */
  resolvePlayerCollision(player: Body, playerHeight?: number): number {
    let strongest = 0;
    for (const car of this.cars) {
      if (playerHeight != null && Math.abs(playerHeight - car.group.position.y) > 3.2) continue;
      const dx = player.position.x - car.group.position.x;
      const dz = player.position.z - car.group.position.z;
      const distance = Math.hypot(dx, dz);
      const radius = car.length > 4.2 ? 2.55 : 2.25;
      if (distance >= radius) continue;

      const nx = distance > 0.001 ? dx / distance : 1;
      const nz = distance > 0.001 ? dz / distance : 0;
      const penetration = radius - Math.max(distance, 0.001);
      player.position.x += nx * penetration * 0.55;
      player.position.z += nz * penetration * 0.55;

      const v = player.velocity;
      const into = v.x * nx + v.z * nz;
      if (into < 0) {
        v.x -= nx * into * 1.25;
        v.z -= nz * into * 1.25;
      }
      v.x *= 0.62;
      v.z *= 0.62;
      car.speed *= 0.72;
      strongest = Math.max(strongest, Math.abs(into));
    }
    return strongest;
  }
}
