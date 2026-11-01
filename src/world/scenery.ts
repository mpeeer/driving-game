import * as THREE from 'three';
import { TrackPath, TrackPlan } from './trackPlan';
import { RegionDef } from '../content/data';
import { Rng, fbm2, smoothstep } from '../core/util';
import { windowTexture, woodTexture } from './textures';

const LATS = [-260, -205, -155, -112, -80, -56, -40, -29, -20, -13, -8, -3, 0, 3, 8, 13, 20, 29, 40, 56, 80, 112, 155, 205, 260];

const THEME_GROUND: Record<string, number> = {
  urban: 0x5f6a58,
  valley: 0x708c4e,
  mountain: 0x6e6a56,
  coast: 0x89945c,
  oldtown: 0x62704f,
};

const THEME_HILL: Record<string, number> = {
  urban: 6,
  valley: 34,
  mountain: 110,
  coast: 16,
  oldtown: 4,
};

function terrainNoise(x: number, z: number, theme: RegionDef['theme']): number {
  const rock = theme === 'mountain' ? 0.55 : theme === 'urban' || theme === 'oldtown' ? 0.12 : 0.25;
  const big = (fbm2(x * 0.0022 + 40, z * 0.0022 - 12, 4) - 0.5) * 2;
  const small = (fbm2(x * 0.02, z * 0.02, 3) - 0.5) * 2;
  return big * (0.35 + rock) + small * 0.12;
}

function groundHeight(trackY: number, lateral: number, x: number, z: number, theme: RegionDef['theme']): number {
  const d = Math.abs(lateral);
  const far = smoothstep(11, 55, d);
  const amp = THEME_HILL[theme] ?? 10;
  const n = terrainNoise(x, z, theme);
  const base = trackY - 1.9 + n * amp * far;
  const edge = smoothstep(9.5, 15, d) * 0.6;
  return base - edge;
}

function groundColor(theme: RegionDef['theme'], lateral: number, x: number, z: number, y: number, out: THREE.Color): void {
  const rng = new Rng(Math.floor(x * 0.13) * 73856093 ^ Math.floor(z * 0.17) * 19349663);
  const tint = rng.range(-0.06, 0.06);
  const base = new THREE.Color(THEME_GROUND[theme] ?? 0x6f8050);
  if (Math.abs(lateral) < 14) {
    out.setHex(0x5d5a52).offsetHSL(0, 0, tint * 0.6);
    return;
  }
  out.copy(base);
  if (theme === 'mountain' && y > 22) out.lerp(new THREE.Color(0x7d7c74), smoothstep(22, 80, y) * 0.8);
  if (theme === 'coast' && Math.abs(lateral) < 46 && rng.chance(0.35)) out.lerp(new THREE.Color(0xb9a97c), 0.35);
  if (theme === 'urban') out.lerp(new THREE.Color(0x6c7075), rng.chance(0.3) ? 0.25 : 0);
  out.offsetHSL(0, 0, tint);
}

export class Scenery {
  group = new THREE.Group();
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private water?: THREE.Mesh;

  constructor(plan: TrackPlan, path: TrackPath, theme: RegionDef['theme']) {
    this.group.name = 'scenery';
    this.group.add(this.buildCorridor(plan, path, theme));
    this.buildVegetation(plan, path, theme);
    this.buildBuildings(plan, path, theme);
    this.buildBackdrop(plan, path, theme);
  }

  private buildCorridor(plan: TrackPlan, path: TrackPath, theme: RegionDef['theme']): THREE.Mesh {
    const stepS = 18;
    const rows = Math.ceil(plan.length / stepS) + 1;
    const cols = LATS.length;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    for (let r = 0; r < rows; r++) {
      const s = Math.min(plan.length, r * stepS);
      const base = path.sample(s);
      for (let c = 0; c < cols; c++) {
        const lat = LATS[c];
        path.sample(s, lat, p);
        const y = groundHeight(base.y, lat, p.x, p.z, theme);
        positions.push(p.x, y, p.z);
        groundColor(theme, lat, p.x, p.z, y - base.y, col);
        colors.push(col.r, col.g, col.b);
      }
      if (r > 0) {
        for (let c = 0; c < cols - 1; c++) {
          const a = (r - 1) * cols + c;
          const b = a + 1;
          const d = r * cols + c;
          const e = d + 1;
          indices.push(a, d, b, b, d, e);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.disposables.push(geo, mat);

    if (theme === 'coast') {
      const waterGeo = new THREE.PlaneGeometry(14000, 14000, 1, 1);
      const waterMat = new THREE.MeshStandardMaterial({ color: 0x2b6c85, roughness: 0.16, metalness: 0.35, transparent: true, opacity: 0.94 });
      const water = new THREE.Mesh(waterGeo, waterMat);
      water.rotation.x = -Math.PI / 2;
      const mid = path.sample(plan.length / 2);
      water.position.set(mid.x, -7.5, mid.z);
      water.receiveShadow = true;
      this.group.add(water);
      this.water = water;
      this.disposables.push(waterGeo, waterMat);
    } else if (theme === 'mountain') {
      // A rocky river along part of the valley floor.
      const waterGeo = new THREE.PlaneGeometry(1400, 90);
      const waterMat = new THREE.MeshStandardMaterial({ color: 0x3d6d78, roughness: 0.2, metalness: 0.3 });
      const w = new THREE.Mesh(waterGeo, waterMat);
      const mid = path.sample(plan.length * 0.42, 120);
      w.position.set(mid.x, mid.y - 8, mid.z);
      w.rotation.set(-Math.PI / 2, 0, path.headingAt(plan.length * 0.42));
      this.group.add(w);
      this.disposables.push(waterGeo, waterMat);
    }
    return mesh;
  }

  private buildVegetation(plan: TrackPlan, path: TrackPath, theme: RegionDef['theme']): void {
    const rng = new Rng(plan.line.seed ^ 0xabcdef);
    const count = theme === 'urban' || theme === 'oldtown' ? 700 : 1900;
    const crownGeo = theme === 'mountain'
      ? new THREE.ConeGeometry(1.8, 5.6, 6)
      : new THREE.IcosahedronGeometry(1.8, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.11, 0.2, 2.2, 5);
    const crownMat = new THREE.MeshLambertMaterial({ color: 0x3f6b36 });
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4c3a29 });
    this.disposables.push(crownGeo, trunkGeo, crownMat, trunkMat);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, count);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    crowns.castShadow = true;
    trunks.castShadow = true;
    crowns.receiveShadow = false;
    trunks.receiveShadow = false;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 6) {
      attempts++;
      const s = rng.range(0, plan.length);
      const side = rng.chance(0.5) ? 1 : -1;
      const lat = side * rng.range(18, 215);
      if (Math.abs(lat) < 18) continue;
      let nearStation = false;
      for (const st of plan.stations) if (Math.abs(st.s - s) < 120 && Math.abs(lat) < 45) nearStation = true;
      if (nearStation) continue;
      const p = path.sample(s, lat);
      const baseY = path.sample(s).y;
      const y = groundHeight(baseY, lat, p.x, p.z, theme);
      if (theme === 'coast' && y < -7) continue;
      const scale = rng.range(0.6, 1.7);
      dummy.position.set(p.x, y + 1.1 * scale, p.z);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      dummy.scale.set(scale, scale * rng.range(0.85, 1.3), scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);
      dummy.position.y += 1.4 * scale;
      dummy.updateMatrix();
      crowns.setMatrixAt(placed, dummy.matrix);
      const shade = rng.range(0.75, 1.25);
      if (theme === 'mountain') color.setRGB(0.19 * shade, 0.29 * shade, 0.18 * shade);
      else if (theme === 'coast') color.setRGB(0.24 * shade, 0.41 * shade, 0.19 * shade);
      else color.setRGB(0.2 * shade, 0.36 * shade, 0.16 * shade);
      crowns.setColorAt(placed, color);
      placed++;
    }
    crowns.count = placed;
    trunks.count = placed;
    this.group.add(crowns, trunks);
  }

  private buildBuildings(plan: TrackPlan, path: TrackPath, theme: RegionDef['theme']): void {
    const rng = new Rng(plan.line.seed ^ 0x5eed);
    const density = theme === 'urban' ? 2.4 : theme === 'oldtown' ? 2.0 : theme === 'coast' ? 1.4 : 0.55;
    const items: { x: number; y: number; z: number; w: number; h: number; d: number; rot: number; color: THREE.Color }[] = [];
    for (let s = 40; s < plan.length; s += 26) {
      const nearStation = plan.stations.some((st) => Math.abs(st.s - s) < 90);
      const n = Math.floor(rng.range(0, density + (nearStation ? 1.2 : 0)));
      for (let i = 0; i < n; i++) {
        const side = rng.chance(0.5) ? 1 : -1;
        const lat = side * rng.range(26, 170);
        const p = path.sample(s + rng.range(-12, 12), lat);
        const baseY = path.sample(s).y;
        const y = groundHeight(baseY, lat, p.x, p.z, theme);
        if (theme === 'coast' && y < -7) continue;
        if (Math.abs(lat) < 24) continue;
        const urban = theme === 'urban';
        const old = theme === 'oldtown';
        const w = urban ? rng.range(10, 26) : old ? rng.range(8, 16) : rng.range(9, 19);
        const d = urban ? rng.range(10, 24) : old ? rng.range(8, 15) : rng.range(9, 17);
        const h = urban
          ? (nearStation ? rng.range(14, 44) : rng.range(9, 30))
          : old ? rng.range(9, 17)
          : theme === 'coast' ? rng.range(7, 20)
          : theme === 'mountain' ? rng.range(5, 10)
          : rng.range(5, 9);
        const shade = rng.range(0.72, 1.12);
        const c = new THREE.Color();
        if (theme === 'oldtown') c.setRGB(0.72 * shade, 0.58 * shade, 0.42 * shade);
        else if (theme === 'mountain') c.setRGB(0.5 * shade, 0.46 * shade, 0.4 * shade);
        else if (theme === 'coast') c.setRGB(0.86 * shade, 0.82 * shade, 0.74 * shade);
        else c.setRGB(0.64 * shade, 0.66 * shade, 0.68 * shade);
        items.push({ x: p.x, y, z: p.z, w, h, d, rot: path.headingAt(s) + rng.range(-0.1, 0.1) + (rng.chance(0.22) ? Math.PI / 2 : 0), color: c });
        if (items.length > 900) break;
      }
    }

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ map: windowTexture() });
    this.disposables.push(geo, mat);
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    const roofGeo = new THREE.BoxGeometry(1, 1, 1);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x4a4f55 });
    this.disposables.push(roofGeo, roofMat);
    const roofs = new THREE.InstancedMesh(roofGeo, roofMat, items.length);
    const dummy = new THREE.Object3D();
    items.forEach((it, i) => {
      dummy.position.set(it.x, it.y + it.h / 2, it.z);
      dummy.rotation.set(0, it.rot, 0);
      dummy.scale.set(it.w, it.h, it.d);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, it.color);
      dummy.position.y = it.y + it.h + 0.18;
      dummy.scale.set(it.w + 0.7, 0.36, it.d + 0.7);
      dummy.updateMatrix();
      roofs.setMatrixAt(i, dummy.matrix);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    roofs.castShadow = true;
    this.group.add(mesh, roofs);

    // Wooden lineside huts / sheds
    if (items.length > 0) {
      const hutGeo = new THREE.BoxGeometry(4.4, 2.6, 3.4);
      const hutMat = new THREE.MeshLambertMaterial({ map: woodTexture() });
      this.disposables.push(hutGeo, hutMat);
      const huts: THREE.Matrix4[] = [];
      for (let s = 180; s < plan.length - 100; s += 620) {
        const p = path.sample(s, -17);
        const base = path.sample(s).y;
        dummy.position.set(p.x, base - 0.6, p.z);
        dummy.rotation.set(0, path.headingAt(s) + Math.PI / 2, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        huts.push(dummy.matrix.clone());
      }
      const hutMesh = new THREE.InstancedMesh(hutGeo, hutMat, huts.length);
      huts.forEach((m, i) => hutMesh.setMatrixAt(i, m));
      hutMesh.castShadow = true;
      hutMesh.receiveShadow = true;
      this.group.add(hutMesh);
    }
  }

  private buildBackdrop(plan: TrackPlan, path: TrackPath, theme: RegionDef['theme']): void {
    if (theme === 'urban' || theme === 'oldtown') return;
    const rng = new Rng(plan.line.seed ^ 0x9911);
    const amp = theme === 'mountain' ? 420 : theme === 'coast' ? 120 : 170;
    const count = Math.ceil(plan.length / 2600) + 2;
    const mat = new THREE.MeshLambertMaterial({ color: 0x5b6572 });
    this.disposables.push(mat);
    for (let i = 0; i < count; i++) {
      const s = rng.range(0, plan.length);
      const side = rng.chance(0.5) ? 1 : -1;
      const lat = side * rng.range(750, 1450);
      const p = path.sample(s, lat);
      const baseY = path.sample(s).y;
      const h = rng.range(amp * 0.55, amp);
      const r = h * rng.range(1.4, 2.4);
      const geo = new THREE.ConeGeometry(r, h, 7, 1);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.x, baseY - 20 + h / 2, p.z);
      m.rotation.y = rng.range(0, Math.PI);
      this.disposables.push(geo);
      this.group.add(m);
    }
  }

  update(dt: number, time: number): void {
    if (this.water) {
      this.water.position.y = -7.5 + Math.sin(time * 0.4) * 0.035;
    }
    void dt;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.clear();
    void smoothstep;
  }
}
