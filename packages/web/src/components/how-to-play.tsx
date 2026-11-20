import { useEffect, useState } from "preact/hooks";
import { ArrowIcon } from "./icons.js";
import { Modal } from "./modal.js";

type Page = {
  title: string;
  lead: string;
  detail: string;
  image: string;
  alt: string;
  /** A short line printed on the picture, so the photo makes sense on its own. */
  tag: string;
};

const PAGES: readonly Page[] = [
  {
    title: "Travel from one word to another",
    lead: "Every puzzle gives you two words: where you start and where you want to end up.",
    detail: "They sit at the top of the screen. Here, the job is to get from paris to sushi.",
    image: "/howto/step-1.png",
    alt: "The game screen. The top bar shows paris, an arrow, and sushi. A 3D graph below shows a dot for the start word and a dot for the goal word.",
    tag: "Start and goal, always at the top",
  },
  {
    title: "Add and take away words",
    lead: "Type a word, then tap + to add its meaning or − to take it away.",
    detail:
      "Words work like ideas you can do maths with. Take france out of paris and you have a big city. Add japan and it becomes a city in Japan.",
    image: "/howto/step-2.png",
    alt: "The game after two moves. The equation reads paris minus france plus japan, and the meter says Warm.",
    tag: "paris − france + japan",
  },
  {
    title: "Get warmer, then land on the goal",
    lead: "The bar shows how close you are, from Ice cold to Burning.",
    detail:
      "When the big word on your dot is the goal word, you win. Fewer moves earn more points, and streaks and points unlock new looks for the graph.",
    image: "/howto/step-3.png",
    alt: "The win screen. It says Solved, shows three stars, and shows the points earned.",
    tag: "Land on the goal to win",
  },
];

function Pager({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const last = index === PAGES.length - 1;
  const page = PAGES[index] ?? (PAGES[0] as Page);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight") setIndex((value) => Math.min(PAGES.length - 1, value + 1));
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div class="howto">
      <p class="howto-step">
        Step {index + 1} of {PAGES.length}
      </p>
      <figure class="howto-figure">
        <img
          key={page.image}
          class="howto-img"
          src={page.image}
          alt={page.alt}
          width={640}
          height={400}
          decoding="async"
        />
        <figcaption class="howto-tag">{page.tag}</figcaption>
      </figure>
      <div class="howto-copy" aria-live="polite">
        <h2 class="howto-title">{page.title}</h2>
        <p class="howto-lead">{page.lead}</p>
        <p class="howto-detail">{page.detail}</p>
      </div>

      <div class="howto-dots" role="group" aria-label="Pages">
        {PAGES.map((item, n) => (
          <button
            type="button"
            key={item.title}
            class={n === index ? "dot dot-on" : "dot"}
            aria-label={`Go to step ${n + 1}`}
            aria-current={n === index ? "step" : undefined}
            onClick={() => setIndex(n)}
          />
        ))}
      </div>

      <div class="howto-actions">
        <button
          type="button"
          class="btn btn-ghost"
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
          disabled={index === 0}
        >
          Back
        </button>
        {last ? (
          <button type="button" class="btn btn-go" onClick={onClose}>
            Let’s play!
          </button>
        ) : (
          <button type="button" class="btn btn-go" onClick={() => setIndex((value) => value + 1)}>
            Next
            <ArrowIcon size={20} />
          </button>
        )}
      </div>
      <p class="howto-credit">
        Word vectors are derived from ConceptNet Numberbatch 19.08 by the ConceptNet team, used under CC BY-SA 4.0.
      </p>
    </div>
  );
}

export function HowToPlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} label="How to play" variant="card">
      <Pager onClose={onClose} />
    </Modal>
  );
}
