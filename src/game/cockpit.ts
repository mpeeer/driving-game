import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DRIVER_X } from './config';
import { displaySpeed, formatDistance } from './format';
import type { MapData, Units } from './types';

export interface CockpitState {
  speedKmh: number;
  gear: string;
  rpm: number;
  steering: number;
  units: Units;
  nextGateDistance: number;
  mapX: number;
  mapZ: number;
  heading: number;
}

type Vec3 = [number, number, number];

function transformed(
  geometry: THREE.BufferGeometry,
  position: Vec3,
  rotation: Vec3 = [0, 0, 0],
  scale: Vec3 = [1, 1, 1],
): THREE.BufferGeometry {
  const clone = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  clone.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...scale),
    ),
  );
  return clone;
}

class PartBatch {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: Vec3,
    rotation: Vec3 = [0, 0, 0],
    scale: Vec3 = [1, 1, 1],
  ): void {
    const list = this.parts.get(material) ?? [];
    list.push(transformed(geometry, position, rotation, scale));
    this.parts.set(material, list);
  }

  flush(parent: THREE.Object3D, name: string): void {
    let index = 0;
    for (const [material, geometries] of this.parts) {
      const merged = mergeGeometries(geometries, false);
      for (const geometry of geometries) geometry.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${name}-${index++}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      parent.add(mesh);
    }
    this.parts.clear();
  }
}

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function rounded(w: number, h: number, d: number, radius: number): RoundedBoxGeometry {
  return new RoundedBoxGeometry(w, h, d, 2, radius);
}

/**
 * First-person cabin framed like a modern touring car: roof liner, framed side
 * glass, a three-dial analogue cluster behind the wheel and a physical
 * navigation screen set into the centre stack. Static trim is merged by
 * material to keep the cockpit around a dozen draw calls rather than dozens.
 */
export class Cockpit {
  readonly group = new THREE.Group();
  private readonly spin = new THREE.Group();
  private readonly clusterCanvas = document.createElement('canvas');
  private readonly clusterFaceCanvas = document.createElement('canvas');
  private readonly navCanvas = document.createElement('canvas');
  private readonly navBaseCanvas = document.createElement('canvas');
  private readonly clusterTexture: THREE.CanvasTexture;
  private readonly navTexture: THREE.CanvasTexture;
  private readonly glassTexture: THREE.CanvasTexture;
  private readonly clusterKey = { value: '' };
  private readonly navKey = { value: '' };
  private readonly mapData: MapData;
  private clusterUnits: Units | null = null;
  private screenTimer = 0;

  private readonly soft = new THREE.MeshPhongMaterial({
    color: 0x383d41,
    specular: 0x202427,
    shininess: 14,
    emissive: 0x060708,
  });
  private readonly dark = new THREE.MeshLambertMaterial({ color: 0x15181b });
  private readonly upper = new THREE.MeshPhongMaterial({
    color: 0x444a4e,
    specular: 0x2b3033,
    shininess: 16,
  });
  private readonly headliner = new THREE.MeshPhongMaterial({
    color: 0x4c5050,
    specular: 0x191c1d,
    shininess: 7,
    emissive: 0x111314,
  });
  private readonly headlinerInset = new THREE.MeshLambertMaterial({
    color: 0x5a5d5b,
    emissive: 0x111313,
  });
  private readonly accent = new THREE.MeshPhongMaterial({
    color: 0x8f887a,
    specular: 0xffe6c2,
    shininess: 64,
  });
  private readonly metal = new THREE.MeshPhongMaterial({
    color: 0x9aa4a9,
    specular: 0xdbe3e4,
    shininess: 64,
  });
  private readonly leather = new THREE.MeshPhongMaterial({
    color: 0x202326,
    specular: 0x5b6468,
    shininess: 24,
  });
  private readonly gloss = new THREE.MeshPhongMaterial({
    color: 0x090c0e,
    specular: 0x758084,
    shininess: 96,
  });
  private readonly skin = new THREE.MeshPhongMaterial({
    color: 0xb57f61,
    specular: 0x6a402d,
    shininess: 18,
  });
  private readonly sleeve = new THREE.MeshLambertMaterial({ color: 0x24282c });
  private readonly amber = new THREE.MeshBasicMaterial({ color: 0xffb877, toneMapped: false });

  constructor(mapData: MapData) {
    this.mapData = mapData;
    this.group.name = 'cockpit';
    this.clusterCanvas.width = 1024;
    this.clusterCanvas.height = 400;
    this.clusterFaceCanvas.width = 1024;
    this.clusterFaceCanvas.height = 400;
    this.navCanvas.width = 768;
    this.navCanvas.height = 448;
    this.navBaseCanvas.width = 768;
    this.navBaseCanvas.height = 448;
    this.clusterTexture = this.makeScreenTexture(this.clusterCanvas);
    this.navTexture = this.makeScreenTexture(this.navCanvas);
    this.glassTexture = this.makeGlassTexture();

    this.buildDashboard();
    this.buildLowerInterior();
    this.buildCabinShell();
    this.buildMirrors();
    this.buildScreens();
    this.buildSteeringWheel();

    this.renderGaugeFace('kmh');
    this.drawCluster({
      speedKmh: 0,
      gear: 'N',
      rpm: 900,
      steering: 0,
      units: 'kmh',
      nextGateDistance: 0,
      mapX: mapData.regions[0]?.x ?? 0,
      mapZ: mapData.regions[0]?.z ?? 0,
      heading: 0,
    });
    this.renderNavBase();
    this.drawNav({
      mapX: mapData.regions[0]?.x ?? 0,
      mapZ: mapData.regions[0]?.z ?? 0,
      heading: 0,
      nextGateDistance: 0,
    });

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        this.clusterUnits = null;
        this.clusterKey.value = '';
        this.navKey.value = '';
      }).catch(() => undefined);
    }
  }

  private makeScreenTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2;
    return texture;
  }

  private makeGlassTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is unavailable');

    const tint = ctx.createLinearGradient(0, 0, 0, 256);
    tint.addColorStop(0, 'rgba(212,235,232,0.5)');
    tint.addColorStop(0.2, 'rgba(172,207,205,0.19)');
    tint.addColorStop(0.58, 'rgba(229,239,235,0.035)');
    tint.addColorStop(1, 'rgba(8,17,18,0.11)');
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, 128, 256);

    const reflection = ctx.createLinearGradient(6, 4, 122, 205);
    reflection.addColorStop(0, 'rgba(255,255,255,0)');
    reflection.addColorStop(0.43, 'rgba(255,255,255,0.08)');
    reflection.addColorStop(0.52, 'rgba(255,255,255,0.3)');
    reflection.addColorStop(0.62, 'rgba(255,255,255,0.03)');
    reflection.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = reflection;
    ctx.fillRect(0, 0, 128, 256);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2;
    return texture;
  }

  // -------------------------------------------------------------- geometry

  private buildDashboard(): void {
    const batch = new PartBatch();
    const centreX = 0.16;

    // One continuous, low dash pad rather than separate shelves and boxes.
    const dashTop = rounded(1.9, 0.078, 0.36, 0.036);
    batch.add(dashTop, this.upper, [0, 0.272, -0.905], [0.018, 0, 0]);

    const dashRoll = rounded(1.86, 0.04, 0.1, 0.018);
    batch.add(dashRoll, this.soft, [0, 0.239, -0.78], [0.05, 0, 0]);

    const face = rounded(1.82, 0.205, 0.12, 0.036);
    batch.add(face, this.soft, [0, 0.15, -0.88], [-0.03, 0, 0]);

    // Padded lower lip and a driver knee bolster that closes the top of the
    // footwell, so pedals no longer float into the dashboard view.
    batch.add(rounded(1.74, 0.05, 0.18, 0.022), this.dark, [0, 0.036, -0.79], [-0.02, 0, 0]);
    batch.add(rounded(0.84, 0.15, 0.18, 0.035), this.soft, [-0.37, 0.085, -0.68], [0.08, 0, 0]);

    const cowl = rounded(1.9, 0.052, 0.14, 0.02);
    batch.add(cowl, this.dark, [0, 0.35, -1.01], [-0.02, 0, 0]);

    // Glovebox seam and a soft passenger-side dash pad. No detached chrome
    // strips running across the face.
    batch.add(rounded(0.54, 0.004, 0.01, 0.002), this.dark, [0.54, 0.205, -0.817], [-0.025, 0, 0]);
    batch.add(rounded(0.4, 0.022, 0.03, 0.008), this.dark, [0.46, 0.135, -0.81], [-0.025, 0, 0]);

    // A broad, lower binnacle shell with soft cheeks and brow. The screen sits
    // inside this shape instead of on top of a separate rectangular pod.
    const binnacle = rounded(0.69, 0.18, 0.18, 0.04);
    batch.add(binnacle, this.soft, [DRIVER_X, 0.375, -0.83], [-0.055, 0, 0]);
    for (const side of [-1, 1] as const) {
      batch.add(
        rounded(0.075, 0.125, 0.19, 0.026),
        this.upper,
        [DRIVER_X + side * 0.345, 0.335, -0.82],
        [-0.03, side * 0.06, side * 0.025],
      );
    }
    const brow = rounded(0.68, 0.026, 0.235, 0.012);
    batch.add(brow, this.upper, [DRIVER_X, 0.475, -0.8], [-0.09, 0, 0]);
    batch.add(rounded(0.6, 0.018, 0.09, 0.008), this.dark, [DRIVER_X, 0.296, -0.78]);
    batch.add(new THREE.BoxGeometry(0.56, 0.004, 0.006), this.metal, [DRIVER_X, 0.303, -0.735]);

    // Wide centre fascia with a layered silver/black screen surround. The
    // display is wider and lower, so it reads as part of the console.
    const fascia = rounded(0.42, 0.27, 0.16, 0.032);
    batch.add(fascia, this.soft, [centreX, 0.22, -0.82], [-0.04, -0.15, 0]);
    batch.add(
      rounded(0.295, 0.185, 0.022, 0.016),
      this.gloss,
      [centreX, 0.265, -0.722],
      [-0.04, -0.15, 0],
    );
    batch.add(
      new THREE.BoxGeometry(0.25, 0.004, 0.006),
      this.metal,
      [centreX, 0.166, -0.709],
      [-0.04, -0.15, 0],
    );

    // Physical climate controls in a dark panel below the screen.
    batch.add(
      rounded(0.32, 0.06, 0.04, 0.012),
      this.gloss,
      [centreX, 0.125, -0.704],
      [-0.035, -0.15, 0],
    );
    const knob = new THREE.CylinderGeometry(0.017, 0.02, 0.018, 16);
    for (const dx of [-0.095, 0.095]) {
      const x = centreX + dx;
      batch.add(knob, this.metal, [x, 0.115, -0.677], [Math.PI / 2, -0.15, 0]);
      batch.add(
        new THREE.CylinderGeometry(0.022, 0.022, 0.005, 16),
        this.gloss,
        [x, 0.115, -0.67],
        [Math.PI / 2, -0.15, 0],
      );
    }
    for (let i = 0; i < 3; i += 1) {
      batch.add(
        new THREE.BoxGeometry(0.024, 0.006, 0.006),
        this.metal,
        [centreX - 0.026 + i * 0.026, 0.118, -0.666],
        [-0.04, -0.15, 0],
      );
    }
    batch.add(
      new THREE.BoxGeometry(0.03, 0.003, 0.002),
      this.amber,
      [centreX, 0.14, -0.674],
      [-0.04, -0.15, 0],
    );

    // The fascia flows into the tunnel.
    batch.add(
      rounded(0.3, 0.15, 0.16, 0.026),
      this.soft,
      [centreX, 0.065, -0.78],
      [-0.03, -0.12, 0],
    );

    // Slim rectangular vents with metal surrounds replace the round loops.
    for (const x of [-0.77, 0.77]) {
      batch.add(
        rounded(0.19, 0.07, 0.02, 0.012),
        this.metal,
        [x, 0.282, -0.738],
        [0.07, 0, 0],
      );
      batch.add(
        rounded(0.172, 0.054, 0.022, 0.01),
        this.gloss,
        [x, 0.282, -0.728],
        [0.07, 0, 0],
      );
      batch.add(
        rounded(0.15, 0.038, 0.012, 0.006),
        this.dark,
        [x, 0.282, -0.716],
        [0.07, 0, 0],
      );
      for (const dy of [-0.012, 0, 0.012]) {
        batch.add(
          new THREE.BoxGeometry(0.136, 0.0035, 0.012),
          this.metal,
          [x, 0.282 + dy, -0.708],
          [0.07, 0, 0],
        );
      }
    }

    // Defroster slots and wipers at the base of the screen.
    for (const x of [-0.44, 0.44]) {
      batch.add(new THREE.BoxGeometry(0.38, 0.006, 0.04), this.dark, [x, 0.348, -0.985]);
    }
    for (const x of [-0.36, 0.31]) {
      batch.add(new THREE.BoxGeometry(0.76, 0.012, 0.016), this.dark, [x, 0.363, -1.035], [0, 0, 0.08]);
    }

    batch.flush(this.group, 'dash');
  }

  private buildLowerInterior(): void {
    const batch = new PartBatch();

    // Close the cabin below the dash. Without this floor, firewall and lower
    // door cards the ground is visible through the bottom of the cockpit.
    batch.add(rounded(1.82, 0.035, 1.02, 0.02), this.dark, [0, -0.125, -0.31]);
    batch.add(rounded(1.54, 0.38, 0.06, 0.02), this.dark, [0, 0.03, -0.835]);

    const lowerDoor = rounded(0.05, 0.25, 0.83, 0.02);
    for (const side of [-1, 1] as const) {
      batch.add(lowerDoor, this.soft, [side * 0.952, -0.005, -0.27], [0, side * -0.02, 0]);
    }

    // Footwell side panels close the two corners without making the lower
    // cabin feel like a solid tub.
    batch.add(rounded(0.045, 0.4, 0.44, 0.018), this.soft, [-0.165, 0.03, -0.61]);
    batch.add(rounded(0.045, 0.38, 0.5, 0.018), this.soft, [-0.86, 0.02, -0.59]);

    // Centre tunnel and padded armrest between the seats.
    batch.add(rounded(0.25, 0.22, 0.88, 0.045), this.soft, [0.02, -0.005, -0.31]);
    batch.add(rounded(0.18, 0.035, 0.42, 0.015), this.dark, [0.02, 0.108, -0.46]);

    // Carpet mats sit just proud of the floor.
    batch.add(rounded(0.46, 0.012, 0.42, 0.004), this.soft, [0.37, -0.104, -0.47]);
    batch.add(rounded(0.46, 0.012, 0.42, 0.004), this.soft, [-0.45, -0.104, -0.47]);

    // Rubber-faced pedals sit low in the footwell, behind the knee bolster, so
    // they do not read as silver panels floating beside the wheel.
    const pedalPad = rounded(0.07, 0.14, 0.026, 0.012);
    batch.add(pedalPad, this.dark, [-0.38, 0.045, -0.71], [-0.22, 0, 0]);
    batch.add(rounded(0.05, 0.1, 0.007, 0.003), this.soft, [-0.38, 0.045, -0.694], [-0.22, 0, 0]);
    batch.add(new THREE.BoxGeometry(0.018, 0.14, 0.018), this.dark, [-0.38, 0.12, -0.77], [-0.22, 0, 0]);
    for (let i = -2; i <= 2; i += 1) {
      batch.add(new THREE.BoxGeometry(0.044, 0.005, 0.004), this.metal, [-0.38, 0.045 + i * 0.019, -0.688], [-0.22, 0, 0]);
    }

    batch.add(rounded(0.055, 0.14, 0.026, 0.01), this.dark, [-0.22, 0.04, -0.705], [-0.28, 0, 0.04]);
    batch.add(rounded(0.038, 0.1, 0.007, 0.003), this.soft, [-0.22, 0.04, -0.689], [-0.28, 0, 0.04]);
    batch.add(new THREE.BoxGeometry(0.016, 0.14, 0.016), this.dark, [-0.22, 0.11, -0.78], [-0.26, 0, -0.03]);
    for (let i = -1; i <= 1; i += 1) {
      batch.add(new THREE.BoxGeometry(0.03, 0.005, 0.004), this.metal, [-0.22, 0.04 + i * 0.021, -0.683], [-0.28, 0, 0.04]);
    }

    // Dead pedal nearest the driver's door.
    batch.add(rounded(0.105, 0.11, 0.022, 0.009), this.dark, [-0.64, 0.055, -0.69], [-0.35, 0, -0.12]);
    batch.add(rounded(0.078, 0.075, 0.006, 0.003), this.soft, [-0.64, 0.055, -0.676], [-0.35, 0, -0.12]);

    // Warm footwell lamps and a slim heel strip give the lower cabin some
    // depth without adding real lights to the scene.
    for (const x of [-0.68, -0.13]) {
      batch.add(new THREE.BoxGeometry(0.12, 0.006, 0.006), this.amber, [x, 0.225, -0.77], [-0.03, 0, 0]);
    }
    batch.add(new THREE.BoxGeometry(0.44, 0.008, 0.014), this.accent, [-0.38, -0.095, -0.69]);

    batch.flush(this.group, 'lower-interior');
  }

  private buildCabinShell(): void {
    const batch = new PartBatch();

    // The roof and windscreen header are raised and slimmed. They still frame
    // the view like a real cabin, but no longer swallow the top third of it.
    const roof = rounded(2.06, 0.06, 1.18, 0.026);
    batch.add(roof, this.headliner, [0, 1.095, -0.47], [0.012, 0, 0]);

    // A lighter, inset headliner panel and two longitudinal seams break up the
    // overhead area without adding another material or light source.
    const roofInset = rounded(1.46, 0.014, 0.77, 0.035);
    batch.add(roofInset, this.headlinerInset, [0, 1.058, -0.47], [0.012, 0, 0]);
    for (const x of [-0.73, 0.73]) {
      batch.add(new THREE.BoxGeometry(0.012, 0.006, 1.0), this.soft, [x, 1.061, -0.48]);
    }
    for (const z of [-0.16, -0.47, -0.78]) {
      batch.add(new THREE.BoxGeometry(1.36, 0.004, 0.01), this.soft, [0, 1.046, z]);
    }

    const header = rounded(2.04, 0.075, 0.18, 0.026);
    batch.add(header, this.headliner, [0, 1.03, -1.005], [-0.04, 0, 0]);
    // A deep bridge sits behind the header and under the roof. It closes the
    // thin sky slot that opens above the windscreen when the car pitches up on
    // a steep climb, without lowering the visible header.
    batch.add(rounded(1.98, 0.06, 0.34, 0.018), this.headliner, [0, 1.008, -0.89], [0.01, 0, 0]);
    // A doubled lower lip overlaps the windscreen top.
    batch.add(rounded(1.9, 0.055, 0.1, 0.014), this.headliner, [0, 0.984, -0.987], [-0.03, 0, 0]);
    batch.add(new THREE.BoxGeometry(1.78, 0.012, 0.012), this.accent, [0, 0.986, -0.94]);

    // Close the roof-to-window gap with a continuous side headliner rail. It
    // overlaps the header, A-pillar and window rail so no sky shows through.
    const roofSideRail = rounded(0.065, 0.078, 1.0, 0.014);
    for (const side of [-1, 1] as const) {
      batch.add(roofSideRail, this.headliner, [side * 0.99, 1.026, -0.46], [0.012, 0, side * 0.006]);
    }

    // A smaller overhead console and two slim folded sun visors.
    const overhead = rounded(0.24, 0.04, 0.19, 0.014);
    batch.add(overhead, this.soft, [0, 1.043, -0.77], [-0.035, 0, 0]);
    batch.add(new THREE.BoxGeometry(0.1, 0.016, 0.032), this.headlinerInset, [0, 1.022, -0.724], [-0.04, 0, 0]);
    for (const x of [-0.06, 0, 0.06]) {
      batch.add(new THREE.CircleGeometry(0.009, 10), this.amber, [x, 1.011, -0.713], [Math.PI / 2, 0, 0]);
    }

    const visor = rounded(0.6, 0.022, 0.17, 0.009);
    batch.add(visor, this.soft, [-0.44, 0.994, -0.885], [-0.05, 0.025, 0.025]);
    batch.add(visor, this.soft, [0.44, 0.994, -0.885], [-0.05, -0.025, -0.025]);
    for (const x of [-0.44, 0.44]) {
      batch.add(new THREE.BoxGeometry(0.026, 0.032, 0.028), this.metal, [x, 1.005, -0.97], [-0.04, 0, 0]);
    }

    // Slim A-pillars with a bright inner trim bar: the strip that separates
    // the windscreen from the side window.
    const pillar = rounded(0.05, 0.67, 0.085, 0.014);
    const frontPost = rounded(0.034, 0.52, 0.04, 0.01);
    for (const side of [-1, 1] as const) {
      batch.add(pillar, this.dark, [side * 0.94, 0.742, -0.955], [0, side * -0.08, side * -0.1]);

      // A dark front window post gives the glass a continuous frame without the
      // bright loose-looking decorative strip.
      batch.add(frontPost, this.soft, [side * 0.991, 0.78, -0.895], [0, 0, side * 0.01]);

      // Side-window frame: top rail, belt line and the small quarter post.
      const rail = rounded(0.032, 0.034, 0.84, 0.009);
      batch.add(rail, this.soft, [side * 0.991, 0.995, -0.455], [0, 0, side * 0.006]);
      batch.add(rail, this.soft, [side * 0.991, 0.552, -0.455], [0, 0, side * 0.006]);
      const quarterPost = rounded(0.032, 0.43, 0.032, 0.009);
      batch.add(quarterPost, this.soft, [side * 0.991, 0.78, -0.085], [0, 0, side * 0.01]);
    }

    // Door cards sit lower than before, leaving the side glass open and the
    // pillars slender instead of framing the view with two black slabs.
    const door = rounded(0.08, 0.43, 0.93, 0.025);
    for (const side of [-1, 1] as const) {
      batch.add(door, this.soft, [side * 0.982, 0.305, -0.25], [0, side * -0.05, side * 0.025]);
      const sill = rounded(0.06, 0.048, 0.77, 0.014);
      batch.add(sill, this.accent, [side * 0.944, 0.538, -0.27], [0, side * -0.02, 0]);
      const armrest = rounded(0.12, 0.05, 0.43, 0.022);
      batch.add(armrest, this.soft, [side * 0.892, 0.37, -0.22]);
      const doorHandle = rounded(0.12, 0.026, 0.058, 0.012);
      batch.add(doorHandle, this.metal, [side * 0.925, 0.515, -0.17], [0, side * 0.1, 0]);
      batch.add(
        new THREE.BoxGeometry(0.008, 0.006, 0.62),
        this.amber,
        [side * 0.939, 0.512, -0.24],
      );
    }

    batch.flush(this.group, 'shell');

    // Laminated windscreen and properly framed side glass. A faint sky/cloud
    // reflection makes the openings read as glass rather than missing panels.
    const windshieldGlass = new THREE.MeshBasicMaterial({
      map: this.glassTexture,
      color: 0xe8f2ee,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.84, 0.62), windshieldGlass);
    windshield.position.set(0, 0.688, -0.992);
    windshield.rotation.x = -0.02;
    windshield.renderOrder = 2;
    windshield.frustumCulled = false;
    this.group.add(windshield);

    const sideGlass = new THREE.MeshBasicMaterial({
      map: this.glassTexture,
      color: 0xbfd3cf,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (const side of [-1, 1] as const) {
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.41), sideGlass);
      glass.position.set(side * 0.99, 0.785, -0.455);
      glass.rotation.y = side * Math.PI / 2;
      glass.renderOrder = 2;
      glass.frustumCulled = false;
      this.group.add(glass);
    }
  }

  private buildMirrors(): void {
    const mirrorTexture = this.makeMirrorTexture(false);
    const sideTexture = this.makeMirrorTexture(true);

    const mirrorGroup = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.065, 0.034), this.dark);
    housing.position.set(0, 0.885, -1.015);
    housing.rotation.x = -0.04;
    mirrorGroup.add(housing);

    const mirror = new THREE.Mesh(
      new THREE.PlaneGeometry(0.208, 0.043),
      new THREE.MeshBasicMaterial({ map: mirrorTexture, toneMapped: false }),
    );
    mirror.position.set(0, 0.885, -0.995);
    mirror.rotation.x = -0.04;
    mirrorGroup.add(mirror);

    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.085, 0.022), this.dark);
    stem.position.set(0, 0.94, -1.035);
    stem.rotation.x = -0.18;
    mirrorGroup.add(stem);

    // Driver's side mirror: the housing, door foot and angled arm are all
    // visible so it reads as a mounted mirror rather than a floating screen.
    const leftHousing = new THREE.Mesh(rounded(0.16, 0.075, 0.085, 0.018), this.dark);
    leftHousing.position.set(-0.945, 0.59, -0.785);
    leftHousing.rotation.y = 0.22;
    mirrorGroup.add(leftHousing);

    const mirrorFoot = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.022, 0.06), this.dark);
    mirrorFoot.position.set(-0.973, 0.518, -0.785);
    mirrorGroup.add(mirrorFoot);

    const mirrorArm = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.1, 0.04), this.dark);
    mirrorArm.position.set(-0.957, 0.562, -0.785);
    mirrorArm.rotation.z = -0.34;
    mirrorGroup.add(mirrorArm);

    const leftGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.132, 0.052),
      new THREE.MeshBasicMaterial({ map: sideTexture, color: 0xaab7b2, toneMapped: false }),
    );
    leftGlass.position.set(-0.945, 0.59, -0.741);
    leftGlass.rotation.y = 0.22;
    mirrorGroup.add(leftGlass);

    mirrorGroup.name = 'mirrors';
    mirrorGroup.traverse((object) => {
      object.frustumCulled = false;
    });
    this.group.add(mirrorGroup);
  }

  private makeMirrorTexture(side: boolean): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is unavailable');

    const sky = ctx.createLinearGradient(0, 0, 0, 48);
    sky.addColorStop(0, '#7fbee3');
    sky.addColorStop(1, '#dbe9df');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 256, 96);

    ctx.fillStyle = '#6b9253';
    ctx.beginPath();
    ctx.moveTo(0, 46);
    ctx.quadraticCurveTo(58, 30, 122, 45);
    ctx.quadraticCurveTo(188, 58, 256, 38);
    ctx.lineTo(256, 60);
    ctx.lineTo(0, 60);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#555b57';
    ctx.fillRect(0, 55, 256, 10);
    const road = ctx.createLinearGradient(0, 55, 0, 96);
    road.addColorStop(0, '#77746b');
    road.addColorStop(1, '#3f4140');
    ctx.fillStyle = road;
    ctx.beginPath();
    ctx.moveTo(82, 54);
    ctx.lineTo(174, 54);
    ctx.lineTo(238, 96);
    ctx.lineTo(18, 96);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(250,242,210,0.65)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(166, 54);
    ctx.lineTo(179, 96);
    ctx.stroke();

    if (side) {
      ctx.fillStyle = 'rgba(15,18,20,0.52)';
      ctx.fillRect(0, 0, 12, 96);
      ctx.fillRect(244, 0, 12, 96);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2;
    if (side) texture.offset.y = 0.15;
    return texture;
  }

  private buildScreens(): void {
    const cluster = new THREE.Mesh(
      new THREE.PlaneGeometry(0.452, 0.176),
      new THREE.MeshBasicMaterial({ map: this.clusterTexture, toneMapped: false }),
    );
    cluster.position.set(DRIVER_X, 0.396, -0.727);
    cluster.rotation.x = -0.055;
    cluster.name = 'analogue-cluster';
    cluster.frustumCulled = false;
    this.group.add(cluster);

    // Physical chrome bezels and a glass face turn the three dial faces into a
    // proper instrument binnacle instead of a flat in-dash display.
    const sideRing = new THREE.TorusGeometry(0.058, 0.0033, 8, 32);
    const centreRing = new THREE.TorusGeometry(0.064, 0.0036, 8, 32);
    for (const dx of [-0.1483, 0.1483]) {
      const ring = new THREE.Mesh(sideRing, this.metal);
      ring.position.set(DRIVER_X + dx, 0.3995, -0.718);
      ring.rotation.x = -0.055;
      ring.frustumCulled = false;
      this.group.add(ring);
    }
    const tachRing = new THREE.Mesh(centreRing, this.metal);
    tachRing.position.set(DRIVER_X, 0.4022, -0.718);
    tachRing.rotation.x = -0.055;
    tachRing.frustumCulled = false;
    this.group.add(tachRing);
    const clusterGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.442, 0.172),
      new THREE.MeshBasicMaterial({
        map: this.glassTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    clusterGlass.position.set(DRIVER_X, 0.396, -0.712);
    clusterGlass.rotation.x = -0.055;
    clusterGlass.renderOrder = 3;
    clusterGlass.frustumCulled = false;
    this.group.add(clusterGlass);

    const nav = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.152),
      new THREE.MeshBasicMaterial({ map: this.navTexture, toneMapped: false }),
    );
    nav.position.set(0.16, 0.265, -0.705);
    nav.rotation.set(-0.04, -0.15, 0);
    nav.renderOrder = 3;
    nav.name = 'navigation-screen';
    nav.frustumCulled = false;
    this.group.add(nav);

    const navGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.258, 0.15),
      new THREE.MeshBasicMaterial({
        map: this.glassTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    navGlass.position.set(0.16, 0.265, -0.699);
    navGlass.rotation.set(-0.04, -0.15, 0);
    navGlass.renderOrder = 4;
    navGlass.frustumCulled = false;
    this.group.add(navGlass);
  }

  private buildSteeringWheel(): void {
    const wheel = new THREE.Group();
    // Left-hand drive, slightly further forward and lower so the instrument
    // faces and the unit readout stay clear of the rim.
    wheel.position.set(DRIVER_X, 0.15, -0.55);
    wheel.rotation.x = -0.28;
    wheel.name = 'steering-wheel';
    this.group.add(wheel);

    this.spin.name = 'steering-wheel-spin';
    wheel.add(this.spin);

    const batch = new PartBatch();

    // Rim, hub and three spokes.
    batch.add(new THREE.TorusGeometry(0.174, 0.022, 10, 44), this.leather, [0, 0, 0]);

    const sideSpoke = rounded(0.118, 0.026, 0.015, 0.011);
    batch.add(sideSpoke, this.leather, [-0.077, 0.004, 0.006], [0, 0, 0.035]);
    batch.add(sideSpoke, this.leather, [0.077, 0.004, 0.006], [0, 0, -0.035]);
    const lowerSpoke = rounded(0.03, 0.104, 0.015, 0.011);
    batch.add(lowerSpoke, this.leather, [0, -0.073, 0.006]);

    // A dark horn pad with a bright trim ring, like a real leather wheel.
    batch.add(new THREE.CylinderGeometry(0.05, 0.053, 0.032, 20), this.leather, [0, 0, 0], [Math.PI / 2, 0, 0]);
    batch.add(new THREE.TorusGeometry(0.047, 0.0045, 8, 24), this.metal, [0, 0, 0.017]);
    batch.add(new THREE.CylinderGeometry(0.031, 0.031, 0.034, 16), this.leather, [0, 0, 0.002], [Math.PI / 2, 0, 0]);
    batch.add(new THREE.CircleGeometry(0.012, 12), this.amber, [0, 0, 0.022]);

    // Dark switch panels with silver buttons on each spoke.
    const buttonPod = rounded(0.072, 0.022, 0.012, 0.006);
    const button = rounded(0.014, 0.008, 0.006, 0.002);
    for (const x of [-0.078, 0.078]) {
      batch.add(buttonPod, this.gloss, [x, 0.004, 0.014]);
      for (let i = -1; i <= 1; i += 1) {
        batch.add(button, this.metal, [x + i * 0.018, 0.004, 0.021]);
      }
    }
    batch.add(new THREE.BoxGeometry(0.026, 0.007, 0.009), this.amber, [0, 0.171, 0.005]);

    // Paddle shifters, just visible behind the spokes.
    batch.add(rounded(0.14, 0.018, 0.065, 0.008), this.dark, [-0.16, 0.07, -0.04], [0.2, 0, 0.2]);
    batch.add(rounded(0.14, 0.018, 0.065, 0.008), this.dark, [0.16, 0.07, -0.04], [0.2, 0, -0.2]);

    // Hands wrap the rim at three and nine. Fingers point in across the rim,
    // with a cuff and forearm falling out of frame below the dash.
    // Hands sit low at three and nine, framing the wheel below the cluster.
    const palm = rounded(0.06, 0.09, 0.038, 0.019);
    const finger = rounded(0.05, 0.014, 0.028, 0.006);
    const thumb = rounded(0.02, 0.05, 0.027, 0.01);
    const cuff = rounded(0.076, 0.046, 0.058, 0.017);
    for (const side of [-1, 1]) {
      const palmX = side * 0.158;
      batch.add(palm, this.skin, [palmX, 0.04, 0.032], [-0.08, side * 0.12, side * -0.18]);
      for (let i = 0; i < 4; i++) {
        batch.add(
          finger,
          this.skin,
          [side * 0.122, -0.005 + i * 0.022, 0.052],
          [0.03, side * 0.08, side * -0.1],
        );
      }
      batch.add(thumb, this.skin, [side * 0.139, 0.105, 0.052], [0.04, side * 0.12, side * -0.6]);
      batch.add(cuff, this.sleeve, [palmX + side * 0.012, -0.06, 0.022], [0.05, 0, side * -0.08]);

      const arm = new THREE.CylinderGeometry(0.056, 0.084, 0.34, 8);
      batch.add(arm, this.sleeve, [palmX + side * 0.02, -0.2, 0.022], [2.72, 0, side * -0.12]);
    }

    batch.flush(this.spin, 'wheel');

    // Keep the column slim: the wide old shroud filled the footwell opening
    // and hid the pedals from the driving eye line.
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.036, 0.17, 12),
      this.dark,
    );
    column.rotation.x = Math.PI / 2;
    column.position.set(0, 0.015, -0.115);
    column.frustumCulled = false;
    wheel.add(column);
  }

  // ----------------------------------------------------------------- visual

  update(state: CockpitState, dt: number): void {
    const steer = THREE.MathUtils.clamp(state.steering / 0.54, -1, 1);
    this.spin.rotation.z = damp(this.spin.rotation.z, -steer * 1.15, 8, dt);

    this.screenTimer -= dt;
    if (this.screenTimer > 0) return;
    this.screenTimer = 0.06;

    const bucket = Math.round(state.speedKmh / 1.5);
    const key = `${bucket}:${state.gear}:${Math.round(state.rpm / 40)}:${state.units}:${Math.round(state.nextGateDistance / 5)}`;
    if (key !== this.clusterKey.value) {
      this.clusterKey.value = key;
      this.drawCluster(state);
    }

    const navKey = `${Math.round(state.mapX / 12)}:${Math.round(state.mapZ / 12)}:${Math.round(state.heading * 40)}:${Math.round(state.nextGateDistance / 5)}`;
    if (navKey !== this.navKey.value) {
      this.navKey.value = navKey;
      this.drawNav(state);
    }
  }

  private roundedPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private gaugeAngle(ratio: number): number {
    return (135 + THREE.MathUtils.clamp(ratio, 0, 1) * 270) * (Math.PI / 180);
  }

  private drawGauge(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    kind: 'speed' | 'tach' | 'fuel',
    units: Units,
  ): void {
    const outer = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    outer.addColorStop(0, '#d3cbbb');
    outer.addColorStop(0.35, '#626b6b');
    outer.addColorStop(0.7, '#272e2f');
    outer.addColorStop(1, '#8b8d83');
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = outer;
    ctx.fill();

    const face = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.35, 4, cx, cy, radius);
    face.addColorStop(0, '#20282a');
    face.addColorStop(0.56, '#0f1517');
    face.addColorStop(1, '#070a0b');
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 9, 0, Math.PI * 2);
    ctx.fillStyle = face;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const maxValue = kind === 'speed' ? (units === 'mph' ? 160 : 280) : kind === 'tach' ? 8 : 1;
    const majorStep = kind === 'speed' ? (units === 'mph' ? 20 : 40) : kind === 'tach' ? 1 : 0.25;
    const majorCount = Math.round(maxValue / majorStep);
    const minorPerMajor = kind === 'fuel' ? 2 : 4;
    const totalTicks = majorCount * minorPerMajor;

    if (kind === 'tach') {
      const redStart = this.gaugeAngle(6.5 / maxValue);
      const redEnd = this.gaugeAngle(1);
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 21, redStart, redEnd);
      ctx.strokeStyle = 'rgba(255,112,80,0.72)';
      ctx.lineWidth = 5;
      ctx.stroke();
    }

    for (let i = 0; i <= totalTicks; i += 1) {
      const ratio = i / totalTicks;
      const angle = this.gaugeAngle(ratio);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const major = i % minorPerMajor === 0;
      const outerR = radius - 17;
      const innerR = major ? radius - 34 : radius - 27;
      ctx.beginPath();
      ctx.moveTo(cx + cos * innerR, cy + sin * innerR);
      ctx.lineTo(cx + cos * outerR, cy + sin * outerR);
      ctx.strokeStyle = major ? 'rgba(244,239,224,0.82)' : 'rgba(244,239,224,0.32)';
      ctx.lineWidth = major ? 3 : 1.4;
      ctx.stroke();

      if (major) {
        let label = '';
        if (kind === 'fuel') {
          if (i === 0) label = 'E';
          else if (i === majorCount / 2) label = '½';
          else if (i === majorCount) label = 'F';
        } else {
          label = String(Math.round(ratio * maxValue));
        }
        if (!label) continue;
        const labelR = radius - 54;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(246,241,225,0.82)';
        ctx.font = '600 23px "Barlow Condensed", "Arial Narrow", sans-serif';
        ctx.fillText(label, cx + cos * labelR, cy + sin * labelR);
      }
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.46)';
    ctx.font = '500 16px "IBM Plex Mono", monospace';
    ctx.fillText(
      kind === 'speed' ? (units === 'mph' ? 'MPH' : 'KM/H') : kind === 'tach' ? 'x1000 RPM' : 'FUEL',
      cx,
      cy + radius * 0.48,
    );
  }

  private renderGaugeFace(units: Units): void {
    const ctx = this.clusterFaceCanvas.getContext('2d');
    if (!ctx) return;
    const w = this.clusterFaceCanvas.width;
    const h = this.clusterFaceCanvas.height;

    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#111719');
    bg.addColorStop(0.55, '#090e10');
    bg.addColorStop(1, '#050809');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const edge = ctx.createLinearGradient(0, 0, 0, 34);
    edge.addColorStop(0, 'rgba(255,255,255,0.05)');
    edge.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, w, 34);

    this.drawGauge(ctx, 180, 192, 132, 'speed', units);
    this.drawGauge(ctx, 512, 186, 146, 'tach', units);
    this.drawGauge(ctx, 844, 192, 132, 'fuel', units);

    // The lower rail carries the readouts that don't belong on a gauge face.
    this.roundedPath(ctx, 176, 344, 672, 46, 16);
    const rail = ctx.createLinearGradient(0, 344, 0, 390);
    rail.addColorStop(0, '#111b1b');
    rail.addColorStop(1, '#060d0e');
    ctx.fillStyle = rail;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    for (const x of [400, 624]) {
      ctx.beginPath();
      ctx.moveTo(x, 354);
      ctx.lineTo(x, 380);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    ctx.fillText('SPEED', 288, 357);
    ctx.fillText('GEAR', 512, 357);
    ctx.fillText('NEXT GATE', 736, 357);

    this.clusterUnits = units;
  }

  private drawNeedle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    ratio: number,
    color: string,
  ): void {
    const angle = this.gaugeAngle(ratio);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(cx - cos * 13, cy - sin * 13);
    ctx.lineTo(cx + cos * (radius - 34), cy + sin * (radius - 34));
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1c2223';
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.24)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawCluster(state: CockpitState): void {
    const ctx = this.clusterCanvas.getContext('2d');
    if (!ctx) return;

    if (this.clusterUnits !== state.units) this.renderGaugeFace(state.units);
    ctx.clearRect(0, 0, this.clusterCanvas.width, this.clusterCanvas.height);
    ctx.drawImage(this.clusterFaceCanvas, 0, 0);

    const speedMax = state.units === 'mph' ? 160 : 280;
    const speed = displaySpeed(state.speedKmh, state.units);
    this.drawNeedle(ctx, 180, 192, 132, speed / speedMax, '#ffb575');
    this.drawNeedle(ctx, 512, 186, 146, state.rpm / 8000, '#d9eee3');
    this.drawNeedle(ctx, 844, 192, 132, 0.68, '#d9eee3');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff8e8';
    ctx.font = '700 27px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.fillText(String(speed), 288, 380);

    ctx.fillStyle = '#ffbe7c';
    ctx.font = '600 28px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.fillText(state.gear, 512, 380);

    ctx.fillStyle = '#fff8e8';
    ctx.font = '600 25px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.fillText(formatDistance(Math.max(0, state.nextGateDistance)), 736, 380);

    this.clusterTexture.needsUpdate = true;
  }

  private projectMap(x: number, z: number): [number, number] {
    const { minX, maxX, minZ, maxZ } = this.mapData.bounds;
    const mapRect = { x: 18, y: 80, width: 732, height: 310 };
    const padding = 16;
    const scale = Math.min(
      (mapRect.width - padding * 2) / Math.max(1, maxX - minX),
      (mapRect.height - padding * 2) / Math.max(1, maxZ - minZ),
    );
    const left = mapRect.x + (mapRect.width - (maxX - minX) * scale) / 2;
    const top = mapRect.y + (mapRect.height - (maxZ - minZ) * scale) / 2;
    return [left + (x - minX) * scale, top + (z - minZ) * scale];
  }

  private mapJunctionCenter(): [number, number] | null {
    const ring = this.mapData.junctions.find((road) => road.id === 'roundabout-ring');
    if (!ring || ring.points.length === 0) return null;
    const x = ring.points.reduce((sum, [px]) => sum + px, 0) / ring.points.length;
    const z = ring.points.reduce((sum, [, pz]) => sum + pz, 0) / ring.points.length;
    return this.projectMap(x, z);
  }

  private traceMapPath(
    ctx: CanvasRenderingContext2D,
    points: Array<[number, number]>,
    close = true,
  ): void {
    ctx.beginPath();
    points.forEach(([x, z], index) => {
      const [px, py] = this.projectMap(x, z);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    if (close) ctx.closePath();
  }

  private renderNavBase(): void {
    const ctx = this.navBaseCanvas.getContext('2d');
    if (!ctx) return;
    const w = this.navBaseCanvas.width;
    const h = this.navBaseCanvas.height;
    const mapRect = { x: 18, y: 80, width: 732, height: 310 };

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0c1717');
    bg.addColorStop(1, '#050c0d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#ffb46e';
    ctx.fillRect(23, 28, 24, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    ctx.font = '500 14px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('COASTLINE NAV', 57, 30);
    ctx.fillStyle = '#f2ecde';
    ctx.font = '600 32px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.fillText('HALCYON ISLAND', 23, 59);

    ctx.save();
    this.roundedPath(ctx, mapRect.x, mapRect.y, mapRect.width, mapRect.height, 13);
    ctx.clip();
    const ocean = ctx.createLinearGradient(0, mapRect.y, 0, mapRect.y + mapRect.height);
    ocean.addColorStop(0, '#0a2228');
    ocean.addColorStop(1, '#07191e');
    ctx.fillStyle = ocean;
    ctx.fillRect(mapRect.x, mapRect.y, mapRect.width, mapRect.height);

    ctx.strokeStyle = 'rgba(126,184,180,0.09)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i += 1) {
      const y = mapRect.y + (mapRect.height / 6) * i;
      ctx.beginPath();
      ctx.moveTo(mapRect.x, y);
      ctx.lineTo(mapRect.x + mapRect.width, y);
      ctx.stroke();
    }
    for (let i = 1; i < 7; i += 1) {
      const x = mapRect.x + (mapRect.width / 7) * i;
      ctx.beginPath();
      ctx.moveTo(x, mapRect.y);
      ctx.lineTo(x, mapRect.y + mapRect.height);
      ctx.stroke();
    }

    this.traceMapPath(ctx, this.mapData.coastline);
    ctx.fillStyle = '#294437';
    ctx.fill();
    ctx.strokeStyle = 'rgba(163,186,153,0.72)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.save();
    ctx.translate(mapRect.x + mapRect.width / 2, mapRect.y + mapRect.height / 2);
    ctx.scale(1.045, 1.045);
    ctx.translate(-(mapRect.x + mapRect.width / 2), -(mapRect.y + mapRect.height / 2));
    ctx.globalAlpha = 0.35;
    this.traceMapPath(ctx, this.mapData.coastline);
    ctx.strokeStyle = '#6d9a8a';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();

    this.traceMapPath(ctx, this.mapData.route);
    ctx.strokeStyle = 'rgba(3,12,11,0.9)';
    ctx.lineWidth = 17;
    ctx.lineJoin = 'round';
    ctx.stroke();
    this.traceMapPath(ctx, this.mapData.route);
    ctx.strokeStyle = '#f1d8ad';
    ctx.lineWidth = 9;
    ctx.stroke();
    this.traceMapPath(ctx, this.mapData.route);
    ctx.strokeStyle = 'rgba(228,146,83,0.85)';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 10]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const road of this.mapData.junctions) {
      const close = road.id === 'roundabout-ring';
      this.traceMapPath(ctx, road.points, close);
      ctx.strokeStyle = 'rgba(3,12,11,0.92)';
      ctx.lineWidth = 10;
      ctx.stroke();

      this.traceMapPath(ctx, road.points, close);
      ctx.strokeStyle = road.kind === 'skyway' ? '#e8cfa3' : '#d9b77e';
      ctx.lineWidth = 4;
      ctx.setLineDash(road.kind === 'skyway' ? [6, 5] : []);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.restore();

    this.roundedPath(ctx, mapRect.x, mapRect.y, mapRect.width, mapRect.height, 13);
    ctx.strokeStyle = 'rgba(205,224,201,0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = 'rgba(7,20,21,0.86)';
    this.roundedPath(ctx, mapRect.x + mapRect.width - 68, mapRect.y + 14, 48, 48, 9);
    ctx.fill();
    ctx.strokeStyle = 'rgba(224,235,215,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(241,235,214,0.82)';
    ctx.beginPath();
    ctx.moveTo(mapRect.x + mapRect.width - 44, mapRect.y + 25);
    ctx.lineTo(mapRect.x + mapRect.width - 38, mapRect.y + 46);
    ctx.lineTo(mapRect.x + mapRect.width - 44, mapRect.y + 41);
    ctx.lineTo(mapRect.x + mapRect.width - 50, mapRect.y + 46);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(218,232,218,0.48)';
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', mapRect.x + mapRect.width - 44, mapRect.y + 54);

    // A small speed/scale caption along the bottom of the display.
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(210,230,216,0.34)';
    ctx.font = '500 12px "IBM Plex Mono", monospace';
    ctx.fillText('JCT · INTERCHANGE', 20, h - 20);
    ctx.textAlign = 'right';
    ctx.fillText('GPS · NORTH UP', w - 20, h - 20);

    this.navTexture.needsUpdate = true;
  }

  private drawJunctionCallout(ctx: CanvasRenderingContext2D): void {
    const junction = this.mapJunctionCenter();
    if (!junction) return;
    const [x, y] = junction;

    ctx.save();
    ctx.fillStyle = 'rgba(7,20,21,0.92)';
    ctx.strokeStyle = '#ffc17d';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 5, 0.2, Math.PI * 1.7);
    ctx.stroke();
    ctx.fillStyle = '#ffc17d';
    ctx.beginPath();
    ctx.arc(x + 3, y - 3, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,240,215,0.9)';
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('JCT', x + 22, y - 17);
    ctx.restore();
  }

  private drawNav(state: Pick<CockpitState, 'mapX' | 'mapZ' | 'heading' | 'nextGateDistance'>): void {
    const ctx = this.navCanvas.getContext('2d');
    if (!ctx) return;
    const w = this.navCanvas.width;
    const h = this.navCanvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.navBaseCanvas, 0, 0);

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '500 12px "IBM Plex Mono", monospace';
    ctx.fillText('NEXT GATE', w - 23, 28);
    ctx.fillStyle = '#ffc17d';
    ctx.font = '600 32px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.fillText(formatDistance(Math.max(0, state.nextGateDistance)), w - 23, 58);

    const [x, y] = this.projectMap(state.mapX, state.mapZ);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(4,12,12,0.9)';
    ctx.strokeStyle = 'rgba(255,240,211,0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 23, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,180,110,0.34)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 31, 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate(state.heading);
    ctx.shadowColor = 'rgba(255,180,110,0.9)';
    ctx.shadowBlur = 13;
    ctx.fillStyle = '#ffb46e';
    ctx.strokeStyle = '#fff4dc';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(10, 12);
    ctx.lineTo(0, 7);
    ctx.lineTo(-10, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    this.drawJunctionCallout(ctx);
    this.navTexture.needsUpdate = true;
  }
}
