const VALID_ID = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Extracts a YouTube video ID from a single URL string.
 * Handles all known youtube.com, youtu.be, and youtube-nocookie.com URL formats.
 * @param {string} url
 * @returns {string|null} The 11-character video ID, or null if not a valid YouTube URL
 */
function extractVideoId(url) {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '');
        if (host !== 'youtube.com' && host !== 'youtu.be' && host !== 'youtube-nocookie.com') {
            return null;
        }

        // 1. Direct v= or vi= query param
        for (const key of ['v', 'vi']) {
            const param = parsed.searchParams.get(key);
            if (param && VALID_ID.test(param)) return param;
        }

        // 2. Encoded v=/vi= inside query param values (oembed url=, attribution_link u=)
        for (const value of parsed.searchParams.values()) {
            try {
                const inner = new URL(value, 'http://x');
                for (const key of ['v', 'vi']) {
                    const innerParam = inner.searchParams.get(key);
                    if (innerParam && VALID_ID.test(innerParam)) return innerParam;
                }
            } catch { /* not a parseable value */ }
        }

        // 3. Walk path segments right-to-left; exact 11-char ID match
        const segments = parsed.pathname.split('/').filter(Boolean);
        for (let i = segments.length - 1; i >= 0; i--) {
            let seg = segments[i];
            // Disregard query-like suffixes (handles malformed URLs like youtu.be/ID&feature=x)
            const ampIdx = seg.indexOf('&');
            if (ampIdx !== -1) seg = seg.substring(0, ampIdx);
            if (VALID_ID.test(seg)) return seg;
        }
    } catch { /* not a URL */ }
    return null;
}

/**
 * Parses raw text containing YouTube URLs into Rule 0 segment entries.
 * URLs may be separated by spaces, commas, semicolons, or newlines.
 * @param {string} text - Raw text from clipboard
 * @returns {{ entries: Array<{videoId: string}>, failed: string[] } | null}
 *   Object with parsed entries and failed tokens, or null if input is not a string
 */
export function parseYouTubeUrls(text) {
    if (!text || typeof text !== 'string') return null;

    const tokens = text.split(/[\s,;]+/).filter(Boolean);
    const entries = [];
    const failed = [];
    const seen = new Set();

    for (const token of tokens) {
        const id = extractVideoId(token);
        if (!id) { failed.push(token); continue; }
        if (seen.has(id)) continue;
        seen.add(id);
        entries.push({ videoId: id });
    }

    return entries.length > 0 || failed.length > 0
        ? { entries, failed }
        : null;
}

/**
 * Validates that data conforms to the segment file format.
 * @param {*} data - The data to validate
 * @returns {boolean} True if the data is a valid non-empty segment array
 */
export function validateSegmentData(data) {
    if (!Array.isArray(data) || data.length === 0) return false;
    return data.every(entry => {
        if (!entry || typeof entry.videoId !== 'string' || !entry.videoId) return false;
        if (entry.songs != null) {
            if (!Array.isArray(entry.songs)) return false;
            if (!entry.songs.every(s =>
                s && typeof s.name === 'string' &&
                Array.isArray(s.range) && s.range.length === 2 &&
                Number.isFinite(s.range[0]) && Number.isFinite(s.range[1])
            )) return false;
        }
        return true;
    });
}
