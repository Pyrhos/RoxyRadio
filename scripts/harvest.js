// Ports song refinements back from the deployed src/data/segments.json into the
// local master (segments.super.json). This is the inverse of reorder.js.
//
// reorder is a one-way projection master -> deploy, so range tweaks made by ear
// against the running player (which loads the deploy file) live only in the deploy
// file and get reverted on the next reorder. Harvest closes that leak: it pulls the
// deploy file's songs back into the master, making the sync pipeline lossless.
//
// Scope: songs only (the refinement surface — ranges + per-song theme). Song
// *identity* (count/names/order) is treated as structure: if it differs for an id,
// that is authoring, not refinement, so harvest refuses to guess and reports the
// conflict for manual resolution instead of silently merging.

import fs from 'node:fs';
import path from 'node:path';

const DATA = path.join(import.meta.dirname, '..', 'src', 'data');
const SUPER = path.join(DATA, 'segments.super.json');
const DEPLOY = path.join(DATA, 'segments.json');

const rel = (p) => path.relative(process.cwd(), p);
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// A song's identity is (name, position); its range + theme are refinable content.
const sameStructure = (a, b) => a.length === b.length && a.every((s, i) => s.name === b[i].name);
const songKey = (s) => JSON.stringify([s.name, s.range[0], s.range[1], s.theme ?? null]);
const songsEqual = (a, b) => a.length === b.length && a.every((s, i) => songKey(s) === songKey(b[i]));

// Nothing to reclaim if either side is absent — a fresh master is bootstrapped from
// the deploy file by fetch-dates.js, which already carries the refined songs.
if (!fs.existsSync(SUPER)) { console.log('[harvest] no master yet — nothing to harvest (fetch will bootstrap from deploy)'); process.exit(0); }
if (!fs.existsSync(DEPLOY)) { console.log('[harvest] no deploy file — nothing to harvest'); process.exit(0); }

const superset = read(SUPER);
const deploy = read(DEPLOY);
const superById = new Map(superset.map((e) => [e.videoId, e]));

const harvested = []; // ids whose refined songs we pull into the master
const conflicts = []; // ids we refuse to auto-merge — reported, not applied

for (const d of deploy) {
  const s = superById.get(d.videoId);
  if (!s) { conflicts.push({ id: d.videoId, name: d.name, why: 'present in deploy but absent from master' }); continue; }
  if (songsEqual(s.songs, d.songs)) continue;
  if (!sameStructure(s.songs, d.songs)) {
    conflicts.push({
      id: d.videoId, name: d.name,
      why: `song structure differs (master ${s.songs.length} songs, deploy ${d.songs.length})`,
      master: s.songs.map((x) => x.name),
      deploy: d.songs.map((x) => x.name),
    });
    continue;
  }
  s.songs = d.songs; // structure matches, values differ -> a refinement; deploy wins
  harvested.push({ id: d.videoId, name: d.name });
}

// Atomic: a structural conflict blocks the whole run so nothing is half-applied.
if (conflicts.length) {
  console.error(`[harvest] ${conflicts.length} conflict(s) — nothing written. Resolve, then re-run:`);
  for (const c of conflicts) {
    console.error(`  ${c.id}  ${c.name}\n    ${c.why}`);
    if (c.master) console.error(`    master: ${c.master.join(' | ')}\n    deploy: ${c.deploy.join(' | ')}`);
  }
  process.exit(1);
}

if (!harvested.length) { console.log('[harvest] master already in sync with deploy — no refinements to reclaim'); process.exit(0); }

fs.writeFileSync(SUPER, JSON.stringify(superset, null, 2) + '\n');
console.log(`[harvest] reclaimed refined songs for ${harvested.length} entr${harvested.length === 1 ? 'y' : 'ies'} into ${rel(SUPER)}:`);
for (const h of harvested) console.log(`  ${h.id}  ${h.name}`);
