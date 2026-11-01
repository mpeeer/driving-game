import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CarPhysics, type CarInput, type CarSpec } from './physics';
import { Cockpit } from './cockpit';
import { CAR, WORLD } from './config';
import type { Quality } from './types';

/** Visual car: cockpit, raycast wheels and two shadow-casting headlights. */
export class PlayerVehicle {
  readonly group = new THREE.Group();
  readonly physics: CarPhysics;
  readonly cockpit = new Cockpit();
  private readonly wheels: THREE.Group[] = [];
  private readonly headlights: THREE.SpotLight[] = [];
  private quality: Quality;

  constructor(scene: THREE.Scene, spec: CarSpec, quality: Quality) {
    this.quality = quality;
    this.physics = new CarPhysics(spec);
    this.group.name = 'player-vehicle';
    this.group.add(this.cockpit.group);
    scene.add(this.group);

    this.buildWheels(scene);
    this.buildHeadlights(spec);
    this.setQuality(quality);
  }

  private buildWheels(scene: THREE.Scene): void {
    const tireGeometry = new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.26, 28);
    tireGeometry.rotateZ(Math.PI / 2);
    const rimGeometry = new THREE.CylinderGeometry(0.238, 0.238, 0.275, 20);
    rimGeometry.rotateZ(Math.PI / 2);

    const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.92, metalness: 0.08 });
    const rimMaterial = new THREE.MeshStandardMaterial({ color: 0x535a64, roughness: 0.32, metalness: 0.9 });
    const spokeGeometry = new THREE.BoxGeometry(0.018, 0.4, 0.036);
    const caliperMaterial = new THREE.MeshStandardMaterial({ color: 0x6b3a24, roughness: 0.5, metalness: 0.35 });

    for (let i = 0; i < 4; i++) {
      const wheel = new THREE.Group();
      const tire = new THREE.Mesh(tireGeometry, tireMaterial);
      wheel.add(tire);

      const rim = new THREE.Mesh(rimGeometry, rimMaterial);
      wheel.add(rim);

      for (let spoke = 0; spoke < 5; spoke++) {
        const bar = new THREE.Mesh(spokeGeometry, rimMaterial);
        bar.rotation.x = (spoke / 5) * Math.PI * 2;
        bar.position.x = 0.142;
        wheel.add(bar);
      }

      const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.15, 0.08), caliperMaterial);
      caliper.position.set(0.15, 0.16, 0);
      wheel.add(caliper);

      wheel.traverse((object) => {
        object.castShadow = false;
        object.receiveShadow = false;
      });
      scene.add(wheel);
      this.wheels.push(wheel);
    }
  }

  private buildHeadlights(spec: CarSpec): void {
    const sides = [-1, 1];
    for (const side of sides) {
      const target = new THREE.Object3D();
      target.position.set(side * 0.75, -1.5, -26);
      this.group.add(target);

      const light = new THREE.SpotLight(
        WORLD.headlightColor,
        165 * spec.lights,
        85,
        0.52,
        0.72,
        1.6,
      );
      light.position.set(side * 0.62, -0.03, -1.97);
      light.target = target;
      light.castShadow = true;
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.02;
      light.shadow.camera.near = 0.6;
      light.shadow.camera.far = 80;
      this.group.add(light);
      this.headlights.push(light);
    }
  }

  setQuality(quality: Quality): void {
    this.quality = quality;
    for (const light of this.headlights) {
      light.castShadow = quality !== 'low';
      const size = quality === 'high' ? 1536 : 768;
      if (light.shadow.mapSize.x !== size) {
        light.shadow.mapSize.set(size, size);
        if (light.shadow.map) {
          light.shadow.map.dispose();
          light.shadow.map = null;
        }
      }
    }
  }

  setSpec(spec: CarSpec): void {
    this.physics.setSpec(spec);
    for (const light of this.headlights) {
      light.intensity = 165 * spec.lights;
    }
  }

  place(position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    const bodyPosition = new CANNON.Vec3(position.x, CAR.startHeight, position.z);
    const bodyQuaternion = new CANNON.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    this.physics.reset(bodyPosition, bodyQuaternion);
    this.syncTransform();
    this.syncWheels();
  }

  update(dt: number, input: CarInput): void {
    this.physics.update(dt, input);
    this.syncTransform();
    this.syncWheels();
    this.cockpit.update({
      speedKmh: this.physics.speedKmh,
      gear: this.physics.gearLabel,
      rpm: this.physics.rpm,
      steering: this.physics.steeringVisual,
    });
  }

  syncTransform(): void {
    const body = this.physics.chassis;
    this.group.position.set(body.position.x, body.position.y, body.position.z);
    this.group.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
  }

  private syncWheels(): void {
    this.physics.syncWheels();
    this.physics.vehicle.wheelInfos.forEach((wheel, index) => {
      const mesh = this.wheels[index];
      if (!mesh) return;
      const transform = wheel.worldTransform;
      mesh.position.set(transform.position.x, transform.position.y, transform.position.z);
      mesh.quaternion.set(
        transform.quaternion.x,
        transform.quaternion.y,
        transform.quaternion.z,
        transform.quaternion.w,
      );
    });
  }
}
