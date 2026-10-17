// Pure, DOM-free helpers for resolving a shared `?v=&t=` deep link against the
// playlist — including the cold path where the link points at a stream a stale
// cached bundle doesn't know yet (resolved by re-checking against freshly-fetched
// canonical data; see app.js). No window/fetch here: the caller injects raw values.

import { validateSegmentData, selectCustomSegments } from './import-helpers.js';
import { SEGMENTS_MODE_REPLACED } from './storage-keys.js';

/** @typedef {import('./import-helpers.js').Segment} Segment */

const VALID_ID = /^[a-zA-Z0-9_-]{11}$/;

// A syntactically plausible YouTube id — gates the cold-path fetch so junk `?v=`
// never hits the network.
/**
 * @param {unknown} id
 * @returns {id is string}
 */
export function looksLikeVideoId(id) {
  return typeof id === 'string' && VALID_ID.test(id);
}

// Resolve v/t against a core-shaped playlist (entries have `songs` as an array or
// null). Returns { streamIdx, time } or null when the id isn't present. `time` is
// kept only when a valid, in-bounds timestamp is given (any t>=0 for Rule 0 streams).
export function resolveUrlOverride(playlist, videoId, timestamp) {
  if (!videoId) return null;
  const streamIdx = playlist.findIndex((s) => s.videoId === videoId);
  if (streamIdx === -1) return null;

  const result = { streamIdx, time: null };
  if (timestamp !== null && timestamp !== undefined) {
    const t = parseFloat(timestamp);
    if (Number.isFinite(t) && t >= 0) {
      const stream = playlist[streamIdx];
      if (stream.songs && stream.songs.length > 0) {
        const firstStart = stream.songs[0].range[0];
        const lastEnd = stream.songs[stream.songs.length - 1].range[1];
        if (t >= firstStart && t <= lastEnd) result.time = t;
      } else {
        result.time = t;
      }
    }
  }
  return result;
}

// Apply the persisted custom-playlist overlay onto a base payload, mirroring the
// load-time precedence: replaced → use the custom set verbatim; otherwise defaults
// always load fresh with non-default custom entries appended. `invalidCustom` tells
// the caller to purge the corrupt localStorage entry (this function has no side effects).
/**
 * @param {Segment[]} base
 * @param {{json?: string | null, mode?: string | null} | null | undefined} custom
 * @returns {{segments: Segment[], invalidCustom: boolean}}
 */
export function computeActiveSegments(base, custom) {
  const { json, mode } = custom || {};
  if (!json) return { segments: base, invalidCustom: false };

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { segments: base, invalidCustom: true };
  }
  if (!validateSegmentData(parsed)) return { segments: base, invalidCustom: true };

  if (mode === SEGMENTS_MODE_REPLACED) return { segments: parsed, invalidCustom: false };

  const customOnly = selectCustomSegments(parsed, base);
  return { segments: [...base, ...customOnly], invalidCustom: false };
}

// Why a resolve still failed after consulting fresh (unfiltered) canonical data:
// 'member-gated' when the stream exists but is member-only (so it's filtered out of
// the playlist while Member Mode is off), else 'removed'.
/**
 * @param {Segment[]} freshUnfiltered
 * @param {string} videoId
 * @returns {'member-gated' | 'removed'}
 */
export function classifyMissing(freshUnfiltered, videoId) {
  const entry = freshUnfiltered.find((e) => e.videoId === videoId);
  return entry && entry.memberOnly ? 'member-gated' : 'removed';
}
