import videos from "@/data/videos.json";

export type Platform = "tiktok" | "instagram";

type Video = {
  id: string;
  platform: Platform;
  handle: string;
  followers: number;
  views: number;
  videoUrl: string;
  postUrl?: string;
};

export type PublicVideo = Omit<Video, "views" | "postUrl">;
export type Side = "a" | "b";
export type Pair = Record<Side, PublicVideo>;
export type Reveal = {
  views: Record<Side, number>;
  postUrls: Record<Side, string | undefined>;
  winner: Side;
};

const pool = videos as Video[];

// Pairs closer than this are coin flips, so they're never served.
const MIN_RATIO = 1.5;
// A big follower gap gives the answer away, so the two creators must be a similar size.
const MAX_FOLLOWER_RATIO = 5;

const ratio = (x: number, y: number) => Math.max(x, y, 1) / Math.max(Math.min(x, y), 1);

const farApart = (a: Video, b: Video) =>
  a.handle !== b.handle &&
  ratio(a.views, b.views) >= MIN_RATIO &&
  ratio(a.followers, b.followers) <= MAX_FOLLOWER_RATIO;

function toPublic(video: Video): PublicVideo {
  const { id, platform, handle, followers, videoUrl } = video;
  return { id, platform, handle, followers, videoUrl };
}

function shuffle<T>(items: T[]) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function findPair(candidates: Video[]): Pair | undefined {
  const shuffled = shuffle(candidates);
  for (const a of shuffled) {
    const b = shuffled.find((v) => v !== a && farApart(a, v));
    if (b) return { a: toPublic(a), b: toPublic(b) };
  }
}

export function pickPair(seen: string[]) {
  const skip = new Set(seen);
  const fresh = findPair(pool.filter((v) => !skip.has(v.id)));
  if (fresh) return { pair: fresh, exhausted: false };
  return { pair: findPair(pool)!, exhausted: true };
}

export function reveal(aId: string, bId: string): Reveal | undefined {
  const a = pool.find((v) => v.id === aId);
  const b = pool.find((v) => v.id === bId);
  if (!a || !b) return;
  return {
    views: { a: a.views, b: b.views },
    postUrls: { a: a.postUrl, b: b.postUrl },
    winner: a.views > b.views ? "a" : "b",
  };
}
