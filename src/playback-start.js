const START_CORRECTION_TOLERANCE_SECONDS = 3;
const START_CORRECTION_RETRY_MS = 1000;
const START_CORRECTION_MAX_ATTEMPTS = 3;
const START_CORRECTION_TIMEOUT_MS = 15000;
const START_CONFIRMATION_MS = 1000;

// A load or seek owns the playback position until it is confirmed, replaced,
// cancelled by an error, or released at the deadline.
// This monitor has no timer; the existing playback tick supplies observations.
export function createStartPositionMonitor({ onCorrection, onConfirmed }) {
    let request = null;

    function begin(videoId, startSeconds, { seekIssued = false } = {}) {
        request = {
            videoId, startSeconds, startedAt: null,
            lastSeekAt: seekIssued ? Date.now() : -Infinity,
            attempts: seekIssued ? 1 : 0, confirmation: null, seekIssued,
        };
    }

    function matchesVideo(player, videoId = request?.videoId) {
        if (!videoId) return true;
        if (!player) return false;
        if (!player.getVideoUrl) return true;
        try {
            return new URL(player.getVideoUrl()).searchParams.get('v') === videoId;
        } catch {
            // The iframe may not have reported its new video yet.
            return false;
        }
    }

    function getPendingTime() {
        // The video ID can arrive before the clock. The requested position
        // remains authoritative until playback confirms both.
        return request?.startSeconds ?? null;
    }

    // A PLAYING event or seek command is not an acknowledgement of the start time.
    // Keep checking on the existing tick loop until the requested video progresses
    // near its start. Do not feed old/incorrect timestamps into song-boundary logic.
    function reconcile(player, time, { ended = false } = {}) {
        const pending = request;
        if (!pending) return true;
        // An old ENDED event cannot start the new load's confirmation clock.
        if (ended && !pending.confirmation) return false;

        if (!matchesVideo(player)) {
            pending.confirmation = null;
            return false;
        }
        if (!Number.isFinite(time)) {
            pending.confirmation = null;
            return false;
        }

        const now = Date.now();
        if (pending.startedAt === null) pending.startedAt = now;
        if (!ended && now - pending.startedAt >= START_CORRECTION_TIMEOUT_MS) {
            console.warn(`[Playback] Start position not confirmed for ${pending.videoId} at ${pending.startSeconds}`);
            request = null;
            return true;
        }

        // The video ID may update before the old video's time does. A position
        // beyond any plausible progress from this request cannot confirm it.
        // An explicit seek can also move backward within the same video.
        const playbackRate = player.getPlaybackRate ? player.getPlaybackRate() : 1;
        const elapsedSeconds = (now - pending.startedAt) / 1000;
        const beyondStart = time > pending.startSeconds + START_CORRECTION_TOLERANCE_SECONDS + elapsedSeconds * playbackRate;
        if (beyondStart && !pending.seekIssued) {
            pending.confirmation = null;
            return false;
        }

        if (!beyondStart && time >= pending.startSeconds - START_CORRECTION_TOLERANCE_SECONDS) {
            // A short segment can finish before the confirmation interval.
            // Its end confirms progress only after a valid PLAYING sample.
            if (!pending.confirmation) pending.confirmation = { time, at: now };
            if ((ended || now - pending.confirmation.at >= START_CONFIRMATION_MS) && time > pending.confirmation.time
                && (!pending.seekIssued || time >= pending.startSeconds)) {
                request = null;
                onConfirmed?.(pending.videoId);
            }
            // A plausible sample may still be the previous request's clock.
            // Only confirmed progress can drive navigation for this request.
            return request === null;
        }

        pending.confirmation = null;
        if (ended) return false;
        if (pending.attempts < START_CORRECTION_MAX_ATTEMPTS && now - pending.lastSeekAt >= START_CORRECTION_RETRY_MS) {
            pending.lastSeekAt = now;
            pending.attempts++;
            player.seekTo(pending.startSeconds, true);
            onCorrection(pending.startSeconds);
        }
        return false;
    }

    return {
        begin,
        matchesVideo,
        getPendingTime,
        reconcile,
        cancel: () => { request = null; },
        isPending: () => request !== null,
    };
}
