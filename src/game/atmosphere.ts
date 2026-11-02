import * as THREE from 'three';
import { DAY } from './config';

const SKY_RADIUS = 4200;
const STAR_RADIUS = 3600;
const CLOUD_RADIUS = 3350;

const NIGHT_ZENITH = new THREE.Color(0x050a18);
const NIGHT_HORIZON = new THREE.Color(0x101b2e);
const DAY_ZENITH = new THREE.Color(0x2d73c7);
const DAY_HORIZON = new THREE.Color(0xc5e0df);
const GOLD_ZENITH = new THREE.Color(0x5366a2);
const GOLD_HORIZON = new THREE.Color(0xffb373);
const DEEP_NIGHT_FOG = new THREE.Color(0x152339);
const SUN_WARM = new THREE.Color(0xffb16d);
const SUN_DAY = new THREE.Color(0xfff4df);
const DAY_WATER = new THREE.Color(0xffffff);
const NIGHT_WATER = new THREE.Color(0x55708a);
const DAY_RIDGE = new THREE.Color(0xffffff);
const NIGHT_RIDGE = new THREE.Color(0x52617a);
const GOLD_RIDGE = new THREE.Color(0xffd4ac);

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function makeSpriteTexture(kind: 'sun' | 'moon' | 'cloud' | 'star'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');

  if (kind === 'star') {
    canvas.width = 32;
    canvas.height = 32;
    const glow = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.18, 'rgba(255,255,255,0.95)');
    glow.addColorStop(0.5, 'rgba(210,228,255,0.28)');
    glow.addColorStop(1, 'rgba(190,215,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 32, 32);
  } else if (kind === 'sun') {
    canvas.width = 256;
    canvas.height = 256;
    const glow = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    glow.addColorStop(0, 'rgba(255,255,250,1)');
    glow.addColorStop(0.1, 'rgba(255,250,221,1)');
    glow.addColorStop(0.18, 'rgba(255,226,159,0.96)');
    glow.addColorStop(0.34, 'rgba(255,178,101,0.35)');
    glow.addColorStop(0.62, 'rgba(255,147,80,0.08)');
    glow.addColorStop(1, 'rgba(255,132,68,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 256, 256);
  } else if (kind === 'moon') {
    canvas.width = 128;
    canvas.height = 128;
    const halo = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    halo.addColorStop(0, 'rgba(237,244,255,0.35)');
    halo.addColorStop(0.4, 'rgba(200,219,255,0.1)');
    halo.addColorStop(1, 'rgba(200,219,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(236,243,255,0.98)';
    ctx.beginPath();
    ctx.arc(64, 64, 29, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(133,151,178,0.22)';
    for (const [x, y, r] of [[55, 55, 7], [73, 68, 9], [56, 78, 5], [70, 45, 4]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    canvas.width = 512;
    canvas.height = 192;
    for (let i = 0; i < 18; i++) {
      const x = 60 + Math.random() * 392;
      const y = 58 + Math.random() * 70;
      const rx = 55 + Math.random() * 115;
      const ry = 24 + Math.random() * 44;
      const cloud = ctx.createRadialGradient(x, y, 2, x, y, rx);
      cloud.addColorStop(0, 'rgba(255,255,255,0.42)');
      cloud.addColorStop(0.45, 'rgba(255,255,255,0.18)');
      cloud.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, ry / rx);
      ctx.translate(-x, -y);
      ctx.fillStyle = cloud;
      ctx.beginPath();
      ctx.arc(x, y, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A compact time-of-day rig. The sky is one shader dome, the stars are one
 * point cloud and the clouds are a handful of sprites, so the whole atmosphere
 * costs only a few extra draw calls. All scene lights and the fog palette move
 * with the same sun direction, which keeps the dusk transition coherent.
 */
export class Atmosphere {
  readonly sunLight: THREE.DirectionalLight;
  readonly moonLight: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  readonly bounceLight: THREE.DirectionalLight;

  private readonly scene: THREE.Scene;
  private readonly skyRoot = new THREE.Group();
  private readonly cloudGroup = new THREE.Group();
  private readonly skyMaterial: THREE.ShaderMaterial;
  private readonly starMaterial: THREE.PointsMaterial;
  private readonly cloudMaterials: THREE.SpriteMaterial[] = [];
  private readonly sunSprite: THREE.Sprite;
  private readonly moonSprite: THREE.Sprite;
  private readonly sunDirection = new THREE.Vector3();
  private readonly starField: THREE.Points;
  private readonly shootingMaterial: THREE.LineBasicMaterial;
  private readonly shootingLine: THREE.Line;
  private readonly shootingPositions = new Float32Array(6);
  private readonly shootingVelocity = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private shootingLife = 0;
  private shootingCooldown = 64;

  private phase = DAY.start;
  private night = 0;
  private golden = 0;
  private daylight = 0;
  private sunAltitude = 0;

  readonly fogColor = new THREE.Color();
  readonly ridgeTint = new THREE.Color(1, 1, 1);
  readonly waterTint = new THREE.Color(1, 1, 1);
  windowGlow = 0;
  get nightFactor(): number {
    return this.night;
  }

  get exposure(): number {
    return 1.04 + this.night * 0.2 + this.golden * 0.03;
  }

  clock = '16:05';
  phaseLabel = 'DAYLIGHT';

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uGlow: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uGlowStrength: { value: 0.2 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uGround;
        uniform vec3 uGlow;
        uniform vec3 uSunDir;
        uniform float uGlowStrength;

        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y, 0.0, 1.0);
          float heightMix = pow(h, 0.52);
          vec3 col = mix(uHorizon, uZenith, heightMix);

          // A warm band hangs around the sun; it also gives the horizon a
          // little separation from the fog rather than a flat colour field.
          float nearSun = pow(max(dot(dir, uSunDir), 0.0), 12.0);
          float horizonBand = pow(1.0 - clamp(abs(dir.y), 0.0, 1.0), 11.0);
          col += uGlow * (nearSun * uGlowStrength + horizonBand * uGlowStrength * 0.28);

          // Below the horizon the dome fades into ground haze, mostly hidden by
          // the terrain but useful when the chase camera is pitched down.
          col = mix(uGround, col, smoothstep(-0.16, -0.01, dir.y));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 18), this.skyMaterial);
    sky.name = 'atmosphere-sky';
    sky.frustumCulled = false;
    sky.renderOrder = -200;
    this.skyRoot.add(sky);

    const starGeometry = new THREE.BufferGeometry();
    const starPositions: number[] = [];
    for (let i = 0; i < 2200; i++) {
      const y = Math.pow(Math.random(), 0.7) * 0.92 + 0.05;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(1 - y * y);
      starPositions.push(Math.cos(angle) * radius * STAR_RADIUS, y * STAR_RADIUS, Math.sin(angle) * radius * STAR_RADIUS);
    }
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    this.starMaterial = new THREE.PointsMaterial({
      map: makeSpriteTexture('star'),
      color: 0xdce9ff,
      size: 5.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    this.starField = new THREE.Points(starGeometry, this.starMaterial);
    this.starField.name = 'atmosphere-stars';
    this.starField.frustumCulled = false;
    this.skyRoot.add(this.starField);

    const shootingGeometry = new THREE.BufferGeometry();
    shootingGeometry.setAttribute('position', new THREE.BufferAttribute(this.shootingPositions, 3));
    this.shootingMaterial = new THREE.LineBasicMaterial({
      color: 0xeaf3ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    this.shootingLine = new THREE.Line(shootingGeometry, this.shootingMaterial);
    this.shootingLine.name = 'shooting-star';
    this.shootingLine.visible = false;
    this.shootingLine.frustumCulled = false;
    this.skyRoot.add(this.shootingLine);

    const sunMaterial = new THREE.SpriteMaterial({
      map: makeSpriteTexture('sun'),
      color: 0xffe9c2,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.sunSprite = new THREE.Sprite(sunMaterial);
    this.sunSprite.scale.set(640, 640, 1);
    this.sunSprite.renderOrder = -120;
    this.skyRoot.add(this.sunSprite);

    const moonMaterial = new THREE.SpriteMaterial({
      map: makeSpriteTexture('moon'),
      color: 0xdce9ff,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.moonSprite = new THREE.Sprite(moonMaterial);
    this.moonSprite.scale.set(230, 230, 1);
    this.moonSprite.renderOrder = -120;
    this.skyRoot.add(this.moonSprite);

    for (let i = 0; i < 9; i++) {
      const material = new THREE.SpriteMaterial({
        map: makeSpriteTexture('cloud'),
        color: 0xfff4e6,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        toneMapped: false,
      });
      const cloud = new THREE.Sprite(material);
      const angle = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
      const radius = CLOUD_RADIUS * (0.78 + Math.random() * 0.24);
      cloud.position.set(Math.cos(angle) * radius, 420 + Math.random() * 470, Math.sin(angle) * radius);
      cloud.scale.set(1500 + Math.random() * 900, 330 + Math.random() * 150, 1);
      cloud.renderOrder = -130;
      this.cloudMaterials.push(material);
      this.cloudGroup.add(cloud);
    }
    this.skyRoot.add(this.cloudGroup);
    scene.add(this.skyRoot);

    this.sunLight = new THREE.DirectionalLight(0xfff2d8, 2.5);
    this.sunLight.target.position.set(0, 0, 0);
    scene.add(this.sunLight, this.sunLight.target);

    this.moonLight = new THREE.DirectionalLight(0xb5cdf3, 0);
    this.moonLight.target.position.set(0, 0, 0);
    scene.add(this.moonLight, this.moonLight.target);

    this.hemisphere = new THREE.HemisphereLight(0xd9efff, 0x667d45, 2.3);
    scene.add(this.hemisphere);

    this.bounceLight = new THREE.DirectionalLight(0xc8d9cc, 0.32);
    this.bounceLight.position.set(420, 130, -500);
    scene.add(this.bounceLight);

    scene.background = new THREE.Color(DAY_HORIZON);
    this.update(0, null);
  }

  update(dt: number, camera: THREE.Camera | null): void {
    this.phase = (this.phase + dt / DAY.seconds) % 1;

    const theta = (this.phase - 0.25) * Math.PI * 2;
    this.sunDirection.set(Math.cos(theta), Math.sin(theta), 0.38).normalize();
    this.sunAltitude = this.sunDirection.y;

    this.daylight = smoothstep(-0.08, 0.16, this.sunAltitude);
    this.night = 1 - smoothstep(-0.18, 0.06, this.sunAltitude);
    this.golden =
      smoothstep(-0.13, 0.015, this.sunAltitude) *
      (1 - smoothstep(0.12, 0.34, this.sunAltitude));

    const dayFactor = smoothstep(0.08, 0.38, this.sunAltitude);

    const zenith = NIGHT_ZENITH.clone().lerp(DAY_ZENITH, dayFactor).lerp(GOLD_ZENITH, this.golden * 0.7);
    const horizon = NIGHT_HORIZON.clone().lerp(DAY_HORIZON, dayFactor).lerp(GOLD_HORIZON, this.golden * 0.86);
    const ground = NIGHT_HORIZON.clone().multiplyScalar(0.7).lerp(horizon, 0.24);
    const sunGlow = SUN_WARM.clone().lerp(SUN_DAY, smoothstep(0.12, 0.45, this.sunAltitude));

    const uniforms = this.skyMaterial.uniforms;
    (uniforms.uZenith.value as THREE.Color).copy(zenith);
    (uniforms.uHorizon.value as THREE.Color).copy(horizon);
    (uniforms.uGround.value as THREE.Color).copy(ground);
    (uniforms.uGlow.value as THREE.Color).copy(sunGlow);
    (uniforms.uSunDir.value as THREE.Vector3).copy(this.sunDirection);
    uniforms.uGlowStrength.value = 0.18 + this.golden * 1.15;

    this.fogColor.copy(horizon).lerp(DEEP_NIGHT_FOG, this.night * 0.46);
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(this.fogColor);
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(this.fogColor);

    this.sunLight.position.copy(this.sunDirection).multiplyScalar(900);
    this.sunLight.color.copy(SUN_WARM).lerp(SUN_DAY, smoothstep(0.08, 0.4, this.sunAltitude));
    this.sunLight.intensity = 2.55 * smoothstep(-0.035, 0.2, this.sunAltitude);

    const moonDirection = this.sunDirection.clone().negate();
    this.moonLight.position.copy(moonDirection).multiplyScalar(700);
    this.moonLight.intensity = 0.95 * this.night;

    this.hemisphere.color.copy(horizon).lerp(new THREE.Color(0xa8c9ef), 0.4);
    this.hemisphere.groundColor.setHex(0x667d45).lerp(new THREE.Color(0x141d29), this.night);
    this.hemisphere.intensity = 0.5 + this.daylight * 1.86;
    this.bounceLight.intensity = 0.05 + this.daylight * 0.29;

    this.sunSprite.position.copy(this.sunDirection).multiplyScalar(SKY_RADIUS * 0.92);
    this.sunSprite.visible = this.sunAltitude > -0.055;
    (this.sunSprite.material as THREE.SpriteMaterial).opacity = 0.3 + this.daylight * 0.7;

    this.moonSprite.position.copy(moonDirection).multiplyScalar(SKY_RADIUS * 0.9);
    this.moonSprite.visible = moonDirection.y > -0.03;
    (this.moonSprite.material as THREE.SpriteMaterial).opacity = 0.15 + this.night * 0.8;

    this.starMaterial.opacity = this.night * 0.94;
    this.starField.visible = this.night > 0.02;

    for (const material of this.cloudMaterials) {
      material.opacity = 0.04 + this.daylight * 0.15 + this.golden * 0.07;
      material.color.copy(new THREE.Color(0x9fb4d4)).lerp(new THREE.Color(0xfff1e0), this.daylight + this.golden * 0.4);
    }

    this.ridgeTint.copy(DAY_RIDGE).lerp(NIGHT_RIDGE, this.night).lerp(GOLD_RIDGE, this.golden * 0.22);
    this.waterTint.copy(DAY_WATER).lerp(NIGHT_WATER, this.night);
    this.windowGlow = this.night * 0.78 + this.golden * 0.08;

    this.clock = this.formatClock(this.phase);
    this.phaseLabel = this.getPhaseLabel();

    if (camera) this.skyRoot.position.copy(camera.position);
    this.cloudGroup.rotation.y += dt * 0.003;
    this.starField.rotation.y += dt * 0.0015;

    // Rare after-dark meteors. They are kept in the same follow-camera sky
    // root as the stars and stay inactive through the day.
    if (this.night < 0.52) {
      this.shootingCooldown = Math.min(this.shootingCooldown, 38);
    } else if (this.shootingLife <= 0) {
      this.shootingCooldown -= dt;
      if (this.shootingCooldown <= 0) this.spawnShootingStar(camera);
    }
    if (this.shootingLife > 0) {
      this.shootingLife -= dt;
      const positions = this.shootingLine.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < 6; i += 3) {
        this.shootingPositions[i] += this.shootingVelocity.x * dt;
        this.shootingPositions[i + 1] += this.shootingVelocity.y * dt;
        this.shootingPositions[i + 2] += this.shootingVelocity.z * dt;
      }
      positions.needsUpdate = true;
      this.shootingMaterial.opacity = Math.max(0, this.shootingLife / 1.15) * 0.9;
      if (this.shootingLife <= 0) this.shootingLine.visible = false;
    }
  }

  private spawnShootingStar(camera: THREE.Camera | null): void {
    if (!camera) return;
    camera.getWorldDirection(this.aim);
    const startDir = new THREE.Vector3(this.aim.x, 0.28 + Math.random() * 0.38, this.aim.z).normalize();
    const start = startDir.multiplyScalar(STAR_RADIUS * 0.95);
    const side = new THREE.Vector3(-this.aim.z, 0, this.aim.x).normalize();
    const direction = new THREE.Vector3(
      side.x * 0.75 + this.aim.x * 0.28,
      -0.5 - Math.random() * 0.2,
      side.z * 0.75 + this.aim.z * 0.28,
    ).normalize();
    const tail = direction.clone().multiplyScalar(260 + Math.random() * 180);
    this.shootingPositions.set([
      start.x, start.y, start.z,
      start.x + tail.x, start.y + tail.y, start.z + tail.z,
    ]);
    this.shootingVelocity.copy(direction).multiplyScalar(1600);
    (this.shootingLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.shootingMaterial.opacity = 0.9;
    this.shootingLine.visible = true;
    this.shootingLife = 1.15;
    this.shootingCooldown = 55 + Math.random() * 110;
  }

  private formatClock(phase: number): string {
    const totalMinutes = Math.floor(phase * 24 * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  private getPhaseLabel(): string {
    if (this.night > 0.68) return 'NIGHT';
    if (this.golden > 0.38) return this.phase < 0.5 ? 'SUNRISE' : 'GOLDEN HOUR';
    if (this.daylight > 0.56) return 'DAYLIGHT';
    return this.phase < 0.5 ? 'FIRST LIGHT' : 'DUSK';
  }
}
