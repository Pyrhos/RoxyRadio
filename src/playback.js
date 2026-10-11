import { createLifecycle } from './lifecycle.js';

const START_CORRECTION_TOLERANCE_SECONDS = 3;
const START_CORRECTION_RETRY_MS = 1000;
const START_CORRECTION_MAX_ATTEMPTS = 3;
const START_CORRECTION_TIMEOUT_MS = 15000;
const START_CONFIRMATION_MS = 1000;

/**
 * @param {object} deps
 * @param {() => YT.Player|null} deps.getPlayer
 * @param {() => object|null} deps.getCurrentStream
 * @param {(time: number, stream?: object) => number} deps.sanitizeStartTime
 * @param {() => boolean} deps.isYapMode
 * @param {(time: number) => void} deps.onTick
 * @param {(time: number) => void} deps.onSeek
 * @param {number} deps.TICK_MS
 * @param {number} deps.VIDEO_LOAD_DEBOUNCE_MS
 * @param {number} deps.TITLE_REFRESH_MS
 */
export function createPlaybackController({
    getPlayer, getCurrentStream, sanitizeStartTime,
    isYapMode, onTick, onSeek,
    TICK_MS, VIDEO_LOAD_DEBOUNCE_MS, TITLE_REFRESH_MS,
}) {
    const lifecycle = createLifecycle();
    let tickHandle = null;
    let lastKnownTime = 0;
    let pendingStartCorrection = null;
    let currentLoadedVideoId = null;
    let lastVideoLoadTime = 0;
    let titleRefreshHandle = null;

    function seekToSafe(time, stream) {
        if (lifecycle.signal.aborted) return;
        pendingStartCorrection = null;
        const resolvedStream = stream || getCurrentStream();
        const safeStart = sanitizeStartTime(time, resolvedStream);
        const player = getPlayer();
        if (player && player.seekTo) {
            player.seekTo(safeStart, true);
        }
        lastKnownTime = safeStart;
        onSeek(safeStart);
    }

    function getSafeCurrentTime() {
        const player = getPlayer();
        if (!player) {
            return lastKnownTime;
        }

        const playerTime = player.getCurrentTime();

        if (Number.isFinite(playerTime) && playerTime > 0) {
            lastKnownTime = playerTime;
            return playerTime;
        }

        if (Number.isFinite(lastKnownTime) && lastKnownTime > 0) {
            return lastKnownTime;
        }

        return playerTime;
    }

    function playVideoAt(stream, desiredStart, endSeconds, forceReload = false) {
        if (!stream || lifecycle.signal.aborted) return;
        const safeStart = sanitizeStartTime(desiredStart, stream);
        let safeEnd = Number.isFinite(endSeconds) && endSeconds > 0 ? endSeconds : undefined;
        if (safeEnd !== undefined && safeEnd <= safeStart) {
            safeEnd = undefined;
        }

        const player = getPlayer();
        if (!player || !player.loadVideoById) return;

        const isSameVideo = currentLoadedVideoId === stream.videoId;
        if (isSameVideo && !forceReload) {
            pendingStartCorrection = null;
            seekToSafe(safeStart, stream);
            return;
        }

        const now = Date.now();
        const timeSinceLastLoad = now - lastVideoLoadTime;
        if (timeSinceLastLoad < VIDEO_LOAD_DEBOUNCE_MS) {
            const delay = VIDEO_LOAD_DEBOUNCE_MS - timeSinceLastLoad;
            lifecycle.timeout(() => playVideoAt(stream, desiredStart, endSeconds, forceReload), delay);
            return;
        }
        lastVideoLoadTime = now;

        console.log(`Loading ${stream.videoId} [${safeStart}-${safeEnd ?? 'end'}]`);
        lastKnownTime = safeStart;
        currentLoadedVideoId = stream.videoId;

        const payload = {
            videoId: stream.videoId,
            startSeconds: safeStart,
            suggestedQuality: 'default'
        };
        if (safeEnd !== undefined) {
            payload.endSeconds = safeEnd;
        }
        pendingStartCorrection = {
            videoId: stream.videoId,
            startSeconds: safeStart,
            startedAt: null,
            lastSeekAt: -Infinity,
            attempts: 0,
            confirmation: null,
        };
        player.loadVideoById(payload);
    }

    function reconcileStartOnPlaying() {
        const player = getPlayer();
        if (pendingStartCorrection && player) {
            reconcileStart(player, player.getCurrentTime());
        }
    }

    // A PLAYING event or seek command is not an acknowledgement of the start time.
    // Keep checking on the existing tick loop until the requested video progresses
    // near its start. Do not feed old/incorrect timestamps into song-boundary logic.
    function reconcileStart(player, time) {
        const pending = pendingStartCorrection;
        if (!pending) return true;

        const now = Date.now();
        if (pending.startedAt === null) pending.startedAt = now;
        if (now - pending.startedAt >= START_CORRECTION_TIMEOUT_MS) {
            console.warn(`[Playback] Start position not confirmed for ${pending.videoId} at ${pending.startSeconds}`);
            pendingStartCorrection = null;
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
                pendingStartCorrection = null;
            }
            return true;
        }

        pending.confirmation = null;
        if (pending.attempts < START_CORRECTION_MAX_ATTEMPTS && now - pending.lastSeekAt >= START_CORRECTION_RETRY_MS) {
            pending.lastSeekAt = now;
            pending.attempts++;
            player.seekTo(pending.startSeconds, true);
            lastKnownTime = pending.startSeconds;
        }
        return false;
    }

    function startTickLoop() {
        if (tickHandle) return;
        tickHandle = lifecycle.interval(tick, TICK_MS);
    }

    function stopTickLoop() {
        if (!tickHandle) return;
        lifecycle.cancelInterval(tickHandle);
        tickHandle = null;
    }

    function shouldTickRun() {
        const player = getPlayer();
        if (!player || typeof player.getPlayerState !== 'function') return false;
        if (typeof YT === 'undefined' || !YT.PlayerState) return false;

        const state = player.getPlayerState();
        if (state !== YT.PlayerState.PLAYING) return false;

        if (document.hidden && !pendingStartCorrection) {
            const stream = getCurrentStream();
            const needsGapSkipping = stream && stream.songs && stream.songs.length > 0 && !isYapMode();
            if (!needsGapSkipping) {
                return false;
            }
        }

        return true;
    }

    function evaluateTickLoop() {
        if (shouldTickRun()) {
            startTickLoop();
        } else {
            stopTickLoop();
        }
    }

    function tick() {
        if (!shouldTickRun()) {
            stopTickLoop();
            return;
        }
        const player = getPlayer();
        if (!player || !player.getCurrentTime) return;
        const t = player.getCurrentTime();
        const wasPending = pendingStartCorrection !== null;
        const usableTime = reconcileStart(player, t);
        if (wasPending && !pendingStartCorrection) evaluateTickLoop();
        if (!usableTime || !Number.isFinite(t)) return;
        lastKnownTime = t;

        onTick(t);
    }

    function ensureTitleRefreshLoop(updateFn) {
        if (titleRefreshHandle) return;
        titleRefreshHandle = lifecycle.interval(() => {
            const player = getPlayer();
            const t = player && player.getCurrentTime ? player.getCurrentTime() : lastKnownTime;
            updateFn(t);
        }, TITLE_REFRESH_MS);
    }

    function getLastKnownTime() {
        return lastKnownTime;
    }

    function setLastKnownTime(t) {
        lastKnownTime = t;
    }

    function getCurrentLoadedVideoId() {
        return currentLoadedVideoId;
    }

    function resetLoadedVideoId() {
        currentLoadedVideoId = null;
        pendingStartCorrection = null;
    }

    return {
        destroy: () => { lifecycle.dispose(); pendingStartCorrection = null; },
        seekToSafe,
        getSafeCurrentTime,
        playVideoAt,
        reconcileStartOnPlaying,
        startTickLoop,
        stopTickLoop,
        evaluateTickLoop,
        ensureTitleRefreshLoop,
        getLastKnownTime,
        setLastKnownTime,
        getCurrentLoadedVideoId,
        resetLoadedVideoId,
    };
}
