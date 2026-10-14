"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Pair, PublicVideo, Reveal, Side } from "@/lib/pool";
import { SITE_NAME } from "@/lib/site";

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
  tiktok: { label: "TikTok", className: "bg-cyan-100 text-cyan-800" },
  instagram: { label: "Reel", className: "bg-pink-100 text-pink-700" },
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
      if (e.code !== "Space") return;
      // Stop the space bar from also pressing whichever button has focus.
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      if (!e.repeat) setActive(other);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function guess(side: Side) {
    if (!pair || picked) return;
    setPicked(side);
    const res = await fetch("/api/guess", {
      method: "POST",
      body: JSON.stringify({ a: pair.a.id, b: pair.b.id }),
    });
    const revealed: Reveal = await res.json();
    setResult(revealed);
    if (side === revealed.winner) {
      setStreak(streak + 1);
      if (streak + 1 > best) saveBest(streak + 1);
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

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-between px-4 md:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold tracking-tight">{SITE_NAME}</h1>
          <Link href="/about" className="text-xs text-neutral-400 hover:text-neutral-900">
            About
          </Link>
        </div>
        <p className="text-sm tabular-nums text-neutral-500">
          Streak <span className="font-semibold text-neutral-900">{streak}</span>
          <span className="mx-2 text-neutral-300">|</span>
          Best <span className="font-semibold text-neutral-900">{best}</span>
        </p>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row md:items-center md:justify-center md:gap-24">
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
                playing={active === side}
                soundAllowed={soundAllowed}
                floatDelay={side === "a" ? "0s" : "-3s"}
                onTap={() => setActive(active === side ? other(side) : side)}
                onEnded={() => setActive(other(side))}
                onPick={() => guess(side)}
              />
            ))}
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-neutral-900 text-xs font-black text-white shadow-lg">
              VS
            </div>
          </>
        ) : (
          <p className="m-auto text-sm text-neutral-400">Loading videos...</p>
        )}
      </div>

      <footer className="flex h-20 shrink-0 items-center justify-center px-4">
        <div className="flex min-h-12 items-center gap-3 rounded-2xl bg-white px-4 py-2 text-sm shadow-[0_8px_30px_rgba(0,0,0,0.12)] ring-1 ring-black/5">
          {!result && (
            <p className="text-center text-neutral-500">
              Which one has more views? Tap a video or press space to switch.
            </p>
          )}
          {correct && (
            <>
              <p className="font-semibold text-emerald-600">Correct!</p>
              <button
                onClick={next}
                disabled={busy}
                className="rounded-full bg-neutral-900 px-6 py-2 font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                Next
              </button>
            </>
          )}
          {over && (
            <>
              <p className="font-semibold text-rose-600">
                Game over <span className="hidden text-neutral-500 sm:inline">at a streak of {streak}</span>
              </p>
              <button
                onClick={share}
                className="rounded-full border border-neutral-200 px-4 py-2 font-semibold hover:bg-neutral-100"
              >
                {copied ? "Copied" : "Share"}
              </button>
              <button
                onClick={playAgain}
                className="rounded-full bg-neutral-900 px-5 py-2 font-semibold text-white hover:bg-neutral-700"
              >
                Play again
              </button>
            </>
          )}
        </div>
      </footer>
    </main>
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
    <section className="flex min-h-0 flex-1 items-center gap-5 px-4 py-3 md:flex-none md:flex-col md:gap-8 md:p-0">
      <div className="card-in h-full shrink-0 md:h-[min(58vh,560px)]" style={{ perspective: "1000px" }}>
        <div className="card-float h-full" style={{ animationDelay: floatDelay }}>
          <div
            ref={tiltRef}
            onPointerMove={tilt}
            onPointerLeave={untilt}
            className={`relative aspect-[9/16] h-full overflow-hidden rounded-2xl bg-neutral-900 shadow-[18px_28px_40px_-8px_rgba(0,0,0,0.35)] ring-4 transition-transform duration-200 ease-out md:rounded-[22px] md:shadow-[34px_48px_60px_-12px_rgba(0,0,0,0.35)] ${ring}`}
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

      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 md:flex-none md:items-center">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${platform.className}`}>
          {platform.label}
        </span>
        <p className="max-w-full truncate text-sm text-neutral-500">@{video.handle}</p>
        <p className="text-xl font-bold leading-tight md:text-2xl">
          {compact.format(video.followers)}{" "}
          <span className="text-sm font-normal text-neutral-500">followers</span>
        </p>

        {revealed ? (
          <div className="mt-2 flex flex-col items-start md:items-center">
            <p
              className={`text-2xl font-black tabular-nums md:text-3xl ${
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
                className="text-xs text-neutral-500 underline hover:text-neutral-900"
              >
                See original post
              </a>
            )}
          </div>
        ) : (
          <button
            onClick={onPick}
            disabled={locked}
            className="mt-2 rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            More views
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
