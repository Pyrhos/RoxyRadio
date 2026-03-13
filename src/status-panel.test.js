import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStatusPanelController } from './status-panel.js';

function makeDOM() {
    const statusEl = document.createElement('div');
    statusEl.id = 'status';
    document.body.appendChild(statusEl);

    const statusPanel = document.createElement('div');
    statusPanel.id = 'status-panel';
    statusPanel.setAttribute('aria-hidden', 'true');
    statusPanel.inert = true;
    document.body.appendChild(statusPanel);

    const statusSongList = document.createElement('ul');
    statusSongList.id = 'status-song-list';
    statusPanel.appendChild(statusSongList);

    return { statusEl, statusPanel, statusSongList };
}

describe('createStatusPanelController', () => {
    describe('refresh uses dynamic stream fallback ID', () => {
        let dom, ctrl;
        let streamIdx;

        beforeEach(() => {
            document.body.innerHTML = '';
            dom = makeDOM();
            streamIdx = 0;

            ctrl = createStatusPanelController({
                ...dom,
                getCurrentStream: () => ({
                    // videoId intentionally omitted to test the fallback path
                    videoId: '',
                    title: `Stream ${streamIdx}`,
                    songs: [{ name: 'Song 1', range: [0, 100] }],
                }),
                getCurrentStreamIdx: () => streamIdx,
                getCoreRIdx: () => 0,
                getStreamDefaultStart: () => 0,
                getPlayerTime: () => 50,
                isPlaylistReady: () => true,
                onSongPick: vi.fn(),
            });
        });

        it('rebuilds song list when stream index changes', () => {
            ctrl.refresh(false);
            expect(dom.statusSongList.children.length).toBe(1);

            // Switch to a different stream index with same song count
            streamIdx = 1;

            const spy = vi.spyOn(dom.statusSongList, 'innerHTML', 'set');
            ctrl.refresh(false);

            // The list should be rebuilt because the fallback stream ID changed
            // (If the ID were static, the second refresh would short-circuit)
            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });

        it('skips rebuild when same stream is refreshed', () => {
            ctrl.refresh(false);
            const spy = vi.spyOn(dom.statusSongList, 'innerHTML', 'set');

            // Same streamIdx, same song count — should not rebuild
            ctrl.refresh(false);
            expect(spy).not.toHaveBeenCalled();

            spy.mockRestore();
        });
    });
});
