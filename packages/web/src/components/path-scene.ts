import {
  ACESFilmicToneMapping,
  AmbientLight,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  Curve,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import type { PathDrawState } from "../lib/path.js";
import type { Point3 } from "../lib/project.js";
import { COSMETICS } from "../lib/rewards.js";
import type { SceneLook } from "../lib/rewards.js";
import { domeTexture, skinTexture, spriteTexture, tubeTexture } from "./look-textures.js";

export type PathScene = {
  update(state: PathDrawState): void;
  dispose(): void;
};

const SERIF_FALLBACK = "Georgia, serif";
const FOV = 40;

/** Panels carrying this attribute may float over the graph. The scene keeps the path clear of them. */
const OVERLAY_SELECTOR = "[data-stage-overlay]";

/** Share of the cloud radius. Latest stays the biggest bead. */
const LATEST_SHARE = 0.11;
const GOAL_SHARE = 0.078;
const START_SHARE = 0.064;
const STEP_SHARE = 0.042;
const TUBE_SHARE = 0.013;

type Role = "latest" | "goal" | "start" | "step";

const FALLBACK_LOOK: SceneLook = (COSMETICS[0] as { look: SceneLook }).look;

/** The display font comes from the page so labels match the rest of the game. */
function readFont(): string {
  const style = getComputedStyle(document.documentElement);
  return style.getPropertyValue("--display").trim() || SERIF_FALLBACK;
}

/** The flat sky behind everything: a gradient with a soft glow. Patterns live on the sky dome instead. */
function paintBackdrop(look: SceneLook): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const drawing = canvas.getContext("2d");
  if (!drawing) throw new Error("Could not paint the path background");
  const sky = drawing.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, look.sky[0]);
  sky.addColorStop(0.38, look.sky[1]);
  sky.addColorStop(0.7, look.sky[2]);
  sky.addColorStop(1, look.sky[3]);
  drawing.fillStyle = sky;
  drawing.fillRect(0, 0, canvas.width, canvas.height);
  look.ribbons.forEach((color, index) => {
    drawing.save();
    drawing.translate(128, 60 + index * 34);
    drawing.rotate(-0.35 + index * 0.3);
    drawing.scale(2.6, 0.32);
    const ribbon = drawing.createRadialGradient(0, 0, 0, 0, 0, 80);
    ribbon.addColorStop(0, color);
    ribbon.addColorStop(1, "rgba(0, 0, 0, 0)");
    drawing.fillStyle = ribbon;
    drawing.beginPath();
    drawing.arc(0, 0, 80, 0, Math.PI * 2);
    drawing.fill();
    drawing.restore();
  });
  const glow = drawing.createRadialGradient(
    canvas.width / 2,
    canvas.height * 0.42,
    canvas.width * 0.08,
    canvas.width / 2,
    canvas.height * 0.46,
    Math.max(canvas.width, canvas.height) * 0.69,
  );
  glow.addColorStop(0, look.glow);
  glow.addColorStop(1, "rgba(255, 255, 255, 0)");
  drawing.fillStyle = glow;
  drawing.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Small fixed star field, the same every time. Unit sphere; the scene scales it. */
function starField(): Points {
  const count = 240;
  const positions = new Float32Array(count * 3);
  let seed = 7;
  const next = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < count; i++) {
    const u = next() * 2 - 1;
    const angle = next() * Math.PI * 2;
    const ring = Math.sqrt(1 - u * u);
    positions[i * 3] = ring * Math.cos(angle);
    positions[i * 3 + 1] = Math.abs(u) * 0.9 + 0.1;
    positions[i * 3 + 2] = ring * Math.sin(angle);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: 0xffffff,
    size: 2.2,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -1;
  return points;
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

/** Closest the opening shot may come, as a fraction of the ordinary fit. */
const OPENING_ZOOM = 0.36;

function disposeMaterial(material: Mesh["material"]): void {
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else {
    material.dispose();
  }
}

function lifted(hex: string, amount: number): Color {
  return new Color(hex).lerp(new Color("#ffffff"), amount);
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

function materialFor(role: Role, arrived: boolean, look: SceneLook): MeshStandardMaterial {
  const boost = look.glowBoost;
  if (role === "latest" && arrived) return sphereMaterial(lifted(look.goal, 0.1), 0.3, 0.06, 0.2 * boost);
  if (role === "latest") return sphereMaterial(lifted(look.latest, 0.08), 0.3, 0.06, 0.14 * boost);
  if (role === "goal") return sphereMaterial(lifted(look.goal, 0.1), 0.34, 0.05, 0.16 * boost);
  if (role === "start") return sphereMaterial(lifted(look.start, 0.06), 0.4, 0.04, 0.1 * boost);
  return sphereMaterial(lifted(look.step, 0.04), 0.5, 0.03, 0.08 * boost);
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
  const font = readFont();
  let look: SceneLook = FALLBACK_LOOK;
  let lookId = "";
  const drawing = labels.getContext("2d");
  if (!drawing) throw new Error("Could not draw the path labels");
  const context: CanvasRenderingContext2D = drawing;

  const renderer = new WebGLRenderer({
    canvas: gl,
    antialias: true,
    alpha: false,
  });
  renderer.setClearColor(new Color(look.fog), 1);
  renderer.autoClear = false;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  // Two layers, drawn in turn: the sky (gradient, stars, dome pattern, drifting bits) first, then the
  // graph on top. That keeps every decoration behind the beads and the path.
  const backScene = new Scene();
  let backdrop = paintBackdrop(look);
  backScene.background = backdrop;
  const fog = new Fog(new Color(look.fog), 1, 20);
  scene.fog = fog;

  const camera = new PerspectiveCamera(FOV, 1, 0.01, 50);
  const ambient = new AmbientLight(0xf4f7fb, 0.34);
  const sky = new HemisphereLight(0xf7fbff, 0x8e877c, 0.72);
  const key = new DirectionalLight(0xfff4e6, 2.8);
  const fill = new DirectionalLight(0xc5d6ea, 0.7);
  scene.add(ambient, sky, key, key.target, fill, fill.target);

  let grid = new GridHelper(1, 24, new Color(look.gridMajor), new Color(look.gridMinor));
  grid.position.y = -1;
  scene.add(grid);

  const stars = starField();
  stars.visible = false;
  backScene.add(stars);

  // A ring that breathes around the goal, so the target is easy to find.
  const ringGeometry = new RingGeometry(0.92, 1, 48);
  const ringMaterial = new MeshBasicMaterial({
    color: new Color(look.ring),
    transparent: true,
    opacity: 0.6,
    side: DoubleSide,
    depthWrite: false,
    fog: false,
  });
  const goalRing = new Mesh(ringGeometry, ringMaterial);
  goalRing.visible = false;
  scene.add(goalRing);
  const reduceMotion =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  /** Pixels on the right edge covered by a floating panel. The path is framed in what is left. */
  let inset = 0;
  let labelRadius = 1e-4;
  let goalRadius = 1e-4;
  let framedPuzzle = "";
  let celebrated = false;
  let winMesh: Mesh | null = null;
  let winBase = 1;
  let sparkStart = 0;
  let sparkSpan = 1;
  const sparks: { mesh: Mesh; velocity: Vector3; spin: number }[] = [];

  // Fancy looks: bead skins, a patterned tube, drifting particles.
  const skins = new Map<string, CanvasTexture>();
  let tubeTex: CanvasTexture | null = null;
  const domeGeometry = new SphereGeometry(1, 48, 32);
  let dome: Mesh | null = null;
  let drift: {
    points: Points;
    sprite: CanvasTexture;
    x: Float32Array;
    y: Float32Array;
    z: Float32Array;
    phase: Float32Array;
    baseSize: number;
  } | null = null;
  const frameCenter = new Vector3();
  let frameDistance = 1;
  let lastTick = 0;

  function dropFxTextures(): void {
    for (const texture of skins.values()) texture.dispose();
    skins.clear();
    tubeTex?.dispose();
    tubeTex = null;
    if (dome) {
      backScene.remove(dome);
      const material = dome.material;
      if (material instanceof MeshBasicMaterial) material.map?.dispose();
      disposeMaterial(material);
      dome = null;
    }
    if (drift) {
      backScene.remove(drift.points);
      drift.points.geometry.dispose();
      disposeMaterial(drift.points.material);
      drift.sprite.dispose();
      drift = null;
    }
  }

  /** A sphere around the whole scene carrying the look's sky pattern. It stays put in the world. */
  function buildDome(next: SceneLook): void {
    const kind = next.fx?.backdrop;
    if (!kind) return;
    const texture = domeTexture(kind);
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: BackSide,
      fog: false,
      toneMapped: false,
    });
    dome = new Mesh(domeGeometry, material);
    dome.frustumCulled = false;
    dome.renderOrder = -2;
    backScene.add(dome);
  }

  function buildDrift(next: SceneLook): void {
    const spec = next.fx?.drift;
    if (!spec) return;
    const count = spec.count;
    const sprite = spriteTexture(spec.shape);
    const x = new Float32Array(count);
    const y = new Float32Array(count);
    const z = new Float32Array(count);
    const phase = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    let seed = 41;
    const random = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const tint = new Color();
    for (let i = 0; i < count; i++) {
      x[i] = random() * 2 - 1;
      y[i] = random() * 2 - 1;
      z[i] = random() * 2 - 1;
      phase[i] = random() * Math.PI * 2;
      tint.set(spec.colors[i % spec.colors.length] ?? "#ffffff");
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    const material = new PointsMaterial({
      map: sprite,
      size: spec.size,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      alphaTest: 0.02,
      fog: false,
      toneMapped: false,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = -1;
    drift = { points, sprite, x, y, z, phase, baseSize: spec.size };
    backScene.add(points);
    sizeDrift();
  }

  function sizeDrift(): void {
    if (!drift) return;
    const material = drift.points.material;
    if (material instanceof PointsMaterial) material.size = drift.baseSize * renderer.getPixelRatio();
  }

  function tickDrift(now: number, dt: number): void {
    const spec = look.fx?.drift;
    if (!drift || !spec) return;
    const position = drift.points.geometry.getAttribute("position");
    const t = now / 1000;
    const travel = reduceMotion ? 0 : spec.speed * dt * 2;
    for (let i = 0; i < spec.count; i++) {
      let y = drift.y[i] ?? 0;
      y += spec.rise ? travel : -travel;
      if (y > 1) y -= 2;
      else if (y < -1) y += 2;
      drift.y[i] = y;
      const sway = reduceMotion ? 0 : Math.sin(t * 0.7 + (drift.phase[i] ?? 0)) * 0.05;
      position.setXYZ(i, (drift.x[i] ?? 0) + sway, y, drift.z[i] ?? 0);
    }
    position.needsUpdate = true;
    drift.points.position.copy(frameCenter);
    drift.points.scale.setScalar(frameDistance * 0.7);
    // Sparkles twinkle by breathing the whole layer's opacity a little.
    const material = drift.points.material;
    if (material instanceof PointsMaterial && spec.shape === "star") {
      material.opacity = reduceMotion ? 0.9 : 0.72 + Math.sin(t * 2.2) * 0.2;
    }
  }

  /** A bead's material, with this look's skin wrapped on when it has one. */
  function beadMaterial(role: Role, arrived: boolean): MeshStandardMaterial {
    const material = materialFor(role, arrived, look);
    const kind = look.fx?.skin;
    if (!kind) return material;
    const hex = `#${material.color.getHexString()}`;
    const key = `${kind}:${hex}`;
    let texture = skins.get(key);
    if (!texture) {
      texture = skinTexture(kind, hex);
      skins.set(key, texture);
    }
    const glow = material.emissiveIntensity;
    material.map = texture;
    material.emissiveMap = texture;
    material.color.set(0xffffff);
    material.emissive.set(0xffffff);
    material.emissiveIntensity = Math.min(glow, 0.7);
    if (kind === "bubble") {
      material.roughness = 0.12;
    } else if (kind === "disco") {
      material.roughness = 0.22;
      material.metalness = 0.35;
    } else if (kind === "candy") {
      material.roughness = 0.2;
    }
    return material;
  }

  function makeGrid(next: SceneLook): GridHelper {
    const made = new GridHelper(1, 24, new Color(next.gridMajor), new Color(next.gridMinor));
    made.position.copy(grid.position);
    made.scale.copy(grid.scale);
    return made;
  }

  /** Repaint everything a cosmetic can change. Positions and sizes stay put. */
  function applyLook(next: SceneLook, id: string): void {
    if (id === lookId) return;
    lookId = id;
    look = next;
    renderer.setClearColor(new Color(look.fog), 1);
    renderer.toneMappingExposure = look.exposure;
    fog.color.set(look.fog);
    backdrop.dispose();
    backdrop = paintBackdrop(look);
    backScene.background = backdrop;
    scene.remove(grid);
    grid.geometry.dispose();
    disposeMaterial(grid.material);
    grid = makeGrid(look);
    scene.add(grid);
    stars.visible = look.stars;
    ringMaterial.color.set(look.ring);
    dropFxTextures();
    if (look.fx?.tube) tubeTex = tubeTexture(look.fx.tube, look.tube);
    buildDome(look);
    buildDrift(look);
  }

  /** How far a floating panel reaches in from the right edge of the graph, in pixels. */
  function measureInset(width: number): number {
    if (!stage) return 0;
    const panel = document.querySelector<HTMLElement>(OVERLAY_SELECTOR);
    if (!panel) return 0;
    const box = stage.getBoundingClientRect();
    const over = panel.getBoundingClientRect();
    const sharesRows = over.top < box.bottom - 4 && over.bottom > box.top + 4;
    const sharesColumns = over.left < box.right - 4 && over.right > box.left + 4;
    if (!sharesRows || !sharesColumns) return 0;
    const reach = box.right - over.left + 14;
    // Never give up more than half the graph, whatever the layout does.
    return Math.round(Math.min(Math.max(reach, 0), width * 0.5));
  }

  /** Width of the part of the graph that is not under a panel. */
  function visibleWidth(): number {
    return Math.max(cssWidth - inset, 1);
  }

  function setAspect(): void {
    camera.aspect = visibleWidth() / Math.max(cssHeight, 1);
    // The frame is built for the visible part. The canvas runs on past it, under the panel.
    if (inset > 0) camera.setViewOffset(visibleWidth(), cssHeight, 0, 0, cssWidth, cssHeight);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  function resize(): void {
    const width = stage?.clientWidth ?? 0;
    const height = stage?.clientHeight ?? 0;
    if (width < 2 || height < 2) return;
    cssWidth = width;
    cssHeight = height;
    inset = measureInset(width);
    const host = stage?.closest<HTMLElement>(".stage") ?? stage;
    host?.style.setProperty("--inset-right", `${inset}px`);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    labels.width = Math.round(width * ratio);
    labels.height = Math.round(height * ratio);
    setAspect();
    sizeDrift();
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
    const right = visibleWidth();
    if (align === "right") drawX = Math.max(measured + 4, Math.min(right - 4, x));
    else if (align === "left") drawX = Math.min(right - measured - 4, Math.max(4, x));
    else drawX = Math.min(right - measured / 2 - 4, Math.max(measured / 2 + 4, x));
    const drawY = Math.min(cssHeight - 4, Math.max(4, y));
    context.lineJoin = "round";
    context.lineWidth = 7;
    context.strokeStyle = look.halo;
    context.strokeText(text, drawX, drawY);
    context.fillStyle = color;
    context.fillText(text, drawX, drawY);
  }

  function fitSize(text: string, size: number, min: number, weight: number): number {
    let next = size;
    context.font = `${weight} ${next}px ${font}`;
    while (next > min && context.measureText(text).width > visibleWidth() * 0.56) {
      next -= 1;
      context.font = `${weight} ${next}px ${font}`;
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

  /**
   * Equation centered over the latest point.
   * Before any move there is no second line. After a move, the current word is drawn under the
   * equation as "= queen", slightly smaller, and centered on the same point.
   */
  function drawLatestLabels(state: PathDrawState): void {
    const text = (state.recentLabels[0] ?? "").trim();
    if (text.length === 0 || text === "…") return;
    const latest = state.path[state.path.length - 1] ?? state.start;
    const head = pointScreen(latest, labelRadius);
    if (!head.visible) return;
    const word = (state.recentLabels[1] ?? "").trim();
    const showWord = word.length > 0 && word !== "…";
    const second = showWord ? `= ${word}` : "";
    const size = fitSize(text, Math.min(36, visibleWidth() * 0.055), 14, 600);
    const color = state.arrived ? look.arrivedInk : look.ink;
    const subSize = showWord ? fitSize(second, Math.max(13, Math.round(size * 0.82)), 12, 500) : 0;
    const mainY = head.y - head.radius - 8 - (showWord ? subSize + 4 : 0);
    paintText(text, head.x, mainY, `600 ${size}px ${font}`, color, "bottom", "center");
    if (showWord) {
      paintText(
        second,
        head.x,
        head.y - head.radius - 6,
        `500 ${subSize}px ${font}`,
        look.inkSoft,
        "bottom",
        "center",
      );
    }
  }

  /** Goal word, bold, sitting just above the target. Skipped once the path has landed there. */
  function drawGoalLabel(state: PathDrawState): void {
    if (state.arrived) return;
    const text = state.goalWord.trim();
    if (text.length === 0) return;
    const goal = pointScreen(state.goal, goalRadius);
    if (!goal.visible) return;
    const latest = state.path[state.path.length - 1] ?? state.start;
    const head = pointScreen(latest, labelRadius);
    const dx = goal.x - head.x;
    const dy = goal.y - head.y;
    if (head.visible && Math.hypot(dx, dy) < head.radius + goal.radius + 24) return;
    const size = fitSize(text, Math.min(22, visibleWidth() * 0.04), 13, 600);
    paintText(text, goal.x, goal.y - goal.radius - 8, `600 ${size}px ${font}`, look.arrivedInk, "bottom", "center");
  }

  /** Start word, small, under the first bead. The latest point labels itself, so skip when they meet. */
  function drawStartLabel(state: PathDrawState): void {
    if (state.atStart) return;
    const text = state.startWord.trim();
    if (text.length === 0) return;
    const first = state.path[0] ?? state.start;
    const spot = pointScreen(first, labelRadius * 0.6);
    if (!spot.visible) return;
    const latest = state.path[state.path.length - 1] ?? state.start;
    const head = pointScreen(latest, labelRadius);
    if (head.visible && Math.hypot(spot.x - head.x, spot.y - head.y) < head.radius + spot.radius + 20) return;
    const size = fitSize(text, Math.min(18, visibleWidth() * 0.032), 12, 500);
    paintText(text, spot.x, spot.y + spot.radius + 6, `500 ${size}px ${font}`, look.inkSoft, "top", "center");
  }

  function drawLabels(state: PathDrawState): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    drawStartLabel(state);
    drawGoalLabel(state);
    drawLatestLabels(state);
  }

  function facingAngles(state: PathDrawState, open: boolean): { theta: number; phi: number } {
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
    // A small step off the face-on normal keeps nearer and farther points apart.
    // The opening shot stays closer to that normal so the two endpoints read as opposite sides.
    const tilt = open ? 0.16 : 0.38;
    const yaw = open ? 0.12 : 0.42;
    nextPhi += nextPhi < Math.PI / 2 ? tilt : -tilt;
    return {
      theta: nextTheta + yaw,
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

  function projected(point: Point3): { x: number; y: number; z: number } {
    scratch.set(point[0], point[1], point[2]);
    scratch.project(camera);
    return { x: scratch.x * 0.5 + 0.5, y: -scratch.y * 0.5 + 0.5, z: scratch.z };
  }

  /** True when both endpoints stay inside the label padding at this camera distance. */
  function endpointsFit(distance: number, cx: number, cy: number, cz: number, start: Point3, goal: Point3): boolean {
    aimAt(cx, cy, cz, distance);
    camera.near = Math.max(distance * 0.04, 1e-4);
    camera.far = Math.max(distance * 14, 1);
    camera.updateProjectionMatrix();
    for (const point of [start, goal]) {
      const placed = projected(point);
      if (!Number.isFinite(placed.x) || !Number.isFinite(placed.y) || !Number.isFinite(placed.z)) return false;
      if (placed.z <= -1 || placed.z >= 1) return false;
      // x is a share of the whole canvas. Judge it against the visible part only.
      const across = (placed.x * cssWidth) / visibleWidth();
      if (across < 0.13 || across > 0.87) return false;
      if (placed.y < 0.2 || placed.y > 0.84) return false;
    }
    return true;
  }

  /**
   * Opening shot only. Pull the camera in until the start and goal sit toward
   * opposite sides, stopping early so their labels still fit.
   */
  function openingDistance(
    cx: number,
    cy: number,
    cz: number,
    start: Point3,
    goal: Point3,
    fallback: number,
  ): number {
    const floor = Math.max(fallback * OPENING_ZOOM, 1e-3);
    if (!endpointsFit(fallback, cx, cy, cz, start, goal)) return fallback;
    let lo = floor;
    let hi = fallback;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (endpointsFit(mid, cx, cy, cz, start, goal)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  function frameView(state: PathDrawState): void {
    const puzzleKey = `${state.startWord}\0${state.goalWord}`;
    if (puzzleKey !== framedPuzzle) {
      framedPuzzle = puzzleKey;
      aimed = false;
    }
    const cloud = cloudOf(state);
    const { cx, cy, cz, span } = measure(cloud);
    if (!aimed) {
      const facing = facingAngles(state, state.atStart);
      theta = facing.theta;
      phi = facing.phi;
    }
    const aspect = visibleWidth() / Math.max(cssHeight, 1);
    setAspect();
    let distance = viewDistance(span, aspect);
    // Opening shot only: start and goal sit toward opposite sides. Later moves
    // use the ordinary fit. Dragging changes the angle and leaves this distance.
    if (state.atStart) distance = openingDistance(cx, cy, cz, state.start, state.goal, distance);
    aimAt(cx, cy, cz, distance);
    camera.near = Math.max(distance * 0.04, 1e-4);
    camera.far = Math.max(distance * 14, span * 20);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const fogNear = Math.max(distance - span * 1.25, 1e-4);
    fog.near = fogNear;
    fog.far = Math.max(distance + span * 4.6, fogNear + span);

    frameCenter.set(cx, cy, cz);
    frameDistance = distance;
    grid.position.set(cx, cy - span * 1.15, cz);
    grid.scale.setScalar(span * 12);
    labelRadius = span * LATEST_SHARE;
    goalRadius = span * GOAL_SHARE;
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
    const palette = look.sparks;
    for (let i = 0; i < 28; i++) {
      const mesh = new Mesh(
        sphereGeometry,
        sphereMaterial(new Color(palette[i % palette.length] ?? look.goal), 0.32, 0.08, 0.5),
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

  /** Breathing ring on the goal and a slow drift of the stars. Skipped when motion is reduced. */
  function tickAmbient(state: PathDrawState, now: number): void {
    const showRing = !state.arrived;
    goalRing.visible = showRing;
    if (showRing) {
      const beat = reduceMotion ? 0.5 : (now % 1800) / 1800;
      const radius = goalRadius * (1.35 + beat * 0.9);
      goalRing.position.set(state.goal[0], state.goal[1], state.goal[2]);
      goalRing.scale.setScalar(radius);
      goalRing.quaternion.copy(camera.quaternion);
      ringMaterial.opacity = reduceMotion ? 0.5 : 0.7 * (1 - beat);
    }
    if (stars.visible) {
      stars.position.copy(camera.position);
      stars.scale.setScalar(camera.far * 0.45);
    }
    if (dome) {
      dome.position.copy(camera.position);
      dome.scale.setScalar(camera.far * 0.45);
    }
    const dt = lastTick === 0 ? 0 : Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    tickDrift(now, dt);
    if (tubeTex && !reduceMotion) tubeTex.offset.x = -((now / 1000) * 0.35) % 1;
    if (look.fx?.rainbow && showRing && !reduceMotion) ringMaterial.color.setHSL((now / 3500) % 1, 1, 0.6);
  }

  function render(): void {
    if (disposed || !current) return;
    if (cssWidth < 2 || cssHeight < 2) return;
    frameView(current);
    tickSparks();
    tickAmbient(current, performance.now());
    renderer.clear();
    renderer.render(backScene, camera);
    renderer.render(scene, camera);
    drawLabels(current);
    // The ring breathes, so keep drawing while the tab is showing and motion is allowed.
    // Fancy looks keep drifting and flowing even after the path has landed.
    const alive = !reduceMotion && !document.hidden && (!current.arrived || look.fx != null);
    if (sparks.length > 0 || alive) requestRender();
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
    const mesh = new Mesh(sphereGeometry, beadMaterial(role, arrived));
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
    const material = new MeshStandardMaterial({
      color: new Color(look.tube),
      emissive: new Color(look.tube),
      emissiveIntensity: 0.12 * look.glowBoost,
      roughness: 0.5,
      metalness: 0.05,
    });
    if (tubeTex) {
      let length = 0;
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1];
        const b = route[i];
        if (a && b) length += a.distanceTo(b);
      }
      // About one tile per six tube widths keeps the pattern readable at any zoom.
      tubeTex.repeat.set(Math.max(1, length / (span * TUBE_SHARE * 8)), 1);
      material.color.set(0xffffff);
      material.emissive.set(0xffffff);
      material.emissiveIntensity = 0.4;
      material.map = tubeTex;
      material.emissiveMap = tubeTex;
    }
    tube = new Mesh(geometry, material);
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

  function onVisibility(): void {
    if (!document.hidden) requestRender();
  }

  gl.style.cursor = "grab";
  document.addEventListener("visibilitychange", onVisibility);
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
      applyLook(state.look, state.lookId);
      syncPath(state);
      resize();
      requestRender();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      observer.disconnect();
      (stage.closest<HTMLElement>(".stage") ?? stage).style.removeProperty("--inset-right");
      document.removeEventListener("visibilitychange", onVisibility);
      gl.removeEventListener("pointerdown", onPointerDown);
      gl.removeEventListener("pointermove", onPointerMove);
      gl.removeEventListener("pointerup", onPointerUp);
      gl.removeEventListener("pointercancel", onPointerUp);
      gl.removeEventListener("lostpointercapture", onPointerUp);
      clearSparks();
      clearPoints();
      dropTube();
      sphereGeometry.dispose();
      domeGeometry.dispose();
      grid.geometry.dispose();
      disposeMaterial(grid.material);
      stars.geometry.dispose();
      disposeMaterial(stars.material);
      ringGeometry.dispose();
      ringMaterial.dispose();
      backdrop.dispose();
      dropFxTextures();
      renderer.dispose();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, labels.width, labels.height);
    },
  };
}
