import * as THREE from 'three';
import { Route } from './route';
import { ROAD, WORLD } from './config';
import {
  makeAsphaltTextures,
  makeEnvironmentTexture,
  makeGlowTexture,
  makeStreakTexture,
  makeWindowTexture,
} from './textures';
import type { Quality } from './types';

const UP = new THREE.Vector3(0, 1, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

interface Lamp {
  head: THREE.Vector3;
  tangent: THREE.Vector3;
}

interface Gate {
  strip: THREE.MeshBasicMaterial;
  frame: THREE.Group;
}

interface SignalState {
  materials: Record<'red' | 'amber' | 'green', THREE.MeshBasicMaterial>;
  halos: Record<'red' | 'amber' | 'green', THREE.Mesh>;
  pool: THREE.Mesh;
  poolMaterial: THREE.MeshBasicMaterial;
  phase: number;
}

interface Gantry {
  group: THREE.Group;
  signals: SignalState[];
}

/** Wet dusk highway: procedural road, sodium lamps, signals, skyline and gates. */
export class DrivingWorld {
  readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly route: Route;
  private quality: Quality;

  private sky!: THREE.Mesh;
  private moon!: THREE.DirectionalLight;
  private moonTarget = new THREE.Object3D();
  private readonly lamps: Lamp[] = [];
  private readonly lampLights: THREE.PointLight[] = [];
  private readonly gantries: Gantry[] = [];
  private readonly gates: Gate[] = [];
  private activeGate = 0;
  private time = 0;
  private lampTimer = 0;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, route: Route, quality: Quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.route = route;
    this.quality = quality;

    scene.fog = new THREE.Fog(WORLD.fogColor, WORLD.fogNear, WORLD.fogFar);
    scene.background = new THREE.Color(0x05070c);

    this.buildEnvironment();
    this.buildSky();
    this.buildCoreLights();
    this.buildGround();
    this.buildRoad();
    this.buildMarkings();
    this.buildRails();
    this.buildLamps();
    this.buildTrafficLights();
    this.buildGates();
    this.buildCity();
    this.buildHills();
    this.setQuality(quality);
  }

  private buildEnvironment(): void {
    const environment = makeEnvironmentTexture();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const target = pmrem.fromEquirectangular(environment);
    this.scene.environment = target.texture;
    this.scene.environmentIntensity = 0.8;
    environment.dispose();
    pmrem.dispose();
  }

  private buildSky(): void {
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x03060f) },
        uHorizon: { value: new THREE.Color(0x223049) },
        uGlow: { value: new THREE.Color(0xff8c4c) },
        uGlowDir: { value: new THREE.Vector3(-0.92, 0.05, 0.25).normalize() },
        uMoonDir: { value: new THREE.Vector3(0.36, 0.52, -0.78).normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uGlow;
        uniform vec3 uGlowDir;
        uniform vec3 uMoonDir;
        varying vec3 vDir;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          vec3 dir = normalize(vDir);
          float y = dir.y;
          float t = pow(clamp(y, 0.0, 1.0), 0.58);
          vec3 color = mix(uHorizon, uTop, t);

          float dusk = pow(max(dot(dir, normalize(uGlowDir)), 0.0), 5.0);
          color += uGlow * dusk * 0.62;
          color += uGlow * pow(max(0.0, 1.0 - abs(y)), 14.0) * 0.1;

          float moonDot = max(dot(dir, normalize(uMoonDir)), 0.0);
          color += vec3(0.80, 0.87, 1.0) * pow(moonDot, 2400.0) * 2.2;
          color += vec3(0.26, 0.38, 0.62) * pow(moonDot, 55.0) * 0.14;

          vec3 starDir = dir * 240.0;
          float star = step(0.9976, hash(floor(starDir.xz + starDir.y)));
          star *= smoothstep(0.05, 0.3, y);
          color += vec3(0.68, 0.8, 1.0) * star * 0.8;

          color = mix(vec3(0.015, 0.02, 0.03), color, smoothstep(-0.18, 0.02, y));
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 20), material);
    this.sky.renderOrder = -100;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  private buildCoreLights(): void {
    const hemisphere = new THREE.HemisphereLight(0x3b4f72, 0x05070a, 0.55);
    this.scene.add(hemisphere);

    const ambient = new THREE.AmbientLight(0x27364d, 0.35);
    this.scene.add(ambient);

    this.moon = new THREE.DirectionalLight(0x9fb9e8, 0.75);
    this.moon.position.set(80, 160, 60);
    this.moon.castShadow = true;
    this.moon.shadow.camera.left = -55;
    this.moon.shadow.camera.right = 55;
    this.moon.shadow.camera.top = 55;
    this.moon.shadow.camera.bottom = -55;
    this.moon.shadow.camera.near = 1;
    this.moon.shadow.camera.far = 420;
    this.moon.shadow.mapSize.set(1024, 1024);
    this.moon.shadow.bias = -0.0008;
    this.moon.shadow.normalBias = 0.03;
    this.moon.target = this.moonTarget;
    this.scene.add(this.moon);
    this.scene.add(this.moonTarget);

    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(WORLD.lampColor, 180, 34, 2);
      light.castShadow = false;
      this.scene.add(light);
      this.lampLights.push(light);
    }
  }

  private buildGround(): void {
    const material = new THREE.MeshStandardMaterial({ color: 0x05070b, roughness: 0.96, metalness: 0.05 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2800, 2800), material);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private ribbon(minOffset: number, maxOffset: number, y: number, alongScale = 0.12): THREE.BufferGeometry {
    const frames = this.route.frames;
    const n = frames.length;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= n; i++) {
      const frame = frames[i % n];
      const distance = i === n ? this.route.length : frame.distance;
      for (const offset of [minOffset, maxOffset]) {
        positions.push(
          frame.position.x + frame.right.x * offset,
          y,
          frame.position.z + frame.right.z * offset,
        );
        uvs.push(offset === minOffset ? 0 : 1, distance * alongScale);
      }
    }

    for (let i = 0; i < n; i++) {
      const a0 = i * 2;
      const b0 = a0 + 1;
      const a1 = a0 + 2;
      const b1 = a0 + 3;
      indices.push(a0, b0, a1, b0, b1, a1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private railBand(offset: number, y0: number, y1: number): THREE.BufferGeometry {
    const frames = this.route.frames;
    const n = frames.length;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= n; i++) {
      const frame = frames[i % n];
      const distance = i === n ? this.route.length : frame.distance;
      const x = frame.position.x + frame.right.x * offset;
      const z = frame.position.z + frame.right.z * offset;
      positions.push(x, y0, z, x, y1, z);
      uvs.push(distance * 0.08, 0, distance * 0.08, 1);
    }

    for (let i = 0; i < n; i++) {
      const a0 = i * 2;
      const b0 = a0 + 1;
      const a1 = a0 + 2;
      const b1 = a0 + 3;
      indices.push(a0, a1, b0, b0, a1, b1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private buildRoad(): void {
    const { map, roughnessMap } = makeAsphaltTextures();
    map.repeat.set(3, 1);
    roughnessMap.repeat.set(3, 1);

    const material = new THREE.MeshPhysicalMaterial({
      map,
      roughnessMap,
      color: 0xffffff,
      roughness: 1,
      metalness: 0.42,
      clearcoat: 0.9,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1.25,
    });

    const road = new THREE.Mesh(this.ribbon(-ROAD.halfWidth, ROAD.halfWidth, 0.012), material);
    road.receiveShadow = true;
    road.name = 'wet-asphalt';
    this.scene.add(road);

    const shoulderMaterial = new THREE.MeshStandardMaterial({
      color: 0x080a0e,
      roughness: 0.9,
      metalness: 0.1,
    });
    for (const side of [-1, 1]) {
      const inner = side * (ROAD.halfWidth + 0.01);
      const outer = side * (ROAD.halfWidth + 1.6);
      const shoulder = new THREE.Mesh(this.ribbon(Math.min(inner, outer), Math.max(inner, outer), 0.008, 0.2), shoulderMaterial);
      shoulder.receiveShadow = true;
      this.scene.add(shoulder);
    }
  }

  private lineMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xd6dde8,
      roughness: 0.55,
      metalness: 0.05,
      emissive: 0x2a3039,
      emissiveIntensity: 0.75,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  private dashedBand(offset: number, width: number, dash: number, gap: number): THREE.BufferGeometry {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const steps = 3;

    for (let start = 0; start < this.route.length; start += dash + gap) {
      const base = positions.length / 3;
      for (let s = 0; s <= steps; s++) {
        const distance = start + (s / steps) * dash;
        const frame = this.route.frameAt(distance);
        for (const edge of [-1, 1]) {
          const lateral = offset + edge * width * 0.5;
          positions.push(
            frame.position.x + frame.right.x * lateral,
            0.022,
            frame.position.z + frame.right.z * lateral,
          );
          uvs.push(edge > 0 ? 1 : 0, s / steps);
        }
      }
      for (let s = 0; s < steps; s++) {
        const a0 = base + s * 2;
        const b0 = a0 + 1;
        const a1 = a0 + 2;
        const b1 = a0 + 3;
        indices.push(a0, b0, a1, b0, b1, a1);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private buildMarkings(): void {
    const material = this.lineMaterial();

    for (const lane of [-1.8, 1.8]) {
      const dashes = new THREE.Mesh(this.dashedBand(lane, 0.13, 6.5, 9), material);
      dashes.receiveShadow = true;
      dashes.name = 'lane-marking';
      this.scene.add(dashes);
    }

    for (const edge of [-5.4, 5.4]) {
      const line = new THREE.Mesh(this.ribbon(edge - 0.075, edge + 0.075, 0.022, 0.2), material);
      line.receiveShadow = true;
      this.scene.add(line);
    }
  }

  private buildRails(): void {
    const railMaterial = new THREE.MeshStandardMaterial({
      color: 0x2d333c,
      roughness: 0.34,
      metalness: 0.9,
      side: THREE.DoubleSide,
      envMapIntensity: 1.35,
    });
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x171b21, roughness: 0.5, metalness: 0.75 });

    for (const side of [-1, 1]) {
      const offset = side * ROAD.railOffset;
      const rail = new THREE.Mesh(this.railBand(offset, 0.48, 0.8), railMaterial);
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.scene.add(rail);

      const topRail = new THREE.Mesh(this.railBand(offset, 0.82, 0.88), railMaterial);
      topRail.castShadow = true;
      this.scene.add(topRail);
    }

    const postCount = Math.floor(this.route.length / 6) * 2;
    const postGeometry = new THREE.BoxGeometry(0.09, 0.86, 0.09);
    const posts = new THREE.InstancedMesh(postGeometry, postMaterial, postCount);
    posts.castShadow = true;
    const dummy = new THREE.Object3D();
    let index = 0;
    for (const side of [-1, 1]) {
      for (let distance = 0; distance < this.route.length && index < postCount; distance += 6) {
        const frame = this.route.frameAt(distance);
        dummy.position.set(
          frame.position.x + frame.right.x * side * ROAD.railOffset,
          0.43,
          frame.position.z + frame.right.z * side * ROAD.railOffset,
        );
        dummy.rotation.set(0, Math.atan2(frame.tangent.x, frame.tangent.z), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        posts.setMatrixAt(index++, dummy.matrix);
      }
    }
    posts.count = index;
    posts.instanceMatrix.needsUpdate = true;
    this.scene.add(posts);

    const reflectorPositions: number[] = [];
    for (const side of [-1, 1]) {
      for (let distance = 0; distance < this.route.length; distance += 17) {
        const frame = this.route.frameAt(distance);
        reflectorPositions.push(
          frame.position.x + frame.right.x * side * (ROAD.railOffset - 0.035),
          0.66,
          frame.position.z + frame.right.z * side * (ROAD.railOffset - 0.035),
        );
      }
    }
    const reflectorGeometry = new THREE.BufferGeometry();
    reflectorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(reflectorPositions, 3));
    const reflectorMaterial = new THREE.PointsMaterial({
      color: 0xffb257,
      size: 0.32,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      map: makeGlowTexture(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.scene.add(new THREE.Points(reflectorGeometry, reflectorMaterial));
  }

  private buildLamps(): void {
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x1a2027, roughness: 0.48, metalness: 0.8 });
    const headMaterial = new THREE.MeshBasicMaterial({ color: 0xffd29a, toneMapped: false });
    const armMaterial = new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: 0.4, metalness: 0.85 });

    const sides = [1, -1];
    for (const side of sides) {
      const start = side > 0 ? 20 : 43;
      for (let distance = start; distance < this.route.length; distance += 47) {
        const frame = this.route.frameAt(distance);
        const inward = frame.right.clone().multiplyScalar(-side);
        const polePosition = frame.position.clone().addScaledVector(frame.right, side * (ROAD.railOffset + 0.9));
        const headPosition = polePosition.clone().addScaledVector(inward, 2.4);
        headPosition.y = 8.38;
        this.lamps.push({ head: headPosition, tangent: frame.tangent.clone() });
      }
    }

    const poleGeometry = new THREE.CylinderGeometry(0.065, 0.11, 8.5, 7);
    const armGeometry = new THREE.BoxGeometry(2.45, 0.08, 0.09);
    const headGeometry = new THREE.BoxGeometry(0.55, 0.09, 0.24);
    const glowBarGeometry = new THREE.BoxGeometry(0.46, 0.022, 0.18);

    const poles = new THREE.InstancedMesh(poleGeometry, poleMaterial, this.lamps.length);
    const arms = new THREE.InstancedMesh(armGeometry, armMaterial, this.lamps.length);
    const heads = new THREE.InstancedMesh(headGeometry, headMaterial, this.lamps.length);
    const glowBars = new THREE.InstancedMesh(glowBarGeometry, headMaterial, this.lamps.length);
    poles.castShadow = true;

    const dummy = new THREE.Object3D();
    const streakMaterial = new THREE.MeshBasicMaterial({
      map: makeStreakTexture(),
      color: 0xffb066,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const streakGeometry = new THREE.PlaneGeometry(2.8, 12);
    streakGeometry.rotateX(-Math.PI / 2);
    const streaks = new THREE.InstancedMesh(streakGeometry, streakMaterial, this.lamps.length);
    streaks.renderOrder = 2;

    this.lamps.forEach((lamp, index) => {
      // Reconstruct the pole position from the head: the arm reaches 2.4m inward.
      const frame = this.route.nearest(lamp.head);
      const side = frame.offset > 0 ? 1 : -1;
      const pole = lamp.head.clone().sub(frame.frame.right.clone().multiplyScalar(-side * 2.4));
      pole.y = 0;

      dummy.position.set(pole.x, 4.25, pole.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poles.setMatrixAt(index, dummy.matrix);

      const inward = frame.frame.right.clone().multiplyScalar(-side);
      const yaw = Math.atan2(-inward.z, inward.x);
      dummy.position.set(pole.x + inward.x * 1.25, 8.23, pole.z + inward.z * 1.25);
      dummy.rotation.set(0, yaw, 0);
      dummy.updateMatrix();
      arms.setMatrixAt(index, dummy.matrix);

      dummy.position.copy(lamp.head);
      dummy.position.y = 8.31;
      dummy.rotation.set(0, yaw, 0);
      dummy.updateMatrix();
      heads.setMatrixAt(index, dummy.matrix);

      dummy.position.copy(lamp.head);
      dummy.position.y = 8.26;
      dummy.rotation.set(0, yaw, 0);
      dummy.updateMatrix();
      glowBars.setMatrixAt(index, dummy.matrix);

      dummy.position.set(lamp.head.x, 0.03, lamp.head.z);
      dummy.rotation.set(0, Math.atan2(lamp.tangent.x, lamp.tangent.z), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      streaks.setMatrixAt(index, dummy.matrix);
    });

    for (const mesh of [poles, arms, heads, glowBars, streaks]) {
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
    }
    poles.castShadow = true;

    const glowGeometry = new THREE.BufferGeometry();
    const glowPositions = new Float32Array(this.lamps.length * 3);
    this.lamps.forEach((lamp, i) => {
      glowPositions[i * 3] = lamp.head.x;
      glowPositions[i * 3 + 1] = lamp.head.y - 0.06;
      glowPositions[i * 3 + 2] = lamp.head.z;
    });
    glowGeometry.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3));
    const glowMaterial = new THREE.PointsMaterial({
      map: makeGlowTexture(),
      color: 0xffc88d,
      size: 4.4,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.scene.add(new THREE.Points(glowGeometry, glowMaterial));
  }

  private signalMaterials(): { materials: SignalState['materials']; halos: SignalState['halos'] } {
    const colors = {
      red: 0xff4538,
      amber: 0xffb257,
      green: 0x52ffa8,
    } as const;
    const materials = {} as SignalState['materials'];
    const halos = {} as SignalState['halos'];
    const glow = makeGlowTexture();

    for (const key of ['red', 'amber', 'green'] as const) {
      materials[key] = new THREE.MeshBasicMaterial({ color: 0x171a1f, toneMapped: false });
      const halo = new THREE.Mesh(
        new THREE.PlaneGeometry(0.85, 0.85),
        new THREE.MeshBasicMaterial({
          map: glow,
          color: colors[key],
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      halos[key] = halo;
    }
    return { materials, halos };
  }

  private buildTrafficLights(): void {
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x1c222a, roughness: 0.45, metalness: 0.8 });
    const beamMaterial = postMaterial;
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0x0a0d11, roughness: 0.6, metalness: 0.3 });

    const distances = [0.19, 0.47, 0.74].map((fraction) => this.route.length * fraction);
    distances.forEach((distance, gantryIndex) => {
      const frame = this.route.frameAt(distance);
      const group = new THREE.Group();
      group.position.copy(frame.position);
      group.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().lookAt(new THREE.Vector3(), frame.tangent, UP),
      );
      this.scene.add(group);

      const postHeight = 6.3;
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, postHeight, 8), postMaterial);
        post.position.set(side * 9, postHeight / 2, 0);
        post.castShadow = true;
        group.add(post);
      }

      const beam = new THREE.Mesh(new THREE.BoxGeometry(18.3, 0.24, 0.26), beamMaterial);
      beam.position.set(0, 6.2, 0);
      beam.castShadow = true;
      group.add(beam);

      const signals: SignalState[] = [];
      for (const lateral of [-3.6, 3.6]) {
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.3, 0.34), headMaterial);
        head.position.set(lateral, 5.32, 0);
        head.castShadow = true;
        group.add(head);

        const { materials, halos } = this.signalMaterials();
        const lampColors = {
          red: 0.4,
          amber: 0,
          green: -0.4,
        } as const;

        for (const key of ['red', 'amber', 'green'] as const) {
          const lens = new THREE.Mesh(new THREE.CircleGeometry(0.145, 18), materials[key]);
          lens.position.set(lateral, 5.32 + lampColors[key], 0.18);
          group.add(lens);

          halos[key].position.set(lateral, 5.32 + lampColors[key], 0.2);
          group.add(halos[key]);
        }

        const poolMaterial = new THREE.MeshBasicMaterial({
          map: makeStreakTexture(),
          color: 0xff4538,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 16), poolMaterial);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(lateral, 0.03, 0);
        group.add(pool);

        signals.push({
          materials,
          halos,
          pool,
          poolMaterial,
          phase: (gantryIndex * 5.7 + (lateral > 0 ? 2.1 : 0)) % 18,
        });
      }

      this.gantries.push({ group, signals });
    });
  }

  private sectorTexture(index: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is unavailable');
    ctx.fillStyle = 'rgba(4,7,11,0.82)';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = 'rgba(255,178,87,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(5, 5, 246, 118);
    ctx.fillStyle = 'rgba(255,178,87,0.85)';
    ctx.font = '500 15px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SECTOR', 128, 34);
    ctx.fillStyle = '#f2f6fb';
    ctx.font = '600 62px "Barlow Condensed", sans-serif';
    ctx.fillText(String(index).padStart(2, '0'), 128, 100);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private buildGates(): void {
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x1c232b, roughness: 0.4, metalness: 0.8 });
    const signMaterial = new THREE.MeshStandardMaterial({ color: 0x06080b, roughness: 0.7, metalness: 0.2 });

    this.route.gateDistances.forEach((distance, index) => {
      const frame = this.route.frameAt(distance);
      const group = new THREE.Group();
      group.position.copy(frame.position);
      group.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().lookAt(new THREE.Vector3(), frame.tangent, UP),
      );
      this.scene.add(group);

      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 6.2, 0.22), frameMaterial);
        post.position.set(side * 7.9, 3.1, 0);
        post.castShadow = true;
        post.receiveShadow = true;
        group.add(post);
      }

      const beam = new THREE.Mesh(new THREE.BoxGeometry(16.4, 0.22, 0.26), frameMaterial);
      beam.position.set(0, 6.26, 0);
      beam.castShadow = true;
      group.add(beam);

      const stripMaterial = new THREE.MeshBasicMaterial({
        color: 0x2d4b5e,
        transparent: true,
        opacity: 0.25,
        toneMapped: false,
      });
      const strip = new THREE.Mesh(new THREE.BoxGeometry(16, 0.06, 0.09), stripMaterial);
      strip.position.set(0, 6.12, 0.04);
      group.add(strip);

      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.72, 0.06), signMaterial);
      sign.position.set(0, 6.3, 0.17);
      group.add(sign);

      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 0.7),
        new THREE.MeshBasicMaterial({ map: this.sectorTexture(index + 1), transparent: true, toneMapped: false }),
      );
      label.position.set(0, 6.3, 0.205);
      group.add(label);

      this.gates.push({ strip: stripMaterial, frame: group });
    });
  }

  private buildCity(): void {
    const count = 120;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: 0x070a10,
      roughness: 0.9,
      metalness: 0.18,
      emissive: 0xffffff,
      emissiveMap: makeWindowTexture(),
      emissiveIntensity: 0.85,
    });
    const buildings = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      // Keep every footprint inside the infield of the loop.
      const radius = 30 + Math.random() * 130;
      const height = 18 + Math.pow(Math.random(), 1.6) * 118;
      const width = 8 + Math.random() * 14;
      const depth = 8 + Math.random() * 14;
      dummy.position.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();
      buildings.setMatrixAt(i, dummy.matrix);
    }
    buildings.instanceMatrix.needsUpdate = true;
    buildings.castShadow = false;
    buildings.receiveShadow = false;
    this.scene.add(buildings);
  }

  private buildHills(): void {
    const material = new THREE.MeshStandardMaterial({
      color: 0x070b12,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    });
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + 0.4;
      // Base radii start well outside the widest point of the highway loop.
      const radius = 620 + Math.random() * 220;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(120 + Math.random() * 100, 45 + Math.random() * 60, 5), material);
      cone.position.set(Math.cos(angle) * radius, 10, Math.sin(angle) * radius);
      cone.rotation.y = Math.random() * Math.PI;
      this.scene.add(cone);
    }
  }

  setQuality(quality: Quality): void {
    this.quality = quality;
    const activeLights = quality === 'low' ? 2 : quality === 'medium' ? 3 : 4;
    this.lampLights.forEach((light, index) => {
      light.visible = index < activeLights;
    });
    this.moon.castShadow = quality !== 'low';
    const shadowSize = quality === 'high' ? 2048 : 1024;
    if (this.moon.shadow.mapSize.x !== shadowSize) {
      this.moon.shadow.mapSize.set(shadowSize, shadowSize);
      if (this.moon.shadow.map) {
        this.moon.shadow.map.dispose();
        this.moon.shadow.map = null;
      }
    }
  }

  setActiveGate(index: number): void {
    this.activeGate = index;
    this.gates.forEach((gate, gateIndex) => {
      const isActive = gateIndex === index;
      gate.strip.color.setHex(isActive ? 0xffb257 : 0x2d4b5e);
      gate.strip.opacity = isActive ? 0.9 : 0.22;
    });
  }

  private updateLampLights(focus: THREE.Vector3): void {
    if (this.lamps.length === 0) return;
    const nearest = this.lamps
      .map((lamp, index) => ({ index, distance: lamp.head.distanceToSquared(focus) }))
      .sort((a, b) => a.distance - b.distance);

    const activeLights = this.lampLights.filter((light) => light.visible);
    activeLights.forEach((light, slot) => {
      const lamp = this.lamps[nearest[slot]?.index ?? 0];
      if (!lamp) return;
      light.position.copy(lamp.head);
      light.position.y -= 0.15;
    });
  }

  private updateSignals(): void {
    for (const gantry of this.gantries) {
      for (const signal of gantry.signals) {
        const local = (this.time + signal.phase) % 18;
        const state: 'red' | 'amber' | 'green' = local < 9 ? 'green' : local < 11.5 ? 'amber' : 'red';
        const bright = {
          red: new THREE.Color(0xff4538),
          amber: new THREE.Color(0xffb257),
          green: new THREE.Color(0x52ffa8),
        }[state];
        const dim = new THREE.Color(0x171a1f);

        for (const key of ['red', 'amber', 'green'] as const) {
          signal.materials[key].color.copy(key === state ? bright : dim);
          const haloMaterial = signal.halos[key].material as THREE.MeshBasicMaterial;
          haloMaterial.opacity = key === state ? 0.75 : 0;
        }
        signal.poolMaterial.color.copy(bright);
        signal.poolMaterial.opacity = 0.28;
      }
    }
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera): void {
    this.time += dt;
    this.sky.position.copy(camera.position);

    this.moon.position.set(focus.x + 80, 160, focus.z + 60);
    this.moonTarget.position.copy(focus);
    this.moonTarget.updateMatrixWorld();

    this.lampTimer -= dt;
    if (this.lampTimer <= 0) {
      this.lampTimer = 0.35;
      this.updateLampLights(focus);
      this.updateSignals();
    }

    const active = this.gates[this.activeGate];
    if (active) {
      active.strip.opacity = 0.72 + Math.sin(this.time * 4.5) * 0.18;
    }
  }
}
