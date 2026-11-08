// Collects real videos for the game: scrape details first, throw out the ones
// we don't want, and only then download the video files that are left.
// Run with: node --env-file=.env.local scripts/collect.mjs
//
// Pull one creator's most-viewed videos by scanning deep into their profile:
//   node --env-file=.env.local scripts/collect.mjs creators instagram hector.serrrano --depth=200 --max=15
// Only recent posts: --since=2026-07-15. Save everything scanned for analysis: --save-scan=scan.json
// Add specific reels by link, one per line in a text file (they skip the view, language and cap filters):
//   node --env-file=.env.local scripts/collect.mjs creators instagram hector.serrrano --depth=200 --urls=reels.txt
//   node --env-file=.env.local scripts/collect.mjs urls --urls=reels.txt
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
// Optional flags like --depth=200, kept apart from the plain words.
const flags = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, v = 'true'] = a.slice(2).split('=');
    return [k, v];
  }),
);
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// How far back into each creator's profile to look. Each creator's most-viewed videos are kept,
// so a deeper scan finds their real top videos instead of just the latest ones.
const VIDEOS_PER_CREATOR = Number(flags.depth ?? 15);
// Stops one prolific creator from filling the pool. Counts videos already in the pool.
const MAX_PER_CREATOR = Number(flags.max ?? 8);
// Only look at posts after this date (YYYY-MM-DD), for a read on what's trending now.
const SINCE = flags.since;

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
// Sent as a header so the token never shows up in logged URLs.
const AUTH = { authorization: `Bearer ${TOKEN}` };

let spent = 0;

// Optional: "creators" or "brands" collects only that group, "urls" only the --urls file.
const only = args[0];
// Optional second word: "tiktok" or "instagram" collects from only that platform.
const platform = only === 'urls' ? 'instagram' : args[1];
const brands = only === 'creators' || only === 'urls' ? [] : [...BRANDS, ...TOPICS];
// Any handles after that collect only those creators, e.g. "creators instagram bitterbuilds".
const creators =
  only === 'brands' || only === 'urls' ? [] : args.length > 2 ? args.slice(2) : CREATORS;
// Hand-picked Instagram reel links. These skip the view, language and per-creator filters.
const pickedUrls = flags.urls
  ? (await readFile(flags.urls, 'utf8'))
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  : [];
for (const u of pickedUrls.filter((u) => !u.includes('instagram.com'))) {
  console.log(`Skipping ${u}: only Instagram links are supported in --urls`);
}
const igUrls = pickedUrls.filter((u) => u.includes('instagram.com'));

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
  const post = await fetchRetry(`${API}/acts/${actor}/runs`, {
    method: 'POST',
    headers: { ...AUTH, 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!post.ok) throw new Error(`${actor} would not start: ${post.status} ${await post.text()}`);
  let run = (await post.json()).data;
  console.log(`  ${actor} run ${run.id} started`);
  while (run.status === 'READY' || run.status === 'RUNNING') {
    run = (await getJson(`${API}/actor-runs/${run.id}?waitForFinish=20`)).data;
  }
  if (run.status !== 'SUCCEEDED') throw new Error(`${actor} ended as ${run.status}`);
  spent += run.usageTotalUsd ?? 0;
  return getJson(`${API}/datasets/${run.defaultDatasetId}/items`);
}

// A proxy or network hiccup can return an error page instead of JSON, so try again.
async function getJson(url, tries = 5) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetchRetry(url, { headers: AUTH });
      if (res.ok) return await res.json();
      if (i === tries) throw new Error(`${url} answered ${res.status}`);
    } catch (err) {
      if (i === tries) throw err;
    }
    await new Promise((r) => setTimeout(r, 3000 * i));
  }
}

async function download(url, file, audioUrl) {
  // Apify's own file links need the token; Instagram's don't.
  // One video that can't be fetched shouldn't sink the whole run, so skip it.
  const res = await fetchRetry(url, url.startsWith(API) ? { headers: AUTH } : undefined).catch((err) => {
    console.log(`  Could not download ${file}: ${err.cause?.message ?? err.message}`);
  });
  if (!res?.ok) return false;
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
// Creators we named are already known to post in English, so their short captions
// ("do the work") only need to be in the Latin alphabet.
const ENGLISH_WORDS = /\b(the|and|you|your|this|that|for|with|is|it|my|to|of|in|how|what|i)\b/g;
function looksEnglish(caption = '', knownCreator = false) {
  const text = (caption ?? '').toLowerCase().replace(/#\S+/g, '');
  const letters = text.replace(/[^\p{L}]/gu, '');
  const latin = letters.replace(/[^a-z]/g, '');
  if (latin.length < letters.length * 0.9) return false;
  return knownCreator || (text.match(ENGLISH_WORDS) ?? []).length >= 3;
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
    ).sort((a, b) => b.playCount - a.playCount),
    (v) => v.authorMeta.name,
  );
  report(found, keep, (v) => v.input);
  console.log(`TikTok: found ${found.length}, kept ${keep.length} after filtering`);
  if (!keep.length) return [];

  const withFiles = await runActor('clockworks~tiktok-scraper', {
    postURLs: keep.map((v) => v.webVideoUrl),
    shouldDownloadVideos: true,
  });
  const out = [];
  for (const v of withFiles) {
    const id = `tiktok-${v.id}`;
    const fileUrl = v.mediaUrls?.[0];
    if (!fileUrl || !(await download(fileUrl, `${id}.mp4`))) continue;
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

// Reels from the --urls file. The reel scraper takes reel links as well as usernames.
async function collectPicked(known, alreadyKept) {
  if (!igUrls.length) return [];
  const items = await runActor('apify~instagram-reel-scraper', { username: igUrls, resultsLimit: 1 });
  reportTrialFields(items);
  for (const v of items.filter((v) => v.error)) console.log(`  Could not load ${v.inputUrl ?? v.url}: ${v.error}`);
  const taken = new Set(alreadyKept.map((v) => v.shortCode));
  const keep = [];
  for (const v of uniqueBy(items.filter((v) => !v.error), (p) => p.shortCode)) {
    const why = known.has(`instagram-${v.shortCode}`) || taken.has(v.shortCode)
      ? 'already have it'
      : !goodLength(v.videoDuration)
        ? 'too short'
        : !oldEnough(v.timestamp)
          ? `newer than ${MIN_AGE_DAYS} days, views still climbing`
          : v.videoPlayCount === undefined
            ? 'no view count'
            : '';
    console.log(`  ${v.url} (@${v.ownerUsername}, ${v.videoPlayCount ?? '?'} views): ${why ? `skipped, ${why}` : 'kept'}`);
    if (!why) keep.push(v);
  }
  console.log(`Picked reels: ${igUrls.length} links, ${keep.length} kept`);
  return keep;
}

// We don't know if Apify marks trial reels, so print any field that mentions "trial".
function reportTrialFields(items) {
  const seen = new Map();
  const walk = (obj, path, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 3) return;
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (/trial/i.test(k)) seen.set(`${p}=${JSON.stringify(v)}`, (seen.get(`${p}=${JSON.stringify(v)}`) ?? 0) + 1);
      walk(v, p, depth + 1);
    }
  };
  for (const i of items) walk(i, '', 0);
  for (const [field, n] of seen) console.log(`  Trial field: ${field} on ${n} items`);
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
        ...(SINCE && { onlyPostsNewerThan: SINCE }),
      })).filter((v) => !v.error),
    );
  }
  if (flags['save-scan']) await writeFile(flags['save-scan'], JSON.stringify(found, null, 2));
  const named = new Set(creators.map((c) => c.toLowerCase()));
  const keep = capPerCreator(
    uniqueBy(found, (v) => v.shortCode).filter(
      (v) =>
        !known.has(`instagram-${v.shortCode}`) &&
        v.videoUrl &&
        goodLength(v.videoDuration) &&
        v.videoPlayCount >= MIN_VIEWS &&
        looksEnglish(v.caption, named.has(v.ownerUsername?.toLowerCase())) &&
        !BLOCKED.test(`${v.caption} ${v.ownerUsername} ${v.ownerFullName}`) &&
        oldEnough(v.timestamp),
    ).sort((a, b) => b.videoPlayCount - a.videoPlayCount),
    (v) => v.ownerUsername,
  );
  report(found, keep, (v) => v.inputUrl);
  console.log(`Instagram: found ${found.length}, kept ${keep.length} after filtering`);
  reportTrialFields(found);

  const picked = await collectPicked(known, keep);
  const all = [...keep, ...picked];
  if (!all.length) return [];

  // Apify downloads the files and hosts them itself, with sound already joined in.
  // Instagram's own file links expire fast and can be blocked, so they're only a fallback.
  const withFiles = await runActor('apify~instagram-reel-scraper', {
    username: all.map((v) => `https://www.instagram.com/reel/${v.shortCode}/`),
    resultsLimit: 1,
    includeDownloadedVideo: true,
  });
  const hosted = new Map(withFiles.map((v) => [v.shortCode, v.downloadedVideo]));
  const saved = [];
  for (const v of all) {
    const file = `instagram-${v.shortCode}.mp4`;
    const url = hosted.get(v.shortCode);
    if (url ? await download(url, file) : await download(v.videoUrl, file, v.audioUrl)) saved.push(v);
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
// Deleting a video's file drops it from the pool. But if none of the files are here,
// the videos live on R2 only, so keep the whole pool instead of wiping it.
const pool = JSON.parse(await readFile(POOL_FILE, 'utf8'));
const local = pool.filter((v) => existsSync(`public${v.videoUrl}`));
if (!local.length && pool.length) {
  console.log(`No video files in ${VIDEO_DIR}, so keeping all ${pool.length} pool entries as they are.`);
}
const existing = local.length ? local : pool;
const known = new Set(existing.map((v) => v.id));
for (const v of existing) creatorCounts.set(v.handle, (creatorCounts.get(v.handle) ?? 0) + 1);

const added = [
  ...(platform === 'instagram' ? [] : await collectTikTok(known)),
  ...(platform === 'tiktok' ? [] : await collectInstagram(known)),
];
await writeFile(POOL_FILE, JSON.stringify([...existing, ...added], null, 2) + '\n');

console.log(`\nAdded ${added.length} videos. Pool now has ${existing.length + added.length}.`);
console.log(`Apify cost for this run: $${spent.toFixed(2)}`);
