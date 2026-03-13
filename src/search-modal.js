import Fuse from 'fuse.js';
import { normalizeSongBaseName, buildSearchIndexFromPlaylist, buildDuplicateNameIndex, sortSearchResultsByCurrentStream, FUSE_CONFIG } from './search-helpers.js';
import { resolveListNavigation, NAV_ACTION_MOVE, NAV_ACTION_SELECT } from './list-navigation.js';

/**
 * @param {object} deps
 * @param {HTMLElement} deps.modal
 * @param {HTMLElement} deps.searchInput
 * @param {HTMLElement} deps.resultsContainer
 * @param {HTMLElement} deps.btnSearch
 * @param {HTMLElement} deps.btnDuplicates
 * @param {() => number} deps.getCurrentStreamIdx
 * @param {() => object|null} deps.getCurrentSong
 * @param {(vIdx: number, rIdx: number) => void} deps.onSelectResult
 */
export function createSearchController({
    modal, searchInput, resultsContainer, btnSearch, btnDuplicates,
    getCurrentStreamIdx, getCurrentSong, onSelectResult,
}) {
    let fuse = null;
    let searchResults = [];
    let searchSelIdx = 0;
    let duplicateNameIndex = new Map();
    let duplicateSearchName = '';
    let modalToggleTime = 0;
    let lastShiftTime = 0;

    function toggle() {
        const wasOpen = modal.classList.contains('open');
        modal.classList.toggle('open');
        modal.inert = wasOpen;
        if (!wasOpen) {
            searchInput.value = '';
            renderResults([]);
            searchInput.focus();
        }
    }

    function isOpen() {
        return modal.classList.contains('open');
    }

    function rebuild(playlist) {
        const searchIndex = buildSearchIndexFromPlaylist(playlist);
        duplicateNameIndex = buildDuplicateNameIndex(searchIndex);
        fuse = new Fuse(searchIndex, FUSE_CONFIG);
        searchResults = [];
        searchSelIdx = 0;
    }

    function renderResults(items) {
        const currentStreamId = getCurrentStreamIdx();
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
        onSelectResult(item.streamId, item.songId);
        toggle();
    }

    function updateDuplicateButton() {
        if (!btnDuplicates) return;

        const song = getCurrentSong();

        if (!song || !song.name) {
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

    function updateFullscreenVisibility() {
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
                updateDuplicateButton();
            }
        }
    }

    function handleKeyEvent(e) {
        // Double-shift opens search
        if (e.key === 'Shift' && !e.repeat) {
            const now = Date.now();
            if (now - lastShiftTime < 300) {
                toggle();
            }
            lastShiftTime = now;
        }

        if (!isOpen()) return false;

        const nav = resolveListNavigation(e.key, searchSelIdx, searchResults.length);
        if (!nav.handled) return false;

        e.preventDefault();

        if (nav.action === NAV_ACTION_MOVE) {
            searchSelIdx = nav.nextIndex;
            updateSelection();
        } else if (nav.action === NAV_ACTION_SELECT) {
            if (searchResults[nav.nextIndex]) {
                selectResult(searchResults[nav.nextIndex]);
            }
        }

        return true;
    }

    // Wire up event listeners
    if (btnSearch) {
        btnSearch.addEventListener('click', () => {
            const now = Date.now();
            if (now - modalToggleTime < 400) return;
            modalToggleTime = now;
            toggle();
        });
    }

    if (btnDuplicates) {
        btnDuplicates.addEventListener('click', () => {
            if (!duplicateSearchName) return;
            if (!isOpen()) {
                toggle();
            }

            searchInput.value = duplicateSearchName;
            if (fuse) {
                const results = fuse.search(duplicateSearchName, { limit: 20 });
                renderResults(results.map(r => r.item));
            }
        });
    }

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            toggle();
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

    document.addEventListener('fullscreenchange', updateFullscreenVisibility);
    document.addEventListener('webkitfullscreenchange', updateFullscreenVisibility);
    document.addEventListener('mozfullscreenchange', updateFullscreenVisibility);
    document.addEventListener('MSFullscreenChange', updateFullscreenVisibility);

    return {
        toggle,
        rebuild,
        updateDuplicateButton,
        updateFullscreenVisibility,
        handleKeyEvent,
        isOpen,
    };
}
