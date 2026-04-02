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

    overlay.appendChild(queueList);
    overlay.appendChild(clearAllBtn);
    document.body.appendChild(overlay);

    return { overlay, queueList, clearAllBtn };
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

        it('delete removes highlighted item', () => {
            mockQueue = [
                { videoId: 'v1', rIdx: 0 },
                { videoId: 'v3', rIdx: 0 },
            ];
            ctrl.toggle();

            const event = new KeyboardEvent('keydown', { key: 'Delete' });
            event.preventDefault = vi.fn();
            ctrl.handleKeyEvent(event);

            expect(onRemoveItem).toHaveBeenCalledWith(0);
        });

        it('returns false when modal is closed', () => {
            const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
            expect(ctrl.handleKeyEvent(event)).toBe(false);
        });
    });
});
