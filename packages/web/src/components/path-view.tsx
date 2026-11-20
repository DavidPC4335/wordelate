import { isVariant } from "@wordelate/game-math";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { formatEquation, type AppliedStep } from "../lib/game.js";
import { LABEL_NEAR_DUPLICATE_CUTOFF, LABEL_WARM_SIMILARITY } from "../lib/game.js";
import { equationPositions, type PathDrawState } from "../lib/path.js";
import { nearestLabels, rowFor, type Pack } from "../lib/pack.js";
import { projectTo3 } from "../lib/project.js";

type PathSceneHandle = {
  update(state: PathDrawState): void;
  dispose(): void;
};

type ScanHit = { key: string; word: string };

function stepKeyOf(steps: readonly AppliedStep[]): string {
  let key = "";
  for (const step of steps) key += `${step.op}\t${step.word}\n`;
  return key;
}

function pathCaption(
  startWord: string,
  goalWord: string,
  steps: readonly AppliedStep[],
  recentLabels: readonly string[],
): string {
  let caption = `Path from ${startWord}`;
  for (const step of steps) {
    caption += step.op === "+" ? `, plus ${step.word}` : `, minus ${step.word}`;
  }
  caption += ` toward ${goalWord}`;
  const words = recentLabels.filter((word) => word.length > 0);
  const equation = words[0];
  const current = words[1];
  if (equation && current) caption += `. Here: ${equation}, = ${current}`;
  else if (equation) caption += `. Here: ${equation}`;
  return caption;
}

function Celebration() {
  const flecks = Array.from({ length: 22 }, (_, index) => {
    const angle = (index / 22) * Math.PI * 2;
    const distance = 110 + (index % 5) * 34;
    return {
      dx: `${Math.cos(angle) * distance}px`,
      dy: `${Math.sin(angle) * distance - 30}px`,
      delay: `${(index % 7) * 0.04}s`,
      tone: index % 3,
    };
  });
  return (
    <div class="celebrate" role="status">
      <p class="celebrate-word">Correct</p>
      {flecks.map((fleck, index) => (
        <span
          key={index}
          class={fleck.tone === 0 ? "fleck fleck-ok" : fleck.tone === 1 ? "fleck fleck-gold" : "fleck"}
          style={{ ["--dx"]: fleck.dx, ["--dy"]: fleck.dy, animationDelay: fleck.delay }}
        />
      ))}
    </div>
  );
}

export function PathView({
  pack,
  start,
  goal,
  startWord,
  goalWord,
  steps,
  position,
  similarity,
  won,
}: {
  pack: Pack;
  start: Float32Array;
  goal: Float32Array;
  startWord: string;
  goalWord: string;
  steps: readonly AppliedStep[];
  position: Float32Array;
  similarity: number;
  won: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [scan, setScan] = useState<ScanHit | null>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<PathSceneHandle | null>(null);
  const drawRef = useRef<PathDrawState | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const stepKey = stepKeyOf(steps);
  const atStart = stepKey.length === 0;
  const equationLabel = formatEquation(startWord, steps);
  const scannedWord = !atStart && !won && scan?.key === stepKey ? scan.word : "";
  const recentLabels = useMemo(() => {
    if (atStart) return [equationLabel];
    const second = (won ? goalWord : scannedWord).trim();
    if (second.length === 0 || second.toLowerCase() === equationLabel.trim().toLowerCase()) {
      return [equationLabel];
    }
    return [equationLabel, second];
  }, [atStart, equationLabel, goalWord, scannedWord, won]);

  const drawState = useMemo<PathDrawState>(() => {
    const samples = equationPositions({
      start,
      goal,
      startWord,
      goalWord,
      steps,
      vectorFor: (word) => rowFor(pack, word),
    });
    if (samples.length === 0) samples.push(position);
    else samples[samples.length - 1] = position;
    const goalPoint = projectTo3(goal);
    const path = samples.map((sample) => projectTo3(sample));
    if (won && path.length > 0) path[path.length - 1] = goalPoint;
    return {
      start: projectTo3(start),
      goal: goalPoint,
      startWord,
      goalWord,
      path,
      recentLabels,
      atStart,
      arrived: won,
    };
    // stepKey changes exactly when the applied equation changes, so `steps` is current here.
  }, [atStart, goal, goalWord, pack, position, recentLabels, start, startWord, stepKey, won]);

  drawRef.current = drawState;

  useEffect(() => {
    const gl = glRef.current;
    const overlay = labelRef.current;
    if (!gl || !overlay) return;
    let alive = true;
    let scene: PathSceneHandle | null = null;
    setFailed(false);
    import("./path-scene.js")
      .then(({ mountPathScene }) => {
        if (!alive || !glRef.current || !labelRef.current) return;
        try {
          scene = mountPathScene(glRef.current, labelRef.current);
        } catch {
          if (alive) setFailed(true);
          return;
        }
        sceneRef.current = scene;
        const pending = drawRef.current;
        if (pending) scene.update(pending);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.update(drawState);
  }, [drawState]);

  useEffect(() => {
    if (atStart || won) return;
    let cancel = false;
    const anchors = [{ word: startWord, vector: start }];
    for (const step of stepsRef.current) {
      const vector = rowFor(pack, step.word);
      if (vector) anchors.push({ word: step.word, vector });
    }
    const key = stepKey;
    nearestLabels(
      pack,
      position,
      anchors,
      goalWord,
      LABEL_NEAR_DUPLICATE_CUTOFF,
      similarity,
      LABEL_WARM_SIMILARITY,
    )
      .then((words) => {
        if (cancel) return;
        const raw = words[0]?.trim() ?? "";
        const word = raw.length === 0 ? "" : isVariant(raw, goalWord) ? goalWord : raw;
        setScan({ key, word });
      })
      .catch(() => {
        if (!cancel) setScan({ key, word: "" });
      });
    return () => {
      cancel = true;
    };
  }, [atStart, goalWord, pack, position, similarity, start, startWord, stepKey, won]);

  useEffect(() => {
    if (!won) {
      setCelebrate(false);
      return;
    }
    setCelebrate(true);
    const timer = window.setTimeout(() => setCelebrate(false), 1800);
    return () => window.clearTimeout(timer);
  }, [won, stepKey]);

  const caption = pathCaption(startWord, goalWord, steps, recentLabels);

  return (
    <div class="path-block">
      <div class="path-stage" id="path-view">
        {failed ? <p class="path-fallback">The 3D path couldn’t be opened.</p> : null}
        <canvas ref={glRef} class="path-canvas" role="img" aria-label={caption} />
        <canvas ref={labelRef} class="path-overlay" aria-hidden="true" />
        {celebrate ? <Celebration /> : null}
      </div>
    </div>
  );
}
