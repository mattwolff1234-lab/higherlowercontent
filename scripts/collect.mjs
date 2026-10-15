// Collects real videos for the game: scrape details first, throw out the ones
// we don't want, and only then download the video files that are left.
// Run with: node --env-file=.env.local scripts/collect.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, renameSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) {
  console.error('APIFY_TOKEN is missing. Paste your Apify token into .env.local first.');
  process.exit(1);
}

// Brands running big UGC campaigns: searched as hashtags on both platforms.
const BRANDS = ['higgsfield', 'openart', 'wisprflow', 'drmelaxin', 'turboai', 'cluely'];
// People growing a personal brand: their own profiles, tried on both platforms.
const CREATORS = [
  'nicktarmo', 'garyvee', 'hormozi', 'codiesanchez', 'danmartell',
  'imangadzhi', 'melrobbins', 'jayshetty', 'mkbhd', 'bitterbuilds', 'minolee.mp4',
];
// The niches the game covers: tech, AI, personal growth and UGC.
const TOPICS = ['techtok', 'aitools', 'selfimprovement', 'personalgrowth', 'ugccreator', 'entrepreneurship'];
const TIKTOKS_PER_BRAND = 10;
const REELS_PER_BRAND = 10;
// Creators post often, so pull more to get past the ones that are too new.
const VIDEOS_PER_CREATOR = 15;
// Stops one prolific creator from filling the pool.
const MAX_PER_CREATOR = 8;

const MIN_SECONDS = 7;
// Longer videos are kept but cut down to this length.
const MAX_SECONDS = 150;
// Viral videos only.
const MIN_VIEWS = 100_000;
// TikTok can pre-filter by likes, so we don't pay for results that would fail MIN_VIEWS anyway.
const MIN_TIKTOK_LIKES = 5000;
// Regional news pages and AI-generated art clips that hashtag searches drag in.
const BLOCKED =
  /india|hindi|bharat|mumbai|delhi|rupee|₹|pakistan|#aiart|#aigenerated|#aivideo|#aifilm|#midjourney|created with @|made with ai|ai generated|headline|breaking|larp|genjutsu|slop|_ai\b|\.ai\b/i;
// Views on newer posts are still climbing, so the count would go stale fast.
const MIN_AGE_DAYS = 14;

const VIDEO_DIR = 'public/videos';
const POOL_FILE = 'data/videos.json';
const API = 'https://api.apify.com/v2';

let spent = 0;

// Optional: "node scripts/collect.mjs creators" or "... brands" collects only that group.
// "node scripts/collect.mjs posts <url> <url> ..." adds those exact posts and skips the filters.
const only = process.argv[2];
const posts = only === 'posts' ? process.argv.slice(3) : [];
// Optional second word: "tiktok" or "instagram" collects from only that platform.
const platform = process.argv[3];
const brands = only === 'creators' || posts.length ? [] : [...BRANDS, ...TOPICS];
// Any handles after that collect only those creators, e.g. "creators instagram bitterbuilds".
const creators =
  only === 'brands' || posts.length ? [] : process.argv.length > 4 ? process.argv.slice(4) : CREATORS;

// Long runs hit the odd dropped connection, so retry a few times before giving up.
async function fetchRetry(url, options, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (i === tries) throw err;
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
}

async function runActor(actor, input) {
  const post = await fetchRetry(`${API}/acts/${actor}/runs?token=${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!post.ok) throw new Error(`${actor} would not start: ${post.status} ${await post.text()}`);
  let run = (await post.json()).data;
  while (run.status === 'READY' || run.status === 'RUNNING') {
    run = (await (await fetchRetry(`${API}/actor-runs/${run.id}?token=${TOKEN}&waitForFinish=60`)).json()).data;
  }
  if (run.status !== 'SUCCEEDED') throw new Error(`${actor} ended as ${run.status}`);
  spent += run.usageTotalUsd ?? 0;
  return (await fetchRetry(`${API}/datasets/${run.defaultDatasetId}/items?token=${TOKEN}`)).json();
}

async function download(url, file, audioUrl) {
  const res = await fetchRetry(url);
  if (!res.ok) return false;
  await writeFile(`${VIDEO_DIR}/${file}`, Buffer.from(await res.arrayBuffer()));
  if (audioUrl && !(await addMissingAudio(`${VIDEO_DIR}/${file}`, audioUrl))) return false;
  trimToMax(`${VIDEO_DIR}/${file}`);
  return true;
}

// Instagram sometimes serves the picture and the sound as separate files, so join them.
async function addMissingAudio(path, audioUrl) {
  const streams = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', path]);
  if (String(streams).trim()) return true;
  const res = await fetchRetry(audioUrl);
  if (!res.ok) return false;
  const audio = `${path}.audio.mp4`;
  const tmp = `${path}.tmp.mp4`;
  await writeFile(audio, Buffer.from(await res.arrayBuffer()));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path, '-i', audio, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-shortest', '-movflags', '+faststart', tmp]);
  renameSync(tmp, path);
  unlinkSync(audio);
  return true;
}

// Uses ffmpeg (must be installed) to cut anything over MAX_SECONDS, without re-encoding.
function trimToMax(path) {
  const seconds = Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]),
  );
  if (seconds <= MAX_SECONDS) return;
  const tmp = `${path}.tmp.mp4`;
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path, '-t', String(MAX_SECONDS), '-c', 'copy', '-movflags', '+faststart', tmp]);
  renameSync(tmp, path);
}

const goodLength = (seconds) => seconds >= MIN_SECONDS;
const oldEnough = (date) => Date.now() - new Date(date).getTime() >= MIN_AGE_DAYS * 86_400_000;
const uniqueBy = (items, key) => [...new Map(items.map((i) => [key(i), i])).values()];

// Instagram doesn't label a post's language, so judge it from the caption.
const ENGLISH_WORDS = /\b(the|and|you|your|this|that|for|with|is|it|my|to|of|in|how|what|i)\b/g;
function looksEnglish(caption = '') {
  const text = caption.toLowerCase().replace(/#\S+/g, '');
  const letters = text.replace(/[^\p{L}]/gu, '');
  const latin = letters.replace(/[^a-z]/g, '');
  return latin.length >= letters.length * 0.9 && (text.match(ENGLISH_WORDS) ?? []).length >= 3;
}

// Counts across both platforms and videos already in the pool.
const creatorCounts = new Map();
function capPerCreator(items, handle) {
  return items.filter((i) => {
    const n = (creatorCounts.get(handle(i)) ?? 0) + 1;
    creatorCounts.set(handle(i), n);
    return n <= MAX_PER_CREATOR;
  });
}

// Shows how many videos each brand or creator produced, before and after filtering.
function report(found, keep, source) {
  const tally = (items) =>
    items.reduce((m, i) => m.set(String(source(i)), (m.get(String(source(i))) ?? 0) + 1), new Map());
  const kept = tally(keep);
  for (const [name, n] of tally(found)) console.log(`  ${name}: found ${n}, kept ${kept.get(name) ?? 0}`);
}

async function collectTikTok(known) {
  const found = [];
  if (brands.length) {
    found.push(
      ...(await runActor('clockworks~tiktok-scraper', {
        hashtags: brands,
        resultsPerPage: TIKTOKS_PER_BRAND,
        leastDiggs: MIN_TIKTOK_LIKES,
      })),
    );
  }
  if (creators.length) {
    found.push(
      ...(await runActor('clockworks~tiktok-scraper', {
        profiles: creators,
        resultsPerPage: VIDEOS_PER_CREATOR,
      })),
    );
  }
  const keep = capPerCreator(
    uniqueBy(found, (v) => v.id).filter(
      (v) =>
        !known.has(`tiktok-${v.id}`) &&
        !v.isSlideshow &&
        goodLength(v.videoMeta?.duration) &&
        v.playCount >= MIN_VIEWS &&
        v.textLanguage === 'en' &&
        !BLOCKED.test(`${v.text} ${v.authorMeta.name} ${v.authorMeta.nickName}`) &&
        oldEnough(v.createTimeISO),
    ),
    (v) => v.authorMeta.name,
  );
  report(found, keep, (v) => v.input);
  console.log(`TikTok: found ${found.length}, kept ${keep.length} after filtering`);
  return saveTikTok(keep.map((v) => v.webVideoUrl));
}

async function saveTikTok(postURLs) {
  if (!postURLs.length) return [];
  const withFiles = await runActor('clockworks~tiktok-scraper', { postURLs, shouldDownloadVideos: true });
  const out = [];
  for (const v of withFiles) {
    const id = `tiktok-${v.id}`;
    const fileUrl = v.mediaUrls?.[0];
    if (!fileUrl || !(await download(`${fileUrl}?token=${TOKEN}`, `${id}.mp4`))) continue;
    out.push({
      id,
      platform: 'tiktok',
      handle: v.authorMeta.name,
      followers: v.authorMeta.fans,
      views: v.playCount,
      videoUrl: `/videos/${id}.mp4`,
      postUrl: v.webVideoUrl,
    });
  }
  console.log(`TikTok: downloaded ${out.length}`);
  return out;
}

async function collectInstagram(known) {
  const found = [];
  if (brands.length) {
    found.push(
      ...(await runActor('apify~instagram-hashtag-scraper', {
        hashtags: brands,
        resultsType: 'reels',
        resultsLimit: REELS_PER_BRAND,
      })),
    );
  }
  if (creators.length) {
    found.push(
      ...(await runActor('apify~instagram-reel-scraper', {
        username: creators,
        resultsLimit: VIDEOS_PER_CREATOR,
      })),
    );
  }
  const keep = capPerCreator(
    uniqueBy(found, (v) => v.shortCode).filter(
      (v) =>
        !known.has(`instagram-${v.shortCode}`) &&
        v.videoUrl &&
        goodLength(v.videoDuration) &&
        v.videoPlayCount >= MIN_VIEWS &&
        looksEnglish(v.caption) &&
        !BLOCKED.test(`${v.caption} ${v.ownerUsername} ${v.ownerFullName}`) &&
        oldEnough(v.timestamp),
    ),
    (v) => v.ownerUsername,
  );
  report(found, keep, (v) => v.inputUrl);
  console.log(`Instagram: found ${found.length}, kept ${keep.length} after filtering`);
  return saveInstagram(keep);
}

async function saveInstagram(keep) {
  if (!keep.length) return [];

  // Instagram's file links expire quickly, so grab the files before the slower follower lookup.
  const saved = [];
  for (const v of keep) {
    if (await download(v.videoUrl, `instagram-${v.shortCode}.mp4`, v.audioUrl)) saved.push(v);
  }

  const profiles = await runActor('apify~instagram-profile-scraper', {
    usernames: [...new Set(saved.map((v) => v.ownerUsername))],
  });
  const followers = new Map(profiles.map((p) => [p.username, p.followersCount]));
  const out = saved
    .filter((v) => followers.get(v.ownerUsername) !== undefined)
    .map((v) => ({
      id: `instagram-${v.shortCode}`,
      platform: 'instagram',
      handle: v.ownerUsername,
      followers: followers.get(v.ownerUsername),
      views: v.videoPlayCount,
      videoUrl: `/videos/instagram-${v.shortCode}.mp4`,
      postUrl: v.url,
    }));
  console.log(`Instagram: downloaded ${out.length}`);
  return out;
}

await mkdir(VIDEO_DIR, { recursive: true });
const existing = JSON.parse(await readFile(POOL_FILE, 'utf8')).filter((v) =>
  existsSync(`public${v.videoUrl}`),
);
const known = new Set(existing.map((v) => v.id));
for (const v of existing) creatorCounts.set(v.handle, (creatorCounts.get(v.handle) ?? 0) + 1);

const isTikTok = (url) => /tiktok\.com/.test(url);
const added = posts.length
  ? [
      ...(await saveTikTok(posts.filter(isTikTok))),
      ...(await saveInstagram(
        posts.some((url) => !isTikTok(url))
          ? await runActor('apify~instagram-scraper', {
              directUrls: posts.filter((url) => !isTikTok(url)),
              resultsType: 'posts',
            }).then((items) => items.filter((v) => v.videoUrl))
          : [],
      )),
    ].filter((v) => !known.has(v.id))
  : [
      ...(platform === 'instagram' ? [] : await collectTikTok(known)),
      ...(platform === 'tiktok' ? [] : await collectInstagram(known)),
    ];
await writeFile(POOL_FILE, JSON.stringify([...existing, ...added], null, 2) + '\n');

console.log(`\nAdded ${added.length} videos. Pool now has ${existing.length + added.length}.`);
console.log(`Apify cost for this run: $${spent.toFixed(2)}`);
