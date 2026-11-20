import { skyGradient } from "../lib/rewards.js";
import type { Cosmetic, SceneLook } from "../lib/rewards.js";

const STARS = (
  <g fill="#ffffff" opacity="0.85">
    <circle cx="14" cy="10" r="1.1" />
    <circle cx="40" cy="18" r="0.8" />
    <circle cx="78" cy="8" r="1.2" />
    <circle cx="104" cy="20" r="0.9" />
    <circle cx="62" cy="14" r="0.7" />
    <circle cx="24" cy="30" r="0.7" />
  </g>
);

/** A hint of the sky pattern, so each fancy look reads at a glance. */
function Pattern({ look }: { look: SceneLook }) {
  switch (look.fx?.backdrop) {
    case "candy":
      return (
        <g>
          <g fill="rgba(255,255,255,0.28)" transform="rotate(-28 60 36)">
            <rect x="-30" y="-40" width="9" height="160" />
            <rect x="-12" y="-40" width="9" height="160" />
            <rect x="6" y="-40" width="9" height="160" />
            <rect x="24" y="-40" width="9" height="160" />
            <rect x="42" y="-40" width="9" height="160" />
            <rect x="60" y="-40" width="9" height="160" />
            <rect x="78" y="-40" width="9" height="160" />
            <rect x="96" y="-40" width="9" height="160" />
            <rect x="114" y="-40" width="9" height="160" />
            <rect x="132" y="-40" width="9" height="160" />
          </g>
          <g fill="rgba(255,255,255,0.7)">
            <circle cx="12" cy="12" r="4" />
            <circle cx="48" cy="12" r="4" />
            <circle cx="84" cy="12" r="4" />
            <circle cx="30" cy="30" r="4" />
            <circle cx="66" cy="30" r="4" />
            <circle cx="102" cy="30" r="4" />
          </g>
        </g>
      );
    case "deep":
      return (
        <g>
          <g fill="rgba(170,240,255,0.2)">
            <polygon points="20,0 28,0 52,60 30,60" />
            <polygon points="60,0 68,0 96,60 70,60" />
            <polygon points="92,0 98,0 120,50 104,50" />
          </g>
          <g fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.8)" stroke-width="0.9">
            <circle cx="14" cy="44" r="3.2" />
            <circle cx="108" cy="42" r="2.4" />
            <circle cx="52" cy="18" r="2" />
            <circle cx="84" cy="30" r="3" />
          </g>
        </g>
      );
    case "galaxy":
      return (
        <g>
          <ellipse cx="30" cy="22" rx="34" ry="16" fill="rgba(255,90,210,0.3)" />
          <ellipse cx="88" cy="46" rx="38" ry="18" fill="rgba(90,150,255,0.3)" />
          <ellipse cx="62" cy="34" rx="50" ry="8" fill="rgba(255,235,255,0.2)" transform="rotate(-24 62 34)" />
          <g fill="#ffffff">
            <path d="M18 8 L19.4 11.6 L23 13 L19.4 14.4 L18 18 L16.6 14.4 L13 13 L16.6 11.6 Z" />
            <path d="M106 28 L107 30.6 L109.6 31.6 L107 32.6 L106 35.2 L105 32.6 L102.4 31.6 L105 30.6 Z" />
          </g>
        </g>
      );
    case "prism": {
      const hues = [320, 280, 220, 180, 120, 60, 20];
      return (
        <g>
          {hues.map((hue, index) => {
            const left = -10 + index * 22;
            return (
              <polygon
                key={hue}
                points={`60,-6 ${left},76 ${left + 12},76`}
                fill={`hsla(${hue}, 100%, 62%, 0.34)`}
              />
            );
          })}
        </g>
      );
    }
    case "winter":
      return (
        <g>
          <circle cx="94" cy="14" r="9" fill="rgba(255,244,200,0.35)" />
          <circle cx="94" cy="14" r="5" fill="#fff6d8" />
          <g fill="#ffffff" opacity="0.9">
            <circle cx="10" cy="8" r="0.9" />
            <circle cx="34" cy="14" r="0.7" />
            <circle cx="58" cy="6" r="1" />
            <circle cx="72" cy="22" r="0.7" />
            <circle cx="20" cy="26" r="0.8" />
          </g>
          <g fill="#06162a">
            <polygon points="4,58 10,36 16,58" />
            <polygon points="14,58 22,30 30,58" />
            <polygon points="94,58 101,34 108,58" />
            <polygon points="106,58 113,38 120,58" />
          </g>
          <g fill="#ffffff" opacity="0.9">
            <circle cx="40" cy="26" r="1.4" />
            <circle cx="52" cy="48" r="1.2" />
            <circle cx="86" cy="36" r="1.4" />
            <circle cx="30" cy="42" r="1.1" />
          </g>
        </g>
      );
    default:
      return null;
  }
}

/** A bead with the look's skin hinted on top, drawn in the same place the real one would be. */
function Bead({ look, id, cx, cy, r, fill }: { look: SceneLook; id: string; cx: number; cy: number; r: number; fill: string }) {
  const skin = look.fx?.skin;
  const clip = `${id}-clip`;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fill} />
      {skin ? (
        <>
          <clipPath id={clip}>
            <circle cx={cx} cy={cy} r={r} />
          </clipPath>
          <g clip-path={`url(#${clip})`}>
            {skin === "candy" ? (
              <g stroke="#ffffff" stroke-width={r * 0.34} opacity="0.95">
                <line x1={cx - r * 1.2} y1={cy + r * 0.2} x2={cx + r * 0.2} y2={cy - r * 1.2} />
                <line x1={cx - r * 0.7} y1={cy + r * 0.9} x2={cx + r * 0.9} y2={cy - r * 0.7} />
                <line x1={cx - r * 0.1} y1={cy + r * 1.4} x2={cx + r * 1.4} y2={cy - r * 0.1} />
              </g>
            ) : null}
            {skin === "bubble" ? (
              <circle cx={cx} cy={cy} r={r - 0.5} fill="none" stroke="#ffffff" stroke-width="1" opacity="0.8" />
            ) : null}
            {skin === "planet" ? (
              <g stroke="rgba(255,255,255,0.45)" stroke-width={r * 0.22}>
                <line x1={cx - r} y1={cy - r * 0.45} x2={cx + r} y2={cy - r * 0.45} />
                <line x1={cx - r} y1={cy + r * 0.15} x2={cx + r} y2={cy + r * 0.15} />
                <line x1={cx - r} y1={cy + r * 0.6} x2={cx + r} y2={cy + r * 0.6} stroke="rgba(0,0,0,0.25)" />
              </g>
            ) : null}
            {skin === "bauble" ? (
              <g stroke="rgba(255,224,130,0.85)" stroke-width="0.7">
                <line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} />
                <line x1={cx + r} y1={cy - r} x2={cx - r} y2={cy + r} />
                <rect x={cx - r} y={cy - r} width={r * 2} height={r * 0.34} fill="#f2c84b" stroke="none" />
              </g>
            ) : null}
            {skin === "disco" ? (
              <g stroke="rgba(10,0,25,0.55)" stroke-width="0.6">
                <line x1={cx - r} y1={cy - r * 0.5} x2={cx + r} y2={cy - r * 0.5} />
                <line x1={cx - r} y1={cy + r * 0.2} x2={cx + r} y2={cy + r * 0.2} />
                <line x1={cx - r * 0.5} y1={cy - r} x2={cx - r * 0.5} y2={cy + r} />
                <line x1={cx + r * 0.3} y1={cy - r} x2={cx + r * 0.3} y2={cy + r} />
              </g>
            ) : null}
          </g>
          <circle cx={cx - r * 0.32} cy={cy - r * 0.36} r={r * 0.2} fill="#ffffff" opacity="0.7" />
        </>
      ) : null}
    </g>
  );
}

/** A tiny picture of a graph look: its sky, a little path, and its start and goal beads. */
export function LookSwatch({ cosmetic, locked = false }: { cosmetic: Cosmetic; locked?: boolean }) {
  const look = cosmetic.look;
  const id = `swatch-${cosmetic.id}`;
  const tubeStyle = look.fx?.tube;
  const path = "22,50 46,32 72,40 98,20";
  return (
    <div class={locked ? "swatch swatch-locked" : "swatch"} style={{ background: skyGradient(look) }}>
      <svg viewBox="0 0 120 72" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${id}-rainbow`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#ff4fd8" />
            <stop offset="0.25" stop-color="#ffe74d" />
            <stop offset="0.5" stop-color="#b8ff4d" />
            <stop offset="0.75" stop-color="#4de1ff" />
            <stop offset="1" stop-color="#ff4fd8" />
          </linearGradient>
        </defs>
        <Pattern look={look} />
        {look.stars ? STARS : null}
        <path
          d="M0 58 L120 58 M0 66 L120 66 M30 50 L10 72 M60 50 L60 72 M90 50 L110 72"
          stroke={look.gridMajor}
          stroke-width="0.8"
          opacity="0.55"
          fill="none"
        />
        <polyline
          points={path}
          fill="none"
          stroke={tubeStyle === "rainbow" ? `url(#${id}-rainbow)` : look.tube}
          stroke-width={tubeStyle ? 3.6 : 3}
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        {tubeStyle === "stripes" || tubeStyle === "dashes" ? (
          <polyline
            points={path}
            fill="none"
            stroke="#ffffff"
            stroke-width={tubeStyle === "stripes" ? 3.6 : 2}
            stroke-dasharray={tubeStyle === "stripes" ? "3 3" : "6 5"}
            stroke-linejoin="round"
          />
        ) : null}
        {tubeStyle === "garland" ? (
          <polyline
            points={path}
            fill="none"
            stroke="#e8344a"
            stroke-width="2.4"
            stroke-dasharray="1.2 8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        ) : null}
        {tubeStyle === "waves" ? (
          <polyline
            points={path}
            fill="none"
            stroke="rgba(255,255,255,0.75)"
            stroke-width="1.2"
            stroke-dasharray="4 3"
            stroke-linejoin="round"
          />
        ) : null}
        <Bead look={look} id={`${id}-a`} cx={22} cy={50} r={6} fill={look.start} />
        <Bead look={look} id={`${id}-b`} cx={46} cy={32} r={4.4} fill={look.step} />
        <Bead look={look} id={`${id}-c`} cx={72} cy={40} r={5.4} fill={look.latest} />
        <Bead look={look} id={`${id}-d`} cx={98} cy={20} r={6} fill={look.goal} />
        <circle cx="98" cy="20" r="10.5" fill="none" stroke={look.ring} stroke-width="1.6" opacity="0.7" />
      </svg>
    </div>
  );
}
