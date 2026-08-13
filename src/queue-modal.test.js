import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createQueueModalController } from './queue-modal.js';

function makeDOM() {
    const overlay = document.createElement('div');
    overlay.id = 'queue-overlay';
    overlay.inert = true;

    const queueList = document.createElement('div');
    queueList.id = 'queue-list';

    const clearAllBtn = document.createElement('button');
    clearAllBtn.id = 'queue-clear-btn';

    const searchInput = document.createElement('input');
    searchInput.id = 'queue-search-input';

    overlay.appendChild(searchInput);
    overlay.appendChild(queueList);
    overlay.appendChild(clearAllBtn);
    document.body.appendChild(overlay);

    return { overlay, queueList, clearAllBtn, searchInput };
}

// Drive the filter box the way a user would: set text, dispatch input.
function typeFilter(searchInput, value) {
    searchInput.value = value;
    searchInput.dispatchEvent(new Event('input'));
}

const MOCK_PLAYLIST = [
    { videoId: 'v1', name: 'Stream 1', title: 'Video 1', songs: [{ name: 'S1T1', range: [0, 10] }, { name: 'S1T2', range: [20, 30] }] },
    { videoId: 'v2', name: 'Stream 2', title: 'Video 2', songs: null },
    { videoId: 'v3', name: 'Stream 3', title: 'Video 3', songs: [{ name: 'S3T1', range: [0, 10] }] },
];

describe('Queue Modal Controller', () => {
    let dom, ctrl;
    let mockQueue;
    let onRemoveItem, onSelectItem, onClearAll;

    beforeEach(() => {
        document.body.innerHTML = '';
        dom = makeDOM();
        mockQueue = [];
        onRemoveItem = vi.fn();
        onSelectItem = vi.fn();
        onClearAll = vi.fn();

        ctrl = createQueueModalController({
            overlay: dom.overlay,
            queueList: dom.queueList,
            clearAllBtn: dom.clearAllBtn,
            searchInput: dom.searchInput,
            getQueue: () => mockQueue,
            getPlaylist: () => MOCK_PLAYLIST,
            onRemoveItem,
            onSelectItem,
            onClearAll,
        });
    });

    describe('toggle', () => {
        it('opens the modal', () => {
            ctrl.toggle();
            expect(dom.overlay.classList.contains('open')).toBe(true);
            expect(dom.overlay.inert).toBe(false);
        });

        it('closes the modal when open', () => {
            ctrl.toggle(); // open
            ctrl.toggle(); // close
            expect(dom.overlay.classList.contains('open')).toBe(false);
            expect(dom.overlay.inert).toBe(true);
        });
    });

    describe('isOpen', () => {
        it('returns false when closed', () => {
            expect(ctrl.isOpen()).toBe(false);
        });

        it('returns true when open', () => {
            ctrl.toggle();
            expect(ctrl.isOpen()).toBe(true);
        });
    });

    describe('render', () => {
        it('shows empty message when queue is empty', () => {
            ctrl.toggle();
            const empty = dom.queueList.querySelector('.queue-empty');
            expect(empty).not.toBeNull();
            expect(empty.textContent).toBe('(..◜ᴗ◝..)');
            expect(dom.clearAllBtn.disabled).toBe(true);
        });

        it('renders queue items with correct song and stream names', () => {
            mockQueue = [
                { videoId: 'v1', rIdx: 1 },
                { videoId: 'v3', rIdx: 0 },
            ];
            ctrl.toggle();

            const items = dom.queueList.querySelectorAll('.queue-item');
            expect(items.length).toBe(2);

            // First item: v1 song at rIdx 1 = S1T2
            expect(items[0].querySelector('.queue-item-name').textContent).toBe('S1T2');
            expect(items[0].querySelector('.queue-item-stream').textContent).toBe('Stream 1');

            // Second item: v3 song at rIdx 0 = S3T1
            expect(items[1].querySelector('.queue-item-name').textContent).toBe('S3T1');
            expect(items[1].querySelector('.queue-item-stream').textContent).toBe('Stream 3');

            expect(dom.clearAllBtn.disabled).toBe(false);
        });

        it('shows stream title for Rule 0 items', () => {
            mockQueue = [{ videoId: 'v2', rIdx: 0 }];
            ctrl.toggle();

            const items = dom.queueList.querySelectorAll('.queue-item');
            expect(items[0].querySelector('.queue-item-name').textContent).toBe('Video 2');
        });

        it('shows "Unknown" for invalid videoIds', () => {
            mockQueue = [{ videoId: 'invalid', rIdx: 0 }];
            ctrl.toggle();

            const items = dom.queueList.querySelectorAll('.queue-item');
            expect(items[0].querySelector('.queue-item-name').textContent).toBe('Unknown');
            expect(items[0].querySelector('.queue-item-stream').textContent).toBe('invalid');
        });

        it('first item has selected class', () => {
            mockQueue = [
                { videoId: 'v1', rIdx: 0 },
                { videoId: 'v3', rIdx: 0 },
            ];
            ctrl.toggle();

            const items = dom.queueList.querySelectorAll('.queue-item');
            expect(items[0].classList.contains('selected')).toBe(true);
            expect(items[1].classList.contains('selected')).toBe(false);
        });

        it('marks the now-playing item when getNowPlayingIndex reports one', () => {
            mockQueue = [
                { videoId: 'v1', rIdx: 0 },
                { videoId: 'v3', rIdx: 0 },
            ];
            ctrl = createQueueModalController({
                overlay: dom.overlay,
                queueList: dom.queueList,
                clearAllBtn: dom.clearAllBtn,
                getQueue: () => mockQueue,
                getPlaylist: () => MOCK_PLAYLIST,
                onRemoveItem,
                onSelectItem,
                onClearAll,
                getNowPlayingIndex: () => 1,
            });
            ctrl.toggle();

            const items = dom.queueList.querySelectorAll('.queue-item');
            expect(items[0].classList.contains('now-playing')).toBe(false);
            expect(items[1].classList.contains('now-playing')).toBe(true);
            expect(items[0].querySelector('.queue-item-index').textContent).toBe('1.');
            expect(items[1].querySelector('.queue-item-index').textContent).toBe('▶');
        });

        it('marks no item when getNowPlayingIndex is absent (default -1)', () => {
            mockQueue = [
                { videoId: 'v1', rIdx: 0 },
                { videoId: 'v3', rIdx: 0 },
            ];
            ctrl.toggle();

            expect(dom.queueList.querySelector('.now-playing')).toBeNull();
        });

        it('scrolls the now-playing item into view and selects it on open', () => {
            mockQueue = [
                { videoId: 'v1', rIdx: 0 },
                { videoId: 'v3', rIdx: 0 },
                { videoId: 'v2', rIdx: 0 },
            ];
            const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
            ctrl = createQueueModalController({
                overlay: dom.overlay,
                queueList: dom.queueList,
                clearAllBtn: dom.clearAllBtn,
                getQueue: () => mockQueue,
                getPlaylist: () => MOCK_PLAYLIST,
                onRemoveItem,
                onSelectItem,
                onClearAll,
                getNowPlayingIndex: () => 2,
            });
            ctrl.toggle();

            const items = dom.queueList.querySelectorAll('.queue-item');
            // Selection follows playback rather than staying on the first item.
            expect(items[0].classList.contains('selected')).toBe(false);
            expect(items[2].classList.contains('selected')).toBe(true);
            // The now-playing row was scrolled to its depth.
            expect(scrollSpy).toHaveBeenCalled();
            expect(scrollSpy.mock.instances[scrollSpy.mock.instances.length - 1]).toBe(items[2]);

            scrollSpy.mockRestore();
        });

        it('leaves selection at the top when nothing is playing', () => {
            mockQueue = [
                { videoId: 'v1', rIdx: 0 },
                { videoId: 'v3', rIdx: 0 },
            ];
            ctrl.toggle(); // default getNowPlayingIndex → -1

            const items = dom.queueList.querySelectorAll('.queue-item');
            expect(items[0].classList.contains('selected')).toBe(true);
            expect(items[1].classList.contains('selected')).toBe(false);
        });
    });

    describe('refreshNowPlaying', () => {
        it('moves the ▶ marker to the newly-playing slot without a full re-render', () => {
            mockQueue = [
                { videoId: 'v1', rIdx: 0 },
                { videoId: 'v3', rIdx: 0 },
                { videoId: 'v2', rIdx: 0 },
            ];
            let nowPlaying = 0;
            ctrl = createQueueModalController({
                overlay: dom.overlay,
                queueList: dom.queueList,
                clearAllBtn: dom.clearAllBtn,
                searchInput: dom.searchInput,
                getQueue: () => mockQueue,
                getPlaylist: () => MOCK_PLAYLIST,
                onRemoveItem,
                onSelectItem,
                onClearAll,
                getNowPlayingIndex: () => nowPlaying,
            });
            ctrl.toggle();

            let items = dom.queueList.querySelectorAll('.queue-item');
            expect(items[0].classList.contains('now-playing')).toBe(true);
            expect(items[0].querySelector('.queue-item-index').textContent).toBe('▶');

            // Playback advances to the next queue slot.
            nowPlaying = 1;
            ctrl.refreshNowPlaying();

            // Same DOM nodes, marker repainted onto slot 1.
            expect(dom.queueList.querySelectorAll('.queue-item')[0]).toBe(items[0]);
            items = dom.queueList.querySelectorAll('.queue-item');
            expect(items[0].classList.contains('now-playing')).toBe(false);
            expect(items[0].querySelector('.queue-item-index').textContent).toBe('1.');
            expect(items[1].classList.contains('now-playing')).toBe(true);
            expect(items[1].querySelector('.queue-item-index').textContent).toBe('▶');
        });

        it('preserves the keyboard selection when the marker moves', () => {
            mockQueue = [
                { videoId: 'v1', rIdx: 0 },
                { videoId: 'v3', rIdx: 0 },
                { videoId: 'v2', rIdx: 0 },
            ];
            let nowPlaying = 0;
            ctrl = createQueueModalController({
                overlay: dom.overlay,
                queueList: dom.queueList,
                clearAllBtn: dom.clearAllBtn,
                searchInput: dom.searchInput,
                getQueue: () => mockQueue,
                getPlaylist: () => MOCK_PLAYLIST,
                onRemoveItem,
                onSelectItem,
                onClearAll,
                getNowPlayingIndex: () => nowPlaying,
            });
            ctrl.toggle();

            // User navigates down to slot 2 while slot 0 plays.
            const down = new KeyboardEvent('keydown', { key: 'ArrowDown' });
            down.preventDefault = vi.fn();
            ctrl.handleKeyEvent(down);
            ctrl.handleKeyEvent(down);

            nowPlaying = 1;
            ctrl.refreshNowPlaying();

            // Selection stays where the user left it; only the ▶ marker moved.
            const items = dom.queueList.querySelectorAll('.queue-item');
            expect(items[2].classList.contains('selected')).toBe(true);
            expect(items[1].classList.contains('now-playing')).toBe(true);
        });

        it('clears the marker when playback leaves the queue (index -1)', () => {
            mockQueue = [
                { videoId: 'v1', rIdx: 0 },
                { videoId: 'v3', rIdx: 0 },
            ];
            let nowPlaying = 1;
            ctrl = createQueueModalController({
                overlay: dom.overlay,
                queueList: dom.queueList,
                clearAllBtn: dom.clearAllBtn,
                searchInput: dom.searchInput,
                getQueue: () => mockQueue,
                getPlaylist: () => MOCK_PLAYLIST,
                onRemoveItem,
                onSelectItem,
                onClearAll,
                getNowPlayingIndex: () => nowPlaying,
            });
            ctrl.toggle();
            expect(dom.queueList.querySelector('.now-playing')).not.toBeNull();

            nowPlaying = -1;
            ctrl.refreshNowPlaying();

            expect(dom.queueList.querySelector('.now-playing')).toBeNull();
            const items = dom.queueList.querySelectorAll('.queue-item');
            expect(items[1].querySelector('.queue-item-index').textContent).toBe('2.');
        });
    });

    describe('remove button', () => {
        it('calls onRemoveItem with correct index', () => {
            mockQueue = [
                { videoId: 'v1', rIdx: 0 },
                { videoId: 'v3', rIdx: 0 },
            ];
            ctrl.toggle();

            const removeBtn = dom.queueList.querySelectorAll('.queue-item-remove')[1];
            removeBtn.click();
            expect(onRemoveItem).toHaveBeenCalledWith(1);
        });
    });

    describe('clear all', () => {
        it('calls onClearAll', () => {
            mockQueue = [{ videoId: 'v1', rIdx: 0 }];
            ctrl.toggle();
            dom.clearAllBtn.click();
            expect(onClearAll).toHaveBeenCalled();
        });
    });

    describe('backdrop click', () => {
        it('closes modal when clicking the overlay backdrop', () => {
            ctrl.toggle();
            expect(ctrl.isOpen()).toBe(true);

            // Click on the overlay itself (not its children)
            dom.overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(ctrl.isOpen()).toBe(false);
        });
    });

    describe('item selection', () => {
        it('clicking an item calls onSelectItem with its index', () => {
            mockQueue = [
                { videoId: 'v1', rIdx: 0 },
                { videoId: 'v3', rIdx: 0 },
            ];
            ctrl.toggle();

            const items = dom.queueList.querySelectorAll('.queue-item');
            items[1].click();
            expect(onSelectItem).toHaveBeenCalledWith(1);
        });

        it('Enter on highlighted item calls onSelectItem', () => {
            mockQueue = [
                { videoId: 'v1', rIdx: 0 },
                { videoId: 'v3', rIdx: 0 },
            ];
            ctrl.toggle();

            // Move selection to second item
            const down = new KeyboardEvent('keydown', { key: 'ArrowDown' });
            down.preventDefault = vi.fn();
            ctrl.handleKeyEvent(down);

            const enter = new KeyboardEvent('keydown', { key: 'Enter' });
            enter.preventDefault = vi.fn();
            ctrl.handleKeyEvent(enter);

            expect(onSelectItem).toHaveBeenCalledWith(1);
        });

        it('clicking remove button does not trigger onSelectItem', () => {
            mockQueue = [{ videoId: 'v1', rIdx: 0 }];
            ctrl.toggle();

            const removeBtn = dom.queueList.querySelector('.queue-item-remove');
            removeBtn.click();
            expect(onRemoveItem).toHaveBeenCalledWith(0);
            expect(onSelectItem).not.toHaveBeenCalled();
        });
    });

    describe('keyboard navigation', () => {
        it('arrow down moves selection', () => {
            mockQueue = [
                { videoId: 'v1', rIdx: 0 },
                { videoId: 'v3', rIdx: 0 },
            ];
            ctrl.toggle();

            const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
            event.preventDefault = vi.fn();
            const handled = ctrl.handleKeyEvent(event);

            expect(handled).toBe(true);
            const items = dom.queueList.querySelectorAll('.queue-item');
            expect(items[0].classList.contains('selected')).toBe(false);
            expect(items[1].classList.contains('selected')).toBe(true);
        });

        it('auto-focuses the filter box on open', () => {
            mockQueue = [{ videoId: 'v1', rIdx: 0 }];
            ctrl.toggle();
            expect(document.activeElement).toBe(dom.searchInput);
        });

        it('delete edits the query (no removal) while the filter box is focused on open', () => {
            mockQueue = [
                { videoId: 'v1', rIdx: 0 },
                { videoId: 'v3', rIdx: 0 },
            ];
            ctrl.toggle(); // auto-focuses the filter box

            const event = new KeyboardEvent('keydown', { key: 'Delete' });
            event.preventDefault = vi.fn();
            const handled = ctrl.handleKeyEvent(event);

            expect(handled).toBe(false);
            expect(onRemoveItem).not.toHaveBeenCalled();
        });

        it('first Arrow hands focus off the filter box, then delete removes the highlighted item', () => {
            mockQueue = [
                { videoId: 'v1', rIdx: 0 },
                { videoId: 'v3', rIdx: 0 },
            ];
            ctrl.toggle(); // auto-focused on open

            const down = new KeyboardEvent('keydown', { key: 'ArrowDown' });
            down.preventDefault = vi.fn();
            ctrl.handleKeyEvent(down); // hands off to the list; selIdx 0 -> 1
            expect(document.activeElement).not.toBe(dom.searchInput);

            const del = new KeyboardEvent('keydown', { key: 'Delete' });
            del.preventDefault = vi.fn();
            ctrl.handleKeyEvent(del);
            expect(onRemoveItem).toHaveBeenCalledWith(1);
        });

        it('returns false when modal is closed', () => {
            const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
            expect(ctrl.handleKeyEvent(event)).toBe(false);
        });
    });

    describe('search filter', () => {
        beforeEach(() => {
            mockQueue = [
                { videoId: 'v1', rIdx: 0 }, // S1T1 / Stream 1
                { videoId: 'v1', rIdx: 1 }, // S1T2 / Stream 1
                { videoId: 'v3', rIdx: 0 }, // S3T1 / Stream 3
            ];
            ctrl.toggle();
        });

        it('filters visible items by song name (case-insensitive)', () => {
            typeFilter(dom.searchInput, 's1t2');

            const items = dom.queueList.querySelectorAll('.queue-item');
            expect(items.length).toBe(1);
            expect(items[0].querySelector('.queue-item-name').textContent).toBe('S1T2');
        });

        it('filters by stream name', () => {
            typeFilter(dom.searchInput, 'Stream 3');

            const items = dom.queueList.querySelectorAll('.queue-item');
            expect(items.length).toBe(1);
            expect(items[0].querySelector('.queue-item-stream').textContent).toBe('Stream 3');
        });

        it('keeps the real queue index — displayed number and removal target', () => {
            typeFilter(dom.searchInput, 'S3T1');

            const items = dom.queueList.querySelectorAll('.queue-item');
            expect(items.length).toBe(1);
            // The lone match is queue slot 2 → shows "3." and its remove targets index 2.
            expect(items[0].querySelector('.queue-item-index').textContent).toBe('3.');
            items[0].querySelector('.queue-item-remove').click();
            expect(onRemoveItem).toHaveBeenCalledWith(2);
        });

        it('first visible match becomes the selection', () => {
            typeFilter(dom.searchInput, 'Stream 1');

            const items = dom.queueList.querySelectorAll('.queue-item');
            expect(items.length).toBe(2);
            expect(items[0].classList.contains('selected')).toBe(true);
        });

        it('Enter selects the highlighted match by its real queue index', () => {
            typeFilter(dom.searchInput, 'S3T1');

            const enter = new KeyboardEvent('keydown', { key: 'Enter' });
            enter.preventDefault = vi.fn();
            ctrl.handleKeyEvent(enter);

            expect(onSelectItem).toHaveBeenCalledWith(2);
        });

        it('shows a no-matches message (queue non-empty) leaving Clear All enabled', () => {
            typeFilter(dom.searchInput, 'zzzznope');

            expect(dom.queueList.querySelectorAll('.queue-item').length).toBe(0);
            expect(dom.queueList.querySelector('.queue-no-matches')).not.toBeNull();
            expect(dom.clearAllBtn.disabled).toBe(false);
        });

        it('does not remove an item on Backspace while the filter box is focused', () => {
            typeFilter(dom.searchInput, 'S1');
            dom.searchInput.focus();

            const back = new KeyboardEvent('keydown', { key: 'Backspace' });
            back.preventDefault = vi.fn();
            const handled = ctrl.handleKeyEvent(back);

            expect(handled).toBe(false);
            expect(back.preventDefault).not.toHaveBeenCalled();
            expect(onRemoveItem).not.toHaveBeenCalled();
        });

        it('re-opening the modal clears the filter', () => {
            typeFilter(dom.searchInput, 'S1T2');
            expect(dom.queueList.querySelectorAll('.queue-item').length).toBe(1);

            ctrl.toggle(); // close
            ctrl.toggle(); // re-open

            expect(dom.searchInput.value).toBe('');
            expect(dom.queueList.querySelectorAll('.queue-item').length).toBe(3);
        });
    });
});
