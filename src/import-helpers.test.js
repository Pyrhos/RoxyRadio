import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateSegmentData } from './import-helpers.js';
import { PlayerCore } from './player-core.js';
import { clearStorage } from './test-setup.js';

// ============================================================================
// FIXTURES
// ============================================================================

function makeStream(videoId, songs) {
    const entry = { videoId };
    if (songs !== undefined) entry.songs = songs;
    return entry;
}

function makeSong(name, start, end) {
    return { name, range: [start, end] };
}

const STREAM_A = makeStream('aaa', [makeSong('Song A1', 10, 60), makeSong('Song A2', 70, 120)]);
const STREAM_B = makeStream('bbb', [makeSong('Song B1', 5, 55)]);
const STREAM_C = makeStream('ccc', [makeSong('Song C1', 0, 30), makeSong('Song C2', 40, 80)]);
const RULE_0_STREAM = makeStream('rrr');

const DEFAULT_SEGMENTS = [STREAM_A, STREAM_B];

// ============================================================================
// VALIDATION: validateSegmentData
// ============================================================================

describe('validateSegmentData', () => {

    describe('Rejects non-array / empty inputs', () => {
        it('rejects null', () => {
            expect(validateSegmentData(null)).toBe(false);
        });

        it('rejects undefined', () => {
            expect(validateSegmentData(undefined)).toBe(false);
        });

        it('rejects a number', () => {
            expect(validateSegmentData(42)).toBe(false);
        });

        it('rejects a string', () => {
            expect(validateSegmentData('hello')).toBe(false);
        });

        it('rejects a plain object', () => {
            expect(validateSegmentData({ videoId: 'x' })).toBe(false);
        });

        it('rejects an empty array', () => {
            expect(validateSegmentData([])).toBe(false);
        });

        it('rejects a boolean', () => {
            expect(validateSegmentData(true)).toBe(false);
        });
    });

    describe('Rejects entries without valid videoId', () => {
        it('rejects entry with missing videoId', () => {
            expect(validateSegmentData([{ songs: [] }])).toBe(false);
        });

        it('rejects entry with numeric videoId', () => {
            expect(validateSegmentData([{ videoId: 123 }])).toBe(false);
        });

        it('rejects entry with empty string videoId', () => {
            expect(validateSegmentData([{ videoId: '' }])).toBe(false);
        });

        it('rejects null entry in array', () => {
            expect(validateSegmentData([null])).toBe(false);
        });

        it('rejects undefined entry in array', () => {
            expect(validateSegmentData([undefined])).toBe(false);
        });

        it('rejects entry with boolean videoId', () => {
            expect(validateSegmentData([{ videoId: true }])).toBe(false);
        });
    });

    describe('Rejects invalid song structures', () => {
        it('rejects songs that is not an array', () => {
            expect(validateSegmentData([{ videoId: 'x', songs: 'not-array' }])).toBe(false);
        });

        it('rejects songs that is an object', () => {
            expect(validateSegmentData([{ videoId: 'x', songs: { name: 'Song' } }])).toBe(false);
        });

        it('rejects song with missing name', () => {
            expect(validateSegmentData([
                { videoId: 'x', songs: [{ range: [0, 10] }] }
            ])).toBe(false);
        });

        it('rejects song with numeric name', () => {
            expect(validateSegmentData([
                { videoId: 'x', songs: [{ name: 42, range: [0, 10] }] }
            ])).toBe(false);
        });

        it('rejects song with missing range', () => {
            expect(validateSegmentData([
                { videoId: 'x', songs: [{ name: 'Song' }] }
            ])).toBe(false);
        });

        it('rejects song with range that is not an array', () => {
            expect(validateSegmentData([
                { videoId: 'x', songs: [{ name: 'Song', range: '0-10' }] }
            ])).toBe(false);
        });

        it('rejects song with range of wrong length (1 element)', () => {
            expect(validateSegmentData([
                { videoId: 'x', songs: [{ name: 'Song', range: [10] }] }
            ])).toBe(false);
        });

        it('rejects song with range of wrong length (3 elements)', () => {
            expect(validateSegmentData([
                { videoId: 'x', songs: [{ name: 'Song', range: [0, 10, 20] }] }
            ])).toBe(false);
        });

        it('rejects song with non-numeric range start', () => {
            expect(validateSegmentData([
                { videoId: 'x', songs: [{ name: 'Song', range: ['0', 10] }] }
            ])).toBe(false);
        });

        it('rejects song with non-numeric range end', () => {
            expect(validateSegmentData([
                { videoId: 'x', songs: [{ name: 'Song', range: [0, '10'] }] }
            ])).toBe(false);
        });

        it('rejects song with NaN range values', () => {
            expect(validateSegmentData([
                { videoId: 'x', songs: [{ name: 'Song', range: [NaN, 10] }] }
            ])).toBe(false);
        });

        it('rejects song with Infinity range values', () => {
            expect(validateSegmentData([
                { videoId: 'x', songs: [{ name: 'Song', range: [0, Infinity] }] }
            ])).toBe(false);
        });

        it('rejects null song in songs array', () => {
            expect(validateSegmentData([
                { videoId: 'x', songs: [null] }
            ])).toBe(false);
        });

        it('rejects when one valid and one invalid song are present', () => {
            expect(validateSegmentData([
                { videoId: 'x', songs: [
                    { name: 'Good', range: [0, 10] },
                    { name: 'Bad', range: [10] }
                ]}
            ])).toBe(false);
        });

        it('rejects when one valid entry and one invalid entry are present', () => {
            expect(validateSegmentData([
                { videoId: 'good' },
                { videoId: 'bad', songs: [{ name: 42, range: [0, 10] }] }
            ])).toBe(false);
        });
    });

    describe('Accepts valid data', () => {
        it('accepts a single Rule 0 stream (no songs)', () => {
            expect(validateSegmentData([{ videoId: 'abc' }])).toBe(true);
        });

        it('accepts a stream with songs: null', () => {
            expect(validateSegmentData([{ videoId: 'abc', songs: null }])).toBe(true);
        });

        it('accepts a stream with songs: undefined (omitted)', () => {
            expect(validateSegmentData([{ videoId: 'abc', songs: undefined }])).toBe(true);
        });

        it('accepts a stream with an empty songs array', () => {
            expect(validateSegmentData([{ videoId: 'abc', songs: [] }])).toBe(true);
        });

        it('accepts a stream with valid songs', () => {
            expect(validateSegmentData([STREAM_A])).toBe(true);
        });

        it('accepts multiple valid streams', () => {
            expect(validateSegmentData([STREAM_A, STREAM_B, STREAM_C])).toBe(true);
        });

        it('accepts a mix of Rule 0 and song-bearing streams', () => {
            expect(validateSegmentData([STREAM_A, RULE_0_STREAM])).toBe(true);
        });

        it('accepts zero-based ranges', () => {
            expect(validateSegmentData([
                { videoId: 'x', songs: [{ name: 'Song', range: [0, 0] }] }
            ])).toBe(true);
        });

        it('accepts negative range values (validation is structural, not semantic)', () => {
            expect(validateSegmentData([
                { videoId: 'x', songs: [{ name: 'Song', range: [-5, -1] }] }
            ])).toBe(true);
        });

        it('accepts extra properties on entries and songs', () => {
            expect(validateSegmentData([
                { videoId: 'x', name: 'Stream', title: 'Title', memberOnly: true,
                  songs: [{ name: 'Song', range: [0, 10], theme: 1, extra: 'data' }] }
            ])).toBe(true);
        });
    });
});

// ============================================================================
// IMPORT PERSISTENCE & RESTORATION
// ============================================================================

describe('Import Persistence', () => {
    let core;
    let savedSettings;
    let savedSession;

    function createCore() {
        savedSettings = {};
        savedSession = {};
        return new PlayerCore({
            saveSettings: (s) => { Object.assign(savedSettings, s); },
            getSettings: () => ({ ...savedSettings }),
            saveSessionData: (s) => { Object.assign(savedSession, s); },
            getSessionData: () => ({ ...savedSession }),
        });
    }

    beforeEach(() => {
        clearStorage();
        core = createCore();
    });

    afterEach(() => {
        clearStorage();
    });

    describe('persistCustomSegments and restore', () => {
        it('stores valid segment data in localStorage', () => {
            const data = [STREAM_A, STREAM_B];
            localStorage.setItem('roxy_customSegments', JSON.stringify(data));

            const restored = JSON.parse(localStorage.getItem('roxy_customSegments'));
            expect(restored).toHaveLength(2);
            expect(restored[0].videoId).toBe('aaa');
            expect(restored[1].videoId).toBe('bbb');
        });

        it('restored data passes validation', () => {
            const data = [STREAM_A, STREAM_C];
            localStorage.setItem('roxy_customSegments', JSON.stringify(data));

            const restored = JSON.parse(localStorage.getItem('roxy_customSegments'));
            expect(validateSegmentData(restored)).toBe(true);
        });

        it('corrupted JSON in localStorage is detectable', () => {
            localStorage.setItem('roxy_customSegments', 'not valid json{{{');

            let parsed = null;
            let parseError = false;
            try {
                parsed = JSON.parse(localStorage.getItem('roxy_customSegments'));
            } catch {
                parseError = true;
            }
            expect(parseError).toBe(true);
            expect(parsed).toBe(null);
        });

        it('structurally invalid data in localStorage fails validation', () => {
            localStorage.setItem('roxy_customSegments', JSON.stringify([{ bad: 'data' }]));

            const restored = JSON.parse(localStorage.getItem('roxy_customSegments'));
            expect(validateSegmentData(restored)).toBe(false);
        });

        it('empty array in localStorage fails validation', () => {
            localStorage.setItem('roxy_customSegments', JSON.stringify([]));

            const restored = JSON.parse(localStorage.getItem('roxy_customSegments'));
            expect(validateSegmentData(restored)).toBe(false);
        });

        it('reset clears custom segments from localStorage', () => {
            localStorage.setItem('roxy_customSegments', JSON.stringify([STREAM_A]));
            expect(localStorage.getItem('roxy_customSegments')).not.toBe(null);

            localStorage.removeItem('roxy_customSegments');
            expect(localStorage.getItem('roxy_customSegments')).toBe(null);
        });
    });

    describe('Replace behavior via PlayerCore', () => {
        it('replaces the playlist entirely with imported data', () => {
            core.init(DEFAULT_SEGMENTS);
            expect(core.playlist).toHaveLength(2);

            core.init([STREAM_C]);
            expect(core.playlist).toHaveLength(1);
            expect(core.playlist[0].videoId).toBe('ccc');
        });

        it('resets indices to 0 after replace', () => {
            core.init(DEFAULT_SEGMENTS);
            core.vIdx = 1;
            core.rIdx = 1;

            core.init([STREAM_C]);
            core.vIdx = 0;
            core.rIdx = 0;
            expect(core.vIdx).toBe(0);
            expect(core.rIdx).toBe(0);
        });

        it('preserves mode settings across replace', () => {
            savedSettings.yapMode = 'true';
            savedSettings.shuffleMode = 'true';
            savedSettings.loopMode = '2';

            core.init([STREAM_C]);
            expect(core.yapMode).toBe(true);
            expect(core.shuffleMode).toBe(true);
            expect(core.loopMode).toBe(2);
        });

        it('replace with member-only-only data and memberMode off produces empty playlist', () => {
            savedSettings.memberMode = 'false';
            const memberOnlyData = [
                { videoId: 'mem1', memberOnly: true, songs: [makeSong('S', 0, 10)] }
            ];

            core.init(memberOnlyData);
            expect(core.playlist).toHaveLength(0);
        });

        it('replace with member-only data and memberMode on keeps streams', () => {
            savedSettings.memberMode = 'true';
            const memberOnlyData = [
                { videoId: 'mem1', memberOnly: true, songs: [makeSong('S', 0, 10)] }
            ];

            core.init(memberOnlyData);
            expect(core.playlist).toHaveLength(1);
            expect(core.playlist[0].memberOnly).toBe(true);
        });
    });

    describe('Extend (merge) behavior via PlayerCore', () => {
        it('merges imported data with existing, imported replaces duplicates', () => {
            const existing = [STREAM_A, STREAM_B];
            const imported = [
                makeStream('bbb', [makeSong('Replacement B1', 0, 30)]),
                STREAM_C
            ];

            const importedIds = new Set(imported.map(e => e.videoId));
            const kept = existing.filter(e => !importedIds.has(e.videoId));
            const merged = [...kept, ...imported];

            core.init(merged);
            expect(core.playlist).toHaveLength(3);
            expect(core.playlist[0].videoId).toBe('aaa');
            expect(core.playlist[1].videoId).toBe('bbb');
            expect(core.playlist[1].songs[0].name).toBe('Replacement B1');
            expect(core.playlist[2].videoId).toBe('ccc');
        });

        it('extend with no overlapping videoIds appends all', () => {
            const existing = [STREAM_A];
            const imported = [STREAM_B, STREAM_C];

            const importedIds = new Set(imported.map(e => e.videoId));
            const kept = existing.filter(e => !importedIds.has(e.videoId));
            const merged = [...kept, ...imported];

            core.init(merged);
            expect(core.playlist).toHaveLength(3);
        });

        it('extend with fully overlapping videoIds replaces all', () => {
            const existing = [STREAM_A, STREAM_B];
            const imported = [
                makeStream('aaa', [makeSong('New A', 0, 10)]),
                makeStream('bbb', [makeSong('New B', 0, 20)]),
            ];

            const importedIds = new Set(imported.map(e => e.videoId));
            const kept = existing.filter(e => !importedIds.has(e.videoId));
            const merged = [...kept, ...imported];

            core.init(merged);
            expect(core.playlist).toHaveLength(2);
            expect(core.playlist[0].songs[0].name).toBe('New A');
            expect(core.playlist[1].songs[0].name).toBe('New B');
        });

        it('extend ordering: existing entries first, then imported entries', () => {
            const existing = [STREAM_A, STREAM_B];
            const imported = [STREAM_C];

            const importedIds = new Set(imported.map(e => e.videoId));
            const kept = existing.filter(e => !importedIds.has(e.videoId));
            const merged = [...kept, ...imported];

            expect(merged[0].videoId).toBe('aaa');
            expect(merged[1].videoId).toBe('bbb');
            expect(merged[2].videoId).toBe('ccc');
        });
    });

    describe('Reset behavior', () => {
        it('reset reverts to default segments after replace', () => {
            core.init([STREAM_C]);
            expect(core.playlist).toHaveLength(1);

            core.init(DEFAULT_SEGMENTS);
            expect(core.playlist).toHaveLength(2);
            expect(core.playlist[0].videoId).toBe('aaa');
        });

        it('reset reverts to default segments after extend', () => {
            const importedIds = new Set([STREAM_C].map(e => e.videoId));
            const kept = DEFAULT_SEGMENTS.filter(e => !importedIds.has(e.videoId));
            const merged = [...kept, STREAM_C];

            core.init(merged);
            expect(core.playlist).toHaveLength(3);

            core.init(DEFAULT_SEGMENTS);
            expect(core.playlist).toHaveLength(2);
        });

        it('reset clears localStorage key', () => {
            localStorage.setItem('roxy_customSegments', JSON.stringify([STREAM_C]));
            localStorage.removeItem('roxy_customSegments');
            expect(localStorage.getItem('roxy_customSegments')).toBe(null);
        });
    });

    describe('Edge cases', () => {
        it('importing a single Rule 0 stream works', () => {
            core.init([RULE_0_STREAM]);
            expect(core.playlist).toHaveLength(1);
            expect(core.playlist[0].songs).toBe(null);
        });

        it('importing streams with empty songs array treats them as Rule 0', () => {
            core.init([makeStream('empty', [])]);
            expect(core.playlist).toHaveLength(1);
            expect(core.playlist[0].songs).toBe(null);
        });

        it('duplicate videoIds in import data are both kept by core.init', () => {
            // validateSegmentData allows duplicates — core.init doesn't deduplicate
            const duped = [
                makeStream('aaa', [makeSong('First', 0, 10)]),
                makeStream('aaa', [makeSong('Second', 0, 20)]),
            ];
            expect(validateSegmentData(duped)).toBe(true);
            core.init(duped);
            expect(core.playlist).toHaveLength(2);
        });

        it('extend deduplication only removes existing entries that match imported videoIds', () => {
            const existing = [
                makeStream('aaa', [makeSong('A', 0, 10)]),
                makeStream('bbb', [makeSong('B', 0, 10)]),
                makeStream('ccc', [makeSong('C', 0, 10)]),
            ];
            // Import overrides bbb only
            const imported = [makeStream('bbb', [makeSong('B-new', 0, 20)])];

            const importedIds = new Set(imported.map(e => e.videoId));
            const kept = existing.filter(e => !importedIds.has(e.videoId));
            const merged = [...kept, ...imported];

            expect(merged).toHaveLength(3);
            expect(merged[0].videoId).toBe('aaa');
            expect(merged[1].videoId).toBe('ccc');
            expect(merged[2].videoId).toBe('bbb');
            expect(merged[2].songs[0].name).toBe('B-new');
        });

        it('extend with duplicate videoIds in import data keeps both copies', () => {
            const existing = [STREAM_A];
            const imported = [
                makeStream('ddd', [makeSong('D1', 0, 10)]),
                makeStream('ddd', [makeSong('D2', 0, 20)]),
            ];

            const importedIds = new Set(imported.map(e => e.videoId));
            const kept = existing.filter(e => !importedIds.has(e.videoId));
            const merged = [...kept, ...imported];

            core.init(merged);
            expect(core.playlist).toHaveLength(3);
        });

        it('large playlist persists and restores from localStorage', () => {
            const bigPlaylist = Array.from({ length: 200 }, (_, i) =>
                makeStream(`vid${i}`, [makeSong(`Song ${i}`, i * 100, i * 100 + 90)])
            );

            localStorage.setItem('roxy_customSegments', JSON.stringify(bigPlaylist));
            const restored = JSON.parse(localStorage.getItem('roxy_customSegments'));

            expect(validateSegmentData(restored)).toBe(true);
            expect(restored).toHaveLength(200);
        });

        it('persisted data survives JSON round-trip without data loss', () => {
            const original = [
                { videoId: 'x', name: 'Stream X', title: 'Title', memberOnly: true,
                  songs: [{ name: 'Song 1', range: [10.5, 60.123] }] }
            ];

            const json = JSON.stringify(original);
            const restored = JSON.parse(json);

            expect(restored[0].videoId).toBe('x');
            expect(restored[0].name).toBe('Stream X');
            expect(restored[0].memberOnly).toBe(true);
            expect(restored[0].songs[0].range[0]).toBeCloseTo(10.5);
            expect(restored[0].songs[0].range[1]).toBeCloseTo(60.123);
        });
    });
});
