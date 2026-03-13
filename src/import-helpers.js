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
