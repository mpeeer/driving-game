import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CarPhysics, type CarInput, type CarSpec } from './physics';
import { Cockpit } from './cockpit';
import { loadCarModel, type CarWheelRig, type LoadedCarModel } from './carModels';
import { CAR } from './config';
import type { CameraMode, CarId, MapData, Units } from './types';

type Vec3 = [number, number, number];

function rounded(w: number, h: number, d: number, radius: number): RoundedBoxGeometry {
  return new RoundedBoxGeometry(w, h, d, 2, radius);
}

/**
 * The player car has two faces: the detailed cockpit for first person, and a
 * compact exterior for the chase camera. Only one is visible at a time, so the
 * first-person view does not pay for the body and the chase view does not pay
 * for the cabin details.
 */
export class PlayerVehicle {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  readonly physics: CarPhysics;
  readonly cockpit: Cockpit;
  private readonly forward = new THREE.Vector3();
  private readonly fallback = new THREE.Group();
  private readonly wheels: Array<{ root: THREE.Group; spin: THREE.Group; front: boolean }> = [];
  private readonly headlightLights: THREE.SpotLight[] = [];
  private readonly pitchAxis = new THREE.Vector3(1, 0, 0);
  private cabinLight!: THREE.PointLight;
  private carFill!: THREE.PointLight;
  private readonly tailGlows: THREE.Sprite[] = [];
  private tailGlowMaterial!: THREE.SpriteMaterial;
  private readonly pitchQuaternion = new THREE.Quaternion();
  private lampMaterial!: THREE.MeshBasicMaterial;
  private modelRoot: THREE.Group | null = null;
  private modelWheels: CarWheelRig[] = [];
  private modelToken = 0;
  private night = 0;
  private wheelSpin = 0;
  private roadHeight = 0;
  private roadPitch = 0;

  constructor(scene: THREE.Scene, spec: CarSpec, mapData: MapData) {
    this.physics = new CarPhysics(spec);
    this.cockpit = new Cockpit(mapData);
    this.group.name = 'player-vehicle';
    this.body.add(this.fallback);
    this.buildExterior();
    this.buildContactShadow();
    this.buildCarFill();
    this.buildTailGlows();
    this.group.add(this.cockpit.group);
    this.group.add(this.body);
    this.body.visible = false;
    scene.add(this.group);
    this.setNight(0);
  }

  /**
   * Swap the exterior body. The hand-built fallback stays visible until the
   * supplied mesh has loaded, so a slow connection never leaves the chase view
   * empty. Loaded bodies are cached by the model module.
   */
  setCarModel(id: CarId, onError?: () => void): void {
    this.modelToken += 1;
    const token = this.modelToken;
    loadCarModel(id)
      .then((loaded) => {
        if (token !== this.modelToken) return;
        this.applyCarModel(loaded);
      })
      .catch((error: unknown) => {
        console.error(`Player car model "${id}" failed to load`, error);
        if (token !== this.modelToken) return;
        onError?.();
      });
  }

  private applyCarModel(loaded: LoadedCarModel): void {
    if (this.modelRoot) this.body.remove(this.modelRoot);
    this.modelRoot = loaded.group;
    this.modelWheels = loaded.wheels;
    this.body.add(loaded.group);
    this.fallback.visible = false;
    for (const glow of this.tailGlows) glow.visible = true;
    this.setBodyLength(loaded.length);
  }

  private setBodyLength(length: number): void {
    const nose = -length / 2 + 0.04;
    this.headlightLights.forEach((light) => {
      light.position.z = nose;
    });
    const offsetX = Math.min(0.86, length * 0.16);
    for (const [index, glow] of this.tailGlows.entries()) {
      glow.position.set((index === 0 ? -1 : 1) * offsetX, -0.12, length / 2 - 0.04);
    }
  }

  setSpec(spec: CarSpec): void {
    this.physics.setSpec(spec);
  }

  setView(mode: CameraMode): void {
    this.cockpit.group.visible = mode === 'cockpit';
    this.body.visible = mode === 'chase';
  }

  place(position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    // Physics still runs on the local flat plane. The visual car is lifted onto
    // the route's actual road surface and pitched to the grade separately.
    this.roadHeight = position.y;
    this.roadPitch = 0;
    const bodyPosition = new CANNON.Vec3(position.x, CAR.startHeight, position.z);
    const bodyQuaternion = new CANNON.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    this.physics.reset(bodyPosition, bodyQuaternion);
    this.syncTransform();
  }

  setRoadPose(height: number, pitch: number): void {
    this.roadHeight = height;
    this.roadPitch = pitch;
    this.syncTransform();
  }

  setNight(night: number): void {
    this.night = THREE.MathUtils.clamp(night, 0, 1);
    const amount = this.night;
    for (const light of this.headlightLights) light.intensity = amount * 145;
    this.cabinLight.intensity = amount * amount * 1.6;
    if (this.carFill) this.carFill.intensity = 0.25 + amount * 2.1;
    if (this.tailGlowMaterial) this.tailGlowMaterial.opacity = amount * 0.8;
    if (this.lampMaterial) {
      this.lampMaterial.color.setRGB(0.78 + amount * 0.55, 0.74 + amount * 0.5, 0.58 + amount * 0.42);
    }
  }

  update(dt: number, input: CarInput, units: Units, nextGateDistance: number): void {
    this.physics.update(dt, input);
    this.syncTransform();
    this.forward.set(0, 0, -1).applyQuaternion(this.group.quaternion);
    this.cockpit.update(
      {
        speedKmh: this.physics.speedKmh,
        gear: this.physics.gearLabel,
        rpm: this.physics.rpm,
        steering: this.physics.steeringVisual,
        units,
        nextGateDistance,
        mapX: this.group.position.x,
        mapZ: this.group.position.z,
        heading: Math.atan2(this.forward.x, -this.forward.z),
      },
      dt,
    );
    if (this.body.visible) this.animateWheels(dt);
  }

  /** Flat heading vector for road-facing tests, independent of the visual pitch. */
  forwardDirection(): THREE.Vector3 {
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.group.quaternion);
    direction.y = 0;
    return direction.normalize();
  }

  syncTransform(): void {
    const body = this.physics.chassis;
    this.group.position.set(body.position.x, body.position.y + this.roadHeight, body.position.z);
    this.group.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    if (Math.abs(this.roadPitch) > 0.0001) {
      this.pitchQuaternion.setFromAxisAngle(this.pitchAxis, this.roadPitch);
      this.group.quaternion.multiply(this.pitchQuaternion);
    }
  }

  private animateWheels(dt: number): void {
    this.wheelSpin = (this.wheelSpin - (this.physics.signedSpeed / CAR.wheelRadius) * dt) % (Math.PI * 2);
    for (const wheel of this.wheels) {
      wheel.root.rotation.y = wheel.front ? -this.physics.steeringVisual : 0;
      wheel.spin.rotation.x = this.wheelSpin;
    }
    for (const wheel of this.modelWheels) {
      wheel.steer.rotation.y = wheel.front ? -this.physics.steeringVisual : 0;
      wheel.spin.rotation.x = this.wheelSpin;
    }
  }

  private buildExterior(): void {
    const body = this.fallback;
    body.name = 'car-exterior';

    const paint = new THREE.MeshPhongMaterial({
      color: 0xd2c09d,
      specular: 0xfff1d2,
      shininess: 52,
    });
    const accent = new THREE.MeshPhongMaterial({
      color: 0x234b43,
      specular: 0x8ea79d,
      shininess: 46,
    });
    const trim = new THREE.MeshLambertMaterial({ color: 0x11181a });
    const glass = new THREE.MeshPhongMaterial({
      color: 0x081719,
      specular: 0xb3d5ce,
      shininess: 88,
    });
    const chrome = new THREE.MeshPhongMaterial({
      color: 0xa5aca4,
      specular: 0xffffff,
      shininess: 90,
    });
    this.lampMaterial = new THREE.MeshBasicMaterial({ color: 0xfff0c7, toneMapped: false });
    const tailLamp = new THREE.MeshBasicMaterial({ color: 0xff5c42, toneMapped: false });
    const tire = new THREE.MeshLambertMaterial({ color: 0x111315 });
    const rim = new THREE.MeshPhongMaterial({
      color: 0xaeb2aa,
      specular: 0xffffff,
      shininess: 70,
    });
    const add = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      position: Vec3,
      rotation: Vec3 = [0, 0, 0],
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.rotation.set(...rotation);
      mesh.frustumCulled = false;
      body.add(mesh);
      return mesh;
    };

    // Low, wide main body with a separate hood and deck.
    add(rounded(1.6, 0.42, 4.08, 0.12), paint, [0, -0.19, 0]);
    add(rounded(1.47, 0.065, 1.25, 0.03), paint, [0, 0.042, -1.43]);
    add(rounded(1.45, 0.06, 0.85, 0.03), paint, [0, 0.035, 1.54]);
    add(rounded(1.54, 0.08, 0.4, 0.03), paint, [0, -0.22, -2.02]);
    add(rounded(1.54, 0.08, 0.4, 0.03), paint, [0, -0.22, 2.02]);

    // Rocker trim and a dark centre stripe anchor the warm body colour.
    for (const side of [-1, 1] as const) {
      add(new THREE.BoxGeometry(0.07, 0.085, 2.45), trim, [side * 0.78, -0.385, 0.08]);
      add(new THREE.BoxGeometry(0.018, 0.012, 2.3), accent, [side * 0.807, -0.17, 0.08]);
      add(new THREE.BoxGeometry(0.022, 0.05, 0.055), chrome, [side * 0.79, 0.1, 0.34]);
    }

    // Cabin shell and glass. The glass is set just proud of the paint so it
    // reads as continuous side glass rather than a flat painted panel.
    add(rounded(1.3, 0.33, 1.76, 0.06), paint, [0, 0.21, 0.08]);
    add(rounded(1.24, 0.045, 1.03, 0.02), paint, [0, 0.397, 0.15]);
    add(new THREE.BoxGeometry(1.16, 0.215, 0.018), glass, [0, 0.25, -0.802]);
    add(new THREE.BoxGeometry(1.11, 0.18, 0.018), glass, [0, 0.25, 0.962]);
    for (const side of [-1, 1] as const) {
      add(new THREE.BoxGeometry(0.012, 0.215, 1.18), glass, [side * 0.657, 0.255, 0.08]);
      add(new THREE.BoxGeometry(0.017, 0.016, 1.5), chrome, [side * 0.665, 0.137, 0.08]);
      add(new THREE.BoxGeometry(0.035, 0.23, 0.06), accent, [side * 0.64, 0.245, -0.75]);
      add(new THREE.BoxGeometry(0.03, 0.235, 0.055), trim, [side * 0.66, 0.245, 0.55]);
    }

    // Twin centre stripes over hood, roof and deck.
    for (const x of [-0.095, 0.095]) {
      add(new THREE.BoxGeometry(0.055, 0.006, 1.17), accent, [x, 0.081, -1.43]);
      add(new THREE.BoxGeometry(0.055, 0.006, 1.0), accent, [x, 0.421, 0.15]);
      add(new THREE.BoxGeometry(0.055, 0.006, 0.78), accent, [x, 0.071, 1.54]);
    }

    // Nose, lamps, grille and tail bar.
    for (const side of [-1, 1] as const) {
      add(new THREE.BoxGeometry(0.36, 0.075, 0.025), this.lampMaterial, [side * 0.47, -0.015, -2.046]);
      const headlight = new THREE.SpotLight(0xffefcf, 0, 120, 0.4, 0.65, 1.1);
      headlight.position.set(side * 0.5, -0.01, -2.0);
      headlight.target.position.set(side * 0.72, -1.1, -30);
      this.group.add(headlight, headlight.target);
      this.headlightLights.push(headlight);
    }
    // A very local warm fill keeps the dash, wheel and door cards readable at
    // night without turning the whole island into a lit stage.
    this.cabinLight = new THREE.PointLight(0xffd8ad, 0, 4.8, 1.5);
    this.cabinLight.position.set(-0.04, 0.58, 0.04);
    this.group.add(this.cabinLight);
    for (const side of [-1, 1] as const) {
      add(new THREE.BoxGeometry(0.38, 0.065, 0.026), tailLamp, [side * 0.47, -0.02, 2.046]);
      add(new THREE.BoxGeometry(0.1, 0.05, 0.07), paint, [side * 0.79, 0.205, -0.52]);
      add(new THREE.BoxGeometry(0.05, 0.02, 0.13), trim, [side * 0.73, 0.18, -0.58], [0, side * 0.25, 0]);
    }
    add(new THREE.BoxGeometry(0.58, 0.07, 0.025), trim, [0, -0.16, -2.046]);
    add(new THREE.BoxGeometry(0.9, 0.085, 0.025), trim, [0, -0.34, -2.04]);
    add(new THREE.BoxGeometry(1.1, 0.035, 0.022), tailLamp, [0, -0.15, 2.046]);
    add(new THREE.BoxGeometry(0.58, 0.045, 0.022), trim, [0, -0.31, 2.04]);

    // Ducktail spoiler and twin exhaust tips.
    add(rounded(1.22, 0.045, 0.28, 0.014), accent, [0, 0.1, 1.91], [0.08, 0, 0]);
    for (const side of [-1, 1] as const) {
      add(new THREE.BoxGeometry(0.07, 0.06, 0.04), trim, [side * 0.43, 0.06, 1.92]);
      add(new THREE.CylinderGeometry(0.043, 0.043, 0.16, 8), chrome, [side * 0.33, -0.34, 2.1], [Math.PI / 2, 0, 0]);
    }

    // Wheels: each root steers, and the inner group carries the rolling spin.
    for (const side of [-1, 1] as const) {
      for (const [z, front] of [[-CAR.frontAxle, true], [-CAR.rearAxle, false]] as Array<[number, boolean]>) {
        const root = new THREE.Group();
        root.position.set(side * CAR.trackHalf, -0.59, z);
        body.add(root);
        const spin = new THREE.Group();
        root.add(spin);

        const tyre = new THREE.Mesh(new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.26, 18), tire);
        tyre.rotation.z = Math.PI / 2;
        spin.add(tyre);
        const rimMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.272, 14), rim);
        rimMesh.rotation.z = Math.PI / 2;
        spin.add(rimMesh);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.28, 10), trim);
        hub.rotation.z = Math.PI / 2;
        spin.add(hub);

        this.wheels.push({ root, spin, front });
      }
    }

  }

  private buildContactShadow(): void {
    const shadow = new THREE.MeshBasicMaterial({
      color: 0x020504,
      transparent: true,
      opacity: 0.27,
      depthWrite: false,
    });
    // A cheap contact shadow keeps the car planted when shadows are disabled.
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(2.25, 4.7), shadow);
    contact.rotation.x = -Math.PI / 2;
    contact.position.set(0, -0.936, 0);
    contact.renderOrder = 1;
    this.body.add(contact);
  }

  private buildCarFill(): void {
    // A soft, close fill keeps the darker supplied bodies readable under the
    // moon and streetlights. It is part of the exterior group, so the cockpit
    // view pays nothing for it.
    this.carFill = new THREE.PointLight(0xbfd8dc, 0.25, 6.2, 1.7);
    this.carFill.position.set(0, 1.75, 0.9);
    this.body.add(this.carFill);
  }

  private buildTailGlows(): void {
    const texture = makeGlowTexture();
    this.tailGlowMaterial = new THREE.SpriteMaterial({
      map: texture,
      color: 0xff4a24,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    for (let i = 0; i < 2; i += 1) {
      const glow = new THREE.Sprite(this.tailGlowMaterial);
      glow.scale.set(0.52, 0.15, 1);
      glow.position.set(0, -0.12, 2.2);
      glow.visible = false;
      glow.frustumCulled = false;
      this.tailGlows.push(glow);
      this.body.add(glow);
    }
  }
}

function makeGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  const gradient = ctx.createRadialGradient(32, 16, 1, 32, 16, 32);
  gradient.addColorStop(0, 'rgba(255,238,214,1)');
  gradient.addColorStop(0.18, 'rgba(255,138,96,0.95)');
  gradient.addColorStop(0.52, 'rgba(255,56,24,0.32)');
  gradient.addColorStop(1, 'rgba(255,40,16,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
