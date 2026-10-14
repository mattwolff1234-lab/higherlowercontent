// Step 0 proof test: scrape 20 videos per platform and check we get
// view count, follower count and a downloadable video file.
// Run with: node --env-file=.env.local scripts/proof-test.mjs
import { mkdir, writeFile } from 'node:fs/promises';

const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) {
  console.error('APIFY_TOKEN is missing. Paste your Apify token into .env.local first.');
  process.exit(1);
}

const OUT = 'proof-test-output';
const HASHTAG = 'ugc';
const COUNT = 20;

const platforms = [
  {
    name: 'tiktok',
    actor: 'clockworks~tiktok-scraper',
    input: { hashtags: [HASHTAG], resultsPerPage: COUNT, shouldDownloadVideos: true },
    referer: 'https://www.tiktok.com/',
    fields: {
      handle: ['authorMeta.name'],
      views: ['playCount'],
      followers: ['authorMeta.fans'],
      seconds: ['videoMeta.duration'],
      video: ['mediaUrls.0', 'videoMeta.downloadAddr', 'videoMeta.originalDownloadAddr'],
      link: ['webVideoUrl'],
    },
  },
  {
    name: 'instagram',
    actor: 'apify~instagram-hashtag-scraper',
    input: { hashtags: [HASHTAG], resultsType: 'reels', resultsLimit: COUNT },
    referer: 'https://www.instagram.com/',
    fields: {
      handle: ['ownerUsername', 'owner.username'],
      views: ['videoPlayCount', 'videoViewCount', 'playCount', 'viewCount'],
      followers: ['ownerFollowersCount', 'followersCount', 'owner.followersCount', 'owner.edge_followed_by.count'],
      seconds: ['videoDuration', 'duration'],
      video: ['videoUrl', 'downloadedVideo'],
      link: ['url'],
    },
  },
];

const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const pick = (obj, paths) => {
  for (const p of paths) {
    const v = get(obj, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
};

async function scrape(p) {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${p.actor}/run-sync-get-dataset-items?token=${TOKEN}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p.input) },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Apify said ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

async function tryDownload(p, url) {
  const res = await fetch(url, { headers: { referer: p.referer, 'user-agent': 'Mozilla/5.0' } });
  if (!res.ok) return `FAILED (status ${res.status})`;
  const buf = Buffer.from(await res.arrayBuffer());
  const file = `${OUT}/${p.name}-sample.mp4`;
  await writeFile(file, buf);
  return `OK, ${(buf.length / 1e6).toFixed(1)} MB (${res.headers.get('content-type')}) saved to ${file}`;
}

await mkdir(OUT, { recursive: true });

for (const p of platforms) {
  console.log(`\n===== ${p.name.toUpperCase()} =====`);
  try {
    const items = await scrape(p);
    await writeFile(`${OUT}/${p.name}-raw.json`, JSON.stringify(items, null, 2));
    const rows = items.map((it) =>
      Object.fromEntries(Object.entries(p.fields).map(([k, paths]) => [k, pick(it, paths)])),
    );
    console.table(rows.map((r) => ({ ...r, video: r.video ? 'yes' : 'NO', link: undefined })));

    const has = (k) => rows.filter((r) => r[k] !== undefined).length;
    console.log(`videos returned:   ${rows.length}`);
    console.log(`with view count:   ${has('views')}`);
    console.log(`with followers:    ${has('followers')}`);
    console.log(`with video file:   ${has('video')}`);

    const sample = rows.find((r) => r.video);
    if (sample) {
      console.log(`sample post:       ${sample.link}`);
      console.log(`file download:     ${await tryDownload(p, sample.video)}`);
    }
    if (items[0]) console.log(`fields available:  ${Object.keys(items[0]).join(', ')}`);
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }
}
