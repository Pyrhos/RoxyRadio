import { PlayerCore } from './player-core.js';
import { executePlaybackAction } from './playback-action.js';
import { createMessageBarController } from './message-bar-ui.js';
import { initWantedPoster } from './wanted-poster.js';
import { createSearchController } from './search-modal.js';
import { createStatusPanelController } from './status-panel.js';
import { createImportAndMoreController } from './import-ui.js';
import { createQueueModalController } from './queue-modal.js';
import { createPlaybackController } from './playback.js';
import { validateSegmentData } from './import-helpers.js';
import { resolveUrlOverride, computeActiveSegments, classifyMissing, looksLikeVideoId } from './url-override.js';
import { flashEnqueue } from './enqueue-flash.js';
import {
    CUSTOM_SEGMENTS_STORAGE_KEY,
    LOCAL_STORAGE_PREFIX,
    SEGMENTS_MODE_REPLACED,
    SEGMENTS_MODE_STORAGE_KEY,
    SESSION_STORAGE_PREFIX,
} from './storage-keys.js';

import { createLifecycle } from './lifecycle.js';
import { disarm } from './long-press-arm.js';

/** @typedef {import('./import-helpers.js').Segment} Segment */

export function createRadioApplication({ segmentsData, messagesData = [] }) {
    const lifecycle = createLifecycle();
    // ======== CONFIG ========
    const TICK_MS = 200;
    const TITLE_REFRESH_MS = 2000;
    const YAP_TOGGLE_DEBOUNCE_MS = 300;
    const VIDEO_LOAD_DEBOUNCE_MS = 300;
    const SEGMENTS_FETCH_TIMEOUT_MS = 5000;
    const THEME_NAMES = [null, 'starry-night', 'forest-meadow'];

    // ======== STATE ========
    let player = null;
    let isReady = false;
    let playlistReady = false;
    let pendingStart = false;
    let yapToggleTime = 0;

    // URL parameter override (YouTube-style ?v= and ?t= params)
    let urlOverride = null;

    // Best-known canonical set: the built-in payload, unless a cold-path share link
    // (§ initializePlaylist) fetches newer data because this bundle was stale — then it
    // replaces the built-in so "the defaults" (extend/reset, custom-import detection)
    // track current canonical, not the stale snapshot baked into this build.
    /** @type {Segment[]} */
    let canonicalBase = segmentsData;

    // Active segment source — canonical base, overlaid by any custom import.
    /** @type {Segment[]} */
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
    const queueSearchInput = document.getElementById('queue-search-input');
    const queueCell = document.getElementById('queue-cell');
    const mobileQueueBtn = document.getElementById('mobile-queue-btn');
    const moreCell = document.getElementById('more-cell');

    let lastStatusText = '';
    let lastTitleText = document.title;
    let lastAppliedTheme = 0;

    // Core Logic Instance
    const core = new PlayerCore({
        saveSettings: (settings) => {
            for (const [key, val] of Object.entries(settings)) {
                localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${key}`, val);
            }
        },
        getSettings: () => {
            const s = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k.startsWith(LOCAL_STORAGE_PREFIX)) {
                    s[k.slice(LOCAL_STORAGE_PREFIX.length)] = localStorage.getItem(k);
                }
            }
            return s;
        },
        saveSessionData: (data) => {
            for (const [key, val] of Object.entries(data)) {
                sessionStorage.setItem(`${SESSION_STORAGE_PREFIX}${key}`, val);
            }
        },
        getSessionData: () => {
            const s = {};
            for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                if (k.startsWith(SESSION_STORAGE_PREFIX)) {
                    s[k.slice(SESSION_STORAGE_PREFIX.length)] = sessionStorage.getItem(k);
                }
            }
            return s;
        },
        now: () => Date.now()
    });

    // ======== CONTROLLERS ========

    const playbackCtrl = createPlaybackController({
        getPlayer: () => player,
        getCurrentStream: () => core.getCurrentStream(),
        sanitizeStartTime: (time, stream) => core.sanitizeStartTime(time, stream),
        isYapMode: () => core.yapMode,
        onTick: (t) => {
            // A PLAYING event can precede the iframe's video ID update. The
            // tick accepts timestamps only after the requested video arrives.
            initializeCurrentVideoMetadata();
            updateStatus(t);
            applyPlaybackAction(core.checkTick(t));
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
            applyPlaybackAction(core.selectTrack(vIdx, rIdx));
        },
        onEnqueueResult: (vIdx, rIdx) => {
            const stream = core.playlist[vIdx];
            if (stream) {
                core.enqueue(stream.videoId, rIdx);
                updateQueueControls();
            }
        },
        isResultQueued: (vIdx, rIdx) => {
            const stream = core.playlist[vIdx];
            return !!stream && core.isQueued(stream.videoId, rIdx);
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
            updateQueueControls();
        },
        isSongQueued: (videoId, rIdx) => core.isQueued(videoId, rIdx),
        onSongPick: (songIndex) => applyPlaybackAction(core.selectSong(songIndex)),
    });

    const importCtrl = createImportAndMoreController({
        importModal, importStatus,
        moreOverlay, moreMemberBtn, moreBtn, moreCopyBtn, moreImportBtn, moreCloseBtn,
        importReplaceBtn, importAppendBtn,
        importResetBtn: document.getElementById('import-reset-btn'),
        onImportReplace: (data) => {
            if (!applyImportedSegments(data, 'Import produced an empty playlist')) return;
            persistCustomSegments(data);
            localStorage.setItem(SEGMENTS_MODE_STORAGE_KEY, SEGMENTS_MODE_REPLACED);

            completeImport(`Replaced - ${core.playlist.length} streams loaded`, true);
            console.log(`[Import] Replaced with ${core.playlist.length} streams from clipboard`);
        },
        onImportAppend: (data) => {
            const importedIds = new Set(data.map(entry => entry.videoId));
            const kept = activeSegments.filter(entry => !importedIds.has(entry.videoId));
            const merged = [...kept, ...data];

            if (!applyImportedSegments(merged, 'Merge produced an empty playlist')) return;
            // Defaults always load fresh. Persist non-default custom entries
            const defaultIds = new Set(canonicalBase.map(e => e.videoId));
            persistCustomSegments(merged.filter(e => !defaultIds.has(e.videoId)));
            localStorage.removeItem(SEGMENTS_MODE_STORAGE_KEY);

            completeImport(`Extended - ${core.playlist.length} streams total`, false);
            console.log(`[Import] Appended ${data.length} streams (${importedIds.size} unique), total ${core.playlist.length}`);
        },
        onImportReset: () => {
            activeSegments = canonicalBase;
            localStorage.removeItem(CUSTOM_SEGMENTS_STORAGE_KEY);
            localStorage.removeItem(SEGMENTS_MODE_STORAGE_KEY);

            core.init(activeSegments);
            completeImport(`Reset - ${core.playlist.length} default streams restored`, true);
            console.log(`[Import] Reset to default playlist (${core.playlist.length} streams)`);
        },
        onMemberToggle: () => performMemberModeToggle(),
        onCopyShareUrl: (buttonEl) => copyShareUrl(() => {
            const original = buttonEl.textContent;
            buttonEl.textContent = 'Copied!';
            lifecycle.timeout(() => { buttonEl.textContent = original; }, 1500);
        }),
        isMemberMode: () => core.memberMode,
    });

    const queueCtrl = createQueueModalController({
        overlay: queueOverlay,
        queueList: queueListEl,
        clearAllBtn: queueClearBtn,
        searchInput: queueSearchInput,
        getQueue: () => core.getQueue(),
        getPlaylist: () => core.playlist,
        getNowPlayingIndex: () => core.getNowPlayingQueueIndex(),
        onRemoveItem: (idx) => {
            core.removeFromQueue(idx);
            queueCtrl.render();
            updateQueueControls();
        },
        onSelectItem: (idx) => {
            const action = core.selectQueueItem(idx);
            if (action.type === 'none') return;
            queueCtrl.toggle();
            applyPlaybackAction(action);
        },
        onClearAll: () => {
            core.clearQueue();
            queueCtrl.render();
            updateQueueControls();
        },
    });

    if (queueCell) {
        lifecycle.listen(queueCell, 'click', () => {
            closeOtherModals('queue');
            queueCtrl.toggle();
        });
    }

    if (mobileQueueBtn) {
        lifecycle.listen(mobileQueueBtn, 'click', () => {
            closeOtherModals('queue');
            queueCtrl.toggle();
        });
    }

    if (moreCell) {
        lifecycle.listen(moreCell, 'click', () => {
            closeOtherModals('more');
            importCtrl.toggleMoreOverlay();
        });
    }

    const messageBarCtrl = createMessageBarController({
        messageBar: document.getElementById('message-bar'),
        messageText: document.getElementById('message-text'),
        messageClose: document.getElementById('message-close'),
        messageRestore: document.getElementById('more-restore-messages-btn'),
        messagesData,
    });

    const wantedCtrl = initWantedPoster({
        boltTrigger: document.getElementById('bolt-trigger'),
        wantedOverlay: document.getElementById('wanted-overlay'),
    });

    // ======== PLAYBACK LIFECYCLE ========

    playbackCtrl.ensureTitleRefreshLoop((t) => {
        // A missed end callback otherwise leaves whole-video songs stopped.
        // This timer also runs when background playback suspends the fast tick.
        if (player && player.getPlayerState?.() === YT.PlayerState.ENDED && advanceEndedVideo()) {
            t = playbackCtrl.getSafeCurrentTime();
        }
        updateStatus(t);
    });

    lifecycle.listen(window, 'beforeunload', () => {
        let time = playbackCtrl.getLastKnownTime();
        try {
            time = playbackCtrl.getSafeCurrentTime({ allowZero: true });
        } catch (err) {
            console.warn('Failed to read current time on unload', err);
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

    function readUrlParams() {
        try {
            stripInvalidParams();
            const params = new URLSearchParams(window.location.search);
            return { videoId: params.get('v'), timestamp: params.get('t') };
        } catch (err) {
            console.warn('[URL] Failed to read URL parameters:', err.message);
            return { videoId: null, timestamp: null };
        }
    }

    // Cold-path fallback: fetch the canonical runtime payload (unhashed, no-store) so a
    // stale cached bundle can still resolve a shared link to a stream added after it was
    // built. Returns the validated array, or null on timeout or network/parse/validation failure
    // (in which case the app silently keeps its baked-in data and default state).
    /** @returns {Promise<Segment[] | null>} */
    async function fetchFreshSegments() {
        const controller = new AbortController();
        lifecycle.signal.addEventListener('abort', () => controller.abort(), { once: true });
        // Keep the deadline active through body consumption so a stalled download
        // cannot prevent startup from falling back to the bundled playlist.
        const timeout = lifecycle.timeout(() => controller.abort(), SEGMENTS_FETCH_TIMEOUT_MS);
        try {
            const url = new URL('segments.json', document.baseURI);
            const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
            if (!res.ok) return null;
            const data = await res.json();
            return validateSegmentData(data) ? data : null;
        } catch (err) {
            console.warn('[URL] Fresh segment fetch failed:', err.message);
            return null;
        } finally {
            lifecycle.cancelTimeout(timeout);
        }
    }

    // ======== LOAD SEGMENTS ========
    initializePlaylist();

    function rebuildPlaylistDerivedState() {
        searchCtrl.rebuild(core.playlist);
        statusCtrl.refresh(true);
    }

    function completeImport(message, closeModal) {
        // History uses playlist indices, which an import or reset can replace.
        // Clear it only after acceptance so rejected imports preserve navigation.
        core.clearHistory();
        core.selectTrack(0);
        rebuildPlaylistDerivedState();
        updateButtons();
        loadCurrentContent();
        importCtrl.setImportStatus(message, 'ok');
        if (closeModal) importCtrl.toggleImportModal();
    }

    function applyImportedSegments(segments, errorMessage) {
        core.init(segments);
        if (core.playlist.length) {
            activeSegments = segments;
            return true;
        }
        importCtrl.setImportStatus(errorMessage, 'error');
        console.warn(`[Import] ${errorMessage}`);
        core.init(activeSegments);
        rebuildPlaylistDerivedState();
        return false;
    }

    /** @param {Segment[]} data */
    function persistCustomSegments(data) {
        try {
            localStorage.setItem(CUSTOM_SEGMENTS_STORAGE_KEY, JSON.stringify(data));
        } catch (err) {
            console.warn('[Import] Failed to persist custom segments:', err.message);
        }
    }

    // Rebuild the playlist from canonicalBase, overlaying any persisted custom import.
    // core.init is the single (re)build path, so this doubles as the cold-path adopt.
    function applyActiveSegments() {
        const { segments, invalidCustom } = computeActiveSegments(canonicalBase, {
            json: localStorage.getItem(CUSTOM_SEGMENTS_STORAGE_KEY),
            mode: localStorage.getItem(SEGMENTS_MODE_STORAGE_KEY),
        });
        if (invalidCustom) localStorage.removeItem(CUSTOM_SEGMENTS_STORAGE_KEY);
        activeSegments = segments;
        core.init(activeSegments);
    }

    async function initializePlaylist() {
        try {
            applyActiveSegments();
            if (!core.playlist.length) throw new Error('Empty playlist');

            // URL params override saved state (YouTube-style ?v= and ?t=).
            const { videoId, timestamp } = readUrlParams();
            urlOverride = resolveUrlOverride(core.playlist, videoId, timestamp);

            // Check the unfiltered catalogue before fetching: member mode and Replace
            // imports can exclude a known stream without making this bundle stale.
            let coldNotice = null;
            if (!urlOverride && looksLikeVideoId(videoId)) {
                let knownStream = canonicalBase.find(entry => entry.videoId === videoId);
                let checkedCatalogue = !!knownStream;
                if (!knownStream) {
                    const fresh = await fetchFreshSegments();
                    if (lifecycle.signal.aborted) return;
                    if (fresh) {
                        canonicalBase = fresh;
                        applyActiveSegments();
                        urlOverride = resolveUrlOverride(core.playlist, videoId, timestamp);
                        knownStream = canonicalBase.find(entry => entry.videoId === videoId);
                        checkedCatalogue = true;
                    }
                }
                if (!urlOverride && checkedCatalogue) {
                    coldNotice = classifyMissing(canonicalBase, videoId) === 'member-gated' && !core.memberMode
                        ? "That's a members-only stream — enable Member Mode to play it."
                        : knownStream
                            ? 'Shared stream is not in your custom playlist — reset your imports to play it.'
                            : 'Shared stream not found — it may have been removed.';
                }
                // Failed fetch → keep bundled data + default state silently (offline / error).
            }

            if (urlOverride) {
                core.selectTrack(urlOverride.streamIdx);
            }

            updateButtons();

            rebuildPlaylistDerivedState();

            playlistReady = true;
            setStatus(coldNotice || 'Ready. Click Start.');
            maybeStartPlayback();
        } catch (err) {
            setStatus('Failed to load segments: ' + err.message);
        }
    }

    // ======== YT API READY HOOK ========
    const previousReadyHandler = window.onYouTubeIframeAPIReady;
    const onYouTubeReady = function () {
        if (lifecycle.signal.aborted) return;
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
                    if (lifecycle.signal.aborted) return;
                    playbackCtrl.resetLoadedVideoId();
                    setStatus('YouTube error: ' + e.data);
                }
            }
        });
    };

    window.onYouTubeIframeAPIReady = onYouTubeReady;

    // Handle case where API loads before script
    if (window.YT && window.YT.Player) {
        lifecycle.timeout(() => {
            if (!player) window.onYouTubeIframeAPIReady();
        }, 0);
    }

    function onPlayerReady() {
        if (lifecycle.signal.aborted) return;
        isReady = true;
        setStatus('Player ready.');
        requestStartPlayback();
    }

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
                lifecycle.listen(debugBtn, 'click', () => {
                    if (player && typeof player.getCurrentTime === 'function') {
                        const t = player.getCurrentTime();
                        const val = Math.ceil(t).toString();
                        navigator.clipboard.writeText(val).then(() => {
                            const originalText = debugBtn.textContent;
                            debugBtn.textContent = 'Copied!';
                            lifecycle.timeout(() => debugBtn.textContent = originalText, 1000);
                        }).catch(err => {
                            console.error('Failed to copy timestamp', err);
                        });
                    }
                });
            }

            if (debugEndBtn) {
                lifecycle.listen(debugEndBtn, 'click', () => {
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
                core.selectTrack(idx);
            }
        }

        rebuildPlaylistDerivedState();
        updateButtons();
        loadCurrentContent();
    }

    function updateButtons() {
        const queueActive = core.isQueueActive();

        const queueDisabledTitle = 'Unavailable while queue is active';

        // Yap button — disabled while queue is active
        const yapOn = core.yapMode;
        updateButtonLabel(btnYap, `Yap: ${yapOn ? 'On' : 'Off'}`, yapOn);
        updateButtonIcon(iconYap, yapOn ? './yap.png' : './noyap.png', yapOn ? 'Yap on' : 'Yap off');
        btnYap.disabled = queueActive;
        btnYap.title = queueActive ? queueDisabledTitle : 'Toggle Yap Mode';

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
        btnPrevStream.title = queueActive ? queueDisabledTitle : 'Previous Stream (Shift: bypass history)';
        btnNextStream.title = queueActive ? queueDisabledTitle : 'Next Stream';

        // Member mode indicator on controls bar
        if (controlsContainer) {
            controlsContainer.classList.toggle('member-mode', core.memberMode);
        }

        importCtrl.updateMoreMemberBtn();
    }

    function updateQueueControls() {
        updateQueueIndicator();
        updateButtons();
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
    if (btnSearch) lifecycle.listen(btnSearch, 'click', () => closeOtherModals('search'), true);
    if (statusEl) lifecycle.listen(statusEl, 'click', () => closeOtherModals('status'), true);
    if (moreBtn) lifecycle.listen(moreBtn, 'click', () => closeOtherModals('more'), true);

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

        loadCurrentContent(startTime);

        playbackCtrl.stopTickLoop();
        playbackCtrl.evaluateTickLoop();
    }

    function onStateChange(ev) {
        if (lifecycle.signal.aborted) return;
        // Until the iframe reports the requested video, events can still describe
        // the previous video's end or metadata, even after the load is sent.
        if (playbackCtrl.isLoadPending()) {
            // PLAYING can precede the video ID update. Keep confirmation on
            // the existing tick loop even when this event cannot drive policy.
            playbackCtrl.evaluateTickLoop();
            return;
        }
        if (ev.data === YT.PlayerState.ENDED) {
            advanceEndedVideo();
        } else if (ev.data === YT.PlayerState.PLAYING) {
            playbackCtrl.reconcileStartOnPlaying();
            initializeCurrentVideoMetadata();
        }

        playbackCtrl.evaluateTickLoop();
    }

    function advanceEndedVideo() {
        if (!playbackCtrl.reconcileStartOnEnded()) return false;
        return applyPlaybackAction(core.onVideoEnded());
    }

    function initializeCurrentVideoMetadata() {
        const stream = core.getCurrentStream();
        if (!stream || stream.songs || core.getDuration(stream.videoId)) return;
        const duration = player.getDuration();
        if (!duration) return;
        core.setDuration(stream.videoId, duration);
        if (stream.title !== stream.videoId) return;
        const data = player.getVideoData();
        if (!data?.title) return;
        stream.title = data.title;
        // Enrich bare imports so they appear in search and survive a reload.
        if (!stream.name) {
            stream.name = data.title;
            const seg = activeSegments.find(s => s.videoId === stream.videoId);
            if (seg && !seg.name) {
                seg.name = data.title;
                if (activeSegments !== canonicalBase) {
                    if (localStorage.getItem(SEGMENTS_MODE_STORAGE_KEY) === SEGMENTS_MODE_REPLACED) {
                        persistCustomSegments(activeSegments);
                    } else {
                        const defaultIds = new Set(canonicalBase.map(e => e.videoId));
                        persistCustomSegments(activeSegments.filter(e => !defaultIds.has(e.videoId)));
                    }
                }
            }
        }
        rebuildPlaylistDerivedState();
    }

    function loadCurrentContent(startTimeOverride = null) {
        const request = core.getPlaybackRequest(startTimeOverride);
        if (!request) return;
        const { stream, startSeconds, endSeconds } = request;
        playbackCtrl.playVideoAt(stream, startSeconds, endSeconds);
        statusCtrl.refresh();
        updateQueueControls();
        // Keep the ▶ marker on the currently-playing queue slot while the modal is open.
        if (queueCtrl.isOpen()) queueCtrl.refreshNowPlaying();
    }

    const playbackActions = { load: loadCurrentContent, seek: playbackCtrl.seekToSafe };
    function applyPlaybackAction(action) {
        return executePlaybackAction(action, playbackActions);
    }

    // ======== UI WIRES ========
    lifecycle.listen(btnPrevStream, 'click', (event) => {
        applyPlaybackAction(core.prevStream({ skipHistory: event.shiftKey }));
    });

    lifecycle.listen(btnNextStream, 'click', () => {
        applyPlaybackAction(core.nextStream());
    });

    lifecycle.listen(btnPrevSong, 'click', () => {
        applyPlaybackAction(core.prevSong(playbackCtrl.getSafeCurrentTime()));
    });

    lifecycle.listen(btnNextSong, 'click', () => {
        applyPlaybackAction(core.nextSong(playbackCtrl.getSafeCurrentTime()));
    });

    lifecycle.listen(btnLoop, 'click', () => {
        core.toggleLoop();
        updateButtons();
    });

    lifecycle.listen(btnShuffle, 'click', () => {
        core.toggleShuffle();
        updateButtons();
    });

    lifecycle.listen(btnYap, 'click', () => {
        if (core.isQueueActive()) return;
        const now = Date.now();
        if (now - yapToggleTime < YAP_TOGGLE_DEBOUNCE_MS) return;
        yapToggleTime = now;

        core.toggleYap();
        updateButtons();

        const t = playbackCtrl.getSafeCurrentTime();
        core.syncToTime(t);

        const request = core.getPlaybackRequest(t);
        if (request) playbackCtrl.playVideoAt(request.stream, request.startSeconds, request.endSeconds);
    });

    lifecycle.listen(btnStart, 'click', () => requestStartPlayback());

    function copyShareUrl(onCopied) {
        const stream = core.getCurrentStream();
        if (!stream?.videoId) return;
        const time = Math.floor(playbackCtrl.getSafeCurrentTime());
        const url = `${window.location.origin}${window.location.pathname}?v=${stream.videoId}&t=${time}`;
        navigator.clipboard.writeText(url).then(() => {
            if (!lifecycle.signal.aborted) onCopied(url);
        }).catch(err => console.error('[Share] Failed to copy URL to clipboard', err));
    }

    function setStatus(msg) {
        if (!statusTextEl) return;
        if (msg === lastStatusText) return;
        lastStatusText = msg;
        statusTextEl.textContent = msg;
    }

    lifecycle.listen(document, 'visibilitychange', () => {
        playbackCtrl.evaluateTickLoop();
        if (!document.hidden) {
            updateStatus();
        }
    });

    // ======== KEYBOARD DISPATCHER ========
    lifecycle.listen(document, 'keydown', (e) => {
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
            // While the filter box has focus, printable keys must edit the query, not
            // fire the global Shift+letter shortcuts (Shift+S/Q/E/A/I). Nav/Delete/
            // Escape are already handled above; swallow the rest so it types into the
            // box. Shortcuts stay live when the box is unfocused, so Shift+Q still
            // toggles the modal closed and cross-modal switching keeps working.
            if (document.activeElement === queueSearchInput) return;
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
                        updateQueueControls();
                        // Flash the highlighted row's button
                        const selRow = resultsContainer.querySelectorAll('.result-item.selected')[0];
                        if (selRow) flashEnqueue(selRow.querySelector('.enqueue-btn'), undefined, lifecycle.timeout);
                    }
                }
            } else if (statusCtrl.isOpen()) {
                const selRow = statusSongList.querySelector('.status-song.nav-focus, .status-song.active');
                const btn = selRow ? selRow.querySelector('.enqueue-btn') : null;
                if (btn && btn.classList.contains('enqueue-ok')) return;
                const item = statusCtrl.enqueueHighlighted();
                if (item) {
                    core.enqueue(item.videoId, item.rIdx);
                    updateQueueControls();
                    if (btn) flashEnqueue(btn, undefined, lifecycle.timeout);
                }
            } else {
                // No modal open — enqueue currently playing song
                const stream = core.getCurrentStream();
                if (stream) {
                    core.enqueue(stream.videoId, core.rIdx);
                    updateQueueControls();
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
            copyShareUrl(shareUrl => console.log(`[Share] Copied URL to clipboard: ${shareUrl}`));
            return;
        }

        // Search nav (arrow keys, enter) and double-shift toggle
        searchCtrl.handleKeyEvent(e);
    });

    lifecycle.timeout(() => messageBarCtrl.init(), 500);

    function dispose() {
        if (lifecycle.signal.aborted) return;
        lifecycle.dispose();
        for (const controller of [playbackCtrl, searchCtrl, statusCtrl, importCtrl, queueCtrl, messageBarCtrl, wantedCtrl]) {
            controller?.destroy();
        }
        disarm();
        if (window.onYouTubeIframeAPIReady === onYouTubeReady) {
            if (previousReadyHandler) window.onYouTubeIframeAPIReady = previousReadyHandler;
            else delete window.onYouTubeIframeAPIReady;
        }
        player?.destroy?.();
    }

    return { dispose };
}
