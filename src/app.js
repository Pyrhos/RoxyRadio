import Fuse from 'fuse.js';
import { PlayerCore } from './player-core.js';
import segmentsData from './data/segments.json';
import { normalizeSongBaseName, buildSearchIndexFromPlaylist, buildDuplicateNameIndex } from './search-helpers.js';

// ======== CONFIG ========
const TICK_MS = 200;

// ======== STATE ========
let tickHandle = null;
let player = null;
let isReady = false;
let playlistReady = false;
let pendingStart = false;
let lastKnownTime = 0;

// Search State
let fuse = null;
let searchResults = [];
let searchSelIdx = 0;

// Duplicate Song State
let duplicateNameIndex = new Map();
let duplicateSearchName = '';

const loopLabels = ['None', 'Track', 'Stream'];

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

function playVideoAt(stream, desiredStart, endSeconds) {
    if (!stream) return;
    const safeStart = core.sanitizeStartTime(desiredStart, stream);
    let safeEnd = Number.isFinite(endSeconds) && endSeconds > 0 ? endSeconds : undefined;
    if (safeEnd !== undefined && safeEnd <= safeStart) {
        safeEnd = undefined;
    }
    console.log(`Loading ${stream.videoId} [${safeStart}-${safeEnd ?? 'end'}]`);
    lastKnownTime = safeStart;
    if (!player || !player.loadVideoById) return;
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

// ======== LOAD SEGMENTS ========
initializePlaylist();

function initializePlaylist() {
    try {
        core.init(segmentsData); // Core handles the filtering logic

        if (!core.playlist.length) throw new Error('Empty playlist');

        // Update buttons state based on core init (e.g. persisted Yap mode)
        updateButtons();

        // Index for search
        const searchIndex = buildSearchIndexFromPlaylist(core.playlist);

        duplicateNameIndex = buildDuplicateNameIndex(searchIndex);

        fuse = new Fuse(searchIndex, {
            keys: ['name'],
            threshold: 0.3,
            ignoreLocation: true
        });

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
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
            controls: 1,
            disablekb: 0,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            iv_load_policy: 3,
            origin: window.location.origin,
            autoplay: 1
        },
        events: {
            onReady: onPlayerReady,
            onStateChange: onStateChange,
            onError: (e) => setStatus('YouTube error: ' + e.data)
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

function updateStatus() {
    if (!player || !player.getCurrentTime) return;
    const t = player.getCurrentTime();
    const msg = core.getStatusText(t);
    setStatus(msg);

    const activeName = core.getActiveSongName(t);
    if (activeName) {
        document.title = `Rourin: ${activeName}`;
    } else {
        document.title = `Rourin ${msg}`;
    }

    updateDuplicateButtonForCurrentSong();
}

function updateButtons() {
    const btnYap = document.getElementById('yap-btn');
    btnYap.textContent = `Yap: ${core.yapMode ? 'On' : 'Off'}`;
    btnYap.classList.toggle('active', core.yapMode);

    const btnLoop = document.getElementById('loop-btn');
    btnLoop.textContent = `Loop: ${loopLabels[core.loopMode]}`;
    btnLoop.classList.toggle('active', core.loopMode !== 0);

    const btnShuffle = document.getElementById('shuffle-btn');
    btnShuffle.textContent = `Shuffle: ${core.shuffleMode ? 'On' : 'Off'}`;
    btnShuffle.classList.toggle('active', core.shuffleMode);
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
    document.getElementById('overlay').style.display = 'none';

    const savedTime = core.getStartSeconds();
    const resumeTime = core.normalizeResumeTime(savedTime);
    const override = resumeTime > 0 ? resumeTime : null;
    loadCurrentContent(true, override);

    clearInterval(tickHandle);
    tickHandle = setInterval(tick, TICK_MS);
}

function tick() {
    if (!player || !player.getCurrentTime) return;
    const t = player.getCurrentTime();
    if (Number.isFinite(t)) lastKnownTime = t;

    updateStatus();
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
}

// ======== UI WIRES ========
document.getElementById('prev-stream').addEventListener('click', () => {
    if (core.prevStream()) loadCurrentContent(true);
});

document.getElementById('next-stream').addEventListener('click', () => {
    if (core.nextStream()) loadCurrentContent(true);
});

document.getElementById('prev-song').addEventListener('click', () => {
    const curTime = player ? player.getCurrentTime() : 0;
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

document.getElementById('next-song').addEventListener('click', () => {
    const curTime = player.getCurrentTime();
    const action = core.nextSong(curTime);
    if (action.type === 'load') loadCurrentContent(true);
    if (action.type === 'seek') core.cb.seekTo(action.time);
});

document.getElementById('loop-btn').addEventListener('click', () => {
    core.toggleLoop();
    updateButtons();
});

document.getElementById('shuffle-btn').addEventListener('click', () => {
    core.toggleShuffle();
    updateButtons();
});

const searchBtn = document.getElementById('search-btn');
const duplicatesBtn = document.getElementById('duplicates-btn');
if (searchBtn) {
    searchBtn.addEventListener('click', () => {
        toggleModal();
    });
}

if (duplicatesBtn && fuse) {
    duplicatesBtn.addEventListener('click', () => {
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

document.getElementById('yap-btn').addEventListener('click', () => {
    core.toggleYap();
    updateButtons();

    const t = player.getCurrentTime();
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

document.getElementById('start').addEventListener('click', () => requestStartPlayback());

function setStatus(msg) {
    document.getElementById('status').textContent = msg;
}

// ======== SEARCH LOGIC ========
const modal = document.getElementById('modal-overlay');
const searchInput = document.getElementById('search-input');
const resultsContainer = document.getElementById('search-results');
let lastShiftTime = 0;

function updateSearchButtonFullscreenVisibility() {
    if (!searchBtn) return;
    const isFullscreen =
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement;

    searchBtn.style.display = isFullscreen ? 'none' : 'flex';

    if (duplicatesBtn) {
        if (isFullscreen) {
            duplicatesBtn.style.display = 'none';
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

function toggleModal() {
    const isOpen = modal.classList.toggle('open');
    if (isOpen) {
        searchInput.value = '';
        renderResults([]);
        searchInput.focus();
    }
}

modal.addEventListener('click', (e) => {
    if (e.target === modal) {
        toggleModal();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'S' && e.shiftKey) {
        e.preventDefault();
        toggleModal();
    }

    if (e.key === 'Shift' && !e.repeat) {
        const now = Date.now();
        if (now - lastShiftTime < 300) {
            toggleModal();
        }
        lastShiftTime = now;
    }

    if (modal.classList.contains('open')) {
        if (e.key === 'Escape') {
            toggleModal();
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            searchSelIdx = Math.min(searchSelIdx + 1, searchResults.length - 1);
            updateSelection();
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            searchSelIdx = Math.max(searchSelIdx - 1, 0);
            updateSelection();
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (searchResults[searchSelIdx]) {
                selectResult(searchResults[searchSelIdx]);
            }
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
    searchResults = items;
    searchSelIdx = 0;
    resultsContainer.innerHTML = '';

    items.forEach((item, idx) => {
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

function updateDuplicateButtonForCurrentSong() {
    if (!duplicatesBtn || !playlistReady) return;

    const stream = core.getCurrentStream();
    const song = core.getCurrentSong();

    if (!stream || !song || !song.name) {
        duplicatesBtn.style.display = 'none';
        duplicateSearchName = '';
        return;
    }

    const baseName = normalizeSongBaseName(song.name);
    const key = baseName.toLocaleLowerCase('en-US');
    const entry = duplicateNameIndex.get(key);

    if (!entry || entry.count <= 1) {
        duplicatesBtn.style.display = 'none';
        duplicateSearchName = '';
        return;
    }

    const otherCount = entry.count - 1;

    duplicateSearchName = entry.baseName || baseName;
    duplicatesBtn.style.display = 'flex';
    const countSpan = duplicatesBtn.querySelector('.note-count');
    if (countSpan) {
        countSpan.textContent = String(otherCount);
    }
    duplicatesBtn.title = `Search other versions of "${duplicateSearchName}"`;
}

