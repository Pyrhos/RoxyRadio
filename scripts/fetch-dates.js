// Fetches YouTube release dates into the local master (src/data/segments.super.json).
//
// Incremental: only entries missing `released` are fetched, so adding one stream
// costs one network call. The master is gitignored but rebuildable — if it is
// absent it bootstraps from the committed segments.json + yt-dlp.
//
// The sort key is `release_timestamp` (a stream's actual go-live, which is what
// YouTube orders the channel by), falling back to `timestamp` (publish) for plain
// uploads where release_timestamp is absent. Stored as ISO-8601 UTC, second precision.
//
// Member-only VODs need auth. Provide cookies via one of:
//   YTDLP_COOKIES=/path/to/cookies.txt
//   YTDLP_COOKIES_FROM_BROWSER=firefox            (or chrome, chromium, brave, ...)
// Otherwise gated entries are reported and left for a manual `released` in the master.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DATA = path.join(import.meta.dirname, '..', 'src', 'data');
const SUPER = path.join(DATA, 'segments.super.json');
const DEPLOY = path.join(DATA, 'segments.json');

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeSuper = (data) => fs.writeFileSync(SUPER, JSON.stringify(data, null, 2) + '\n');
const rel = (p) => path.relative(process.cwd(), p);

// 1. Load the master, or bootstrap it from the committed deploy file.
let superset;
if (fs.existsSync(SUPER)) {
  superset = read(SUPER);
} else {
  console.log(`[bootstrap] no master; seeding from ${rel(DEPLOY)}`);
  superset = read(DEPLOY);
}
for (const e of superset) if (!('released' in e)) e.released = null;

// 2. Which entries still need a date?
const missing = superset.filter((e) => !e.released);
console.log(`[fetch] ${missing.length}/${superset.length} entries need a release date`);
if (missing.length === 0) {
  writeSuper(superset);
  console.log('[done] all entries dated');
  process.exit(0);
}

// 3. One yt-dlp call for all missing ids; --ignore-errors keeps gated items from aborting the batch.
const cookieArgs = [];
if (process.env.YTDLP_COOKIES) cookieArgs.push('--cookies', process.env.YTDLP_COOKIES);
if (process.env.YTDLP_COOKIES_FROM_BROWSER) cookieArgs.push('--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER);

const urls = missing.map((e) => `https://www.youtube.com/watch?v=${e.videoId}`);
let stdout = '';
try {
  stdout = execFileSync('yt-dlp', [
    '--skip-download', '--no-warnings', '--ignore-errors',
    '--sleep-requests', '1',
    ...cookieArgs,
    '--print', '%(id)s\t%(release_timestamp)s\t%(timestamp)s',
    ...urls,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  // With --ignore-errors, yt-dlp exits non-zero when any item failed, yet the
  // successful items are still on stdout. Salvage whatever came through.
  stdout = err.stdout || '';
}

// 4. Parse id -> ISO. Prefer release_timestamp (go-live) over timestamp (publish).
const toIso = (unix) => new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const byId = new Map();
for (const line of stdout.split('\n')) {
  if (!line.trim()) continue;
  const [id, r, t] = line.split('\t');
  const unix = r && r !== 'NA' ? Number(r) : t && t !== 'NA' ? Number(t) : null;
  if (id && unix) byId.set(id, toIso(unix));
}

// 5. Merge + report.
const failed = [];
for (const e of superset) {
  if (!e.released && byId.has(e.videoId)) e.released = byId.get(e.videoId);
  if (!e.released) failed.push(e);
}
writeSuper(superset);
console.log(`[write] ${rel(SUPER)} — ${superset.length - failed.length}/${superset.length} dated`);
if (failed.length) {
  console.warn(`\n[warn] no date for ${failed.length} entr${failed.length === 1 ? 'y' : 'ies'} ` +
    `(member-only? supply cookies or set "released" by hand in the master):`);
  for (const e of failed) console.warn(`  ${e.videoId}  ${e.name}${e.memberOnly ? '  [memberOnly]' : ''}`);
}
