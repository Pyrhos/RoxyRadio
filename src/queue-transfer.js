const QUEUE_TYPE = 'rourin-radio-queue';
const QUEUE_VERSION = 1;

/** Encode references only; unavailable queue entries cannot supply timestamps. */
export function encodeQueue(queue, segments) {
    const streams = new Map(segments.map(stream => [stream.videoId, stream]));
    const items = [];
    for (const item of queue) {
        const stream = streams.get(item.videoId);
        if (!stream || !Number.isInteger(item.rIdx) || item.rIdx < 0) continue;
        if (!stream.songs?.length) {
            if (item.rIdx === 0) items.push({ videoId: item.videoId, range: null });
        } else {
            const song = stream.songs[item.rIdx];
            if (song) items.push({ videoId: item.videoId, range: song.range });
        }
    }
    const json = JSON.stringify({ type: QUEUE_TYPE, version: QUEUE_VERSION, items });
    const bytes = new TextEncoder().encode(json);
    const text = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
    return { text, count: items.length, skipped: queue.length - items.length };
}

/** Return null for other clipboard formats; reject malformed queue exports. */
export function decodeQueue(text) {
    let data;
    try {
        const bytes = Uint8Array.from(atob(text.trim()), character => character.charCodeAt(0));
        data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        return null;
    }
    if (data?.type !== QUEUE_TYPE) return null;
    if (data.version !== QUEUE_VERSION) throw new Error('Unsupported queue export version');
    if (!Array.isArray(data.items) || !data.items.every(item =>
        item && typeof item.videoId === 'string' && item.videoId.length > 0 &&
        (item.range === null || (
            Array.isArray(item.range) && item.range.length === 2 &&
            item.range.every(Number.isFinite) &&
            item.range[0] >= 0 && item.range[1] > item.range[0]
        ))
    )) throw new Error('Not a valid queue export');
    return data.items;
}

/** Resolve exact song ranges against the final catalogue, preserving duplicates. */
export function resolveQueue(items, segments) {
    const streams = new Map(segments.map(stream => [stream.videoId, stream]));
    const queue = [];
    for (const item of items) {
        const stream = streams.get(item.videoId);
        if (!stream) continue;
        const rIdx = item.range === null
            ? (stream.songs?.length ? -1 : 0)
            : (stream.songs?.findIndex(song =>
                song.range[0] === item.range[0] && song.range[1] === item.range[1]
            ) ?? -1);
        if (rIdx !== -1) queue.push({ videoId: item.videoId, rIdx });
    }
    return { queue, skipped: items.length - queue.length };
}
