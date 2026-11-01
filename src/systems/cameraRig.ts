import * as THREE from 'three';
import { clamp, damp } from '../core/util';
import { TrainSim } from '../train/trainSim';
import { TrackPath } from '../world/trackPlan';

export type ViewMode = 'cab' | 'chase' | 'orbit';

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  mode: ViewMode = 'cab';
  lookYaw = 0;
  lookPitch = 0;
  orbitYaw = 0;
  orbitPitch = 0.18;
  zoom = 1;
  private chasePos = new THREE.Vector3();
  private chaseTarget = new THREE.Vector3();
  private initialized = false;
  private shake = 0;
  private tmp = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(66, aspect, 0.12, 12000);
    this.camera.rotation.order = 'YXZ';
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  cycle(): ViewMode {
    this.mode = this.mode === 'cab' ? 'chase' : this.mode === 'chase' ? 'orbit' : 'cab';
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.initialized = false;
    return this.mode;
  }

  resetLook(): void {
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.orbitYaw = 0;
    this.orbitPitch = 0.18;
    this.zoom = 1;
  }

  get lookingBack(): boolean {
    return Math.abs(this.lookYaw) > 2.1;
  }

  update(dt: number, sim: TrainSim, path: TrackPath, opts: { time: number; maxSpeed: number }): void {
    const speedRatio = clamp(Math.abs(sim.v) / Math.max(2, sim.maxSpeedMs), 0, 1);
    if (this.mode === 'cab') {
      this.updateCab(dt, sim, path, speedRatio, opts.time);
    } else if (this.mode === 'chase') {
      this.updateChase(dt, sim, path, speedRatio);
    } else {
      this.updateOrbit(dt, sim, path);
    }
    // Suspension jolt on hard braking
    this.shake = Math.max(0, this.shake - dt * 2);
    if (sim.brakeApplied > 0.6) this.shake = Math.min(0.16, this.shake + dt * 0.3);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.05;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.05;
    }
    this.camera.updateMatrixWorld();
  }

  private updateCab(dt: number, sim: TrainSim, path: TrackPath, speedRatio: number, time: number): void {
    const s = sim.s - 2.25;
    const p = path.sample(s, -0.55);
    const bob = Math.sin(time * 7.2) * 0.012 * (0.3 + speedRatio) + Math.sin(time * 1.9) * 0.004;
    const sway = Math.sin(time * 0.7) * 0.008 * speedRatio;
    this.camera.position.set(p.x + sway, p.y + 2.68 + bob, p.z);
    const heading = path.headingAt(s);
    const grade = path.gradeAt(s);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = heading + Math.PI + this.lookYaw;
    this.camera.rotation.x = -Math.atan(grade) + this.lookPitch;
    this.camera.rotation.z = Math.sin(time * 0.5) * 0.004 * speedRatio;
    const targetFov = 66 + Math.min(8, speedRatio * 8);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = damp(this.camera.fov, targetFov, 3, dt);
      this.camera.updateProjectionMatrix();
    }
    void path;
  }

  private updateChase(dt: number, sim: TrainSim, path: TrackPath, speedRatio: number): void {
    const midS = sim.s - sim.length * 0.45;
    const p = path.sample(midS);
    this.tmp.set(p.x, p.y + 2.4, p.z);
    const dist = (18 + Math.min(26, sim.length * 0.16)) * this.zoom;
    const height = 7.2 + this.orbitPitch * 28;
    const angle = path.headingAt(midS) + Math.PI + this.orbitYaw;
    const desired = new THREE.Vector3(
      this.tmp.x + Math.sin(angle) * dist,
      this.tmp.y + height,
      this.tmp.z + Math.cos(angle) * dist
    );
    if (!this.initialized) {
      this.chasePos.copy(desired);
      this.chaseTarget.copy(this.tmp);
      this.initialized = true;
    }
    this.chasePos.x = damp(this.chasePos.x, desired.x, 4.6, dt);
    this.chasePos.y = damp(this.chasePos.y, desired.y, 5.5, dt);
    this.chasePos.z = damp(this.chasePos.z, desired.z, 4.6, dt);
    this.chaseTarget.x = damp(this.chaseTarget.x, this.tmp.x, 7, dt);
    this.chaseTarget.y = damp(this.chaseTarget.y, this.tmp.y, 7, dt);
    this.chaseTarget.z = damp(this.chaseTarget.z, this.tmp.z, 7, dt);
    this.camera.position.copy(this.chasePos);
    this.camera.lookAt(this.chaseTarget);
    this.camera.rotation.z += Math.sin(performance.now() * 0.0005) * 0.002 * speedRatio;
    const fov = 56 + speedRatio * 10 - this.orbitPitch * 8;
    if (Math.abs(this.camera.fov - fov) > 0.4) {
      this.camera.fov = damp(this.camera.fov, fov, 2.5, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  private updateOrbit(dt: number, sim: TrainSim, path: TrackPath): void {
    const midS = sim.s - sim.length * 0.45;
    const p = path.sample(midS);
    const center = this.tmp.set(p.x, p.y + 2.6, p.z);
    this.orbitYaw += dt * 0.16;
    const dist = (34 + sim.length * 0.08) * this.zoom;
    const y = clamp(8 + this.orbitPitch * 62, 2.4, 46);
    const pos = new THREE.Vector3(
      center.x + Math.sin(this.orbitYaw) * dist,
      center.y + y,
      center.z + Math.cos(this.orbitYaw) * dist
    );
    this.camera.position.lerp(pos, 1 - Math.exp(-4 * dt));
    this.camera.lookAt(center);
    const fov = 52;
    if (Math.abs(this.camera.fov - fov) > 0.3) {
      this.camera.fov = damp(this.camera.fov, fov, 2.5, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  zoomBy(delta: number): void {
    this.zoom = clamp(this.zoom + delta * 0.0012, 0.5, 2.4);
  }
}
