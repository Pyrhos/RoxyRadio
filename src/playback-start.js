const START_CORRECTION_TOLERANCE_SECONDS = 3;
const START_CORRECTION_RETRY_MS = 1000;
const START_CORRECTION_MAX_ATTEMPTS = 3;
const START_CORRECTION_TIMEOUT_MS = 15000;
const START_CONFIRMATION_MS = 1000;

// A load awaits its first PLAYING sample, then observes progress until it is
// confirmed, cancelled by a user seek/replacement, or released at the deadline.
// This monitor has no timer; the existing playback tick supplies observations.
export function createStartPositionMonitor({ onCorrection }) {
    let request = null;

    function begin(videoId, startSeconds) {
        request = {
            videoId, startSeconds, startedAt: null, lastSeekAt: -Infinity,
            attempts: 0, confirmation: null,
        };
    }

    // A PLAYING event or seek command is not an acknowledgement of the start time.
    // Keep checking on the existing tick loop until the requested video progresses
    // near its start. Do not feed old/incorrect timestamps into song-boundary logic.
    function reconcile(player, time) {
        const pending = request;
        if (!pending) return true;

        const now = Date.now();
        if (pending.startedAt === null) pending.startedAt = now;
        if (now - pending.startedAt >= START_CORRECTION_TIMEOUT_MS) {
            console.warn(`[Playback] Start position not confirmed for ${pending.videoId} at ${pending.startSeconds}`);
            request = null;
            return true;
        }

        if (player.getVideoUrl) {
            let videoId = null;
            try {
                videoId = new URL(player.getVideoUrl()).searchParams.get('v');
            } catch { /* The iframe may not have reported its new video yet. */ }
            if (videoId !== pending.videoId) {
                pending.confirmation = null;
                return false;
            }
        }
        if (!Number.isFinite(time)) {
            pending.confirmation = null;
            return false;
        }

        // The video ID may update before the old video's time does. A position
        // beyond any plausible progress from this request cannot confirm it.
        const playbackRate = player.getPlaybackRate ? player.getPlaybackRate() : 1;
        const elapsedSeconds = (now - pending.startedAt) / 1000;
        if (time > pending.startSeconds + START_CORRECTION_TOLERANCE_SECONDS + elapsedSeconds * playbackRate) {
            pending.confirmation = null;
            return false;
        }

        if (time >= pending.startSeconds - START_CORRECTION_TOLERANCE_SECONDS) {
            if (!pending.confirmation) pending.confirmation = { time, at: now };
            if (now - pending.confirmation.at >= START_CONFIRMATION_MS && time > pending.confirmation.time) {
                request = null;
            }
            return true;
        }

        pending.confirmation = null;
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
        reconcile,
        cancel: () => { request = null; },
        isPending: () => request !== null,
    };
}
