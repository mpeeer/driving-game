import * as THREE from 'three';
import { BASE_FOV, MAX_FOV } from './config';

export interface RigInput {
  speedKmh: number;
  steer: number;
  throttle: number;
  brake: number;
  mode: 'menu' | 'driving';
  shake: boolean;
}

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private rig: THREE.Object3D;
  private head: THREE.Object3D;
  private time = 0;
  private lastSpeed = 0;
  private accel = 0;
  private pitch = 0;
  private roll = 0;
  private yaw = 0;
  private offsetX = 0;
  private offsetZ = 0;
  private fov = BASE_FOV;
  private trauma = 0;

  constructor(parent: THREE.Object3D) {
    this.camera = new THREE.PerspectiveCamera(
      BASE_FOV,
      window.innerWidth / window.innerHeight,
      0.04,
      1600,
    );

    this.rig = new THREE.Object3D();
    this.rig.position.set(0, 0.53, 0.1);
    this.head = new THREE.Object3D();
    this.head.rotation.order = 'YXZ';
    this.rig.add(this.head);
    this.head.add(this.camera);
    parent.add(this.rig);

    // A hint of downward gaze; the road stays in the upper two thirds.
    this.pitch = -0.012;
  }

  kick(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number, input: RigInput): void {
    this.time += dt;

    const rawAccel = (input.speedKmh - this.lastSpeed) / Math.max(dt, 0.001) / 3.6;
    this.lastSpeed = input.speedKmh;
    this.accel = damp(this.accel, THREE.MathUtils.clamp(rawAccel, -16, 10), 4, dt);

    const speed = Math.max(0, input.speedKmh);
    const speedFactor = THREE.MathUtils.clamp((speed - 30) / 200, 0, 1);
    const menu = input.mode === 'menu';

    const steer = THREE.MathUtils.clamp(input.steer, -1, 1);
    const rollTarget = -steer * THREE.MathUtils.degToRad(2);
    const pitchTarget = menu
      ? -0.012 + Math.sin(this.time * 0.11) * 0.006
      : THREE.MathUtils.clamp(this.accel * 0.0032, -0.038, 0.02) - 0.01;
    const yawTarget = menu
      ? Math.sin(this.time * 0.16) * 0.05
      : steer * 0.032;

    this.roll = damp(this.roll, rollTarget, 6, dt);
    this.pitch = damp(this.pitch, pitchTarget, 5, dt);
    this.yaw = damp(this.yaw, yawTarget, 4.5, dt);

    const offsetTargetX = -steer * 0.005;
    const offsetTargetZ = THREE.MathUtils.clamp(this.accel * 0.0014, -0.014, 0.012);
    this.offsetX = damp(this.offsetX, offsetTargetX, 7, dt);
    this.offsetZ = damp(this.offsetZ, offsetTargetZ, 7, dt);

    const shake = input.shake ? 1 : 0;
    const idleAmp = menu ? 0.00025 : 0.00035;
    const vibration = idleAmp + speedFactor * 0.0028 * shake;
    const t = this.time;
    const vibX = (Math.sin(t * 37.3) + Math.sin(t * 61.7) * 0.5) * vibration;
    const vibY = (Math.cos(t * 29.1) * 0.8 + Math.sin(t * 53.3) * 0.4) * vibration;
    const vibPitch = Math.sin(t * 43.7) * vibration * 1.6;
    const vibRoll = Math.cos(t * 34.9) * vibration * 1.2;

    this.trauma = Math.max(0, this.trauma - dt * 1.35);
    const impact = this.trauma * this.trauma;
    const crashX = Math.sin(t * 91.7) * impact * 0.035;
    const crashY = Math.cos(t * 83.3) * impact * 0.025;
    const crashRoll = Math.sin(t * 77.1) * impact * 0.045;

    this.head.position.set(
      this.offsetX + vibX + crashX,
      vibY + crashY,
      this.offsetZ,
    );
    this.head.rotation.set(
      this.pitch + vibPitch,
      this.yaw + Math.sin(t * 67.3) * impact * 0.02,
      this.roll + vibRoll + crashRoll,
    );

    const fovTarget = BASE_FOV + (MAX_FOV - BASE_FOV) * THREE.MathUtils.smoothstep(speed, 0, 250) + (input.brake > 0.5 ? -0.6 : 0);
    this.fov = damp(this.fov, fovTarget, 2.2, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }
}
