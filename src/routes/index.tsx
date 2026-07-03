import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  component: MathChallengePage,
  head: () => ({
    meta: [
      { title: "Math Challenge — Beat the Clock" },
      {
        name: "description",
        content:
          "Fast, colorful mental math quiz. Pick a difficulty, race the timer, keep your streak, and top the high score board.",
      },
    ],
  }),
});

/* ---------------- Types & constants ---------------- */

type Difficulty = "easy" | "medium" | "hard";
type Op = "+" | "-" | "×" | "÷";
type Screen = "home" | "playing" | "gameover";

interface Question {
  a: number;
  b: number;
  op: Op;
  answer: number;
  text: string;
}

interface GameStats {
  score: number;
  correct: number;
  wrong: number;
  bestStreak: number;
  streak: number;
  totalRespMs: number;
  fastestMs: number | null;
  answered: number;
}

interface HighScoreData {
  high: number;
  bestAccuracy: number;
  gamesPlayed: number;
}

const HS_KEY = "mathChallenge:highscore:v1";
const THEME_KEY = "mathChallenge:theme";
const MUTE_KEY = "mathChallenge:muted";
const DEFAULT_ROUND_SECONDS = 30;
const MAX_ROUND_SECONDS = 300; // 5 minutes
const MIN_ROUND_SECONDS = 10;
const TIME_PRESETS: { label: string; value: number }[] = [
  { label: "30s", value: 30 },
  { label: "1m", value: 60 },
  { label: "2m", value: 120 },
  { label: "3m", value: 180 },
  { label: "5m", value: 300 },
];
const BONUS_WINDOW_MS = 3000;

const QUOTES = [
  "Excellent! 🔥",
  "Keep Going!",
  "You're Fast! ⚡",
  "Math Master! 🧠",
  "Unstoppable!",
  "Sharp as ever!",
];

/* ---------------- Utilities ---------------- */

const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

function generateQuestion(diff: Difficulty): Question {
  let op: Op;
  let a = 0;
  let b = 0;
  let answer = 0;

  if (diff === "easy") {
    op = Math.random() < 0.5 ? "+" : "-";
    a = rand(1, 20);
    b = rand(1, 20);
    if (op === "-" && b > a) [a, b] = [b, a];
    answer = op === "+" ? a + b : a - b;
  } else if (diff === "medium") {
    const ops: Op[] = ["+", "-", "×"];
    op = ops[rand(0, 2)];
    if (op === "×") {
      a = rand(2, 12);
      b = rand(2, 12);
      answer = a * b;
    } else {
      a = rand(1, 50);
      b = rand(1, 50);
      if (op === "-" && b > a) [a, b] = [b, a];
      answer = op === "+" ? a + b : a - b;
    }
  } else {
    const ops: Op[] = ["+", "-", "×", "÷"];
    op = ops[rand(0, 3)];
    if (op === "÷") {
      b = rand(2, 12);
      answer = rand(2, 12);
      a = b * answer;
    } else if (op === "×") {
      a = rand(2, 15);
      b = rand(2, 15);
      answer = a * b;
    } else {
      a = rand(1, 100);
      b = rand(1, 100);
      if (op === "-" && b > a) [a, b] = [b, a];
      answer = op === "+" ? a + b : a - b;
    }
  }

  return { a, b, op, answer, text: `${a} ${op} ${b}` };
}

function getBadge(score: number): { name: string; emoji: string } | null {
  if (score >= 300) return { name: "Math Champion", emoji: "🏆" };
  if (score >= 200) return { name: "Gold Solver", emoji: "🥇" };
  if (score >= 120) return { name: "Silver Solver", emoji: "🥈" };
  if (score >= 60) return { name: "Bronze Solver", emoji: "🥉" };
  return null;
}

/* ---------------- Sound (WebAudio, no assets) ---------------- */

function useSounds(muted: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);

  const getCtx = () => {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return null;
      ctxRef.current = new AC();
    }
    return ctxRef.current;
  };

  const beep = useCallback(
    (freq: number, duration = 0.12, type: OscillatorType = "sine", gain = 0.08) => {
      if (muted) return;
      const ctx = getCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.value = gain;
      osc.connect(g).connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    },
    [muted],
  );

  return useMemo(
    () => ({
      click: () => beep(520, 0.05, "square", 0.05),
      correct: () => {
        beep(660, 0.09, "triangle", 0.08);
        setTimeout(() => beep(880, 0.11, "triangle", 0.08), 90);
      },
      wrong: () => beep(180, 0.22, "sawtooth", 0.06),
      gameover: () => {
        beep(440, 0.15, "sine", 0.07);
        setTimeout(() => beep(330, 0.18, "sine", 0.07), 140);
        setTimeout(() => beep(220, 0.25, "sine", 0.07), 320);
      },
    }),
    [beep],
  );
}

/* ---------------- Confetti ---------------- */

function Confetti({ active }: { active: boolean }) {
  if (!active) return null;
  const pieces = Array.from({ length: 80 });
  const colors = ["#7c3aed", "#3b82f6", "#22c55e", "#f97316", "#ef4444", "#eab308"];
  return (
    <>
      {pieces.map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.6;
        const dur = 2 + Math.random() * 2;
        const color = colors[i % colors.length];
        return (
          <span
            key={i}
            className="mc-confetti-piece"
            style={{
              left: `${left}%`,
              backgroundColor: color,
              animationDelay: `${delay}s`,
              animationDuration: `${dur}s`,
              transform: `rotate(${Math.random() * 360}deg)`,
            }}
          />
        );
      })}
    </>
  );
}

/* ---------------- High score storage ---------------- */

function loadHigh(): HighScoreData {
  if (typeof window === "undefined")
    return { high: 0, bestAccuracy: 0, gamesPlayed: 0 };
  try {
    const raw = window.localStorage.getItem(HS_KEY);
    if (!raw) return { high: 0, bestAccuracy: 0, gamesPlayed: 0 };
    const p = JSON.parse(raw) as Partial<HighScoreData>;
    return {
      high: p.high ?? 0,
      bestAccuracy: p.bestAccuracy ?? 0,
      gamesPlayed: p.gamesPlayed ?? 0,
    };
  } catch {
    return { high: 0, bestAccuracy: 0, gamesPlayed: 0 };
  }
}

function saveHigh(data: HighScoreData) {
  try {
    window.localStorage.setItem(HS_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

/* ---------------- Main component ---------------- */

function MathChallengePage() {
  const [screen, setScreen] = useState<Screen>("home");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [roundSeconds, setRoundSeconds] = useState<number>(DEFAULT_ROUND_SECONDS);
  const [dark, setDark] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [highData, setHighData] = useState<HighScoreData>({
    high: 0,
    bestAccuracy: 0,
    gamesPlayed: 0,
  });

  const sounds = useSounds(muted);

  /* Init theme, mute, high scores */
  useEffect(() => {
    setHighData(loadHigh());
    const t = window.localStorage.getItem(THEME_KEY);
    const prefersDark =
      t === "dark" ||
      (t === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDark(prefersDark);
    const m = window.localStorage.getItem(MUTE_KEY);
    if (m === "1") setMuted(true);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      window.localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }, [dark]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [muted]);

  /* Game state */
  const [timeLeft, setTimeLeft] = useState(DEFAULT_ROUND_SECONDS);
  const [lives, setLives] = useState(3);
  const [question, setQuestion] = useState<Question | null>(null);
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [popKey, setPopKey] = useState(0);
  const [quote, setQuote] = useState<string | null>(null);
  const [stats, setStats] = useState<GameStats>({
    score: 0,
    correct: 0,
    wrong: 0,
    bestStreak: 0,
    streak: 0,
    totalRespMs: 0,
    fastestMs: null,
    answered: 0,
  });
  const [confetti, setConfetti] = useState(false);
  const [newHigh, setNewHigh] = useState(false);
  const questionStartRef = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);

  /* Timer */
  useEffect(() => {
    if (screen !== "playing") return;
    if (timeLeft <= 0) {
      endGame();
      return;
    }
    const id = window.setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, screen]);

  /* Auto-focus input */
  useEffect(() => {
    if (screen === "playing") inputRef.current?.focus();
  }, [screen, question]);

  const startGame = () => {
    sounds.click();
    setStats({
      score: 0,
      correct: 0,
      wrong: 0,
      bestStreak: 0,
      streak: 0,
      totalRespMs: 0,
      fastestMs: null,
      answered: 0,
    });
    setTimeLeft(roundSeconds);
    setLives(3);
    setInput("");
    setFeedback(null);
    setQuote(null);
    setConfetti(false);
    setNewHigh(false);
    const q = generateQuestion(difficulty);
    setQuestion(q);
    questionStartRef.current = performance.now();
    setScreen("playing");
  };

  const nextQuestion = useCallback(() => {
    const q = generateQuestion(difficulty);
    setQuestion(q);
    setInput("");
    questionStartRef.current = performance.now();
  }, [difficulty]);

  const endGame = useCallback(() => {
    sounds.gameover();
    setScreen("gameover");
    setStats((prev) => {
      const accuracy =
        prev.answered > 0 ? Math.round((prev.correct / prev.answered) * 100) : 0;
      const nextHigh: HighScoreData = {
        high: Math.max(highData.high, prev.score),
        bestAccuracy: Math.max(highData.bestAccuracy, accuracy),
        gamesPlayed: highData.gamesPlayed + 1,
      };
      const isNewHigh = prev.score > highData.high && prev.score > 0;
      saveHigh(nextHigh);
      setHighData(nextHigh);
      if (isNewHigh) {
        setNewHigh(true);
        setConfetti(true);
        window.setTimeout(() => setConfetti(false), 4200);
      }
      return prev;
    });
  }, [highData, sounds]);

  const submitAnswer = () => {
    if (!question || screen !== "playing") return;
    if (input.trim() === "") return;
    const val = Number(input);
    if (Number.isNaN(val)) return;

    const elapsed = performance.now() - questionStartRef.current;
    const isCorrect = val === question.answer;

    setPopKey((k) => k + 1);

    if (isCorrect) {
      sounds.correct();
      const bonus = elapsed <= BONUS_WINDOW_MS ? 5 : 0;
      setFeedback("correct");
      setStats((s) => {
        const nextStreak = s.streak + 1;
        const nextCorrect = s.correct + 1;
        const newStats: GameStats = {
          ...s,
          score: s.score + 10 + bonus,
          correct: nextCorrect,
          streak: nextStreak,
          bestStreak: Math.max(s.bestStreak, nextStreak),
          totalRespMs: s.totalRespMs + elapsed,
          fastestMs:
            s.fastestMs === null ? elapsed : Math.min(s.fastestMs, elapsed),
          answered: s.answered + 1,
        };
        if (nextCorrect > 0 && nextCorrect % 5 === 0) {
          setQuote(QUOTES[Math.floor(Math.random() * QUOTES.length)]);
          window.setTimeout(() => setQuote(null), 1600);
        }
        return newStats;
      });
    } else {
      sounds.wrong();
      setFeedback("wrong");
      setLives((l) => {
        const nl = l - 1;
        if (nl <= 0) {
          window.setTimeout(() => endGame(), 250);
        }
        return nl;
      });
      setStats((s) => ({
        ...s,
        wrong: s.wrong + 1,
        streak: 0,
        totalRespMs: s.totalRespMs + elapsed,
        answered: s.answered + 1,
      }));
    }

    window.setTimeout(() => setFeedback(null), 500);
    window.setTimeout(() => nextQuestion(), 220);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") submitAnswer();
  };

  const accuracy =
    stats.answered > 0 ? Math.round((stats.correct / stats.answered) * 100) : 0;
  const avgMs = stats.answered > 0 ? Math.round(stats.totalRespMs / stats.answered) : 0;
  const badge = getBadge(stats.score);

  /* ---------------- Render ---------------- */

  return (
    <main className="min-h-screen mc-gradient-bg text-foreground">
      <Confetti active={confetti} />

      {/* Top bar */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-white shadow-lg">
            <span className="text-lg font-bold">∑</span>
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-wide text-muted-foreground">
              MATH
            </div>
            <div className="-mt-1 text-lg font-extrabold">Challenge</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              sounds.click();
              setMuted((m) => !m);
            }}
            className="mc-chip grid h-10 w-10 place-items-center rounded-xl transition hover:scale-105"
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <button
            onClick={() => {
              sounds.click();
              setDark((d) => !d);
            }}
            className="mc-chip grid h-10 w-10 place-items-center rounded-xl transition hover:scale-105"
            aria-label="Toggle theme"
          >
            {dark ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-5 pb-16">
        {screen === "home" && (
          <HomeScreen
            difficulty={difficulty}
            setDifficulty={(d) => {
              sounds.click();
              setDifficulty(d);
            }}
            roundSeconds={roundSeconds}
            setRoundSeconds={(s) => {
              sounds.click();
              const clamped = Math.max(
                MIN_ROUND_SECONDS,
                Math.min(MAX_ROUND_SECONDS, Math.round(s)),
              );
              setRoundSeconds(clamped);
            }}
            onStart={startGame}
            highData={highData}
            onInstructions={() => {
              sounds.click();
              setShowInstructions(true);
            }}
          />
        )}

        {screen === "playing" && question && (
          <PlayScreen
            question={question}
            input={input}
            setInput={setInput}
            onKeyDown={onKeyDown}
            onSubmit={submitAnswer}
            timeLeft={timeLeft}
            lives={lives}
            stats={stats}
            accuracy={accuracy}
            feedback={feedback}
            popKey={popKey}
            quote={quote}
            inputRef={inputRef}
            difficulty={difficulty}
          />
        )}

        {screen === "gameover" && (
          <GameOverScreen
            stats={stats}
            accuracy={accuracy}
            avgMs={avgMs}
            highData={highData}
            newHigh={newHigh}
            badge={badge}
            onPlayAgain={startGame}
            onHome={() => {
              sounds.click();
              setScreen("home");
            }}
          />
        )}
      </section>

      {showInstructions && (
        <InstructionsModal onClose={() => setShowInstructions(false)} />
      )}
    </main>
  );
}

/* ---------------- Subcomponents ---------------- */

function HomeScreen({
  difficulty,
  setDifficulty,
  roundSeconds,
  setRoundSeconds,
  onStart,
  highData,
  onInstructions,
}: {
  difficulty: Difficulty;
  setDifficulty: (d: Difficulty) => void;
  roundSeconds: number;
  setRoundSeconds: (s: number) => void;
  onStart: () => void;
  highData: HighScoreData;
  onInstructions: () => void;
}) {
  const diffs: { key: Difficulty; label: string; hint: string }[] = [
    { key: "easy", label: "Easy", hint: "+ − · 1–20" },
    { key: "medium", label: "Medium", hint: "+ − × · 1–50" },
    { key: "hard", label: "Hard", hint: "+ − × ÷ · 1–100" },
  ];

  const formatDuration = (s: number) => {
    if (s < 60) return `${s} seconds`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem === 0 ? `${m} minute${m > 1 ? "s" : ""}` : `${m}m ${rem}s`;
  };

  return (
    <div className="mc-card mc-pop mt-4 rounded-3xl p-8 sm:p-10">
      <h1 className="text-center text-4xl font-extrabold tracking-tight sm:text-5xl">
        Beat the{" "}
        <span className="bg-gradient-to-r from-violet-500 via-blue-500 to-emerald-500 bg-clip-text text-transparent">
          Clock
        </span>
      </h1>
      <p className="mx-auto mt-3 max-w-md text-center text-sm text-muted-foreground sm:text-base">
        Solve as many problems as you can before time runs out. Fast answers
        score bonus points.
      </p>

      {/* Difficulty */}
      <div className="mt-8">
        <div className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Difficulty
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {diffs.map((d) => {
            const active = difficulty === d.key;
            return (
              <button
                key={d.key}
                onClick={() => setDifficulty(d.key)}
                className={`rounded-2xl border p-3 text-center transition ${
                  active
                    ? "border-transparent bg-gradient-to-br from-violet-500 to-blue-500 text-white shadow-lg"
                    : "mc-chip hover:scale-[1.02]"
                }`}
              >
                <div className="text-base font-bold">{d.label}</div>
                <div
                  className={`mt-1 text-[11px] ${active ? "text-white/85" : "text-muted-foreground"}`}
                >
                  {d.hint}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Time selector */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Round Time
          </div>
          <div className="text-xs font-bold">{formatDuration(roundSeconds)}</div>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {TIME_PRESETS.map((p) => {
            const active = roundSeconds === p.value;
            return (
              <button
                key={p.value}
                onClick={() => setRoundSeconds(p.value)}
                className={`rounded-xl border py-2 text-sm font-bold transition ${
                  active
                    ? "border-transparent bg-gradient-to-br from-violet-500 to-blue-500 text-white shadow"
                    : "mc-chip hover:scale-[1.02]"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <input
            type="range"
            min={MIN_ROUND_SECONDS}
            max={MAX_ROUND_SECONDS}
            step={5}
            value={roundSeconds}
            onChange={(e) => setRoundSeconds(Number(e.target.value))}
            className="mc-range w-full accent-violet-500"
            aria-label="Round time in seconds"
          />
          <span className="w-16 text-right text-xs font-semibold text-muted-foreground">
            max 5m
          </span>
        </div>
      </div>

      {/* Start */}
      <div className="mt-8 flex flex-col items-center gap-3">
        <button
          onClick={onStart}
          className="mc-btn-primary w-full max-w-xs rounded-2xl px-8 py-4 text-lg font-bold"
        >
          Start Game
        </button>
        <button
          onClick={onInstructions}
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
        >
          How to play
        </button>
      </div>

      {/* High score summary */}
      <div className="mt-8 grid grid-cols-3 gap-2 sm:gap-3">
        <StatTile label="High Score" value={highData.high.toString()} />
        <StatTile label="Best Accuracy" value={`${highData.bestAccuracy}%`} />
        <StatTile label="Games Played" value={highData.gamesPlayed.toString()} />
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="mc-chip rounded-2xl p-3 text-center">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-extrabold">{value}</div>
    </div>
  );
}

function PlayScreen({
  question,
  input,
  setInput,
  onKeyDown,
  onSubmit,
  timeLeft,
  lives,
  stats,
  accuracy,
  feedback,
  popKey,
  quote,
  inputRef,
  difficulty,
}: {
  question: Question;
  input: string;
  setInput: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
  timeLeft: number;
  lives: number;
  stats: GameStats;
  accuracy: number;
  feedback: "correct" | "wrong" | null;
  popKey: number;
  quote: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  difficulty: Difficulty;
}) {
  const urgent = timeLeft <= 10;
  return (
    <div className="mt-4 space-y-4">
      {/* HUD */}
      <div className="mc-card grid grid-cols-4 gap-2 rounded-2xl p-3 sm:gap-3 sm:p-4">
        <HudItem label="Score" value={stats.score} pulseKey={popKey} />
        <HudItem
          label="Time"
          value={`${timeLeft}s`}
          className={urgent ? "mc-pulse-timer" : ""}
        />
        <HudItem label="Solved" value={stats.correct} />
        <HudItem label="Accuracy" value={`${accuracy}%`} />
      </div>

      {/* Question card */}
      <div
        key={question.text}
        className={`mc-card mc-pop relative overflow-hidden rounded-3xl p-8 text-center sm:p-12 ${
          feedback === "correct"
            ? "mc-flash-correct"
            : feedback === "wrong"
              ? "mc-flash-wrong mc-shake"
              : ""
        }`}
      >
        <div className="mb-3 flex items-center justify-center gap-2">
          <span className="mc-chip rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {difficulty}
          </span>
          <span className="mc-chip rounded-full px-3 py-1 text-xs font-semibold text-muted-foreground">
            Streak · {stats.streak}
          </span>
        </div>
        <div className="text-5xl font-extrabold tracking-tight sm:text-7xl">
          {question.text} = <span className="text-muted-foreground">?</span>
        </div>

        <div className="mx-auto mt-8 flex max-w-sm gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value.replace(/[^\d-]/g, ""))}
            onKeyDown={onKeyDown}
            inputMode="numeric"
            autoComplete="off"
            placeholder="Your answer"
            className="w-full rounded-2xl border border-border bg-background/70 px-5 py-4 text-center text-2xl font-bold outline-none ring-0 transition focus:border-transparent focus:ring-4 focus:ring-violet-400/40"
          />
          <button
            onClick={onSubmit}
            className="mc-btn-primary rounded-2xl px-6 text-base font-bold"
          >
            Go
          </button>
        </div>

        {quote && (
          <div className="mc-pop pointer-events-none absolute inset-x-0 bottom-4 text-center text-lg font-bold text-emerald-500">
            {quote}
          </div>
        )}
      </div>

      {/* Lives */}
      <div className="mc-card flex items-center justify-between rounded-2xl px-4 py-3">
        <div className="text-sm font-semibold text-muted-foreground">Lives</div>
        <div className="text-2xl tracking-widest">
          {Array.from({ length: 3 }).map((_, i) => (
            <span key={i} className={i < lives ? "" : "opacity-20 grayscale"}>
              ❤️
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function HudItem({
  label,
  value,
  className,
  pulseKey,
}: {
  label: string;
  value: string | number;
  className?: string;
  pulseKey?: number;
}) {
  return (
    <div className="rounded-xl bg-background/40 px-2 py-2 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div
        key={pulseKey}
        className={`mt-0.5 text-lg font-extrabold sm:text-xl ${pulseKey !== undefined ? "mc-pop" : ""} ${className ?? ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function GameOverScreen({
  stats,
  accuracy,
  avgMs,
  highData,
  newHigh,
  badge,
  onPlayAgain,
  onHome,
}: {
  stats: GameStats;
  accuracy: number;
  avgMs: number;
  highData: HighScoreData;
  newHigh: boolean;
  badge: { name: string; emoji: string } | null;
  onPlayAgain: () => void;
  onHome: () => void;
}) {
  return (
    <div className="mc-card mc-pop mt-4 rounded-3xl p-8 sm:p-10">
      <div className="text-center">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Game Over
        </div>
        <div className="mt-1 text-5xl font-extrabold sm:text-6xl">
          {stats.score}
        </div>
        <div className="mt-1 text-sm text-muted-foreground">Final Score</div>

        {newHigh && (
          <div className="mc-pop mx-auto mt-3 inline-block rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-1 text-sm font-bold text-white shadow-lg">
            ⭐ New High Score!
          </div>
        )}

        {badge && (
          <div className="mc-chip mx-auto mt-3 inline-flex items-center gap-2 rounded-full px-4 py-1 text-sm font-semibold">
            <span className="text-lg">{badge.emoji}</span>
            {badge.name}
          </div>
        )}
      </div>

      <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        <StatTile label="Accuracy" value={`${accuracy}%`} />
        <StatTile label="Correct" value={stats.correct.toString()} />
        <StatTile label="Wrong" value={stats.wrong.toString()} />
        <StatTile label="Best Streak" value={stats.bestStreak.toString()} />
        <StatTile
          label="Avg Time"
          value={stats.answered ? `${(avgMs / 1000).toFixed(1)}s` : "—"}
        />
        <StatTile
          label="Fastest"
          value={stats.fastestMs ? `${(stats.fastestMs / 1000).toFixed(2)}s` : "—"}
        />
      </div>

      <div className="mc-chip mt-4 flex items-center justify-between rounded-2xl px-4 py-3 text-sm">
        <span className="text-muted-foreground">High Score</span>
        <span className="font-extrabold">{highData.high}</span>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          onClick={onHome}
          className="mc-chip rounded-2xl px-6 py-3 text-sm font-bold transition hover:scale-[1.02]"
        >
          Return Home
        </button>
        <button
          onClick={onPlayAgain}
          className="mc-btn-primary rounded-2xl px-6 py-3 text-sm font-bold"
        >
          Play Again
        </button>
      </div>
    </div>
  );
}

function InstructionsModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mc-card mc-pop w-full max-w-md rounded-3xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-2xl font-extrabold">How to play</h2>
        <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
          <li>• Solve the equation and press Enter or Go.</li>
          <li>• +10 for a correct answer, +5 bonus if under 3 seconds.</li>
          <li>• Pick your round time (up to 5 minutes) and 3 lives — a wrong answer costs one.</li>
          <li>• Streaks unlock motivational boosts. Score high, earn badges.</li>
        </ul>
        <button
          onClick={onClose}
          className="mc-btn-primary mt-6 w-full rounded-2xl px-6 py-3 text-sm font-bold"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
