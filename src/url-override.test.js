import { describe, it, expect } from 'vitest';
import {
  resolveUrlOverride,
  computeActiveSegments,
  classifyMissing,
  looksLikeVideoId,
} from './url-override.js';
import { SEGMENTS_MODE_REPLACED } from './storage-keys.js';

// core-shaped playlist entries: songs is an array or null (Rule 0).
const withSongs = (videoId, songs, extra = {}) => ({ videoId, name: videoId, title: videoId, songs, memberOnly: false, ...extra });
const rule0 = (videoId, extra = {}) => withSongs(videoId, null, extra);
const playlist = [
  withSongs('aaaaaaaaaaa', [{ name: 'S1', range: [10, 40] }, { name: 'S2', range: [50, 120] }]),
  rule0('bbbbbbbbbbb'),
];

describe('looksLikeVideoId', () => {
  it('accepts an 11-char id from the YouTube alphabet', () => {
    expect(looksLikeVideoId('-j397NNQ2Ok')).toBe(true);
    expect(looksLikeVideoId('aaaaaaaaaaa')).toBe(true);
  });
  it('rejects wrong length, bad chars, and non-strings', () => {
    expect(looksLikeVideoId('short')).toBe(false);
    expect(looksLikeVideoId('waytoolongforanid')).toBe(false);
    expect(looksLikeVideoId('bad char!!!')).toBe(false);
    expect(looksLikeVideoId(null)).toBe(false);
    expect(looksLikeVideoId(undefined)).toBe(false);
    expect(looksLikeVideoId(12345678901)).toBe(false);
  });
});

describe('resolveUrlOverride', () => {
  it('returns null for a missing or empty videoId', () => {
    expect(resolveUrlOverride(playlist, null, null)).toBeNull();
    expect(resolveUrlOverride(playlist, '', null)).toBeNull();
  });

  it('returns null when the id is not in the playlist', () => {
    expect(resolveUrlOverride(playlist, 'zzzzzzzzzzz', null)).toBeNull();
  });

  it('resolves index with no timestamp', () => {
    expect(resolveUrlOverride(playlist, 'aaaaaaaaaaa', null)).toEqual({ streamIdx: 0, time: null });
  });

  it('keeps an in-bounds timestamp (>= first start, <= last end)', () => {
    expect(resolveUrlOverride(playlist, 'aaaaaaaaaaa', '30').time).toBe(30);
    expect(resolveUrlOverride(playlist, 'aaaaaaaaaaa', '10').time).toBe(10);
    expect(resolveUrlOverride(playlist, 'aaaaaaaaaaa', '120').time).toBe(120);
  });

  it('drops an out-of-bounds timestamp but still resolves the stream', () => {
    expect(resolveUrlOverride(playlist, 'aaaaaaaaaaa', '5')).toEqual({ streamIdx: 0, time: null });
    expect(resolveUrlOverride(playlist, 'aaaaaaaaaaa', '999')).toEqual({ streamIdx: 0, time: null });
  });

  it('accepts any non-negative timestamp for a Rule 0 stream', () => {
    expect(resolveUrlOverride(playlist, 'bbbbbbbbbbb', '873').time).toBe(873);
    expect(resolveUrlOverride(playlist, 'bbbbbbbbbbb', '0').time).toBe(0);
  });

  it('ignores negative / non-numeric timestamps', () => {
    expect(resolveUrlOverride(playlist, 'bbbbbbbbbbb', '-5').time).toBeNull();
    expect(resolveUrlOverride(playlist, 'bbbbbbbbbbb', 'abc').time).toBeNull();
  });
});

describe('computeActiveSegments', () => {
  const base = [{ videoId: 'aaaaaaaaaaa', name: 'A' }, { videoId: 'bbbbbbbbbbb', name: 'B' }];

  it('returns the base untouched when there is no custom import', () => {
    expect(computeActiveSegments(base, { json: null, mode: null })).toEqual({ segments: base, invalidCustom: false });
    expect(computeActiveSegments(base, undefined)).toEqual({ segments: base, invalidCustom: false });
  });

  it('replaced mode uses the custom set verbatim', () => {
    const custom = [{ videoId: 'ccccccccccc', name: 'C' }];
    expect(computeActiveSegments(base, { json: JSON.stringify(custom), mode: SEGMENTS_MODE_REPLACED }))
      .toEqual({ segments: custom, invalidCustom: false });
  });

  it('extend mode loads fresh base, then appends only non-base custom entries', () => {
    const custom = [
      { videoId: 'aaaaaaaaaaa', name: 'A-stale' }, // dropped: overlaps base
      { videoId: 'ddddddddddd', name: 'D' },        // kept
    ];
    const { segments, invalidCustom } = computeActiveSegments(base, { json: JSON.stringify(custom), mode: null });
    expect(invalidCustom).toBe(false);
    expect(segments.map((e) => e.videoId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ddddddddddd']);
    expect(segments[0].name).toBe('A'); // base wins, not the stale custom copy
  });

  it('flags unparseable JSON as invalidCustom and keeps the base', () => {
    expect(computeActiveSegments(base, { json: '{not json', mode: null }))
      .toEqual({ segments: base, invalidCustom: true });
  });

  it('flags schema-invalid custom data as invalidCustom and keeps the base', () => {
    const bad = JSON.stringify([{ noVideoId: true }]);
    expect(computeActiveSegments(base, { json: bad, mode: null }))
      .toEqual({ segments: base, invalidCustom: true });
  });
});

describe('classifyMissing', () => {
  const fresh = [
    { videoId: 'aaaaaaaaaaa', memberOnly: false },
    { videoId: 'mmmmmmmmmmm', memberOnly: true },
  ];

  it('reports member-gated when the stream exists but is member-only', () => {
    expect(classifyMissing(fresh, 'mmmmmmmmmmm')).toBe('member-gated');
  });

  it('reports removed when the stream is absent from fresh data', () => {
    expect(classifyMissing(fresh, 'zzzzzzzzzzz')).toBe('removed');
  });
});
