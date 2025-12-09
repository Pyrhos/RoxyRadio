/**
 * Calculate reading time for a text based on words per minute.
 * @param {string} text - The message text
 * @param {object} options - Configuration options
 * @param {number} options.wpm - Words per minute reading speed
 * @param {number} options.minSeconds - Minimum display time in seconds
 * @returns {number} Display duration in seconds
 */
export function calculateReadingTime(text, { wpm, minSeconds }) {
    if (typeof text !== 'string' || !text.trim()) {
        return minSeconds;
    }
    const words = text.trim().split(/\s+/).length;
    const seconds = (words / wpm) * 60;
    return Math.max(seconds, minSeconds);
}

export function shuffleArray(arr) {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

export function buildTimingMap(messages, { wpm, minSeconds }) {
    const timings = new Map();
    for (const msg of messages) {
        if (typeof msg === 'string' && msg.trim().length > 0) {
            timings.set(msg, calculateReadingTime(msg, { wpm, minSeconds }));
        }
    }
    return timings;
}

export function validateMessages(messages) {
    if (!Array.isArray(messages)) {
        return [];
    }
    return messages.filter(m => typeof m === 'string' && m.trim().length > 0);
}

export class MessageQueue {
    constructor(messages, { wpm, minSeconds }) {
        this.timings = buildTimingMap(messages, { wpm, minSeconds });
        this.minSeconds = minSeconds;
        this.queue = [];
        this.lastMessage = null;
        this.refillQueue();
    }

    get size() {
        return this.timings.size;
    }

    get hasMessages() {
        return this.timings.size > 0;
    }

    refillQueue() {
        let shuffled = shuffleArray([...this.timings.keys()]);

        // Anti-repeat: if last message would be first in new cycle, reshuffle or swap
        if (this.lastMessage && shuffled.length > 1 && shuffled[0] === this.lastMessage) {
            // Swap first element with a random other position
            const swapIdx = 1 + Math.floor(Math.random() * (shuffled.length - 1));
            [shuffled[0], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[0]];
        }

        this.queue = shuffled;
    }

    next() {
        if (!this.hasMessages) {
            return null;
        }

        if (this.queue.length === 0) {
            this.refillQueue();
        }

        const message = this.queue.shift();
        const duration = this.timings.get(message) || this.minSeconds;

        this.lastMessage = message;

        return { message, duration };
    }
}