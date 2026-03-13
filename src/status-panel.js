import { resolveListNavigation, NAV_ACTION_MOVE, NAV_ACTION_SELECT } from './list-navigation.js';

/**
 * @param {object} deps
 * @param {HTMLElement} deps.statusEl
 * @param {HTMLElement} deps.statusPanel
 * @param {HTMLElement} deps.statusSongList
 * @param {() => object|null} deps.getCurrentStream
 * @param {() => number} deps.getCurrentStreamIdx
 * @param {() => number} deps.getCoreRIdx
 * @param {(stream: object) => number} deps.getStreamDefaultStart
 * @param {() => number|undefined} deps.getPlayerTime
 * @param {() => boolean} deps.isPlaylistReady
 * @param {(rIdx: number) => void} deps.onSongPick
 */
export function createStatusPanelController({
    statusEl, statusPanel, statusSongList,
    getCurrentStream, getCurrentStreamIdx, getCoreRIdx, getStreamDefaultStart,
    getPlayerTime, isPlaylistReady, onSongPick,
}) {
    let statusPanelOpen = false;
    let statusPanelStreamId = '';
    let statusPanelSongCount = 0;
    let statusPanelSelIdx = -1;

    if (statusSongList) {
        statusSongList.setAttribute('role', 'listbox');
        statusSongList.setAttribute('aria-label', 'Current karaoke songs');
    }

    function getStatusSongsForStream(stream) {
        if (stream && Array.isArray(stream.songs) && stream.songs.length) {
            return stream.songs;
        }
        if (!stream) return [];
        return [{
            name: stream.title || stream.name || 'Full Stream',
            range: [getStreamDefaultStart(stream) || 0, null]
        }];
    }

    function getActiveStatusSongIndex(currentTime) {
        const stream = getCurrentStream();
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

        const rIdx = getCoreRIdx();
        const fallbackIdx = Number.isFinite(rIdx) ? rIdx : 0;
        return Math.min(Math.max(fallbackIdx, 0), songs.length - 1);
    }

    function clearSelection() {
        statusPanelSelIdx = -1;
        if (!statusSongList) return;
        statusSongList.querySelectorAll('.status-song').forEach((row) => {
            row.classList.remove('nav-focus');
        });
    }

    function applySelection(ensureVisible = false) {
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

    function initializeSelection(ensureVisible = false) {
        if (!statusPanelOpen || !statusSongList || !statusSongList.children.length) {
            statusPanelSelIdx = -1;
            return;
        }
        const currentTime = getPlayerTime();
        statusPanelSelIdx = getActiveStatusSongIndex(currentTime);
        applySelection(ensureVisible);
    }

    function syncActiveState(currentTime) {
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

        applySelection(false);
    }

    function handleSongPick(songIndex) {
        const stream = getCurrentStream();
        if (!stream) return;

        const songs = getStatusSongsForStream(stream);
        if (!songs.length) return;

        const safeIdx = Math.min(Math.max(songIndex, 0), songs.length - 1);

        onSongPick(safeIdx);

        syncActiveState();
        toggle(false);
    }

    function refresh(force = false) {
        if (!statusSongList || !isPlaylistReady()) return;
        const stream = getCurrentStream();
        if (!stream) return;

        const songs = getStatusSongsForStream(stream);
        const streamId = stream.videoId || `stream-${getCurrentStreamIdx()}`;

        if (!force && statusPanelStreamId === streamId && statusPanelSongCount === songs.length) {
            syncActiveState();
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
            item.addEventListener('click', () => handleSongPick(idx));
            item.addEventListener('focus', () => {
                if (!statusPanelOpen) return;
                statusPanelSelIdx = idx;
                applySelection(false);
            });
            statusSongList.appendChild(item);
        });

        syncActiveState();
        if (statusPanelOpen) {
            initializeSelection();
        }
    }

    function toggle(forceState) {
        if (!statusEl || !statusPanel || !statusSongList || !isPlaylistReady()) return;

        refresh();

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
            initializeSelection(true);
        } else {
            clearSelection();
        }
    }

    function close() {
        toggle(false);
    }

    function handleKeyEvent(e) {
        if (!statusPanelOpen) return false;

        const totalItems = statusSongList ? statusSongList.children.length : 0;
        const computedIdx = statusPanelSelIdx >= 0
            ? statusPanelSelIdx
            : getActiveStatusSongIndex(getPlayerTime());
        const currentIdx = computedIdx >= 0 ? computedIdx : 0;

        const nav = resolveListNavigation(e.key, currentIdx, totalItems);
        if (!nav.handled) return false;

        e.preventDefault();

        if (nav.action === NAV_ACTION_MOVE) {
            statusPanelSelIdx = nav.nextIndex;
            applySelection(true);
        } else if (nav.action === NAV_ACTION_SELECT) {
            statusPanelSelIdx = nav.nextIndex;
            handleSongPick(nav.nextIndex);
        }

        return true;
    }

    function handleGlobalPointerDown(event) {
        if (!statusPanelOpen || !statusPanel || !statusEl) return;
        if (statusPanel.contains(event.target) || statusEl.contains(event.target)) return;
        toggle(false);
    }

    // Wire up event listeners
    if (statusEl) {
        statusEl.addEventListener('click', () => toggle());
        statusEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggle();
            }
        });
    }

    document.addEventListener('pointerdown', handleGlobalPointerDown, true);
    window.addEventListener('blur', () => {
        if (statusPanelOpen) {
            toggle(false);
        }
    });

    return {
        toggle,
        refresh,
        syncActiveState,
        handleKeyEvent,
        isOpen: () => statusPanelOpen,
        close,
        handleGlobalPointerDown,
    };
}
