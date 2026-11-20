import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Move } from "@wordelate/game-math";
import { cosine, replay } from "@wordelate/game-math";
import { Admin } from "./components/admin.js";
import { Equation } from "./components/equation.js";
import { HowItWorks } from "./components/how-it-works.js";
import { Meter } from "./components/meter.js";
import { MoveForm } from "./components/move-form.js";
import { PathView } from "./components/path-view.js";
import { Result } from "./components/result.js";
import { StatusBar } from "./components/status-bar.js";
import {
  MAX_MOVES,
  appliedSteps,
  commitMove,
  countsAsWin,
  describeMoveError,
  formatEquation,
  hereAtPosition,
  progressTowardGoal,
  LABEL_NEAR_DUPLICATE_CUTOFF,
  LABEL_WARM_SIMILARITY,
  shareText,
} from "./lib/game.js";
import { loadPack, nearestLabels, rowFor, suggestWords } from "./lib/pack.js";
import type { Pack, PackProgress } from "./lib/pack.js";
import { mergePuzzles } from "./lib/puzzles.js";
import type { Puzzle } from "./lib/puzzles.js";
import { getPlayerId, loadGame, saveGame } from "./lib/storage.js";

type PackState =
  | { status: "loading"; progress: PackProgress }
  | { status: "ready"; pack: Pack }
  | { status: "error"; message: string };

type NearestHit = { key: string; words: string[] };

const PACK_URL = "/vocab/nearest.i8";

let packPromise: Promise<Pack> | null = null;

function loadPackOnce(onProgress: (progress: PackProgress) => void): Promise<Pack> {
  if (!packPromise) {
    packPromise = loadPack(PACK_URL, onProgress).catch((error: unknown) => {
      packPromise = null;
      throw error;
    });
  }
  return packPromise;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function positionKey(puzzleId: string, moves: readonly Move[]): string {
  let key = puzzleId;
  for (const move of moves) {
    key += move.op === "undo" ? "\nundo" : `\n${move.op}\t${move.word ?? ""}`;
  }
  return key;
}

export function App() {
  const [packState, setPackState] = useState<PackState>({
    status: "loading",
    progress: { ratio: 0, label: "Fetching vocabulary" },
  });
  const [puzzleError, setPuzzleError] = useState<string | null>(null);
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null);
  const [puzzleId, setPuzzleId] = useState<string | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [gaveUp, setGaveUp] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [adminOpen, setAdminOpen] = useState(
    () => new URLSearchParams(window.location.search).get("admin") === "1",
  );
  const [moveError, setMoveError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [nearestHit, setNearestHit] = useState<NearestHit | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [formKey, setFormKey] = useState(0);
  const scanGeneration = useRef(0);
  const shownProgress = useRef(0);

  useEffect(() => {
    getPlayerId();
  }, []);

  useEffect(() => {
    let cancel = false;
    setPackState({
      status: "loading",
      progress: { ratio: 0, label: "Fetching vocabulary" },
    });
    loadPackOnce((progress) => {
      if (!cancel) setPackState({ status: "loading", progress });
    })
      .then((pack) => {
        if (!cancel) setPackState({ status: "ready", pack });
      })
      .catch((error: unknown) => {
        if (!cancel) {
          setPackState({
            status: "error",
            message: errorMessage(error, "Could not load the vocabulary."),
          });
        }
      });

    fetch("/puzzles.json")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Puzzle list failed (${response.status})`);
        return mergePuzzles(await response.json());
      })
      .then((list) => {
        if (cancel) return;
        const first = list[0];
        if (!first) throw new Error("Puzzle list is empty");
        const saved = loadGame(first.id);
        setPuzzles(list);
        setPuzzleId(first.id);
        setMoves(saved?.moves ?? []);
        setGaveUp(saved?.gaveUp ?? false);
        setHydrated(true);
        setPuzzleError(null);
      })
      .catch((error: unknown) => {
        if (!cancel) setPuzzleError(errorMessage(error, "Could not load the puzzles."));
      });

    return () => {
      cancel = true;
    };
  }, [loadAttempt]);

  const puzzle = puzzles?.find((item) => item.id === puzzleId) ?? null;
  const pack = packState.status === "ready" ? packState.pack : null;

  const played = useMemo(() => {
    if (!pack || !puzzle) return null;
    const start = rowFor(pack, puzzle.start);
    const goal = rowFor(pack, puzzle.goal);
    if (!start || !goal) {
      return { ok: false as const, error: "This puzzle uses a word that is not in the vocabulary." };
    }
    return replay({
      start,
      goal,
      startWord: puzzle.start,
      goalWord: puzzle.goal,
      moves,
      vectorFor: (word) => rowFor(pack, word),
      banned: [],
      maxMoves: MAX_MOVES,
    });
  }, [pack, puzzle, moves]);

  useEffect(() => {
    if (!hydrated || !puzzle) return;
    saveGame(puzzle.id, { moves, gaveUp });
  }, [hydrated, puzzle, moves, gaveUp]);

  useEffect(() => {
    if (!pack || !puzzle || !played || !played.ok) {
      setNearestHit(null);
      return;
    }
    if (played.equationWords.length === 0) return;
    const start = rowFor(pack, puzzle.start);
    if (!start) return;
    const anchors = [{ word: puzzle.start, vector: start }];
    for (const word of played.equationWords) {
      const vector = rowFor(pack, word);
      if (vector) anchors.push({ word, vector });
    }
    const key = positionKey(puzzle.id, moves);
    const generation = scanGeneration.current + 1;
    scanGeneration.current = generation;
    nearestLabels(
      pack,
      played.position,
      anchors,
      puzzle.goal,
      LABEL_NEAR_DUPLICATE_CUTOFF,
      played.similarity,
      LABEL_WARM_SIMILARITY,
    )
      .then((words) => {
        if (scanGeneration.current !== generation) return;
        setNearestHit({ key, words });
      })
      .catch(() => {
        if (scanGeneration.current !== generation) return;
        setNearestHit({ key, words: [] });
      });
  }, [pack, puzzle, played, moves]);

  const suggestions = useMemo(() => {
    if (!pack || !puzzle || !played || !played.ok) return [];
    const used = new Set<string>([puzzle.start, puzzle.goal, ...played.equationWords]);
    return suggestWords(pack, query, 8).filter((word) => !used.has(word));
  }, [pack, puzzle, played, query]);

  function selectPuzzle(id: string) {
    setPuzzleId(id);
    setMoves([]);
    setGaveUp(false);
    setRevealed(false);
    setMoveError(null);
    setShareNote(null);
    setQuery("");
    setNearestHit(null);
    setFormKey((key) => key + 1);
    saveGame(id, { moves: [], gaveUp: false });
  }

  function resetPuzzle() {
    if (!puzzle) return;
    selectPuzzle(puzzle.id);
  }

  function attempt(move: Move): boolean {
    if (!pack || !puzzle || !played || !played.ok) return false;
    const start = rowFor(pack, puzzle.start);
    const goal = rowFor(pack, puzzle.goal);
    if (!start || !goal) return false;
    const outcome = commitMove(
      {
        start,
        goal,
        startWord: puzzle.start,
        goalWord: puzzle.goal,
        moves,
        vectorFor: (word) => rowFor(pack, word),
        banned: [],
        maxMoves: MAX_MOVES,
      },
      move,
    );
    if (!outcome.ok) {
      setMoveError(describeMoveError(outcome.error));
      return false;
    }
    setMoves(outcome.moves);
    setMoveError(null);
    setShareNote(null);
    return true;
  }

  async function share() {
    if (!puzzle || !played || !played.ok) return;
    const text = shareText({
      start: puzzle.start,
      goal: puzzle.goal,
      movesUsed: played.movesUsed,
      similarity: shownProgress.current,
    });
    try {
      await navigator.clipboard.writeText(text);
      setShareNote(`Copied: ${text}`);
    } catch {
      setShareNote(text);
    }
  }

  function layout(body: ComponentChildren, play = false) {
    return (
      <main class={play ? "page page-play" : "page"}>
        <header class="mast">
          <div class="masthead">
            <h1 class="title">Wordelate</h1>
            <button
              type="button"
              class="admin-toggle"
              aria-expanded={adminOpen}
              aria-controls="admin-panel"
              onClick={() => setAdminOpen((open) => !open)}
            >
              Admin
            </button>
          </div>
          <Admin
            open={adminOpen}
            puzzles={puzzles ?? []}
            currentId={puzzle?.id ?? ""}
            onSelect={selectPuzzle}
            onReset={resetPuzzle}
            onReveal={() => setRevealed(true)}
            onHide={() => setRevealed(false)}
          />
        </header>
        {body}
      </main>
    );
  }

  if (packState.status === "error" || puzzleError) {
    return layout(
      <section class="notice" role="alert">
        <h2>Couldn’t open the game</h2>
        {puzzleError ? <p>{puzzleError}</p> : null}
        {packState.status === "error" ? <p>{packState.message}</p> : null}
        <button type="button" class="action" onClick={() => setLoadAttempt((n) => n + 1)}>
          Try again
        </button>
      </section>,
    );
  }

  if (packState.status !== "ready" || !puzzles || !puzzle || !played) {
    const progress = packState.status === "loading" ? packState.progress : null;
    const ratio = progress?.ratio;
    const percent = ratio == null ? null : Math.round(ratio * 100);
    return layout(
      <section class="notice" aria-busy="true">
        <h2>{progress?.label ?? "Opening the vocabulary"}</h2>
        <div class="meter-track load-track">
          <div
            class={ratio == null ? "meter-fill indeterminate" : "meter-fill"}
            style={{ width: ratio == null ? "40%" : `${Math.round(ratio * 100)}%` }}
          />
        </div>
        <p>{percent == null ? "Working…" : `${percent}%`}</p>
      </section>,
    );
  }

  if (!played.ok) {
    return layout(
      <section class="notice" role="alert">
        <h2>This saved game can’t be replayed</h2>
        <p>{describeMoveError(played.error)}</p>
        <button type="button" class="action" onClick={resetPuzzle}>
          Reset puzzle
        </button>
      </section>,
    );
  }

  const hereKey = positionKey(puzzle.id, moves);
  const atStart = played.equationWords.length === 0;
  const pendingHere = !atStart && nearestHit?.key !== hereKey;
  const scanned = !pendingHere && nearestHit?.key === hereKey ? nearestHit.words : [];
  const hereWord = hereAtPosition({
    startWord: puzzle.start,
    equationWords: played.equationWords,
    nearest: scanned[0] ?? null,
  });
  const settledWord = pendingHere ? null : hereWord;
  const won = countsAsWin({
    similarity: played.similarity,
    hereWord: settledWord,
    goalWord: puzzle.goal,
    movesUsed: played.equationWords.length,
    acceptedWords: puzzle.accepted,
  });
  const steps = appliedSteps(moves);
  const startRow = rowFor(packState.pack, puzzle.start);
  const goalRow = rowFor(packState.pack, puzzle.goal);
  const progress = progressTowardGoal({
    similarity: played.similarity,
    startSimilarity: startRow && goalRow ? cosine(startRow, goalRow) : 0,
    won,
  });
  shownProgress.current = progress;
  const solution = formatEquation(puzzle.start, puzzle.solution);
  const locked = won || gaveUp || played.movesUsed >= MAX_MOVES;

  return layout(
    <article class="stage">
      <div class="stage-graph">
        <h2 class="pair stage-pair">
          <span>{puzzle.start}</span>
          <span class="arrow" aria-hidden="true">
            →
          </span>
          <span class="pair-goal">{puzzle.goal}</span>
        </h2>
        {startRow && goalRow ? (
          <PathView
            pack={packState.pack}
            start={startRow}
            goal={goalRow}
            startWord={puzzle.start}
            goalWord={puzzle.goal}
            steps={steps}
            position={played.position}
            similarity={played.similarity}
            won={won}
          />
        ) : null}
      </div>
      <div class="dock">
        <div class="dock-meta">
          <Equation start={puzzle.start} steps={steps} />
          <StatusBar movesUsed={played.movesUsed} maxMoves={MAX_MOVES} par={puzzle.par} />
        </div>
        <Meter progress={progress} won={won} />
        <MoveForm
          key={formKey}
          suggestions={suggestions}
          error={moveError}
          locked={locked}
          busy={pendingHere && !won}
          canUndo={played.equationWords.length > 0}
          onQuery={setQuery}
          onAdd={(word) => attempt({ op: "+", word })}
          onSubtract={(word) => attempt({ op: "-", word })}
          onUndo={() => {
            attempt({ op: "undo" });
          }}
        />
        <Result
          won={won}
          gaveUp={gaveUp}
          revealed={revealed}
          outOfMoves={played.movesUsed >= MAX_MOVES}
          solution={solution}
          onGiveUp={() => {
            setGaveUp(true);
            setRevealed(true);
          }}
          onShare={() => {
            void share();
          }}
          shareNote={shareNote}
        />
        <HowItWorks />
      </div>
    </article>,
    true,
  );
}
