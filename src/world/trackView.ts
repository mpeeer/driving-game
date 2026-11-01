import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TrackPath, TrackPlan } from './trackPlan';
import { RegionDef } from '../content/data';
import { gravelTexture, speedBoardTexture, textTexture } from './textures';
import { clamp } from '../core/util';

const TRACK_OFFSETS = [0, -4.5];
const GAUGE_HALF = 0.7175;

function railProfile(): [number, number][] {
  return [
    [-0.036, 0],
    [0.036, 0],
    [0.062, -0.06],
    [0.028, -0.19],
    [-0.028, -0.19],
    [-0.062, -0.06],
  ];
}

export class TrackView {
  group = new THREE.Group();
  path: TrackPath;
  private sleeperMesh: THREE.InstancedMesh;
  private sleeperSpacing: number;
  private sleeperCenter = -1e9;
  private dummy = new THREE.Object3D();
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private moving: THREE.Object3D[] = [];

  constructor(plan: TrackPlan, path: TrackPath, opts: { electric: boolean; theme: RegionDef['theme']; lineColor: string }) {
    this.path = path;
    this.group.name = 'track';

    const ballast = this.buildBallast(plan);
    this.group.add(ballast);

    const rails = this.buildRails(plan);
    this.group.add(rails);

    this.sleeperSpacing = 0.78;
    const cap = Math.ceil(1250 / this.sleeperSpacing) * 2 + 16;
    const sleeperGeo = new THREE.BoxGeometry(2.55, 0.19, 0.28);
    const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: 0.95, metalness: 0.02 });
    this.disposables.push(sleeperGeo, sleeperMat);
    this.sleeperMesh = new THREE.InstancedMesh(sleeperGeo, sleeperMat, cap);
    this.sleeperMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sleeperMesh.frustumCulled = false;
    this.sleeperMesh.receiveShadow = true;
    this.sleeperMesh.castShadow = false;
    const color = new THREE.Color();
    for (let i = 0; i < cap; i++) {
      const v = 0.72 + Math.random() * 0.4;
      color.setRGB(0.36 * v, 0.29 * v, 0.22 * v);
      this.sleeperMesh.setColorAt(i, color);
    }
    this.group.add(this.sleeperMesh);

    if (opts.electric) this.group.add(this.buildCatenary(plan));

    this.group.add(this.buildTracksideFurniture(plan, path));
    this.group.add(this.buildBufferStops(path));

    this.update(path.length / 2);
  }

  private buildBallast(plan: TrackPlan): THREE.Mesh {
    const step = 10;
    const n = Math.ceil(plan.length / step) + 1;
    const profile: [number, number][] = [
      [-11.4, -1.9],
      [-7.3, -0.32],
      [2.9, -0.32],
      [5.5, -1.9],
    ];
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const p = new THREE.Vector3();
    const sampleCount = Math.ceil(plan.length / 12) + 1;
    for (let i = 0; i < sampleCount; i++) {
      const s = Math.min(plan.length, i * 12);
      const h = plan.points[Math.min(plan.points.length - 1, Math.round(s / 2))].h;
      const rightX = Math.cos(h);
      const rightZ = -Math.sin(h);
      for (let j = 0; j < profile.length; j++) {
        this.path.sample(s, profile[j][0], p);
        positions.push(p.x, p.y + profile[j][1], p.z);
        uvs.push(j / (profile.length - 1) * 2, s / 7);
      }
      if (i > 0) {
        for (let j = 0; j < profile.length - 1; j++) {
          const a = (i - 1) * profile.length + j;
          const b = a + 1;
          const c = i * profile.length + j;
          const d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const tex = gravelTexture();
    tex.repeat.set(2, 1);
    const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0xb8b2a8, roughness: 0.98, metalness: 0.01 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.disposables.push(geo, mat);
    void n;
    return mesh;
  }

  private buildRails(plan: TrackPlan): THREE.Mesh {
    const step = 8;
    const profile = railProfile();
    const positions: number[] = [];
    const indices: number[] = [];
    const sampleCount = Math.ceil(plan.length / step) + 1;
    const rings = sampleCount * TRACK_OFFSETS.length * 2;
    const p = new THREE.Vector3();
    let vertexBase = 0;

    for (const offset of TRACK_OFFSETS) {
      for (const side of [-1, 1]) {
        for (let i = 0; i < sampleCount; i++) {
          const s = Math.min(plan.length, i * step);
          this.path.sample(s, offset + side * GAUGE_HALF, p);
          const h = plan.points[Math.min(plan.points.length - 1, Math.round(s / 2))].h;
          const rx = Math.cos(h);
          const rz = -Math.sin(h);
          for (const [lat, up] of profile) {
            positions.push(p.x + rx * lat, p.y + up, p.z + rz * lat);
          }
        }
        for (let i = 0; i < sampleCount - 1; i++) {
          for (let j = 0; j < profile.length; j++) {
            const j2 = (j + 1) % profile.length;
            const a = vertexBase + i * profile.length + j;
            const b = vertexBase + i * profile.length + j2;
            const c = vertexBase + (i + 1) * profile.length + j;
            const d = vertexBase + (i + 1) * profile.length + j2;
            indices.push(a, c, b, b, c, d);
          }
        }
        vertexBase += sampleCount * profile.length;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xa8adb3, metalness: 0.75, roughness: 0.34 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.disposables.push(geo, mat);
    void rings;
    return mesh;
  }

  private buildCatenary(plan: TrackPlan): THREE.Group {
    const g = new THREE.Group();
    g.name = 'catenary';
    const portalGeo = this.buildPortalGeometry();
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x4b5157, roughness: 0.7, metalness: 0.6 });
    const spacing = 55;
    const mastCount = Math.max(2, Math.floor(plan.length / spacing));
    const masts = new THREE.InstancedMesh(portalGeo, mastMat, mastCount);
    const dummy = new THREE.Object3D();
    const stations = plan.stations;
    let placed = 0;
    for (let i = 0; i < mastCount; i++) {
      const s = 30 + i * spacing;
      let nearStation = false;
      for (const st of stations) if (Math.abs(st.s - s) < 130) nearStation = true;
      if (nearStation) {
        dummy.position.set(0, -9999, 0);
      } else {
        const p = this.path.sample(s, -8.9);
        const h = this.path.headingAt(s);
        dummy.position.copy(p);
        dummy.rotation.set(0, h, 0);
      }
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      masts.setMatrixAt(placed++, dummy.matrix);
    }
    masts.count = placed;
    masts.castShadow = true;
    masts.receiveShadow = true;
    g.add(masts);
    this.disposables.push(portalGeo, mastMat);

    // Wires
    const linePositions: number[] = [];
    const pushSeg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      linePositions.push(ax, ay, az, bx, by, bz);
    };
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const offset of TRACK_OFFSETS) {
      const seg = 8;
      const n = Math.ceil(plan.length / seg);
      let prevContact: THREE.Vector3 | null = null;
      let prevMess: THREE.Vector3 | null = null;
      for (let i = 0; i <= n; i++) {
        const s = Math.min(plan.length, i * seg);
        const zig = Math.sin(s / 40) * 0.22;
        this.path.sample(s, offset + zig, a);
        const contact = new THREE.Vector3(a.x, a.y + 5.6, a.z);
        const sag = 0.34 * Math.abs(Math.sin((s / 55) * Math.PI));
        const messenger = new THREE.Vector3(a.x, a.y + 6.9 - sag, a.z);
        if (prevContact) {
          pushSeg(prevContact.x, prevContact.y, prevContact.z, contact.x, contact.y, contact.z);
          pushSeg(prevMess!.x, prevMess!.y, prevMess!.z, messenger.x, messenger.y, messenger.z);
        }
        if (i % 2 === 0) pushSeg(contact.x, contact.y, contact.z, messenger.x, messenger.y, messenger.z);
        prevContact = contact;
        prevMess = messenger;
      }
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    const lineMat = new THREE.LineBasicMaterial({ color: 0x23272b, transparent: true, opacity: 0.9 });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    lines.frustumCulled = false;
    g.add(lines);
    this.disposables.push(lineGeo, lineMat);
    void b;
    return g;
  }

  private buildPortalGeometry(): THREE.BufferGeometry {
    const pole = new THREE.CylinderGeometry(0.13, 0.17, 7.6, 6);
    pole.translate(0, 3.8, 0);
    const arm = new THREE.BoxGeometry(14.4, 0.16, 0.16);
    arm.translate(7.2, 7.25, 0);
    const brace = new THREE.BoxGeometry(0.1, 5.4, 0.1);
    brace.rotateZ(-0.72);
    brace.translate(2.6, 6.1, 0);
    const insulA = new THREE.CylinderGeometry(0.1, 0.1, 0.34, 6);
    insulA.translate(8.9, 7.0, 0);
    const insulB = new THREE.CylinderGeometry(0.1, 0.1, 0.34, 6);
    insulB.translate(4.4, 7.0, 0);
    const merged = mergeGeometries([pole, arm, brace, insulA, insulB]);
    pole.dispose();
    arm.dispose();
    brace.dispose();
    insulA.dispose();
    insulB.dispose();
    return merged ?? new THREE.BufferGeometry();
  }

  private buildTracksideFurniture(plan: TrackPlan, path: TrackPath): THREE.Group {
    const g = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8b9096, roughness: 0.8, metalness: 0.3 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.7, metalness: 0.4 });
    this.disposables.push(postMat, darkMat);

    // Speed boards
    const sections = path.limitSections();
    const seen = new Set<number>();
    for (const sec of sections) {
      const s = Math.max(20, sec.s - 140);
      if (seen.has(s)) continue;
      seen.add(s);
      let onStation = false;
      for (const st of plan.stations) if (Math.abs(st.s - s) < 140) onStation = true;
      if (onStation) continue;
      const board = new THREE.Group();
      const p = path.sample(s, -7.2);
      board.position.copy(p);
      board.rotation.y = path.headingAt(s);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), postMat);
      post.position.set(0, 1.3, 0);
      board.add(post);
      const rounded = sec.limit <= (plan.line.kind === 'express' ? 120 : 62) ? 0.85 : 1;
      const tex = speedBoardTexture(sec.limit);
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(1.15 * rounded, 1.15 * rounded),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })
      );
      plane.position.set(0, 2.55, 0.03);
      plane.rotation.y = Math.PI;
      board.add(plane);
      this.registerDisposable(plane.geometry, plane.material as THREE.Material);
      g.add(board);
    }

    // Signals every ~850 m
    const signalTexGreen = textTexture('●', { width: 128, height: 128, fg: '#3cff9a', bg: '#0c1210' });
    const signalTexRed = textTexture('●', { width: 128, height: 128, fg: '#ff4b4b', bg: '#120c0c' });
    for (let s = 260; s < plan.length - 300; s += 850) {
      const p = path.sample(s, -7.9);
      const sig = new THREE.Group();
      sig.position.copy(p);
      sig.rotation.y = path.headingAt(s);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 3.4, 6), postMat);
      mast.position.y = 1.7;
      sig.add(mast);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.15, 0.32), darkMat);
      head.position.set(0, 3.35, 0);
      sig.add(head);
      const lamp = new THREE.Mesh(
        new THREE.PlaneGeometry(0.4, 0.4),
        new THREE.MeshBasicMaterial({ map: s % 1700 > 850 ? signalTexRed : signalTexGreen, transparent: true })
      );
      lamp.position.set(0, 3.55, 0.18);
      sig.add(lamp);
      this.registerDisposable(lamp.geometry, lamp.material as THREE.Material);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: signalTexGreen === signalTexRed ? null : signalTexGreen, transparent: true, opacity: 0.18 }));
      back.visible = false;
      sig.add(back);
      g.add(sig);
    }

    // Relay cabinets and marker posts
    const cabMat = new THREE.MeshStandardMaterial({ color: 0x59616a, roughness: 0.9, metalness: 0.2 });
    this.disposables.push(cabMat);
    for (let s = 340; s < plan.length - 100; s += 420) {
      const p = path.sample(s, -10.4);
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 0.7), cabMat);
      box.position.copy(p);
      box.position.y += 0.6;
      box.rotation.y = path.headingAt(s);
      box.castShadow = true;
      g.add(box);
    }

    // Kilometre posts
    for (let s = 500; s < plan.length; s += 1000) {
      const p = path.sample(s, -6.6);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.1, 0.18), postMat);
      post.position.copy(p);
      post.position.y += 0.55;
      g.add(post);
      const tex = textTexture(`${(s / 1000).toFixed(1)}`, { width: 128, height: 128, fg: '#1a1a1a', bg: '#eae7df' });
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), new THREE.MeshBasicMaterial({ map: tex }));
      plate.position.copy(post.position);
      plate.position.y += 1.15;
      plate.rotation.y = path.headingAt(s) - Math.PI / 2;
      this.registerDisposable(plate.geometry, plate.material as THREE.Material);
      g.add(plate);
    }
    return g;
  }

  private buildBufferStops(path: TrackPath): THREE.Group {
    const g = new THREE.Group();
    const redMat = new THREE.MeshStandardMaterial({ color: 0xc53b32, roughness: 0.6, metalness: 0.2 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.5, metalness: 0.7 });
    this.disposables.push(redMat, steelMat);
    for (const s of [12, path.length - 12]) {
      const dir = s < 50 ? 0 : Math.PI;
      const p = path.sample(s);
      for (const lat of [0, -4.5]) {
        if (lat !== 0) continue;
        const grp = new THREE.Group();
        grp.position.copy(p).add(new THREE.Vector3(0, 0.2, 0));
        grp.rotation.y = path.headingAt(s) + dir;
        const beam = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 0.5), redMat);
        beam.position.set(0, 1.1, 0);
        beam.castShadow = true;
        grp.add(beam);
        for (const x of [-0.85, 0.85]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.2, 0.3), steelMat);
          leg.position.set(x, 0.55, 0);
          grp.add(leg);
          const buffer = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.45, 10), steelMat);
          buffer.rotation.x = Math.PI / 2;
          buffer.position.set(x, 0.9, 0.4);
          grp.add(buffer);
        }
        g.add(grp);
      }
    }
    return g;
  }

  private registerDisposable(geo: THREE.BufferGeometry, mat: THREE.Material): void {
    this.disposables.push(geo, mat);
  }

  update(centerS: number): void {
    if (Math.abs(centerS - this.sleeperCenter) < 8) return;
    this.sleeperCenter = centerS;
    const half = 620;
    const start = Math.max(0, centerS - half);
    const end = Math.min(this.path.length, centerS + half);
    let idx = 0;
    const cap = this.sleeperMesh.count;
    const d = this.dummy;
    const p = new THREE.Vector3();
    for (let s = start; s < end; s += this.sleeperSpacing) {
      const h = this.path.headingAt(s);
      for (const off of TRACK_OFFSETS) {
        if (idx >= cap) break;
        this.path.sample(s, off, p);
        d.position.set(p.x, p.y - 0.28, p.z);
        d.rotation.set(0, h, 0);
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        this.sleeperMesh.setMatrixAt(idx++, d.matrix);
      }
    }
    for (; idx < cap; idx++) {
      d.position.set(0, -9999, 0);
      d.updateMatrix();
      this.sleeperMesh.setMatrixAt(idx, d.matrix);
    }
    this.sleeperMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.clear();
    void clamp;
    void this.moving;
  }
}
