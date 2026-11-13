import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type EquipmentId = 'tank' | 'pump' | 'inletValve' | 'outletValve' | 'lt' | 'ft' | 'pt' | 'lshh' | 'lsll' | 'estop';

/** Everything the scene needs to draw one frame. Plain data, no references into the simulation. */
export interface SceneState {
  levelPct: number;
  pumpSpeedPct: number;
  pumpTripped: boolean;
  inletValvePct: number;
  outletValvePct: number;
  inflowLps: number;
  outflowLps: number;
  pressureBar: number;
  setpoint: number;
  levelMeasured: number;
  switchHH: boolean;
  switchLL: boolean;
  estopPressed: boolean;
  limits: { hh: number; h: number; l: number; ll: number };
  pumpMaxFlowLps: number;
}

export interface SceneCallbacks {
  onSelect(id: EquipmentId | null): void;
  onSetpointDrag(pct: number): void;
  onEStopToggle(): void;
}

// ---- layout constants (metres, stylised: not to scale with the 1.5 m physical tank)
const TANK_X = 1.4;
const TANK_R = 0.85;
const TANK_H = 2.3;
const TANK_Y0 = 0.12;
const levelY = (pct: number): number => TANK_Y0 + (Math.min(100, Math.max(0, pct)) / 100) * TANK_H;

const COLORS = {
  steel: 0xb4bac0,
  steelDark: 0x7a828a,
  graphite: 0x353b41,
  red: 0xc8102e,
  paper: 0xf5f6f7,
  water: 0x93a5b3,
  glass: 0xdfe4e8,
  floor: 0xe9ebed,
};

function std(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.25, ...opts });
}

function cylBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material): THREE.Mesh {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 20), mat);
  m.position.copy(a.clone().add(b).multiplyScalar(0.5));
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

function pipe(points: THREE.Vector3[], radius: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < points.length - 1; i++) g.add(cylBetween(points[i] as THREE.Vector3, points[i + 1] as THREE.Vector3, radius, mat));
  for (let i = 1; i < points.length - 1; i++) {
    const j = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), mat);
    j.position.copy(points[i] as THREE.Vector3);
    g.add(j);
  }
  return g;
}

class Path {
  private readonly pts: THREE.Vector3[];
  private readonly cum: number[] = [0];
  readonly length: number;
  constructor(pts: THREE.Vector3[]) {
    this.pts = pts;
    for (let i = 1; i < pts.length; i++) this.cum.push((this.cum[i - 1] as number) + (pts[i] as THREE.Vector3).distanceTo(pts[i - 1] as THREE.Vector3));
    this.length = this.cum[this.cum.length - 1] as number;
  }
  at(s: number, out: THREE.Vector3): THREE.Vector3 {
    const d = (s - Math.floor(s)) * this.length;
    let i = 1;
    while (i < this.cum.length - 1 && (this.cum[i] as number) < d) i++;
    const c0 = this.cum[i - 1] as number;
    const c1 = this.cum[i] as number;
    const t = c1 > c0 ? (d - c0) / (c1 - c0) : 0;
    return out.copy(this.pts[i - 1] as THREE.Vector3).lerp(this.pts[i] as THREE.Vector3, t);
  }
}

interface ValveParts {
  group: THREE.Group;
  stem: THREE.Mesh;
  wheel: THREE.Group;
}

function buildValve(): ValveParts {
  const group = new THREE.Group();
  const body = std(COLORS.graphite, { roughness: 0.4 });
  const mid = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), body);
  const coneL = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.12, 0.22, 24), body);
  coneL.rotation.z = Math.PI / 2;
  coneL.position.x = -0.22;
  const coneR = coneL.clone();
  coneR.position.x = 0.22;
  const bonnet = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.22, 20), body);
  bonnet.position.y = 0.28;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 12), std(COLORS.steel));
  stem.position.y = 0.5;
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 10, 32), std(COLORS.red));
  rim.rotation.x = Math.PI / 2;
  wheel.add(rim);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.016, 0.016), std(COLORS.red));
    spoke.rotation.y = (i * Math.PI) / 3;
    wheel.add(spoke);
  }
  wheel.position.y = 0.62;
  group.add(mid, coneL, coneR, bonnet, stem, wheel);
  return { group, stem, wheel };
}

interface Label {
  el: HTMLDivElement;
  anchor: THREE.Vector3;
  text: (s: SceneState) => string;
}

export class PlantScene {
  private readonly host: HTMLElement;
  private readonly labelHost: HTMLElement;
  private readonly cb: SceneCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly pickables: THREE.Object3D[] = [];
  private readonly groups = new Map<string, THREE.Group>();
  private readonly highlight = new Map<string, THREE.MeshStandardMaterial[]>();
  private readonly labels: Label[] = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly tmp = new THREE.Vector3();

  private selected: EquipmentId | null = null;
  private hovered: string | null = null;
  private dragging = false;
  private downAt: { x: number; y: number } | null = null;
  private userMovedCamera = false;
  private disposed = false;

  // animated parts
  private water!: THREE.Mesh;
  private waterTop!: THREE.Mesh;
  private gaugeWater!: THREE.Mesh;
  private rim!: THREE.Mesh;
  private fan!: THREE.Group;
  private pumpLamp!: THREE.Mesh;
  private inletValve!: ValveParts;
  private outletValve!: ValveParts;
  private estopCap!: THREE.Mesh;
  private estopGlow!: THREE.Mesh;
  private lampHH!: THREE.Mesh;
  private lampLL!: THREE.Mesh;
  private spRing!: THREE.Mesh;
  private spHandle!: THREE.Group;
  private limitRings: Record<'hh' | 'h' | 'l' | 'll', THREE.Mesh> = {} as never;
  private inStream!: THREE.Mesh;
  private outStream!: THREE.Mesh;
  private pathIn!: Path;
  private pathOut!: Path;
  private dotsIn!: THREE.InstancedMesh;
  private dotsOut!: THREE.InstancedMesh;
  private phaseIn = 0;
  private phaseOut = 0;
  private fanAngle = 0;
  private readonly dummy = new THREE.Object3D();

  constructor(host: HTMLElement, labelHost: HTMLElement, cb: SceneCallbacks) {
    this.host = host;
    this.labelHost = labelHost;
    this.cb = cb;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add('scene-canvas');

    this.buildLights();
    this.buildFloor();
    this.buildTank();
    this.buildReservoir();
    this.buildPump();
    this.buildPiping();
    this.buildSensors();
    this.buildEStop();
    this.buildFlowVisuals();
    this.buildLabels();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2.05;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 22;
    this.controls.target.set(0.2, 1.4, 0);
    this.controls.addEventListener('start', () => {
      this.userMovedCamera = true;
    });

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointerleave', this.onLeave);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.resetView();
  }

  // ------------------------------------------------------------------ public API

  setSelected(id: EquipmentId | null): void {
    this.selected = id;
  }

  /** Canvas-relative pixel position of an object's centre (used by automated UI tests). */
  screenPointOf(id: string): { x: number; y: number } | null {
    const g = this.groups.get(id);
    if (!g) return null;
    const c = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3()).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((c.x * 0.5 + 0.5) * r.width), y: r.top + ((-c.y * 0.5 + 0.5) * r.height) };
  }

  resetView(): void {
    this.userMovedCamera = false;
    const aspect = this.camera.aspect || 1;
    const portrait = aspect < 0.9;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    // Landscape: frame the whole plant. Portrait: frame tank + pump (user can pan/zoom for the rest).
    const halfW = portrait ? 5.4 : 6.6;
    const fitW = halfW / (Math.tan(vfov / 2) * aspect);
    const fitH = 2.7 / Math.tan(vfov / 2);
    const dist = Math.max(8.5, Math.min(24, Math.max(fitW * 0.9, fitH)));
    const dir = portrait ? new THREE.Vector3(0.25, 0.6, 0.8).normalize() : new THREE.Vector3(0.3, 0.42, 0.86).normalize();
    this.controls.target.set(portrait ? 0.2 : 0.3, 1.3, 0);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.controls.update();
  }

  resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userMovedCamera) this.resetView();
  }

  update(s: SceneState, realDt: number): void {
    if (this.disposed) return;
    const dt = Math.min(realDt, 0.1);

    // water body
    const wy = levelY(s.levelPct);
    const wh = Math.max(0.0001, wy - TANK_Y0);
    this.water.scale.y = wh;
    this.water.position.y = TANK_Y0 + wh / 2;
    this.water.visible = s.levelPct > 0.15;
    this.waterTop.position.y = wy;
    this.waterTop.visible = this.water.visible;
    this.gaugeWater.scale.y = wh;
    this.gaugeWater.position.y = TANK_Y0 + wh / 2;
    this.gaugeWater.visible = this.water.visible;
    (this.rim.material as THREE.MeshStandardMaterial).color.setHex(s.switchHH ? COLORS.red : COLORS.graphite);

    // pump
    this.fanAngle += (s.pumpSpeedPct / 100) * 14 * dt;
    this.fan.rotation.x = this.fanAngle;
    const lamp = this.pumpLamp.material as THREE.MeshStandardMaterial;
    if (s.pumpTripped) lamp.color.setHex(COLORS.red), lamp.emissive.setHex(COLORS.red), (lamp.emissiveIntensity = 0.9);
    else if (s.pumpSpeedPct > 2) lamp.color.setHex(0xffffff), lamp.emissive.setHex(0xffffff), (lamp.emissiveIntensity = 0.7);
    else lamp.color.setHex(COLORS.steelDark), lamp.emissive.setHex(0x000000), (lamp.emissiveIntensity = 0);

    // valves: wheel turns, stem rises with opening
    for (const [v, pct] of [[this.inletValve, s.inletValvePct], [this.outletValve, s.outletValvePct]] as const) {
      const f = pct / 100;
      v.wheel.rotation.y = f * Math.PI * 4;
      v.stem.scale.y = 0.4 + 0.6 * f;
      v.stem.position.y = 0.36 + 0.14 * f * 1.4;
      v.wheel.position.y = 0.46 + 0.16 * f;
    }

    // switches lamps
    this.setLamp(this.lampHH, s.switchHH);
    this.setLamp(this.lampLL, s.switchLL);

    // e-stop
    this.estopCap.position.y = s.estopPressed ? 0.17 : 0.22;
    this.estopGlow.visible = s.estopPressed;

    // setpoint marker + alarm limit rings
    const spY = levelY(s.setpoint);
    this.spRing.position.y = spY;
    this.spHandle.position.y = spY;
    (['hh', 'h', 'l', 'll'] as const).forEach((k) => {
      this.limitRings[k].position.y = levelY(s.limits[k]);
    });

    // streams and particles
    const qIn = s.inflowLps;
    const qOut = s.outflowLps;
    const dropTop = 2.62;
    const dropLen = Math.max(0.01, dropTop - wy);
    this.inStream.visible = qIn > 0.05;
    this.inStream.scale.set(0.5 + Math.sqrt(qIn / s.pumpMaxFlowLps) * 1.6, dropLen, 0.5 + Math.sqrt(qIn / s.pumpMaxFlowLps) * 1.6);
    this.inStream.position.y = wy + dropLen / 2;
    this.outStream.visible = qOut > 0.05;
    this.phaseIn = (this.phaseIn + (qIn / s.pumpMaxFlowLps) * 0.35 * dt) % 1;
    this.phaseOut = (this.phaseOut + Math.min(1, qOut / s.pumpMaxFlowLps) * 0.3 * dt) % 1;
    this.placeDots(this.dotsIn, this.pathIn, this.phaseIn, qIn > 0.05 ? Math.min(1, 0.25 + qIn / s.pumpMaxFlowLps) : 0);
    this.placeDots(this.dotsOut, this.pathOut, this.phaseOut, qOut > 0.05 ? Math.min(1, 0.25 + qOut / s.pumpMaxFlowLps) : 0);

    // highlight
    this.applyHighlight();

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateLabels(s);
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointerleave', this.onLeave);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
    el.remove();
    for (const l of this.labels) l.el.remove();
  }

  // ------------------------------------------------------------------ construction

  private register(id: string, group: THREE.Group, pickable = true): void {
    this.scene.add(group);
    this.groups.set(id, group);
    const mats = new Set<THREE.MeshStandardMaterial>();
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (pickable) {
        m.userData.id = id;
        this.pickables.push(m);
      }
      if (m.material instanceof THREE.MeshStandardMaterial) mats.add(m.material);
    });
    this.highlight.set(id, [...mats]);
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd4d8, 1.35));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(5, 9, 6);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xdde3ea, 0.5);
    fill.position.set(-6, 4, -3);
    this.scene.add(fill);
  }

  private contactShadow(x: number, z: number, w: number, d: number): void {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (g) {
      const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
      grad.addColorStop(0, 'rgba(40,46,52,0.35)');
      grad.addColorStop(1, 'rgba(40,46,52,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.003, z);
    this.scene.add(m);
  }

  private buildFloor(): void {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(22, 12), new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 1, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(22, 44, 0xc4c9ce, 0xd9dde0);
    grid.position.y = 0.002;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.7;
    this.scene.add(grid);
    this.contactShadow(TANK_X, 0, 3.6, 3.6);
    this.contactShadow(-2.4, 0, 2.6, 1.3);
    this.contactShadow(-5, 0, 2.6, 2.4);
  }

  private buildTank(): void {
    const g = new THREE.Group();
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(TANK_R + 0.12, TANK_R + 0.16, TANK_Y0, 40), std(COLORS.steelDark));
    plinth.position.set(TANK_X, TANK_Y0 / 2, 0);
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(TANK_R, TANK_R, TANK_H, 56, 1, true),
      new THREE.MeshStandardMaterial({ color: COLORS.glass, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, roughness: 0.1, metalness: 0 }),
    );
    wall.position.set(TANK_X, TANK_Y0 + TANK_H / 2, 0);
    wall.renderOrder = 3;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(TANK_R, TANK_R, 0.03, 56), std(COLORS.steel));
    base.position.set(TANK_X, TANK_Y0 + 0.015, 0);
    this.rim = new THREE.Mesh(new THREE.TorusGeometry(TANK_R, 0.03, 12, 64), std(COLORS.graphite));
    this.rim.rotation.x = Math.PI / 2;
    this.rim.position.set(TANK_X, TANK_Y0 + TANK_H, 0);
    const foot = new THREE.Mesh(new THREE.TorusGeometry(TANK_R, 0.025, 12, 64), std(COLORS.graphite));
    foot.rotation.x = Math.PI / 2;
    foot.position.set(TANK_X, TANK_Y0 + 0.03, 0);

    this.water = new THREE.Mesh(new THREE.CylinderGeometry(TANK_R - 0.02, TANK_R - 0.02, 1, 56), new THREE.MeshStandardMaterial({ color: COLORS.water, transparent: true, opacity: 0.78, roughness: 0.2, metalness: 0 }));
    this.water.position.set(TANK_X, TANK_Y0, 0);
    this.waterTop = new THREE.Mesh(new THREE.CircleGeometry(TANK_R - 0.02, 56), new THREE.MeshStandardMaterial({ color: 0xb5c3ce, transparent: true, opacity: 0.9, roughness: 0.1, metalness: 0 }));
    this.waterTop.rotation.x = -Math.PI / 2;
    this.waterTop.position.set(TANK_X, TANK_Y0, 0);
    g.add(plinth, wall, base, this.rim, foot, this.water, this.waterTop);

    // alarm limit rings (grey = H/L, red = HH/LL) and the setpoint ring
    const ring = (color: number, tube: number) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(TANK_R + 0.008, tube, 8, 64), new THREE.MeshBasicMaterial({ color }));
      m.rotation.x = Math.PI / 2;
      m.position.x = TANK_X;
      return m;
    };
    this.limitRings = { hh: ring(COLORS.red, 0.006), h: ring(COLORS.steelDark, 0.005), l: ring(COLORS.steelDark, 0.005), ll: ring(COLORS.red, 0.006) };
    Object.values(this.limitRings).forEach((m) => g.add(m));
    this.spRing = ring(COLORS.red, 0.014);
    g.add(this.spRing);

    this.register('tank', g);

    // Setpoint handle: draggable red tab on the front-left of the tank
    const h = new THREE.Group();
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.05), std(COLORS.red, { roughness: 0.4 }));
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 3), std(COLORS.red));
    arrow.rotation.z = -Math.PI / 2;
    arrow.position.x = 0.23;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.4), new THREE.MeshBasicMaterial({ visible: false }));
    h.add(tab, arrow, hit);
    const theta = THREE.MathUtils.degToRad(-58);
    const rr = TANK_R + 0.32;
    h.position.set(TANK_X + Math.sin(theta) * rr, 0, Math.cos(theta) * rr);
    h.rotation.y = theta + Math.PI / 2; // local +x (the arrow) points at the tank axis
    this.spHandle = h;
    this.register('sp', h);
  }

  private buildReservoir(): void {
    const g = new THREE.Group();
    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 1, 1.5),
      new THREE.MeshStandardMaterial({ color: COLORS.glass, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, roughness: 0.2, metalness: 0 }),
    );
    walls.position.set(-5.0, 0.5, 0);
    walls.renderOrder = 3;
    const water = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.78, 1.44), new THREE.MeshStandardMaterial({ color: COLORS.water, transparent: true, opacity: 0.7, roughness: 0.2, metalness: 0 }));
    water.position.set(-5.0, 0.4, 0);
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.7, 1, 1.5)), new THREE.LineBasicMaterial({ color: COLORS.graphite }));
    frame.position.set(-5.0, 0.5, 0);
    g.add(walls, water, frame);
    this.scene.add(g);
  }

  private buildPump(): void {
    const g = new THREE.Group();
    const casing = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.34, 32), std(COLORS.red, { roughness: 0.45 }));
    casing.rotation.z = Math.PI / 2;
    casing.position.set(-2.75, 0.4, 0);
    const volute = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), std(COLORS.red, { roughness: 0.45 }));
    volute.position.set(-2.75, 0.4, 0);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.85, 32), std(COLORS.steel, { roughness: 0.35 }));
    motor.rotation.z = Math.PI / 2;
    motor.position.set(-2.18, 0.4, 0);
    for (let i = 0; i < 6; i++) {
      const fin = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.012, 6, 32), std(COLORS.steelDark));
      fin.rotation.y = Math.PI / 2;
      fin.position.set(-2.4 + i * 0.13, 0.4, 0);
      g.add(fin);
    }
    const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.1, 32), std(COLORS.graphite));
    cover.rotation.z = Math.PI / 2;
    cover.position.set(-1.72, 0.4, 0);
    this.fan = new THREE.Group();
    this.fan.position.set(-1.66, 0.4, 0);
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.38, 0.07), std(COLORS.paper));
      blade.rotation.x = (i * Math.PI) / 4;
      this.fan.add(blade);
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.6), std(COLORS.graphite));
    base.position.set(-2.3, 0.04, 0);
    this.pumpLamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), std(COLORS.steelDark, { emissive: 0x000000 }));
    this.pumpLamp.position.set(-2.18, 0.7, 0);
    g.add(casing, volute, motor, cover, this.fan, base, this.pumpLamp);
    this.register('pump', g);
  }

  private buildPiping(): void {
    const mat = () => std(COLORS.steel, { roughness: 0.4, metalness: 0.45 });
    const V = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
    // suction
    const suction = pipe([V(-4.15, 0.4), V(-2.95, 0.4)], 0.09, mat());
    // discharge: up, across, down into tank
    const discharge = pipe([V(-2.75, 0.7), V(-2.75, 3.1), V(TANK_X, 3.1), V(TANK_X, 2.62)], 0.09, mat());
    // outlet
    const outlet = pipe([V(TANK_X + TANK_R - 0.02, 0.4), V(5.4, 0.4), V(5.4, 0.16)], 0.09, mat());
    const pipes = new THREE.Group();
    pipes.add(suction, discharge, outlet);
    this.scene.add(pipes);

    // drain pit
    const pit = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 1.0), std(COLORS.graphite));
    pit.position.set(5.4, 0.03, 0);
    this.scene.add(pit);

    // valves (axis along X)
    this.inletValve = buildValve();
    this.inletValve.group.position.set(-0.7, 3.1, 0);
    this.register('inletValve', this.inletValve.group);
    this.outletValve = buildValve();
    this.outletValve.group.position.set(3.5, 0.4, 0);
    this.register('outletValve', this.outletValve.group);

    this.pathIn = new Path([V(-4.15, 0.4), V(-2.75, 0.4), V(-2.75, 3.1), V(TANK_X, 3.1), V(TANK_X, 2.62)]);
    this.pathOut = new Path([V(TANK_X + TANK_R, 0.4), V(5.4, 0.4), V(5.4, 0.16)]);
  }

  private buildSensors(): void {
    // Flow transmitter on the discharge riser
    const ft = new THREE.Group();
    const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.32, 24), std(COLORS.graphite));
    spool.position.set(-2.75, 1.6, 0);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.2), std(COLORS.paper, { roughness: 0.3 }));
    head.position.set(-2.75, 1.88, 0);
    ft.add(spool, head);
    this.register('ft', ft);

    // Pressure transmitter on a stub
    const pt = new THREE.Group();
    const stub = cylBetween(new THREE.Vector3(-2.75, 1.0, 0), new THREE.Vector3(-2.75, 1.0, 0.34), 0.03, std(COLORS.steel));
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 28), std(COLORS.paper, { roughness: 0.3 }));
    dial.rotation.x = Math.PI / 2;
    dial.position.set(-2.75, 1.0, 0.4);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.015, 8, 28), std(COLORS.graphite));
    bezel.position.set(-2.75, 1.0, 0.44);
    pt.add(stub, dial, bezel);
    this.register('pt', pt);

    // Level sight glass + transmitter on the front of the tank
    const zFront = TANK_R + 0.3;
    const lt = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, TANK_H, 16, 1, true), new THREE.MeshStandardMaterial({ color: COLORS.glass, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    tube.position.set(TANK_X, TANK_Y0 + TANK_H / 2, zFront);
    this.gaugeWater = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 1, 12), new THREE.MeshStandardMaterial({ color: COLORS.red, roughness: 0.3, metalness: 0.1 }));
    this.gaugeWater.position.set(TANK_X, TANK_Y0, zFront);
    const connLo = cylBetween(new THREE.Vector3(TANK_X, TANK_Y0 + 0.1, TANK_R), new THREE.Vector3(TANK_X, TANK_Y0 + 0.1, zFront), 0.025, std(COLORS.steel));
    const connHi = cylBetween(new THREE.Vector3(TANK_X, TANK_Y0 + TANK_H - 0.1, TANK_R), new THREE.Vector3(TANK_X, TANK_Y0 + TANK_H - 0.1, zFront), 0.025, std(COLORS.steel));
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.18), std(COLORS.paper, { roughness: 0.3 }));
    box.position.set(TANK_X + 0.28, TANK_Y0 + TANK_H * 0.72, zFront);
    const lead = cylBetween(new THREE.Vector3(TANK_X + 0.05, TANK_Y0 + TANK_H * 0.72, zFront), new THREE.Vector3(TANK_X + 0.2, TANK_Y0 + TANK_H * 0.72, zFront), 0.015, std(COLORS.graphite));
    lt.add(tube, this.gaugeWater, connLo, connHi, box, lead);
    for (let i = 0; i <= 4; i++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(i % 2 === 0 ? 0.16 : 0.1, 0.012, 0.012), new THREE.MeshBasicMaterial({ color: COLORS.graphite }));
      tick.position.set(TANK_X - (i % 2 === 0 ? 0.14 : 0.11), TANK_Y0 + (TANK_H * i) / 4, zFront);
      lt.add(tick);
    }
    this.register('lt', lt);

    // Independent level switches (LSHH near the top, LSLL near the bottom)
    const mkSwitch = (id: 'lshh' | 'lsll', pct: number): THREE.Mesh => {
      const sw = new THREE.Group();
      const th = THREE.MathUtils.degToRad(48);
      const y = levelY(pct);
      const a = new THREE.Vector3(TANK_X + Math.sin(th) * TANK_R, y, Math.cos(th) * TANK_R);
      const b = new THREE.Vector3(TANK_X + Math.sin(th) * (TANK_R + 0.28), y, Math.cos(th) * (TANK_R + 0.28));
      const stem = cylBetween(a, b, 0.035, std(COLORS.graphite));
      const lampMesh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), std(COLORS.steelDark, { emissive: 0x000000 }));
      lampMesh.position.copy(b);
      sw.add(stem, lampMesh);
      this.register(id, sw);
      return lampMesh;
    };
    this.lampHH = mkSwitch('lshh', 95);
    this.lampLL = mkSwitch('lsll', 5);
  }

  private buildEStop(): void {
    const g = new THREE.Group();
    g.position.set(-0.6, 0, 1.7);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.0, 16), std(COLORS.steelDark));
    post.position.y = 0.5;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.16), std(COLORS.paper, { roughness: 0.35 }));
    box.position.y = 1.12;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 28), std(COLORS.graphite));
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, 1.12, 0.09);
    this.estopCap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.1, 28), std(COLORS.red, { roughness: 0.35 }));
    this.estopCap.rotation.x = Math.PI / 2;
    this.estopCap.position.set(0, 1.12, 0.22);
    // rotate children into a local group so the cap can slide along z
    this.estopCap.position.set(0, 1.12, 0.17);
    this.estopGlow = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 8, 32), new THREE.MeshBasicMaterial({ color: COLORS.red }));
    this.estopGlow.position.set(0, 1.12, 0.1);
    this.estopGlow.visible = false;
    g.add(post, box, collar, this.estopCap, this.estopGlow);
    this.register('estop', g);
    this.contactShadow(-0.6, 1.7, 0.7, 0.7);
  }

  private buildFlowVisuals(): void {
    const streamMat = new THREE.MeshStandardMaterial({ color: COLORS.water, transparent: true, opacity: 0.85, roughness: 0.2, metalness: 0 });
    this.inStream = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 12), streamMat);
    this.inStream.position.x = TANK_X;
    this.scene.add(this.inStream);
    this.outStream = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.24, 12), streamMat);
    this.outStream.position.set(5.4, 0.28, 0);
    this.scene.add(this.outStream);

    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.dotsIn = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6), dotMat, 60);
    this.dotsOut = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6), dotMat, 36);
    this.dotsIn.frustumCulled = this.dotsOut.frustumCulled = false;
    this.scene.add(this.dotsIn, this.dotsOut);
  }

  private placeDots(mesh: THREE.InstancedMesh, path: Path, phase: number, density: number): void {
    const total = mesh.instanceMatrix.count;
    const shown = Math.round(total * density);
    mesh.count = shown;
    for (let i = 0; i < shown; i++) {
      path.at(phase + i / total, this.tmp);
      this.dummy.position.copy(this.tmp);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  private buildLabels(): void {
    const add = (anchor: THREE.Vector3, cls: string, text: (s: SceneState) => string) => {
      const el = document.createElement('div');
      el.className = `tag3d ${cls}`;
      this.labelHost.appendChild(el);
      this.labels.push({ el, anchor, text });
    };
    const f = (n: number, d = 1) => n.toFixed(d);
    add(new THREE.Vector3(TANK_X + 0.2, TANK_Y0 + TANK_H * 0.72 + 0.3, TANK_R + 0.3), 'major', (s) => `LT-101 · ${f(s.levelMeasured)} %`);
    add(new THREE.Vector3(TANK_X + 1.3, TANK_Y0 + TANK_H + 0.55, 0), 'minor', (s) => `SP ${f(s.setpoint)} %`);
    add(new THREE.Vector3(-2.75, 2.2, 0), 'major', (s) => `FT-101 · ${f(s.inflowLps)} L/s`);
    add(new THREE.Vector3(-3.5, 0.75, 0.6), 'minor', (s) => `PT-101 · ${f(s.pressureBar, 2)} bar`);
    add(new THREE.Vector3(-2.0, 1.12, 0), 'major', (s) => `P-101 · ${f(s.pumpSpeedPct, 0)} %`);
    add(new THREE.Vector3(-0.7, 3.65, 0), 'minor', (s) => `XV-101 · ${f(s.inletValvePct, 0)} %`);
    add(new THREE.Vector3(3.5, 1.05, 0), 'minor', (s) => `HV-102 · ${f(s.outletValvePct, 0)} %`);
    add(new THREE.Vector3(-0.6, 1.62, 1.7), 'minor', (s) => (s.estopPressed ? 'ES-001 · PRESSED' : 'ES-001'));
    add(new THREE.Vector3(TANK_X + 0.75, levelY(95) + 0.25, 1.0), 'minor', (s) => `LSHH ${s.switchHH ? 'TRIP' : 'ok'}`);
    add(new THREE.Vector3(TANK_X + 0.75, levelY(5) + 0.25, 1.0), 'minor', (s) => `LSLL ${s.switchLL ? 'TRIP' : 'ok'}`);
    add(new THREE.Vector3(-5, 1.25, 0), 'minor', () => 'Supply tank');
    add(new THREE.Vector3(5.4, 0.7, 0), 'minor', () => 'Drain');
  }

  private updateLabels(s: SceneState): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    for (const l of this.labels) {
      this.tmp.copy(l.anchor).project(this.camera);
      const visible = this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.1 && Math.abs(this.tmp.y) < 1.1;
      l.el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const text = l.text(s);
      if (l.el.textContent !== text) l.el.textContent = text;
      l.el.style.transform = `translate(-50%, -100%) translate(${((this.tmp.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-this.tmp.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
    }
  }

  private setLamp(m: THREE.Mesh, on: boolean): void {
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.color.setHex(on ? COLORS.red : COLORS.steelDark);
    mat.emissive.setHex(on ? COLORS.red : 0x000000);
    mat.emissiveIntensity = on ? 1 : 0;
  }

  private applyHighlight(): void {
    for (const [id, mats] of this.highlight) {
      const strength = id === this.selected ? 0.35 : id === this.hovered ? 0.18 : 0;
      for (const m of mats) {
        // Lamps and the pump lamp manage their own emissive colour; only touch un-lit materials.
        if (m === this.pumpLamp.material || m === this.lampHH.material || m === this.lampLL.material) continue;
        m.emissive.setHex(strength > 0 ? COLORS.red : 0x000000);
        m.emissiveIntensity = strength;
      }
    }
  }

  // ------------------------------------------------------------------ interaction

  private setPointer(e: PointerEvent): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private pick(): string | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    return hit ? ((hit.object.userData.id as string | undefined) ?? null) : null;
  }

  private readonly onDown = (e: PointerEvent): void => {
    this.setPointer(e);
    this.downAt = { x: e.clientX, y: e.clientY };
    if (this.pick() === 'sp') {
      this.dragging = true;
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      this.dragSetpoint(e);
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    this.setPointer(e);
    if (this.dragging) {
      this.dragSetpoint(e);
      return;
    }
    const id = this.pick();
    this.hovered = id;
    this.renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (this.dragging) {
      this.dragging = false;
      this.controls.enabled = true;
      this.renderer.domElement.releasePointerCapture(e.pointerId);
      return;
    }
    const d = this.downAt ? Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) : 99;
    this.downAt = null;
    if (d > 5) return; // it was an orbit gesture, not a click
    this.setPointer(e);
    const id = this.pick();
    if (id === 'estop') this.cb.onEStopToggle();
    if (id === 'sp') return;
    this.cb.onSelect((id as EquipmentId | null) ?? null);
  };

  private readonly onLeave = (): void => {
    this.hovered = null;
  };

  private dragSetpoint(e: PointerEvent): void {
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const n = new THREE.Vector3(this.camera.position.x - TANK_X, 0, this.camera.position.z);
    if (n.lengthSq() < 1e-6) return;
    n.normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(TANK_X, 0, 0));
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, p)) return;
    const pct = ((p.y - TANK_Y0) / TANK_H) * 100;
    this.cb.onSetpointDrag(Math.min(100, Math.max(0, Math.round(pct * 2) / 2)));
  }
}
