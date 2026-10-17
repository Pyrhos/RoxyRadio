import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { decodeQueue, encodeQueue, resolveQueue } from './queue-transfer.js';

const SEGMENTS = [
    { videoId: 'aaaaaaaaaaa', name: '日本語 💜', songs: [
        { name: 'First song', range: [10, 20] },
        { name: 'Second song', range: [30.5, 40.5] },
    ] },
    { videoId: 'bbbbbbbbbbb', songs: [] },
    { videoId: 'ccccccccccc' },
];

const encodeData = data => Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
const exportData = items => ({ type: 'rourin-radio-queue', version: 1, items });

describe('queue transfer', () => {
    it('round-trips song and whole-video references in order, including duplicates', () => {
        const queue = [
            { videoId: 'aaaaaaaaaaa', rIdx: 1 },
            { videoId: 'bbbbbbbbbbb', rIdx: 0 },
            { videoId: 'aaaaaaaaaaa', rIdx: 1 },
            { videoId: 'ccccccccccc', rIdx: 0 },
        ];
        const exported = encodeQueue(queue, SEGMENTS);
        expect(exported.count).toBe(4);
        expect(exported.skipped).toBe(0);
        const items = decodeQueue(exported.text);
        expect(items).toEqual([
            { videoId: 'aaaaaaaaaaa', range: [30.5, 40.5] },
            { videoId: 'bbbbbbbbbbb', range: null },
            { videoId: 'aaaaaaaaaaa', range: [30.5, 40.5] },
            { videoId: 'ccccccccccc', range: null },
        ]);
        expect(resolveQueue(items, SEGMENTS)).toEqual({ queue, skipped: 0 });
        expect(atob(exported.text)).not.toContain('songs');
        expect(atob(exported.text)).not.toContain('name');
    });

    it('uses timestamps when the recipient has a different song ordering', () => {
        const exported = encodeQueue([{ videoId: 'aaaaaaaaaaa', rIdx: 1 }], SEGMENTS);
        const reordered = [{ ...SEGMENTS[0], songs: [...SEGMENTS[0].songs].reverse() }];
        expect(resolveQueue(decodeQueue(exported.text), reordered)).toEqual({
            queue: [{ videoId: 'aaaaaaaaaaa', rIdx: 0 }], skipped: 0,
        });
    });

    it('skips missing streams, changed ranges, and mismatched whole-video references', () => {
        expect(resolveQueue([
            { videoId: 'missing', range: [10, 20] },
            { videoId: 'aaaaaaaaaaa', range: [11, 20] },
            { videoId: 'aaaaaaaaaaa', range: null },
            { videoId: 'bbbbbbbbbbb', range: [0, 100] },
            { videoId: 'aaaaaaaaaaa', range: [10, 20] },
        ], SEGMENTS)).toEqual({ queue: [{ videoId: 'aaaaaaaaaaa', rIdx: 0 }], skipped: 4 });
    });

    it('reports unavailable export entries without changing the source queue', () => {
        const queue = [
            { videoId: 'missing', rIdx: 0 },
            { videoId: 'aaaaaaaaaaa', rIdx: 99 },
            { videoId: 'bbbbbbbbbbb', rIdx: 1 },
            { videoId: 'aaaaaaaaaaa', rIdx: -1 },
            { videoId: 'aaaaaaaaaaa', rIdx: 0.5 },
            { videoId: 'aaaaaaaaaaa', rIdx: 0 },
        ];
        const original = structuredClone(queue);
        const exported = encodeQueue(queue, SEGMENTS);
        expect(exported.count).toBe(1);
        expect(exported.skipped).toBe(5);
        expect(queue).toEqual(original);
    });

    it.each(['', 'not base64!', 'https://youtu.be/aaaaaaaaaaa', JSON.stringify(SEGMENTS), encodeData(SEGMENTS)])(
        'does not classify other clipboard content as a queue: %s', text => {
            expect(decodeQueue(text)).toBeNull();
        },
    );

    it.each([
        null,
        [{ videoId: 'aaaaaaaaaaa' }],
        [{ videoId: '', range: null }],
        [{ videoId: 'aaaaaaaaaaa', range: [10] }],
        [{ videoId: 'aaaaaaaaaaa', range: ['10', 20] }],
        [{ videoId: 'aaaaaaaaaaa', range: [-1, 20] }],
        [{ videoId: 'aaaaaaaaaaa', range: [20, 10] }],
        [{ videoId: 'aaaaaaaaaaa', range: [10, 10] }],
    ].map(items => [items]))('rejects malformed queue entries: %j', items => {
        expect(() => decodeQueue(encodeData(exportData(items)))).toThrow('Not a valid queue export');
    });

    it('rejects unsupported versions before trying to import their entries', () => {
        expect(() => decodeQueue(encodeData({ ...exportData([]), version: 2 })))
            .toThrow('Unsupported queue export version');
    });

    it('accepts line wrapping and surrounding whitespace in exported text', () => {
        const exported = encodeQueue([{ videoId: 'aaaaaaaaaaa', rIdx: 0 }], SEGMENTS);
        const wrapped = `\n ${exported.text.match(/.{1,20}/g).join('\n')} \n`;
        expect(decodeQueue(wrapped)).toEqual([{ videoId: 'aaaaaaaaaaa', range: [10, 20] }]);
    });
});
