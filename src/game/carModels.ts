import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { CAR } from './config';
import type { CarId } from './types';

export interface CarModelDef {
  id: CarId;
  name: string;
  eyebrow: string;
  format: 'fbx' | 'obj';
  file: string;
  mtl?: string;
  /** Overall nose-to-tail length in metres. */
  length: number;
  /** Y rotation applied so the model's nose points down local -Z. */
  rotation: number;
}

export const CAR_MODELS: CarModelDef[] = [
  {
    id: 'camaro',
    name: 'Camaro SS',
    eyebrow: 'Chevrolet · muscle',
    format: 'obj',
    file: 'camaro.obj',
    mtl: 'camaro.mtl',
    length: 4.78,
    rotation: Math.PI,
  },
  {
    id: 'koenigsegg',
    name: 'Koenigsegg',
    eyebrow: 'Carbon · hypercar',
    format: 'fbx',
    file: 'koenigsegg.fbx',
    length: 4.55,
    rotation: Math.PI,
  },
  {
    id: 'mercedes',
    name: 'GLS 580',
    eyebrow: 'Mercedes-Benz · SUV',
    format: 'fbx',
    file: 'mercedes-gls.fbx',
    length: 5.2,
    rotation: Math.PI,
  },
];

const BY_ID = new Map<CarId, CarModelDef>(CAR_MODELS.map((model) => [model.id, model]));

export function carModelDef(id: CarId): CarModelDef {
  return BY_ID.get(id) ?? CAR_MODELS[0];
}

export function carModelName(id: CarId): string {
  return carModelDef(id).name;
}

export interface CarWheelRig {
  steer: THREE.Group;
  spin: THREE.Group;
  front: boolean;
}

export interface LoadedCarModel {
  id: CarId;
  group: THREE.Group;
  wheels: CarWheelRig[];
  length: number;
}

const MODEL_ROOT = new URL('models/', document.baseURI).href;
const cache = new Map<CarId, Promise<LoadedCarModel>>();

/**
 * Loads one of the supplied car bodies and fits it to the player's physics
 * footprint. The wrapper keeps the original file's transforms intact; only the
 * outer group is scaled, rotated and centered.
 */
export function loadCarModel(id: CarId): Promise<LoadedCarModel> {
  const cached = cache.get(id);
  if (cached) return cached;

  const promise = buildCarModel(carModelDef(id)).catch((error: unknown) => {
    cache.delete(id);
    throw error;
  });
  cache.set(id, promise);
  return promise;
}

async function buildCarModel(def: CarModelDef): Promise<LoadedCarModel> {
  const source = def.format === 'fbx' ? await loadFbx(def) : await loadObj(def);

  stripSceneHelpers(source);
  if (def.id === 'koenigsegg') stripKoenigseggStray(source);
  tuneMaterials(source);
  if (def.id === 'koenigsegg') tuneKoenigseggMaterials(source);
  consolidateMaterialGroups(source);
  const wheels = rigWheels(source);

  const group = new THREE.Group();
  group.name = `player-body-${def.id}`;
  group.add(source);
  group.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(source);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = def.length / Math.max(0.001, size.z);
  group.scale.setScalar(scale);
  group.rotation.y = def.rotation;
  group.updateMatrixWorld(true);

  const fitted = new THREE.Box3().setFromObject(group);
  const center = fitted.getCenter(new THREE.Vector3());
  group.position.set(
    -center.x,
    -CAR.startHeight - fitted.min.y,
    -center.z,
  );
  group.updateMatrixWorld(true);

  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
  });

  return { id: def.id, group, wheels, length: def.length };
}

async function loadFbx(def: CarModelDef): Promise<THREE.Group> {
  const response = await fetch(MODEL_ROOT + def.file);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${def.file}`);
  const buffer = await response.arrayBuffer();
  return new FBXLoader().parse(buffer, MODEL_ROOT);
}

async function loadObj(def: CarModelDef): Promise<THREE.Group> {
  if (!def.mtl) throw new Error(`Missing MTL for ${def.file}`);
  const materials = await new MTLLoader().loadAsync(MODEL_ROOT + def.mtl);
  materials.preload();
  const loader = new OBJLoader();
  loader.setMaterials(materials);
  return loader.loadAsync(MODEL_ROOT + def.file);
}

function stripSceneHelpers(root: THREE.Object3D): void {
  const helpers: THREE.Object3D[] = [];
  root.traverse((object) => {
    if ((object as THREE.Light).isLight || (object as THREE.Camera).isCamera) helpers.push(object);
  });
  for (const helper of helpers) helper.parent?.remove(helper);
}

/**
 * The exported Koenigsegg scene contains three stray body triangles stretching
 * ~26 m to the right of the car. Removing them restores a tight 2.2 × 1.2 ×
 * 4.55 m car and keeps the remaining carbon panels untouched.
 */
function stripKoenigseggStray(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const filtered = filterTriangles(geometry, (x) => x < 9.5);
    if (filtered !== geometry) {
      mesh.geometry = filtered;
      geometry.dispose();
    }
  });
}

function filterTriangles(
  geometry: THREE.BufferGeometry,
  keep: (centroidX: number) => boolean,
): THREE.BufferGeometry {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.attributes.position as THREE.BufferAttribute;
  const index = source.index;
  const total = index ? index.count : position.count;
  const groups = source.groups.length
    ? source.groups
    : [{ start: 0, count: total, materialIndex: 0 }];
  const attributes = Object.entries(source.attributes).filter(
    (entry): entry is [string, THREE.BufferAttribute] =>
      (entry[1] as THREE.BufferAttribute).isBufferAttribute,
  );

  const kept: Array<{ materialIndex: number; triangles: number[] }> = [];
  let keptVertices = 0;

  for (const group of groups) {
    const triangles: number[] = [];
    const first = group.start / 3;
    const last = (group.start + group.count) / 3;
    for (let triangle = first; triangle < last; triangle += 1) {
      const a = index ? index.getX(triangle * 3) : triangle * 3;
      const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
      const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
      const centroidX = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
      if (!keep(centroidX)) continue;
      triangles.push(triangle);
      keptVertices += 3;
    }
    if (triangles.length > 0) {
      kept.push({ materialIndex: group.materialIndex ?? 0, triangles });
    }
  }

  if (keptVertices === total) {
    if (source !== geometry) source.dispose();
    return geometry;
  }

  const output = new THREE.BufferGeometry();
  const arrays = new Map<string, Float32Array>();
  for (const [name, attribute] of attributes) {
    arrays.set(name, new Float32Array(keptVertices * attribute.itemSize));
  }

  let vertex = 0;
  const outputGroups: Array<{ start: number; count: number; materialIndex: number }> = [];
  for (const group of kept) {
    const start = vertex;
    for (const triangle of group.triangles) {
      for (let corner = 0; corner < 3; corner += 1) {
        const sourceVertex = index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner;
        for (const [name, attribute] of attributes) {
          const target = arrays.get(name);
          if (!target) continue;
          for (let component = 0; component < attribute.itemSize; component += 1) {
            target[vertex * attribute.itemSize + component] =
              attribute.array[sourceVertex * attribute.itemSize + component];
          }
        }
        vertex += 1;
      }
    }
    outputGroups.push({
      start,
      count: vertex - start,
      materialIndex: group.materialIndex,
    });
  }

  for (const [name, attribute] of attributes) {
    const array = arrays.get(name);
    if (array) output.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize));
  }
  for (const group of outputGroups) {
    output.addGroup(group.start, group.count, group.materialIndex);
  }
  output.computeBoundingBox();
  output.computeBoundingSphere();
  if (source !== geometry) source.dispose();
  return output;
}

/**
 * The GLS export stores 329 small draw groups for 23 materials. Reordering the
 * vertices by material once at load cuts that to 23 draw calls without changing
 * a single triangle.
 */
function consolidateMaterialGroups(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    if (geometry.index || !Array.isArray(mesh.material)) return;
    const groups = geometry.groups;
    const materialOrder = [...new Set(groups.map((group) => group.materialIndex ?? 0))];
    if (groups.length < 30 || groups.length <= materialOrder.length * 2) return;

    const attributes = Object.entries(geometry.attributes).filter(
      (entry): entry is [string, THREE.BufferAttribute] =>
        (entry[1] as THREE.BufferAttribute).isBufferAttribute,
    );
    const counts = new Map<number, number>();
    for (const group of groups) {
      const materialIndex = group.materialIndex ?? 0;
      counts.set(materialIndex, (counts.get(materialIndex) ?? 0) + group.count);
    }

    const arrays = new Map<string, Float32Array>();
    for (const [name, attribute] of attributes) {
      arrays.set(name, new Float32Array(geometry.attributes.position.count * attribute.itemSize));
    }

    const offsets = new Map<number, number>();
    let cursor = 0;
    for (const materialIndex of materialOrder) {
      offsets.set(materialIndex, cursor);
      cursor += counts.get(materialIndex) ?? 0;
    }
    const writeOffsets = new Map(offsets);

    for (const group of groups) {
      const materialIndex = group.materialIndex ?? 0;
      const offset = writeOffsets.get(materialIndex) ?? 0;
      for (const [name, attribute] of attributes) {
        const target = arrays.get(name);
        if (!target) continue;
        const source = attribute.array as Float32Array;
        target.set(
          source.subarray(group.start * attribute.itemSize, (group.start + group.count) * attribute.itemSize),
          offset * attribute.itemSize,
        );
      }
      writeOffsets.set(materialIndex, offset + group.count);
    }

    for (const [name, attribute] of attributes) {
      const array = arrays.get(name);
      if (array) geometry.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize));
    }
    geometry.clearGroups();
    for (const materialIndex of materialOrder) {
      geometry.addGroup(offsets.get(materialIndex) ?? 0, counts.get(materialIndex) ?? 0, materialIndex);
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  });
}

function rigWheels(root: THREE.Object3D): CarWheelRig[] {
  root.updateMatrixWorld(true);
  const wheels: CarWheelRig[] = [];
  const candidates: Array<{ mesh: THREE.Mesh; name: string }> = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (/^(FL|FR|RL|RR)$/i.test(mesh.name.trim())) {
      candidates.push({ mesh, name: mesh.name.trim().toUpperCase() });
    }
  });

  for (const { mesh, name } of candidates) {
    const center = new THREE.Box3()
      .setFromObject(mesh)
      .getCenter(new THREE.Vector3());
    root.worldToLocal(center);

    const steer = new THREE.Group();
    steer.name = `${name.toLowerCase()}-steer`;
    steer.position.copy(center);
    root.add(steer);

    const spin = new THREE.Group();
    spin.name = `${name.toLowerCase()}-spin`;
    steer.add(spin);
    spin.attach(mesh);

    wheels.push({ steer, spin, front: name.startsWith('F') });
  }

  return wheels;
}

interface BodyMaterialTune {
  color: number;
  specular: number;
  shininess: number;
  emissive?: number;
  emissiveIntensity?: number;
}

const CAMARO_MATERIALS: Record<string, BodyMaterialTune> = {
  Material: { color: 0xa5211b, specular: 0xffd0bc, shininess: 96, emissive: 0x1a0302 },
  'Material.014': { color: 0x101315, specular: 0x465155, shininess: 52 },
  'Material.001': { color: 0x0a1215, specular: 0xd6ecee, shininess: 140 },
  'Material.002': { color: 0x171b1c, specular: 0x5c686a, shininess: 55 },
  'Material.003': { color: 0xfff1d2, specular: 0xffffff, shininess: 110, emissive: 0xffd596, emissiveIntensity: 0.35 },
  'Material.004': { color: 0xd6e4e2, specular: 0xffffff, shininess: 120 },
  'Material.005': { color: 0x262d2e, specular: 0x7f8c8c, shininess: 70 },
  'Material.006': { color: 0x101516, specular: 0x495557, shininess: 72 },
  'Material.007': { color: 0x090b0c, specular: 0x1b2122, shininess: 16 },
  'Material.008': { color: 0x919b9d, specular: 0xffffff, shininess: 110 },
  'Material.009': { color: 0x2c3234, specular: 0x98a4a6, shininess: 84 },
  'Material.010': { color: 0xffedd0, specular: 0xffffff, shininess: 90, emissive: 0xffcb86, emissiveIntensity: 0.4 },
  'Material.011': { color: 0x171b1c, specular: 0x5f6b6d, shininess: 65 },
  'Material.012': { color: 0x5a0b06, specular: 0xff8c76, shininess: 80, emissive: 0xff2a14, emissiveIntensity: 0.4 },
  'Material.013': { color: 0xb7c0c0, specular: 0xffffff, shininess: 120 },
  None: { color: 0x0f1213, specular: 0x3c4749, shininess: 45 },
};

/**
 * The Agera export ships as almost pure black carbon: the largest body groups
 * are #030303–#080808 with a #030303 specular and a shininess of 25, so the
 * chase camera sees a silhouette even at noon. These are the same panel names
 * with a graphite base and a much sharper clear-coat response, kept separate
 * from the other two supplied bodies.
 */
const KOENIGSEGG_MATERIALS: Record<string, BodyMaterialTune> = {
  'Car Texture': { color: 0x5c6468, specular: 0xeef8fb, shininess: 190 },
  'Carbon.003': { color: 0x3f484d, specular: 0xd2e0e6, shininess: 150 },
  'Carbon.002': { color: 0x343d42, specular: 0xb9c9cf, shininess: 130 },
  Carbon: { color: 0x262d31, specular: 0x98a8ae, shininess: 100 },
  'Carbon.001': { color: 0x252b2e, specular: 0x9aa8ac, shininess: 90 },
  'Rear Lights': {
    color: 0x3a0704,
    specular: 0xff9a82,
    shininess: 120,
    emissive: 0xff2f18,
    emissiveIntensity: 1.2,
  },
};

function tuneKoenigseggMaterials(root: THREE.Object3D): void {
  const seen = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshPhongMaterial) || seen.has(material)) continue;
      seen.add(material);

      if (material.name === 'Window Glass') {
        material.color.setHex(0x0d181d);
        material.specular.setHex(0xeffbff);
        material.shininess = 260;
        material.transparent = true;
        material.opacity = 0.5;
        material.depthWrite = false;
        material.side = THREE.DoubleSide;
      }

      const tuned = KOENIGSEGG_MATERIALS[material.name];
      if (tuned) {
        material.color.setHex(tuned.color);
        material.specular.setHex(tuned.specular);
        material.shininess = tuned.shininess;
        if (tuned.emissive !== undefined) {
          material.emissive.setHex(tuned.emissive);
          material.emissiveIntensity = tuned.emissiveIntensity ?? 1;
        }
      }

      material.needsUpdate = true;
    }
  });
}

function tuneMaterials(root: THREE.Object3D): void {
  const seen = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || seen.has(material)) continue;
      seen.add(material);

      if (material instanceof THREE.MeshPhongMaterial) {
        if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
        if (material.name === 'Window Glass') {
          material.color.setHex(0x0d171a);
          material.specular.setHex(0xd7ecea);
          material.shininess = 120;
          material.transparent = true;
          material.opacity = 0.62;
          material.depthWrite = false;
          material.side = THREE.DoubleSide;
        } else if (material.name === 'Rear Lights') {
          material.color.setHex(0x3a0805);
          material.emissive.setHex(0xff2c16);
          material.emissiveIntensity = 0.55;
          material.specular.setHex(0xff8b70);
          material.shininess = 90;
        } else if (material.name.startsWith('Carbon')) {
          material.color.setHex(material.name === 'Carbon.002' ? 0x1f2325 : 0x191c1e);
          material.specular.setHex(0x4e5a5c);
          material.shininess = 72;
          material.emissive.setHex(0x030404);
        } else if (material.name === 'Car Texture') {
          material.color.setHex(0x111416);
          material.specular.setHex(0x3c4547);
          material.shininess = 58;
        } else if (material.name === 'Polar_White') {
          material.specular.setHex(0xffffff);
          material.shininess = 92;
        } else if (material.name === 'ChromeBlack_Windows') {
          material.color.setHex(0x0c1113);
          material.specular.setHex(0xb9d0d1);
          material.shininess = 130;
        } else if (material.name === 'UnderCarriage') {
          material.color.setHex(0x0c0e0f);
          material.shininess = 24;
        } else if (material.name === 'Chrome') {
          material.color.setHex(0xaeb8b7);
          material.specular.setHex(0xffffff);
          material.shininess = 120;
        }
      }

      const tuned = CAMARO_MATERIALS[material.name];
      if (tuned && material instanceof THREE.MeshPhongMaterial) {
        material.color.setHex(tuned.color);
        material.specular.setHex(tuned.specular);
        material.shininess = tuned.shininess;
        if (tuned.emissive !== undefined) {
          material.emissive.setHex(tuned.emissive);
          material.emissiveIntensity = tuned.emissiveIntensity ?? 1;
        }
      }

      material.needsUpdate = true;
    }
  });
}
