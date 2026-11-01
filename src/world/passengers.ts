import * as THREE from 'three';
import { Rng, clamp } from '../core/util';
import { TrackPath } from './trackPlan';
import { StationView } from './stationView';

type AgentState = 'idle' | 'walk' | 'board' | 'leave';

interface Agent {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  state: AgentState;
  speed: number;
  phase: number;
  timer: number;
  yaw: number;
  active: boolean;
  scale: number;
  color: THREE.Color;
  skin: THREE.Color;
}

const MAX_AGENTS = 120;

export class PassengerSystem {
  group = new THREE.Group();
  private agents: Agent[] = [];
  private torso: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private path?: TrackPath;
  private station?: StationView;
  private rng = new Rng(1234);
  private dummy = new THREE.Object3D();
  private tmp = new THREE.Vector3();
  private platformTop = 1.06;

  constructor() {
    this.group.name = 'passengers';
    const torsoGeo = new THREE.CylinderGeometry(0.24, 0.29, 0.98, 6);
    torsoGeo.translate(0, 0.49, 0);
    const headGeo = new THREE.SphereGeometry(0.155, 8, 6);
    headGeo.translate(0, 0.5, 0);
    const legsGeo = new THREE.BoxGeometry(0.34, 0.78, 0.26);
    legsGeo.translate(0, -0.39, 0);

    const torsoMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const legsMat = new THREE.MeshLambertMaterial({ color: 0x2a3038 });
    this.torso = new THREE.InstancedMesh(torsoGeo, torsoMat, MAX_AGENTS);
    this.head = new THREE.InstancedMesh(headGeo, headMat, MAX_AGENTS);
    this.legs = new THREE.InstancedMesh(legsGeo, legsMat, MAX_AGENTS);
    for (const m of [this.torso, this.head, this.legs]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = false;
      this.group.add(m);
    }
    this.torso.count = 0;
    this.head.count = 0;
    this.legs.count = 0;

    const palette = [0x2d4a63, 0x7a3b3b, 0x3f5b44, 0x6b5a3e, 0x4b3f63, 0x8a6c4a, 0x2f2f38, 0xa35b46, 0x3e6a70, 0x8c8c94, 0xd0c3a5, 0x5a3a2a];
    for (let i = 0; i < MAX_AGENTS; i++) {
      const agent: Agent = {
        pos: new THREE.Vector3(0, -100, 0),
        target: new THREE.Vector3(),
        state: 'idle',
        speed: 1.1,
        phase: Math.random() * Math.PI * 2,
        timer: 0,
        yaw: 0,
        active: false,
        scale: 1,
        color: new THREE.Color(palette[i % palette.length]),
        skin: new THREE.Color().setHSL(0.07, 0.3, 0.45 + Math.random() * 0.28),
      };
      this.agents.push(agent);
      this.torso.setColorAt(i, agent.color);
      this.head.setColorAt(i, agent.skin);
    }
    if (this.torso.instanceColor) this.torso.instanceColor.needsUpdate = true;
    if (this.head.instanceColor) this.head.instanceColor.needsUpdate = true;
  }

  clear(): void {
    for (const a of this.agents) {
      a.active = false;
      a.pos.set(0, -100, 0);
    }
    this.torso.count = 0;
    this.head.count = 0;
    this.legs.count = 0;
    this.path = undefined;
    this.station = undefined;
  }

  setupStation(station: StationView, path: TrackPath, waiting: number): void {
    this.clear();
    this.path = path;
    this.station = station;
    this.platformTop = path.sample(station.plan.s).y + 1.06;
    const rng = this.rng;
    const count = Math.min(MAX_AGENTS, Math.max(4, Math.round(waiting * 0.55)));
    const len = station.platformLength;
    const centerZ = len - 20 - station.platformLength * 0.28;
    for (let i = 0; i < count; i++) {
      const agent = this.agents[i];
      const z = clamp(centerZ + rng.range(-52, 58), 14, len - 14);
      const lat = rng.range(2.3, 6.7);
      this.place(station, z, lat, agent.pos);
      agent.pos.y = this.platformTop;
      agent.target.copy(agent.pos);
      agent.state = 'idle';
      agent.active = true;
      agent.scale = rng.range(0.9, 1.08);
      agent.timer = rng.range(0.5, 6);
      agent.yaw = rng.range(-Math.PI, Math.PI);
      agent.speed = rng.range(0.95, 1.55);
    }
  }

  private place(station: StationView, localZ: number, lateral: number, out: THREE.Vector3): THREE.Vector3 {
    if (!this.path) return out.set(0, 0, 0);
    station.platformPoint(this.path, localZ, lateral, out);
    return out;
  }

  beginExchange(doorS: number[], boarding: number, alighting: number): void {
    if (!this.path || !this.station) return;
    const rng = this.rng;
    const len = this.station.platformLength;
    const base = this.station.plan.s;

    // Alighting agents appear at the doors and walk toward the exits.
    let spawnAlight = Math.min(Math.round(alighting * 0.5), 34);
    let doorIdx = 0;
    for (const agent of this.agents) {
      if (spawnAlight <= 0) break;
      if (agent.active) continue;
      const ds = doorS[doorIdx % Math.max(1, doorS.length)] ?? base + len * 0.5;
      doorIdx++;
      const p = this.path.sample(ds, 2.95);
      agent.pos.set(p.x, this.platformTop, p.z);
      agent.active = true;
      agent.state = 'leave';
      agent.phase = rng.range(0, 6);
      agent.speed = rng.range(1.0, 1.5);
      agent.scale = rng.range(0.9, 1.08);
      agent.color.setHex([0x2d4a63, 0x7a3b3b, 0x3f5b44, 0x6b5a3e, 0x4b3f63, 0x8a6c4a, 0x2f2f38][rng.int(0, 6)]);
      this.torso.setColorAt(this.agents.indexOf(agent), agent.color);
      const targetZ = clamp(ds - base + rng.range(-30, 34), 6, len - 6);
      this.place(this.station, targetZ, rng.range(5.6, 6.7), agent.target);
      agent.target.y = this.platformTop;
      spawnAlight--;
    }
    if (this.torso.instanceColor) this.torso.instanceColor.needsUpdate = true;

    // Waiting agents head to the doors.
    const movers = this.agents.filter((a) => a.active && (a.state === 'idle' || a.state === 'walk'));
    const pickCount = Math.min(movers.length, Math.max(3, Math.round(boarding * 0.5)), 30);
    for (let i = 0; i < pickCount; i++) {
      const agent = movers[i];
      const ds = doorS[rng.int(0, Math.max(0, doorS.length - 1))] ?? base + len * 0.5;
      const p = this.path.sample(ds, 2.15);
      agent.target.set(p.x, this.platformTop, p.z);
      agent.state = 'board';
      agent.speed = rng.range(1.2, 1.7);
    }
  }

  addWaiting(count: number): void {
    if (!this.path || !this.station) return;
    const rng = this.rng;
    const len = this.station.platformLength;
    let added = 0;
    for (const agent of this.agents) {
      if (added >= count) break;
      if (agent.active) continue;
      const z = clamp(len * 0.52 + rng.range(-60, 40), 12, len - 12);
      this.place(this.station, z, rng.range(2.3, 6.6), agent.pos);
      agent.pos.y = this.platformTop;
      agent.target.copy(agent.pos);
      agent.state = 'idle';
      agent.active = true;
      agent.timer = rng.range(0.4, 3);
      agent.scale = rng.range(0.9, 1.08);
      added++;
    }
  }

  update(dt: number): void {
    const path = this.path;
    const station = this.station;
    if (!path || !station) return;
    const len = station.platformLength;
    const base = station.plan.s;
    let visible = 0;
    const d = this.dummy;

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.active) continue;
      a.timer -= dt;
      if (a.state !== 'board' && a.state !== 'leave') {
        if (a.state === 'idle' && a.timer <= 0) {
          // Pick a new spot or keep waiting.
          if (Math.random() < 0.6) {
            const z = clamp((a.pos.z - 0) * 0 + len * 0.5 + this.rng.range(-65, 45), 10, len - 10);
            this.place(station, z, this.rng.range(2.3, 6.6), a.target);
            a.target.y = this.platformTop;
            a.state = 'walk';
            a.timer = this.rng.range(2, 6);
          } else {
            a.timer = this.rng.range(2, 8);
            a.yaw += this.rng.range(-1.2, 1.2);
          }
        } else if (a.state === 'walk' && a.timer <= 0) {
          a.state = 'idle';
          a.timer = this.rng.range(2, 9);
        }
      }

      const toTarget = this.tmp.copy(a.target).sub(a.pos);
      toTarget.y = 0;
      const dist = toTarget.length();
      const desired = a.state === 'walk' || a.state === 'board' || a.state === 'leave' ? 1 : 0;
      if (desired > 0 && dist > 0.35) {
        const step = Math.min(dist, a.speed * dt);
        toTarget.normalize();
        a.pos.addScaledVector(toTarget, step);
        const targetYaw = Math.atan2(toTarget.x, toTarget.z);
        let diff = targetYaw - a.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        a.yaw += diff * Math.min(1, dt * 7);
        a.phase += dt * (5.5 + a.speed * 1.4);
      } else {
        if (a.state === 'board') {
          a.active = false;
          a.pos.y = -100;
          continue;
        }
        if (a.state === 'leave' && dist <= 0.5) {
          a.active = false;
          a.pos.y = -100;
          continue;
        }
        a.phase += dt * 0.6;
      }

      if (a.state === 'idle' && a.timer <= 0) a.timer = 2;

      const walk = a.state !== 'idle';
      const bob = walk ? Math.abs(Math.sin(a.phase)) * 0.035 : Math.sin(a.phase) * 0.008;
      const s = a.scale;

      // torso
      d.position.set(a.pos.x, a.pos.y + bob, a.pos.z);
      d.rotation.set(0, a.yaw, walk ? Math.sin(a.phase) * 0.045 : 0);
      d.scale.set(s, s, s);
      d.updateMatrix();
      this.torso.setMatrixAt(visible, d.matrix);

      // head
      d.position.y = a.pos.y + 1.54 * s + bob;
      d.rotation.set(0, a.yaw, 0);
      d.updateMatrix();
      this.head.setMatrixAt(visible, d.matrix);

      // legs
      d.position.set(a.pos.x, a.pos.y + 0.8 * s + bob, a.pos.z);
      d.rotation.set(walk ? Math.sin(a.phase) * 0.55 : 0, a.yaw, 0);
      d.updateMatrix();
      this.legs.setMatrixAt(visible, d.matrix);

      visible++;
    }

    this.torso.count = visible;
    this.head.count = visible;
    this.legs.count = visible;
    this.torso.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
    this.legs.instanceMatrix.needsUpdate = true;
    void base;
  }

  get activeCount(): number {
    return this.agents.reduce((n, a) => n + (a.active ? 1 : 0), 0);
  }

  dispose(): void {
    this.torso.geometry.dispose();
    this.head.geometry.dispose();
    this.legs.geometry.dispose();
    this.group.clear();
  }
}
