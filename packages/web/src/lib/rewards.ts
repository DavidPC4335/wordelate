/**
 * Rewards: graph looks the player earns, plus the plain default.
 * The first three are plain recolors. The rest get steadily harder to earn and add textures,
 * animated particles and other zany touches (see LookFx).
 * Everything here is pure data and arithmetic, so it can be tested without a browser.
 * A look only changes how the 3D graph is painted. It never touches scoring or the UI chrome.
 */

export type CosmeticId = "classic" | "sunset" | "neon" | "aurora" | "candy" | "abyss" | "galaxy" | "disco" | "holiday";

export type Unlock =
  | { kind: "free" }
  | { kind: "points"; target: number }
  | { kind: "streak"; target: number };

/** Extra styling for the fancy looks. Every field is optional, so the plain looks leave it out. */
export type LookFx = {
  /** Pattern painted on a dome around the scene. It stays put in the world as you drag. */
  backdrop?: "candy" | "deep" | "galaxy" | "prism" | "winter";
  /** Texture wrapped around every bead. */
  skin?: "candy" | "bubble" | "planet" | "disco" | "bauble";
  /** Texture along the path tube. It scrolls slowly unless motion is reduced. */
  tube?: "stripes" | "waves" | "dashes" | "rainbow" | "garland";
  /** Little things drifting through the scene, always behind the graph. */
  drift?: {
    shape: "dot" | "bubble" | "star" | "pill" | "flake";
    colors: readonly string[];
    /** True floats up, false drifts down. */
    rise: boolean;
    /** Fraction of the scene height covered per second. */
    speed: number;
    /** Sprite size in CSS pixels. */
    size: number;
    count: number;
  };
  /** Cycle the goal ring through the rainbow. */
  rainbow?: boolean;
};

/** Everything the 3D scene needs to repaint itself. Colors are CSS hex strings. */
export type SceneLook = {
  /** Backdrop gradient, top to bottom. */
  sky: readonly [string, string, string, string];
  /** Soft light behind the cloud. rgba() string. */
  glow: string;
  /** Distant objects fade into this. Match the middle of the sky. */
  fog: string;
  gridMajor: string;
  gridMinor: string;
  /** Label text, its outline, and the quieter secondary text. */
  ink: string;
  inkSoft: string;
  halo: string;
  /** Label color once the path has landed on the goal. Must read against this look's sky. */
  arrivedInk: string;
  start: string;
  step: string;
  latest: string;
  goal: string;
  tube: string;
  ring: string;
  sparks: readonly string[];
  /** Multiplies how much the beads glow. */
  glowBoost: number;
  /** Scatter small stars behind the cloud. */
  stars: boolean;
  /** Aurora-style soft ribbons painted into the backdrop. */
  ribbons: readonly string[];
  exposure: number;
  fx?: LookFx;
};

export type Cosmetic = {
  id: CosmeticId;
  name: string;
  blurb: string;
  unlock: Unlock;
  look: SceneLook;
};

export const COSMETICS: readonly Cosmetic[] = [
  {
    id: "classic",
    name: "Daybreak",
    blurb: "The bright default sky.",
    unlock: { kind: "free" },
    look: {
      sky: ["#a9d8ff", "#d9eeff", "#e8eeff", "#c2cdfb"],
      glow: "rgba(255, 255, 255, 0.55)",
      fog: "#d6e6ff",
      gridMajor: "#7f95f2",
      gridMinor: "#b4c2fb",
      ink: "#221d44",
      inkSoft: "#5b5683",
      halo: "#f3f7ff",
      arrivedInk: "#0c8a5a",
      start: "#7c5cff",
      step: "#a79bff",
      latest: "#ff6b8b",
      goal: "#16b377",
      tube: "#6d4df2",
      ring: "#16b377",
      sparks: ["#ffc233", "#ff6b8b", "#16b377", "#7c5cff", "#4aa8ff"],
      glowBoost: 1,
      stars: false,
      ribbons: [],
      exposure: 1.05,
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    blurb: "A warm, glowing evening sky.",
    unlock: { kind: "points", target: 300 },
    look: {
      sky: ["#46207a", "#cf4a88", "#ff915f", "#ffd38a"],
      glow: "rgba(255, 220, 160, 0.5)",
      fog: "#ee8f7c",
      gridMajor: "#fff0c4",
      gridMinor: "#ffb48a",
      ink: "#3a1450",
      inkSoft: "#7a3a62",
      halo: "#ffe9d6",
      arrivedInk: "#0b6b49",
      start: "#ffe08a",
      step: "#ffb199",
      latest: "#ffffff",
      goal: "#7df0c3",
      tube: "#8a2270",
      ring: "#7df0c3",
      sparks: ["#ffd23f", "#ffffff", "#ff7aa8", "#7df0c3", "#ff9a4d"],
      glowBoost: 1.6,
      stars: false,
      ribbons: [],
      exposure: 1.1,
    },
  },
  {
    id: "neon",
    name: "Neon Night",
    blurb: "Glowing lines on a dark grid.",
    unlock: { kind: "streak", target: 3 },
    look: {
      sky: ["#07031a", "#150b45", "#1d1060", "#0b1030"],
      glow: "rgba(122, 44, 255, 0.35)",
      fog: "#120a3c",
      gridMajor: "#00f0ff",
      gridMinor: "#6b2cff",
      ink: "#eafcff",
      inkSoft: "#9fb4ff",
      halo: "#07031a",
      arrivedInk: "#b6ff3c",
      start: "#ff2fd1",
      step: "#8a6cff",
      latest: "#00f0ff",
      goal: "#b6ff3c",
      tube: "#ff2fd1",
      ring: "#b6ff3c",
      sparks: ["#00f0ff", "#ff2fd1", "#b6ff3c", "#ffffff", "#8a6cff"],
      glowBoost: 3.2,
      stars: true,
      ribbons: [],
      exposure: 1.15,
    },
  },
  {
    id: "aurora",
    name: "Aurora",
    blurb: "Northern lights over a frozen night.",
    unlock: { kind: "streak", target: 7 },
    look: {
      sky: ["#04121f", "#0b3a45", "#136b5f", "#0a2433"],
      glow: "rgba(90, 255, 190, 0.22)",
      fog: "#0b3640",
      gridMajor: "#4dffc3",
      gridMinor: "#2b8f9c",
      ink: "#eafff8",
      inkSoft: "#9fe8d2",
      halo: "#04121f",
      arrivedInk: "#5dffb0",
      start: "#b69cff",
      step: "#59e0c0",
      latest: "#ffe66d",
      goal: "#5dffb0",
      tube: "#59e0c0",
      ring: "#5dffb0",
      sparks: ["#5dffb0", "#b69cff", "#ff8bd1", "#ffe66d", "#ffffff"],
      glowBoost: 2.4,
      stars: true,
      ribbons: ["rgba(80, 255, 180, 0.34)", "rgba(150, 110, 255, 0.28)", "rgba(80, 220, 255, 0.22)"],
      exposure: 1.1,
    },
  },
  {
    id: "candy",
    name: "Candy Land",
    blurb: "Polka dots, sprinkles and candy-stripe paths.",
    unlock: { kind: "points", target: 1000 },
    look: {
      sky: ["#ffc4e6", "#ffe3f4", "#d4fff0", "#fff6bf"],
      glow: "rgba(255, 255, 255, 0.6)",
      fog: "#ffe3f4",
      gridMajor: "#ff6fb5",
      gridMinor: "#8ee6c8",
      ink: "#4a1a5c",
      inkSoft: "#9a4a86",
      halo: "#fff5fb",
      arrivedInk: "#0a7a55",
      start: "#ff6fb5",
      step: "#7fe0c2",
      latest: "#ffb02e",
      goal: "#2fc98f",
      tube: "#ff4fa3",
      ring: "#2fc98f",
      sparks: ["#ff6fb5", "#ffd23f", "#7fe0c2", "#a98bff", "#ffffff"],
      glowBoost: 0.7,
      stars: false,
      ribbons: [],
      exposure: 1.1,
      fx: {
        backdrop: "candy",
        skin: "candy",
        tube: "stripes",
        drift: {
          shape: "pill",
          colors: ["#ff6fb5", "#ffd23f", "#7fe0c2", "#a98bff", "#ff9a4d"],
          rise: false,
          speed: 0.07,
          size: 9,
          count: 60,
        },
      },
    },
  },
  {
    id: "abyss",
    name: "Deep Sea",
    blurb: "Bubbles, light rays and glassy beads.",
    unlock: { kind: "streak", target: 14 },
    look: {
      sky: ["#031b33", "#05446f", "#0a6d94", "#06314a"],
      glow: "rgba(120, 240, 255, 0.25)",
      fog: "#05466e",
      gridMajor: "#5ff0ff",
      gridMinor: "#1d7fa8",
      ink: "#e9fdff",
      inkSoft: "#9bdcec",
      halo: "#031b33",
      arrivedInk: "#7dffb8",
      start: "#ffb86b",
      step: "#7fe7ff",
      latest: "#ff7ab8",
      goal: "#7dffb8",
      tube: "#5fe0ff",
      ring: "#7dffb8",
      sparks: ["#7fe7ff", "#ffffff", "#ff7ab8", "#7dffb8", "#ffd36b"],
      glowBoost: 2.2,
      stars: false,
      ribbons: [],
      exposure: 1.1,
      fx: {
        backdrop: "deep",
        skin: "bubble",
        tube: "waves",
        drift: {
          shape: "bubble",
          colors: ["#ffffff", "#bff6ff", "#8fe9ff"],
          rise: true,
          speed: 0.1,
          size: 15,
          count: 55,
        },
      },
    },
  },
  {
    id: "galaxy",
    name: "Galaxy",
    blurb: "Nebula clouds, comet trails and little planets.",
    unlock: { kind: "points", target: 2500 },
    look: {
      sky: ["#05010f", "#170536", "#2a0d55", "#0a0420"],
      glow: "rgba(255, 120, 220, 0.2)",
      fog: "#14052e",
      gridMajor: "#c18bff",
      gridMinor: "#5a3b9a",
      ink: "#fff4ff",
      inkSoft: "#cdb4ff",
      halo: "#05010f",
      arrivedInk: "#7dffd0",
      start: "#ffcf5c",
      step: "#b69cff",
      latest: "#ff7ad9",
      goal: "#59e8ff",
      tube: "#b78bff",
      ring: "#59e8ff",
      sparks: ["#ffe66d", "#ff7ad9", "#59e8ff", "#ffffff", "#b69cff"],
      glowBoost: 2.6,
      stars: true,
      ribbons: [],
      exposure: 1.15,
      fx: {
        backdrop: "galaxy",
        skin: "planet",
        tube: "dashes",
        drift: {
          shape: "star",
          colors: ["#ffffff", "#ffe66d", "#ff9be8", "#9be8ff"],
          rise: false,
          speed: 0.025,
          size: 18,
          count: 38,
        },
      },
    },
  },
  {
    id: "disco",
    name: "Disco Party",
    blurb: "Mirror-ball beads, rainbow beams and confetti.",
    unlock: { kind: "streak", target: 30 },
    look: {
      sky: ["#12001f", "#2a0040", "#3d0a5c", "#18002a"],
      glow: "rgba(255, 255, 255, 0.25)",
      fog: "#220038",
      gridMajor: "#ff3df0",
      gridMinor: "#35e6ff",
      ink: "#ffffff",
      inkSoft: "#ffd6fb",
      halo: "#12001f",
      arrivedInk: "#b8ff4d",
      start: "#ff4fd8",
      step: "#4de1ff",
      latest: "#ffe74d",
      goal: "#b8ff4d",
      tube: "#ff4fd8",
      ring: "#b8ff4d",
      sparks: ["#ff4fd8", "#4de1ff", "#ffe74d", "#b8ff4d", "#ff7a3d", "#ffffff"],
      glowBoost: 2.8,
      stars: false,
      ribbons: [],
      exposure: 1.15,
      fx: {
        backdrop: "prism",
        skin: "disco",
        tube: "rainbow",
        rainbow: true,
        drift: {
          shape: "pill",
          colors: ["#ff4fd8", "#4de1ff", "#ffe74d", "#b8ff4d", "#ff7a3d", "#ffffff"],
          rise: false,
          speed: 0.12,
          size: 10,
          count: 70,
        },
      },
    },
  },
  {
    id: "holiday",
    name: "Christmas Eve",
    blurb: "Snowfall, fir trees, a big moon and shiny ornaments.",
    unlock: { kind: "points", target: 5000 },
    look: {
      sky: ["#050b1f", "#0e2147", "#1b4263", "#3b7d86"],
      glow: "rgba(255, 244, 200, 0.2)",
      fog: "#143a5c",
      gridMajor: "#ffffff",
      gridMinor: "#8fc4e8",
      ink: "#ffffff",
      inkSoft: "#cfe6ff",
      halo: "#050b1f",
      arrivedInk: "#7dffa0",
      start: "#e8344a",
      step: "#f2f6ff",
      latest: "#ffcf40",
      goal: "#2fdc7a",
      tube: "#2fa860",
      ring: "#2fdc7a",
      sparks: ["#ff4a5e", "#ffd24a", "#2fdc7a", "#ffffff", "#7ec8ff"],
      glowBoost: 2,
      stars: true,
      ribbons: [],
      exposure: 1.1,
      fx: {
        backdrop: "winter",
        skin: "bauble",
        tube: "garland",
        drift: {
          shape: "flake",
          colors: ["#ffffff", "#e6f4ff", "#cfe8ff"],
          rise: false,
          speed: 0.07,
          size: 16,
          count: 90,
        },
      },
    },
  },
];

export const DEFAULT_COSMETIC: CosmeticId = "classic";

/** The cosmetics a player has to earn. Everything except the free default. */
export const EARNABLE: readonly Cosmetic[] = COSMETICS.filter((item) => item.unlock.kind !== "free");

export type RewardStats = {
  totalPoints: number;
  /** Longest day streak ever reached. Losing a streak never takes a look away. */
  bestStreak: number;
};

export function isCosmeticId(value: unknown): value is CosmeticId {
  return COSMETICS.some((item) => item.id === value);
}

export function cosmeticFor(id: CosmeticId): Cosmetic {
  return COSMETICS.find((item) => item.id === id) ?? (COSMETICS[0] as Cosmetic);
}

export function isEarned(cosmetic: Cosmetic, stats: RewardStats): boolean {
  switch (cosmetic.unlock.kind) {
    case "free":
      return true;
    case "points":
      return stats.totalPoints >= cosmetic.unlock.target;
    case "streak":
      return stats.bestStreak >= cosmetic.unlock.target;
  }
}

export function earnedIds(stats: RewardStats): CosmeticId[] {
  return COSMETICS.filter((item) => isEarned(item, stats)).map((item) => item.id);
}

export type UnlockProgress = {
  current: number;
  target: number;
  ratio: number;
  /** "120 / 300 points" */
  label: string;
  /** "Earn 300 points" */
  goal: string;
  /** "180 points to go" */
  remaining: string;
};

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function unlockProgress(cosmetic: Cosmetic, stats: RewardStats): UnlockProgress {
  const unlock = cosmetic.unlock;
  if (unlock.kind === "free") {
    return { current: 1, target: 1, ratio: 1, label: "Always yours", goal: "Included", remaining: "" };
  }
  const isPoints = unlock.kind === "points";
  const current = isPoints ? stats.totalPoints : stats.bestStreak;
  const target = unlock.target;
  const unit = isPoints ? ["point", "points"] : ["day", "days"];
  const left = Math.max(0, target - current);
  const shown = Math.min(current, target);
  return {
    current: shown,
    target,
    ratio: Math.min(1, Math.max(0, current / target)),
    label: `${shown} / ${target} ${unit[1]}`,
    goal: isPoints ? `Earn ${target} points` : `Reach a ${target}-day streak`,
    remaining: `${left} ${plural(left, unit[0] ?? "", unit[1] ?? "")} to go`,
  };
}

/** The locked look the player is closest to. Null once everything is earned. */
export function nextReward(stats: RewardStats): { cosmetic: Cosmetic; progress: UnlockProgress } | null {
  let best: { cosmetic: Cosmetic; progress: UnlockProgress } | null = null;
  for (const cosmetic of EARNABLE) {
    if (isEarned(cosmetic, stats)) continue;
    const progress = unlockProgress(cosmetic, stats);
    if (!best || progress.ratio > best.progress.ratio) best = { cosmetic, progress };
  }
  return best;
}

/** CSS gradient for a look, used by the backdrop fallback and the preview cards. */
export function skyGradient(look: SceneLook): string {
  const [a, b, c, d] = look.sky;
  return `linear-gradient(180deg, ${a} 0%, ${b} 38%, ${c} 70%, ${d} 100%)`;
}

export type Rating = {
  stars: 1 | 2 | 3;
  title: string;
};

/**
 * Three stars at or under par, two within two moves of par, otherwise one.
 * With no known par, three moves is the bar.
 */
export function ratingFor(moves: number, par: number | null): Rating {
  const bar = par != null && par > 0 ? par : 3;
  if (moves < bar) return { stars: 3, title: "Beat par!" };
  if (moves === bar) return { stars: 3, title: "Perfect!" };
  if (moves <= bar + 2) return { stars: 2, title: "Great job!" };
  return { stars: 1, title: "Solved it!" };
}

const HEAT_LABELS: readonly { below: number; label: string }[] = [
  { below: 0.1, label: "Ice cold" },
  { below: 0.28, label: "Cold" },
  { below: 0.46, label: "Cool" },
  { below: 0.64, label: "Warm" },
  { below: 0.82, label: "Hot" },
  { below: 1, label: "Burning" },
];

/** Hot and cold wording for a progress value between 0 and 1. */
export function heatLabel(progress: number, won: boolean): string {
  if (won) return "Got it!";
  const value = Number.isFinite(progress) ? progress : 0;
  for (const entry of HEAT_LABELS) {
    if (value < entry.below) return entry.label;
  }
  return "Burning";
}

const HEAT_STOPS: readonly { at: number; rgb: readonly [number, number, number] }[] = [
  { at: 0, rgb: [74, 168, 255] },
  { at: 0.35, rgb: [138, 108, 255] },
  { at: 0.65, rgb: [255, 154, 61] },
  { at: 1, rgb: [255, 77, 109] },
];

/** Blue when far, orange and red when close. Won boards use green elsewhere. */
export function heatColor(progress: number): string {
  const value = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const to = HEAT_STOPS[i];
    const from = HEAT_STOPS[i - 1];
    if (!to || !from) continue;
    if (value <= to.at) {
      const t = (value - from.at) / (to.at - from.at);
      const mix = (k: 0 | 1 | 2) => Math.round(from.rgb[k] + (to.rgb[k] - from.rgb[k]) * t);
      return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
    }
  }
  const last = HEAT_STOPS[HEAT_STOPS.length - 1];
  return last ? `rgb(${last.rgb.join(", ")})` : "rgb(255, 77, 109)";
}
