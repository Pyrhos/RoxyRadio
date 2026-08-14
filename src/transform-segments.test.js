import { describe, it, expect } from 'vitest';
import { transformSegments, RUNTIME_FIELDS } from '../scripts/transform-segments.js';
import { HALO_PINS, COVERS } from '../scripts/order-config.js';
import source from './data/segments.json';

const mk = (videoId, released, extra = {}) => ({ videoId, name: videoId, songs: [], released, ...extra });

// A minimal source that satisfies the curation contract: every pinned/cover id present
// and dated, plus two plain streams to exercise the recency interleave.
const validSource = () => [
  ...HALO_PINS.map((id, i) => mk(id, `2020-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`)),
  ...COVERS.map((id, i) => mk(id, `2021-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`)),
  mk('streamOld000', '2019-01-01T00:00:00Z'),
  mk('streamNew000', '2023-01-01T00:00:00Z'),
];

describe('transformSegments — ordering + strip', () => {
  it('pins first, then interleaves newest streams one-for-one with covers', () => {
    const out = transformSegments(validSource());
    expect(out.slice(0, HALO_PINS.length).map((e) => e.videoId)).toEqual(HALO_PINS);
    const after = out.slice(HALO_PINS.length).map((e) => e.videoId);
    // streams newest-first = [streamNew000, streamOld000]; each of the first two covers
    // consumes one stream, remaining covers follow.
    expect(after).toEqual(['streamNew000', COVERS[0], 'streamOld000', COVERS[1], ...COVERS.slice(2)]);
  });

  it('drops top-level author fields (released) but keeps nested song theme + memberOnly', () => {
    const src = validSource().map((e) =>
      e.videoId === 'streamNew000'
        ? { ...e, songs: [{ name: 'x', range: [0, 10], theme: 3 }], memberOnly: true }
        : e,
    );
    const out = transformSegments(src);
    expect(out.every((e) => !('released' in e))).toBe(true);
    const s = out.find((e) => e.videoId === 'streamNew000');
    expect(s.songs[0].theme).toBe(3);
    expect(s.memberOnly).toBe(true);
  });

  it('throws on a duplicate videoId', () => {
    expect(() => transformSegments([...validSource(), mk(HALO_PINS[0], '2019-06-01T00:00:00Z')]))
      .toThrow(/duplicate videoId/);
  });

  it('throws on a stream missing "released"', () => {
    const src = validSource().map((e) => (e.videoId === 'streamOld000' ? { ...e, released: null } : e));
    expect(() => transformSegments(src)).toThrow(/missing "released"/);
  });

  it('throws when a curated id is absent from the source', () => {
    expect(() => transformSegments(validSource().filter((e) => e.videoId !== HALO_PINS[0])))
      .toThrow(/absent from source/);
  });
});

describe('transformSegments — against the real source', () => {
  it('ships every entry once, none dated, themes intact, pins first', () => {
    const out = transformSegments(source);
    expect(out.length).toBe(source.length);
    expect(new Set(out.map((e) => e.videoId)).size).toBe(source.length);
    expect(out.some((e) => 'released' in e)).toBe(false);
    const themes = (a) => a.flatMap((e) => e.songs || []).filter((s) => 'theme' in s).length;
    expect(themes(out)).toBe(themes(source));
    expect(out.slice(0, HALO_PINS.length).map((e) => e.videoId)).toEqual(HALO_PINS);
  });

  // Tripwire: transformSegments strips to RUNTIME_FIELDS, so a new top-level field added
  // to the source is dropped from the payload with no error. This forces the drop to be a
  // decision — every source field must be either shipped (RUNTIME_FIELDS) or listed here as
  // deliberately author-only. Adding a field to the data without classifying it fails here.
  const AUTHOR_ONLY_FIELDS = ['released']; // derives ordering; intentionally never shipped
  it('classifies every top-level source field as runtime-shipped or author-only', () => {
    const classified = new Set([...Object.keys(RUNTIME_FIELDS), ...AUTHOR_ONLY_FIELDS]);
    const sourceFields = [...new Set(source.flatMap((e) => Object.keys(e)))];
    const unclassified = sourceFields.filter((k) => !classified.has(k));
    expect(unclassified, 'add each new source field to RUNTIME_FIELDS (to ship it) or AUTHOR_ONLY_FIELDS').toEqual([]);
  });
});
