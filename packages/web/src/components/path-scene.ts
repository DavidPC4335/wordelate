import {
  ACESFilmicToneMapping,
  AmbientLight,
  CanvasTexture,
  Color,
  Curve,
  DirectionalLight,
  Fog,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import type { PathDrawState } from "../lib/path.js";
import type { Point3 } from "../lib/project.js";

export type PathScene = {
  update(state: PathDrawState): void;
  dispose(): void;
};

const INK_FALLBACK = "#1c1714";
const INK_SOFT_FALLBACK = "#6e665c";
const OK_FALLBACK = "#1d5c3d";
const SERIF_FALLBACK = "Georgia, serif";
const LABEL_HALO = "#e7eef6";
const FOG_COLOR = 0xd0dae4;
const FOV = 40;

/** Share of the cloud radius. Latest stays the biggest bead. */
const LATEST_SHARE = 0.11;
const GOAL_SHARE = 0.078;
const START_SHARE = 0.064;
const STEP_SHARE = 0.042;
const TUBE_SHARE = 0.013;

type Theme = { ink: string; inkSoft: string; ok: string; serif: string };
type Role = "latest" | "goal" | "start" | "step";

function readTheme(): Theme {
  const style = getComputedStyle(document.documentElement);
  return {
    ink: style.getPropertyValue("--ink").trim() || INK_FALLBACK,
    inkSoft: style.getPropertyValue("--ink-soft").trim() || INK_SOFT_FALLBACK,
    ok: style.getPropertyValue("--ok").trim() || OK_FALLBACK,
    serif: style.getPropertyValue("--serif").trim() || SERIF_FALLBACK,
  };
}

function paintBackdrop(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const drawing = canvas.getContext("2d");
  if (!drawing) throw new Error("Could not paint the path background");
  const sky = drawing.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#c9daf0");
  sky.addColorStop(0.38, "#e4ebf2");
  sky.addColorStop(0.7, "#d5dbe3");
  sky.addColorStop(1, "#b4c3d2");
  drawing.fillStyle = sky;
  drawing.fillRect(0, 0, canvas.width, canvas.height);
  const glow = drawing.createRadialGradient(128, 108, 20, 128, 118, 176);
  glow.addColorStop(0, "rgba(255, 255, 255, 0.4)");
  glow.addColorStop(1, "rgba(255, 255, 255, 0)");
  drawing.fillStyle = glow;
  drawing.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

class PolylineCurve extends Curve<Vector3> {
  private readonly points: readonly Vector3[];

  constructor(points: readonly Vector3[]) {
    super();
    this.points = points;
  }

  override getPoint(t: number, optionalTarget?: Vector3): Vector3 {
    const target = optionalTarget ?? new Vector3();
    const first = this.points[0];
    if (!first) return target.set(0, 0, 0);
    const count = this.points.length;
    if (count === 1) return target.copy(first);
    const scaled = Math.min(Math.max(t, 0), 1) * (count - 1);
    const index = Math.min(Math.floor(scaled), count - 2);
    const from = this.points[index];
    const to = this.points[index + 1];
    if (!from || !to) return target.copy(first);
    return target.lerpVectors(from, to, scaled - index);
  }
}

function samePoint(a: Point3, b: Point3, tolerance: number): boolean {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz <= tolerance * tolerance;
}

function measure(points: readonly Point3[]): { cx: number; cy: number; cz: number; span: number } {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const point of points) {
    cx += point[0];
    cy += point[1];
    cz += point[2];
  }
  const count = Math.max(points.length, 1);
  cx /= count;
  cy /= count;
  cz /= count;
  let span = 0;
  for (const point of points) {
    span = Math.max(span, Math.hypot(point[0] - cx, point[1] - cy, point[2] - cz));
  }
  return { cx, cy, cz, span: Math.max(span, 1e-4) };
}

function cloudOf(state: PathDrawState): Point3[] {
  if (state.path.length > 0) return [...state.path, state.goal];
  return [state.start, state.goal];
}

function viewDistance(span: number, aspect: number): number {
  const halfV = ((FOV * Math.PI) / 180) / 2;
  const halfH = Math.atan(Math.tan(halfV) * Math.max(aspect, 0.25));
  const half = Math.min(halfV, halfH);
  const bounds = span * (1 + LATEST_SHARE);
  return Math.max((bounds * 1.32) / Math.sin(half), 1e-3);
}

function disposeMaterial(material: Mesh["material"]): void {
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else {
    material.dispose();
  }
}

function lifted(hex: string, amount: number): Color {
  return new Color(hex).lerp(new Color("#f4efe6"), amount);
}

function sphereMaterial(color: Color, roughness: number, metalness: number, glow: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive: color.clone(),
    emissiveIntensity: glow,
    roughness,
    metalness,
  });
}

function materialFor(role: Role, arrived: boolean, theme: Theme): MeshStandardMaterial {
  if (role === "latest" && arrived) return sphereMaterial(lifted(theme.ok, 0.18), 0.38, 0.06, 0.12);
  if (role === "latest") return sphereMaterial(lifted(theme.ink, 0.46), 0.36, 0.08, 0.06);
  if (role === "goal") return sphereMaterial(lifted(theme.ok, 0.22), 0.44, 0.05, 0.08);
  if (role === "start") return sphereMaterial(lifted(theme.ink, 0.28), 0.5, 0.04, 0.04);
  return sphereMaterial(lifted(theme.inkSoft, 0.22), 0.62, 0.03, 0.03);
}

function shareFor(role: Role): number {
  if (role === "latest") return LATEST_SHARE;
  if (role === "goal") return GOAL_SHARE;
  if (role === "start") return START_SHARE;
  return STEP_SHARE;
}

export function mountPathScene(gl: HTMLCanvasElement, labels: HTMLCanvasElement): PathScene {
  const stage = gl.parentElement;
  if (!stage) throw new Error("Path canvas is not mounted");
  const theme = readTheme();
  const drawing = labels.getContext("2d");
  if (!drawing) throw new Error("Could not draw the path labels");
  const context: CanvasRenderingContext2D = drawing;

  const renderer = new WebGLRenderer({
    canvas: gl,
    antialias: true,
    alpha: false,
  });
  renderer.setClearColor(FOG_COLOR, 1);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  const backdrop = paintBackdrop();
  scene.background = backdrop;
  const fog = new Fog(FOG_COLOR, 1, 20);
  scene.fog = fog;

  const camera = new PerspectiveCamera(FOV, 1, 0.01, 50);
  const ambient = new AmbientLight(0xf4f7fb, 0.34);
  const sky = new HemisphereLight(0xf7fbff, 0x8e877c, 0.72);
  const key = new DirectionalLight(0xfff4e6, 2.8);
  const fill = new DirectionalLight(0xc5d6ea, 0.7);
  scene.add(ambient, sky, key, key.target, fill, fill.target);

  const grid = new GridHelper(1, 24, 0x7f96aa, 0xa4b4c4);
  grid.position.y = -1;
  scene.add(grid);

  const sphereGeometry = new SphereGeometry(1, 32, 24);
  const pointRoot = new Group();
  scene.add(pointRoot);
  let tube: Mesh | null = null;

  const scratch = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  const forward = new Vector3();

  let disposed = false;
  let frame = 0;
  let current: PathDrawState | null = null;
  let theta = 0.7;
  let phi = 1.05;
  let aimed = false;
  let dragging = false;
  let activePointer: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let cssWidth = 1;
  let cssHeight = 1;
  let labelRadius = 1e-4;
  let celebrated = false;
  let winMesh: Mesh | null = null;
  let winBase = 1;
  let sparkStart = 0;
  let sparkSpan = 1;
  const sparks: { mesh: Mesh; velocity: Vector3; spin: number }[] = [];

  function resize(): void {
    const width = stage?.clientWidth ?? 0;
    const height = stage?.clientHeight ?? 0;
    if (width < 2 || height < 2) return;
    cssWidth = width;
    cssHeight = height;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    labels.width = Math.round(width * ratio);
    labels.height = Math.round(height * ratio);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function paintText(
    text: string,
    x: number,
    y: number,
    font: string,
    color: string,
    baseline: CanvasTextBaseline,
    align: CanvasTextAlign,
  ): void {
    context.font = font;
    context.textAlign = align;
    context.textBaseline = baseline;
    const measured = context.measureText(text).width;
    let drawX = x;
    if (align === "right") drawX = Math.max(measured + 4, Math.min(cssWidth - 4, x));
    else if (align === "left") drawX = Math.min(cssWidth - measured - 4, Math.max(4, x));
    else drawX = Math.min(cssWidth - measured / 2 - 4, Math.max(measured / 2 + 4, x));
    const drawY = Math.min(cssHeight - 4, Math.max(4, y));
    context.lineJoin = "round";
    context.lineWidth = 7;
    context.strokeStyle = LABEL_HALO;
    context.strokeText(text, drawX, drawY);
    context.fillStyle = color;
    context.fillText(text, drawX, drawY);
  }

  function fitSize(text: string, size: number, min: number, weight: number): number {
    let next = size;
    context.font = `${weight} ${next}px ${theme.serif}`;
    while (next > min && context.measureText(text).width > cssWidth * 0.56) {
      next -= 1;
      context.font = `${weight} ${next}px ${theme.serif}`;
    }
    return next;
  }

  function toScreen(point: Point3): { x: number; y: number; visible: boolean } {
    scratch.set(point[0], point[1], point[2]);
    scratch.project(camera);
    return {
      x: (scratch.x * 0.5 + 0.5) * cssWidth,
      y: (-scratch.y * 0.5 + 0.5) * cssHeight,
      visible: scratch.z > -1 && scratch.z < 1,
    };
  }

  function pointScreen(point: Point3, worldRadius: number): { x: number; y: number; visible: boolean; radius: number } {
    const center = toScreen(point);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    scratch.set(point[0], point[1], point[2]).addScaledVector(right, worldRadius);
    scratch.project(camera);
    const edgeX = (scratch.x * 0.5 + 0.5) * cssWidth;
    return { ...center, radius: Math.max(10, Math.abs(edgeX - center.x)) };
  }

  /** recentLabels[0] only, beside the latest point. Empty or "…" draws nothing. */
  function drawLabels(state: PathDrawState): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    const text = (state.recentLabels[0] ?? "").trim();
    if (text.length === 0 || text === "…") return;
    const latest = state.path[state.path.length - 1] ?? state.start;
    const head = pointScreen(latest, labelRadius);
    if (!head.visible) return;
    const size = fitSize(text, Math.min(36, cssWidth * 0.055), 14, 600);
    const font = `600 ${size}px ${theme.serif}`;
    const color = state.arrived ? theme.ok : theme.ink;
    const gap = head.radius + 8;
    if (head.x < cssWidth * 0.62) {
      paintText(text, head.x + gap, head.y, font, color, "middle", "left");
    } else {
      paintText(text, head.x - gap, head.y, font, color, "middle", "right");
    }
  }

  function facingAngles(state: PathDrawState): { theta: number; phi: number } {
    const ax = state.goal[0] - state.start[0];
    const ay = state.goal[1] - state.start[1];
    const az = state.goal[2] - state.start[2];
    let bx = 0;
    let by = 1;
    let bz = 0;
    let best = -1;
    for (const point of state.path) {
      const px = point[0] - state.start[0];
      const py = point[1] - state.start[1];
      const pz = point[2] - state.start[2];
      const spread = Math.hypot(ay * pz - az * py, az * px - ax * pz, ax * py - ay * px);
      if (spread > best) {
        best = spread;
        bx = px;
        by = py;
        bz = pz;
      }
    }
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    let length = Math.hypot(nx, ny, nz);
    if (length < 1e-8) {
      nx = -az;
      ny = 0;
      nz = ax;
      length = Math.hypot(nx, ny, nz);
    }
    if (length < 1e-8) {
      nx = 0.3;
      ny = 0.4;
      nz = 0.8;
      length = Math.hypot(nx, ny, nz);
    }
    nx /= length;
    ny /= length;
    nz /= length;
    let nextPhi = Math.acos(Math.min(1, Math.max(-1, ny)));
    const nextTheta = Math.atan2(nx, nz);
    // Step off the face-on normal so nearer and farther points separate.
    const tilt = 0.38;
    nextPhi += nextPhi < Math.PI / 2 ? tilt : -tilt;
    return {
      theta: nextTheta + 0.42,
      phi: Math.min(Math.PI - 0.34, Math.max(0.34, nextPhi)),
    };
  }

  function aimAt(cx: number, cy: number, cz: number, distance: number): void {
    const sinPhi = Math.sin(phi);
    camera.position.set(
      cx + distance * sinPhi * Math.sin(theta),
      cy + distance * Math.cos(phi),
      cz + distance * sinPhi * Math.cos(theta),
    );
    camera.lookAt(cx, cy, cz);
    camera.updateMatrixWorld(true);
  }

  function placeLights(cx: number, cy: number, cz: number, span: number): void {
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    key.position.set(cx, cy, cz);
    key.position.addScaledVector(right, span * 2.5);
    key.position.addScaledVector(up, span * 3.2);
    key.position.addScaledVector(forward, span * 0.6);
    key.target.position.set(cx, cy, cz);
    fill.position.set(cx, cy, cz);
    fill.position.addScaledVector(right, span * -2.4);
    fill.position.addScaledVector(up, span * 0.2);
    fill.position.addScaledVector(forward, span * -1.5);
    fill.target.position.set(cx, cy, cz);
    key.target.updateMatrixWorld();
    fill.target.updateMatrixWorld();
  }

  function frameView(state: PathDrawState): void {
    const cloud = cloudOf(state);
    const { cx, cy, cz, span } = measure(cloud);
    if (!aimed) {
      const facing = facingAngles(state);
      theta = facing.theta;
      phi = facing.phi;
    }
    const aspect = cssWidth / Math.max(cssHeight, 1);
    camera.aspect = aspect;
    const distance = viewDistance(span, aspect);
    aimAt(cx, cy, cz, distance);
    camera.near = Math.max(distance * 0.04, 1e-4);
    camera.far = Math.max(distance * 14, span * 20);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const fogNear = Math.max(distance - span * 1.25, 1e-4);
    fog.near = fogNear;
    fog.far = Math.max(distance + span * 4.6, fogNear + span);

    grid.position.set(cx, cy - span * 1.15, cz);
    grid.scale.setScalar(span * 12);
    labelRadius = span * LATEST_SHARE;
    placeLights(cx, cy, cz, span);
  }

  function clearSparks(): void {
    for (const spark of sparks) {
      scene.remove(spark.mesh);
      disposeMaterial(spark.mesh.material);
    }
    sparks.length = 0;
  }

  function launchSparks(origin: Point3, span: number): void {
    clearSparks();
    sparkStart = performance.now();
    sparkSpan = span;
    const palette = [theme.ok, "#c6a15b", "#f4efe6", theme.ink];
    for (let i = 0; i < 28; i++) {
      const mesh = new Mesh(
        sphereGeometry,
        sphereMaterial(new Color(palette[i % palette.length] ?? theme.ok), 0.32, 0.08, 0.4),
      );
      mesh.scale.setScalar(span * (0.016 + (i % 5) * 0.007));
      mesh.position.set(origin[0], origin[1], origin[2]);
      const direction = new Vector3(
        Math.cos(i * 2.399) * (0.45 + (i % 4) * 0.16),
        0.45 + (i % 5) * 0.16,
        Math.sin(i * 2.399) * (0.45 + (i % 3) * 0.18),
      ).normalize();
      sparks.push({
        mesh,
        velocity: direction.multiplyScalar(span * (0.9 + (i % 6) * 0.22)),
        spin: (i % 2 === 0 ? 1 : -1) * (1.4 + (i % 4) * 0.4),
      });
      scene.add(mesh);
    }
  }

  function tickSparks(): void {
    if (sparks.length === 0) return;
    const age = (performance.now() - sparkStart) / 1000;
    if (age > 1.7) {
      clearSparks();
      if (winMesh) winMesh.scale.setScalar(winBase);
      return;
    }
    const step = 1 / 60;
    const fade = 1 - age / 1.7;
    for (const spark of sparks) {
      spark.velocity.y -= sparkSpan * 1.4 * step;
      spark.mesh.position.addScaledVector(spark.velocity, step);
      spark.mesh.rotateY(spark.spin * step);
      const material = spark.mesh.material;
      if (material instanceof MeshStandardMaterial) {
        material.transparent = true;
        material.opacity = Math.max(0, fade);
      }
    }
    if (winMesh) {
      const pulse = 1 + Math.sin(age * 14) * 0.18 * Math.max(0, 1 - age * 0.7);
      winMesh.scale.setScalar(winBase * pulse);
    }
  }

  function render(): void {
    if (disposed || !current) return;
    if (cssWidth < 2 || cssHeight < 2) return;
    frameView(current);
    tickSparks();
    renderer.render(scene, camera);
    drawLabels(current);
    if (sparks.length > 0) requestRender();
  }

  function requestRender(): void {
    if (disposed || frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  }

  function dropTube(): void {
    if (!tube) return;
    scene.remove(tube);
    tube.geometry.dispose();
    disposeMaterial(tube.material);
    tube = null;
  }

  function clearPoints(): void {
    for (const child of pointRoot.children) {
      if (child instanceof Mesh) disposeMaterial(child.material);
    }
    pointRoot.clear();
  }

  function addSphere(point: Point3, role: Role, span: number, arrived: boolean): void {
    const mesh = new Mesh(sphereGeometry, materialFor(role, arrived, theme));
    const scale = span * shareFor(role);
    mesh.scale.setScalar(scale);
    mesh.position.set(point[0], point[1], point[2]);
    if (role === "latest") {
      winMesh = mesh;
      winBase = scale;
    }
    pointRoot.add(mesh);
  }

  function syncPath(state: PathDrawState): void {
    clearPoints();
    dropTube();
    const { span } = measure(cloudOf(state));
    const tolerance = Math.max(span * 1e-6, 1e-8);
    const placed: Point3[] = [];
    const beads: { point: Point3; role: Role }[] = [];
    const claim = (point: Point3 | undefined, role: Role): void => {
      if (!point) return;
      if (placed.some((other) => samePoint(other, point, tolerance))) return;
      placed.push(point);
      beads.push({ point, role });
    };
    // Latest claims its point first. When arrived, that point is already the goal.
    claim(state.path[state.path.length - 1], "latest");
    claim(state.path[0] ?? state.start, "start");
    for (let i = 1; i < state.path.length - 1; i++) claim(state.path[i], "step");
    claim(state.goal, "goal");
    const rank: Record<Role, number> = { step: 0, start: 1, goal: 2, latest: 3 };
    beads.sort((a, b) => rank[a.role] - rank[b.role]);
    for (const bead of beads) addSphere(bead.point, bead.role, span, state.arrived);
    if (state.arrived && !celebrated) {
      const origin = state.path[state.path.length - 1] ?? state.goal;
      launchSparks(origin, span);
      celebrated = true;
    }
    if (!state.arrived) {
      celebrated = false;
      clearSparks();
    }

    const route: Vector3[] = [];
    for (const point of state.path) {
      const next = new Vector3(point[0], point[1], point[2]);
      const prev = route[route.length - 1];
      if (prev && prev.distanceToSquared(next) <= tolerance * tolerance) continue;
      route.push(next);
    }
    if (route.length < 2) return;
    const geometry = new TubeGeometry(
      new PolylineCurve(route),
      Math.max((route.length - 1) * 6, 8),
      span * TUBE_SHARE,
      8,
      false,
    );
    tube = new Mesh(
      geometry,
      new MeshStandardMaterial({
        color: lifted(theme.ink, 0.2),
        roughness: 0.72,
        metalness: 0.04,
      }),
    );
    scene.add(tube);
  }

  function onPointerDown(event: PointerEvent): void {
    if (activePointer !== null) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    activePointer = event.pointerId;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    gl.style.cursor = "grabbing";
    gl.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging || event.pointerId !== activePointer) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    if (dx === 0 && dy === 0) return;
    aimed = true;
    theta -= dx * 0.007;
    phi = Math.min(Math.PI - 0.2, Math.max(0.2, phi + dy * 0.007));
    requestRender();
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== activePointer) return;
    activePointer = null;
    dragging = false;
    gl.style.cursor = "grab";
  }

  gl.style.cursor = "grab";
  gl.addEventListener("pointerdown", onPointerDown);
  gl.addEventListener("pointermove", onPointerMove);
  gl.addEventListener("pointerup", onPointerUp);
  gl.addEventListener("pointercancel", onPointerUp);
  gl.addEventListener("lostpointercapture", onPointerUp);

  const observer = new ResizeObserver(() => {
    resize();
    requestRender();
  });
  observer.observe(stage);
  resize();

  return {
    update(state: PathDrawState) {
      if (disposed) return;
      current = state;
      syncPath(state);
      resize();
      requestRender();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      observer.disconnect();
      gl.removeEventListener("pointerdown", onPointerDown);
      gl.removeEventListener("pointermove", onPointerMove);
      gl.removeEventListener("pointerup", onPointerUp);
      gl.removeEventListener("pointercancel", onPointerUp);
      gl.removeEventListener("lostpointercapture", onPointerUp);
      clearSparks();
      clearPoints();
      dropTube();
      sphereGeometry.dispose();
      grid.geometry.dispose();
      disposeMaterial(grid.material);
      backdrop.dispose();
      renderer.dispose();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, labels.width, labels.height);
    },
  };
}
