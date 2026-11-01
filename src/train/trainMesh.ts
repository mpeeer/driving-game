import * as THREE from 'three';
import { TrainDef } from '../content/data';
import { TrackPath } from '../world/trackPlan';
import { TrainSim } from './trainSim';
import { clamp } from '../core/util';
import { canvasTexture, glowTexture } from '../world/textures';

interface DoorPanel {
  mesh: THREE.Mesh;
  baseZ: number;
  slideDir: number;
}

interface CarVisual {
  group: THREE.Group;
  doorPanels: DoorPanel[];
  headlights: THREE.Mesh[];
  taillights: THREE.Mesh[];
  headGlows: THREE.Sprite[];
  tailGlows: THREE.Sprite[];
}

export interface TrainRenderState {
  lineCode: string;
  lineColor: string;
  destination: string;
  night: number;
  cabView: boolean;
}

export class TrainMesh {
  group = new THREE.Group();
  def: TrainDef;
  cars: CarVisual[] = [];
  cabGroup: THREE.Group;
  private headlightSpots: THREE.SpotLight[] = [];
  private bodyMat: THREE.MeshStandardMaterial;
  private accentMat: THREE.MeshStandardMaterial;
  private roofMat: THREE.MeshStandardMaterial;
  private glassMat: THREE.MeshStandardMaterial;
  private darkMat: THREE.MeshStandardMaterial;
  private steelMat: THREE.MeshStandardMaterial;
  private interiorMat: THREE.MeshStandardMaterial;
  private wheelMat: THREE.MeshStandardMaterial;
  private speedCanvas: HTMLCanvasElement;
  private speedCtx: CanvasRenderingContext2D;
  private speedTex: THREE.CanvasTexture;
  private infoCanvas: HTMLCanvasElement;
  private infoCtx: CanvasRenderingContext2D;
  private infoTex: THREE.CanvasTexture;
  private dashCanvas: HTMLCanvasElement;
  private dashCtx: CanvasRenderingContext2D;
  private dashTex: THREE.CanvasTexture;
  private destTex: THREE.CanvasTexture;
  private destCanvas: HTMLCanvasElement;
  private destCtx: CanvasRenderingContext2D;
  private doorPanelsAll: DoorPanel[] = [];
  private wiperPivots: THREE.Group[] = [];
  private disposeList: (THREE.BufferGeometry | THREE.Material)[] = [];
  private displayTimer = 0;
  private throttleLever?: THREE.Group;
  private brakeLever?: THREE.Group;
  private cabLight?: THREE.MeshStandardMaterial;
  private lineCode = 'M1';
  private destination = 'Harbour Loop';
  private lineColor = '#4da3ff';

  constructor(def: TrainDef) {
    this.def = def;
    this.group.name = 'train';
    this.bodyMat = new THREE.MeshStandardMaterial({ color: def.bodyColor, roughness: 0.4, metalness: 0.28 });
    this.accentMat = new THREE.MeshStandardMaterial({ color: def.accentColor, roughness: 0.42, metalness: 0.2 });
    this.roofMat = new THREE.MeshStandardMaterial({ color: def.roofColor, roughness: 0.78, metalness: 0.25 });
    this.glassMat = new THREE.MeshStandardMaterial({ color: 0x101b25, roughness: 0.1, metalness: 0.55 });
    this.darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1f25, roughness: 0.6, metalness: 0.4 });
    this.steelMat = new THREE.MeshStandardMaterial({ color: 0x6c747c, roughness: 0.4, metalness: 0.75 });
    this.interiorMat = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, roughness: 0.85 });
    this.wheelMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.65, metalness: 0.55 });
    this.disposeList.push(this.bodyMat, this.accentMat, this.roofMat, this.glassMat, this.darkMat, this.steelMat, this.interiorMat, this.wheelMat);

    const carLen = def.carLength;
    const gap = 0.7;
    for (let i = 0; i < def.cars; i++) {
      const car = this.buildCar(i, def.cars);
      car.group.position.z = 0;
      this.cars.push(car);
      this.group.add(car.group);
    }

    // Couplers
    const couplerGeo = new THREE.BoxGeometry(0.35, 0.42, 0.9);
    this.disposeList.push(couplerGeo);
    for (let i = 0; i < def.cars - 1; i++) {
      const m = new THREE.Mesh(couplerGeo, this.darkMat);
      m.position.set(0, 1.1, -(i + 1) * (carLen + gap) + gap / 2);
      m.castShadow = true;
      this.group.add(m);
    }

    // Cab interior in the lead car.
    this.speedCanvas = document.createElement('canvas');
    this.speedCanvas.width = 320;
    this.speedCanvas.height = 200;
    this.speedCtx = this.speedCanvas.getContext('2d')!;
    this.speedTex = canvasTexture(this.speedCanvas);

    this.infoCanvas = document.createElement('canvas');
    this.infoCanvas.width = 320;
    this.infoCanvas.height = 200;
    this.infoCtx = this.infoCanvas.getContext('2d')!;
    this.infoTex = canvasTexture(this.infoCanvas);

    this.dashCanvas = document.createElement('canvas');
    this.dashCanvas.width = 512;
    this.dashCanvas.height = 128;
    this.dashCtx = this.dashCanvas.getContext('2d')!;
    this.dashTex = canvasTexture(this.dashCanvas);

    this.destCanvas = document.createElement('canvas');
    this.destCanvas.width = 512;
    this.destCanvas.height = 128;
    this.destCtx = this.destCanvas.getContext('2d')!;
    this.destTex = canvasTexture(this.destCanvas);

    this.cabGroup = new THREE.Group();
    this.cabGroup.name = 'cab';
    this.buildCab();
    this.cabGroup.visible = false;
    this.cars[0].group.add(this.cabGroup);

    // Lead car headlight spotlights
    for (let i = 0; i < 2; i++) {
      const spot = new THREE.SpotLight(0xfff3d0, 0, 170, 0.42, 0.5, 1.2);
      spot.position.set(i === 0 ? -0.95 : 0.95, 1.75, carLen / 2 + 0.2);
      spot.target.position.set(i === 0 ? -0.9 : 0.9, 0.2, 90);
      spot.castShadow = false;
      this.cars[0].group.add(spot);
      this.cars[0].group.add(spot.target);
      this.headlightSpots.push(spot);
    }
  }

  private buildCar(index: number, totalCars: number): CarVisual {
    const def = this.def;
    const L = def.carLength;
    const group = new THREE.Group();
    group.name = `car-${index}`;

    // Body shell from a rounded cross-section.
    const halfW = 1.45;
    const floor = 0.92;
    const roof = 3.9;
    const r = 0.5;
    const shape = new THREE.Shape();
    shape.moveTo(-halfW, floor);
    shape.lineTo(halfW, floor);
    shape.lineTo(halfW, roof - r);
    shape.quadraticCurveTo(halfW, roof, halfW - r, roof);
    shape.lineTo(-halfW + r, roof);
    shape.quadraticCurveTo(-halfW, roof, -halfW, roof - r);
    shape.lineTo(-halfW, floor);
    const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false, curveSegments: 5 });
    bodyGeo.translate(0, 0, -L / 2);
    const body = new THREE.Mesh(bodyGeo, this.bodyMat);
    body.castShadow = true;
    body.receiveShadow = true;
    this.disposeList.push(bodyGeo);
    group.add(body);

    // Roof panel
    const roofGeo = new THREE.BoxGeometry(2.5, 0.06, L * 0.96);
    const roofMesh = new THREE.Mesh(roofGeo, this.roofMat);
    roofMesh.position.y = roof + 0.02;
    this.disposeList.push(roofGeo);
    group.add(roofMesh);

    // Livery band
    const bandGeo = new THREE.BoxGeometry(0.03, 0.24, L * 0.94);
    this.disposeList.push(bandGeo);
    for (const side of [-1, 1]) {
      const band = new THREE.Mesh(bandGeo, this.accentMat);
      band.position.set(side * (halfW + 0.012), 1.62, 0);
      group.add(band);
      const thin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, L * 0.94), this.darkMat);
      thin.position.set(side * (halfW + 0.015), 1.86, 0);
      this.disposeList.push(thin.geometry);
      group.add(thin);
    }

    // Windows, split by door positions.
    const doors = [-0.3, 0.3];
    const winMat = new THREE.MeshStandardMaterial({ color: 0x0d1721, roughness: 0.12, metalness: 0.5, transparent: true, opacity: 0.94 });
    this.disposeList.push(winMat);
    for (const side of [-1, 1]) {
      for (let seg = 0; seg < 3; seg++) {
        const z0 = -L / 2 + L * (0.06 + seg * 0.3);
        const z1 = z0 + L * 0.18;
        const zc = (z0 + z1) / 2;
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.035, 1.02, z1 - z0), winMat);
        win.position.set(side * (halfW + 0.012), 2.78, zc);
        this.disposeList.push(win.geometry);
        group.add(win);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.14, z1 - z0 + 0.14), this.darkMat);
        frame.position.set(side * (halfW + 0.005), 2.78, zc);
        this.disposeList.push(frame.geometry);
        group.add(frame);
      }
    }

    const doorPanels: DoorPanel[] = [];
    const panelGeo = new THREE.BoxGeometry(0.06, 1.96, 0.645);
    this.disposeList.push(panelGeo);
    for (const dz of doors) {
      const z = dz * L;
      for (const side of [-1, 1]) {
        const recess = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.08, 1.42), this.darkMat);
        recess.position.set(side * (halfW + 0.006), 2.02, z);
        this.disposeList.push(recess.geometry);
        group.add(recess);
        for (const sgn of [-1, 1]) {
          const panel = new THREE.Mesh(panelGeo, this.bodyMat);
          panel.position.set(side * (halfW + 0.04), 2.02, z + sgn * 0.335);
          panel.castShadow = false;
          group.add(panel);
          const pane = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.78, 0.42), this.glassMat);
          pane.position.set(side * 0.045, 0.3, 0);
          this.disposeList.push(pane.geometry);
          panel.add(pane);
          doorPanels.push({ mesh: panel, baseZ: z + sgn * 0.335, slideDir: sgn });
        }
      }
    }
    this.doorPanelsAll.push(...doorPanels);

    // Roof equipment
    const acGeo = new THREE.BoxGeometry(1.5, 0.35, 2.4);
    const ac = new THREE.Mesh(acGeo, this.roofMat);
    ac.position.set(0, roof + 0.2, -L * 0.2);
    this.disposeList.push(acGeo);
    ac.castShadow = true;
    group.add(ac);
    const ac2 = ac.clone();
    ac2.position.z = L * 0.24;
    group.add(ac2);

    // Pantograph on car 2 / car 4 for electric trains
    if (def.traction === 'electric' && (index === 1 || index === 4 || (totalCars < 3 && index === 0))) {
      group.add(this.buildPantograph(roof + 0.22));
    }

    // Bogies and wheels
    const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.13, 16);
    this.disposeList.push(wheelGeo);
    for (const bz of [-L / 2 + 2.7, L / 2 - 2.7]) {
      const bogie = new THREE.Group();
      bogie.position.set(0, 0.7, bz);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.42, 2.5), this.darkMat);
      frame.castShadow = true;
      this.disposeList.push(frame.geometry);
      bogie.add(frame);
      for (const side of [-1, 1]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 2.6), this.steelMat);
        beam.position.set(side * 0.86, 0.05, 0);
        this.disposeList.push(beam.geometry);
        bogie.add(beam);
      }
      for (const wx of [-1, 1]) {
        for (const wz of [-0.92, 0.92]) {
          const wheel = new THREE.Mesh(wheelGeo, this.wheelMat);
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(wx * 0.72, -0.24, wz);
          bogie.add(wheel);
        }
      }
      group.add(bogie);
    }

    // Wings / skirts
    group.add(this.makeBox(2.82, 0.18, L * 0.86, this.darkMat, 0, 0.86, 0));

    // Seats visible through glass
    if (index < 3) {
      const seatGeo = new THREE.BoxGeometry(0.42, 0.62, 0.5);
      const seatMat = new THREE.MeshStandardMaterial({ color: index % 2 ? 0x2b4c63 : 0x3d5c4d, roughness: 0.9 });
      this.disposeList.push(seatGeo, seatMat);
      const inst = new THREE.InstancedMesh(seatGeo, seatMat, 16);
      const dummy = new THREE.Object3D();
      let k = 0;
      for (let row = 0; row < 4; row++) {
        for (const sx of [-0.85, 0.85]) {
          for (const dz of [-0.35, 0.35]) {
            dummy.position.set(sx, 1.34, -L * 0.28 + row * 1.6 + dz);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            inst.setMatrixAt(k++, dummy.matrix);
          }
        }
      }
      group.add(inst);
    }

    const headlights: THREE.Mesh[] = [];
    const taillights: THREE.Mesh[] = [];
    const headGlows: THREE.Sprite[] = [];
    const tailGlows: THREE.Sprite[] = [];
    const lampGeo = new THREE.CircleGeometry(0.14, 12);
    this.disposeList.push(lampGeo);

    const isLead = index === 0;
    const frontZ = L / 2;
    const rearZ = -L / 2;

    // Cab nose glazing and destination display for the lead car
    if (isLead) {
      const wind = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.92, 0.06), this.glassMat);
      wind.position.set(0, 2.95, frontZ + 0.03);
      wind.rotation.x = -0.09;
      this.disposeList.push(wind.geometry);
      group.add(wind);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.5, 0.1), this.darkMat);
      nose.position.set(0, 1.02, frontZ + 0.01);
      this.disposeList.push(nose.geometry);
      group.add(nose);
      const dest = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 0.32),
        new THREE.MeshBasicMaterial({ map: this.destTex, transparent: true })
      );
      dest.position.set(0, 3.52, frontZ + 0.055);
      this.disposeList.push(dest.geometry, dest.material as THREE.Material);
      group.add(dest);
      // headlights
      for (const x of [-1.02, 1.02]) {
        const lamp = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xfff4d0 }));
        lamp.position.set(x, 1.55, frontZ + 0.075);
        group.add(lamp);
        this.disposeList.push(lamp.material as THREE.Material);
        headlights.push(lamp);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff0c0, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
        glow.position.set(x, 1.55, frontZ + 0.16);
        glow.scale.set(2.4, 2.4, 1);
        group.add(glow);
        headGlows.push(glow);
      }
    }

    if (index === totalCars - 1) {
      for (const x of [-1.0, 1.0]) {
        const lamp = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0x6a1010 }));
        lamp.position.set(x, 1.5, rearZ - 0.075);
        lamp.rotation.y = Math.PI;
        group.add(lamp);
        this.disposeList.push(lamp.material as THREE.Material);
        taillights.push(lamp);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff2a2a, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
        glow.position.set(x, 1.5, rearZ - 0.16);
        glow.scale.set(1.8, 1.8, 1);
        group.add(glow);
        tailGlows.push(glow);
      }
    }

    return { group, doorPanels, headlights, taillights, headGlows, tailGlows };
  }

  private buildPantograph(y: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(0, y, 1.6);
    const base = this.makeBox(1.5, 0.1, 0.9, this.darkMat, 0, 0, 0);
    g.add(base);
    const armMat = this.steelMat;
    const arm1 = this.makeBox(0.07, 1.1, 0.07, armMat, -0.45, 0.5, 0);
    arm1.rotation.z = 0.4;
    g.add(arm1);
    const arm2 = this.makeBox(0.07, 1.1, 0.07, armMat, 0.45, 0.5, 0);
    arm2.rotation.z = -0.4;
    g.add(arm2);
    const arm3 = this.makeBox(0.06, 0.9, 0.06, armMat, 0, 1.05, 0.05);
    arm3.rotation.x = 0.5;
    g.add(arm3);
    const bar = this.makeBox(1.1, 0.06, 0.18, armMat, 0, 1.42, -0.2);
    g.add(bar);
    return g;
  }

  private makeBox(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    this.disposeList.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  private buildCab(): void {
    const L = this.def.carLength;
    const zFront = L / 2;
    const interior = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.82 });
    const deskMat = new THREE.MeshStandardMaterial({ color: 0x3a4149, roughness: 0.6, metalness: 0.15 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x10141a, roughness: 0.7 });
    this.disposeList.push(interior, deskMat, trimMat);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      this.disposeList.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = false;
      m.receiveShadow = true;
      this.cabGroup.add(m);
      return m;
    };

    // Floor, ceiling, rear partition
    add(new THREE.BoxGeometry(2.84, 0.08, 3.8), interior, 0, 1.32, zFront - 1.8);
    add(new THREE.BoxGeometry(2.84, 0.08, 3.8), interior, 0, 3.72, zFront - 1.8);
    add(new THREE.BoxGeometry(2.84, 2.4, 0.08), interior, 0, 2.52, zFront - 3.7);
    // Side walls with window gaps
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.08, 0.55, 3.7), interior, side * 1.41, 1.65, zFront - 1.85);
      add(new THREE.BoxGeometry(0.08, 0.45, 3.7), interior, side * 1.41, 3.5, zFront - 1.85);
      add(new THREE.BoxGeometry(0.36, 0.5, 3.7), interior, side * 1.28, 3.28, zFront - 1.85);
    }

    // Windscreen surround
    add(new THREE.BoxGeometry(2.9, 0.12, 0.16), trimMat, 0, 3.5, zFront - 0.02);
    add(new THREE.BoxGeometry(2.9, 0.16, 0.16), trimMat, 0, 2.18, zFront - 0.02);
    add(new THREE.BoxGeometry(0.14, 1.4, 0.16), trimMat, -1.4, 2.85, zFront - 0.02);
    add(new THREE.BoxGeometry(0.14, 1.4, 0.16), trimMat, 1.4, 2.85, zFront - 0.02);
    const glass = add(new THREE.PlaneGeometry(2.62, 1.28), new THREE.MeshPhysicalMaterial({
      color: 0xa9c4d2, transparent: true, opacity: 0.075, roughness: 0.04, metalness: 0,
    }), 0, 2.84, zFront - 0.08);
    glass.rotation.y = Math.PI;
    (glass.material as THREE.Material).depthWrite = false;

    // Dashboard
    add(new THREE.BoxGeometry(2.72, 0.78, 0.5), deskMat, 0, 1.86, zFront - 0.72);
    add(new THREE.BoxGeometry(2.72, 0.16, 0.72), deskMat, 0, 2.24, zFront - 0.9).rotation.x = 0.08;
    add(new THREE.BoxGeometry(2.6, 0.1, 0.06), trimMat, 0, 2.34, zFront - 0.55);

    // Screens
    const speedScreen = add(new THREE.PlaneGeometry(0.86, 0.54), new THREE.MeshBasicMaterial({ map: this.speedTex, toneMapped: false }), -0.48, 2.56, zFront - 0.76);
    speedScreen.rotation.x = -0.28;
    const infoScreen = add(new THREE.PlaneGeometry(0.86, 0.54), new THREE.MeshBasicMaterial({ map: this.infoTex, toneMapped: false }), 0.48, 2.56, zFront - 0.76);
    infoScreen.rotation.x = -0.28;
    this.disposeList.push(speedScreen.geometry, speedScreen.material as THREE.Material);
    this.disposeList.push(infoScreen.geometry, infoScreen.material as THREE.Material);

    // Dash strip
    const dash = add(new THREE.PlaneGeometry(1.5, 0.34), new THREE.MeshBasicMaterial({ map: this.dashTex, toneMapped: false }), 0, 2.4, zFront - 0.56);
    dash.rotation.x = -0.1;
    this.disposeList.push(dash.geometry, dash.material as THREE.Material);

    // Levers
    const leverBase = new THREE.BoxGeometry(0.24, 0.08, 0.3);
    const leverStick = new THREE.CylinderGeometry(0.035, 0.045, 0.44, 7);
    this.disposeList.push(leverBase, leverStick);
    this.throttleLever = new THREE.Group();
    this.throttleLever.position.set(0.95, 2.3, zFront - 0.62);
    this.throttleLever.add(new THREE.Mesh(leverBase, trimMat));
    const tStick = new THREE.Mesh(leverStick, this.steelMat);
    tStick.position.y = 0.24;
    this.throttleLever.add(tStick);
    this.cabGroup.add(this.throttleLever);
    this.brakeLever = new THREE.Group();
    this.brakeLever.position.set(0.62, 2.3, zFront - 0.62);
    this.brakeLever.add(new THREE.Mesh(leverBase, trimMat));
    const bStick = new THREE.Mesh(leverStick, this.steelMat);
    bStick.position.y = 0.24;
    this.brakeLever.add(bStick);
    this.cabGroup.add(this.brakeLever);

    // Seat
    add(new THREE.BoxGeometry(0.62, 0.16, 0.58), new THREE.MeshStandardMaterial({ color: 0x25313d, roughness: 0.95 }), -0.55, 1.82, zFront - 3.0);
    add(new THREE.BoxGeometry(0.62, 0.86, 0.16), new THREE.MeshStandardMaterial({ color: 0x25313d, roughness: 0.95 }), -0.55, 2.3, zFront - 3.28);
    // Clipboard and mug
    add(new THREE.BoxGeometry(0.3, 0.02, 0.4), new THREE.MeshStandardMaterial({ color: 0xd8d3c4, roughness: 0.9 }), -0.2, 2.26, zFront - 0.95);
    add(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), new THREE.MeshStandardMaterial({ color: 0xefece2, roughness: 0.5 }), -0.85, 2.33, zFront - 0.98);

    // Wipers
    for (const x of [-0.8, 0.8]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 2.24, zFront - 0.13);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.85, 0.03), trimMat);
      arm.position.y = 0.42;
      pivot.add(arm);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.02), trimMat);
      blade.position.set(0.03, 0.45, 0.01);
      pivot.add(blade);
      this.disposeList.push(arm.geometry, blade.geometry);
      this.wiperPivots.push(pivot);
      this.cabGroup.add(pivot);
    }

    // Cab light
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff2d8, emissive: 0xffe6b0, emissiveIntensity: 1.4, roughness: 0.5 });
    this.cabLight = lightMat;
    this.disposeList.push(lightMat);
    add(new THREE.BoxGeometry(1.4, 0.04, 0.2), lightMat, 0, 3.66, zFront - 1.5);
    const cabPoint = new THREE.PointLight(0xffe7bd, 1.4, 7, 2);
    cabPoint.position.set(0, 3.4, zFront - 1.5);
    this.cabGroup.add(cabPoint);

    // Cab group sits in the lead car's local space.
    this.cabGroup.position.set(0, 0, 0);
  }

  setLineInfo(code: string, color: string, destination: string): void {
    this.lineCode = code;
    this.lineColor = color;
    this.destination = destination;
    this.drawDestination();
  }

  private drawDestination(): void {
    const ctx = this.destCtx;
    const w = this.destCanvas.width;
    const h = this.destCanvas.height;
    ctx.fillStyle = '#0a0d10';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = this.lineColor;
    ctx.fillRect(0, 0, 12, h);
    ctx.fillStyle = '#ffd86b';
    ctx.font = '700 54px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.lineCode, 30, h / 2);
    ctx.font = '600 44px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#f3f6f8';
    ctx.fillText(this.destination.toUpperCase().slice(0, 18), 120, h / 2);
    this.destTex.needsUpdate = true;
  }

  update(sim: TrainSim, path: TrackPath, dt: number, state: TrainRenderState): void {
    const gap = sim.gap;
    const L = this.def.carLength;
    this.group.position.set(0, 0, 0);
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const s = sim.carCenterS(i);
      const p = path.sample(s);
      car.group.position.set(p.x, p.y, p.z);
      const heading = path.headingAt(s);
      const grade = path.gradeAt(s);
      const curvature = path.curvatureAt(s);
      const roll = clamp(curvature * sim.v * sim.v * 0.011, -0.045, 0.045);
      car.group.rotation.order = 'YXZ';
      car.group.rotation.set(-Math.atan(grade), heading, -roll);
      void gap;
      void L;
    }

    // Doors
    const open = sim.doors;
    for (const panel of this.doorPanelsAll) {
      panel.mesh.position.z = panel.baseZ + panel.slideDir * open * 0.6;
    }

    // Lights
    const headOn = sim.headlights > 0;
    const bright = sim.headlights === 2;
    for (const car of this.cars) {
      for (const lamp of car.headlights) {
        const mat = lamp.material as THREE.MeshBasicMaterial;
        mat.color.setHex(headOn ? (bright ? 0xfff8e6 : 0xffecc0) : 0x35322a);
      }
      for (const g of car.headGlows) {
        const mat = g.material as THREE.SpriteMaterial;
        mat.opacity = headOn ? (bright ? 0.75 : 0.4) : 0;
      }
      for (const lamp of car.taillights) {
        const mat = lamp.material as THREE.MeshBasicMaterial;
        mat.color.setHex(sim.brakeApplied > 0.05 ? 0xff2a2a : 0x5a1010);
      }
      for (const g of car.tailGlows) {
        const mat = g.material as THREE.SpriteMaterial;
        mat.opacity = sim.brakeApplied > 0.05 ? 0.55 : 0.12;
      }
    }
    for (const spot of this.headlightSpots) {
      spot.intensity = headOn ? (bright ? 140 : 60) * (0.25 + state.night * 0.75) : 0;
    }

    this.cabGroup.visible = state.cabView;
    if (this.cabLight) this.cabLight.emissiveIntensity = 0.8 + state.night * 1.4;
    for (const w of this.wiperPivots) {
      const on = sim.wipers;
      w.rotation.z = on ? Math.sin(performance.now() * 0.005) * 1.1 : 0.1;
    }
    if (this.throttleLever) this.throttleLever.rotation.x = -0.55 + sim.throttle * 1.0;
    if (this.brakeLever) this.brakeLever.rotation.x = -0.55 + sim.brakeApplied * 1.0;

    this.displayTimer += dt;
    if (this.displayTimer > 0.15) {
      this.displayTimer = 0;
      this.drawScreens(sim, path);
    }
  }

  private drawScreens(sim: TrainSim, path: TrackPath): void {
    const c = this.speedCtx;
    const w = this.speedCanvas.width;
    const h = this.speedCanvas.height;
    c.fillStyle = '#08131a';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(90,200,255,0.25)';
    c.lineWidth = 2;
    c.strokeRect(4, 4, w - 8, h - 8);
    const speed = Math.round(sim.speedKph);
    const limit = path.limitAt(sim.s + 40);
    c.fillStyle = '#8fe6ff';
    c.font = '700 96px ui-monospace, monospace';
    c.textAlign = 'center';
    c.fillText(String(speed), w / 2, 118);
    c.font = '600 24px ui-sans-serif, sans-serif';
    c.fillStyle = '#5c8fa3';
    c.fillText('KM/H', w / 2, 148);
    c.fillStyle = speed > limit + 5 ? '#ff5f5f' : '#ffd166';
    c.font = '700 30px ui-monospace, monospace';
    c.fillText(`LIM ${limit}`, w / 2, 182);
    c.fillStyle = '#5c8fa3';
    c.textAlign = 'left';
    c.font = '600 18px ui-sans-serif, sans-serif';
    c.fillText(`PWR ${sim.powerNotch}   BRK ${sim.brakeNotch}`, 16, 22);
    this.speedTex.needsUpdate = true;

    const i = this.infoCtx;
    i.fillStyle = '#08131a';
    i.fillRect(0, 0, w, h);
    i.strokeStyle = 'rgba(90,200,255,0.25)';
    i.strokeRect(4, 4, w - 8, h - 8);
    const next = path.stationAhead(sim.s);
    i.fillStyle = '#5c8fa3';
    i.font = '600 20px ui-sans-serif, sans-serif';
    i.fillText('NEXT STOP', 16, 34);
    i.fillStyle = '#eaf6ff';
    i.font = '700 30px ui-sans-serif, sans-serif';
    i.fillText((next?.name ?? 'Terminus').slice(0, 18), 16, 70);
    if (next) {
      const d = Math.max(0, next.s - sim.s);
      i.fillStyle = '#ffd166';
      i.font = '700 26px ui-monospace, monospace';
      i.fillText(`${(d / 1000).toFixed(2)} km`, 16, 106);
      const mins = Math.round(d / Math.max(6, Math.abs(sim.v) || 8) / 60 * 10) / 10;
      i.fillStyle = '#7fa9b8';
      i.font = '500 18px ui-sans-serif, sans-serif';
      i.fillText(`ETA ${mins.toFixed(1)} min`, 16, 138);
    }
    i.fillStyle = sim.doorsOpen ? '#ffb04d' : '#69e6a3';
    i.font = '600 18px ui-sans-serif, sans-serif';
    i.fillText(sim.doorsOpen ? 'DOORS OPEN' : 'DOORS CLOSED', 16, 174);
    this.infoTex.needsUpdate = true;

    const d = this.dashCtx;
    d.clearRect(0, 0, this.dashCanvas.width, this.dashCanvas.height);
    d.fillStyle = '#070d12';
    d.fillRect(0, 0, this.dashCanvas.width, this.dashCanvas.height);
    d.fillStyle = '#18303d';
    for (let k = 0; k < 5; k++) d.fillRect(20 + k * 96, 40, 82, 48);
    d.fillStyle = sim.brakeApplied > 0.05 ? '#ff5b5b' : '#2f5364';
    d.fillRect(20, 40, 82, 48);
    d.fillStyle = sim.throttle > 0.05 ? '#5fe6a5' : '#2f5364';
    d.fillRect(20 + 4 * 96, 40, 82, 48);
    d.fillStyle = '#bfe9ff';
    d.font = '600 20px ui-monospace, monospace';
    d.fillText(`P ${sim.powerNotch}`, 24, 110);
    d.fillText(`B ${sim.brakeNotch}`, 500, 110);
    this.dashTex.needsUpdate = true;
  }

  /** Local eye point in lead-car space. */
  cabEyeLocal(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-0.55, 2.68, this.def.carLength / 2 - 2.25);
  }

  /** World matrix of the lead car. */
  leadCarMatrix(out = new THREE.Matrix4()): THREE.Matrix4 {
    return out.copy(this.cars[0].group.matrixWorld);
  }

  dispose(): void {
    for (const d of this.disposeList) d.dispose();
    for (const c of this.cars) {
      c.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && !this.disposeList.includes(m.geometry)) m.geometry.dispose();
      });
    }
    this.group.clear();
  }
}
