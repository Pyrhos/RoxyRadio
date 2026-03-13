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
    let tickHandle = null;
    let lastKnownTime = 0;
    let currentLoadedVideoId = null;
    let lastVideoLoadTime = 0;
    let titleRefreshHandle = null;

    function seekToSafe(time, stream) {
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
        if (!stream) return;
        const safeStart = sanitizeStartTime(desiredStart, stream);
        let safeEnd = Number.isFinite(endSeconds) && endSeconds > 0 ? endSeconds : undefined;
        if (safeEnd !== undefined && safeEnd <= safeStart) {
            safeEnd = undefined;
        }

        const player = getPlayer();
        if (!player || !player.loadVideoById) return;

        const isSameVideo = currentLoadedVideoId === stream.videoId;
        if (isSameVideo && !forceReload) {
            seekToSafe(safeStart, stream);
            return;
        }

        const now = Date.now();
        const timeSinceLastLoad = now - lastVideoLoadTime;
        if (timeSinceLastLoad < VIDEO_LOAD_DEBOUNCE_MS) {
            const delay = VIDEO_LOAD_DEBOUNCE_MS - timeSinceLastLoad;
            setTimeout(() => playVideoAt(stream, desiredStart, endSeconds, forceReload), delay);
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
        player.loadVideoById(payload);
    }

    function startTickLoop() {
        if (tickHandle) return;
        tickHandle = setInterval(tick, TICK_MS);
    }

    function stopTickLoop() {
        if (!tickHandle) return;
        clearInterval(tickHandle);
        tickHandle = null;
    }

    function shouldTickRun() {
        const player = getPlayer();
        if (!player || typeof player.getPlayerState !== 'function') return false;
        if (typeof YT === 'undefined' || !YT.PlayerState) return false;

        const state = player.getPlayerState();
        if (state !== YT.PlayerState.PLAYING) return false;

        if (document.hidden) {
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
        const player = getPlayer();
        if (!player || !player.getCurrentTime) return;
        const t = player.getCurrentTime();
        if (Number.isFinite(t)) lastKnownTime = t;

        onTick(t);
    }

    function ensureTitleRefreshLoop(updateFn) {
        if (titleRefreshHandle) return;
        titleRefreshHandle = setInterval(() => {
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
    }

    return {
        seekToSafe,
        getSafeCurrentTime,
        playVideoAt,
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
