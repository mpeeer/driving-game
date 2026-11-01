import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export interface CockpitState {
  speedKmh: number;
  gear: string;
  rpm: number;
  steering: number;
}

function rounded(w: number, h: number, d: number, radius: number, material: THREE.Material) {
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, radius), material);
}

/**
 * A minimalist first-person cabin: dashboard, binnacle, wheel and windscreen.
 * The visual nose of the car is -Z, so everything ahead of the driver has negative Z.
 */
export class Cockpit {
  readonly group = new THREE.Group();
  private spin = new THREE.Group();
  private screenCanvas!: HTMLCanvasElement;
  private screenContext!: CanvasRenderingContext2D;
  private screenTexture!: THREE.CanvasTexture;
  private screenTimer = 0;
  private screenKey = '';

  constructor() {
    this.group.name = 'cockpit';
    this.buildDashboard();
    this.buildSteeringWheel();
    this.buildScreen();
    this.buildCabinShell();

    const interiorLight = new THREE.PointLight(0xffc498, 0.7, 3, 2);
    interiorLight.position.set(0, 0.48, -0.5);
    this.group.add(interiorLight);

    this.group.traverse((object) => {
      object.castShadow = false;
      object.receiveShadow = false;
    });

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        this.screenKey = '';
      }).catch(() => undefined);
    }
  }

  private buildDashboard(): void {
    const leather = new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.82, metalness: 0.05 });
    const soft = new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.94, metalness: 0.02 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x272c35, roughness: 0.32, metalness: 0.82 });
    const screenBezel = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.45, metalness: 0.3 });

    const dashTop = rounded(1.66, 0.15, 0.56, 0.045, leather);
    dashTop.position.set(0, 0.23, -0.62);
    this.group.add(dashTop);

    const dashFace = rounded(1.58, 0.38, 0.16, 0.035, soft);
    dashFace.position.set(0, 0.015, -0.88);
    this.group.add(dashFace);

    const dashLip = rounded(1.56, 0.024, 0.02, 0.008, trim);
    dashLip.position.set(0, 0.305, -0.4);
    this.group.add(dashLip);

    const accent = new THREE.Mesh(
      new THREE.BoxGeometry(0.98, 0.005, 0.012),
      new THREE.MeshBasicMaterial({ color: 0xffb257, transparent: true, opacity: 0.5, toneMapped: false }),
    );
    accent.position.set(0, 0.307, -0.58);
    this.group.add(accent);

    const binnacle = rounded(0.52, 0.14, 0.2, 0.04, soft);
    binnacle.position.set(0, 0.375, -0.79);
    this.group.add(binnacle);

    const bezel = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.145), screenBezel);
    bezel.position.set(0, 0.363, -0.687);
    bezel.rotation.x = -0.1;
    this.group.add(bezel);

    const ventLeft = rounded(0.16, 0.05, 0.03, 0.012, trim);
    ventLeft.position.set(-0.61, 0.28, -0.86);
    this.group.add(ventLeft);
    const ventRight = ventLeft.clone();
    ventRight.position.x = 0.61;
    this.group.add(ventRight);
  }

  private buildSteeringWheel(): void {
    const wheel = new THREE.Group();
    wheel.position.set(0, 0.16, -0.655);
    wheel.rotation.x = -0.3;
    this.group.add(wheel);

    this.spin.name = 'steering-wheel-spin';
    wheel.add(this.spin);

    const rimMaterial = new THREE.MeshStandardMaterial({ color: 0x101116, roughness: 0.56, metalness: 0.12 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x343a44, roughness: 0.3, metalness: 0.85 });

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.176, 0.026, 14, 48), rimMaterial);
    this.spin.add(rim);

    const spokeGeometry = new RoundedBoxGeometry(0.145, 0.032, 0.026, 2, 0.012);
    const leftSpoke = new THREE.Mesh(spokeGeometry, trimMaterial);
    leftSpoke.position.set(-0.085, 0, 0);
    this.spin.add(leftSpoke);
    const rightSpoke = leftSpoke.clone();
    rightSpoke.position.x = 0.085;
    this.spin.add(rightSpoke);

    const lowerSpoke = new THREE.Mesh(new RoundedBoxGeometry(0.032, 0.14, 0.026, 2, 0.012), trimMaterial);
    lowerSpoke.position.set(0, -0.085, 0);
    this.spin.add(lowerSpoke);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.058, 0.045, 24), trimMaterial);
    hub.rotation.x = Math.PI / 2;
    this.spin.add(hub);

    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.012, 0.008),
      new THREE.MeshStandardMaterial({ color: 0x8f2a22, emissive: 0x3a0705, roughness: 0.4 }),
    );
    marker.position.set(0, 0.178, 0.006);
    this.spin.add(marker);

    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.043, 0.052, 0.26, 16),
      new THREE.MeshStandardMaterial({ color: 0x0b0d11, roughness: 0.7, metalness: 0.2 }),
    );
    column.rotation.x = Math.PI / 2;
    column.position.set(0, 0, -0.16);
    wheel.add(column);
  }

  private buildScreen(): void {
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = 512;
    this.screenCanvas.height = 192;
    const ctx = this.screenCanvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is unavailable');
    this.screenContext = ctx;

    this.screenTexture = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTexture.colorSpace = THREE.SRGBColorSpace;
    this.screenTexture.anisotropy = 4;

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.385, 0.144),
      new THREE.MeshBasicMaterial({ map: this.screenTexture, toneMapped: false }),
    );
    screen.position.set(0, 0.363, -0.684);
    screen.rotation.x = -0.1;
    this.group.add(screen);
    this.drawScreen({ speedKmh: 0, gear: 'N', rpm: 900, steering: 0 });
  }

  private buildCabinShell(): void {
    const paint = new THREE.MeshPhysicalMaterial({
      color: 0x0a0d13,
      roughness: 0.28,
      metalness: 0.65,
      clearcoat: 1,
      clearcoatRoughness: 0.16,
    });
    const soft = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.95, metalness: 0.02 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.38, metalness: 0.7 });
    const glassFrame = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.6, metalness: 0.3 });

    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.06, 1.4), paint);
    hood.position.set(0, 0.17, -1.62);
    hood.rotation.x = -0.025;
    this.group.add(hood);

    const hoodCrease = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, 1.24), trim);
    hoodCrease.position.set(0, 0.202, -1.68);
    this.group.add(hoodCrease);

    const cowl = rounded(1.78, 0.06, 0.12, 0.02, soft);
    cowl.position.set(0, 0.255, -1.03);
    this.group.add(cowl);

    const header = rounded(1.78, 0.075, 0.16, 0.025, soft);
    header.position.set(0, 0.93, -1.01);
    this.group.add(header);

    const pillarLeft = rounded(0.095, 0.68, 0.12, 0.03, glassFrame);
    pillarLeft.position.set(-0.79, 0.62, -0.9);
    pillarLeft.rotation.z = 0.19;
    this.group.add(pillarLeft);
    const pillarRight = pillarLeft.clone();
    pillarRight.position.x = 0.79;
    pillarRight.rotation.z = -0.19;
    this.group.add(pillarRight);

    const sillLeft = rounded(0.07, 0.055, 0.86, 0.02, trim);
    sillLeft.position.set(-0.855, 0.44, -0.36);
    this.group.add(sillLeft);
    const sillRight = sillLeft.clone();
    sillRight.position.x = 0.855;
    this.group.add(sillRight);

    const doorLeft = rounded(0.09, 0.6, 1.0, 0.03, soft);
    doorLeft.position.set(-0.89, 0.02, -0.12);
    this.group.add(doorLeft);
    const doorRight = doorLeft.clone();
    doorRight.position.x = 0.89;
    this.group.add(doorRight);

    const mirror = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.065, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x080a0e, roughness: 0.25, metalness: 0.9 }),
    );
    mirror.position.set(0, 0.805, -0.975);
    this.group.add(mirror);

    const mirrorStem = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.06, 0.018), trim);
    mirrorStem.position.set(0, 0.86, -0.985);
    this.group.add(mirrorStem);
  }

  update(state: CockpitState): void {
    const target = -state.steering * 5.4;
    this.spin.rotation.z += (target - this.spin.rotation.z) * 0.35;

    const bucket = Math.round(state.speedKmh / 2);
    const key = `${bucket}:${state.gear}:${Math.round(state.rpm / 60)}`;
    if (key === this.screenKey) return;
    this.screenKey = key;
    this.drawScreen(state);
  }

  private drawScreen(state: CockpitState): void {
    const ctx = this.screenContext;
    const w = this.screenCanvas.width;
    const h = this.screenCanvas.height;

    ctx.fillStyle = '#04080b';
    ctx.fillRect(0, 0, w, h);

    const vignette = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.7);
    vignette.addColorStop(0, 'rgba(30,48,55,0.45)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255,178,87,0.25)';
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, w - 12, h - 12);

    ctx.fillStyle = 'rgba(255,178,87,0.7)';
    ctx.font = '500 20px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('NIGHTSHIFT', 28, 40);

    ctx.fillStyle = 'rgba(232,238,246,0.35)';
    ctx.textAlign = 'right';
    ctx.fillText('DUSK / 21:40', w - 28, 40);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#f2f6fb';
    ctx.font = '500 92px "IBM Plex Mono", monospace';
    const speed = String(Math.round(state.speedKmh)).padStart(3, '0');
    ctx.fillText(speed, 335, 138);

    ctx.fillStyle = 'rgba(255,178,87,0.75)';
    ctx.font = '500 18px "IBM Plex Mono", monospace';
    ctx.fillText('KM/H', 335, 168);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffb257';
    ctx.font = '600 84px "Barlow Condensed", sans-serif';
    ctx.fillText(state.gear, w - 34, 140);
    ctx.fillStyle = 'rgba(232,238,246,0.35)';
    ctx.font = '500 16px "IBM Plex Mono", monospace';
    ctx.fillText('GEAR', w - 34, 168);

    const barX = 28;
    const barY = 154;
    const barW = 250;
    const barH = 8;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(barX, barY, barW, barH);
    const rpmFill = Math.min(1, state.rpm / 7600);
    const gradient = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    gradient.addColorStop(0, '#8fd8ff');
    gradient.addColorStop(0.72, '#ffd08a');
    gradient.addColorStop(1, '#ff7a5c');
    ctx.fillStyle = gradient;
    ctx.fillRect(barX, barY, barW * rpmFill, barH);

    ctx.fillStyle = 'rgba(232,238,246,0.3)';
    ctx.font = '500 14px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(state.rpm)} RPM`, barX, 178);

    this.screenTexture.needsUpdate = true;
  }
}
