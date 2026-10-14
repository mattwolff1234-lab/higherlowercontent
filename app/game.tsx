"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Pair, PublicVideo, Reveal, Side } from "@/lib/pool";
import { FUNNEL_STREAK, SIDESHIFT_URL, SITE_NAME } from "@/lib/site";
import Shell from "./shell";
import {
  ArrowOutIcon,
  EyeIcon,
  GamesIcon,
  HashIcon,
  InstagramIcon,
  SparkIcon,
  TargetIcon,
  TikTokIcon,
  TrophyIcon,
} from "./icons";

const BEST_KEY = "best-streak";

function subscribeBest(onChange: () => void) {
  window.addEventListener(BEST_KEY, onChange);
  return () => window.removeEventListener(BEST_KEY, onChange);
}

const readBest = () => Number(localStorage.getItem(BEST_KEY) ?? 0);

function saveBest(streak: number) {
  localStorage.setItem(BEST_KEY, String(streak));
  window.dispatchEvent(new Event(BEST_KEY));
}

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const PLATFORM = {
  tiktok: { label: "TikTok", Icon: TikTokIcon },
  instagram: { label: "Reel", Icon: InstagramIcon },
};

const SIDES: Side[] = ["a", "b"];
const other = (side: Side): Side => (side === "a" ? "b" : "a");

// Each video gets at most this long before the other one takes over.
const CLIP_SECONDS = 15;
// How far a card leans toward the mouse, in degrees.
const MAX_TILT = 10;

export default function Game() {
  const [pair, setPair] = useState<Pair | null>(null);
  const [result, setResult] = useState<Reveal | null>(null);
  const [picked, setPicked] = useState<Side | null>(null);
  const [streak, setStreak] = useState(0);
  // Only one video plays at a time, with sound; the other waits paused.
  const [active, setActive] = useState<Side>("a");
  // Browsers block sound until the page has been tapped or a key pressed.
  const [soundAllowed, setSoundAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [funnelOpen, setFunnelOpen] = useState(false);
  const [stats, setStats] = useState({ rounds: 0, correct: 0, games: 1 });
  const seen = useRef<string[]>([]);
  const best = useSyncExternalStore(subscribeBest, readBest, () => 0);

  const nextRound = useCallback(async () => {
    const res = await fetch("/api/round", {
      method: "POST",
      body: JSON.stringify({ seen: seen.current }),
    });
    const data: { pair: Pair; exhausted: boolean } = await res.json();
    if (data.exhausted) seen.current = [];
    seen.current.push(data.pair.a.id, data.pair.b.id);
    setPair(data.pair);
    setActive("a");
    setResult(null);
    setPicked(null);
    setBusy(false);
  }, []);

  useEffect(() => {
    nextRound();
  }, [nextRound]);

  useEffect(() => {
    const allowSound = () => setSoundAllowed(true);
    window.addEventListener("pointerdown", allowSound, { once: true });
    window.addEventListener("keydown", allowSound, { once: true });
    return () => {
      window.removeEventListener("pointerdown", allowSound);
      window.removeEventListener("keydown", allowSound);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (funnelOpen) {
        if (e.key === "Escape") setFunnelOpen(false);
        return;
      }
      if (e.code !== "Space") return;
      // Stop the space bar from also pressing whichever button has focus.
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      if (!e.repeat) setActive(other);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [funnelOpen]);

  async function guess(side: Side) {
    if (!pair || picked) return;
    setPicked(side);
    const res = await fetch("/api/guess", {
      method: "POST",
      body: JSON.stringify({ a: pair.a.id, b: pair.b.id }),
    });
    const revealed: Reveal = await res.json();
    setResult(revealed);
    const right = side === revealed.winner;
    setStats((s) => ({ ...s, rounds: s.rounds + 1, correct: s.correct + (right ? 1 : 0) }));
    if (right) {
      const now = streak + 1;
      setStreak(now);
      if (now > best) saveBest(now);
      if (now === FUNNEL_STREAK + 1) setFunnelOpen(true);
    }
  }

  function next() {
    setBusy(true);
    nextRound();
  }

  function playAgain() {
    setStreak(0);
    setCopied(false);
    setPair(null);
    setStats((s) => ({ ...s, games: s.games + 1 }));
    nextRound();
  }

  async function share() {
    const text = `I got a streak of ${streak} on ${SITE_NAME}. Can you beat it?`;
    const url = window.location.origin;
    if (navigator.share) {
      await navigator.share({ text, url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
    }
  }

  const correct = result !== null && picked === result.winner;
  const over = result !== null && !correct;
  const accuracy = stats.rounds ? `${Math.round((stats.correct / stats.rounds) * 100)}%` : "—";

  return (
    <Shell active="play">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#7070701f] px-4 py-3 md:px-6 md:py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight md:text-xl">Higher or Lower</h1>
          <p className="hidden text-sm text-neutral-500 sm:block">
            Guess which UGC video has more views
          </p>
        </div>
        <p className="panel shrink-0 px-3 py-1.5 text-sm tabular-nums text-neutral-500 lg:hidden">
          Streak <span className="font-semibold text-neutral-900">{streak}</span>
          <span className="mx-2 text-neutral-300">|</span>
          Best <span className="font-semibold text-neutral-900">{best}</span>
        </p>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col md:flex-row md:items-center md:justify-center md:gap-16">
            {pair ? (
              <>
                {SIDES.map((side) => (
                  <Card
                    key={pair[side].id}
                    video={pair[side]}
                    views={result?.views[side]}
                    postUrl={result?.postUrls[side]}
                    isWinner={result?.winner === side}
                    isPicked={picked === side}
                    locked={picked !== null}
                    playing={active === side && !funnelOpen}
                    soundAllowed={soundAllowed}
                    floatDelay={side === "a" ? "0s" : "-3s"}
                    onTap={() => setActive(active === side ? other(side) : side)}
                    onEnded={() => setActive(other(side))}
                    onPick={() => guess(side)}
                  />
                ))}
                <div className="metal pointer-events-none absolute left-1/2 top-1/2 z-10 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center !rounded-full text-xs font-black">
                  <span className="metal-text">VS</span>
                </div>
              </>
            ) : (
              <p className="m-auto text-sm text-neutral-400">Loading videos...</p>
            )}
          </div>

          <footer className="flex h-20 shrink-0 items-center justify-center px-4">
            <div className="panel flex min-h-12 items-center gap-2.5 px-4 py-2 text-sm">
              {!result && (
                <p className="text-center text-neutral-500">
                  Which one has more views? Tap a video or press space to switch.
                </p>
              )}
              {correct && (
                <>
                  <p className="font-semibold text-emerald-600">Correct!</p>
                  <button onClick={next} disabled={busy} className="metal h-9 px-5 font-semibold">
                    <span className="metal-text">Next</span>
                  </button>
                </>
              )}
              {over && (
                <>
                  <p className="font-semibold text-rose-600">
                    Game over{" "}
                    <span className="hidden font-normal text-neutral-500 sm:inline">
                      at a streak of {streak}
                    </span>
                  </p>
                  <button onClick={share} className={`metal-light h-9 px-4 font-semibold ${streak > FUNNEL_STREAK ? "hidden sm:block" : ""}`}>
                    {copied ? "Copied" : "Share"}
                  </button>
                  {streak > FUNNEL_STREAK && (
                    <a
                      href={SIDESHIFT_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="metal-light inline-flex h-9 items-center px-4 font-semibold"
                    >
                      <span className="sm:hidden">SideShift</span>
                      <span className="hidden sm:inline">Earn on SideShift</span>
                    </a>
                  )}
                  <button onClick={playAgain} className="metal h-9 px-5 font-semibold">
                    <span className="metal-text">Play again</span>
                  </button>
                </>
              )}
            </div>
          </footer>
        </section>

        <aside className="hidden w-[320px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-[#7070701f] p-5 lg:flex">
          <StreakCard streak={streak} best={best} />
          <div className="grid grid-cols-2 gap-3">
            <StatTile icon={<TrophyIcon />} label="Best streak" value={best} />
            <StatTile icon={<HashIcon />} label="Rounds" value={stats.rounds} />
            <StatTile icon={<TargetIcon />} label="Accuracy" value={accuracy} />
            <StatTile icon={<GamesIcon />} label="Games" value={stats.games} />
          </div>
        </aside>
      </div>

      {funnelOpen && <Funnel streak={streak} onClose={() => setFunnelOpen(false)} />}
    </Shell>
  );
}

function StreakCard({ streak, best }: { streak: number; best: number }) {
  const unlocked = streak > FUNNEL_STREAK;
  return (
    <div className="metal-blue p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-white/90">Current streak</p>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/40 bg-white/15">
          <TrophyIcon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="-mt-1 text-5xl font-bold tracking-tight tabular-nums">
        {streak}
        <span className="ml-2 text-sm font-medium text-white/80">best {best}</span>
      </p>
      <p className="mt-2 text-sm leading-snug text-white/85">
        {unlocked
          ? "Unlocked: brands on SideShift pay creators to make UGC like this."
          : `Beat ${FUNNEL_STREAK} in a row to unlock your SideShift invite.`}
      </p>
      {unlocked ? (
        <a
          href={SIDESHIFT_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-neutral-900 transition hover:bg-white/90"
        >
          <SparkIcon className="h-4 w-4" />
          Start earning on SideShift
        </a>
      ) : (
        <div className="mt-4 flex gap-1.5">
          {Array.from({ length: FUNNEL_STREAK + 1 }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${i < streak ? "bg-white" : "bg-white/30"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="panel flex items-center gap-3 p-3">
      <span className="metal-light flex h-10 w-10 shrink-0 items-center justify-center">{icon}</span>
      <div className="min-w-0">
        <p className="whitespace-nowrap text-xs text-neutral-500">{label}</p>
        <p className="text-lg font-bold tabular-nums leading-tight">{value}</p>
      </div>
    </div>
  );
}

function Funnel({ streak, onClose }: { streak: number; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="funnel-title"
        className="metal-blue pop-in w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="flex items-center gap-1.5 text-sm font-medium text-white/90">
          <SparkIcon className="h-4 w-4" />
          SideShift invite unlocked
        </p>
        <h2 id="funnel-title" className="mt-3 text-2xl font-bold leading-tight tracking-tight">
          {streak} in a row. You&apos;ve got an eye for content.
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/85">
          Put it to the test on SideShift, where brands pay creators to make UGC. Turn your
          sense for what goes viral into paid work.
        </p>
        <a
          href={SIDESHIFT_URL}
          target="_blank"
          rel="noreferrer"
          onClick={onClose}
          className="mt-5 flex h-11 items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-neutral-900 transition hover:bg-white/90"
        >
          Start earning on SideShift
          <ArrowOutIcon className="h-4 w-4" />
        </a>
        <button
          onClick={onClose}
          className="mt-2 h-10 w-full rounded-xl text-sm font-medium text-white/85 transition hover:bg-white/10 hover:text-white"
        >
          Keep playing
        </button>
      </div>
    </div>
  );
}

function Card({
  video,
  views,
  postUrl,
  isWinner,
  isPicked,
  locked,
  playing,
  soundAllowed,
  floatDelay,
  onTap,
  onEnded,
  onPick,
}: {
  video: PublicVideo;
  views: number | undefined;
  postUrl: string | undefined;
  isWinner: boolean;
  isPicked: boolean;
  locked: boolean;
  playing: boolean;
  soundAllowed: boolean;
  floatDelay: string;
  onTap: () => void;
  onEnded: () => void;
  onPick: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const revealed = views !== undefined;
  const platform = PLATFORM[video.platform];

  useEffect(() => {
    const el = videoRef.current!;
    if (!playing) {
      el.pause();
      return;
    }
    el.muted = !soundAllowed;
    // Some browsers (mostly iPhone) still refuse sound here, so fall back to playing muted.
    el.play().catch(() => {
      el.muted = true;
      el.play().catch(() => {});
    });
  }, [playing, soundAllowed]);

  function handleTime() {
    const el = videoRef.current!;
    const clip = Math.min(CLIP_SECONDS, el.duration || CLIP_SECONDS);
    setProgress(Math.min(el.currentTime / clip, 1));
    if (el.currentTime >= CLIP_SECONDS) {
      el.currentTime = 0;
      onEnded();
    }
  }

  function tilt(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse") return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width - 0.5;
    const y = (e.clientY - box.top) / box.height - 0.5;
    tiltRef.current!.style.transform = `rotateX(${-y * MAX_TILT * 2}deg) rotateY(${x * MAX_TILT * 2}deg)`;
  }

  function untilt() {
    tiltRef.current!.style.transform = "";
  }

  let ring = "ring-transparent";
  if (revealed && isWinner) ring = "ring-emerald-500";
  else if (revealed && isPicked) ring = "ring-rose-500";

  return (
    <section className="flex min-h-0 flex-1 items-center gap-4 px-4 py-3 md:flex-none md:flex-col md:gap-7 md:p-0">
      <div className="card-in h-full shrink-0 md:h-[min(46vh,470px)]" style={{ perspective: "1000px" }}>
        <div className="card-float h-full" style={{ animationDelay: floatDelay }}>
          <div
            ref={tiltRef}
            onPointerMove={tilt}
            onPointerLeave={untilt}
            className={`relative aspect-[9/16] h-full overflow-hidden rounded-2xl bg-neutral-900 shadow-[16px_24px_36px_-8px_rgba(0,0,0,0.32)] ring-4 transition-transform duration-200 ease-out md:rounded-[20px] md:shadow-[30px_42px_56px_-12px_rgba(0,0,0,0.32)] ${ring}`}
          >
            <video
              ref={videoRef}
              src={video.videoUrl}
              muted
              playsInline
              preload="auto"
              onClick={onTap}
              onEnded={onEnded}
              onTimeUpdate={handleTime}
              className="h-full w-full cursor-pointer object-cover"
            />
            {playing ? (
              <>
                <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 p-1.5">
                  <SpeakerIcon on={soundAllowed} />
                </div>
                <div className="pointer-events-none absolute inset-x-3 bottom-3 h-1 overflow-hidden rounded-full bg-white/30">
                  <div
                    className="h-full rounded-full bg-white transition-[width] duration-300 ease-linear"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              </>
            ) : (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="rounded-full bg-white/90 p-3 md:p-4">
                  <PlayIcon />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="panel flex min-w-0 flex-1 flex-col gap-3 p-3 md:w-[260px] md:flex-none md:p-4">
        <div className="flex items-center gap-3">
          <span className="metal-light flex h-10 w-10 shrink-0 items-center justify-center">
            <platform.Icon />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs text-neutral-500">
              @{video.handle} · {platform.label}
            </p>
            <p className="text-lg font-bold leading-tight tabular-nums md:text-xl">
              {compact.format(video.followers)}{" "}
              <span className="text-sm font-normal text-neutral-500">followers</span>
            </p>
          </div>
        </div>

        {revealed ? (
          <div>
            <p
              className={`text-2xl font-bold tabular-nums leading-tight md:text-3xl ${
                isWinner ? "text-emerald-600" : "text-neutral-400"
              }`}
            >
              <CountUp value={views} />{" "}
              <span className="text-sm font-normal text-neutral-500">views</span>
            </p>
            {postUrl && (
              <a
                href={postUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
              >
                See original post
                <ArrowOutIcon className="h-3 w-3" />
              </a>
            )}
          </div>
        ) : (
          <button
            onClick={onPick}
            disabled={locked}
            className="metal inline-flex h-10 w-full items-center justify-center gap-2 text-sm font-semibold"
          >
            <EyeIcon className="h-4 w-4" />
            <span className="metal-text">More views</span>
          </button>
        )}
      </div>
    </section>
  );
}

function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min((now - start) / 900, 1);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return compact.format(shown);
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-black md:h-6 md:w-6" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 fill-none stroke-white"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6 9H2v6h4l5 4z" className="fill-white" />
      {on ? (
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
      ) : (
        <path d="m16 9 6 6m0-6-6 6" />
      )}
    </svg>
  );
}
