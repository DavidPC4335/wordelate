import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Move } from "@wordelate/game-math";
import { cosine, replay } from "@wordelate/game-math";
import { Admin } from "./components/admin.js";
import { BoardDialog } from "./components/board-dialog.js";
import type { BoardDay } from "./components/board-dialog.js";
import { Equation } from "./components/equation.js";
import { HowToPlay } from "./components/how-to-play.js";
import { Meter } from "./components/meter.js";
import { MoveForm } from "./components/move-form.js";
import { PathView } from "./components/path-view.js";
import type { GraphShot } from "./components/path-view.js";
import { Result } from "./components/result.js";
import { ShareDialog } from "./components/share-dialog.js";
import { RewardsDialog } from "./components/rewards-dialog.js";
import { StatusBar } from "./components/status-bar.js";
import { TopBar } from "./components/top-bar.js";
import { StandingsView } from "./components/standings-view.js";
import { WinDialog } from "./components/win-dialog.js";
import type { WinReport } from "./components/win-dialog.js";
import { joinBoard, loadBoard, submitName, submitScore } from "./lib/board-api.js";
import { recentDays } from "./lib/standings.js";
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
import { customPuzzle, mergePuzzles, puzzleForDay } from "./lib/puzzles.js";
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
  readLook,
  readScores,
  readStreak,
  recordWin,
  saveGame,
  scoreForMoves,
  streakAsOf,
  syncUnlocked,
  writeHowToSeen,
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
  const [adminOpen, setAdminOpen] = useState(false);
  const [archiveDay, setArchiveDay] = useState<string | null>(null);
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
  const [shareDraft, setShareDraft] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [formKey, setFormKey] = useState(0);
  const [scoreLog, setScoreLog] = useState<ScoreEntry[]>(() => readScores());
  const [streakState, setStreakState] = useState<StreakState>(() => readStreak());
  const scanGeneration = useRef(0);
  const shownProgress = useRef(0);
  const graphShot = useRef<(() => GraphShot | null) | null>(null);
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
        const pick = puzzleForDay(list, calendarDay(new Date())) ?? first;
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
    const movesUsed = played.scoredSteps.length;
    if (movesUsed < 1 || played.equationWords.length < 1) return;
    armedPuzzle.current = null;
    const todayKey = calendarDay(new Date());
    const todayPuzzle = puzzles ? puzzleForDay(puzzles, todayKey) : null;
    const ranked = todayPuzzle != null && puzzle.id === todayPuzzle.id;
    const recorded = ranked
      ? recordWin({ puzzleId: puzzle.id, moves: movesUsed, day: todayKey })
      : null;
    if (recorded) {
      setScoreLog(recorded.scores);
      setStreakState(recorded.streak);
    }
    const scores = recorded?.scores ?? scoreLog;
    const streak = recorded?.streak ?? streakState;
    const stats = currentRewardStats(scores, streak);
    const synced = ranked ? syncUnlocked(stats) : null;
    const newest = synced?.fresh[synced.fresh.length - 1];
    if (newest) writeLook(newest);
    if (synced) setRewards((before) => ({ unlocked: synced.unlocked, look: newest ?? before.look }));
    setWinReport({
      start: puzzle.start,
      goal: puzzle.goal,
      moves: movesUsed,
      par: puzzle.par > 0 ? puzzle.par : null,
      earned: recorded?.earned ?? 0,
      totalPoints: stats.totalPoints,
      streak: streakAsOf(streak, todayKey),
      fresh: synced?.fresh ?? [],
      next: nextReward(stats),
      ranked,
    });
    if (ranked) {
      const generation = boardGeneration.current + 1;
      boardGeneration.current = generation;
      setBoard(null);
      setBoardState("loading");
      void submitScore({ puzzleId: puzzle.id, steps: played.scoredSteps }).then((snapshot) => {
        if (boardGeneration.current !== generation) return;
        setBoard(snapshot);
        setBoardState(snapshot ? "ready" : "error");
      });
    } else if (archiveDay) {
      const generation = boardGeneration.current + 1;
      boardGeneration.current = generation;
      setBoard(null);
      setBoardState("loading");
      void loadBoard(archiveDay).then((snapshot) => {
        if (boardGeneration.current !== generation) return;
        setBoard(snapshot);
        setBoardState(snapshot ? "ready" : "error");
      });
    } else {
      setBoard(null);
      setBoardState("off");
    }
    try {
      navigator.vibrate?.([30, 50, 30]);
    } catch {
      // Vibration is a nicety. Some browsers refuse it.
    }
  }, [archiveDay, gaveUp, hydrated, moves, played, puzzle, puzzles, scoreLog, streakState, won]);

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
    setShareDraft(null);
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

  function playDay(day: string) {
    if (!puzzles) return;
    const todayKey = calendarDay(new Date());
    const scheduled = puzzleForDay(puzzles, day);
    if (!scheduled) return;
    setCustom(null);
    setArchiveDay(day === todayKey ? null : day);
    startBoard(scheduled.id, loadGame(scheduled.id));
    setBoardOpen(false);
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
    setArchiveDay(null);
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
    return true;
  }

  /** Build the default message and open the share menu. */
  function openShare() {
    if (!puzzle || !played || !played.ok) return;
    const used = appliedSteps(moves);
    const today = calendarDay(new Date());
    const todayPuzzle = puzzles ? puzzleForDay(puzzles, today) : null;
    const practice = !todayPuzzle || todayPuzzle.id !== puzzle.id;
    const scored = played.scoredSteps.length;
    setShareDraft(
      shareText({
        day: archiveDay ?? today,
        start: puzzle.start,
        goal: puzzle.goal,
        movesUsed: won ? scored : played.movesUsed,
        similarity: shownProgress.current,
        equation: used.length > 0 ? formatEquation(puzzle.start, used) : "",
        won,
        points: scoreForMoves(scored),
        par: puzzle.par > 0 ? puzzle.par : null,
        streak: streakAsOf(streakState, today),
        practice,
      }),
    );
  }

  const todayKey = calendarDay(new Date());
  const streakCount = streakAsOf(streakState, todayKey);
  const rewardStats = useMemo(() => currentRewardStats(scoreLog, streakState), [scoreLog, streakState]);
  const solvedIds = useMemo(() => new Set(scoreLog.map((entry) => entry.puzzleId)), [scoreLog]);
  const boardDays = useMemo<BoardDay[]>(() => {
    if (!puzzles) return [];
    const days: BoardDay[] = [];
    for (const day of recentDays(todayKey)) {
      const scheduled = puzzleForDay(puzzles, day);
      if (scheduled) days.push({ day, puzzle: scheduled });
    }
    return days;
  }, [puzzles, todayKey]);

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
          onRewards={() => setRewardsOpen(true)}
          onBoard={() => setBoardOpen(true)}
          onHelp={() => setHowToOpen(true)}
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
            setArchiveDay(null);
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
          onAdmin={() => {
            setRewardsOpen(false);
            setAdminOpen(true);
          }}
        />
        <HowToPlay open={howToOpen} onClose={closeHowTo} />
        <BoardDialog
          open={boardOpen}
          onClose={() => setBoardOpen(false)}
          today={todayKey}
          days={boardDays}
          playingDay={archiveDay ?? todayKey}
          onPlay={playDay}
        />
        <WinDialog
          open={winOpen}
          report={winReport}
          board={
            <StandingsView
              snapshot={board}
              state={boardState}
              today={winReport?.ranked !== false}
              onName={
                winReport?.ranked === false
                  ? undefined
                  : async (name) => {
                      const result = await submitName(name);
                      if (result.snapshot) {
                        setBoard(result.snapshot);
                        setBoardState("ready");
                      }
                      return result.error;
                    }
              }
            />
          }
          onShare={() => {
            openShare();
          }}
          onClose={() => setWinOpen(false)}
        />
        <ShareDialog
          open={shareDraft != null}
          text={shareDraft ?? ""}
          capture={() => graphShot.current?.() ?? null}
          onClose={() => setShareDraft(null)}
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
            captureRef={graphShot}
          />
        ) : null}
        <p class="stage-hint">Drag the graph to look around</p>
      </main>
      <section class="dock" aria-label="Your moves">
        <div class="dock-inner" data-stage-overlay>
          {archiveDay ? (
            <p class="practice-banner">
              Practice. This score stays off the board.
              <button type="button" class="text-button" onClick={() => playDay(todayKey)}>
                Back to today
              </button>
            </p>
          ) : null}
          <Equation start={puzzle.start} steps={steps} />
          <Meter key={`${puzzle.id}:${formKey}`} progress={progress} won={won} />
          <StatusBar
            movesUsed={played.movesUsed}
            maxMoves={MAX_MOVES}
            par={puzzle.par > 0 ? puzzle.par : null}
            worth={scoreForMoves(played.movesUsed + 1)}
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
            onGiveUp={() => {
              setGaveUp(true);
              setRevealed(true);
            }}
            onRetry={resetPuzzle}
            onShare={() => {
              openShare();
            }}
            />
        </div>
      </section>
    </>,
  );
}
