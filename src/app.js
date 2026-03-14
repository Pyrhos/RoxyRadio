import { PlayerCore } from './player-core.js';
import segmentsData from './data/segments.json';
import messagesData from './data/messages.json';
import { createMessageBarController } from './message-bar-ui.js';
import { initWantedPoster } from './wanted-poster.js';
import { createSearchController } from './search-modal.js';
import { createStatusPanelController } from './status-panel.js';
import { createImportAndMoreController } from './import-ui.js';
import { createQueueModalController } from './queue-modal.js';
import { createPlaybackController } from './playback.js';
import { validateSegmentData } from './import-helpers.js';
import { flashEnqueue } from './enqueue-flash.js';

// ======== CONFIG ========
const TICK_MS = 200;
const TITLE_REFRESH_MS = 2000;
const YAP_TOGGLE_DEBOUNCE_MS = 300;
const VIDEO_LOAD_DEBOUNCE_MS = 300;

// ======== STATE ========
let player = null;
let isReady = false;
let playlistReady = false;
let pendingStart = false;
let yapToggleTime = 0;

// URL parameter override (YouTube-style ?v= and ?t= params)
let urlOverride = null;

// Active segment source — defaults to built-in, overridden by import
let activeSegments = segmentsData;

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
const controlsContainer = document.getElementById('controls-container');

const statusEl = document.getElementById('status');
const statusTextEl = document.getElementById('status-text');
const statusPanel = document.getElementById('status-panel');
const statusSongList = document.getElementById('status-song-list');

const modal = document.getElementById('modal-overlay');
const searchInput = document.getElementById('search-input');
const resultsContainer = document.getElementById('search-results');

const importModal = document.getElementById('import-overlay');
const importReplaceBtn = document.getElementById('import-replace-btn');
const importAppendBtn = document.getElementById('import-extend-btn');
const importStatus = document.getElementById('import-status');

const moreOverlay = document.getElementById('more-overlay');
const moreBtn = document.getElementById('more-btn');
const moreMemberBtn = document.getElementById('more-member-btn');
const moreImportBtn = document.getElementById('more-import-btn');
const moreCopyBtn = document.getElementById('more-copy-btn');
const moreCloseBtn = document.getElementById('more-close-btn');

const queueOverlay = document.getElementById('queue-overlay');
const queueListEl = document.getElementById('queue-list');
const queueClearBtn = document.getElementById('queue-clear-btn');
const queueCell = document.getElementById('queue-cell');
const mobileQueueBtn = document.getElementById('mobile-queue-btn');
const moreCell = document.getElementById('more-cell');

let lastStatusText = '';
let lastTitleText = document.title;
let lastAppliedTheme = 0;

// Core Logic Instance
const core = new PlayerCore({
    playVideo: (forceStart = true) => loadCurrentContent(forceStart),
    seekTo: (time) => {
        playbackCtrl.seekToSafe(time);
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

// ======== CONTROLLERS ========

const playbackCtrl = createPlaybackController({
    getPlayer: () => player,
    getCurrentStream: () => core.getCurrentStream(),
    sanitizeStartTime: (time, stream) => core.sanitizeStartTime(time, stream),
    isYapMode: () => core.yapMode,
    onTick: (t) => {
        updateStatus(t);
        core.checkTick(t);
    },
    onSeek: (t) => {
        updateStatus(t);
    },
    TICK_MS,
    VIDEO_LOAD_DEBOUNCE_MS,
    TITLE_REFRESH_MS,
});

const searchCtrl = createSearchController({
    modal, searchInput, resultsContainer, btnSearch, btnDuplicates,
    getCurrentStreamIdx: () => core.vIdx,
    getCurrentSong: () => core.getCurrentSong(),
    onSelectResult: (vIdx, rIdx) => {
        core.vIdx = vIdx;
        core.rIdx = rIdx;
        loadCurrentContent(true);
    },
    onEnqueueResult: (vIdx, rIdx) => {
        const stream = core.playlist[vIdx];
        if (stream) {
            core.enqueue(stream.videoId, rIdx);
            updateQueueIndicator();
            updateButtons();
        }
    },
});

const statusCtrl = createStatusPanelController({
    statusEl, statusPanel, statusSongList,
    getCurrentStream: () => core.getCurrentStream(),
    getCurrentStreamIdx: () => core.vIdx,
    getCoreRIdx: () => core.rIdx,
    getStreamDefaultStart: (stream) => core.getStreamDefaultStart(stream),
    getPlayerTime: () => player && typeof player.getCurrentTime === 'function'
        ? player.getCurrentTime()
        : undefined,
    isPlaylistReady: () => playlistReady,
    onEnqueueSong: (videoId, rIdx) => {
        core.enqueue(videoId, rIdx);
        updateQueueIndicator();
        updateButtons();
    },
    onSongPick: (safeIdx) => {
        const stream = core.getCurrentStream();
        if (!stream) return;

        core.rIdx = safeIdx;

        const songs = stream.songs || [{ name: stream.title || stream.name || 'Full Stream', range: [core.getStreamDefaultStart(stream) || 0, null] }];
        const targetRange = songs[safeIdx].range;
        const startSeconds = Array.isArray(targetRange) && Number.isFinite(targetRange[0])
            ? targetRange[0]
            : core.getStreamDefaultStart(stream);

        if (!stream.songs || !stream.songs.length || core.yapMode) {
            playbackCtrl.seekToSafe(startSeconds, stream);
        } else {
            loadCurrentContent(true, startSeconds);
        }
    },
    beforeOpen: () => closeAllModals(),
});

const importCtrl = createImportAndMoreController({
    importModal, importStatus,
    moreOverlay, moreMemberBtn, moreBtn, moreCopyBtn, moreImportBtn, moreCloseBtn,
    importReplaceBtn, importAppendBtn,
    importResetBtn: document.getElementById('import-reset-btn'),
    onImportReplace: (data) => {
        core.init(data);
        if (!core.playlist.length) {
            importCtrl.setImportStatus('Import produced an empty playlist', 'error');
            console.warn('[Import] Imported data produced an empty playlist');
            core.init(activeSegments);
            rebuildPlaylistDerivedState();
            return;
        }

        activeSegments = data;
        persistCustomSegments(data);

        core.vIdx = 0;
        core.rIdx = 0;
        rebuildPlaylistDerivedState();
        updateButtons();
        loadCurrentContent(true);
        importCtrl.setImportStatus(`Replaced - ${core.playlist.length} streams loaded`, 'ok');
        importCtrl.toggleImportModal();
        console.log(`[Import] Replaced with ${core.playlist.length} streams from clipboard`);
    },
    onImportAppend: (data) => {
        const importedIds = new Set(data.map(entry => entry.videoId));
        const kept = activeSegments.filter(entry => !importedIds.has(entry.videoId));
        const merged = [...kept, ...data];

        core.init(merged);
        if (!core.playlist.length) {
            importCtrl.setImportStatus('Merge produced an empty playlist', 'error');
            console.warn('[Import] Merged data produced an empty playlist');
            core.init(activeSegments);
            rebuildPlaylistDerivedState();
            return;
        }

        activeSegments = merged;
        persistCustomSegments(merged);

        core.vIdx = 0;
        core.rIdx = 0;
        rebuildPlaylistDerivedState();
        updateButtons();
        loadCurrentContent(true);
        importCtrl.setImportStatus(`Extended - ${core.playlist.length} streams total`, 'ok');
        console.log(`[Import] Appended ${data.length} streams (${importedIds.size} unique), total ${core.playlist.length}`);
    },
    onImportReset: () => {
        activeSegments = segmentsData;
        localStorage.removeItem('roxy_customSegments');

        core.init(activeSegments);
        core.vIdx = 0;
        core.rIdx = 0;
        rebuildPlaylistDerivedState();
        updateButtons();
        loadCurrentContent(true);
        importCtrl.setImportStatus(`Reset - ${core.playlist.length} default streams restored`, 'ok');
        importCtrl.toggleImportModal();
        console.log(`[Import] Reset to default playlist (${core.playlist.length} streams)`);
    },
    onMemberToggle: () => performMemberModeToggle(),
    onCopyShareUrl: (buttonEl) => {
        const stream = core.getCurrentStream();
        if (stream && stream.videoId) {
            const currentTime = playbackCtrl.getSafeCurrentTime();
            const timeParam = Math.floor(currentTime);
            const shareUrl = `${window.location.origin}${window.location.pathname}?v=${stream.videoId}&t=${timeParam}`;
            navigator.clipboard.writeText(shareUrl).then(() => {
                const original = buttonEl.textContent;
                buttonEl.textContent = 'Copied!';
                setTimeout(() => { buttonEl.textContent = original; }, 1500);
            }).catch(err => {
                console.error('[Share] Failed to copy URL to clipboard', err);
            });
        }
    },
    isMemberMode: () => core.memberMode,
});

const queueCtrl = createQueueModalController({
    overlay: queueOverlay,
    queueList: queueListEl,
    clearAllBtn: queueClearBtn,
    getQueue: () => core.getQueue(),
    getPlaylist: () => core.playlist,
    onRemoveItem: (idx) => {
        core.removeFromQueue(idx);
        queueCtrl.render();
        updateQueueIndicator();
        updateButtons();
    },
    onSelectItem: (idx) => {
        if (!core.selectQueueItem(idx)) return;
        queueCtrl.toggle();
        loadCurrentContent(true);
    },
    onClearAll: () => {
        core.clearQueue();
        queueCtrl.render();
        updateQueueIndicator();
        updateButtons();
    },
});

if (queueCell) {
    queueCell.addEventListener('click', () => {
        closeOtherModals('queue');
        queueCtrl.toggle();
    });
}

if (mobileQueueBtn) {
    mobileQueueBtn.addEventListener('click', () => {
        closeOtherModals('queue');
        queueCtrl.toggle();
    });
}

if (moreCell) {
    moreCell.addEventListener('click', () => {
        closeOtherModals('more');
        importCtrl.toggleMoreOverlay();
    });
}

const messageBarCtrl = createMessageBarController({
    messageBar: document.getElementById('message-bar'),
    messageText: document.getElementById('message-text'),
    messageClose: document.getElementById('message-close'),
    messagesData,
});

initWantedPoster({
    boltTrigger: document.getElementById('bolt-trigger'),
    wantedOverlay: document.getElementById('wanted-overlay'),
});

// ======== PLAYBACK LIFECYCLE ========

playbackCtrl.ensureTitleRefreshLoop((t) => updateStatus(t));

window.addEventListener('beforeunload', () => {
    let time = playbackCtrl.getLastKnownTime();
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

        const streamIdx = core.playlist.findIndex(s => s.videoId === videoId);
        if (streamIdx === -1) {
            console.log(`[URL] v=${videoId} not found in playlist, ignoring`);
            return null;
        }

        const result = { streamIdx, time: null };

        if (timestamp !== null) {
            const t = parseFloat(timestamp);
            if (Number.isFinite(t) && t >= 0) {
                const stream = core.playlist[streamIdx];

                if (stream.songs && stream.songs.length > 0) {
                    const firstStart = stream.songs[0].range[0];
                    const lastEnd = stream.songs[stream.songs.length - 1].range[1];

                    if (t >= firstStart && t <= lastEnd) {
                        result.time = t;
                    } else {
                        console.log(`[URL] t=${t} is outside segment bounds [${firstStart}, ${lastEnd}], ignoring timestamp`);
                    }
                } else {
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

function rebuildPlaylistDerivedState() {
    searchCtrl.rebuild(core.playlist);
    statusCtrl.refresh(true);
}

function persistCustomSegments(data) {
    try {
        localStorage.setItem('roxy_customSegments', JSON.stringify(data));
    } catch (err) {
        console.warn('[Import] Failed to persist custom segments:', err.message);
    }
}

function initializePlaylist() {
    try {
        // Restore custom playlist from localStorage if present
        const savedSegments = localStorage.getItem('roxy_customSegments');
        if (savedSegments) {
            try {
                const parsed = JSON.parse(savedSegments);
                if (validateSegmentData(parsed)) {
                    activeSegments = parsed;
                    console.log(`[Import] Restored ${parsed.length} custom streams from localStorage`);
                } else {
                    localStorage.removeItem('roxy_customSegments');
                }
            } catch {
                localStorage.removeItem('roxy_customSegments');
            }
        }

        core.init(activeSegments);

        if (!core.playlist.length) throw new Error('Empty playlist');

        // Check URL params to override saved state (YouTube-style ?v= and ?t=)
        urlOverride = parseUrlParams();
        if (urlOverride) {
            core.vIdx = urlOverride.streamIdx;
            core.rIdx = 0;
            console.log(`[URL] Jumping to stream index ${urlOverride.streamIdx}` +
                (urlOverride.time !== null ? ` at t=${urlOverride.time}` : ''));
        }

        updateButtons();

        rebuildPlaylistDerivedState();

        playlistReady = true;
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
                playbackCtrl.resetLoadedVideoId();
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

const THEME_NAMES = [null, 'starry-night'];

function syncTheme() {
    const song = core.getCurrentSong();
    const theme = (song && song.theme) || 0;
    if (theme === lastAppliedTheme) return;
    lastAppliedTheme = theme;
    const name = THEME_NAMES[theme];
    if (name) {
        document.documentElement.setAttribute('data-theme', name);
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
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

    syncTheme();
    searchCtrl.updateDuplicateButton();
    statusCtrl.syncActiveState(t);
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

// Debug button logic
if (import.meta.env.DEV) {
    const debugBtn = document.getElementById('debug-btn');
    const debugEndBtn = document.getElementById('debug-end-btn');
    const debugContainer = document.getElementById('debug-container');

    if (debugContainer) {
        debugContainer.style.display = 'flex';

        if (debugBtn) {
            debugBtn.addEventListener('click', () => {
                if (player && typeof player.getCurrentTime === 'function') {
                    const t = player.getCurrentTime();
                    const val = Math.ceil(t).toString();
                    navigator.clipboard.writeText(val).then(() => {
                        const originalText = debugBtn.textContent;
                        debugBtn.textContent = 'Copied!';
                        setTimeout(() => debugBtn.textContent = originalText, 1000);
                    }).catch(err => {
                        console.error('Failed to copy timestamp', err);
                    });
                }
            });
        }

        if (debugEndBtn) {
            debugEndBtn.addEventListener('click', () => {
                const song = core.getCurrentSong();
                if (song && song.range) {
                    const time = Math.max(song.range[0], song.range[1] - 5);
                    playbackCtrl.seekToSafe(time);
                }
            });
        }
    }
}

function performMemberModeToggle() {
    const wasOnMemberStream = core.getCurrentStream()?.memberOnly === true;
    const deactivating = core.memberMode;
    let targetVideoId = null;

    if (deactivating && wasOnMemberStream) {
        const curId = core.getCurrentStream().videoId;
        const origIdx = activeSegments.findIndex(v => v.videoId === curId);
        for (let i = 1; i <= activeSegments.length; i++) {
            const candidate = activeSegments[(origIdx + i) % activeSegments.length];
            if (!candidate.memberOnly) {
                targetVideoId = candidate.videoId;
                break;
            }
        }
    }

    core.toggleMemberMode();
    core.init(activeSegments);

    if (targetVideoId) {
        const idx = core.playlist.findIndex(p => p.videoId === targetVideoId);
        if (idx !== -1) {
            core.vIdx = idx;
            core.rIdx = 0;
        }
    }

    rebuildPlaylistDerivedState();
    updateButtons();
    loadCurrentContent(true);
}

function updateButtons() {
    const queueActive = core.isQueueActive();

    // Yap button — disabled while queue is active
    const yapOn = core.yapMode;
    updateButtonLabel(btnYap, `Yap: ${yapOn ? 'On' : 'Off'}`, yapOn);
    updateButtonIcon(iconYap, yapOn ? './yap.png' : './noyap.png', yapOn ? 'Yap on' : 'Yap off');
    btnYap.disabled = queueActive;

    // Loop button — third state label changes when queue is active
    const loopMode = core.loopMode;
    const loopLabel = (loopMode === 2 && queueActive) ? 'Queue' : loopLabels[loopMode];
    updateButtonLabel(btnLoop, `Loop: ${loopLabel}`, loopMode !== 0);
    updateButtonIcon(iconLoop, loopIcons[loopMode], loopAlts[loopMode]);

    // Shuffle button
    const shuffleOn = core.shuffleMode;
    updateButtonLabel(btnShuffle, `Shuffle: ${shuffleOn ? 'On' : 'Off'}`, shuffleOn);

    // Next/prev stream — disabled while queue is active (queue overrides stream nav)
    btnPrevStream.disabled = queueActive;
    btnNextStream.disabled = queueActive;

    // Member mode indicator on controls bar
    if (controlsContainer) {
        controlsContainer.classList.toggle('member-mode', core.memberMode);
    }

    importCtrl.updateMoreMemberBtn();
}

function updateQueueIndicator() {
    const queue = core.getQueue();
    const active = queue.length > 0;
    if (queueCell) {
        queueCell.innerHTML = active
            ? `<span class="queue-cell-icon">▶▶</span> Queue (${queue.length})`
            : `<span class="queue-cell-icon">▶▶</span> Queue`;
    }
    if (mobileQueueBtn) {
        mobileQueueBtn.textContent = active ? `▶▶ Queue (${queue.length})` : '▶▶ Queue';
    }
}

// Close every modal/panel except the one about to open.
// Each entry: [check, close] — skipped when it matches the exclude key.
function closeOtherModals(except) {
    if (except !== 'search' && searchCtrl.isOpen()) searchCtrl.toggle();
    if (except !== 'queue' && queueCtrl.isOpen()) queueCtrl.toggle();
    if (except !== 'status' && statusCtrl.isOpen()) statusCtrl.close();
    if (except !== 'import' && importCtrl.isImportOpen()) importCtrl.toggleImportModal();
    if (except !== 'more' && importCtrl.isMoreOpen()) importCtrl.toggleMoreOverlay();
}

// Intercept clicks on internally-wired modal triggers so we close others first.
// Uses capture phase to run before the controller's own toggle handler.
if (btnSearch) btnSearch.addEventListener('click', () => closeOtherModals('search'), true);
if (statusEl) statusEl.addEventListener('click', () => closeOtherModals('status'), true);
if (moreBtn) moreBtn.addEventListener('click', () => closeOtherModals('more'), true);

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

    if (urlOverride) {
        if (urlOverride.time !== null) {
            startTime = core.normalizeResumeTime(urlOverride.time);
        }
        urlOverride = null;
    } else {
        const savedTime = core.getStartSeconds();
        const resumeTime = core.normalizeResumeTime(savedTime);
        startTime = resumeTime > 0 ? resumeTime : null;
    }

    loadCurrentContent(true, startTime);

    playbackCtrl.stopTickLoop();
    playbackCtrl.evaluateTickLoop();
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
                        // Enrich bare imports so they appear in search
                        if (!stream.name) {
                            stream.name = data.title;
                            const seg = activeSegments.find(s => s.videoId === stream.videoId);
                            if (seg && !seg.name) {
                                seg.name = data.title;
                                if (activeSegments !== segmentsData) {
                                    persistCustomSegments(activeSegments);
                                }
                            }
                        }
                        rebuildPlaylistDerivedState();
                    }
                }
            }
        }
    }

    playbackCtrl.evaluateTickLoop();
}

function loadCurrentContent(autoplay, startTimeOverride = null) {
    const stream = core.getCurrentStream();
    const song = core.getCurrentSong();

    if (!stream || !song) return;

    let startSeconds = song.range[0];
    let endSeconds = undefined;

    if (core.yapMode && stream.songs) {
        startSeconds = stream.songs[0].range[0];
        endSeconds = stream.songs[stream.songs.length - 1].range[1];
    } else if (!core.yapMode && !stream.songs) {
        endSeconds = song.range[1];
    } else if (core.yapMode && !stream.songs) {
        endSeconds = song.range[1];
    }

    if (core.yapMode && stream.songs && core.rIdx > 0 && startTimeOverride === null) {
        startSeconds = song.range[0];
    }

    if (startTimeOverride !== null && startTimeOverride >= 0) {
        startSeconds = startTimeOverride;
    }

    if (endSeconds === 0 || !endSeconds) {
        endSeconds = undefined;
    }

    playbackCtrl.playVideoAt(stream, startSeconds, endSeconds);
    statusCtrl.refresh();
    updateQueueIndicator();
    updateButtons();
}

// ======== UI WIRES ========
btnPrevStream.addEventListener('click', (event) => {
    if (core.prevStream({ skipHistory: event.shiftKey })) loadCurrentContent(true);
});

btnNextStream.addEventListener('click', () => {
    if (core.nextStream()) loadCurrentContent(true);
});

btnPrevSong.addEventListener('click', () => {
    const curTime = playbackCtrl.getSafeCurrentTime();
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
    const curTime = playbackCtrl.getSafeCurrentTime();
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

btnYap.addEventListener('click', () => {
    if (core.isQueueActive()) return;
    const now = Date.now();
    if (now - yapToggleTime < YAP_TOGGLE_DEBOUNCE_MS) return;
    yapToggleTime = now;

    core.toggleYap();
    updateButtons();

    const t = playbackCtrl.getSafeCurrentTime();
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
        endSeconds = stream.songs[stream.songs.length - 1].range[1];
    } else if (!core.yapMode && !stream.songs) {
        endSeconds = song.range[1];
    }

    playbackCtrl.playVideoAt(stream, t, endSeconds);
});

btnStart.addEventListener('click', () => requestStartPlayback());

function setStatus(msg) {
    if (!statusTextEl) return;
    if (msg === lastStatusText) return;
    lastStatusText = msg;
    statusTextEl.textContent = msg;
}

document.addEventListener('visibilitychange', () => {
    playbackCtrl.evaluateTickLoop();
    if (!document.hidden) {
        updateStatus();
    }
});

// ======== KEYBOARD DISPATCHER ========
document.addEventListener('keydown', (e) => {
    const modalOpen = searchCtrl.isOpen();
    const importOpen = importCtrl.isImportOpen();
    const moreOpen = importCtrl.isMoreOpen();
    const queueOpen = queueCtrl.isOpen();

    if (e.key === 'Escape') {
        if (moreOpen) {
            e.preventDefault();
            importCtrl.toggleMoreOverlay();
            return;
        }
        if (importOpen) {
            e.preventDefault();
            importCtrl.toggleImportModal();
            return;
        }
        if (queueOpen) {
            e.preventDefault();
            queueCtrl.toggle();
            return;
        }
        if (modalOpen) {
            e.preventDefault();
            searchCtrl.toggle();
            return;
        }
        if (statusCtrl.isOpen()) {
            e.preventDefault();
            statusCtrl.close();
            return;
        }
    }

    // Queue modal keyboard navigation
    if (queueOpen) {
        if (queueCtrl.handleKeyEvent(e)) return;
    }

    if (!modalOpen && !queueOpen && statusCtrl.isOpen()) {
        if (statusCtrl.handleKeyEvent(e)) {
            return;
        }
    }

    if (e.key === 'S' && e.shiftKey) {
        e.preventDefault();
        closeOtherModals('search');
        searchCtrl.toggle();
        return;
    }

    if (e.key === 'Q' && e.shiftKey) {
        e.preventDefault();
        closeOtherModals('queue');
        queueCtrl.toggle();
        return;
    }

    if (e.key === 'E' && e.shiftKey) {
        e.preventDefault();
        if (modalOpen) {
            const rows = resultsContainer.querySelectorAll('.result-item');
            const btn = rows.length ? rows[0]?.querySelector('.enqueue-btn') : null;
            if (btn && btn.classList.contains('enqueue-ok')) return;
            const item = searchCtrl.enqueueHighlighted();
            if (item) {
                const stream = core.playlist[item.streamId];
                if (stream) {
                    core.enqueue(stream.videoId, item.songId);
                    updateQueueIndicator();
                    updateButtons();
                    // Flash the highlighted row's button
                    const selRow = resultsContainer.querySelectorAll('.result-item.selected')[0];
                    if (selRow) flashEnqueue(selRow.querySelector('.enqueue-btn'));
                }
            }
        } else if (statusCtrl.isOpen()) {
            const selRow = statusSongList.querySelector('.status-song.nav-focus, .status-song.active');
            const btn = selRow ? selRow.querySelector('.enqueue-btn') : null;
            if (btn && btn.classList.contains('enqueue-ok')) return;
            const item = statusCtrl.enqueueHighlighted();
            if (item) {
                core.enqueue(item.videoId, item.rIdx);
                updateQueueIndicator();
                updateButtons();
                if (btn) flashEnqueue(btn);
            }
        } else {
            // No modal open — enqueue currently playing song
            const stream = core.getCurrentStream();
            if (stream) {
                core.enqueue(stream.videoId, core.rIdx);
                updateQueueIndicator();
                updateButtons();
            }
        }
        return;
    }

    if (e.key === 'A' && e.shiftKey) {
        e.preventDefault();
        closeOtherModals('status');
        statusCtrl.toggle();
        return;
    }

    if (e.key === 'M' && e.shiftKey && !modalOpen && !queueOpen) {
        e.preventDefault();
        performMemberModeToggle();
        return;
    }

    if (e.key === 'I' && e.shiftKey) {
        e.preventDefault();
        closeOtherModals('import');
        importCtrl.toggleImportModal();
        return;
    }

    if (e.key === 'C' && e.shiftKey && !modalOpen && !queueOpen) {
        e.preventDefault();
        const stream = core.getCurrentStream();
        if (stream && stream.videoId) {
            const currentTime = playbackCtrl.getSafeCurrentTime();
            const timeParam = Math.floor(currentTime);
            const shareUrl = `${window.location.origin}${window.location.pathname}?v=${stream.videoId}&t=${timeParam}`;
            navigator.clipboard.writeText(shareUrl).then(() => {
                console.log(`[Share] Copied URL to clipboard: ${shareUrl}`);
            }).catch(err => {
                console.error('[Share] Failed to copy URL to clipboard', err);
            });
        }
        return;
    }

    // Search nav (arrow keys, enter) and double-shift toggle
    searchCtrl.handleKeyEvent(e);
});

setTimeout(() => messageBarCtrl.init(), 500);
