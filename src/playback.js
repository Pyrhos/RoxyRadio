import { createLifecycle } from './lifecycle.js';
import { createStartPositionMonitor } from './playback-start.js';

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
    const startPosition = createStartPositionMonitor({ onCorrection: time => { lastKnownTime = time; } });
    let requestedVideoId = null;
    let requestedEndSeconds;
    let lastVideoLoadTime = 0;
    let pendingLoad = null;
    let titleRefreshHandle = null;

    function cancelPendingLoad() {
        lifecycle.cancelTimeout(pendingLoad?.handle);
        pendingLoad = null;
    }

    function seekToSafe(time, stream) {
        if (lifecycle.signal.aborted) return;
        const previousLoad = pendingLoad;
        cancelPendingLoad();
        const resolvedStream = stream || getCurrentStream();
        const safeStart = sanitizeStartTime(time, resolvedStream);
        const player = getPlayer();
        if (previousLoad && previousLoad.stream.videoId === resolvedStream?.videoId) {
            // A song pick within the selected video replaces its pending start;
            // seeking the iframe here would seek in the previous video instead.
            playVideoAt(resolvedStream, safeStart, previousLoad.endSeconds, previousLoad.forceReload);
        } else if (requestedVideoId === resolvedStream?.videoId && !startPosition.matchesVideo(player, resolvedStream.videoId)) {
            // Replace the in-flight command itself. Waiting to seek on arrival
            // loses the user's request if the previous load never starts.
            playVideoAt(resolvedStream, safeStart, requestedEndSeconds, true);
        } else {
            startPosition.begin(resolvedStream?.videoId, safeStart, { seekIssued: true });
            if (player && player.seekTo) player.seekTo(safeStart, true);
            player?.playVideo?.();
        }
        lastKnownTime = safeStart;
        onSeek(safeStart);
        evaluateTickLoop();
    }

    function getSafeCurrentTime({ allowZero = false } = {}) {
        // Navigation already addresses the selected stream during the delay.
        // Its requested position remains authoritative until the iframe reports
        // that video, including the interval after the load command is sent.
        if (pendingLoad) return pendingLoad.startSeconds;
        const player = getPlayer();
        const pendingTime = startPosition.getPendingTime();
        if (pendingTime !== null) return pendingTime;
        if (!player) {
            return lastKnownTime;
        }

        const playerTime = player.getCurrentTime();

        // Navigation keeps the last position across transient zero samples;
        // persistence also accepts a genuine native seek to the beginning.
        if (Number.isFinite(playerTime) && playerTime >= 0
            && (playerTime > 0 || allowZero)) {
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
        // One pending load at most. A later selection replaces it, including a
        // selection of the video that is still loaded (which becomes a seek).
        cancelPendingLoad();
        const safeStart = sanitizeStartTime(desiredStart, stream);
        let safeEnd = Number.isFinite(endSeconds) && endSeconds > 0 ? endSeconds : undefined;
        if (safeEnd !== undefined && safeEnd <= safeStart) {
            safeEnd = undefined;
        }

        const player = getPlayer();
        if (!player || !player.loadVideoById) return;

        const isSameVideo = requestedVideoId === stream.videoId;
        if (isSameVideo && !forceReload && startPosition.matchesVideo(player, stream.videoId)) {
            seekToSafe(safeStart, stream);
            return;
        }

        startPosition.cancel();

        const now = Date.now();
        const timeSinceLastLoad = now - lastVideoLoadTime;
        if (timeSinceLastLoad < VIDEO_LOAD_DEBOUNCE_MS) {
            const delay = VIDEO_LOAD_DEBOUNCE_MS - timeSinceLastLoad;
            pendingLoad = {
                stream, startSeconds: safeStart, endSeconds: safeEnd, forceReload,
                handle: lifecycle.timeout(() => {
                    pendingLoad = null;
                    playVideoAt(stream, desiredStart, endSeconds, forceReload);
                }, delay),
            };
            return;
        }
        lastVideoLoadTime = now;

        console.log(`Loading ${stream.videoId} [${safeStart}-${safeEnd ?? 'end'}]`);
        lastKnownTime = safeStart;
        requestedVideoId = stream.videoId;
        requestedEndSeconds = safeEnd;

        const payload = {
            videoId: stream.videoId,
            startSeconds: safeStart,
            suggestedQuality: 'default'
        };
        if (safeEnd !== undefined) {
            payload.endSeconds = safeEnd;
        }
        startPosition.begin(stream.videoId, safeStart);
        player.loadVideoById(payload);
    }

    function reconcileStartOnPlaying() {
        const player = getPlayer();
        if (startPosition.isPending() && player) {
            startPosition.reconcile(player, player.getCurrentTime());
        }
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

        if (document.hidden && !startPosition.isPending()) {
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
        // The core already holds the newly selected song. Do not interpret the
        // previous video's clock against it while that song awaits loading.
        if (pendingLoad !== null) return;
        const player = getPlayer();
        if (!player || !player.getCurrentTime) return;
        const t = player.getCurrentTime();
        const wasPending = startPosition.isPending();
        const usableTime = startPosition.reconcile(player, t);
        if (wasPending && !startPosition.isPending()) evaluateTickLoop();
        if (!usableTime || !Number.isFinite(t)) return;
        lastKnownTime = t;

        onTick(t);
    }

    function ensureTitleRefreshLoop(updateFn) {
        if (titleRefreshHandle) return;
        titleRefreshHandle = lifecycle.interval(() => {
            updateFn(getSafeCurrentTime());
        }, TITLE_REFRESH_MS);
    }

    function getLastKnownTime() {
        return lastKnownTime;
    }

    function resetLoadedVideoId() {
        requestedVideoId = null;
        startPosition.cancel();
    }

    return {
        destroy: () => { cancelPendingLoad(); lifecycle.dispose(); startPosition.cancel(); },
        seekToSafe,
        getSafeCurrentTime,
        playVideoAt,
        isLoadPending: () => pendingLoad !== null || !startPosition.matchesVideo(getPlayer()),
        reconcileStartOnEnded: () => {
            const player = getPlayer();
            return pendingLoad === null && !!player
                && startPosition.reconcile(player, player.getCurrentTime(), { ended: true });
        },
        reconcileStartOnPlaying,
        stopTickLoop,
        evaluateTickLoop,
        ensureTitleRefreshLoop,
        getLastKnownTime,
        resetLoadedVideoId,
    };
}
