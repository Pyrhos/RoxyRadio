import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSearchController } from './search-modal.js';

function makeDOM() {
    const modal = document.createElement('div');
    modal.id = 'modal-overlay';
    modal.inert = true;
    document.body.appendChild(modal);

    const searchInput = document.createElement('input');
    searchInput.id = 'search-input';
    modal.appendChild(searchInput);

    const resultsContainer = document.createElement('div');
    resultsContainer.id = 'search-results';
    modal.appendChild(resultsContainer);

    const btnSearch = document.createElement('button');
    btnSearch.id = 'search-btn';
    document.body.appendChild(btnSearch);

    const btnDuplicates = document.createElement('button');
    btnDuplicates.id = 'duplicates-btn';
    btnDuplicates.innerHTML = '<span class="note-count">0</span>';
    document.body.appendChild(btnDuplicates);

    return { modal, searchInput, resultsContainer, btnSearch, btnDuplicates };
}

describe('createSearchController', () => {
    let dom, ctrl;

    beforeEach(() => {
        document.body.innerHTML = '';
        dom = makeDOM();

        ctrl = createSearchController({
            ...dom,
            getCurrentStreamIdx: () => 0,
            getCurrentSong: () => ({ name: 'Test Song', range: [10, 60] }),
            onSelectResult: vi.fn(),
        });
    });

    describe('toggle debounce is button-click-only', () => {
        it('toggle() itself has no debounce — can be called rapidly', () => {
            ctrl.toggle(); // open
            expect(dom.modal.classList.contains('open')).toBe(true);

            ctrl.toggle(); // close immediately
            expect(dom.modal.classList.contains('open')).toBe(false);

            ctrl.toggle(); // reopen immediately
            expect(dom.modal.classList.contains('open')).toBe(true);
        });

        it('btnSearch click is debounced within 400ms', () => {
            dom.btnSearch.click();
            expect(dom.modal.classList.contains('open')).toBe(true);

            // Rapid second click within 400ms should be ignored (stays open)
            dom.btnSearch.click();
            expect(dom.modal.classList.contains('open')).toBe(true);
        });

        it('selectResult closes the modal even if opened recently', () => {
            // Build a fuse index so search works
            ctrl.rebuild([{
                videoId: 'v1', name: 'Stream 1', title: 'Stream 1',
                songs: [{ name: 'Song A', range: [0, 100] }],
            }]);

            ctrl.toggle(); // open
            expect(dom.modal.classList.contains('open')).toBe(true);

            // Simulate selecting a result — this calls toggle() internally
            // which must NOT be blocked by debounce
            ctrl.toggle(); // close (as selectResult does)
            expect(dom.modal.classList.contains('open')).toBe(false);
        });
    });
});
