import * as CANNON from 'cannon-es';
import { CAR } from './config';

export interface CarSpec {
  engine: number;
  grip: number;
  brakes: number;
  lights: number;
}

export interface CarInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
}

const GEARS = [3.4, 2.35, 1.75, 1.35, 1.08, 0.87];
const FINAL_DRIVE = 3.45;
const REVERSE_RATIO = 3.1;
const IDLE_RPM = 900;
const REDLINE = 7200;
const WHEEL_INDICES_REAR = [2, 3];

const TORQUE_CURVE: Array<[number, number]> = [
  [700, 220],
  [1500, 300],
  [2800, 365],
  [4200, 405],
  [5200, 400],
  [6200, 355],
  [7000, 300],
  [7600, 220],
];

function torqueAt(rpm: number): number {
  if (rpm <= TORQUE_CURVE[0][0]) return TORQUE_CURVE[0][1];
  for (let i = 1; i < TORQUE_CURVE.length; i++) {
    const [r1, t1] = TORQUE_CURVE[i];
    if (rpm <= r1) {
      const [r0, t0] = TORQUE_CURVE[i - 1];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return TORQUE_CURVE[TORQUE_CURVE.length - 1][1];
}

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * RaycastVehicle-backed car. Wheel suspension is raycast against a flat road plane,
 * forces are applied through cannon-es' RaycastVehicle friction model.
 */
export class CarPhysics {
  readonly world: CANNON.World;
  readonly chassis: CANNON.Body;
  readonly vehicle: CANNON.RaycastVehicle;

  spec: CarSpec;
  speedKmh = 0;
  signedSpeed = 0;
  rpm = IDLE_RPM;
  gear = 1;
  reverse = false;
  steering = 0;
  throttle = 0;
  brakeAmount = 0;
  handbrake = false;
  slip = 0;
  steeringVisual = 0;

  private shiftTimer = 0;
  private reverseHold = 0;
  private dragAccumulator = 0;

  constructor(spec: CarSpec) {
    this.spec = spec;
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = false;
    if (this.world.solver instanceof CANNON.GSSolver) {
      this.world.solver.iterations = 12;
    }

    const groundMaterial = new CANNON.Material('ground');
    const ground = new CANNON.Body({ mass: 0, material: groundMaterial });
    ground.addShape(new CANNON.Plane());
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    ground.collisionFilterGroup = 1;
    this.world.addBody(ground);

    this.chassis = new CANNON.Body({
      mass: CAR.mass,
      material: new CANNON.Material('chassis'),
      linearDamping: 0.015,
      angularDamping: 0.35,
    });
    this.chassis.addShape(new CANNON.Box(new CANNON.Vec3(0.88, 0.36, 2)));

    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassis,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });

    // The visual nose is -Z (camera convention), so the front axle sits at negative Z.
    const connectionPoints = [
      [CAR.trackHalf, -0.28, -CAR.frontAxle],
      [-CAR.trackHalf, -0.28, -CAR.frontAxle],
      [CAR.trackHalf, -0.28, -CAR.rearAxle],
      [-CAR.trackHalf, -0.28, -CAR.rearAxle],
    ];

    const baseFriction = 2.15 * spec.grip;

    connectionPoints.forEach((point, i) => {
      this.vehicle.addWheel({
        radius: CAR.wheelRadius,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        axleLocal: new CANNON.Vec3(-1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(point[0], point[1], point[2]),
        isFrontWheel: i < 2,
        suspensionStiffness: 33,
        suspensionRestLength: CAR.suspensionRest,
        frictionSlip: baseFriction,
        dampingRelaxation: 2.6,
        dampingCompression: 4.6,
        maxSuspensionForce: 130000,
        maxSuspensionTravel: 0.3,
        rollInfluence: 0.035,
        customSlidingRotationalSpeed: -35,
        useCustomSlidingRotationalSpeed: true,
      });
    });

    this.vehicle.addToWorld(this.world);
    this.reset(new CANNON.Vec3(0, CAR.startHeight, 0), new CANNON.Quaternion());
  }

  setSpec(spec: CarSpec): void {
    this.spec = spec;
    const friction = 2.15 * spec.grip;
    for (const wheel of this.vehicle.wheelInfos) {
      wheel.frictionSlip = friction;
    }
  }

  reset(position: CANNON.Vec3, quaternion: CANNON.Quaternion): void {
    this.chassis.position.copy(position);
    this.chassis.quaternion.copy(quaternion);
    this.chassis.velocity.setZero();
    this.chassis.angularVelocity.setZero();
    this.chassis.force.setZero();
    this.chassis.torque.setZero();
    this.chassis.wakeUp();

    this.speedKmh = 0;
    this.signedSpeed = 0;
    this.rpm = IDLE_RPM;
    this.gear = 1;
    this.reverse = false;
    this.steering = 0;
    this.steeringVisual = 0;
    this.throttle = 0;
    this.brakeAmount = 0;
    this.shiftTimer = 0;
    this.reverseHold = 0;

    this.vehicle.wheelInfos.forEach((wheel, i) => {
      wheel.steering = 0;
      wheel.engineForce = 0;
      wheel.brake = 0;
      wheel.suspensionLength = CAR.suspensionRest;
      wheel.rotation = 0;
      wheel.deltaRotation = 0;
      this.vehicle.updateWheelTransform(i);
    });
  }

  forwardVector(target = new CANNON.Vec3()): CANNON.Vec3 {
    target.set(0, 0, -1);
    this.chassis.vectorToWorldFrame(target, target);
    return target;
  }

  get gearLabel(): string {
    return this.reverse ? 'R' : String(this.gear);
  }

  update(dt: number, input: CarInput): void {
    dt = clamp(dt, 1 / 240, 1 / 20);
    const forward = this.forwardVector();
    const velocity = this.chassis.velocity;
    let signedSpeed = velocity.dot(forward);

    // Reverse is engaged by holding the brake at a standstill, and left by pressing the throttle.
    if (!this.reverse && input.brake > 0.5 && input.throttle < 0.2 && Math.abs(signedSpeed) < 1) {
      this.reverseHold += dt;
      if (this.reverseHold > 0.22) {
        this.reverse = true;
        this.gear = 1;
        this.steering = 0;
        this.steeringVisual = 0;
      }
    } else {
      this.reverseHold = 0;
    }
    if (this.reverse && input.throttle > 0.4 && signedSpeed > -1.2) {
      this.reverse = false;
      this.reverseHold = 0;
      this.gear = 1;
    }

    const throttleInput = this.reverse ? input.brake : input.throttle;
    const brakeInput = this.reverse ? input.throttle : input.brake;

    this.throttle = damp(this.throttle, throttleInput, 14, dt);
    this.brakeAmount = damp(this.brakeAmount, brakeInput, 18, dt);
    this.handbrake = input.handbrake;

    const absSpeed = Math.abs(signedSpeed);
    const maxSteer = 0.52 - 0.39 * clamp(absSpeed / 55, 0, 1);
    const steerTarget = clamp(input.steer, -1, 1) * maxSteer;
    const steerRate = Math.abs(input.steer) > 0.01 ? 9 : 7;
    this.steering = damp(this.steering, steerTarget, steerRate, dt);
    this.steeringVisual = damp(this.steeringVisual, this.steering, 18, dt);

    // cannon-es: positive steering angle turns left. Driver steer is positive to the right.
    const wheelSteer = -this.steering;
    this.vehicle.setSteeringValue(wheelSteer, 0);
    this.vehicle.setSteeringValue(wheelSteer, 1);

    const ratio = this.reverse ? -REVERSE_RATIO : GEARS[this.gear - 1];
    const wheelOmega = absSpeed / CAR.wheelRadius;
    let rpm = (wheelOmega * Math.abs(ratio) * FINAL_DRIVE * 60) / (Math.PI * 2);

    // Clutch slip off the line so launches sound and pull like a real car.
    if (!this.reverse && absSpeed < 9) {
      rpm = Math.max(rpm, IDLE_RPM + this.throttle * 2400);
    }
    rpm = clamp(rpm, IDLE_RPM, REDLINE + 350);
    this.rpm = damp(this.rpm, rpm, 8, dt);

    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    if (!this.reverse && this.shiftTimer <= 0) {
      if (this.gear < GEARS.length && rpm > 6100 && absSpeed > 6) {
        this.gear += 1;
        this.shiftTimer = 0.32;
      } else if (this.gear > 1 && rpm < 1950) {
        this.gear -= 1;
        this.shiftTimer = 0.26;
      }
    }

    const torque = torqueAt(this.rpm) * this.spec.engine;
    const totalForce =
      (torque * ratio * FINAL_DRIVE) / CAR.wheelRadius *
      (this.reverse ? Math.min(1, this.throttle * 0.4) : this.throttle);
    const perWheel = totalForce / WHEEL_INDICES_REAR.length;
    const reverseLimited = this.reverse && absSpeed > 9;
    const canDrive =
      this.shiftTimer <= 0 &&
      !this.handbrake &&
      !reverseLimited &&
      !(brakeInput > 0.65 && !this.reverse);

    for (let i = 0; i < 4; i++) {
      this.vehicle.applyEngineForce(canDrive && i >= 2 ? perWheel : 0, i);
    }

    const frontBrake = 105 * this.spec.brakes * this.brakeAmount;
    const rearBrake = 78 * this.spec.brakes * this.brakeAmount;
    this.vehicle.setBrake(frontBrake, 0);
    this.vehicle.setBrake(frontBrake, 1);
    this.vehicle.setBrake(rearBrake, 2);
    this.vehicle.setBrake(rearBrake, 3);

    if (this.handbrake && absSpeed > 1.5) {
      this.vehicle.setBrake(150, 2);
      this.vehicle.setBrake(150, 3);
    }

    const grip = 2.15 * this.spec.grip;
    for (let i = 0; i < 4; i++) {
      const wheel = this.vehicle.wheelInfos[i];
      const slidingRear = this.handbrake && i >= 2 && absSpeed > 3;
      wheel.frictionSlip = slidingRear ? grip * 0.72 : grip;
    }

    this.world.step(1 / 60, dt, 4);

    // Aerodynamic and rolling drag, applied after the solve to keep top speed stable.
    const v = this.chassis.velocity;
    const horizontal = Math.hypot(v.x, v.z);
    if (horizontal > 0.1) {
      const drag = 0.5 * 1.2 * 0.9 * horizontal * horizontal + 175;
      const deceleration = (drag / CAR.mass) * dt;
      this.dragAccumulator = 1 - clamp(deceleration / horizontal, 0, 0.5);
      v.x *= this.dragAccumulator;
      v.z *= this.dragAccumulator;
    }

    // Keep the engine speed in sync with the solved velocity.
    const forwardNow = this.forwardVector();
    signedSpeed = this.chassis.velocity.dot(forwardNow);
    this.signedSpeed = signedSpeed;
    this.speedKmh = this.chassis.velocity.length() * 3.6;

    const rearSlip = (this.vehicle.wheelInfos[2].skidInfo + this.vehicle.wheelInfos[3].skidInfo) / 2;
    this.slip = clamp(1 - rearSlip, 0, 1);
  }

  syncWheels(): void {
    for (let i = 0; i < 4; i++) this.vehicle.updateWheelTransform(i);
  }
}
