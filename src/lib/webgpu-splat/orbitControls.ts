import { vec3, type Vec3 } from './math';
import type { NavigationMode } from '../viewerHandle';
import type { Body, CollisionGrid } from './collision';

export interface OrbitLimits {
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
}

interface PointerState {
  x: number;
  y: number;
  button: number;
  pan: boolean;
}

// First-person tuning, in multiples of the scene scale (median splat distance from the origin).
const EYE_HEIGHT = 0.06;
const WALK_SPEED = 0.1; // per second
const FLY_SPEED = 0.25;
const RUN_FACTOR = 3;
/** Arrow-key turn rate, rad/s. */
const TURN_SPEED = 1.6;
/** First-person views may look almost straight up or down. */
const LOOK_MIN_PHI = Math.PI * 0.03;
const LOOK_MAX_PHI = Math.PI * 0.97;
/**
 * Interior: a person's proportions in metres, turned into scene units by the collision grid's
 * units per metre (before the grid arrives, by the walk heuristic).
 */
const INTERIOR = {
  EYE: 1.65,
  RADIUS: 0.2,
  /** Steps over anything lower; the floor may rise or drop this much from one step to the next. */
  STEP: 0.3,
  HEAD: 0.1,
  /** Walking speed, m/s. */
  SPEED: 1.3,
  /** Tapping a wall or a piece of furniture stops this far before it. */
  STAND_OFF: 0.6,
  /** Entering the mode looks this far around for a free spot to stand. */
  LAND_RADIUS: 4,
  /** Natural look up / down limits: ±75° from the horizon. */
  MIN_PHI: Math.PI / 12,
  MAX_PHI: (Math.PI * 11) / 12,
};
const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight',
]);

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Arranca rápido y frena hasta pararse: para entradas que deben posarse en un encuadre. */
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
/**
 * Curva de 0 a 1 con pendiente `a` al empezar y `b` al terminar (Hermite cúbica; monótona si a² + b² ≤ 9).
 * Con b > 0 el movimiento llega a su fin todavía a esa velocidad, para seguir sin pausa.
 */
const hermite = (a: number, b: number) => (t: number) => {
  const t2 = t * t, t3 = t2 * t;
  return (-2 * t3 + 3 * t2) + a * (t3 - 2 * t2 + t) + b * (t3 - t2);
};
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Camera controls: orbit around a pivot, or first-person navigation from an
 * eye position (walk on the ground, panorama look-around, free fly).
 *
 * Input only moves the *goal* state; `update(dt)` eases the current state
 * toward it with frame-rate independent exponential smoothing, which is what
 * makes the motion feel fluid at any FPS. `update` returns whether the camera
 * moved, so the renderer can skip frames while idle.
 *
 * Both styles share theta/phi, the direction from the look target back to the
 * camera; first-person modes keep the eye fixed and derive the target from it.
 */
export class OrbitControls {
  readonly up: Vec3;
  private readonly forward0: Vec3;
  private readonly right0: Vec3;

  limits: OrbitLimits;
  /** Higher = snappier. ~10 feels like OrbitControls with dampingFactor 0.05 at 60 FPS. */
  smoothing = 10;
  rotateSpeed = 1;
  panSpeed = 1;
  zoomSpeed = 1;
  autoRotate = false;
  /** Same units as three.js OrbitControls (2.0 ≈ one turn every 30 s). */
  autoRotateSpeed = 2;
  fovY = (50 * Math.PI) / 180;
  /** Size of the loaded scene (median splat distance from the origin); scales first-person motion. */
  sceneScale = 1;
  /** User speed multiplier for first-person movement. */
  speed = 1;
  /** Panorama mode zooms by field of view; the owner applies the factor. */
  onFovZoom: ((factor: number) => void) | null = null;

  private navMode: NavigationMode = 'orbit';
  private theta = 0;
  private phi = Math.PI / 2;
  private radius = 5;
  private target: Vec3 = [0, 0, 0];
  private goalTheta = 0;
  private goalPhi = Math.PI / 2;
  private goalRadius = 5;
  private goalTarget: Vec3 = [0, 0, 0];

  private eye: Vec3 = [0, 0, 5];
  private goalEye: Vec3 = [0, 0, 5];
  /** Height of the ground under the eye along `up`, from the owner's ground probe. */
  private ground: number | null = null;
  /** Q/E adjust the eye height above the ground in walk mode. */
  private eyeHeightScale = 1;
  /** Interior: what the camera may not walk through (null until the scene has fully loaded). */
  private collider: CollisionGrid | null = null;
  private readonly keys = new Set<string>();
  private gyroLast: [number, number] | null = null;
  private gyroOn = false;

  private fly: { from: number; to: number; start: number; duration: number } | null = null;
  private travel: {
    start: number;
    duration: number;
    fromTarget: Vec3;
    toTarget: Vec3;
    fromTheta: number;
    toTheta: number;
    fromPhi: number;
    toPhi: number;
    fromRadius: number;
    toRadius: number;
    ease?: (t: number) => number;
    /** Curva propia del giro (si no, la de `ease`). */
    easeTheta?: (t: number) => number;
  } | null = null;
  private eyeTravel: { start: number; duration: number; from: Vec3; to: Vec3 } | null = null;
  private element: HTMLElement | null = null;
  private readonly pointers = new Map<number, PointerState>();
  private pinchDistance = 0;
  private readonly startListeners = new Set<() => void>();
  private dirty = true;

  constructor(up: Vec3, limits: OrbitLimits) {
    this.up = vec3.normalize(up);
    // Any reference "forward" orthogonal to up defines theta = 0.
    const candidate: Vec3 = Math.abs(this.up[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    this.forward0 = vec3.normalize(vec3.sub(candidate, vec3.scale(this.up, vec3.dot(candidate, this.up))));
    this.right0 = vec3.cross(this.up, this.forward0);
    this.limits = limits;
  }

  // ─── Public state ──────────────────────────────────────────────────────────
  onStart(cb: () => void) {
    this.startListeners.add(cb);
    return () => this.startListeners.delete(cb);
  }

  get mode() {
    return this.navMode;
  }

  /** Interior, walk and panorama keep the eye at `eyeHeight` above the ground. */
  get followsGround() {
    return this.navMode === 'interior' || this.navMode === 'walk' || this.navMode === 'look';
  }

  /** The owner probes the ground for us, except in interior with a collision grid (it walks on the grid). */
  get needsGroundProbe() {
    return this.followsGround && !this.interiorGrid;
  }

  get eyeHeight() {
    if (this.navMode === 'interior') return INTERIOR.EYE * this.unitsPerMeter;
    return EYE_HEIGHT * this.sceneScale * this.eyeHeightScale;
  }

  /**
   * Interior collisions. Arriving while in interior (the scene just finished loading) lands the
   * camera on the nearest free spot, at the real eye height.
   */
  setCollider(grid: CollisionGrid | null) {
    this.collider = grid;
    this.landNear(this.goalEye, this.lookAhead());
  }

  /** Interior: the first solid voxel along a tap ray, the same surfaces the camera collides with. Null otherwise. */
  raycast(origin: Vec3, dir: Vec3): Vec3 | null {
    return this.interiorGrid?.raycast(origin, dir) ?? null;
  }

  /**
   * Interior: glides to the free spot nearest to `near` (on the main floor), else nearest to the
   * camera (an orbit pivot can lie outside the rooms), at eye height and facing `lookAt`. False
   * without a collision grid or a free spot.
   */
  landNear(near: Vec3, lookAt: Vec3): boolean {
    const grid = this.interiorGrid;
    if (!grid) return false;
    const ground = grid.floor ?? vec3.dot(near, this.up) - this.eyeHeight;
    const radius = INTERIOR.LAND_RADIUS * this.unitsPerMeter;
    const spot = grid.findStand(near, ground, this.body, radius) ?? grid.findStand(this.goalEye, ground, this.body, radius);
    if (!spot) return false;
    this.landAt(spot, lookAt);
    return true;
  }

  /** Where the eye is heading (first-person modes); the ground probe looks below it. */
  get eyeGoal(): Vec3 {
    return [...this.goalEye];
  }

  get isTravelling() {
    return this.eyeTravel !== null;
  }

  /** Latest ground height under the eye (`dot(groundPoint, up)`). */
  setGround(height: number) {
    this.ground = height;
  }

  get distance() {
    return this.radius;
  }

  getTarget(): Vec3 {
    if (this.navMode === 'orbit') return [...this.target];
    return vec3.sub(this.eye, this.offset(this.theta, this.phi, this.radius));
  }

  getPosition(): Vec3 {
    if (this.navMode !== 'orbit') return [...this.eye];
    return vec3.add(this.target, this.offset(this.theta, this.phi, this.radius));
  }

  /**
   * Switches navigation style without moving the camera: first-person modes
   * start from the current eye, orbit pivots around the point straight ahead.
   */
  setMode(mode: NavigationMode) {
    if (mode === this.navMode) return;
    const from = this.navMode;
    if (this.navMode === 'orbit') {
      this.autoRotate = false;
      this.cancelFly();
      this.eye = this.getPosition();
      this.goalEye = [...this.eye];
    }
    this.navMode = mode;
    this.eyeTravel = null;
    this.ground = null;
    this.eyeHeightScale = 1;
    this.gyroLast = null;
    if (mode === 'orbit') {
      this.target = vec3.sub(this.eye, this.offset(this.theta, this.phi, this.radius));
      this.goalTarget = [...this.target];
      this.goalPhi = this.clampPhi(this.goalPhi);
      this.goalRadius = this.radius;
    }
    // Interior from another first-person mode: stand on the nearest free spot (from orbit the owner picks where).
    if (from !== 'orbit') this.landNear(this.goalEye, this.lookAhead());
    this.dirty = true;
  }

  /** Jumps (no easing) to a camera position looking at `target`. */
  setPose(position: Vec3, target: Vec3) {
    const d = vec3.sub(position, target);
    const r = vec3.length(d) || 1;
    const n = vec3.scale(d, 1 / r);
    this.phi = this.goalPhi = this.clampPhi(Math.acos(Math.max(-1, Math.min(1, vec3.dot(n, this.up)))));
    this.theta = this.goalTheta = Math.atan2(vec3.dot(n, this.right0), vec3.dot(n, this.forward0));
    this.radius = this.goalRadius = this.clampRadius(r);
    this.target = [...target];
    this.goalTarget = [...target];
    this.eye = [...position];
    this.goalEye = [...position];
    this.fly = null;
    this.dirty = true;
  }

  /** Eases toward a viewing direction (unit vector from target to camera). */
  lookFrom(direction: Vec3, distance = this.goalRadius) {
    const n = vec3.normalize(direction);
    this.goalPhi = this.clampPhi(Math.acos(Math.max(-1, Math.min(1, vec3.dot(n, this.up)))));
    const theta = Math.atan2(vec3.dot(n, this.right0), vec3.dot(n, this.forward0));
    // Take the short way around.
    let delta = theta - this.goalTheta;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this.goalTheta += delta;
    this.goalRadius = this.clampRadius(distance);
    this.dirty = true;
  }

  /** Eases the orbit pivot to `target`. */
  focus(target: Vec3) {
    this.goalTarget = [...target];
    this.dirty = true;
  }

  /**
   * Game-style "go to" move: eases the pivot to `target` and the camera to
   * `position` along an ease-in-out curve. Any user input cancels it.
   */
  travelTo(target: Vec3, position: Vec3, durationMs = 900) {
    this.fly = null;
    this.autoRotate = false;
    const d = vec3.sub(position, target);
    const r = vec3.length(d) || this.goalRadius;
    const n = vec3.scale(d, 1 / r);
    const toPhi = this.clampPhi(Math.acos(Math.max(-1, Math.min(1, vec3.dot(n, this.up)))));
    let toTheta = Math.atan2(vec3.dot(n, this.right0), vec3.dot(n, this.forward0));
    let delta = toTheta - this.theta;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    toTheta = this.theta + delta;
    this.travel = {
      start: performance.now(),
      duration: durationMs,
      fromTarget: [...this.target],
      toTarget: [...target],
      fromTheta: this.theta,
      toTheta,
      fromPhi: this.phi,
      toPhi,
      fromRadius: this.radius,
      toRadius: this.clampRadius(r),
    };
    this.dirty = true;
  }

  /**
   * Entrada cinematográfica que pasa exactamente por `position` mirando a `target`: parte desde
   * `fromRadius`, un poco más desde arriba y `sweep` radianes antes. Distancia y altura se posan;
   * el giro llega al encuadre a `endSpeed` rad/s para que el giro automático siga sin pausa.
   * Cualquier gesto la corta.
   */
  introTo(target: Vec3, position: Vec3, fromRadius: number, sweep: number, durationMs: number, endSpeed = 0) {
    this.setPose(position, target);
    const toTheta = this.theta, toPhi = this.phi, toRadius = this.radius;
    const fromTheta = toTheta - sweep;
    const fromPhi = this.clampPhi(toPhi - 0.3);
    const from = this.clampRadius(fromRadius);
    this.autoRotate = false;
    this.fly = null;
    this.theta = this.goalTheta = fromTheta;
    this.phi = this.goalPhi = fromPhi;
    this.radius = this.goalRadius = from;
    this.travel = {
      start: performance.now(),
      duration: durationMs,
      fromTarget: [...target],
      toTarget: [...target],
      fromTheta,
      toTheta,
      fromPhi,
      toPhi,
      fromRadius: from,
      toRadius,
      ease: easeOutCubic,
      // Pendiente final = velocidad de reposo, en unidades de la curva (fracción del giro por duración).
      easeTheta: hermite(2.4, Math.min(1.5, (endSpeed * durationMs) / 1000 / Math.max(sweep, 1e-3))),
    };
    this.dirty = true;
  }

  /** Same as `travelTo`, keeping the current viewing angle and distance (first person: walk there). */
  travelPivotTo(target: Vec3, durationMs = 1100) {
    if (this.navMode === 'fly') {
      this.travelEyeTo(vec3.add(this.goalEye, this.horizontal(vec3.sub(target, this.goalEye))));
      return;
    }
    if (this.navMode !== 'orbit') {
      this.walkTo(target);
      return;
    }
    this.travelTo(target, vec3.add(target, this.offset(this.goalTheta, this.goalPhi, this.goalRadius)), durationMs);
  }

  /**
   * First-person tap-to-go: glide toward a picked point and turn to face it.
   * Walking lands on picked ground (a point well below the eye) and stops short
   * of walls; flying heads along the ray.
   */
  walkTo(point: Vec3) {
    const d = vec3.sub(point, this.goalEye);
    const flat = this.horizontal(d);
    let dest: Vec3;
    const grid = this.interiorGrid;
    if (grid) {
      // Interior: floor taps go right there, walls and furniture are approached; the walk stops before obstacles.
      const feet = this.feet();
      const len = vec3.length(flat);
      const onFloor = Math.abs(vec3.dot(point, this.up) - vec3.dot(feet, this.up)) <= this.body.step;
      const reach = onFloor ? len : Math.max(0, len - INTERIOR.STAND_OFF * this.unitsPerMeter);
      const stop = grid.walk(feet, vec3.add(feet, vec3.scale(flat, reach / Math.max(len, 1e-9))), this.body);
      this.ground = vec3.dot(stop, this.up);
      dest = vec3.add(stop, vec3.scale(this.up, this.eyeHeight));
    } else if (this.navMode === 'fly') {
      dest = vec3.add(this.goalEye, vec3.scale(d, 0.8));
    } else if (-vec3.dot(d, this.up) > 0.5 * this.eyeHeight) {
      this.ground = vec3.dot(point, this.up);
      dest = vec3.add(point, vec3.scale(this.up, this.eyeHeight));
    } else {
      dest = vec3.add(this.goalEye, vec3.scale(flat, 0.85));
    }
    if (vec3.length(flat) > 1e-6) {
      const back = vec3.normalize(vec3.scale(flat, -1));
      const theta = Math.atan2(vec3.dot(back, this.right0), vec3.dot(back, this.forward0));
      this.goalTheta += wrapAngle(theta - this.goalTheta);
    }
    this.travelEyeTo(dest);
  }

  /**
   * Cinematic first-person landing: glide to `point` (on the ground) at eye
   * height, levelled and facing `lookAt`.
   */
  landAt(point: Vec3, lookAt: Vec3) {
    this.ground = vec3.dot(point, this.up);
    const dest = vec3.add(point, vec3.scale(this.up, this.eyeHeight));
    const flat = this.horizontal(vec3.sub(lookAt, dest));
    if (vec3.length(flat) > 1e-6) {
      const back = vec3.normalize(vec3.scale(flat, -1));
      const theta = Math.atan2(vec3.dot(back, this.right0), vec3.dot(back, this.forward0));
      this.goalTheta += wrapAngle(theta - this.goalTheta);
    }
    this.goalPhi = Math.PI / 2;
    this.travelEyeTo(dest, 1600);
  }

  /** Cinematic dolly from `from` to `to` (radius) over `duration` ms. */
  flyRadius(from: number, to: number, duration: number) {
    this.radius = this.goalRadius = from;
    this.fly = { from, to, start: performance.now(), duration };
    this.dirty = true;
  }

  cancelFly() {
    if (this.fly) {
      this.goalRadius = this.clampRadius(this.radius);
      this.fly = null;
    }
    this.travel = null;
    this.eyeTravel = null;
  }

  get isFlying() {
    return this.fly !== null;
  }

  /** Hay un viaje en órbita en curso (clic en la escena o entrada hacia un encuadre). */
  get isOrbitTravelling() {
    return this.travel !== null;
  }

  /** Device-orientation look (phones): turning the device turns the first-person view. */
  setGyro(enabled: boolean) {
    if (enabled === this.gyroOn) return;
    this.gyroOn = enabled;
    this.gyroLast = null;
    if (enabled) window.addEventListener('deviceorientation', this.onOrientation);
    else window.removeEventListener('deviceorientation', this.onOrientation);
  }

  /** Advances the smoothing. Returns true when the camera moved this frame. */
  update(dt: number): boolean {
    const dtClamped = Math.min(dt, 0.1);
    if (this.navMode === 'orbit') this.advanceOrbit(dtClamped);
    else this.advanceFirstPerson(dtClamped);

    const k = 1 - Math.exp(-this.smoothing * dtClamped);
    let moved = this.dirty;
    this.dirty = false;
    const step = (cur: number, goal: number, eps: number) => {
      const d = goal - cur;
      if (Math.abs(d) <= eps) return goal;
      moved = true;
      return cur + d * k;
    };
    this.theta = step(this.theta, this.goalTheta, 1e-5);
    this.phi = step(this.phi, this.goalPhi, 1e-5);
    if (this.navMode === 'orbit') {
      this.radius = step(this.radius, this.goalRadius, 1e-5 * this.goalRadius);
      const tEps = 1e-5 * Math.max(1, this.radius);
      this.target = [
        step(this.target[0], this.goalTarget[0], tEps),
        step(this.target[1], this.goalTarget[1], tEps),
        step(this.target[2], this.goalTarget[2], tEps),
      ];
    } else {
      const eEps = 1e-5 * this.sceneScale;
      this.eye = [step(this.eye[0], this.goalEye[0], eEps), step(this.eye[1], this.goalEye[1], eEps), step(this.eye[2], this.goalEye[2], eEps)];
    }
    return moved;
  }

  // ─── DOM wiring ────────────────────────────────────────────────────────────
  attach(element: HTMLElement) {
    this.detach();
    this.element = element;
    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerUp);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach() {
    const el = this.element;
    if (!el) return;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.setGyro(false);
    this.pointers.clear();
    this.keys.clear();
    this.element = null;
  }

  // ─── Internals ─────────────────────────────────────────────────────────────
  private advanceOrbit(dt: number) {
    if (this.autoRotate) {
      this.goalTheta += ((this.autoRotateSpeed * 2 * Math.PI) / 60) * dt;
    }
    if (this.fly) {
      const t = Math.min((performance.now() - this.fly.start) / this.fly.duration, 1);
      const ease = easeInOut(t);
      this.radius = this.goalRadius = this.fly.from + (this.fly.to - this.fly.from) * ease;
      if (t >= 1) this.fly = null;
      this.dirty = true;
    }

    if (this.travel) {
      const tr = this.travel;
      const t = Math.min((performance.now() - tr.start) / tr.duration, 1);
      const e = (tr.ease ?? easeInOut)(t);
      const lerp = (a: number, b: number) => a + (b - a) * e;
      const eTheta = (tr.easeTheta ?? tr.ease ?? easeInOut)(t);
      this.theta = this.goalTheta = tr.fromTheta + (tr.toTheta - tr.fromTheta) * eTheta;
      this.phi = this.goalPhi = lerp(tr.fromPhi, tr.toPhi);
      this.radius = this.goalRadius = lerp(tr.fromRadius, tr.toRadius);
      this.target = [lerp(tr.fromTarget[0], tr.toTarget[0]), lerp(tr.fromTarget[1], tr.toTarget[1]), lerp(tr.fromTarget[2], tr.toTarget[2])];
      this.goalTarget = [...this.target];
      if (t >= 1) this.travel = null;
      this.dirty = true;
    }
  }

  private advanceFirstPerson(dt: number) {
    const key = (code: string) => (this.keys.has(code) ? 1 : 0);
    const turn = key('ArrowRight') - key('ArrowLeft');
    if (turn) this.lookBy(turn * TURN_SPEED * dt, 0);
    if (this.navMode === 'look') {
      const tilt = key('ArrowUp') - key('ArrowDown');
      if (tilt) this.lookBy(0, tilt * TURN_SPEED * dt);
    } else {
      const forward = key('KeyW') - key('KeyS') + key('ArrowUp') - key('ArrowDown');
      const strafe = key('KeyD') - key('KeyA');
      const rise = key('KeyE') - key('KeyQ');
      const run = key('ShiftLeft') || key('ShiftRight') ? RUN_FACTOR : 1;
      if (rise && this.navMode === 'walk') {
        this.eyeHeightScale = Math.min(20, Math.max(0.2, this.eyeHeightScale * Math.exp(rise * dt * 1.2)));
        this.dirty = true;
      }
      this.moveBy(forward, strafe, this.navMode === 'fly' ? rise : 0, this.moveSpeed * run * dt);
    }

    if (this.eyeTravel) {
      const tr = this.eyeTravel;
      const t = Math.min((performance.now() - tr.start) / tr.duration, 1);
      const e = easeInOut(t);
      this.goalEye = [tr.from[0] + (tr.to[0] - tr.from[0]) * e, tr.from[1] + (tr.to[1] - tr.from[1]) * e, tr.from[2] + (tr.to[2] - tr.from[2]) * e];
      if (t >= 1) this.eyeTravel = null;
      this.dirty = true;
    } else if (this.followsGround && this.ground !== null) {
      // Ride the probed ground at eye height (smoothing turns steps into easing).
      const off = this.ground + this.eyeHeight - vec3.dot(this.goalEye, this.up);
      if (Math.abs(off) > 1e-4 * this.sceneScale) this.goalEye = vec3.add(this.goalEye, vec3.scale(this.up, off));
    }
  }

  private get moveSpeed() {
    if (this.navMode === 'interior') return INTERIOR.SPEED * this.unitsPerMeter * this.speed;
    return (this.navMode === 'fly' ? FLY_SPEED : WALK_SPEED) * this.sceneScale * this.speed;
  }

  /** The collision grid while in interior. */
  private get interiorGrid() {
    return this.navMode === 'interior' ? this.collider : null;
  }

  /**
   * Interior scale, from the grid's room height. Without one (still loading, or no ceiling found)
   * it falls back to the walk heuristic, so the eye stays at walk height.
   * shortcut: a scan without a ceiling gets that heuristic; a per-scene metres setting would fix it.
   */
  private get unitsPerMeter() {
    return this.collider?.unitsPerMeter ?? (EYE_HEIGHT * this.sceneScale) / INTERIOR.EYE;
  }

  private get body(): Body {
    const u = this.unitsPerMeter;
    return { eye: INTERIOR.EYE * u, radius: INTERIOR.RADIUS * u, step: INTERIOR.STEP * u, head: INTERIOR.HEAD * u };
  }

  /** Feet under the eye goal, on the known ground. */
  private feet(): Vec3 {
    const h = vec3.dot(this.goalEye, this.up);
    return vec3.add(this.goalEye, vec3.scale(this.up, (this.ground ?? h - this.eyeHeight) - h));
  }

  /** A point straight ahead of the eye goal, level. */
  private lookAhead(): Vec3 {
    return vec3.sub(this.goalEye, this.offset(this.goalTheta, Math.PI / 2, 1));
  }

  /** Moves the eye goal along the view: forward (walk: level), right, and up (`amount` world units). */
  private moveBy(forward: number, right: number, rise: number, amount: number) {
    if (!forward && !right && !rise) return;
    const look = vec3.scale(this.offset(this.goalTheta, this.goalPhi, 1), -1);
    const ahead = this.navMode === 'fly' ? look : vec3.normalize(this.horizontal(look));
    const side = vec3.normalize(vec3.cross(look, this.up));
    const dir = vec3.add(vec3.add(vec3.scale(ahead, forward), vec3.scale(side, right)), vec3.scale(this.up, rise));
    const len = vec3.length(dir);
    if (len < 1e-6) return;
    this.eyeTravel = null;
    const step = vec3.scale(dir, amount / Math.max(len, 1));
    const grid = this.interiorGrid;
    if (grid) {
      // Interior: walk the step on the floor, sliding along whatever blocks it.
      const feet = this.feet();
      const stop = grid.slide(feet, vec3.add(feet, step), this.body);
      this.ground = vec3.dot(stop, this.up);
      this.goalEye = vec3.add(stop, vec3.scale(this.up, this.eyeHeight));
    } else {
      this.goalEye = vec3.add(this.goalEye, step);
    }
    this.dirty = true;
  }

  /** Turns the first-person view: positive yaw turns right, positive pitch looks up. */
  private lookBy(yaw: number, pitch: number) {
    const [min, max] = this.navMode === 'interior' ? [INTERIOR.MIN_PHI, INTERIOR.MAX_PHI] : [LOOK_MIN_PHI, LOOK_MAX_PHI];
    this.goalTheta -= yaw;
    this.goalPhi = Math.max(min, Math.min(max, this.goalPhi + pitch));
    this.dirty = true;
  }

  private travelEyeTo(dest: Vec3, minMs = 600) {
    const dist = vec3.length(vec3.sub(dest, this.goalEye));
    const ms = Math.min(1800, Math.max(minMs, (350 * dist) / Math.max(this.moveSpeed, 1e-6)));
    this.eyeTravel = { start: performance.now(), duration: ms, from: [...this.goalEye], to: dest };
    this.dirty = true;
  }

  /** `v` without its component along `up`. */
  private horizontal(v: Vec3): Vec3 {
    return vec3.sub(v, vec3.scale(this.up, vec3.dot(v, this.up)));
  }

  private offset(theta: number, phi: number, radius: number): Vec3 {
    const s = Math.sin(phi);
    const horizontal = vec3.add(vec3.scale(this.forward0, Math.cos(theta) * s), vec3.scale(this.right0, Math.sin(theta) * s));
    return vec3.scale(vec3.add(horizontal, vec3.scale(this.up, Math.cos(phi))), radius);
  }

  private clampPhi(phi: number) {
    return Math.max(this.limits.minPolarAngle, Math.min(this.limits.maxPolarAngle, phi));
  }

  private clampRadius(r: number) {
    return Math.max(this.limits.minDistance, Math.min(this.limits.maxDistance, r));
  }

  private emitStart() {
    this.autoRotate = false;
    this.cancelFly();
    this.startListeners.forEach((cb) => cb());
  }

  private viewportHeight() {
    return this.element?.clientHeight || window.innerHeight || 1;
  }

  private rotateBy(dx: number, dy: number) {
    const h = this.viewportHeight();
    if (this.navMode !== 'orbit') {
      // Grab the world (like a panorama): the scene follows the pointer 1:1.
      const perPixel = this.fovY / h;
      this.lookBy(-dx * perPixel, dy * perPixel);
      return;
    }
    this.goalTheta -= ((2 * Math.PI * dx) / h) * this.rotateSpeed;
    this.goalPhi = this.clampPhi(this.goalPhi - ((2 * Math.PI * dy) / h) * this.rotateSpeed);
  }

  private panBy(dx: number, dy: number) {
    const h = this.viewportHeight();
    if (this.navMode !== 'orbit') {
      // Two-finger drag moves like a joystick: up = forward, sideways = strafe.
      if (this.navMode !== 'look') this.moveBy(-dy, dx, 0, (Math.hypot(dx, dy) / h) * this.moveSpeed * 4);
      return;
    }
    const worldPerPixel = (2 * this.goalRadius * Math.tan(this.fovY / 2)) / h;
    // Camera basis from the goal orientation.
    const back = vec3.normalize(this.offset(this.goalTheta, this.goalPhi, 1));
    let right = vec3.cross(this.up, back);
    if (vec3.length(right) < 1e-6) right = this.right0;
    right = vec3.normalize(right);
    const camUp = vec3.cross(back, right);
    const move = vec3.add(vec3.scale(right, -dx * worldPerPixel * this.panSpeed), vec3.scale(camUp, dy * worldPerPixel * this.panSpeed));
    this.goalTarget = vec3.add(this.goalTarget, move);
  }

  /** Zoom gesture: factor > 1 means "away" (orbit dolly out, first person back up / widen the view). */
  private dollyBy(factor: number) {
    if (this.navMode === 'look') this.onFovZoom?.(factor);
    else if (this.navMode !== 'orbit') this.moveBy(-Math.sign(Math.log(factor)), 0, 0, Math.abs(Math.log(factor)) * this.moveSpeed * 3);
    else this.goalRadius = this.clampRadius(this.goalRadius * factor);
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    this.element?.setPointerCapture(e.pointerId);
    const pan = e.button === 1 || e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, pan });
    if (this.pointers.size === 2) this.pinchDistance = this.currentPinchDistance();
    if (this.pointers.size === 1) this.emitStart();
  };

  private onPointerMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    if (this.pointers.size === 1) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (p.pan && this.navMode === 'orbit') this.panBy(dx, dy);
      else this.rotateBy(dx, dy);
      p.x = e.clientX;
      p.y = e.clientY;
      return;
    }
    // Two fingers: pinch to dolly, move the midpoint to pan.
    const before = this.midpoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const after = this.midpoint();
    const dist = this.currentPinchDistance();
    if (this.pinchDistance > 0 && dist > 0) this.dollyBy(this.pinchDistance / dist);
    this.pinchDistance = dist;
    this.panBy(after[0] - before[0], after[1] - before[1]);
  };

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.element?.hasPointerCapture(e.pointerId)) this.element.releasePointerCapture(e.pointerId);
    this.pinchDistance = this.pointers.size === 2 ? this.currentPinchDistance() : 0;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.emitStart();
    // Normalize line/page deltas to pixels.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.viewportHeight() : 1;
    const delta = Math.max(-200, Math.min(200, e.deltaY * unit));
    this.dollyBy(Math.exp(delta * 0.0015 * this.zoomSpeed));
  };

  private onContextMenu = (e: Event) => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.navMode === 'orbit' || !MOVE_KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (e.code.startsWith('Arrow')) e.preventDefault();
    if (!this.keys.has(e.code)) {
      if (!e.code.startsWith('Shift')) this.emitStart();
      this.keys.add(e.code);
      this.dirty = true;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => this.keys.clear();

  private onOrientation = (e: DeviceOrientationEvent) => {
    if (this.navMode === 'orbit' || e.alpha === null || e.beta === null || e.gamma === null) return;
    const look = deviceLook(e.alpha, e.beta, e.gamma, screen.orientation?.angle ?? 0);
    const last = this.gyroLast;
    this.gyroLast = look;
    // Relative: drags and keys keep working on top of the device rotation.
    if (last) this.lookBy(-wrapAngle(look[0] - last[0]), look[1] - last[1]);
  };

  private midpoint(): [number, number] {
    let x = 0;
    let y = 0;
    this.pointers.forEach((p) => {
      x += p.x;
      y += p.y;
    });
    const n = this.pointers.size || 1;
    return [x / n, y / n];
  }

  private currentPinchDistance() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }
}

/**
 * Yaw (counter-clockwise, turning left is positive) and pitch (looking up is
 * positive) of the view through the back of a device, from DeviceOrientation
 * angles in degrees. Same frame math as three.js DeviceOrientationControls.
 */
export function deviceLook(alpha: number, beta: number, gamma: number, screenAngle: number): [number, number] {
  const d = Math.PI / 180;
  // Euler (beta, alpha, -gamma) in 'YXZ' order -> quaternion.
  const [x, y, z] = [beta * d, alpha * d, -gamma * d];
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  let q: [number, number, number, number] = [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  ];
  const mul = (a: typeof q, b: typeof q): typeof q => [
    a[0] * b[3] + a[3] * b[0] + a[1] * b[2] - a[2] * b[1],
    a[1] * b[3] + a[3] * b[1] + a[2] * b[0] - a[0] * b[2],
    a[2] * b[3] + a[3] * b[2] + a[0] * b[1] - a[1] * b[0],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  q = mul(q, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]); // the camera looks out of the back of the device
  const half = (-screenAngle * d) / 2;
  q = mul(q, [0, 0, Math.sin(half), Math.cos(half)]); // compensate screen rotation
  // forward = q · (0, 0, -1)
  const [qx, qy, qz, qw] = q;
  const v: Vec3 = [0, 0, -1];
  const t = vec3.scale(vec3.cross([qx, qy, qz], v), 2);
  const f = vec3.add(vec3.add(v, vec3.scale(t, qw)), vec3.cross([qx, qy, qz], t));
  return [Math.atan2(-f[0], -f[2]), Math.asin(Math.max(-1, Math.min(1, f[1])))];
}
