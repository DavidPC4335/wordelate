import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Move } from "@wordelate/game-math";
import { cosine, replay } from "@wordelate/game-math";
import { Admin } from "./components/admin.js";
import { BoardDialog } from "./components/board-dialog.js";
import { Equation } from "./components/equation.js";
import { HowToPlay } from "./components/how-to-play.js";
import { Meter } from "./components/meter.js";
import { MoveForm } from "./components/move-form.js";
import { PathView } from "./components/path-view.js";
import { Result } from "./components/result.js";
import { RewardsDialog } from "./components/rewards-dialog.js";
import { StatusBar } from "./components/status-bar.js";
import { TopBar } from "./components/top-bar.js";
import { StandingsView } from "./components/standings-view.js";
import { WinDialog } from "./components/win-dialog.js";
import type { WinReport } from "./components/win-dialog.js";
import { joinBoard, submitName, submitScore } from "./lib/board-api.js";
import type { BoardSnapshot } from "./lib/standings.js";
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
import { closestWord, loadPack, nearestLabels, rowFor } from "./lib/pack.js";
import type { Pack, PackProgress } from "./lib/pack.js";
import { customPuzzle, mergePuzzles } from "./lib/puzzles.js";
import type { Puzzle } from "./lib/puzzles.js";
import { COSMETICS, nextReward } from "./lib/rewards.js";
import type { CosmeticId } from "./lib/rewards.js";
import {
  calendarDay,
  currentRewardStats,
  getPlayerId,
  hasGameHistory,
  loadGame,
  readHowToSeen,
  readLastPuzzle,
  readLook,
  readScores,
  readStreak,
  recordWin,
  saveGame,
  scoreForMoves,
  streakAsOf,
  syncUnlocked,
  totalScore,
  writeHowToSeen,
  writeLastPuzzle,
  unlockAllLooks,
  writeLook,
} from "./lib/storage.js";
import type { SavedGame, ScoreEntry, StreakState } from "./lib/storage.js";

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

/** Looks already earned, including ones earned before looks existed. */
function initialRewards(): { unlocked: CosmeticId[]; look: CosmeticId } {
  const { unlocked } = syncUnlocked(currentRewardStats(readScores(), readStreak()));
  return { unlocked, look: readLook(unlocked) };
}

export function App() {
  const [packState, setPackState] = useState<PackState>({
    status: "loading",
    progress: { ratio: 0, label: "Fetching vocabulary" },
  });
  const [puzzleError, setPuzzleError] = useState<string | null>(null);
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null);
  const [puzzleId, setPuzzleId] = useState<string | null>(null);
  const [custom, setCustom] = useState<Puzzle | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [gaveUp, setGaveUp] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [adminOpen, setAdminOpen] = useState(
    () => new URLSearchParams(window.location.search).get("admin") === "1",
  );
  // The tutorial greets a brand-new player once. Closing it, or playing, ends the greeting.
  const [howToOpen, setHowToOpen] = useState(() => !hasGameHistory() && !readHowToSeen());
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [rewards, setRewards] = useState(initialRewards);
  const [winReport, setWinReport] = useState<WinReport | null>(null);
  const [winOpen, setWinOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [board, setBoard] = useState<BoardSnapshot | null>(null);
  const [boardState, setBoardState] = useState<"loading" | "ready" | "off" | "error">("off");
  const [moveError, setMoveError] = useState<string | null>(null);
  const [nearestHit, setNearestHit] = useState<NearestHit | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [formKey, setFormKey] = useState(0);
  const [scoreLog, setScoreLog] = useState<ScoreEntry[]>(() => readScores());
  const [streakState, setStreakState] = useState<StreakState>(() => readStreak());
  const scanGeneration = useRef(0);
  const shownProgress = useRef(0);
  // A win only scores when the player made a move on this puzzle in this session.
  // A board that was already won when it was opened never scores again.
  const armedPuzzle = useRef<string | null>(null);
  const boardGeneration = useRef(0);

  useEffect(() => {
    getPlayerId();
    void joinBoard();
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
        // Pick up where the player left off, else the first puzzle they have not solved.
        const solved = new Set(readScores().map((entry) => entry.puzzleId));
        const remembered = readLastPuzzle();
        const pick =
          list.find((item) => item.id === remembered) ??
          list.find((item) => !solved.has(item.id)) ??
          first;
        const saved = loadGame(pick.id);
        setPuzzles(list);
        setPuzzleId(pick.id);
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

  const listed = puzzles?.find((item) => item.id === puzzleId) ?? null;
  const puzzle = custom && custom.id === puzzleId ? custom : listed;
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
    if (hydrated && puzzleId && !custom) writeLastPuzzle(puzzleId);
  }, [custom, hydrated, puzzleId]);

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

  const hereKey = puzzle ? positionKey(puzzle.id, moves) : "";
  const atStart = !played || !played.ok || played.equationWords.length === 0;
  const pendingHere = Boolean(played && played.ok && !atStart && nearestHit?.key !== hereKey);
  const scanned = !pendingHere && nearestHit?.key === hereKey ? nearestHit.words : [];
  const hereWord =
    played && played.ok && puzzle
      ? hereAtPosition({
          startWord: puzzle.start,
          equationWords: played.equationWords,
          nearest: scanned[0] ?? null,
        })
      : null;
  const settledWord = pendingHere ? null : hereWord;
  const won = Boolean(
    played &&
      played.ok &&
      puzzle &&
      countsAsWin({
        similarity: played.similarity,
        hereWord: settledWord,
        goalWord: puzzle.goal,
        movesUsed: played.equationWords.length,
        acceptedWords: puzzle.accepted,
      }),
  );

  useEffect(() => {
    if (!hydrated || !puzzle || !played || !played.ok || !won || gaveUp) return;
    if (armedPuzzle.current !== puzzle.id) return;
    const movesUsed = played.equationWords.length;
    if (movesUsed < 1) return;
    armedPuzzle.current = null;
    const recorded = recordWin({
      puzzleId: puzzle.id,
      moves: movesUsed,
      day: calendarDay(new Date()),
    });
    setScoreLog(recorded.scores);
    setStreakState(recorded.streak);
    const stats = { totalPoints: totalScore(recorded.scores), bestStreak: recorded.bestStreak };
    const synced = syncUnlocked(stats);
    const newest = synced.fresh[synced.fresh.length - 1];
    // A new look goes on straight away, so the graph itself is the surprise.
    if (newest) writeLook(newest);
    setRewards((before) => ({ unlocked: synced.unlocked, look: newest ?? before.look }));
    setWinReport({
      start: puzzle.start,
      goal: puzzle.goal,
      moves: movesUsed,
      par: puzzle.par > 0 ? puzzle.par : null,
      earned: recorded.earned,
      totalPoints: stats.totalPoints,
      streak: recorded.streak.count,
      fresh: synced.fresh,
      next: nextReward(stats),
    });
    if (puzzle.id.startsWith("custom-")) {
      setBoard(null);
      setBoardState("off");
    } else {
      const generation = boardGeneration.current + 1;
      boardGeneration.current = generation;
      setBoard(null);
      setBoardState("loading");
      const steps = appliedSteps(moves);
      void submitScore({ puzzleId: puzzle.id, steps }).then((snapshot) => {
        if (boardGeneration.current !== generation) return;
        setBoard(snapshot);
        setBoardState(snapshot ? "ready" : "error");
      });
    }
    try {
      navigator.vibrate?.([30, 50, 30]);
    } catch {
      // Vibration is a nicety. Some browsers refuse it.
    }
  }, [gaveUp, hydrated, moves, played, puzzle, won]);

  // Let the graph's own sparkle play for a moment before the results card opens.
  useEffect(() => {
    if (!winReport) {
      setWinOpen(false);
      return;
    }
    const timer = window.setTimeout(() => setWinOpen(true), 1250);
    return () => window.clearTimeout(timer);
  }, [winReport]);

  /** One place that puts the board into a known state, so no stale result leaks across puzzles. */
  function startBoard(id: string, saved: SavedGame | null) {
    armedPuzzle.current = null;
    setPuzzleId(id);
    setMoves(saved?.moves ?? []);
    setGaveUp(saved?.gaveUp ?? false);
    setRevealed(false);
    setMoveError(null);
    setShareNote(null);
    setNearestHit(null);
    setWinReport(null);
    setWinOpen(false);
    setFormKey((key) => key + 1);
  }

  /** Open a puzzle from the list. Earlier progress on it comes back. */
  function openPuzzle(id: string) {
    setCustom(null);
    startBoard(id, loadGame(id));
  }

  /** Wipe a puzzle and start it over. */
  function selectPuzzle(id: string) {
    setCustom(null);
    saveGame(id, { moves: [], gaveUp: false });
    startBoard(id, null);
  }

  function resetPuzzle() {
    if (!puzzle) return;
    saveGame(puzzle.id, { moves: [], gaveUp: false });
    startBoard(puzzle.id, null);
  }

  function playPair(startRaw: string, goalRaw: string): string | null {
    if (!pack || !puzzles) return "Vocabulary is still loading.";
    const start = closestWord(pack, startRaw);
    const goal = closestWord(pack, goalRaw);
    if (!start || !goal) return "Type a start word and a goal word from the vocabulary.";
    const existing = puzzles.find((item) => item.start === start && item.goal === goal);
    if (existing) {
      selectPuzzle(existing.id);
    } else {
      const made = customPuzzle(start, goal);
      setCustom(made);
      saveGame(made.id, { moves: [], gaveUp: false });
      startBoard(made.id, null);
    }
    setAdminOpen(false);
    return null;
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
    armedPuzzle.current = puzzle.id;
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

  const streakCount = streakAsOf(streakState, calendarDay(new Date()));
  const rewardStats = useMemo(() => currentRewardStats(scoreLog, streakState), [scoreLog, streakState]);
  const solvedIds = useMemo(() => new Set(scoreLog.map((entry) => entry.puzzleId)), [scoreLog]);

  /** The next puzzle in list order that is not solved yet. Falls back to simply the next one. */
  function nextPuzzleId(): string | null {
    if (!puzzles || puzzles.length === 0) return null;
    const at = puzzles.findIndex((item) => item.id === puzzleId);
    for (let step = 1; step <= puzzles.length; step++) {
      const candidate = puzzles[(Math.max(at, -1) + step) % puzzles.length];
      if (candidate && candidate.id !== puzzleId && !solvedIds.has(candidate.id)) return candidate.id;
    }
    const plain = puzzles[(Math.max(at, -1) + 1) % puzzles.length];
    return plain && plain.id !== puzzleId ? plain.id : null;
  }

  function playNext() {
    const id = nextPuzzleId();
    if (id) openPuzzle(id);
  }

  function closeHowTo() {
    setHowToOpen(false);
    writeHowToSeen();
  }

  function layout(body: ComponentChildren) {
    return (
      <div class="app">
        <TopBar
          start={puzzle?.start ?? null}
          goal={puzzle?.goal ?? null}
          streak={streakCount}
          points={rewardStats.totalPoints}
          adminOpen={adminOpen}
          onRewards={() => setRewardsOpen(true)}
          onBoard={() => setBoardOpen(true)}
          onHelp={() => setHowToOpen(true)}
          onAdmin={() => setAdminOpen((open) => !open)}
        />
        {body}
        <Admin
          open={adminOpen}
          onClose={() => setAdminOpen(false)}
          puzzles={puzzles ?? []}
          currentId={puzzle?.id ?? ""}
          solvedIds={solvedIds}
          revealed={revealed}
          onSelect={(id) => {
            openPuzzle(id);
            setAdminOpen(false);
          }}
          onReset={() => {
            resetPuzzle();
            setAdminOpen(false);
          }}
          onReveal={() => setRevealed(true)}
          onHide={() => setRevealed(false)}
          onPlay={playPair}
          lockedLooks={COSMETICS.filter((item) => !rewards.unlocked.includes(item.id)).length}
          onUnlockLooks={() => {
            const unlocked = unlockAllLooks();
            setRewards((before) => ({ ...before, unlocked }));
            setAdminOpen(false);
            setRewardsOpen(true);
          }}
        />
        <RewardsDialog
          open={rewardsOpen}
          onClose={() => setRewardsOpen(false)}
          stats={rewardStats}
          streak={streakCount}
          scores={scoreLog}
          unlocked={rewards.unlocked}
          equipped={rewards.look}
          onEquip={(id) => {
            writeLook(id);
            setRewards((before) => ({ ...before, look: id }));
          }}
        />
        <HowToPlay open={howToOpen} onClose={closeHowTo} />
        <BoardDialog open={boardOpen} onClose={() => setBoardOpen(false)} />
        <WinDialog
          open={winOpen}
          report={winReport}
          hasNext={nextPuzzleId() !== null}
          shareNote={shareNote}
          board={
            <StandingsView
              snapshot={board}
              state={boardState}
              onName={async (name) => {
                const result = await submitName(name);
                if (result.snapshot) {
                  setBoard(result.snapshot);
                  setBoardState("ready");
                }
                return result.error;
              }}
            />
          }
          onNext={playNext}
          onShare={() => {
            void share();
          }}
          onClose={() => setWinOpen(false)}
        />
      </div>
    );
  }

  if (packState.status === "error" || puzzleError) {
    return layout(
      <main class="notice-wrap">
        <section class="notice" role="alert">
          <h2>Couldn’t open the game</h2>
          {puzzleError ? <p>{puzzleError}</p> : null}
          {packState.status === "error" ? <p>{packState.message}</p> : null}
          <button type="button" class="btn btn-go" onClick={() => setLoadAttempt((n) => n + 1)}>
            Try again
          </button>
        </section>
      </main>,
    );
  }

  if (packState.status !== "ready" || !puzzles || !puzzle || !played) {
    const progress = packState.status === "loading" ? packState.progress : null;
    const ratio = progress?.ratio;
    const percent = ratio == null ? null : Math.round(ratio * 100);
    return layout(
      <main class="notice-wrap">
        <section class="notice" aria-busy="true">
          <h2>{progress?.label ?? "Opening the vocabulary"}</h2>
          <div class="meter-track load-track">
            <div
              class={ratio == null ? "meter-fill indeterminate" : "meter-fill"}
              style={{ width: ratio == null ? "40%" : `${Math.round(ratio * 100)}%` }}
            />
          </div>
          <p>{percent == null ? "Warming up the words…" : `${percent}%`}</p>
        </section>
      </main>,
    );
  }

  if (!played.ok) {
    return layout(
      <main class="notice-wrap">
        <section class="notice" role="alert">
          <h2>This saved game can’t be replayed</h2>
          <p>{describeMoveError(played.error)}</p>
          <button type="button" class="btn btn-go" onClick={resetPuzzle}>
            Reset puzzle
          </button>
        </section>
      </main>,
    );
  }

  const steps = appliedSteps(moves);
  const startRow = rowFor(packState.pack, puzzle.start);
  const goalRow = rowFor(packState.pack, puzzle.goal);
  const progress = progressTowardGoal({
    similarity: played.similarity,
    startSimilarity: startRow && goalRow ? cosine(startRow, goalRow) : 0,
    won,
  });
  shownProgress.current = progress;
  const solution = puzzle.solution.length > 0 ? formatEquation(puzzle.start, puzzle.solution) : null;
  const outOfMoves = played.movesUsed >= MAX_MOVES;
  const locked = won || gaveUp || outOfMoves;

  return layout(
    <>
      <main class="stage">
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
            lookId={rewards.look}
          />
        ) : null}
        <p class="stage-hint">Drag the graph to look around</p>
      </main>
      <section class="dock" aria-label="Your moves">
        <div class="dock-inner" data-stage-overlay>
          <Equation start={puzzle.start} steps={steps} />
          <Meter key={`${puzzle.id}:${formKey}`} progress={progress} won={won} />
          <StatusBar
            movesUsed={played.movesUsed}
            maxMoves={MAX_MOVES}
            par={puzzle.par > 0 ? puzzle.par : null}
            worth={scoreForMoves(steps.length + 1)}
          />
          <MoveForm
            key={formKey}
            error={moveError}
            locked={locked}
            busy={pendingHere && !won}
            canUndo={played.equationWords.length > 0}
            resolveWord={(word) => closestWord(packState.pack, word) ?? word}
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
            outOfMoves={outOfMoves}
            solution={solution}
            hasNext={nextPuzzleId() !== null}
            onGiveUp={() => {
              setGaveUp(true);
              setRevealed(true);
            }}
            onNext={playNext}
            onRetry={resetPuzzle}
            onShare={() => {
              void share();
            }}
            shareNote={shareNote}
          />
        </div>
      </section>
    </>,
  );
}
