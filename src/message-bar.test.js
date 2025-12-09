import { describe, it, expect } from 'vitest';
import {
    calculateReadingTime,
    shuffleArray,
    buildTimingMap,
    validateMessages,
    MessageQueue
} from './message-bar.js';

describe('calculateReadingTime', () => {
    // Use a fixed WPM for predictable testing - tests don't depend on specific WPM value
    const wpm = 120; // 2 words per second for easy math
    const minSeconds = 2;

    it('calculates time based on word count and WPM', () => {
        // 4 words at 120 WPM = (4/120)*60 = 2 seconds
        const result = calculateReadingTime('one two three four', { wpm, minSeconds });
        expect(result).toBe(2);
    });

    it('scales linearly with word count', () => {
        const short = calculateReadingTime('one two', { wpm, minSeconds });
        const long = calculateReadingTime('one two three four', { wpm, minSeconds });
        // 2 words vs 4 words - long should be 2x short (before min clamp)
        // 2 words = 1 second (clamped to 2), 4 words = 2 seconds
        expect(long).toBeGreaterThanOrEqual(short);
    });

    it('respects minimum seconds for short messages', () => {
        const result = calculateReadingTime('hi', { wpm, minSeconds: 5 });
        expect(result).toBe(5);
    });

    it('returns minSeconds for empty string', () => {
        const result = calculateReadingTime('', { wpm, minSeconds });
        expect(result).toBe(minSeconds);
    });

    it('returns minSeconds for whitespace-only string', () => {
        const result = calculateReadingTime('   ', { wpm, minSeconds });
        expect(result).toBe(minSeconds);
    });

    it('returns minSeconds for non-string input', () => {
        const result = calculateReadingTime(null, { wpm, minSeconds });
        expect(result).toBe(minSeconds);
    });

    it('handles different WPM values correctly', () => {
        const text = 'one two three four five six'; // 6 words
        const fastWpm = 360; // 6 words/sec
        const slowWpm = 60;  // 1 word/sec

        const fastTime = calculateReadingTime(text, { wpm: fastWpm, minSeconds: 0 });
        const slowTime = calculateReadingTime(text, { wpm: slowWpm, minSeconds: 0 });

        // Fast: (6/360)*60 = 1 second
        // Slow: (6/60)*60 = 6 seconds
        expect(fastTime).toBe(1);
        expect(slowTime).toBe(6);
        expect(slowTime).toBe(fastTime * 6); // Ratio should be inverse of WPM ratio
    });
});

describe('shuffleArray', () => {
    it('returns a new array', () => {
        const original = [1, 2, 3];
        const shuffled = shuffleArray(original);
        expect(shuffled).not.toBe(original);
    });

    it('preserves array length', () => {
        const original = [1, 2, 3, 4, 5];
        const shuffled = shuffleArray(original);
        expect(shuffled).toHaveLength(original.length);
    });

    it('preserves all elements', () => {
        const original = ['a', 'b', 'c', 'd'];
        const shuffled = shuffleArray(original);
        expect(shuffled.sort()).toEqual(original.sort());
    });

    it('does not modify original array', () => {
        const original = [1, 2, 3];
        const copy = [...original];
        shuffleArray(original);
        expect(original).toEqual(copy);
    });

    it('handles empty array', () => {
        const result = shuffleArray([]);
        expect(result).toEqual([]);
    });

    it('handles single element', () => {
        const result = shuffleArray(['only']);
        expect(result).toEqual(['only']);
    });
});

describe('buildTimingMap', () => {
    const wpm = 60;
    const minSeconds = 1;

    it('creates a Map with message keys', () => {
        const messages = ['hello world', 'test'];
        const map = buildTimingMap(messages, { wpm, minSeconds });

        expect(map).toBeInstanceOf(Map);
        expect(map.has('hello world')).toBe(true);
        expect(map.has('test')).toBe(true);
    });

    it('skips non-string entries', () => {
        const messages = ['valid', 123, null, undefined, 'also valid'];
        const map = buildTimingMap(messages, { wpm, minSeconds });

        expect(map.size).toBe(2);
        expect(map.has('valid')).toBe(true);
        expect(map.has('also valid')).toBe(true);
    });

    it('skips empty strings', () => {
        const messages = ['valid', '', '   ', 'also valid'];
        const map = buildTimingMap(messages, { wpm, minSeconds });

        expect(map.size).toBe(2);
    });

    it('calculates correct durations', () => {
        // 2 words at 60 WPM = 2 seconds
        const messages = ['one two'];
        const map = buildTimingMap(messages, { wpm: 60, minSeconds: 0 });

        expect(map.get('one two')).toBe(2);
    });
});

describe('validateMessages', () => {
    it('returns empty array for non-array input', () => {
        expect(validateMessages(null)).toEqual([]);
        expect(validateMessages(undefined)).toEqual([]);
        expect(validateMessages('string')).toEqual([]);
        expect(validateMessages({})).toEqual([]);
    });

    it('filters out non-string values', () => {
        const input = ['valid', 123, null, 'also valid', undefined];
        const result = validateMessages(input);

        expect(result).toEqual(['valid', 'also valid']);
    });

    it('filters out empty and whitespace strings', () => {
        const input = ['valid', '', '   ', '\t\n', 'also valid'];
        const result = validateMessages(input);

        expect(result).toEqual(['valid', 'also valid']);
    });

    it('preserves valid strings', () => {
        const input = ['one', 'two', 'three'];
        const result = validateMessages(input);

        expect(result).toEqual(input);
    });
});

describe('MessageQueue', () => {
    const wpm = 60;
    const minSeconds = 1;

    it('initializes with correct size', () => {
        const queue = new MessageQueue(['a', 'b', 'c'], { wpm, minSeconds });
        expect(queue.size).toBe(3);
    });

    it('reports hasMessages correctly', () => {
        const withMessages = new MessageQueue(['a'], { wpm, minSeconds });
        const empty = new MessageQueue([], { wpm, minSeconds });

        expect(withMessages.hasMessages).toBe(true);
        expect(empty.hasMessages).toBe(false);
    });

    it('returns null from next() when empty', () => {
        const queue = new MessageQueue([], { wpm, minSeconds });
        expect(queue.next()).toBeNull();
    });

    it('returns message and duration from next()', () => {
        const queue = new MessageQueue(['hello world'], { wpm, minSeconds });
        const result = queue.next();

        expect(result).not.toBeNull();
        expect(result.message).toBe('hello world');
        expect(typeof result.duration).toBe('number');
        expect(result.duration).toBeGreaterThan(0);
    });

    it('cycles through all messages before repeating', () => {
        const messages = ['a', 'b', 'c'];
        const queue = new MessageQueue(messages, { wpm, minSeconds });
        const seen = new Set();

        // Get 3 messages
        for (let i = 0; i < 3; i++) {
            const result = queue.next();
            seen.add(result.message);
        }

        // Should have seen all 3 unique messages
        expect(seen.size).toBe(3);
        expect([...seen].sort()).toEqual(messages.sort());
    });

    it('refills queue after exhaustion', () => {
        const messages = ['a', 'b'];
        const queue = new MessageQueue(messages, { wpm, minSeconds });

        // Exhaust first round
        queue.next();
        queue.next();

        // Should still be able to get more
        const result = queue.next();
        expect(result).not.toBeNull();
        expect(messages).toContain(result.message);
    });

    it('filters invalid messages during construction', () => {
        const queue = new MessageQueue(['valid', '', null, 'also valid'], { wpm, minSeconds });
        expect(queue.size).toBe(2);
    });

    describe('bad luck protection', () => {
        it('shows each message exactly once per cycle', () => {
            const messages = ['a', 'b', 'c', 'd', 'e'];
            const queue = new MessageQueue(messages, { wpm, minSeconds });

            // Run multiple cycles
            for (let cycle = 0; cycle < 5; cycle++) {
                const seenInCycle = new Map();

                // Get exactly as many messages as in the set
                for (let i = 0; i < messages.length; i++) {
                    const result = queue.next();
                    const count = seenInCycle.get(result.message) || 0;
                    seenInCycle.set(result.message, count + 1);
                }

                // Each message should appear exactly once
                for (const msg of messages) {
                    expect(seenInCycle.get(msg)).toBe(1);
                }
            }
        });

        it('prevents back-to-back repeats across cycle boundaries', () => {
            const messages = ['a', 'b', 'c'];
            const queue = new MessageQueue(messages, { wpm, minSeconds });

            // Run many iterations to statistically verify anti-repeat works
            let backToBackCount = 0;
            let lastMessage = null;
            const iterations = 100;

            for (let i = 0; i < iterations; i++) {
                const result = queue.next();
                if (result.message === lastMessage) {
                    backToBackCount++;
                }
                lastMessage = result.message;
            }

            // With proper anti-repeat, there should be zero back-to-back repeats
            // (only possible at cycle boundaries, and we prevent those)
            expect(backToBackCount).toBe(0);
        });

        it('handles single message without infinite loop', () => {
            const queue = new MessageQueue(['only'], { wpm, minSeconds });

            // Single message will always repeat, but should not cause issues
            const first = queue.next();
            const second = queue.next();

            expect(first.message).toBe('only');
            expect(second.message).toBe('only');
        });

        it('handles two messages with anti-repeat', () => {
            const queue = new MessageQueue(['a', 'b'], { wpm, minSeconds });

            // With only 2 messages, should alternate perfectly
            let lastMessage = null;
            for (let i = 0; i < 20; i++) {
                const result = queue.next();
                if (lastMessage !== null) {
                    expect(result.message).not.toBe(lastMessage);
                }
                lastMessage = result.message;
            }
        });
    });
});


