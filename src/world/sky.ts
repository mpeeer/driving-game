import * as THREE from 'three';
import { clamp, smoothstep } from '../core/util';
import { cloudTexture, glowTexture } from './textures';

export interface SkyPreset {
  top: number;
  horizon: number;
  fog: number;
  sun: number;
  sunIntensity: number;
  ambient: number;
  hemiSky: number;
  hemiGround: number;
  night: number;
  exposure: number;
}

const PRESETS: Record<string, SkyPreset> = {
  night: { top: 0x050912, horizon: 0x101a2a, fog: 0x0b1220, sun: 0x9db4d8, sunIntensity: 0.22, ambient: 0.32, hemiSky: 0x22334d, hemiGround: 0x0a0d12, night: 1, exposure: 1.05 },
  dawn: { top: 0x233a66, horizon: 0xf3a074, fog: 0x8d8b94, sun: 0xffc89a, sunIntensity: 1.75, ambient: 0.55, hemiSky: 0x9db6d8, hemiGround: 0x47392c, night: 0.35, exposure: 1.1 },
  day: { top: 0x2f6fd0, horizon: 0xcfe3f0, fog: 0xbdd2e2, sun: 0xfff4dc, sunIntensity: 2.75, ambient: 0.75, hemiSky: 0xbcd8f2, hemiGround: 0x54493a, night: 0, exposure: 1.0 },
  dusk: { top: 0x1b2748, horizon: 0xff8455, fog: 0x6c6b80, sun: 0xffab70, sunIntensity: 1.3, ambient: 0.45, hemiSky: 0x7d8db3, hemiGround: 0x3b3129, night: 0.55, exposure: 1.08 },
};

function presetForHour(hour: number): SkyPreset {
  const h = ((hour % 24) + 24) % 24;
  if (h < 4.6 || h > 21.4) return PRESETS.night;
  if (h < 7.0) {
    const t = smoothstep(4.6, 7.0, h);
    return mixPreset(PRESETS.night, PRESETS.dawn, t);
  }
  if (h < 9.6) return mixPreset(PRESETS.dawn, PRESETS.day, smoothstep(7.0, 9.6, h));
  if (h < 16.8) return PRESETS.day;
  if (h < 19.0) return mixPreset(PRESETS.day, PRESETS.dusk, smoothstep(16.8, 19.0, h));
  if (h < 21.4) return mixPreset(PRESETS.dusk, PRESETS.night, smoothstep(19.0, 21.4, h));
  return PRESETS.night;
}

function mixPreset(a: SkyPreset, b: SkyPreset, t: number): SkyPreset {
  const ca = new THREE.Color(a.top);
  const cb = new THREE.Color(b.top);
  const ha = new THREE.Color(a.horizon);
  const hb = new THREE.Color(b.horizon);
  const fa = new THREE.Color(a.fog);
  const fb = new THREE.Color(b.fog);
  const sa = new THREE.Color(a.sun);
  const sb = new THREE.Color(b.sun);
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    top: ca.lerp(cb, t).getHex(),
    horizon: ha.lerp(hb, t).getHex(),
    fog: fa.lerp(fb, t).getHex(),
    sun: sa.lerp(sb, t).getHex(),
    sunIntensity: mix(a.sunIntensity, b.sunIntensity),
    ambient: mix(a.ambient, b.ambient),
    hemiSky: new THREE.Color(a.hemiSky).lerp(new THREE.Color(b.hemiSky), t).getHex(),
    hemiGround: new THREE.Color(a.hemiGround).lerp(new THREE.Color(b.hemiGround), t).getHex(),
    night: mix(a.night, b.night),
    exposure: mix(a.exposure, b.exposure),
  };
}

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 sunColor;
uniform vec3 sunDir;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  float t = smoothstep(-0.05, 0.72, dir.y);
  vec3 col = mix(horizonColor, topColor, t);
  float d = max(dot(dir, normalize(sunDir)), 0.0);
  col += sunColor * pow(d, 260.0) * 0.9;
  col += sunColor * pow(d, 10.0) * 0.06;
  float haze = smoothstep(0.3, -0.05, dir.y);
  col = mix(col, horizonColor, haze * 0.45);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class SkySystem {
  readonly group = new THREE.Group();
  readonly sunLight: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  sunDir = new THREE.Vector3(0.4, 0.8, 0.2);
  night = 0;
  preset: SkyPreset = PRESETS.day;

  private domeMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private sunSprite: THREE.Sprite;
  private clouds: THREE.Sprite[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group.name = 'sky';
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x2f6fd0) },
        horizonColor: { value: new THREE.Color(0xcfe3f0) },
        sunColor: { value: new THREE.Color(0xfff4dc) },
        sunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2) },
      },
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4200, 32, 16), this.domeMat);
    dome.frustumCulled = false;
    dome.renderOrder = -10;
    this.group.add(dome);

    this.sunLight = new THREE.DirectionalLight(0xfff4dc, 2.7);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 360;
    this.sunLight.shadow.camera.left = -110;
    this.sunLight.shadow.camera.right = 110;
    this.sunLight.shadow.camera.top = 110;
    this.sunLight.shadow.camera.bottom = -110;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.04;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    this.hemi = new THREE.HemisphereLight(0xbcd8f2, 0x54493a, 0.85);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.28);
    scene.add(this.ambient);

    const starGeo = new THREE.BufferGeometry();
    const starPos: number[] = [];
    for (let i = 0; i < 1200; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.95);
      const r = 3600;
      starPos.push(Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r, Math.sin(phi) * Math.sin(theta) * r);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xdfe9ff, size: 3.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(starGeo, starMat);
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    const glow = glowTexture();
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff3cd, transparent: true, depthWrite: false, depthTest: false, fog: false, opacity: 0.85 }));
    this.sunSprite.scale.set(320, 320, 1);
    this.sunSprite.renderOrder = -9;
    this.group.add(this.sunSprite);

    for (let i = 0; i < 20; i++) {
      const mat = new THREE.SpriteMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, opacity: 0.42, fog: false, color: 0xffffff });
      const s = new THREE.Sprite(mat);
      const ang = Math.random() * Math.PI * 2;
      const rad = 900 + Math.random() * 1500;
      s.position.set(Math.cos(ang) * rad, 260 + Math.random() * 260, Math.sin(ang) * rad);
      const sc = 420 + Math.random() * 520;
      s.scale.set(sc, sc * 0.4, 1);
      s.renderOrder = -8;
      this.clouds.push(s);
      this.group.add(s);
    }

    scene.add(this.group);
  }

  setHour(hour: number): void {
    const preset = presetForHour(hour);
    this.preset = preset;
    const top = new THREE.Color(preset.top);
    const horizon = new THREE.Color(preset.horizon);
    const fog = new THREE.Color(preset.fog);
    const sunColor = new THREE.Color(preset.sun);
    this.domeMat.uniforms.topColor.value.copy(top);
    this.domeMat.uniforms.horizonColor.value.copy(horizon);
    this.domeMat.uniforms.sunColor.value.copy(sunColor);
    this.night = preset.night;

    this.sunLight.color.copy(sunColor);
    this.sunLight.intensity = preset.sunIntensity;
    this.hemi.color.setHex(preset.hemiSky);
    this.hemi.groundColor.setHex(preset.hemiGround);
    this.hemi.intensity = 0.5 + preset.ambient * 0.65;
    this.ambient.intensity = 0.12 + preset.ambient * 0.4;
    this.ambient.color.copy(new THREE.Color(preset.hemiSky).lerp(new THREE.Color(0xffffff), 0.6));

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(fog);
    } else {
      this.scene.fog = new THREE.Fog(fog, 220, 1400);
    }
    const fogRange = this.scene.fog as THREE.Fog;
    fogRange.near = 120 + preset.night * 60;
    fogRange.far = 1500 - preset.night * 450;

    (this.stars.material as THREE.PointsMaterial).opacity = clamp(preset.night * 1.2, 0, 1);
    this.stars.visible = preset.night > 0.15;
    this.sunSprite.material.opacity = 0.6 - preset.night * 0.45;
    this.sunSprite.material.color.copy(sunColor);
    for (const c of this.clouds) {
      c.material.color.copy(new THREE.Color(0xffffff).lerp(horizon, 0.4 + preset.night * 0.4));
      c.material.opacity = 0.28 + (1 - preset.night) * 0.28;
    }

    // Elevation curve; sun off-axis to get attractive long shadows.
    const t = ((hour - 6) / 12) * Math.PI;
    const elev = Math.sin(t);
    this.sunDir.set(Math.cos(t) * 0.82, Math.max(-0.25, elev), 0.42).normalize();
    this.domeMat.uniforms.sunDir.value.copy(this.sunDir);
    this.sunSprite.position.copy(this.sunDir).multiplyScalar(3200);
    this.sunSprite.visible = this.sunDir.y > -0.15;
    this.sunLight.position.copy(this.sunDir).multiplyScalar(180);
    this.sunLight.castShadow = preset.sunIntensity > 0.5;
  }

  /** Keep the sky dome centred on the camera so it never runs out of sky. */
  follow(cameraPos: THREE.Vector3): void {
    this.group.position.copy(cameraPos);
  }

  /** Keep shadow frustum around the action. */
  focus(target: THREE.Vector3): void {
    this.sunLight.target.position.copy(target);
    this.sunLight.position.copy(target).addScaledVector(this.sunDir, 180);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.updateMatrixWorld();
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.scene.remove(this.sunLight);
    this.scene.remove(this.sunLight.target);
    this.scene.remove(this.hemi);
    this.scene.remove(this.ambient);
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    this.domeMat.dispose();
  }
}
