import * as THREE from 'three';
import { BASE_FOV, DRIVER_X, MAX_FOV } from './config';
import type { CameraMode } from './types';

export interface RigInput {
  speedKmh: number;
  steer: number;
  throttle: number;
  brake: number;
  mode: 'menu' | 'driving';
  shake: boolean;
}

const CHASE_FOV = 56;

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/**
 * Two views share one driver.
 *
 * The cockpit camera is a child of the vehicle so it inherits every bump and
 * yaw exactly. The chase camera lives in world space and eases after the car,
 * which keeps the exterior view readable instead of rigidly copying body roll.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly chaseCamera: THREE.PerspectiveCamera;

  private readonly vehicle: THREE.Object3D;
  private readonly rig: THREE.Object3D;
  private readonly head: THREE.Object3D;
  private mode: CameraMode = 'cockpit';
  private time = 0;
  private lastSpeed = 0;
  private accel = 0;
  private pitch = -0.055;
  private roll = 0;
  private yaw = 0;
  private offsetX = 0;
  private offsetZ = 0;
  private fov = BASE_FOV;
  private baseFov = BASE_FOV;
  private trauma = 0;

  private readonly chasePosition = new THREE.Vector3();
  private readonly chaseTarget = new THREE.Vector3();
  private readonly chaseDesired = new THREE.Vector3();
  private readonly chaseLook = new THREE.Vector3();
  private readonly chaseOffset = new THREE.Vector3();
  private readonly chaseLookOffset = new THREE.Vector3();
  private chaseFov = CHASE_FOV;
  private chaseReady = false;

  constructor(parent: THREE.Object3D, scene: THREE.Scene) {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.vehicle = parent;

    // Far planes clear the expanded atmosphere dome and the distant ridge.
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.025, 5200);
    this.chaseCamera = new THREE.PerspectiveCamera(CHASE_FOV, aspect, 0.08, 5400);
    this.chaseCamera.up.set(0, 1, 0);
    scene.add(this.chaseCamera);

    this.rig = new THREE.Object3D();
    // Sit in the left-hand seat, not on the car's centre line.
    this.rig.position.set(DRIVER_X, 0.665, 0.08);
    this.head = new THREE.Object3D();
    this.head.rotation.order = 'YXZ';
    this.rig.add(this.head);
    this.head.add(this.camera);
    parent.add(this.rig);
    this.resize(window.innerWidth, window.innerHeight);
  }

  get activeCamera(): THREE.PerspectiveCamera {
    return this.mode === 'chase' ? this.chaseCamera : this.camera;
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    if (mode === 'chase') this.snapChase();
    else this.chaseReady = false;
  }

  kick(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number, input: RigInput): void {
    this.time += dt;
    if (this.mode === 'chase') {
      this.updateChase(dt, input);
      return;
    }

    const rawAccel = (input.speedKmh - this.lastSpeed) / Math.max(dt, 0.001) / 3.6;
    this.lastSpeed = input.speedKmh;
    this.accel = damp(this.accel, THREE.MathUtils.clamp(rawAccel, -16, 10), 4.5, dt);

    const speed = Math.max(0, input.speedKmh);
    const speedFactor = THREE.MathUtils.clamp((speed - 25) / 210, 0, 1);
    const menu = input.mode === 'menu';

    const steer = THREE.MathUtils.clamp(input.steer, -1, 1);
    const rollTarget = -steer * THREE.MathUtils.degToRad(1.35);
    const pitchTarget = menu
      ? -0.045 + Math.sin(this.time * 0.12) * 0.004
      : THREE.MathUtils.clamp(this.accel * 0.0028, -0.03, 0.016) - 0.055;
    const yawTarget = menu ? Math.sin(this.time * 0.14) * 0.028 : steer * 0.024;

    this.roll = damp(this.roll, rollTarget, 5.5, dt);
    this.pitch = damp(this.pitch, pitchTarget, 5, dt);
    this.yaw = damp(this.yaw, yawTarget, 4, dt);

    this.offsetX = damp(this.offsetX, -steer * 0.0035, 7, dt);
    this.offsetZ = damp(this.offsetZ, THREE.MathUtils.clamp(this.accel * 0.0011, -0.01, 0.008), 7, dt);

    const shake = input.shake ? 1 : 0;
    const vibration = (menu ? 0.00018 : 0.00025) + speedFactor * 0.00135 * shake;
    const t = this.time;
    const vibX = (Math.sin(t * 34.3) + Math.sin(t * 58.7) * 0.5) * vibration;
    const vibY = (Math.cos(t * 27.1) * 0.8 + Math.sin(t * 49.3) * 0.35) * vibration;
    const vibPitch = Math.sin(t * 39.7) * vibration * 1.1;
    const vibRoll = Math.cos(t * 31.9) * vibration * 0.8;

    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const impact = this.trauma * this.trauma;
    const crashX = Math.sin(t * 91.7) * impact * 0.028;
    const crashY = Math.cos(t * 83.3) * impact * 0.02;
    const crashRoll = Math.sin(t * 77.1) * impact * 0.036;

    this.head.position.set(
      this.offsetX + vibX + crashX,
      vibY + crashY,
      this.offsetZ,
    );
    this.head.rotation.set(
      this.pitch + vibPitch,
      this.yaw + Math.sin(t * 67.3) * impact * 0.016,
      this.roll + vibRoll + crashRoll,
    );

    const fovTarget =
      this.baseFov +
      (MAX_FOV - BASE_FOV) * THREE.MathUtils.smoothstep(speed, 20, 235) +
      (input.brake > 0.5 ? -0.4 : 0);
    this.fov = damp(this.fov, fovTarget, 2, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private snapChase(): void {
    const car = this.vehicle;
    this.chaseOffset.set(0, 1.35, 6.05).applyQuaternion(car.quaternion);
    this.chaseLookOffset.set(0, 0.24, -1.4).applyQuaternion(car.quaternion);
    this.chasePosition.copy(car.position).add(this.chaseOffset);
    this.chaseTarget.copy(car.position).add(this.chaseLookOffset);
    this.chaseFov = CHASE_FOV;
    this.chaseReady = true;
    this.chaseCamera.position.copy(this.chasePosition);
    this.chaseCamera.up.set(0, 1, 0);
    this.chaseCamera.lookAt(this.chaseTarget);
    this.chaseCamera.fov = this.chaseFov;
    this.chaseCamera.updateProjectionMatrix();
    this.trauma = 0;
  }

  private updateChase(dt: number, input: RigInput): void {
    const car = this.vehicle;
    const speed = Math.max(0, input.speedKmh);
    const speedFactor = THREE.MathUtils.clamp((speed - 18) / 210, 0, 1);
    const steer = THREE.MathUtils.clamp(input.steer, -1, 1);
    const shake = input.shake ? 1 : 0;

    const distance = 6.05 + speedFactor * 0.6;
    this.chaseOffset.set(0, 1.35 + speedFactor * 0.08, distance).applyQuaternion(car.quaternion);
    this.chaseDesired.copy(car.position).add(this.chaseOffset);
    this.chaseLookOffset.set(0, 0.24 - speedFactor * 0.04, -1.4).applyQuaternion(car.quaternion);
    this.chaseLook.copy(car.position).add(this.chaseLookOffset);

    const positionRate = this.chaseReady ? 1 - Math.exp(-5.2 * dt) : 1;
    const targetRate = this.chaseReady ? 1 - Math.exp(-7.5 * dt) : 1;
    this.chasePosition.lerp(this.chaseDesired, positionRate);
    this.chaseTarget.lerp(this.chaseLook, targetRate);
    this.chaseReady = true;

    this.chaseCamera.position.copy(this.chasePosition);
    this.chaseCamera.up.set(0, 1, 0);
    this.chaseCamera.lookAt(this.chaseTarget);

    const fovTarget = CHASE_FOV + 7 * THREE.MathUtils.smoothstep(speed, 20, 225);
    this.chaseFov = damp(this.chaseFov, fovTarget, 2.6, dt);
    if (Math.abs(this.chaseCamera.fov - this.chaseFov) > 0.01) {
      this.chaseCamera.fov = this.chaseFov;
      this.chaseCamera.updateProjectionMatrix();
    }

    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const impact = this.trauma * this.trauma;
    const t = this.time;
    const vibration = (0.00035 + speedFactor * 0.0012) * shake;
    this.chaseCamera.position.x += Math.sin(t * 34.3) * vibration;
    this.chaseCamera.position.y += Math.cos(t * 41.7) * vibration;
    this.chaseCamera.rotateZ(
      -steer * 0.012 * speedFactor +
      Math.sin(t * 77.1) * impact * 0.03,
    );
  }

  resize(width: number, height: number): void {
    const aspect = width / Math.max(1, height);
    this.camera.aspect = aspect;
    this.chaseCamera.aspect = aspect;

    // Keep the horizontal cabin framing stable as the browser gets narrower.
    // Otherwise a 16:10 view clips the A-pillars and centre screen on a 4:3 or
    // split-screen window. The reference framing is the 1440×900 cockpit view.
    const referenceAspect = 16 / 10;
    const horizontalFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV) / 2) * referenceAspect);
    const verticalFov = 2 * Math.atan(Math.tan(horizontalFov / 2) / Math.max(0.9, aspect));
    this.baseFov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(verticalFov), BASE_FOV, 82);
    this.fov = this.baseFov;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    this.chaseCamera.fov = this.chaseFov;
    this.chaseCamera.updateProjectionMatrix();
  }
}
