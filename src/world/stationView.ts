import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { StationPlan, TrackPath } from './trackPlan';
import { RegionDef } from '../content/data';
import { concreteTexture, glowTexture, stationSignTexture, textTexture, windowTexture, woodTexture } from './textures';
import { clamp } from '../core/util';

export interface StationOptions {
  platformLength: number;
  theme: RegionDef['theme'];
  lineColor: string;
  lineCode: string;
  night: number;
}

export class StationView {
  group = new THREE.Group();
  plan: StationPlan;
  platformLength: number;
  stopS: number;
  private glows: THREE.Sprite[] = [];
  private lampMats: THREE.MeshStandardMaterial[] = [];
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private glassMat?: THREE.MeshPhysicalMaterial;
  private baseS: number;
  private batchItems: { geo: THREE.BufferGeometry; mat: THREE.Material; x: number; y: number; z: number }[] = [];

  constructor(path: TrackPath, plan: StationPlan, opts: StationOptions) {
    this.plan = plan;
    this.baseS = plan.s;
    this.platformLength = opts.platformLength;
    this.stopS = plan.s + opts.platformLength - 20;
    this.group.name = `station-${plan.name}`;
    const start = path.sample(plan.s);
    this.group.position.copy(start);
    this.group.rotation.y = path.headingAt(plan.s);

    const concrete = concreteTexture(opts.theme === 'oldtown' ? '#b7ad9c' : '#b9b6ad');
    const concMat = new THREE.MeshStandardMaterial({ map: concrete, color: 0xffffff, roughness: 0.94, metalness: 0.02 });
    const tactileMat = new THREE.MeshStandardMaterial({ color: 0xe0b23d, roughness: 0.7 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x5e6670, roughness: 0.55, metalness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.6, metalness: 0.45 });
    const roofMat = new THREE.MeshStandardMaterial({ color: opts.theme === 'oldtown' ? 0x6a4a3a : 0x4a5560, roughness: 0.75, metalness: 0.25 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.8 });
    const woodMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.85 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x9fc2d6, transparent: true, opacity: 0.24, roughness: 0.08, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
    this.glassMat = glassMat;
    this.disposables.push(concMat, tactileMat, steelMat, darkMat, roofMat, whiteMat, woodMat, glassMat);

    const len = opts.platformLength;
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      this.batchItems.push({ geo, mat, x, y, z });
      return m;
    };

    // Main platform (right side of the player's track)
    box(5.4, 2.9, len, concMat, 4.45, -0.4, len / 2);
    box(0.5, 0.045, len, tactileMat, 2.15, 1.07, len / 2);
    box(0.1, 0.03, len, whiteMat, 2.75, 1.065, len / 2);
    // Back fence
    box(0.14, 1.15, len, steelMat, 7.12, 1.62, len / 2);

    // Opposite platform
    box(5.0, 2.9, len, concMat, -8.8, -0.4, len / 2);
    box(0.5, 0.045, len, tactileMat, -6.65, 1.07, len / 2);
    box(0.14, 1.15, len, steelMat, -11.25, 1.62, len / 2);

    const canopyLen = Math.min(112, len - 32);
    const canopyCenter = len / 2;
    const roofHeight = 5.15;

    const buildCanopy = (x: number, width: number, side: 1 | -1) => {
      box(width, 0.22, canopyLen, roofMat, x, roofHeight, canopyCenter);
      box(width + 0.3, 0.12, canopyLen, darkMat, x, roofHeight - 0.15, canopyCenter);
      const pillars = Math.floor(canopyLen / 13);
      for (let i = 0; i <= pillars; i++) {
        const z = canopyCenter - canopyLen / 2 + (i * canopyLen) / pillars;
        this.batchItems.push({
          geo: new THREE.CylinderGeometry(0.12, 0.14, 4.1, 8),
          mat: steelMat,
          x: x + side * (width / 2 - 0.5),
          y: 3.0,
          z,
        });
        box(width - 0.4, 0.1, 0.14, darkMat, x, 4.9, z);
      }
      // Strip lights
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2d5, emissive: 0xffe9b8, emissiveIntensity: 2.2, roughness: 0.4 });
      this.lampMats.push(lampMat);
      this.disposables.push(lampMat);
      box(0.18, 0.08, canopyLen - 2, lampMat, x - 1.4, roofHeight - 0.28, canopyCenter);
      box(0.18, 0.08, canopyLen - 2, lampMat, x + 1.4, roofHeight - 0.28, canopyCenter);
      // Glow sprites
      for (let i = 0; i < 4; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffe3a8, transparent: true, opacity: 0, depthWrite: false, fog: true }));
        sp.position.set(x - 1.4, roofHeight - 0.5, canopyCenter - canopyLen * 0.36 + (i * canopyLen * 0.24));
        sp.scale.set(7, 7, 1);
        this.glows.push(sp);
        this.group.add(sp);
      }
    };

    buildCanopy(5.0, 6.2, 1);
    buildCanopy(-9.1, 5.4, -1);

    // Name signs
    const signTex = stationSignTexture(plan.name, opts.lineCode, opts.lineColor);
    const signGeo = new THREE.PlaneGeometry(6.2, 1.55);
    this.disposables.push(signGeo);
    const signMat = new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide });
    this.disposables.push(signMat);
    const signZ = [canopyCenter - canopyLen * 0.3, canopyCenter, canopyCenter + canopyLen * 0.3];
    for (const z of signZ) {
      const sign = new THREE.Mesh(signGeo, signMat);
      sign.position.set(3.65, 3.25, z);
      sign.rotation.y = -Math.PI / 2;
      this.group.add(sign);
      const back = box(0.12, 1.7, 6.4, darkMat, 3.77, 3.25, z);
      back.castShadow = false;
      // Opposite side
      const sign2 = new THREE.Mesh(signGeo, signMat);
      sign2.position.set(-8.4, 3.2, z);
      sign2.rotation.y = Math.PI / 2;
      this.group.add(sign2);
    }

    // Benches
    for (let i = 0; i < 5; i++) {
      const z = len * 0.24 + i * (len * 0.13);
      box(0.55, 0.12, 2.4, woodMat, 6.3, 1.55, z);
      box(0.14, 0.55, 2.4, woodMat, 6.65, 1.85, z);
      box(0.12, 0.45, 0.12, steelMat, 6.3, 1.28, z - 1.0);
      box(0.12, 0.45, 0.12, steelMat, 6.3, 1.28, z + 1.0);
    }

    // Ticket machine + bin + departure screen
    box(0.8, 1.7, 0.6, darkMat, 6.2, 1.95, len * 0.18);
    box(0.5, 0.9, 0.5, steelMat, 6.2, 1.55, len * 0.71);
    const screenTex = textTexture('DEPARTURES', { width: 512, height: 256, bg: '#08121a', fg: '#9fe7ff', sub: plan.name.toUpperCase(), subColor: '#5b7d8d' });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshBasicMaterial({ map: screenTex }));
    screen.position.set(7.03, 2.6, len * 0.82);
    screen.rotation.y = -Math.PI / 2;
    this.disposables.push(screen.geometry, screen.material as THREE.Material);
    this.group.add(screen);

    // Shelter with glass
    box(4.6, 0.16, 6.2, roofMat, 5.0, 3.3, len * 0.62);
    box(0.1, 2.2, 6.2, glassMat, 2.85, 2.2, len * 0.62);
    box(4.3, 2.2, 0.1, glassMat, 5.0, 2.2, len * 0.62 + 3.1);
    box(4.3, 2.2, 0.1, glassMat, 5.0, 2.2, len * 0.62 - 3.1);
    for (const z of [len * 0.62 - 3.1, len * 0.62 + 3.1]) {
      box(0.1, 2.5, 0.1, steelMat, 2.85, 2.35, z);
      box(0.1, 2.5, 0.1, steelMat, 7.1, 2.35, z);
    }

    // Station building at the far end
    if (plan.size > 0.8) {
      const b = box(7.4, 4.6, 12.0, new THREE.MeshStandardMaterial({ map: windowTexture(), roughness: 0.8 }), 11.3, 1.1, len - 16);
      b.castShadow = true;
      this.disposables.push((b.material as THREE.Material));
      box(8.0, 0.3, 12.6, roofMat, 11.3, 3.55, len - 16);
      box(2.0, 2.4, 0.15, glassMat, 11.3, 1.35, len - 9.95);
    }

    // Footbridge
    if (plan.size > 0.95) {
      box(22, 0.35, 4.2, steelMat, -2.4, 7.0, len * 0.28);
      box(22, 0.12, 4.4, darkMat, -2.4, 7.25, len * 0.28);
      for (const x of [-12.5, 8.0]) {
        box(0.4, 7.0, 4.2, glassMat, x, 3.5, len * 0.28);
      }
      for (let i = 0; i < 4; i++) {
        const z = len * 0.28 - 1.8 + i * 1.2;
        box(22, 0.9, 0.08, glassMat, -2.4, 7.55, z);
      }
      // Stairs hinted as blocks
      box(3.8, 3.2, 7, concreteBlock(concMat), 10.5, 4.9, len * 0.28);
      box(3.8, 5.4, 7, concreteBlock(concMat), -15.0, 3.9, len * 0.28);
    }

    // Lamps along the platform
    for (let i = 0; i < 4; i++) {
      const z = 22 + i * ((len - 60) / 3);
      this.batchItems.push({ geo: new THREE.CylinderGeometry(0.07, 0.09, 4.6, 7), mat: steelMat, x: 6.55, y: 3.3, z });
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffdf9a, emissiveIntensity: 2.4, roughness: 0.4 });
      this.lampMats.push(lampMat);
      this.disposables.push(lampMat);
      box(0.5, 0.22, 0.5, lampMat, 6.55, 5.65, z);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffe3a8, transparent: true, opacity: 0, depthWrite: false }));
      sp.position.set(6.55, 5.65, z);
      sp.scale.set(6, 6, 1);
      this.glows.push(sp);
      this.group.add(sp);
    }

    // Stop marker
    const stopZ = this.stopS - this.baseS;
    const markerTex = textTexture('STOP', { width: 256, height: 128, bg: '#e8e4d8', fg: '#111111' });
    const marker = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshBasicMaterial({ map: markerTex, side: THREE.DoubleSide }));
    marker.position.set(2.55, 2.15, stopZ);
    marker.rotation.y = Math.PI;
    this.disposables.push(marker.geometry, marker.material as THREE.Material);
    this.group.add(marker);
    box(0.1, 1.2, 0.1, steelMat, 2.7, 1.5, stopZ);
    box(0.75, 0.02, 2.2, new THREE.MeshStandardMaterial({ color: 0xf5f2e9, roughness: 0.7 }), 2.9, 1.075, stopZ);

    this.flushBatches();
    this.setNight(opts.night);
  }

  private flushBatches(): void {
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const item of this.batchItems) {
      item.geo.translate(item.x, item.y, item.z);
      const list = byMat.get(item.mat);
      if (list) list.push(item.geo);
      else byMat.set(item.mat, [item.geo]);
    }
    for (const [mat, geos] of byMat) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      this.group.add(mesh);
      this.disposables.push(merged);
    }
    this.batchItems = [];
  }

  setNight(night: number): void {
    const n = clamp(night, 0, 1);
    for (const m of this.lampMats) m.emissiveIntensity = 0.5 + n * 3.4;
    for (const g of this.glows) {
      (g.material as THREE.SpriteMaterial).opacity = n * 0.55;
      g.visible = n > 0.08;
    }
    if (this.glassMat) this.glassMat.opacity = 0.2 + n * 0.08;
  }

  /** World-space point on this station's platform from local coordinates. */
  platformPoint(path: TrackPath, localZ: number, lateral: number, out = new THREE.Vector3()): THREE.Vector3 {
    return path.sample(this.baseS + clamp(localZ, 0, this.platformLength), lateral, out);
  }

  dispose(): void {
    for (const g of this.glows) (g.material as THREE.SpriteMaterial).dispose();
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }
}

function concreteBlock(mat: THREE.Material): THREE.Material {
  return mat;
}
