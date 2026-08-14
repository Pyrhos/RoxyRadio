// Pure projection from the authored source (src/data/segments.json) to the runtime
// payload the player ships: curation order (order-config) + newest-first by `released`,
// then stripped to the fields the player reads. No fs, no network — the Vite plugin,
// the preview script, and the tests all call this.

import { HALO_PINS, COVERS } from './order-config.js';

// Top-level fields the player consumes. Author-only fields (e.g. `released`, used only
// to derive order) are absent here and so drop from the payload. Each entry keeps its
// source key order; song objects (name/range/theme) ride inside `songs` untouched.
// Exported so a test can assert every source field is either shipped here or an
// acknowledged author-only field — a new field would otherwise be dropped silently.
export const RUNTIME_FIELDS = { videoId: true, name: true, songs: true, memberOnly: true };

export function transformSegments(source) {
  const byId = new Map();
  for (const e of source) {
    if (byId.has(e.videoId)) throw new Error(`duplicate videoId in source: ${e.videoId}`);
    byId.set(e.videoId, e);
  }

  const missing = [...HALO_PINS, ...COVERS].filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`order-config references videoIds absent from source: ${missing.join(', ')}`);

  const pinned = new Set([...HALO_PINS, ...COVERS]);
  const streams = source.filter((e) => !pinned.has(e.videoId));
  const undated = streams.filter((e) => !e.released);
  if (undated.length) {
    throw new Error(`streams missing "released" (run data:fetch, or set it by hand): ${undated.map((e) => e.videoId).join(', ')}`);
  }
  streams.sort((a, b) => Date.parse(b.released) - Date.parse(a.released)); // newest first

  // Compose: halo pins, then alternate newest-stream / next-cover until covers run out,
  // then the remaining streams by recency.
  const out = HALO_PINS.map((id) => byId.get(id));
  let i = 0;
  for (const id of COVERS) {
    if (i < streams.length) out.push(streams[i++]);
    out.push(byId.get(id));
  }
  while (i < streams.length) out.push(streams[i++]);

  // Integrity: every source entry present exactly once.
  if (out.length !== source.length) throw new Error(`internal: composed ${out.length} != ${source.length} entries`);

  // Strip to runtime fields, preserving each entry's source key order.
  return out.map((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k in RUNTIME_FIELDS)));
}
