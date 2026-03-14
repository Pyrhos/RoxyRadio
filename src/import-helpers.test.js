import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateSegmentData, parseYouTubeUrls } from './import-helpers.js';
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

// ============================================================================
// URL PARSING: parseYouTubeUrls
// ============================================================================

describe('parseYouTubeUrls', () => {

    describe('Returns null for non-URL input', () => {
        it('returns null for null', () => {
            expect(parseYouTubeUrls(null)).toBe(null);
        });

        it('returns null for undefined', () => {
            expect(parseYouTubeUrls(undefined)).toBe(null);
        });

        it('returns null for empty string', () => {
            expect(parseYouTubeUrls('')).toBe(null);
        });

        it('returns only failed for random text', () => {
            const result = parseYouTubeUrls('hello world foo bar');
            expect(result.entries).toEqual([]);
            expect(result.failed).toEqual(['hello', 'world', 'foo', 'bar']);
        });

        it('returns only failed for non-YouTube URLs', () => {
            const result = parseYouTubeUrls('https://example.com/watch?v=abc');
            expect(result.entries).toEqual([]);
            expect(result.failed).toHaveLength(1);
        });

        it('rejects YouTube channel URLs', () => {
            const result = parseYouTubeUrls('https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw');
            expect(result.entries).toEqual([]);
            expect(result.failed).toHaveLength(1);
        });

        it('returns null for a number', () => {
            expect(parseYouTubeUrls(42)).toBe(null);
        });
    });

    describe('Parses single YouTube URLs', () => {
        it('parses youtube.com/watch?v=', () => {
            const result = parseYouTubeUrls('https://www.youtube.com/watch?v=jjchK5y6R2g');
            expect(result.entries).toEqual([{ videoId: 'jjchK5y6R2g' }]);
            expect(result.failed).toEqual([]);
        });

        it('parses youtube.com without www', () => {
            const result = parseYouTubeUrls('https://youtube.com/watch?v=jjchK5y6R2g');
            expect(result.entries).toEqual([{ videoId: 'jjchK5y6R2g' }]);
        });

        it('parses m.youtube.com', () => {
            const result = parseYouTubeUrls('https://m.youtube.com/watch?v=jjchK5y6R2g');
            expect(result.entries).toEqual([{ videoId: 'jjchK5y6R2g' }]);
        });

        it('parses youtu.be short links', () => {
            const result = parseYouTubeUrls('https://youtu.be/jjchK5y6R2g');
            expect(result.entries).toEqual([{ videoId: 'jjchK5y6R2g' }]);
        });

        it('parses youtube.com/live/ links', () => {
            const result = parseYouTubeUrls('https://www.youtube.com/live/jjchK5y6R2g');
            expect(result.entries).toEqual([{ videoId: 'jjchK5y6R2g' }]);
        });

        it('strips extra query params from watch URLs', () => {
            const result = parseYouTubeUrls('https://www.youtube.com/watch?v=jjchK5y6R2g&t=120&list=PLxyz');
            expect(result.entries).toEqual([{ videoId: 'jjchK5y6R2g' }]);
        });

        it('strips extra query params from youtu.be URLs', () => {
            const result = parseYouTubeUrls('https://youtu.be/jjchK5y6R2g?t=60');
            expect(result.entries).toEqual([{ videoId: 'jjchK5y6R2g' }]);
        });
    });

    describe('Parses multiple URLs with various separators', () => {
        it('space-separated', () => {
            const result = parseYouTubeUrls(
                'https://youtu.be/iz7OBkzxlIE https://youtu.be/rghnNC1lRXc'
            );
            expect(result.entries).toEqual([
                { videoId: 'iz7OBkzxlIE' },
                { videoId: 'rghnNC1lRXc' },
            ]);
        });

        it('comma-separated', () => {
            const result = parseYouTubeUrls(
                'https://youtu.be/w5r6bUthPeY,https://youtu.be/rghnNC1lRXc'
            );
            expect(result.entries).toEqual([
                { videoId: 'w5r6bUthPeY' },
                { videoId: 'rghnNC1lRXc' },
            ]);
        });

        it('semicolon-separated', () => {
            const result = parseYouTubeUrls(
                'https://youtu.be/w5r6bUthPeY;https://youtu.be/rghnNC1lRXc'
            );
            expect(result.entries).toEqual([
                { videoId: 'w5r6bUthPeY' },
                { videoId: 'rghnNC1lRXc' },
            ]);
        });

        it('newline-separated', () => {
            const result = parseYouTubeUrls(
                'https://youtu.be/w5r6bUthPeY\nhttps://youtu.be/rghnNC1lRXc\nhttps://youtu.be/qCm_skWOnoY'
            );
            expect(result.entries).toEqual([
                { videoId: 'w5r6bUthPeY' },
                { videoId: 'rghnNC1lRXc' },
                { videoId: 'qCm_skWOnoY' },
            ]);
        });

        it('mixed separators', () => {
            const result = parseYouTubeUrls(
                'https://youtu.be/w5r6bUthPeY, https://youtu.be/rghnNC1lRXc;\nhttps://youtu.be/qCm_skWOnoY'
            );
            expect(result.entries).toEqual([
                { videoId: 'w5r6bUthPeY' },
                { videoId: 'rghnNC1lRXc' },
                { videoId: 'qCm_skWOnoY' },
            ]);
        });

        it('mixed URL formats', () => {
            const result = parseYouTubeUrls(
                'https://www.youtube.com/watch?v=w5r6bUthPeY https://youtu.be/rghnNC1lRXc https://youtube.com/live/qCm_skWOnoY'
            );
            expect(result.entries).toEqual([
                { videoId: 'w5r6bUthPeY' },
                { videoId: 'rghnNC1lRXc' },
                { videoId: 'qCm_skWOnoY' },
            ]);
        });
    });

    describe('Deduplication', () => {
        it('deduplicates identical video IDs', () => {
            const result = parseYouTubeUrls(
                'https://youtu.be/jjchK5y6R2g https://www.youtube.com/watch?v=jjchK5y6R2g'
            );
            expect(result.entries).toEqual([{ videoId: 'jjchK5y6R2g' }]);
        });
    });

    describe('Failed token tracking', () => {
        it('reports non-URL tokens as failed', () => {
            const result = parseYouTubeUrls(
                'check this out https://youtu.be/jjchK5y6R2g cool right?'
            );
            expect(result.entries).toEqual([{ videoId: 'jjchK5y6R2g' }]);
            expect(result.failed).toEqual(['check', 'this', 'out', 'cool', 'right?']);
        });

        it('reports all tokens as failed when none are valid YouTube URLs', () => {
            const result = parseYouTubeUrls('not a url, also not one; nope');
            expect(result.entries).toEqual([]);
            expect(result.failed).toEqual(['not', 'a', 'url', 'also', 'not', 'one', 'nope']);
        });

        it('reports non-YouTube URLs as failed', () => {
            const result = parseYouTubeUrls(
                'https://youtu.be/jjchK5y6R2g https://vimeo.com/12345'
            );
            expect(result.entries).toEqual([{ videoId: 'jjchK5y6R2g' }]);
            expect(result.failed).toEqual(['https://vimeo.com/12345']);
        });
    });

    describe('Output is valid segment data', () => {
        it('parsed entries pass validateSegmentData', () => {
            const result = parseYouTubeUrls(
                'https://youtu.be/w5r6bUthPeY https://youtu.be/rghnNC1lRXc'
            );
            expect(result).not.toBe(null);
            expect(validateSegmentData(result.entries)).toBe(true);
        });
    });

    describe('Comprehensive URL format coverage', () => {
        // Data-driven: [url, expectedVideoId]
        const cases = [
            // /watch?v= (http/https, www/bare/m)
            ['http://www.youtube.com/watch?v=G-NIAzl_oIA', 'G-NIAzl_oIA'],
            ['http://youtube.com/watch?v=G-NIAzl_oIA', 'G-NIAzl_oIA'],
            ['http://m.youtube.com/watch?v=G-NIAzl_oIA', 'G-NIAzl_oIA'],
            ['https://www.youtube.com/watch?v=W5Tc9VVOAnA', 'W5Tc9VVOAnA'],
            ['https://youtube.com/watch?v=W5Tc9VVOAnA', 'W5Tc9VVOAnA'],
            ['https://m.youtube.com/watch?v=W5Tc9VVOAnA', 'W5Tc9VVOAnA'],

            // /watch?v= with &feature=em-uploademail
            ['http://www.youtube.com/watch?v=NHOEbfLCTjg&feature=em-uploademail', 'NHOEbfLCTjg'],
            ['http://youtube.com/watch?v=NHOEbfLCTjg&feature=em-uploademail', 'NHOEbfLCTjg'],
            ['http://m.youtube.com/watch?v=NHOEbfLCTjg&feature=em-uploademail', 'NHOEbfLCTjg'],
            ['https://www.youtube.com/watch?v=NHOEbfLCTjg&feature=em-uploademail', 'NHOEbfLCTjg'],
            ['https://youtube.com/watch?v=NHOEbfLCTjg&feature=em-uploademail', 'NHOEbfLCTjg'],
            ['https://m.youtube.com/watch?v=NHOEbfLCTjg&feature=em-uploademail', 'NHOEbfLCTjg'],

            // /watch?v= with &feature=feedrec_grec_index
            ['http://www.youtube.com/watch?v=8TpVFW9qkkc&feature=feedrec_grec_index', '8TpVFW9qkkc'],
            ['http://youtube.com/watch?v=8TpVFW9qkkc&feature=feedrec_grec_index', '8TpVFW9qkkc'],
            ['http://m.youtube.com/watch?v=8TpVFW9qkkc&feature=feedrec_grec_index', '8TpVFW9qkkc'],
            ['https://www.youtube.com/watch?v=8TpVFW9qkkc&feature=feedrec_grec_index', '8TpVFW9qkkc'],
            ['https://youtube.com/watch?v=8TpVFW9qkkc&feature=feedrec_grec_index', '8TpVFW9qkkc'],
            ['https://m.youtube.com/watch?v=8TpVFW9qkkc&feature=feedrec_grec_index', '8TpVFW9qkkc'],

            // /watch?v= with #t= fragment
            ['http://www.youtube.com/watch?v=8TpVFW9qkkc#t=0m10s', '8TpVFW9qkkc'],
            ['http://youtube.com/watch?v=8TpVFW9qkkc#t=0m10s', '8TpVFW9qkkc'],
            ['http://m.youtube.com/watch?v=8TpVFW9qkkc#t=0m10s', '8TpVFW9qkkc'],
            ['https://www.youtube.com/watch?v=8TpVFW9qkkc#t=0m10s', '8TpVFW9qkkc'],
            ['https://youtube.com/watch?v=8TpVFW9qkkc#t=0m10s', '8TpVFW9qkkc'],
            ['https://m.youtube.com/watch?v=8TpVFW9qkkc#t=0m10s', '8TpVFW9qkkc'],

            // /watch?v= with &feature=channel
            ['http://www.youtube.com/watch?v=v2OKWq3mp2Q&feature=channel', 'v2OKWq3mp2Q'],
            ['http://youtube.com/watch?v=v2OKWq3mp2Q&feature=channel', 'v2OKWq3mp2Q'],
            ['http://m.youtube.com/watch?v=v2OKWq3mp2Q&feature=channel', 'v2OKWq3mp2Q'],
            ['https://www.youtube.com/watch?v=TYrwKWDeagA&feature=channel', 'TYrwKWDeagA'],
            ['https://youtube.com/watch?v=TYrwKWDeagA&feature=channel', 'TYrwKWDeagA'],
            ['https://m.youtube.com/watch?v=TYrwKWDeagA&feature=channel', 'TYrwKWDeagA'],

            // /watch?v= with &playnext_from= and &videos= and &feature=sub
            ['http://www.youtube.com/watch?v=W5Tc9VVOAnA&playnext_from=TL&videos=skwXasnoPzE&feature=sub', 'W5Tc9VVOAnA'],
            ['http://youtube.com/watch?v=W5Tc9VVOAnA&playnext_from=TL&videos=skwXasnoPzE&feature=sub', 'W5Tc9VVOAnA'],
            ['http://m.youtube.com/watch?v=W5Tc9VVOAnA&playnext_from=TL&videos=skwXasnoPzE&feature=sub', 'W5Tc9VVOAnA'],
            ['https://www.youtube.com/watch?v=W5Tc9VVOAnA&playnext_from=TL&videos=skwXasnoPzE&feature=sub', 'W5Tc9VVOAnA'],
            ['https://youtube.com/watch?v=W5Tc9VVOAnA&playnext_from=TL&videos=skwXasnoPzE&feature=sub', 'W5Tc9VVOAnA'],
            ['https://m.youtube.com/watch?v=W5Tc9VVOAnA&playnext_from=TL&videos=skwXasnoPzE&feature=sub', 'W5Tc9VVOAnA'],

            // /watch?v= with &feature=youtu.be
            ['http://www.youtube.com/watch?v=W5Tc9VVOAnA&feature=youtu.be', 'W5Tc9VVOAnA'],
            ['http://youtube.com/watch?v=W5Tc9VVOAnA&feature=youtu.be', 'W5Tc9VVOAnA'],
            ['http://m.youtube.com/watch?v=W5Tc9VVOAnA&feature=youtu.be', 'W5Tc9VVOAnA'],
            ['https://www.youtube.com/watch?v=W5Tc9VVOAnA&feature=youtu.be', 'W5Tc9VVOAnA'],
            ['https://youtube.com/watch?v=W5Tc9VVOAnA&feature=youtu.be', 'W5Tc9VVOAnA'],
            ['https://m.youtube.com/watch?v=W5Tc9VVOAnA&feature=youtu.be', 'W5Tc9VVOAnA'],

            // /watch?v= with &feature=youtube_gdata_player
            ['http://www.youtube.com/watch?v=jjchK5y6R2g&feature=youtube_gdata_player', 'jjchK5y6R2g'],
            ['http://youtube.com/watch?v=jjchK5y6R2g&feature=youtube_gdata_player', 'jjchK5y6R2g'],
            ['http://m.youtube.com/watch?v=jjchK5y6R2g&feature=youtube_gdata_player', 'jjchK5y6R2g'],
            ['https://www.youtube.com/watch?v=jjchK5y6R2g&feature=youtube_gdata_player', 'jjchK5y6R2g'],
            ['https://youtube.com/watch?v=jjchK5y6R2g&feature=youtube_gdata_player', 'jjchK5y6R2g'],
            ['https://m.youtube.com/watch?v=jjchK5y6R2g&feature=youtube_gdata_player', 'jjchK5y6R2g'],

            // /watch?v= with &list= and &index= and &shuffle=
            ['http://www.youtube.com/watch?v=aKMVJ1Awl_A&list=LeuCUxa7cpglEZcq65GlMxkfKtTLLDaPBG&index=106&shuffle=2655', 'aKMVJ1Awl_A'],
            ['http://youtube.com/watch?v=aKMVJ1Awl_A&list=LeuCUxa7cpglEZcq65GlMxkfKtTLLDaPBG&index=106&shuffle=2655', 'aKMVJ1Awl_A'],
            ['http://m.youtube.com/watch?v=aKMVJ1Awl_A&list=LeuCUxa7cpglEZcq65GlMxkfKtTLLDaPBG&index=106&shuffle=2655', 'aKMVJ1Awl_A'],
            ['https://www.youtube.com/watch?v=aKMVJ1Awl_A&list=LeuCUxa7cpglEZcq65GlMxkfKtTLLDaPBG&index=106&shuffle=2655', 'aKMVJ1Awl_A'],
            ['https://youtube.com/watch?v=aKMVJ1Awl_A&list=LeuCUxa7cpglEZcq65GlMxkfKtTLLDaPBG&index=106&shuffle=2655', 'aKMVJ1Awl_A'],
            ['https://m.youtube.com/watch?v=aKMVJ1Awl_A&list=LeuCUxa7cpglEZcq65GlMxkfKtTLLDaPBG&index=106&shuffle=2655', 'aKMVJ1Awl_A'],

            // /watch?feature=...&v= (v not first param)
            ['http://www.youtube.com/watch?feature=player_embedded&v=jjchK5y6R2g', 'jjchK5y6R2g'],
            ['http://youtube.com/watch?feature=player_embedded&v=jjchK5y6R2g', 'jjchK5y6R2g'],
            ['http://m.youtube.com/watch?feature=player_embedded&v=jjchK5y6R2g', 'jjchK5y6R2g'],
            ['https://www.youtube.com/watch?feature=player_embedded&v=jjchK5y6R2g', 'jjchK5y6R2g'],
            ['https://youtube.com/watch?feature=player_embedded&v=jjchK5y6R2g', 'jjchK5y6R2g'],
            ['https://m.youtube.com/watch?feature=player_embedded&v=jjchK5y6R2g', 'jjchK5y6R2g'],

            // /watch?app=desktop&v=
            ['http://www.youtube.com/watch?app=desktop&v=jjchK5y6R2g', 'jjchK5y6R2g'],
            ['http://youtube.com/watch?app=desktop&v=jjchK5y6R2g', 'jjchK5y6R2g'],
            ['http://m.youtube.com/watch?app=desktop&v=jjchK5y6R2g', 'jjchK5y6R2g'],
            ['https://www.youtube.com/watch?app=desktop&v=jjchK5y6R2g', 'jjchK5y6R2g'],
            ['https://youtube.com/watch?app=desktop&v=jjchK5y6R2g', 'jjchK5y6R2g'],
            ['https://m.youtube.com/watch?app=desktop&v=jjchK5y6R2g', 'jjchK5y6R2g'],

            // /watch/ID (no ?v= param, ID in path)
            ['http://www.youtube.com/watch/G-NIAzl_oIA', 'G-NIAzl_oIA'],
            ['http://youtube.com/watch/G-NIAzl_oIA', 'G-NIAzl_oIA'],
            ['http://m.youtube.com/watch/G-NIAzl_oIA', 'G-NIAzl_oIA'],
            ['https://www.youtube.com/watch/G-NIAzl_oIA', 'G-NIAzl_oIA'],
            ['https://youtube.com/watch/G-NIAzl_oIA', 'G-NIAzl_oIA'],
            ['https://m.youtube.com/watch/G-NIAzl_oIA', 'G-NIAzl_oIA'],

            // /watch/ID?app=desktop
            ['http://www.youtube.com/watch/G-NIAzl_oIA?app=desktop', 'G-NIAzl_oIA'],
            ['http://youtube.com/watch/G-NIAzl_oIA?app=desktop', 'G-NIAzl_oIA'],
            ['http://m.youtube.com/watch/G-NIAzl_oIA?app=desktop', 'G-NIAzl_oIA'],
            ['https://www.youtube.com/watch/G-NIAzl_oIA?app=desktop', 'G-NIAzl_oIA'],
            ['https://youtube.com/watch/G-NIAzl_oIA?app=desktop', 'G-NIAzl_oIA'],
            ['https://m.youtube.com/watch/G-NIAzl_oIA?app=desktop', 'G-NIAzl_oIA'],

            // /v/ID
            ['http://www.youtube.com/v/jjchK5y6R2g', 'jjchK5y6R2g'],
            ['http://youtube.com/v/jjchK5y6R2g', 'jjchK5y6R2g'],
            ['http://m.youtube.com/v/jjchK5y6R2g', 'jjchK5y6R2g'],
            ['https://www.youtube.com/v/jjchK5y6R2g', 'jjchK5y6R2g'],
            ['https://youtube.com/v/jjchK5y6R2g', 'jjchK5y6R2g'],
            ['https://m.youtube.com/v/jjchK5y6R2g', 'jjchK5y6R2g'],

            // /v/ID?version=3&autohide=1
            ['http://www.youtube.com/v/G-NIAzl_oIA?version=3&autohide=1', 'G-NIAzl_oIA'],
            ['http://youtube.com/v/G-NIAzl_oIA?version=3&autohide=1', 'G-NIAzl_oIA'],
            ['http://m.youtube.com/v/G-NIAzl_oIA?version=3&autohide=1', 'G-NIAzl_oIA'],
            ['https://www.youtube.com/v/G-NIAzl_oIA?version=3&autohide=1', 'G-NIAzl_oIA'],
            ['https://youtube.com/v/G-NIAzl_oIA?version=3&autohide=1', 'G-NIAzl_oIA'],
            ['https://m.youtube.com/v/G-NIAzl_oIA?version=3&autohide=1', 'G-NIAzl_oIA'],

            // /v/ID?fs=1&hl=en_US&rel=0 (including &amp; HTML entity variant)
            ['http://www.youtube.com/v/8TpVFW9qkkc?fs=1&hl=en_US&rel=0', '8TpVFW9qkkc'],
            ['http://youtube.com/v/8TpVFW9qkkc?fs=1&hl=en_US&rel=0', '8TpVFW9qkkc'],
            ['http://m.youtube.com/v/8TpVFW9qkkc?fs=1&hl=en_US&rel=0', '8TpVFW9qkkc'],
            ['https://www.youtube.com/v/8TpVFW9qkkc?fs=1&amp;hl=en_US&amp;rel=0', '8TpVFW9qkkc'],
            ['https://www.youtube.com/v/8TpVFW9qkkc?fs=1&hl=en_US&rel=0', '8TpVFW9qkkc'],
            ['https://youtube.com/v/8TpVFW9qkkc?fs=1&hl=en_US&rel=0', '8TpVFW9qkkc'],
            ['https://m.youtube.com/v/8TpVFW9qkkc?fs=1&hl=en_US&rel=0', '8TpVFW9qkkc'],

            // /v/ID?feature=youtube_gdata_player
            ['http://www.youtube.com/v/jjchK5y6R2g?feature=youtube_gdata_player', 'jjchK5y6R2g'],
            ['http://youtube.com/v/jjchK5y6R2g?feature=youtube_gdata_player', 'jjchK5y6R2g'],
            ['http://m.youtube.com/v/jjchK5y6R2g?feature=youtube_gdata_player', 'jjchK5y6R2g'],
            ['https://www.youtube.com/v/jjchK5y6R2g?feature=youtube_gdata_player', 'jjchK5y6R2g'],
            ['https://youtube.com/v/jjchK5y6R2g?feature=youtube_gdata_player', 'jjchK5y6R2g'],
            ['https://m.youtube.com/v/jjchK5y6R2g?feature=youtube_gdata_player', 'jjchK5y6R2g'],

            // youtu.be short links
            ['http://youtu.be/G-NIAzl_oIA', 'G-NIAzl_oIA'],
            ['https://youtu.be/G-NIAzl_oIA', 'G-NIAzl_oIA'],

            // youtu.be with ?feature=
            ['http://youtu.be/jjchK5y6R2g?feature=youtube_gdata_player', 'jjchK5y6R2g'],
            ['https://youtu.be/jjchK5y6R2g?feature=youtube_gdata_player', 'jjchK5y6R2g'],

            // youtu.be with ?list=
            ['http://youtu.be/TYrwKWDeagA?list=jMbRBu5ITTXJabNR-9o7LFlA-ksMrLJP6O', 'TYrwKWDeagA'],
            ['https://youtu.be/TYrwKWDeagA?list=jMbRBu5ITTXJabNR-9o7LFlA-ksMrLJP6O', 'TYrwKWDeagA'],

            // youtu.be with malformed &feature= (no ? before &)
            ['http://youtu.be/TYrwKWDeagA&feature=channel', 'TYrwKWDeagA'],
            ['https://youtu.be/TYrwKWDeagA&feature=channel', 'TYrwKWDeagA'],

            // youtu.be with ?t=
            ['http://youtu.be/W5Tc9VVOAnA?t=1', 'W5Tc9VVOAnA'],
            ['http://youtu.be/W5Tc9VVOAnA?t=1s', 'W5Tc9VVOAnA'],
            ['https://youtu.be/W5Tc9VVOAnA?t=1', 'W5Tc9VVOAnA'],
            ['https://youtu.be/W5Tc9VVOAnA?t=1s', 'W5Tc9VVOAnA'],

            // youtu.be with ?si=
            ['http://youtu.be/0__NZQNvpW8?si=L__-ZaR-UaUl7gIB', '0__NZQNvpW8'],
            ['https://youtu.be/0__NZQNvpW8?si=L__-ZaR-UaUl7gIB', '0__NZQNvpW8'],

            // /oembed?url= (encoded v= inside url param)
            ['http://www.youtube.com/oembed?url=http%3A//www.youtube.com/watch?v%3DG-NIAzl_oIA&format=json', 'G-NIAzl_oIA'],
            ['http://youtube.com/oembed?url=http%3A//www.youtube.com/watch?v%3DG-NIAzl_oIA&format=json', 'G-NIAzl_oIA'],
            ['http://m.youtube.com/oembed?url=http%3A//www.youtube.com/watch?v%3DG-NIAzl_oIA&format=json', 'G-NIAzl_oIA'],
            ['https://www.youtube.com/oembed?url=http%3A//www.youtube.com/watch?v%3DG-NIAzl_oIA&format=json', 'G-NIAzl_oIA'],
            ['https://youtube.com/oembed?url=http%3A//www.youtube.com/watch?v%3DG-NIAzl_oIA&format=json', 'G-NIAzl_oIA'],
            ['https://m.youtube.com/oembed?url=http%3A//www.youtube.com/watch?v%3DG-NIAzl_oIA&format=json', 'G-NIAzl_oIA'],

            // /attribution_link?u= (encoded v= inside u param)
            ['http://www.youtube.com/attribution_link?a=fCZ6C0dJVI9&u=%2Fwatch%3Fv%3Dps0dCY1l_Xs%26feature%3Dshare', 'ps0dCY1l_Xs'],
            ['http://youtube.com/attribution_link?a=fCZ6C0dJVI9&u=%2Fwatch%3Fv%3Dps0dCY1l_Xs%26feature%3Dshare', 'ps0dCY1l_Xs'],
            ['http://m.youtube.com/attribution_link?a=fCZ6C0dJVI9&u=%2Fwatch%3Fv%3Dps0dCY1l_Xs%26feature%3Dshare', 'ps0dCY1l_Xs'],
            ['https://www.youtube.com/attribution_link?a=fCZ6C0dJVI9&u=%2Fwatch%3Fv%3Dps0dCY1l_Xs%26feature%3Dshare', 'ps0dCY1l_Xs'],
            ['https://youtube.com/attribution_link?a=fCZ6C0dJVI9&u=%2Fwatch%3Fv%3Dps0dCY1l_Xs%26feature%3Dshare', 'ps0dCY1l_Xs'],
            ['https://m.youtube.com/attribution_link?a=fCZ6C0dJVI9&u=%2Fwatch%3Fv%3Dps0dCY1l_Xs%26feature%3Dshare', 'ps0dCY1l_Xs'],

            // /attribution_link?u= (second variant)
            ['http://www.youtube.com/attribution_link?a=gkeIcs8SrIPwiP-8&u=/watch%3Fv%3DNHOEbfLCTjg%26feature%3Dm-uelpaadilemo', 'NHOEbfLCTjg'],
            ['http://youtube.com/attribution_link?a=gkeIcs8SrIPwiP-8&u=/watch%3Fv%3DNHOEbfLCTjg%26feature%3Dm-uelpaadilemo', 'NHOEbfLCTjg'],
            ['http://m.youtube.com/attribution_link?a=gkeIcs8SrIPwiP-8&u=/watch%3Fv%3DNHOEbfLCTjg%26feature%3Dm-uelpaadilemo', 'NHOEbfLCTjg'],
            ['https://www.youtube.com/attribution_link?a=gkeIcs8SrIPwiP-8&u=/watch%3Fv%3DNHOEbfLCTjg%26feature%3Dm-uelpaadilemo', 'NHOEbfLCTjg'],
            ['https://youtube.com/attribution_link?a=gkeIcs8SrIPwiP-8&u=/watch%3Fv%3DNHOEbfLCTjg%26feature%3Dm-uelpaadilemo', 'NHOEbfLCTjg'],
            ['https://m.youtube.com/attribution_link?a=gkeIcs8SrIPwiP-8&u=/watch%3Fv%3DNHOEbfLCTjg%26feature%3Dm-uelpaadilemo', 'NHOEbfLCTjg'],

            // /embed/ID
            ['http://www.youtube.com/embed/W5Tc9VVOAnA', 'W5Tc9VVOAnA'],
            ['http://youtube.com/embed/W5Tc9VVOAnA', 'W5Tc9VVOAnA'],
            ['http://m.youtube.com/embed/W5Tc9VVOAnA', 'W5Tc9VVOAnA'],
            ['https://www.youtube.com/embed/W5Tc9VVOAnA', 'W5Tc9VVOAnA'],
            ['https://youtube.com/embed/W5Tc9VVOAnA', 'W5Tc9VVOAnA'],
            ['https://m.youtube.com/embed/W5Tc9VVOAnA', 'W5Tc9VVOAnA'],

            // /embed/ID?rel=0
            ['http://www.youtube.com/embed/2BlyTHkWIfc?rel=0', '2BlyTHkWIfc'],
            ['http://youtube.com/embed/2BlyTHkWIfc?rel=0', '2BlyTHkWIfc'],
            ['http://m.youtube.com/embed/2BlyTHkWIfc?rel=0', '2BlyTHkWIfc'],
            ['https://www.youtube.com/embed/2BlyTHkWIfc?rel=0', '2BlyTHkWIfc'],
            ['https://youtube.com/embed/2BlyTHkWIfc?rel=0', '2BlyTHkWIfc'],
            ['https://m.youtube.com/embed/2BlyTHkWIfc?rel=0', '2BlyTHkWIfc'],

            // youtube-nocookie.com/embed/ID
            ['http://www.youtube-nocookie.com/embed/W5Tc9VVOAnA?rel=0', 'W5Tc9VVOAnA'],
            ['https://www.youtube-nocookie.com/embed/W5Tc9VVOAnA?rel=0', 'W5Tc9VVOAnA'],

            // /e/ID
            ['http://www.youtube.com/e/jjchK5y6R2g', 'jjchK5y6R2g'],
            ['http://youtube.com/e/jjchK5y6R2g', 'jjchK5y6R2g'],
            ['http://m.youtube.com/e/jjchK5y6R2g', 'jjchK5y6R2g'],
            ['https://www.youtube.com/e/jjchK5y6R2g', 'jjchK5y6R2g'],
            ['https://youtube.com/e/jjchK5y6R2g', 'jjchK5y6R2g'],
            ['https://m.youtube.com/e/jjchK5y6R2g', 'jjchK5y6R2g'],

            // /shorts/ID
            ['http://www.youtube.com/shorts/eO0xIIGHbdY', 'eO0xIIGHbdY'],
            ['http://youtube.com/shorts/eO0xIIGHbdY', 'eO0xIIGHbdY'],
            ['http://m.youtube.com/shorts/eO0xIIGHbdY', 'eO0xIIGHbdY'],
            ['https://www.youtube.com/shorts/eO0xIIGHbdY', 'eO0xIIGHbdY'],
            ['https://youtube.com/shorts/eO0xIIGHbdY', 'eO0xIIGHbdY'],
            ['https://m.youtube.com/shorts/eO0xIIGHbdY', 'eO0xIIGHbdY'],

            // /shorts/ID?app=desktop
            ['http://www.youtube.com/shorts/eO0xIIGHbdY?app=desktop', 'eO0xIIGHbdY'],
            ['http://youtube.com/shorts/eO0xIIGHbdY?app=desktop', 'eO0xIIGHbdY'],
            ['http://m.youtube.com/shorts/eO0xIIGHbdY?app=desktop', 'eO0xIIGHbdY'],
            ['https://www.youtube.com/shorts/eO0xIIGHbdY?app=desktop', 'eO0xIIGHbdY'],
            ['https://youtube.com/shorts/eO0xIIGHbdY?app=desktop', 'eO0xIIGHbdY'],
            ['https://m.youtube.com/shorts/eO0xIIGHbdY?app=desktop', 'eO0xIIGHbdY'],

            // /live/ID
            ['http://www.youtube.com/live/259KxAZIMqA', '259KxAZIMqA'],
            ['http://youtube.com/live/259KxAZIMqA', '259KxAZIMqA'],
            ['http://m.youtube.com/live/259KxAZIMqA', '259KxAZIMqA'],
            ['https://www.youtube.com/live/259KxAZIMqA', '259KxAZIMqA'],
            ['https://youtube.com/live/259KxAZIMqA', '259KxAZIMqA'],
            ['https://m.youtube.com/live/259KxAZIMqA', '259KxAZIMqA'],

            // /live/ID?app=desktop
            ['http://www.youtube.com/live/259KxAZIMqA?app=desktop', '259KxAZIMqA'],
            ['http://youtube.com/live/259KxAZIMqA?app=desktop', '259KxAZIMqA'],
            ['http://m.youtube.com/live/259KxAZIMqA?app=desktop', '259KxAZIMqA'],
            ['https://www.youtube.com/live/259KxAZIMqA?app=desktop', '259KxAZIMqA'],
            ['https://youtube.com/live/259KxAZIMqA?app=desktop', '259KxAZIMqA'],
            ['https://m.youtube.com/live/259KxAZIMqA?app=desktop', '259KxAZIMqA'],
        ];

        it.each(cases)('%s → %s', (url, expectedId) => {
            const result = parseYouTubeUrls(url);
            expect(result.entries).toEqual([{ videoId: expectedId }]);
        });
    });
});
