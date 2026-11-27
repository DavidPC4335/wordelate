/** Draws a top-player card as a PNG, for the admin top players page. Browser only. */
import type { TopPlayer, TopPlayersView } from "./admin.js";
import { shortDay } from "./admin-format.js";
import { dayParts } from "./standings.js";

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

const INK = "#221d44";
const INK_SOFT = "#625d8a";
const LINE = "#e2dcf6";
const PRIMARY = "#6d4df2";
const PRIMARY_DEEP = "#4a30c2";
const PRIMARY_TINT = "#ece8ff";
const ADD = "#16b377";
const ADD_DEEP = "#0c8a5a";
const ADD_TINT = "#dcf7ec";
const SUB = "#ff5577";
const SUB_DEEP = "#d1304f";
const GOLD_DEEP = "#d99100";
const GOLD_TINT = "#fff1c7";
const DISPLAY = `"Fredoka", ui-rounded, "Nunito", system-ui, sans-serif`;
const BODY = `"Nunito", "Segoe UI", system-ui, sans-serif`;

const MEDALS: Record<number, { fill: string; deep: string; text: string }> = {
  1: { fill: "#ffc233", deep: "#d99100", text: "#5a3d00" },
  2: { fill: "#d5dae6", deep: "#8a93a8", text: "#3a4155" },
  3: { fill: "#f0a96f", deep: "#b5652b", text: "#4d2408" },
};

function medal(place: number): { fill: string; deep: string; text: string } {
  return MEDALS[place] ?? { fill: PRIMARY, deep: PRIMARY_DEEP, text: "#ffffff" };
}

export function ordinal(place: number): string {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${place}th`;
  return `${place}${["th", "st", "nd", "rd"][place % 10] ?? "th"}`;
}

export function windowLabel(days: number): string {
  return `Last ${days} days`;
}

/** The badge in the card's corner. */
export function windowTitle(days: number): string {
  if (days === 7) return "Players of the week";
  if (days === 30) return "Players of the month";
  if (days === 90) return "Players of the quarter";
  return windowLabel(days);
}

/** A file name with nothing but plain letters and numbers from the player's name. */
export function cardFileName(view: Pick<TopPlayersView, "days" | "to">, player: Pick<TopPlayer, "place" | "name">): string {
  const slug = player.name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `wordelate-top-${view.days}d-${view.to}-${player.place}${slug ? `-${slug}` : ""}.png`;
}

/** Google picture links end in a size. Ask for a sharper one, since the card draws it large. */
export function largerPicture(url: string): string {
  return /=s\d{1,4}(-c)?$/.test(url) ? url.replace(/=s\d{1,4}(-c)?$/, "=s400-c") : url;
}

/**
 * The picture, loaded so a canvas may still be saved afterwards. A host that does not allow
 * that, or a broken link, gives null and the card shows the first letter instead.
 */
export function loadPicture(url: string | null): Promise<HTMLImageElement | null> {
  if (!url || !/^https:\/\//.test(url)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = largerPicture(url);
  });
}

let wordmark: Promise<HTMLImageElement | null> | null = null;

function loadWordmark(): Promise<HTMLImageElement | null> {
  wordmark ??= new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = "/brand/wordmark.png";
  });
  return wordmark;
}

/** Canvas text only uses a web font that has already loaded. */
async function fontsReady(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`600 80px "Fredoka"`),
      document.fonts.load(`700 80px "Fredoka"`),
      document.fonts.load(`700 30px "Nunito"`),
      document.fonts.load(`800 30px "Nunito"`),
    ]);
  } catch {
    // A system font is fine.
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Shorten with an ellipsis until it fits. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  const chars = Array.from(text);
  while (chars.length > 1 && ctx.measureText(`${chars.join("")}…`).width > max) chars.pop();
  return `${chars.join("")}…`;
}

/** The biggest font size from `start` down that keeps the text inside `max`. */
function shrinkToFit(ctx: CanvasRenderingContext2D, text: string, weight: number, family: string, start: number, min: number, max: number): number {
  let size = start;
  for (; size > min; size -= 2) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= max) return size;
  }
  ctx.font = `${weight} ${min}px ${family}`;
  return min;
}

type Chip = { label: string; fill: string; deep: string };

function chipsFor(bestDay: TopPlayer["bestDay"]): Chip[] {
  return [
    { label: bestDay.start, fill: PRIMARY, deep: PRIMARY_DEEP },
    ...bestDay.steps.map((step) =>
      step.op === "+"
        ? { label: `+ ${step.word}`, fill: ADD, deep: ADD_DEEP }
        : { label: `− ${step.word}`, fill: SUB, deep: SUB_DEEP },
    ),
  ];
}

/** Lay the chips out in centred rows inside the box. Smaller chips when they would not fit. */
function drawChips(ctx: CanvasRenderingContext2D, chips: readonly Chip[], left: number, top: number, width: number, maxHeight: number): void {
  for (let size = 36; size >= 18; size -= 2) {
    ctx.font = `600 ${size}px ${DISPLAY}`;
    const padX = Math.round(size * 0.6);
    const height = Math.round(size * 1.7);
    const gap = Math.round(size * 0.35);
    const rows: { chip: Chip; w: number }[][] = [[]];
    let rowWidth = 0;
    for (const chip of chips) {
      const w = Math.min(width, ctx.measureText(chip.label).width + padX * 2);
      const row = rows[rows.length - 1] ?? [];
      if (row.length > 0 && rowWidth + gap + w > width) {
        rows.push([{ chip, w }]);
        rowWidth = w;
      } else {
        row.push({ chip, w });
        rowWidth += (row.length > 1 ? gap : 0) + w;
      }
    }
    const blockHeight = rows.length * (height + 5) + (rows.length - 1) * gap;
    if (blockHeight > maxHeight && size > 18) continue;
    let y = top + Math.max(0, (maxHeight - blockHeight) / 2);
    for (const row of rows) {
      const total = row.reduce((sum, item) => sum + item.w, 0) + gap * (row.length - 1);
      let x = left + (width - total) / 2;
      for (const { chip, w } of row) {
        roundRect(ctx, x, y + 5, w, height, height / 2);
        ctx.fillStyle = chip.deep;
        ctx.fill();
        roundRect(ctx, x, y, w, height, height / 2);
        ctx.fillStyle = chip.fill;
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(fit(ctx, chip.label, w - padX), x + w / 2, y + height / 2 + 1);
        x += w + gap;
      }
      y += height + gap + 5;
    }
    return;
  }
}

/** "start → goal", with the arrow drawn, since the display font has no arrow. */
function drawPair(ctx: CanvasRenderingContext2D, start: string, goal: string, cx: number, baseline: number, max: number): void {
  let size = 46;
  let arrow = 0;
  let total = 0;
  for (; size >= 26; size -= 2) {
    ctx.font = `600 ${size}px ${DISPLAY}`;
    arrow = size * 1.3;
    total = ctx.measureText(start).width + ctx.measureText(goal).width + arrow;
    if (total <= max) break;
  }
  const left = fit(ctx, start, (max - arrow) / 2);
  const right = fit(ctx, goal, (max - arrow) / 2);
  total = ctx.measureText(left).width + ctx.measureText(right).width + arrow;
  let x = cx - total / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  ctx.fillText(left, x, baseline);
  x += ctx.measureText(left).width;
  const mid = baseline - size * 0.33;
  const a0 = x + size * 0.28;
  const a1 = x + arrow - size * 0.28;
  ctx.strokeStyle = PRIMARY;
  ctx.lineWidth = size * 0.12;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(a0, mid);
  ctx.lineTo(a1, mid);
  ctx.moveTo(a1 - size * 0.26, mid - size * 0.24);
  ctx.lineTo(a1, mid);
  ctx.lineTo(a1 - size * 0.26, mid + size * 0.24);
  ctx.stroke();
  ctx.fillText(right, x + arrow, baseline);
  ctx.textAlign = "center";
}

function drawStat(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, value: string, label: string, colors: { bg: string; border: string; ink: string }): void {
  roundRect(ctx, x, y + 6, w, h, 28);
  ctx.fillStyle = colors.border;
  ctx.fill();
  roundRect(ctx, x, y, w, h, 28);
  ctx.fillStyle = colors.bg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = colors.border;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = colors.ink;
  shrinkToFit(ctx, value, 700, DISPLAY, 64, 36, w - 30);
  ctx.fillText(value, x + w / 2, y + h / 2 + 10);
  ctx.font = `800 24px ${BODY}`;
  ctx.fillStyle = INK_SOFT;
  ctx.fillText(fit(ctx, label.toUpperCase(), w - 24), x + w / 2, y + h - 24);
}

/** Draw one card. Resolves to the canvas, ready to show or save. */
export async function drawCard(view: TopPlayersView, player: TopPlayer, picture: HTMLImageElement | null): Promise<HTMLCanvasElement> {
  await fontsReady();
  const logo = await loadWordmark();
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const colors = medal(player.place);

  // Background and soft circles.
  const sky = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  sky.addColorStop(0, PRIMARY);
  sky.addColorStop(1, PRIMARY_DEEP);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  for (const [cx, cy, r] of [
    [90, 140, 180],
    [1010, 330, 140],
    [960, 1250, 220],
    [60, 1180, 90],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // The white panel.
  const panel = { x: 60, y: 60, w: CARD_WIDTH - 120, h: CARD_HEIGHT - 150 };
  roundRect(ctx, panel.x, panel.y + 10, panel.w, panel.h, 56);
  ctx.fillStyle = "rgba(20, 10, 70, 0.35)";
  ctx.fill();
  roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 56);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  // Header: the wordmark and the window.
  if (logo) {
    const h = 64;
    const w = (logo.width / logo.height) * h;
    ctx.drawImage(logo, panel.x + 56, panel.y + 46, w, h);
  } else {
    ctx.font = `700 52px ${DISPLAY}`;
    ctx.fillStyle = PRIMARY;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Wordelate", panel.x + 56, panel.y + 78);
  }
  const range = `${shortDay(view.from)} – ${shortDay(view.to)}`;
  ctx.font = `800 24px ${BODY}`;
  const pillText = windowTitle(view.days).toUpperCase();
  const pillW = ctx.measureText(pillText).width + 48;
  const pillX = panel.x + panel.w - 56 - pillW;
  roundRect(ctx, pillX, panel.y + 52, pillW, 52, 26);
  ctx.fillStyle = PRIMARY_TINT;
  ctx.fill();
  ctx.fillStyle = PRIMARY_DEEP;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(pillText, pillX + pillW / 2, panel.y + 79);

  // The picture, ringed in the medal colour, with the place badge.
  const cx = CARD_WIDTH / 2;
  const cy = 365;
  const r = 140;
  ctx.beginPath();
  ctx.arc(cx, cy + 8, r + 16, 0, Math.PI * 2);
  ctx.fillStyle = colors.deep;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 16, 0, Math.PI * 2);
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (picture) {
    const side = Math.min(picture.naturalWidth, picture.naturalHeight);
    ctx.drawImage(picture, (picture.naturalWidth - side) / 2, (picture.naturalHeight - side) / 2, side, side, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = PRIMARY_TINT;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = PRIMARY;
    ctx.font = `700 150px ${DISPLAY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(Array.from(player.name.trim())[0]?.toUpperCase() ?? "?", cx, cy + 8);
  }
  ctx.restore();

  const bx = cx + 112;
  const by = cy + 104;
  ctx.beginPath();
  ctx.arc(bx, by + 6, 62, 0, Math.PI * 2);
  ctx.fillStyle = colors.deep;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(bx, by, 62, 0, Math.PI * 2);
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = colors.text;
  ctx.font = `700 60px ${DISPLAY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`#${player.place}`, bx, by + 4);

  // Name and place.
  ctx.fillStyle = INK;
  ctx.textBaseline = "alphabetic";
  shrinkToFit(ctx, player.name, 600, DISPLAY, 84, 48, panel.w - 120);
  ctx.fillText(fit(ctx, player.name, panel.w - 120), cx, 628);
  ctx.font = `700 32px ${BODY}`;
  ctx.fillStyle = INK_SOFT;
  ctx.fillText(`${ordinal(player.place)} place · ${range}`, cx, 678);

  // Stats.
  const statY = 714;
  const statH = 134;
  const gap = 24;
  const statW = (panel.w - 112 - gap * 2) / 3;
  const statX = panel.x + 56;
  drawStat(ctx, statX, statY, statW, statH, String(player.totalPoints), "Points", { bg: GOLD_TINT, border: "#ffe08a", ink: GOLD_DEEP });
  drawStat(ctx, statX + statW + gap, statY, statW, statH, String(player.daysPlayed), player.daysPlayed === 1 ? "Day played" : "Days played", {
    bg: ADD_TINT,
    border: "#a9e9cf",
    ink: ADD_DEEP,
  });
  drawStat(ctx, statX + (statW + gap) * 2, statY, statW, statH, String(player.bestDay.score), "Best score", {
    bg: PRIMARY_TINT,
    border: "#cfc4ff",
    ink: PRIMARY_DEEP,
  });

  // Best day.
  const boxX = panel.x + 56;
  const boxY = 886;
  const boxW = panel.w - 112;
  const boxH = panel.y + panel.h - 48 - boxY;
  roundRect(ctx, boxX, boxY, boxW, boxH, 32);
  ctx.fillStyle = "#faf9ff";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = LINE;
  ctx.stroke();

  const when = dayParts(player.bestDay.day, "").long;
  const moves = `${player.bestDay.moves} ${player.bestDay.moves === 1 ? "move" : "moves"}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 24px ${BODY}`;
  ctx.fillStyle = INK_SOFT;
  ctx.fillText(fit(ctx, `BEST DAY · ${when} · ${moves}`.toUpperCase(), boxW - 60), cx, boxY + 52);
  drawPair(ctx, player.bestDay.start, player.bestDay.goal, cx, boxY + 112, boxW - 80);
  const chipsTop = boxY + 140;
  drawChips(ctx, chipsFor(player.bestDay), boxX + 32, chipsTop, boxW - 64, boxY + boxH - 28 - chipsTop);

  // Footer.
  ctx.font = `700 30px ${DISPLAY}`;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("wordelate.com", cx, CARD_HEIGHT - 45);
  return canvas;
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not make the image"))), "image/png");
  });
}

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The ranking without the players left out on this page. Everyone below moves up a place.
 * Nothing is sent to the server; a reload or another window shows everyone again.
 */
export function withoutHidden(view: TopPlayersView, hidden: ReadonlySet<number>): TopPlayersView {
  const players = view.players.filter((player) => !hidden.has(player.place)).map((player, index) => ({ ...player, place: index + 1 }));
  return { ...view, players };
}
