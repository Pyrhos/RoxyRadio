// Regenerates the deployed src/data/segments.json from the local master
// (segments.super.json) using the curation in order-config.js.
//
// Deterministic, no network. This is the ONLY writer of segments.json — do not
// hand-edit that file; edit the master and re-run. Output entries are the master
// entries minus `released` (memberOnly, songs, theme, etc. are preserved), so the
// diff against the previous deploy file is a pure reordering.

import fs from 'node:fs';
import path from 'node:path';
import { HALO_PINS, COVERS } from './order-config.js';

const DATA = path.join(import.meta.dirname, '..', 'src', 'data');
const SUPER = path.join(DATA, 'segments.super.json');
const DEPLOY = path.join(DATA, 'segments.json');

const die = (msg) => { console.error(`[reorder] ${msg}`); process.exit(1); };

if (!fs.existsSync(SUPER)) die('no master (segments.super.json). Run: pnpm run data:fetch');
const superset = JSON.parse(fs.readFileSync(SUPER, 'utf8'));

const byId = new Map();
for (const e of superset) {
  if (byId.has(e.videoId)) die(`duplicate videoId in master: ${e.videoId}`);
  byId.set(e.videoId, e);
}

// Guard: this is a projection, so it would silently revert any song tweak made by
// ear in the deploy file back to the master's values. Refuse if the deploy file
// holds songs the master lacks — run data:harvest first to reclaim them.
const songKey = (s) => JSON.stringify([s.name, s.range[0], s.range[1], s.theme ?? null]);
const songsEqual = (a, b) => a.length === b.length && a.every((s, i) => songKey(s) === songKey(b[i]));
if (fs.existsSync(DEPLOY)) {
  let prevDeploy;
  try { prevDeploy = JSON.parse(fs.readFileSync(DEPLOY, 'utf8')); }
  catch { console.warn('[reorder] deploy file unreadable/corrupt — skipping harvest guard, regenerating from master'); }
  if (prevDeploy) {
    const stale = prevDeploy
      .filter((d) => byId.has(d.videoId) && !songsEqual(byId.get(d.videoId).songs, d.songs))
      .map((d) => `  ${d.videoId}  ${d.name}`);
    if (stale.length) die(`deploy file has unharvested song refinements — run 'pnpm run data:harvest' first:\n${stale.join('\n')}`);
  }
}

// Curated ids must exist in the master.
const cfgMissing = [...HALO_PINS, ...COVERS].filter((id) => !byId.has(id));
if (cfgMissing.length) die(`order-config references videoIds absent from master: ${cfgMissing.join(', ')}`);

const pinned = new Set([...HALO_PINS, ...COVERS]);
const streams = superset.filter((e) => !pinned.has(e.videoId));

// Streams are ordered by recency, so each needs a date.
const undated = streams.filter((e) => !e.released);
if (undated.length) {
  console.error('[reorder] streams missing "released" (run data:fetch with cookies, or set manually in master):');
  for (const e of undated) console.error(`  ${e.videoId}  ${e.name}${e.memberOnly ? '  [memberOnly]' : ''}`);
  process.exit(1);
}
streams.sort((a, b) => Date.parse(b.released) - Date.parse(a.released)); // newest first

// Compose: pins, then alternate newest-stream / next-cover until covers run out,
// then the remaining streams by recency.
const out = HALO_PINS.map((id) => byId.get(id));
let i = 0;
for (const id of COVERS) {
  if (i < streams.length) out.push(streams[i++]);
  out.push(byId.get(id));
}
while (i < streams.length) out.push(streams[i++]);

// Integrity: every segment present exactly once.
if (out.length !== superset.length) die(`internal: composed ${out.length} != ${superset.length} entries`);
if (new Set(out.map((e) => e.videoId)).size !== superset.length) die('internal: duplicate/dropped segment');

// Deploy shape = master entry minus `released`.
const lean = out.map(({ released, ...rest }) => rest);
fs.writeFileSync(DEPLOY, JSON.stringify(lean, null, 2) + '\n');

console.log(`[reorder] wrote ${path.relative(process.cwd(), DEPLOY)} (${lean.length} entries)`);
console.log('[reorder] head of new order:');
lean.slice(0, 13).forEach((e, idx) => console.log(`  ${String(idx + 1).padStart(2)}. ${e.videoId}  ${e.name}`));
