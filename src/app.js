import Fuse from 'fuse.js';
import { PlayerCore } from './player-core.js';
import segmentsData from './data/segments.json';
import messagesData from './data/messages.json';
import { normalizeSongBaseName, buildSearchIndexFromPlaylist, buildDuplicateNameIndex, sortSearchResultsByCurrentStream, FUSE_CONFIG } from './search-helpers.js';
import { resolveListNavigation, NAV_ACTION_MOVE, NAV_ACTION_SELECT } from './list-navigation.js';
import { MessageQueue, validateMessages } from './message-bar.js';

// ======== CONFIG ========
const TICK_MS = 200;
const TITLE_REFRESH_MS = 2000;
const YAP_TOGGLE_DEBOUNCE_MS = 300;
const VIDEO_LOAD_DEBOUNCE_MS = 300;

// ======== STATE ========
let tickHandle = null;
let player = null;
let isReady = false;
let playlistReady = false;
let pendingStart = false;
let lastKnownTime = 0;
let modalToggleTime = 0;
let yapToggleTime = 0;
let currentLoadedVideoId = null;
let lastVideoLoadTime = 0;

// Search State
let fuse = null;
let searchResults = [];
let searchSelIdx = 0;

// Duplicate Song State
let duplicateNameIndex = new Map();
let duplicateSearchName = '';

// URL parameter override (YouTube-style ?v= and ?t= params)
let urlOverride = null;

const loopLabels = ['None', 'Track', 'Stream'];
const loopIcons = ['./loop.png', './loop-active-track.png', './loop-active.png'];
const loopAlts = ['Loop off', 'Loop track', 'Loop stream'];

// Cache DOM elements
const overlay = document.getElementById('overlay');
const btnStart = document.getElementById('start');
const btnPrevStream = document.getElementById('prev-stream');
const btnNextStream = document.getElementById('next-stream');
const btnPrevSong = document.getElementById('prev-song');
const btnNextSong = document.getElementById('next-song');
const btnYap = document.getElementById('yap-btn');
const btnLoop = document.getElementById('loop-btn');
const btnShuffle = document.getElementById('shuffle-btn');
const btnSearch = document.getElementById('search-btn');
const btnDuplicates = document.getElementById('duplicates-btn');
const iconYap = document.getElementById('yap-icon');
const iconLoop = document.getElementById('loop-icon');

const statusEl = document.getElementById('status');
const statusTextEl = document.getElementById('status-text');
const statusPanel = document.getElementById('status-panel');
const statusSongList = document.getElementById('status-song-list');

const modal = document.getElementById('modal-overlay');
const searchInput = document.getElementById('search-input');
const resultsContainer = document.getElementById('search-results');
let statusPanelStreamId = '';
let statusPanelSongCount = 0;
let statusPanelOpen = false;
let statusPanelSelIdx = -1;
let lastStatusText = '';
let lastTitleText = document.title;
let titleRefreshHandle = null;

if (statusSongList) {
    statusSongList.setAttribute('role', 'listbox');
    statusSongList.setAttribute('aria-label', 'Current karaoke songs');
}

// Core Logic Instance
const core = new PlayerCore({
    playVideo: (forceStart = true) => loadCurrentContent(forceStart),
    seekTo: (time) => {
        seekToSafe(time);
    },
    saveSettings: (settings) => {
        for (const [key, val] of Object.entries(settings)) {
            localStorage.setItem(`roxy_${key}`, val);
        }
    },
    getSettings: () => {
        const s = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith('roxy_')) s[k.replace('roxy_', '')] = localStorage.getItem(k);
        }
        return s;
    },
    saveSessionData: (data) => {
        for (const [key, val] of Object.entries(data)) {
            sessionStorage.setItem(`roxy_session_${key}`, val);
        }
    },
    getSessionData: () => {
        const s = {};
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k.startsWith('roxy_session_')) s[k.replace('roxy_session_', '')] = sessionStorage.getItem(k);
        }
        return s;
    },
    now: () => Date.now(),
    onStatus: () => updateStatus()
});

function seekToSafe(time, stream = core.getCurrentStream()) {
    const safeStart = core.sanitizeStartTime(time, stream);
    if (player && player.seekTo) {
        player.seekTo(safeStart, true);
    }
    lastKnownTime = safeStart;
    updateStatus();
}

function getSafeCurrentTime() {
    if (!player) {
        return lastKnownTime;
    }

    const playerTime = player.getCurrentTime();

    // If player returns a valid time > 0, use it and update lastKnownTime
    if (Number.isFinite(playerTime) && playerTime > 0) {
        lastKnownTime = playerTime;
        return playerTime;
    }

    // If player returns 0 or invalid, prefer lastKnownTime if it's valid
    // This guards against race conditions during video loading transitions
    if (Number.isFinite(lastKnownTime) && lastKnownTime > 0) {
        return lastKnownTime;
    }

    // Both are 0/invalid - return what the player says (likely 0 at stream start)
    return playerTime;
}

function playVideoAt(stream, desiredStart, endSeconds, forceReload = false) {
    if (!stream) return;
    const safeStart = core.sanitizeStartTime(desiredStart, stream);
    let safeEnd = Number.isFinite(endSeconds) && endSeconds > 0 ? endSeconds : undefined;
    if (safeEnd !== undefined && safeEnd <= safeStart) {
        safeEnd = undefined;
    }

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

    // Different video or forced reload - do full load
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
    if (!player || typeof player.getPlayerState !== 'function') return false;
    if (typeof YT === 'undefined' || !YT.PlayerState) return false;

    const state = player.getPlayerState();
    if (state !== YT.PlayerState.PLAYING) return false;

    if (document.hidden) {
        const stream = core.getCurrentStream();
        const needsGapSkipping = stream && stream.songs && stream.songs.length > 0 && !core.yapMode;
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

function ensureTitleRefreshLoop() {
    if (titleRefreshHandle) return;
    titleRefreshHandle = setInterval(() => {
        const t = player && player.getCurrentTime ? player.getCurrentTime() : lastKnownTime;
        updateStatus(t);
    }, TITLE_REFRESH_MS);
}

ensureTitleRefreshLoop();

window.addEventListener('beforeunload', () => {
    let time = lastKnownTime;
    if (player && typeof player.getCurrentTime === 'function') {
        try {
            const live = player.getCurrentTime();
            if (Number.isFinite(live)) time = live;
        } catch (err) {
            console.warn('Failed to read current time on unload', err);
        }
    }
    core.saveState(Number.isFinite(time) ? time : 0);
});

// ======== URL PARAMETER PARSING ========
const PERMITTED_URL_PARAMS = ['v', 't'];

function stripInvalidParams() {
    try {
        const params = new URLSearchParams(window.location.search);
        const keysToRemove = [];

        for (const key of params.keys()) {
            if (!PERMITTED_URL_PARAMS.includes(key)) {
                keysToRemove.push(key);
            }
        }

        if (keysToRemove.length === 0) return;

        for (const key of keysToRemove) {
            params.delete(key);
        }

        const newSearch = params.toString();
        const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
        history.replaceState(null, '', newUrl);
    } catch (err) {
        console.warn('[URL] Failed to strip invalid params:', err.message);
    }
}

function parseUrlParams() {
    try {
        stripInvalidParams();

        const params = new URLSearchParams(window.location.search);
        const videoId = params.get('v');
        const timestamp = params.get('t');

        if (!videoId) return null;

        // Find the stream index by videoId
        const streamIdx = core.playlist.findIndex(s => s.videoId === videoId);
        if (streamIdx === -1) {
            console.log(`[URL] v=${videoId} not found in playlist, ignoring`);
            return null;
        }

        const result = { streamIdx, time: null };

        // Parse timestamp if provided
        if (timestamp !== null) {
            const t = parseFloat(timestamp);
            if (Number.isFinite(t) && t >= 0) {
                const stream = core.playlist[streamIdx];

                // Validate timestamp is within outer bounds
                if (stream.songs && stream.songs.length > 0) {
                    const firstStart = stream.songs[0].range[0];
                    const lastEnd = stream.songs[stream.songs.length - 1].range[1];

                    if (t >= firstStart && t <= lastEnd) {
                        result.time = t;
                    } else {
                        console.log(`[URL] t=${t} is outside segment bounds [${firstStart}, ${lastEnd}], ignoring timestamp`);
                    }
                } else {
                    // Rule 0 stream (no songs array) - accept any non-negative timestamp
                    result.time = t;
                }
            }
        }

        return result;
    } catch (err) {
        console.warn('[URL] Failed to parse URL parameters:', err.message);
        return null;
    }
}

// ======== LOAD SEGMENTS ========
initializePlaylist();

function initializePlaylist() {
    try {
        core.init(segmentsData); // Core handles the filtering logic

        if (!core.playlist.length) throw new Error('Empty playlist');

        // Check URL params to override saved state (YouTube-style ?v= and ?t=)
        urlOverride = parseUrlParams();
        if (urlOverride) {
            core.vIdx = urlOverride.streamIdx;
            core.rIdx = 0;
            console.log(`[URL] Jumping to stream index ${urlOverride.streamIdx}` +
                (urlOverride.time !== null ? ` at t=${urlOverride.time}` : ''));
        }

        // Update buttons state based on core init (e.g. persisted Yap mode)
        updateButtons();

        // Index for search
        const searchIndex = buildSearchIndexFromPlaylist(core.playlist);

        duplicateNameIndex = buildDuplicateNameIndex(searchIndex);

        fuse = new Fuse(searchIndex, FUSE_CONFIG);

        playlistReady = true;
        refreshStatusSongList(true);
        setStatus('Ready. Click Start.');
        maybeStartPlayback();
    } catch (err) {
        setStatus('Failed to load segments: ' + err.message);
    }
}

// ======== YT API READY HOOK ========
window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('player', {
        videoId: '',
        host: 'https://www.youtube.com',
        playerVars: {
            controls: 1,
            disablekb: 0,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            iv_load_policy: 3,
            origin: window.location.origin,
            widget_referrer: window.location.href,
            autoplay: 1
        },
        events: {
            onReady: onPlayerReady,
            onStateChange: onStateChange,
            onError: (e) => {
                currentLoadedVideoId = null; // Reset so next play attempt does full reload
                setStatus('YouTube error: ' + e.data);
            }
        }
    });
};

// Handle case where API loads before script
if (window.YT && window.YT.Player) {
    setTimeout(() => {
        if (!player) window.onYouTubeIframeAPIReady();
    }, 0);
}

function onPlayerReady() {
    isReady = true;
    setStatus('Player ready.');
    requestStartPlayback();
}

function updateStatus(forcedTime) {
    if (!player || !player.getCurrentTime) return;
    const t = Number.isFinite(forcedTime) ? forcedTime : player.getCurrentTime();
    const msg = core.getStatusText(t);
    setStatus(msg);

    const activeName = core.getActiveSongName(t);
    const newTitle = activeName ? `Rourin: ${activeName}` : `Rourin ${msg}`;
    if (newTitle !== lastTitleText) {
        lastTitleText = newTitle;
        document.title = newTitle;
    }

    updateDuplicateButtonForCurrentSong();
    syncStatusPanelActiveState(t);
}

function updateButtonLabel(btn, text, isActive) {
    if (!btn) return;
    const label = btn.querySelector('.btn-label');
    if (label) label.textContent = text;
    else btn.textContent = text;
    btn.classList.toggle('active', isActive);
}

function updateButtonIcon(icon, src, alt) {
    if (icon) {
        icon.setAttribute('src', src);
        icon.setAttribute('alt', alt);
    }
}

function updateButtons() {
    // Yap button
    const yapOn = core.yapMode;
    updateButtonLabel(btnYap, `Yap: ${yapOn ? 'On' : 'Off'}`, yapOn);
    updateButtonIcon(iconYap, yapOn ? './yap.png' : './noyap.png', yapOn ? 'Yap on' : 'Yap off');

    // Loop button
    const loopMode = core.loopMode;
    updateButtonLabel(btnLoop, `Loop: ${loopLabels[loopMode]}`, loopMode !== 0);
    updateButtonIcon(iconLoop, loopIcons[loopMode], loopAlts[loopMode]);

    // Shuffle button
    const shuffleOn = core.shuffleMode;
    updateButtonLabel(btnShuffle, `Shuffle: ${shuffleOn ? 'On' : 'Off'}`, shuffleOn);
}

function requestStartPlayback() {
    pendingStart = true;
    maybeStartPlayback();
}

function maybeStartPlayback() {
    if (!pendingStart) return;
    if (!playlistReady || !core.playlist.length || !player || !isReady) return;
    pendingStart = false;
    startPlaybackInternal();
}

function startPlaybackInternal() {
    overlay.style.display = 'none';

    let startTime = null;

    // URL param override takes priority over saved state
    if (urlOverride) {
        if (urlOverride.time !== null) {
            startTime = core.normalizeResumeTime(urlOverride.time);
        }
        // When URL specifies a video, don't use saved time from a different video
        // startTime stays null if no valid t= was provided, which loads from song start
        urlOverride = null;
    } else {
        const savedTime = core.getStartSeconds();
        const resumeTime = core.normalizeResumeTime(savedTime);
        startTime = resumeTime > 0 ? resumeTime : null;
    }

    loadCurrentContent(true, startTime);

    stopTickLoop();
    evaluateTickLoop();
}

function tick() {
    if (!player || !player.getCurrentTime) return;
    const t = player.getCurrentTime();
    if (Number.isFinite(t)) lastKnownTime = t;

    updateStatus(t);
    core.checkTick(t);
}

function onStateChange(ev) {
    if (ev.data === YT.PlayerState.ENDED) {
        core.onVideoEnded();
    } else if (ev.data === YT.PlayerState.PLAYING) {
        // Rule 0: If no segments, get duration now if not set
        const stream = core.getCurrentStream();
        if (stream && !stream.songs && !core.getDuration(stream.videoId)) {
            const d = player.getDuration();
            if (d) {
                core.setDuration(stream.videoId, d);
                if (stream.title === stream.videoId) {
                    const data = player.getVideoData();
                    if (data && data.title) {
                        stream.title = data.title;
                    }
                }
            }
        }
    }

    evaluateTickLoop();
}

function loadCurrentContent(autoplay, startTimeOverride = null) {
    const stream = core.getCurrentStream();
    const song = core.getCurrentSong();

    if (!stream || !song) return;

    let startSeconds = song.range[0];
    let endSeconds = undefined;

    if (core.yapMode && stream.songs) {
        // Yap mode plays continuously from the first to the last segment.
        startSeconds = stream.songs[0].range[0];
        endSeconds = stream.songs[stream.songs.length - 1].range[1];
    } else if (!core.yapMode && !stream.songs) {
        // Rule 0: single-song video – keep a hard end bound.
        endSeconds = song.range[1];
    } else if (core.yapMode && !stream.songs) {
        // Single song video in yap mode behaves same as standard.
        endSeconds = song.range[1];
    }

    if (core.yapMode && stream.songs && core.rIdx > 0 && startTimeOverride === null) {
        startSeconds = song.range[0];
    }

    if (startTimeOverride !== null && startTimeOverride >= 0) {
        startSeconds = startTimeOverride;
    }

    if (endSeconds === 0 || !endSeconds) {
        endSeconds = undefined; // Let it play to end
    }

    playVideoAt(stream, startSeconds, endSeconds);
    refreshStatusSongList();
}

// ======== UI WIRES ========
btnPrevStream.addEventListener('click', (event) => {
    // Shift+click bypasses history and goes to actual previous stream (when shuffle is ON)
    if (core.prevStream({ skipHistory: event.shiftKey })) loadCurrentContent(true);
});

btnNextStream.addEventListener('click', () => {
    if (core.nextStream()) loadCurrentContent(true);
});

btnPrevSong.addEventListener('click', () => {
    const curTime = getSafeCurrentTime();
    const action = core.prevSong(curTime);
    if (action.type === 'load') {
        loadCurrentContent(true);
    } else if (action.type === 'seek') {
        core.cb.seekTo(action.time);
        if (action.reload) {
            loadCurrentContent(true);
        }
    }
});

btnNextSong.addEventListener('click', () => {
    const curTime = getSafeCurrentTime();
    const action = core.nextSong(curTime);
    if (action.type === 'load') loadCurrentContent(true);
    if (action.type === 'seek') core.cb.seekTo(action.time);
});

btnLoop.addEventListener('click', () => {
    core.toggleLoop();
    updateButtons();
});

btnShuffle.addEventListener('click', () => {
    core.toggleShuffle();
    updateButtons();
});

if (btnSearch) {
    btnSearch.addEventListener('click', () => {
        const now = Date.now();
        if (now - modalToggleTime < 400) return; // Debounce rapid clicks
        modalToggleTime = now;
        toggleModal();
    });
}

if (btnDuplicates && fuse) {
    btnDuplicates.addEventListener('click', () => {
        if (!duplicateSearchName) return;
        if (!modal.classList.contains('open')) {
            toggleModal();
        }

        searchInput.value = duplicateSearchName;
        if (fuse) {
            const results = fuse.search(duplicateSearchName, { limit: 20 });
            renderResults(results.map(r => r.item));
        }
    });
}

if (statusEl) {
    statusEl.addEventListener('click', () => toggleStatusPanel());
    statusEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleStatusPanel();
        }
    });
}

btnYap.addEventListener('click', () => {
    const now = Date.now();
    if (now - yapToggleTime < YAP_TOGGLE_DEBOUNCE_MS) return;
    yapToggleTime = now;

    core.toggleYap();
    updateButtons();

    const t = getSafeCurrentTime();
    core.syncToTime(t);

    if (!core.yapMode) { // Switched TO Standard
        const stream = core.getCurrentStream();
        if (stream.songs) {
            const idx = stream.songs.findIndex(s => t >= s.range[0] && t < s.range[1]);
            if (idx !== -1) core.rIdx = idx;
        }
    }

    const stream = core.getCurrentStream();
    if (!stream) return;
    const song = core.getCurrentSong();

    let endSeconds = undefined;
    if (core.yapMode && stream.songs) {
        // Switching into Yap: play continuously to the end of the last song.
        endSeconds = stream.songs[stream.songs.length - 1].range[1];
    } else if (!core.yapMode && !stream.songs) {
        // Switching out of Yap on a Rule 0 stream keeps a bounded end.
        endSeconds = song.range[1];
    }

    playVideoAt(stream, t, endSeconds);
});

btnStart.addEventListener('click', () => requestStartPlayback());

function setStatus(msg) {
    if (!statusTextEl) return;
    if (msg === lastStatusText) return;
    lastStatusText = msg;
    statusTextEl.textContent = msg;
}

function toggleStatusPanel(forceState) {
    if (!statusEl || !statusPanel || !statusSongList || !playlistReady) return;

    refreshStatusSongList();

    const hasSongs = statusSongList.children.length > 0;
    let nextState = typeof forceState === 'boolean' ? forceState : !statusPanelOpen;
    if (nextState && !hasSongs) {
        nextState = false;
    }
    statusPanelOpen = nextState;

    statusPanel.classList.toggle('open', statusPanelOpen);
    statusPanel.setAttribute('aria-hidden', statusPanelOpen ? 'false' : 'true');
    statusPanel.inert = !statusPanelOpen;
    statusEl.setAttribute('aria-expanded', statusPanelOpen ? 'true' : 'false');

    if (statusPanelOpen) {
        initializeStatusPanelSelection(true);
    } else {
        clearStatusPanelSelection();
    }
}

function refreshStatusSongList(force = false) {
    if (!statusSongList || !playlistReady) return;
    const stream = core.getCurrentStream();
    if (!stream) return;

    const songs = getStatusSongsForStream(stream);
    const streamId = stream.videoId || `stream-${core.vIdx}`;

    if (!force && statusPanelStreamId === streamId && statusPanelSongCount === songs.length) {
        syncStatusPanelActiveState();
        return;
    }

    statusPanelStreamId = streamId;
    statusPanelSongCount = songs.length;

    statusSongList.innerHTML = '';
    songs.forEach((song, idx) => {
        const item = document.createElement('li');
        item.className = 'status-song';
        item.dataset.songIndex = String(idx);
        item.tabIndex = 0;
        item.setAttribute('role', 'option');
        item.innerHTML = `
            <span class="status-song-index">${idx + 1}.</span>
            <span class="status-song-name">${song.name || `Track ${idx + 1}`}</span>
        `;
        item.addEventListener('click', () => handleStatusSongPick(idx));
        item.addEventListener('focus', () => {
            if (!statusPanelOpen) return;
            statusPanelSelIdx = idx;
            applyStatusPanelSelection(false);
        });
        statusSongList.appendChild(item);
    });

    syncStatusPanelActiveState();
    if (statusPanelOpen) {
        initializeStatusPanelSelection();
    }
}

function getStatusSongsForStream(stream) {
    if (stream && Array.isArray(stream.songs) && stream.songs.length) {
        return stream.songs;
    }
    if (!stream) return [];
    return [{
        name: stream.title || stream.name || 'Full Stream',
        range: [core.getStreamDefaultStart(stream) || 0, null]
    }];
}

function handleStatusSongPick(songIndex) {
    const stream = core.getCurrentStream();
    if (!stream) return;

    const songs = getStatusSongsForStream(stream);
    if (!songs.length) return;

    const safeIdx = Math.min(Math.max(songIndex, 0), songs.length - 1);
    core.rIdx = safeIdx;

    const targetRange = songs[safeIdx].range;
    const startSeconds = Array.isArray(targetRange) && Number.isFinite(targetRange[0])
        ? targetRange[0]
        : core.getStreamDefaultStart(stream);

    if (!stream.songs || !stream.songs.length || core.yapMode) {
        seekToSafe(startSeconds, stream);
    } else {
        loadCurrentContent(true, startSeconds);
    }

    syncStatusPanelActiveState();
    toggleStatusPanel(false);
}

function getActiveStatusSongIndex(currentTime) {
    const stream = core.getCurrentStream();
    if (!stream) return 0;

    const songs = getStatusSongsForStream(stream);
    if (!songs.length) return 0;

    if (!stream.songs || !stream.songs.length) {
        return 0;
    }

    if (Number.isFinite(currentTime)) {
        const matchIdx = stream.songs.findIndex(
            (song) => currentTime >= song.range[0] && currentTime < song.range[1]
        );
        if (matchIdx !== -1) {
            return Math.min(Math.max(matchIdx, 0), songs.length - 1);
        }
        return -1;
    }

    const fallbackIdx = Number.isFinite(core.rIdx) ? core.rIdx : 0;
    return Math.min(Math.max(fallbackIdx, 0), songs.length - 1);
}

function initializeStatusPanelSelection(ensureVisible = false) {
    if (!statusPanelOpen || !statusSongList || !statusSongList.children.length) {
        statusPanelSelIdx = -1;
        return;
    }
    const currentTime = player && typeof player.getCurrentTime === 'function'
        ? player.getCurrentTime()
        : undefined;
    statusPanelSelIdx = getActiveStatusSongIndex(currentTime);
    applyStatusPanelSelection(ensureVisible);
}

function clearStatusPanelSelection() {
    statusPanelSelIdx = -1;
    if (!statusSongList) return;
    statusSongList.querySelectorAll('.status-song').forEach((row) => {
        row.classList.remove('nav-focus');
    });
}

function applyStatusPanelSelection(ensureVisible = false) {
    if (!statusSongList) return;
    const rows = statusSongList.querySelectorAll('.status-song');
    if (!rows.length) {
        statusPanelSelIdx = -1;
        return;
    }

    const shouldHighlight = statusPanelOpen && statusPanelSelIdx >= 0;
    const clampedIdx = shouldHighlight
        ? Math.min(Math.max(statusPanelSelIdx, 0), rows.length - 1)
        : -1;

    rows.forEach((row, idx) => {
        row.classList.toggle('nav-focus', shouldHighlight && idx === clampedIdx);
    });

    if (!shouldHighlight) return;

    if (clampedIdx !== statusPanelSelIdx) {
        statusPanelSelIdx = clampedIdx;
    }

    if (ensureVisible) {
        const target = rows[statusPanelSelIdx];
        target.scrollIntoView({ block: 'nearest' });
        target.focus({ preventScroll: true });
    }
}

function syncStatusPanelActiveState(currentTime) {
    if (!statusSongList || !statusSongList.children.length) return;
    const rows = statusSongList.querySelectorAll('.status-song');
    if (!rows.length) return;

    const candidateIdx = getActiveStatusSongIndex(currentTime);
    const activeIdx = candidateIdx >= 0
        ? Math.min(Math.max(candidateIdx, 0), rows.length - 1)
        : -1;

    rows.forEach((row, idx) => {
        const isActive = idx === activeIdx;
        row.classList.toggle('active', isActive);
        row.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    if (!statusPanelOpen) return;

    if (statusPanelSelIdx === -1 && activeIdx >= 0) {
        statusPanelSelIdx = activeIdx;
    }

    applyStatusPanelSelection(false);
}

// ======== SEARCH LOGIC ========
let lastShiftTime = 0;

function updateSearchButtonFullscreenVisibility() {
    if (!btnSearch) return;
    const isFullscreen =
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement;

    btnSearch.style.display = isFullscreen ? 'none' : 'flex';

    if (btnDuplicates) {
        if (isFullscreen) {
            btnDuplicates.style.display = 'none';
        } else {
            // Restore visibility based on current song / duplicate state
            updateDuplicateButtonForCurrentSong();
        }
    }
}

document.addEventListener('fullscreenchange', updateSearchButtonFullscreenVisibility);
document.addEventListener('webkitfullscreenchange', updateSearchButtonFullscreenVisibility);
document.addEventListener('mozfullscreenchange', updateSearchButtonFullscreenVisibility);
document.addEventListener('MSFullscreenChange', updateSearchButtonFullscreenVisibility);
document.addEventListener('visibilitychange', () => {
    evaluateTickLoop();
    if (!document.hidden) {
        updateStatus();
    }
});

function toggleModal() {
    const isOpen = modal.classList.toggle('open');
    modal.inert = !isOpen;
    if (isOpen) {
        searchInput.value = '';
        renderResults([]);
        searchInput.focus();
    }
}

modal.addEventListener('click', (e) => {
    // Only close when clicking the overlay backdrop, not the wrapper or comic-box
    if (e.target === modal) {
        toggleModal();
    }
});

function handleGlobalPointerDown(event) {
    if (!statusPanelOpen || !statusPanel || !statusEl) return;
    if (statusPanel.contains(event.target) || statusEl.contains(event.target)) return;
    toggleStatusPanel(false);
}

document.addEventListener('pointerdown', handleGlobalPointerDown, true);
window.addEventListener('blur', () => {
    if (statusPanelOpen) {
        toggleStatusPanel(false);
    }
});

document.addEventListener('keydown', (e) => {
    const modalOpen = modal.classList.contains('open');

    if (e.key === 'Escape') {
        if (modalOpen) {
            e.preventDefault();
            toggleModal();
            return;
        }
        if (statusPanelOpen) {
            e.preventDefault();
            toggleStatusPanel(false);
            return;
        }
    }

    if (!modalOpen && statusPanelOpen) {
        const totalItems = statusSongList ? statusSongList.children.length : 0;
        const computedIdx = statusPanelSelIdx >= 0
            ? statusPanelSelIdx
            : getActiveStatusSongIndex(player && typeof player.getCurrentTime === 'function'
                ? player.getCurrentTime()
                : undefined);
        const currentIdx = computedIdx >= 0 ? computedIdx : 0;

        const handledStatusNav = handleListKeyEvent(e, {
            currentIndex: currentIdx,
            totalItems,
            onMove: (nextIndex) => {
                statusPanelSelIdx = nextIndex;
                applyStatusPanelSelection(true);
            },
            onSelect: (nextIndex) => {
                statusPanelSelIdx = nextIndex;
                handleStatusSongPick(nextIndex);
            }
        });

        if (handledStatusNav) {
            return;
        }
    }

    if (e.key === 'S' && e.shiftKey) {
        e.preventDefault();
        toggleModal();
        return;
    }

    if (e.key === 'A' && e.shiftKey) {
        e.preventDefault();
        toggleStatusPanel();
        return;
    }

    if (e.key === 'Shift' && !e.repeat) {
        const now = Date.now();
        if (now - lastShiftTime < 300) {
            toggleModal();
        }
        lastShiftTime = now;
    }

    if (modalOpen) {
        const handledSearchNav = handleListKeyEvent(e, {
            currentIndex: searchSelIdx,
            totalItems: searchResults.length,
            onMove: (nextIndex) => {
                searchSelIdx = nextIndex;
                updateSelection();
            },
            onSelect: (nextIndex) => {
                if (searchResults[nextIndex]) {
                    selectResult(searchResults[nextIndex]);
                }
            }
        });

        if (handledSearchNav) {
            // noinspection UnnecessaryReturnStatementJS
            return;
        }
    }
});

searchInput.addEventListener('input', (e) => {
    if (!fuse) return;
    const query = e.target.value;
    if (!query) {
        renderResults([]);
        return;
    }
    const results = fuse.search(query, { limit: 20 });
    renderResults(results.map(r => r.item));
});

function renderResults(items) {
    // Sort results to place the currently opened stream last among exact matches
    const currentStreamId = core.vIdx;
    const sortedItems = sortSearchResultsByCurrentStream(items, currentStreamId);

    searchResults = sortedItems;
    searchSelIdx = 0;
    resultsContainer.innerHTML = '';

    sortedItems.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'result-item';
        if (idx === 0) div.classList.add('selected');

        div.innerHTML = `
                <span class="result-title">${item.name}</span>
                <span class="result-sub">${item.streamName} • Song ${item.songId + 1}</span>
            `;

        div.addEventListener('click', () => selectResult(item));
        resultsContainer.appendChild(div);
    });
}

function updateSelection() {
    const rows = resultsContainer.querySelectorAll('.result-item');
    rows.forEach((r, i) => {
        r.classList.toggle('selected', i === searchSelIdx);
        if (i === searchSelIdx) r.scrollIntoView({ block: 'nearest' });
    });
}

function selectResult(item) {
    core.vIdx = item.streamId;
    core.rIdx = item.songId;
    loadCurrentContent(true);
    toggleModal();
}

function handleListKeyEvent(event, { currentIndex, totalItems, onMove, onSelect }) {
    const nav = resolveListNavigation(event.key, currentIndex, totalItems);
    if (!nav.handled) return false;

    event.preventDefault();

    if (nav.action === NAV_ACTION_MOVE) {
        if (typeof onMove === 'function') {
            onMove(nav.nextIndex);
        }
    } else if (nav.action === NAV_ACTION_SELECT) {
        if (typeof onSelect === 'function') {
            onSelect(nav.nextIndex);
        }
    }

    return true;
}

function updateDuplicateButtonForCurrentSong() {
    if (!btnDuplicates || !playlistReady) return;

    const stream = core.getCurrentStream();
    const song = core.getCurrentSong();

    if (!stream || !song || !song.name) {
        btnDuplicates.style.display = 'none';
        duplicateSearchName = '';
        return;
    }

    const baseName = normalizeSongBaseName(song.name);
    const key = baseName.toLocaleLowerCase('en-US');
    const entry = duplicateNameIndex.get(key);

    if (!entry || entry.count <= 1) {
        btnDuplicates.style.display = 'none';
        duplicateSearchName = '';
        return;
    }

    const otherCount = entry.count - 1;

    duplicateSearchName = entry.baseName || baseName;
    btnDuplicates.style.display = 'flex';
    const countSpan = btnDuplicates.querySelector('.note-count');
    if (countSpan) {
        countSpan.textContent = String(otherCount);
    }
    btnDuplicates.title = `Search other versions of "${duplicateSearchName}"`;
}

// ======== Wanted Poster ========
const boltTrigger = document.getElementById('bolt-trigger');
const wantedOverlay = document.getElementById('wanted-overlay');

if (boltTrigger && wantedOverlay) {
    boltTrigger.addEventListener('click', () => {
        wantedOverlay.classList.add('open');
    });

    wantedOverlay.addEventListener('click', (e) => {
        if (e.target === wantedOverlay) {
            wantedOverlay.classList.remove('open');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && wantedOverlay.classList.contains('open')) {
            wantedOverlay.classList.remove('open');
        }
    });
}

// ======== Message Bar ========
const messageBar = document.getElementById('message-bar');
const messageText = document.getElementById('message-text');
const messageClose = document.getElementById('message-close');

const MESSAGE_WPM = 70;
const MESSAGE_MIN_SECONDS = 10;

let messageQueueInstance = null;
let messageTimeoutHandle = null;

function showNextMessage() {
    if (!messageBar || !messageText || !messageQueueInstance) return;

    const next = messageQueueInstance.next();
    if (!next) return;

    // Trigger re-animation by briefly removing the element content
    messageText.style.animation = 'none';
    messageText.offsetHeight; // Force reflow
    messageText.style.animation = '';
    messageText.textContent = next.message;

    messageTimeoutHandle = setTimeout(showNextMessage, next.duration * 1000);
}

function stopMessageCycle() {
    if (messageTimeoutHandle) {
        clearTimeout(messageTimeoutHandle);
        messageTimeoutHandle = null;
    }
}

function hideMessageBar() {
    stopMessageCycle();
    if (messageBar) {
        messageBar.hidden = true;
    }
}

function initMessageBar() {
    try {
        const validMessages = validateMessages(messagesData);

        if (validMessages.length === 0) {
            console.log('[Messages] No valid messages found in messages.json');
            return;
        }

        messageQueueInstance = new MessageQueue(validMessages, {
            wpm: MESSAGE_WPM,
            minSeconds: MESSAGE_MIN_SECONDS
        });

        if (messageBar) {
            messageBar.hidden = false;
        }

        showNextMessage();

        console.log(`[Messages] Loaded ${messageQueueInstance.size} messages`);
    } catch (err) {
        console.warn('[Messages] Failed to initialize message bar:', err.message);
    }
}

if (messageClose) {
    messageClose.addEventListener('click', hideMessageBar);
}

setTimeout(initMessageBar, 500);