import { resolveListNavigation, NAV_ACTION_MOVE, NAV_ACTION_SELECT } from './list-navigation.js';
import { LONG_PRESS_MS } from './enqueue-flash.js';

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
 */
export function createQueueModalController({
    overlay, queueList, clearAllBtn,
    getQueue, getPlaylist, onRemoveItem, onSelectItem, onClearAll,
}) {
    let selIdx = 0;

    function toggle() {
        const wasOpen = overlay.classList.contains('open');
        overlay.classList.toggle('open');
        overlay.inert = wasOpen;
        if (!wasOpen) {
            render();
        }
    }

    function isOpen() {
        return overlay.classList.contains('open');
    }

    function _resolveDisplayInfo(item) {
        const playlist = getPlaylist();
        const stream = playlist.find(p => p.videoId === item.videoId);
        if (!stream) {
            return { songName: '𓂀', streamName: item.videoId };
        }
        let songName;
        if (stream.songs && stream.songs[item.rIdx]) {
            songName = stream.songs[item.rIdx].name || `𓇋𓂋 ${item.rIdx + 1}`;
        } else {
            songName = stream.title || stream.name || '𓈗𓏏';
        }
        return {
            songName,
            streamName: stream.name || stream.title || item.videoId,
        };
    }

    function render() {
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

        queue.forEach((item, idx) => {
            const div = document.createElement('div');
            div.className = 'queue-item';
            if (idx === 0) div.classList.add('selected');

            const info = _resolveDisplayInfo(item);
            div.innerHTML = `
                <span class="queue-item-index">${idx + 1}.</span>
                <span class="queue-item-name">${info.songName}</span>
                <span class="queue-item-stream">${info.streamName}</span>
            `;

            // Minus button (hidden on touch devices via CSS — they use long-press)
            const removeBtn = document.createElement('button');
            removeBtn.className = 'queue-item-remove';
            removeBtn.textContent = '\u2212';
            removeBtn.title = '𓂜 𓀀𓀁𓀂';
            removeBtn.setAttribute('aria-label', `Remove ${info.songName} from queue`);
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                onRemoveItem(idx);
            });
            div.appendChild(removeBtn);

            div.addEventListener('click', () => onSelectItem(idx));

            // Long-press to remove (mobile)
            _attachLongPress(div, () => onRemoveItem(idx));

            queueList.appendChild(div);
        });
    }

    function _attachLongPress(el, callback) {
        let pressTimer = null;
        let pressTriggered = false;

        el.addEventListener('pointerdown', () => {
            pressTriggered = false;
            pressTimer = setTimeout(() => {
                pressTriggered = true;
                callback();
            }, LONG_PRESS_MS);
        });
        el.addEventListener('pointerup', () => clearTimeout(pressTimer));
        el.addEventListener('pointerleave', () => clearTimeout(pressTimer));
        el.addEventListener('pointermove', (e) => {
            if (pressTimer && (Math.abs(e.movementX) > 5 || Math.abs(e.movementY) > 5)) {
                clearTimeout(pressTimer);
            }
        });
        el.addEventListener('click', (e) => {
            if (pressTriggered) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
    }

    function _updateSelection() {
        const rows = queueList.querySelectorAll('.queue-item');
        rows.forEach((r, i) => {
            r.classList.toggle('selected', i === selIdx);
            if (i === selIdx) r.scrollIntoView({ block: 'nearest' });
        });
    }

    function handleKeyEvent(e) {
        if (!isOpen()) return false;

        // Delete/Backspace removes highlighted item
        if (e.key === 'Delete' || e.key === 'Backspace') {
            const total = queueList.querySelectorAll('.queue-item').length;
            if (total > 0 && selIdx >= 0 && selIdx < total) {
                e.preventDefault();
                onRemoveItem(selIdx);
                return true;
            }
        }

        const totalItems = queueList.querySelectorAll('.queue-item').length;
        const nav = resolveListNavigation(e.key, selIdx, totalItems);
        if (!nav.handled) return false;

        e.preventDefault();

        if (nav.action === NAV_ACTION_MOVE) {
            selIdx = nav.nextIndex;
            _updateSelection();
        } else if (nav.action === NAV_ACTION_SELECT) {
            onSelectItem(selIdx);
        }

        return true;
    }

    // Wire up events
    clearAllBtn.addEventListener('click', () => onClearAll());

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            toggle();
        }
    });

    return {
        toggle,
        isOpen,
        render,
        handleKeyEvent,
    };
}
