import { resolveListNavigation, NAV_ACTION_MOVE, NAV_ACTION_SELECT } from './list-navigation.js';
import { attachLongPress, arm, disarm } from './long-press-arm.js';

/**
 * @param {object} deps
 * @param {HTMLElement} deps.overlay
 * @param {HTMLElement} deps.queueList
 * @param {HTMLElement} deps.clearAllBtn
 * @param {() => Array<{videoId: string, rIdx: number}>} deps.getQueue
 * @param {() => Array} deps.getPlaylist
 * @param {(index: number) => void} deps.onRemoveItem
 * @param {(index: number) => void} deps.onSelectItem
 * @param {() => void} deps.onClearAll
 * @param {() => number} [deps.getNowPlayingIndex] index of the queue item
 *        currently playing (Loop Queue cycling), -1 when none
 * @param {HTMLInputElement} [deps.searchInput] optional in-modal filter box
 */
export function createQueueModalController({
    overlay, queueList, clearAllBtn,
    getQueue, getPlaylist, onRemoveItem, onSelectItem, onClearAll,
    getNowPlayingIndex = () => -1, searchInput = null,
}) {
    let selIdx = 0;
    let filterQuery = '';

    function toggle() {
        const wasOpen = overlay.classList.contains('open');
        overlay.classList.toggle('open');
        overlay.inert = wasOpen;
        if (!wasOpen) {
            filterQuery = '';
            if (searchInput) searchInput.value = '';
            render();
            _revealNowPlaying();
            // Auto-focus like the search modal so typing filters immediately. The
            // first Arrow Up/Down hands focus back to the list (see handleKeyEvent),
            // restoring keyboard navigation and Delete-to-remove from that point.
            // preventScroll so focusing the header box doesn't undo _revealNowPlaying.
            if (searchInput) searchInput.focus({ preventScroll: true });
        }
    }

    function isOpen() {
        return overlay.classList.contains('open');
    }

    function _resolveDisplayInfo(item) {
        const playlist = getPlaylist();
        const stream = playlist.find(p => p.videoId === item.videoId);
        if (!stream) {
            return { songName: 'Unknown', streamName: item.videoId };
        }
        let songName;
        if (stream.songs && stream.songs[item.rIdx]) {
            songName = stream.songs[item.rIdx].name || `Track ${item.rIdx + 1}`;
        } else {
            songName = stream.title || stream.name || 'Full Stream';
        }
        return {
            songName,
            streamName: stream.name || stream.title || item.videoId,
        };
    }

    // Case-insensitive substring match against the resolved song and stream names.
    function _matchesFilter(info, query) {
        if (!query) return true;
        return info.songName.toLocaleLowerCase('en-US').includes(query)
            || info.streamName.toLocaleLowerCase('en-US').includes(query);
    }

    function render() {
        disarm();
        const queue = getQueue();
        selIdx = 0;
        queueList.innerHTML = '';

        if (queue.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'queue-empty';
            empty.textContent = '(..◜ᴗ◝..)';
            queueList.appendChild(empty);
            clearAllBtn.disabled = true;
            return;
        }

        clearAllBtn.disabled = false;

        const nowPlaying = getNowPlayingIndex();
        const query = filterQuery.trim().toLocaleLowerCase('en-US');

        // Collect matching entries while preserving each item's original queue
        // index — removal/selection always address the real slot, not the
        // filtered position, so the stable-order invariant is never violated.
        const matches = [];
        queue.forEach((item, idx) => {
            const info = _resolveDisplayInfo(item);
            if (_matchesFilter(info, query)) matches.push({ idx, info });
        });

        if (matches.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'queue-empty queue-no-matches';
            empty.textContent = '┐(￣ヘ￣)┌';
            queueList.appendChild(empty);
            return;
        }

        matches.forEach(({ idx, info }, visIdx) => {
            const div = document.createElement('div');
            div.className = 'queue-item';
            div.dataset.qidx = String(idx);
            if (visIdx === 0) div.classList.add('selected');
            if (idx === nowPlaying) div.classList.add('now-playing');

            div.innerHTML = `
                <span class="queue-item-index">${idx === nowPlaying ? '▶' : `${idx + 1}.`}</span>
                <span class="queue-item-name">${info.songName}</span>
                <span class="queue-item-stream">${info.streamName}</span>
            `;

            // Minus button (hidden on touch devices via CSS — they use long-press)
            const removeBtn = document.createElement('button');
            removeBtn.className = 'queue-item-remove';
            removeBtn.textContent = '\u2212';
            removeBtn.title = 'Remove from queue';
            removeBtn.setAttribute('aria-label', `Remove ${info.songName} from queue`);
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                disarm();
                onRemoveItem(idx);
            });
            div.appendChild(removeBtn);

            // Coarse pointer: long-press reveals the remove box as a red ✕; tapping it
            // removes. Registered before the select handler below so its trailing-click
            // suppressor can cancel the select.
            attachLongPress(div, () => {
                removeBtn.textContent = '✕';
                arm(div, { inQueue: false });
            });

            div.addEventListener('click', () => onSelectItem(idx));

            queueList.appendChild(div);
        });
    }

    // Repaint only the now-playing marker (▶ / index number and the now-playing
    // class) on the already-rendered rows. Song changes route here instead of a
    // full render() so the ▶ follows playback while leaving the user's selection,
    // scroll position, active filter, and long-press arming untouched.
    function refreshNowPlaying() {
        const nowPlaying = getNowPlayingIndex();
        queueList.querySelectorAll('.queue-item').forEach((row) => {
            const idx = Number(row.dataset.qidx);
            const isNow = idx === nowPlaying;
            row.classList.toggle('now-playing', isNow);
            const indexEl = row.querySelector('.queue-item-index');
            if (indexEl) indexEl.textContent = isNow ? '▶' : `${idx + 1}.`;
        });
    }

    function _updateSelection(scrollBlock = 'nearest') {
        const rows = queueList.querySelectorAll('.queue-item');
        rows.forEach((r, i) => {
            r.classList.toggle('selected', i === selIdx);
            if (i === selIdx) r.scrollIntoView({ block: scrollBlock });
        });
    }

    // On open, bring the currently playing queue slot on screen by scrolling to
    // its depth (the queue order is never changed). The slot also becomes the
    // keyboard selection so arrow navigation continues from where playback is.
    function _revealNowPlaying() {
        const nowPlaying = getNowPlayingIndex();
        if (nowPlaying < 0) return;
        selIdx = nowPlaying;
        _updateSelection('center');
    }

    function handleKeyEvent(e) {
        if (!isOpen()) return false;

        const rows = queueList.querySelectorAll('.queue-item');

        // Delete/Backspace removes the highlighted item — but never while the
        // filter box has focus, where those keys must edit the query text.
        if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement !== searchInput) {
            if (rows.length > 0 && selIdx >= 0 && selIdx < rows.length) {
                e.preventDefault();
                onRemoveItem(Number(rows[selIdx].dataset.qidx));
                return true;
            }
        }

        const nav = resolveListNavigation(e.key, selIdx, rows.length);
        if (!nav.handled) return false;

        e.preventDefault();

        if (nav.action === NAV_ACTION_MOVE) {
            // First Up/Down hands control from the auto-focused filter box to the
            // queue list, so nav and Delete-to-remove address items from here on.
            if (searchInput && document.activeElement === searchInput) searchInput.blur();
            selIdx = nav.nextIndex;
            _updateSelection();
        } else if (nav.action === NAV_ACTION_SELECT) {
            if (rows[selIdx]) onSelectItem(Number(rows[selIdx].dataset.qidx));
        }

        return true;
    }

    // Wire up events
    clearAllBtn.addEventListener('click', () => onClearAll());

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            filterQuery = searchInput.value;
            render();
        });
    }

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            toggle();
        }
    });

    return {
        toggle,
        isOpen,
        render,
        refreshNowPlaying,
        handleKeyEvent,
    };
}
