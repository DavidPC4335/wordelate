import { CanvasTexture, Color, RepeatWrapping, SRGBColorSpace } from "three";
import type { LookFx } from "../lib/rewards.js";

/**
 * Canvas-painted textures for the fancy graph looks. Nothing here loads an image:
 * every pattern is drawn in code, so a look costs no extra download.
 */

type Backdrop = NonNullable<LookFx["backdrop"]>;
type Skin = NonNullable<LookFx["skin"]>;
type TubeStyle = NonNullable<LookFx["tube"]>;
type Shape = NonNullable<LookFx["drift"]>["shape"];

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not paint a texture");
  return { canvas, ctx };
}

/** Small seeded random numbers so a texture looks the same every time it is painted. */
function rng(seed: number): () => number {
  let value = Math.max(1, Math.floor(Math.abs(seed))) % 2147483647;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function seedOf(text: string): number {
  let seed = 17;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) % 2147483647;
  return seed;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The same color nudged lighter or darker, as a CSS string. */
function shade(hex: string, lightness: number, saturation = 0, hue = 0): string {
  const hsl = { h: 0, s: 0, l: 0 };
  new Color(hex).getHSL(hsl, SRGBColorSpace);
  const h = (hsl.h + hue + 1) % 1;
  return `hsl(${Math.round(h * 360)} ${Math.round(clamp01(hsl.s + saturation) * 100)}% ${Math.round(clamp01(hsl.l + lightness) * 100)}%)`;
}

function toTexture(canvas: HTMLCanvasElement, repeat: boolean): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  if (repeat) {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
  }
  return texture;
}

/** Size of the sky-dome texture. Twice as wide as tall, like a world map. */
export const DOME_WIDTH = 3072;
export const DOME_HEIGHT = 1536;

/** Pixel sizes below were chosen for a 2048-wide map. This scales them to the real one. */
const K = DOME_WIDTH / 2048;

const TAU = Math.PI * 2;

/**
 * Draw one shape at a spot on the sky, `rho` radians across, stretched so it stays round once the
 * flat picture is wrapped around the sphere. It is drawn again across the seam when it touches one.
 */
function stamp(
  ctx: CanvasRenderingContext2D,
  lon: number,
  lat: number,
  rho: number,
  draw: (radius: number) => void,
): void {
  const y = (0.5 - lat / Math.PI) * DOME_HEIGHT;
  const radius = (rho * DOME_HEIGHT) / Math.PI;
  const squash = Math.max(Math.cos(lat), 0.12);
  const x = (((lon % TAU) + TAU) % TAU) / TAU * DOME_WIDTH;
  const reach = radius / squash;
  for (const shift of [0, -DOME_WIDTH, DOME_WIDTH]) {
    const at = x + shift;
    if (at + reach < 0 || at - reach > DOME_WIDTH) continue;
    ctx.save();
    ctx.translate(at, y);
    ctx.scale(1 / squash, 1);
    draw(radius);
    ctx.restore();
  }
}

function disc(ctx: CanvasRenderingContext2D, radius: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();
}

function soft(ctx: CanvasRenderingContext2D, radius: number, color: string): void {
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  glow.addColorStop(0, `${color} 1)`);
  glow.addColorStop(1, `${color} 0)`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();
}

/** A random spot spread evenly over the whole sphere. */
function anywhere(rand: () => number): { lon: number; lat: number } {
  return { lon: rand() * TAU, lat: Math.asin(rand() * 2 - 1) };
}

/** Beams that fan out from straight overhead, drawn as strips that run top to bottom. */
function beamsFromAbove(
  ctx: CanvasRenderingContext2D,
  lon: number,
  halfWidth: number,
  reach: number,
  rgb: string,
  alpha: number,
): void {
  const x = (lon / TAU) * DOME_WIDTH;
  const bottom = reach * DOME_HEIGHT;
  const beam = ctx.createLinearGradient(0, 0, 0, bottom);
  beam.addColorStop(0, `rgba(${rgb}, ${alpha})`);
  beam.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = beam;
  for (const shift of [0, -DOME_WIDTH, DOME_WIDTH]) {
    ctx.fillRect(x + shift - halfWidth, 0, halfWidth * 2, bottom);
  }
}

/**
 * Paint a look's sky pattern onto a transparent sphere map. The scene wraps it around everything,
 * so it stays put in the world and turns as you drag, instead of sticking to the screen.
 */
export function paintDome(ctx: CanvasRenderingContext2D, kind: Backdrop): void {
  const rand = rng(11);
  ctx.clearRect(0, 0, DOME_WIDTH, DOME_HEIGHT);
  if (kind === "candy") {
    // Pastel bands circling the sky, then a lattice of polka dots over them.
    const band = (10 / 180) * DOME_HEIGHT;
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    for (let y = 0; y < DOME_HEIGHT; y += band * 2) ctx.fillRect(0, y, DOME_WIDTH, band);
    const step = (9 * Math.PI) / 180;
    let row = 0;
    for (let lat = -81; lat <= 81; lat += 9, row++) {
      const phi = (lat * Math.PI) / 180;
      const count = Math.max(1, Math.round((TAU * Math.cos(phi)) / step));
      for (let i = 0; i < count; i++) {
        const lon = ((i + (row % 2) * 0.5) / count) * TAU;
        const loud = (i + row) % 3 === 0;
        stamp(ctx, lon, phi, loud ? 0.028 : 0.02, (radius) =>
          disc(ctx, radius, loud ? "rgba(255, 255, 255, 0.7)" : "rgba(255, 130, 195, 0.3)"),
        );
      }
    }
    return;
  }
  if (kind === "deep") {
    // Sunlight falling from the surface, a bright surface glow, and dark water below.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 30; i++) {
      beamsFromAbove(ctx, rand() * TAU, (16 + rand() * 52) * K, 1.05, "150, 235, 255", 0.3 + rand() * 0.14);
    }
    ctx.restore();
    const surface = ctx.createLinearGradient(0, 0, 0, DOME_HEIGHT * 0.32);
    surface.addColorStop(0, "rgba(210, 252, 255, 0.5)");
    surface.addColorStop(1, "rgba(210, 252, 255, 0)");
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, DOME_WIDTH, DOME_HEIGHT * 0.32);
    ctx.strokeStyle = "rgba(190, 250, 255, 0.22)";
    ctx.lineWidth = 3 * K;
    for (let i = 0; i < 90; i++) {
      const { lon, lat } = anywhere(rand);
      stamp(ctx, lon, lat * 0.8, 0.07, (radius) => {
        ctx.beginPath();
        for (let t = 0; t <= 1.001; t += 0.1) {
          const px = (t - 0.5) * radius * 2;
          const py = Math.sin(t * TAU + i) * radius * 0.18;
          if (t === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      });
    }
    const depth = ctx.createLinearGradient(0, DOME_HEIGHT * 0.5, 0, DOME_HEIGHT);
    depth.addColorStop(0, "rgba(0, 10, 30, 0)");
    depth.addColorStop(1, "rgba(0, 10, 30, 0.5)");
    ctx.fillStyle = depth;
    ctx.fillRect(0, DOME_HEIGHT * 0.5, DOME_WIDTH, DOME_HEIGHT * 0.5);
    return;
  }
  if (kind === "galaxy") {
    const clouds = ["rgba(150, 80, 255,", "rgba(255, 80, 200,", "rgba(70, 140, 255,", "rgba(60, 220, 220,"];
    for (let i = 0; i < 26; i++) {
      const { lon, lat } = anywhere(rand);
      const color = clouds[i % clouds.length] ?? clouds[0] ?? "";
      stamp(ctx, lon, lat, 0.3 + rand() * 0.5, (radius) => {
        ctx.globalAlpha = 0.34;
        soft(ctx, radius, color);
        ctx.globalAlpha = 1;
      });
    }
    // The Milky Way: a bright tilted ring of haze right around the sky.
    const tilt = 0.9;
    for (let i = 0; i < 160; i++) {
      const lon = (i / 160) * TAU;
      const lat = Math.asin(Math.sin(tilt) * Math.sin(lon)) + (rand() - 0.5) * 0.12;
      stamp(ctx, lon + 0.4, lat, 0.12 + rand() * 0.1, (radius) => {
        ctx.globalAlpha = 0.16;
        soft(ctx, radius, "rgba(255, 235, 255,");
        ctx.globalAlpha = 1;
      });
    }
    for (let i = 0; i < 900; i++) {
      const { lon, lat } = anywhere(rand);
      const size = 0.002 + rand() * 0.0045;
      const alpha = 0.35 + rand() * 0.65;
      stamp(ctx, lon, lat, size, (radius) => disc(ctx, radius, `rgba(255, 255, 255, ${alpha})`));
    }
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 2.4 * K;
    for (let i = 0; i < 34; i++) {
      const { lon, lat } = anywhere(rand);
      stamp(ctx, lon, lat, 0.014 + rand() * 0.01, (radius) => {
        ctx.beginPath();
        ctx.moveTo(-radius, 0);
        ctx.lineTo(radius, 0);
        ctx.moveTo(0, -radius);
        ctx.lineTo(0, radius);
        ctx.stroke();
      });
    }
    return;
  }
  if (kind === "winter") {
    // Night stars, a big moon, a ring of snowy fir trees on the horizon, and snow underfoot.
    for (let i = 0; i < 520; i++) {
      const { lon, lat } = anywhere(rand);
      if (lat < 0.05) continue;
      const alpha = 0.4 + rand() * 0.6;
      stamp(ctx, lon, lat, 0.003 + rand() * 0.005, (radius) => disc(ctx, radius, `rgba(255, 255, 255, ${alpha})`));
    }
    stamp(ctx, 0.9, 0.62, 0.34, (radius) => {
      ctx.globalAlpha = 0.5;
      soft(ctx, radius, "rgba(255, 244, 200,");
      ctx.globalAlpha = 1;
    });
    stamp(ctx, 0.9, 0.62, 0.075, (radius) => {
      disc(ctx, radius, "#fff6d8");
      disc(ctx, radius * 0.18, "rgba(222, 205, 160, 0.55)");
    });
    const ground = ctx.createLinearGradient(0, DOME_HEIGHT * 0.5, 0, DOME_HEIGHT);
    ground.addColorStop(0, "rgba(236, 246, 255, 0.78)");
    ground.addColorStop(0.35, "rgba(190, 220, 245, 0.4)");
    ground.addColorStop(1, "rgba(150, 190, 230, 0.16)");
    ctx.fillStyle = ground;
    ctx.fillRect(0, DOME_HEIGHT * 0.5, DOME_WIDTH, DOME_HEIGHT * 0.5);
    for (let layer = 0; layer < 2; layer++) {
      const base = DOME_HEIGHT * 0.5 + layer * 5 * K;
      const trees = layer === 0 ? 110 : 72;
      ctx.fillStyle = layer === 0 ? "rgba(6, 22, 40, 0.96)" : "rgba(10, 34, 52, 0.96)";
      for (let i = 0; i < trees; i++) {
        const x = ((i + rand() * 0.8) / trees) * DOME_WIDTH;
        const height = ((layer === 0 ? 34 : 56) + rand() * 40) * K;
        const half = height * 0.26;
        ctx.beginPath();
        ctx.moveTo(x - half, base);
        ctx.lineTo(x - half * 0.55, base - height * 0.42);
        ctx.lineTo(x - half * 0.8, base - height * 0.42);
        ctx.lineTo(x - half * 0.35, base - height * 0.74);
        ctx.lineTo(x - half * 0.55, base - height * 0.74);
        ctx.lineTo(x, base - height);
        ctx.lineTo(x + half * 0.55, base - height * 0.74);
        ctx.lineTo(x + half * 0.35, base - height * 0.74);
        ctx.lineTo(x + half * 0.8, base - height * 0.42);
        ctx.lineTo(x + half * 0.55, base - height * 0.42);
        ctx.lineTo(x + half, base);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(240, 248, 255, 0.85)";
        ctx.beginPath();
        ctx.moveTo(x - half * 0.3, base - height * 0.8);
        ctx.lineTo(x, base - height);
        ctx.lineTo(x + half * 0.3, base - height * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = layer === 0 ? "rgba(6, 22, 40, 0.96)" : "rgba(10, 34, 52, 0.96)";
      }
    }
    return;
  }
  // prism: a ring of rainbow beams fanning down from a light straight overhead
  const beams = 28;
  for (let i = 0; i < beams; i++) {
    // Neighboring beams get very different colors, so any slice of sky has a mix.
    const hue = Math.round((i * 137.5) % 360);
    const lon = ((i + 0.5) / beams) * TAU;
    const x = (lon / TAU) * DOME_WIDTH;
    const reach = DOME_HEIGHT * 1.0;
    const beam = ctx.createLinearGradient(0, 0, 0, reach);
    beam.addColorStop(0, `hsla(${hue}, 100%, 62%, 0.9)`);
    beam.addColorStop(0.7, `hsla(${hue}, 100%, 62%, 0.4)`);
    beam.addColorStop(1, `hsla(${hue}, 100%, 62%, 0)`);
    ctx.fillStyle = beam;
    // Layer a few narrower strips on a wide one so the edges fade out softly.
    ctx.globalAlpha = 0.3;
    for (const widen of [1, 0.72, 0.46, 0.22]) {
      const half = (DOME_WIDTH / beams) * 0.3 * widen;
      for (const shift of [0, -DOME_WIDTH, DOME_WIDTH]) {
        ctx.fillRect(x + shift - half, 0, half * 2, reach);
      }
    }
    ctx.globalAlpha = 1;
  }
  const top = ctx.createLinearGradient(0, 0, 0, DOME_HEIGHT * 0.25);
  top.addColorStop(0, "rgba(255, 255, 255, 0.6)");
  top.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, DOME_WIDTH, DOME_HEIGHT * 0.25);
  for (let i = 0; i < 160; i++) {
    const { lon, lat } = anywhere(rand);
    const alpha = 0.25 + rand() * 0.6;
    stamp(ctx, lon, lat, 0.004 + rand() * 0.007, (radius) => disc(ctx, radius, `rgba(255, 255, 255, ${alpha})`));
  }
}

/** The sky dome's texture, ready for the scene. */
export function domeTexture(kind: Backdrop): CanvasTexture {
  const { canvas, ctx } = makeCanvas(DOME_WIDTH, DOME_HEIGHT);
  paintDome(ctx, kind);
  return toTexture(canvas, false);
}

/** Wrapped around a bead. The texture carries the color, so it is painted per bead color. */
export function skinTexture(kind: Skin, hex: string): CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 128);
  const rand = rng(seedOf(`${kind}${hex}`));
  if (kind === "candy") {
    ctx.fillStyle = shade(hex, 0.02);
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
    for (let k = -3; k <= 8; k++) {
      const x = k * 32;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 14, 0);
      ctx.lineTo(x + 14 + 64, 128);
      ctx.lineTo(x + 64, 128);
      ctx.closePath();
      ctx.fill();
    }
  } else if (kind === "bubble") {
    const body = ctx.createLinearGradient(0, 0, 0, 128);
    body.addColorStop(0, shade(hex, 0.2));
    body.addColorStop(0.5, shade(hex, 0));
    body.addColorStop(1, shade(hex, -0.14));
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 26; i++) {
      const x = rand() * 256;
      const y = rand() * 128;
      const radius = 3 + rand() * 7;
      ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      ctx.beginPath();
      ctx.arc(x - radius * 0.35, y - radius * 0.35, radius * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "planet") {
    let y = 0;
    while (y < 128) {
      const band = 7 + rand() * 17;
      ctx.fillStyle = shade(hex, (rand() - 0.5) * 0.36, (rand() - 0.5) * 0.2, (rand() - 0.5) * 0.06);
      ctx.fillRect(0, y, 256, band + 1);
      y += band;
    }
    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      for (let x = 0; x <= 256; x += 8) {
        const wave = 128 / 7 + (i * 128) / 7;
        const py = wave + Math.sin((x / 256) * Math.PI * 4 + i) * 3;
        if (x === 0) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.stroke();
    }
    ctx.fillStyle = shade(hex, 0.22);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(40 + rand() * 170, 52 + rand() * 24, 24, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (kind === "bauble") {
    const body = ctx.createLinearGradient(0, 0, 0, 128);
    body.addColorStop(0, shade(hex, 0.08));
    body.addColorStop(1, shade(hex, -0.1));
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, 256, 128);
    // Gold diamonds wrapped around the ornament, with a gold cap at each end.
    ctx.strokeStyle = "rgba(255, 224, 130, 0.7)";
    ctx.lineWidth = 3;
    for (let k = -4; k <= 12; k++) {
      ctx.beginPath();
      ctx.moveTo(k * 32, 0);
      ctx.lineTo(k * 32 + 64, 128);
      ctx.moveTo(k * 32 + 64, 0);
      ctx.lineTo(k * 32, 128);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255, 244, 200, 0.9)";
    for (let k = 0; k < 8; k++) {
      ctx.beginPath();
      ctx.arc(k * 32 + 16, 64, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#f2c84b";
    ctx.fillRect(0, 0, 256, 12);
    ctx.fillRect(0, 116, 256, 12);
  } else {
    const hsl = { h: 0, s: 0, l: 0 };
    new Color(hex).getHSL(hsl, SRGBColorSpace);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 16; col++) {
        const light = 0.32 + rand() * 0.55;
        ctx.fillStyle = `hsl(${Math.round(hsl.h * 360)} ${Math.round(hsl.s * 38)}% ${Math.round(light * 100)}%)`;
        ctx.fillRect(col * 16, row * 16, 16, 16);
        if (rand() > 0.9) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
          ctx.fillRect(col * 16, row * 16, 16, 16);
        }
      }
    }
    ctx.strokeStyle = "rgba(10, 0, 25, 0.5)";
    ctx.lineWidth = 1.2;
    for (let i = 0; i <= 16; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 16, 0);
      ctx.lineTo(i * 16, 128);
      ctx.stroke();
    }
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * 16);
      ctx.lineTo(256, i * 16);
      ctx.stroke();
    }
  }
  return toTexture(canvas, false);
}

/** Pattern along the path tube. Repeats along its length. */
export function tubeTexture(kind: TubeStyle, hex: string): CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 64);
  if (kind === "stripes") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = shade(hex, 0);
    for (let k = -2; k <= 4; k++) {
      const x = k * 64;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 32, 0);
      ctx.lineTo(x + 64, 64);
      ctx.lineTo(x + 32, 64);
      ctx.closePath();
      ctx.fill();
    }
  } else if (kind === "waves") {
    ctx.fillStyle = shade(hex, -0.12);
    ctx.fillRect(0, 0, 128, 64);
    ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = i === 1 ? "rgba(255, 255, 255, 0.85)" : "rgba(220, 252, 255, 0.5)";
      ctx.lineWidth = 7;
      ctx.beginPath();
      for (let x = 0; x <= 128; x += 4) {
        const y = 14 + i * 18 + Math.sin((x / 128) * Math.PI * 2 + i * 1.3) * 7;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (kind === "dashes") {
    ctx.fillStyle = shade(hex, -0.28);
    ctx.fillRect(0, 0, 128, 64);
    const trail = ctx.createLinearGradient(0, 0, 76, 0);
    trail.addColorStop(0, "rgba(255, 255, 255, 0)");
    trail.addColorStop(0.85, "rgba(255, 240, 255, 0.95)");
    trail.addColorStop(1, "rgba(255, 255, 255, 1)");
    ctx.fillStyle = trail;
    ctx.fillRect(0, 0, 76, 64);
  } else if (kind === "garland") {
    ctx.fillStyle = shade(hex, -0.12);
    ctx.fillRect(0, 0, 128, 64);
    const rand = rng(23);
    ctx.lineCap = "round";
    for (let i = 0; i < 46; i++) {
      ctx.strokeStyle = rand() > 0.5 ? shade(hex, 0.14) : shade(hex, -0.2);
      ctx.lineWidth = 2.2;
      const x = rand() * 128;
      const y = rand() * 64;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 9, y + (rand() > 0.5 ? 9 : -9));
      ctx.stroke();
    }
    // A red berry and a gold light in every tile.
    for (const [x, fill] of [[32, "#e8344a"], [96, "#ffd24a"]] as const) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x, 32, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.beginPath();
      ctx.arc(x - 3, 28, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const flow = ctx.createLinearGradient(0, 0, 128, 0);
    for (let i = 0; i <= 6; i++) flow.addColorStop(i / 6, `hsl(${(i % 6) * 60} 100% 60%)`);
    ctx.fillStyle = flow;
    ctx.fillRect(0, 0, 128, 64);
    const sheen = ctx.createLinearGradient(0, 0, 0, 64);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.45)");
    sheen.addColorStop(0.5, "rgba(255, 255, 255, 0)");
    sheen.addColorStop(1, "rgba(0, 0, 0, 0.18)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, 128, 64);
  }
  return toTexture(canvas, true);
}

/** A white sprite for drifting particles. The scene tints it with per-particle colors. */
export function spriteTexture(shape: Shape): CanvasTexture {
  const { canvas, ctx } = makeCanvas(64, 64);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  if (shape === "dot") {
    const soft = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    soft.addColorStop(0, "rgba(255, 255, 255, 1)");
    soft.addColorStop(0.55, "rgba(255, 255, 255, 0.9)");
    soft.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = soft;
    ctx.fillRect(0, 0, 64, 64);
  } else if (shape === "bubble") {
    ctx.lineWidth = 4;
    ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
    ctx.beginPath();
    ctx.arc(32, 32, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.beginPath();
    ctx.ellipse(23, 22, 6, 3.4, -0.7, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape === "flake") {
    ctx.lineCap = "round";
    ctx.lineWidth = 4;
    for (let arm = 0; arm < 6; arm++) {
      ctx.save();
      ctx.translate(32, 32);
      ctx.rotate((arm * Math.PI) / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -28);
      ctx.moveTo(0, -17);
      ctx.lineTo(-7, -24);
      ctx.moveTo(0, -17);
      ctx.lineTo(7, -24);
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(32, 32, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape === "star") {
    const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
    glow.addColorStop(0, "rgba(255, 255, 255, 0.55)");
    glow.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4 - Math.PI / 2;
      const radius = i % 2 === 0 ? 30 : 5;
      const x = 32 + Math.cos(angle) * radius;
      const y = 32 + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.save();
    ctx.translate(32, 32);
    ctx.rotate(-0.6);
    ctx.beginPath();
    ctx.roundRect(-26, -9, 52, 18, 9);
    ctx.fill();
    ctx.restore();
  }
  return toTexture(canvas, false);
}
