import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRadioApplication } from './radio-app.js';
import { setupDOM, clearStorage, pressKey, pressKeyOn } from './test-setup.js';
import { sortSearchResultsByCurrentStream, normalizeSongBaseName } from './search-helpers.js';

const SEGMENTS = [
    { videoId: 'aaaaaaaaaaa', name: 'First stream', songs: [
        { name: 'Song A', range: [10, 20] },
        { name: 'Song B', range: [30, 40] },
        { name: 'Song C', range: [50, 60] },
    ] },
    { videoId: 'bbbbbbbbbbb', name: 'Second stream', songs: [
        { name: 'Song A', range: [70, 80] },
        { name: 'Song D', range: [90, 100] },
    ] },
    { videoId: 'mmmmmmmmmmm', name: 'Member stream', memberOnly: true, songs: [
        { name: 'Member song', range: [110, 120] },
    ] },
];

const element = id => document.getElementById(id);
const isOpen = id => element(id).classList.contains('open');
const label = id => element(id).querySelector('.btn-label')?.textContent;
const shortcut = key => pressKey(key, { shiftKey: true });
const queue = () => JSON.parse(localStorage.getItem('roxy_queue') || '[]');

// All interaction handlers below belong to the real application. The only test
// double is the external iframe player; no navigation or UI logic is duplicated.
describe('Radio application', () => {
    let application, player, events;

    async function start(segmentsData = SEGMENTS) {
        application = createRadioApplication({ segmentsData: structuredClone(segmentsData) });
        await vi.advanceTimersByTimeAsync(0);
        events.onReady();
    }

    function confirmPlayback(startSeconds = 10) {
        player.getPlayerState.mockReturnValue(1);
        player.currentTime = startSeconds;
        events.onStateChange({ data: 1 });
        player.currentTime = startSeconds + 1.2;
        vi.advanceTimersByTime(1200);
    }

    function search(query = 'Song') {
        if (!isOpen('modal-overlay')) shortcut('S');
        element('search-input').value = query;
        element('search-input').dispatchEvent(new Event('input'));
        return [...element('search-results').querySelectorAll('.result-item')];
    }

    beforeEach(async () => {
        vi.useFakeTimers();
        setupDOM();
        clearStorage();
        history.replaceState(null, '', '/');
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.stubGlobal('confirm', vi.fn(() => true));
        player = {
            currentTime: 15,
            getCurrentTime: vi.fn(() => player.currentTime),
            getPlayerState: vi.fn(() => -1),
            getDuration: vi.fn(() => 200),
            getVideoData: vi.fn(() => ({ title: 'Imported video' })),
            loadVideoById: vi.fn(),
            seekTo: vi.fn(),
            playVideo: vi.fn(),
            destroy: vi.fn(),
        };
        vi.stubGlobal('YT', {
            PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 },
            Player: function (_target, config) { events = config.events; return player; },
        });
        vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
        vi.spyOn(navigator.clipboard, 'readText').mockResolvedValue('');
        await start();
    });

    afterEach(() => {
        application.dispose();
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        clearStorage();
        history.replaceState(null, '', '/');
    });

    describe('search', () => {
        it.each(['click', 'shortcut', 'double shift'])('opens and focuses search through %s', method => {
            if (method === 'click') element('search-btn').click();
            else if (method === 'shortcut') shortcut('S');
            else { pressKey('Shift'); vi.advanceTimersByTime(100); pressKey('Shift'); }
            expect(isOpen('modal-overlay')).toBe(true);
            expect(element('modal-overlay').inert).toBe(false);
            expect(document.activeElement).toBe(element('search-input'));
        });

        it('does not open for two slow Shift presses', () => {
            pressKey('Shift');
            vi.advanceTimersByTime(400);
            pressKey('Shift');
            expect(isOpen('modal-overlay')).toBe(false);
        });

        it('clears the query and results when reopened', () => {
            expect(search().length).toBe(5);
            pressKey('Escape');
            shortcut('S');
            expect(element('search-input').value).toBe('');
            expect(element('search-results').children.length).toBe(0);
        });

        it.each(['Escape', 'overlay', 'shortcut'])('closes through %s', method => {
            search();
            if (method === 'Escape') pressKey('Escape');
            else if (method === 'overlay') element('modal-overlay').click();
            else shortcut('S');
            expect(isOpen('modal-overlay')).toBe(false);
            expect(element('modal-overlay').inert).toBe(true);
        });

        it.each(['comic-box', 'search-input'])('stays open when %s is clicked', id => {
            search();
            element(id).click();
            expect(isOpen('modal-overlay')).toBe(true);
        });

        it('selects a result through the actual row handler and closes', () => {
            confirmPlayback();
            const rows = search('Song B');
            rows.find(row => row.textContent.includes('Song B')).click();
            expect(isOpen('modal-overlay')).toBe(false);
            expect(player.seekTo).toHaveBeenLastCalledWith(30, true);
        });

        it('moves selection with arrows, clamps at both ends, and ignores Tab', () => {
            const rows = search();
            pressKey('ArrowUp');
            expect(rows[0].classList.contains('selected')).toBe(true);
            pressKey('ArrowDown');
            expect(rows[1].classList.contains('selected')).toBe(true);
            pressKey('ArrowUp');
            expect(rows[0].classList.contains('selected')).toBe(true);
            for (let i = 0; i < rows.length + 1; i++) pressKey('ArrowDown');
            expect(rows.at(-1).classList.contains('selected')).toBe(true);
            expect(pressKey('Tab').defaultPrevented).toBe(false);
        });

        it('Enter selects the highlighted result', () => {
            confirmPlayback();
            search('Song B');
            pressKey('Enter');
            expect(isOpen('modal-overlay')).toBe(false);
            expect(player.seekTo).toHaveBeenLastCalledWith(30, true);
        });

        it('shows duplicate count and searches matching songs', () => {
            vi.advanceTimersByTime(2000);
            expect(element('duplicates-btn').style.display).toBe('flex');
            expect(element('duplicates-btn').querySelector('.note-count').textContent).toBe('1');
            element('duplicates-btn').click();
            expect(isOpen('modal-overlay')).toBe(true);
            expect(element('search-input').value).toBe('Song A');
            expect(element('search-results').textContent).toContain('Song A');
        });

        it('hides search controls in fullscreen and restores them afterward', () => {
            Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: element('player') });
            document.dispatchEvent(new Event('fullscreenchange'));
            expect(element('search-btn').style.display).toBe('none');
            expect(element('duplicates-btn').style.display).toBe('none');
            Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
            document.dispatchEvent(new Event('fullscreenchange'));
            expect(element('search-btn').style.display).toBe('flex');
        });
    });

    describe('status panel', () => {
        it.each(['click', 'Enter', ' ', 'shortcut'])('opens through %s with accessibility state and selected song', method => {
            if (method === 'click') element('status').click();
            else if (method === 'shortcut') shortcut('A');
            else pressKeyOn(element('status'), method);
            expect(isOpen('status-panel')).toBe(true);
            expect(element('status-panel').inert).toBe(false);
            expect(element('status-panel').getAttribute('aria-hidden')).toBe('false');
            expect(element('status').getAttribute('aria-expanded')).toBe('true');
            expect(element('status-song-list').querySelectorAll('.status-song').length).toBe(3);
            expect(element('status-song-list').querySelector('.nav-focus').dataset.songIndex).toBe('0');
        });

        it.each(['Escape', 'shortcut', 'outside', 'blur'])('closes through %s and clears selection', method => {
            shortcut('A');
            if (method === 'Escape') pressKey('Escape');
            else if (method === 'shortcut') shortcut('A');
            else if (method === 'blur') window.dispatchEvent(new Event('blur'));
            else document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            expect(isOpen('status-panel')).toBe(false);
            expect(element('status-panel').inert).toBe(true);
            expect(element('status-panel').getAttribute('aria-hidden')).toBe('true');
            expect(element('status').getAttribute('aria-expanded')).toBe('false');
            expect(element('status-song-list').querySelector('.nav-focus')).toBeNull();
        });

        it('stays open for pointer events inside the panel', () => {
            shortcut('A');
            element('status-song-list').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            expect(isOpen('status-panel')).toBe(true);
        });

        it('moves selection with arrows and selects using Enter', () => {
            confirmPlayback();
            shortcut('A');
            pressKey('ArrowDown');
            expect(element('status-song-list').querySelector('.nav-focus').dataset.songIndex).toBe('1');
            pressKey('Enter');
            expect(player.seekTo).toHaveBeenLastCalledWith(30, true);
            expect(isOpen('status-panel')).toBe(false);
        });

        it('uses separate Enter presses to open from the focused song bar and select', () => {
            confirmPlayback();
            element('status').focus();
            pressKeyOn(element('status'), 'Enter');
            expect(isOpen('status-panel')).toBe(true);
            expect(player.seekTo).not.toHaveBeenCalled();
            pressKeyOn(document.activeElement, 'ArrowDown');
            pressKeyOn(document.activeElement, 'Enter');
            expect(player.seekTo).toHaveBeenLastCalledWith(30, true);
            expect(isOpen('status-panel')).toBe(false);
        });

        it('preserves song text selection without opening the panel', () => {
            const text = element('status-text');
            const range = document.createRange();
            range.selectNodeContents(text);
            const selection = window.getSelection();
            selection.addRange(range);
            const selectedText = selection.toString();

            element('status').click();
            element('status').parentElement.click();

            expect(isOpen('status-panel')).toBe(false);
            expect(selection.toString()).toBe(selectedText);
            selection.removeAllRanges();
        });

        it('closes the open panel when clicking the stationary status padding', () => {
            element('status').click();
            expect(isOpen('status-panel')).toBe(true);
            const container = element('status').parentElement;
            container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            container.click();
            expect(isOpen('status-panel')).toBe(false);
        });

        it('clicking a song selects its timestamp and closes the panel', () => {
            confirmPlayback();
            shortcut('A');
            element('status-song-list').children[2].click();
            expect(player.seekTo).toHaveBeenLastCalledWith(50, true);
            expect(isOpen('status-panel')).toBe(false);
        });

        it('tracks actual player time with active and aria-selected states', () => {
            confirmPlayback();
            shortcut('A');
            player.currentTime = 35;
            vi.advanceTimersByTime(2000);
            const rows = element('status-song-list').querySelectorAll('.status-song');
            expect(rows[1].classList.contains('active')).toBe(true);
            expect(rows[1].getAttribute('aria-selected')).toBe('true');
            expect(rows[0].getAttribute('aria-selected')).toBe('false');
        });
    });

    describe('controls and persistence', () => {
        it('does not replace a song-list selection with a shuffled jump while its seek is pending', () => {
            player.getPlayerState.mockReturnValue(1);
            player.currentTime = 10;
            events.onStateChange({ data: 1 });
            player.currentTime = 11;
            vi.advanceTimersByTime(1200);
            element('shuffle-btn').click();
            search('Song D')[0].querySelector('.enqueue-btn').click();
            pressKey('Escape');
            player.currentTime = 19.9;
            shortcut('A');
            element('status-song-list').children[2].click();
            expect(player.seekTo).toHaveBeenLastCalledWith(50, true);

            // The iframe has not applied the seek yet. Neither the old clock
            // nor a delayed end event may consume the next shuffled queue item.
            vi.advanceTimersByTime(400);
            events.onStateChange({ data: 0 });
            expect(player.loadVideoById).toHaveBeenCalledTimes(1);
            expect(queue()).toEqual([{ videoId: 'bbbbbbbbbbb', rIdx: 1 }]);
            expect(player.playVideo).toHaveBeenCalled();

            player.currentTime = 50;
            events.onStateChange({ data: 1 });
            vi.advanceTimersByTime(200);
            player.currentTime = 51.2;
            vi.advanceTimersByTime(1200);
            expect(element('status-text').textContent).toContain('Song C');
            expect(player.loadVideoById).toHaveBeenCalledTimes(1);
        });

        it('starts a song selected while the iframe is paused', () => {
            confirmPlayback();
            player.getPlayerState.mockReturnValue(2);
            shortcut('A');
            element('status-song-list').children[1].click();
            expect(player.seekTo).toHaveBeenLastCalledWith(30, true);
            expect(player.playVideo).toHaveBeenCalledTimes(1);
        });

        it('sends a new song-list selection while the shuffled stream has not started', () => {
            player.getVideoUrl = vi.fn(() => 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
            element('shuffle-btn').click();
            search('Song D')[0].querySelector('.enqueue-btn').click();
            pressKey('Escape');
            vi.advanceTimersByTime(300);
            element('next-song').click();
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
                videoId: 'bbbbbbbbbbb', startSeconds: 90,
            }));
            player.getPlayerState.mockReturnValue(0);
            shortcut('A');
            element('status-song-list').children[0].click();
            events.onStateChange({ data: 0 });
            vi.advanceTimersByTime(300);
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
                videoId: 'bbbbbbbbbbb', startSeconds: 70,
            }));
            expect(player.loadVideoById).toHaveBeenCalledTimes(3);
            vi.advanceTimersByTime(60000);
            expect(player.loadVideoById).toHaveBeenCalledTimes(3);
        });

        it.each([false, true].flatMap(yapMode => [49, 50, 60000].map(delay => ({ yapMode, delay }))))(
            'loads a song picked across an early video ID update (Yap=$yapMode, delay=$delay)',
            async ({ yapMode, delay }) => {
                application.dispose();
                localStorage.setItem('roxy_yapMode', String(yapMode));
                let videoId = 'aaaaaaaaaaa';
                player.getVideoUrl = vi.fn(() => `https://www.youtube.com/watch?v=${videoId}`);
                await start();
                confirmPlayback();
                player.loadVideoById.mockClear();

                element('next-stream').click();
                expect(player.loadVideoById).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
                    videoId: 'bbbbbbbbbbb', startSeconds: 70,
                }));
                player.getPlayerState.mockReturnValue(3);
                events.onStateChange({ data: 3 });
                setTimeout(() => {
                    videoId = 'bbbbbbbbbbb';
                    player.currentTime = 0;
                    events.onStateChange({ data: 0 }); // Stale end, before playback starts.
                }, 50);
                vi.advanceTimersByTime(delay);
                shortcut('A');
                element('status-song-list').children[1].click();
                vi.advanceTimersByTime(300);
                expect(player.loadVideoById).toHaveBeenCalledTimes(2);
                expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
                    videoId: 'bbbbbbbbbbb', startSeconds: 90,
                }));
                expect(player.seekTo).not.toHaveBeenCalled();
                expect(player.playVideo).not.toHaveBeenCalled();

                // Network delay produces no commands. Playback can confirm
                // the replacement when the iframe eventually starts it.
                vi.advanceTimersByTime(60000);
                expect(player.loadVideoById).toHaveBeenCalledTimes(2);
                expect(element('status-text').textContent).toContain('Song D');
                confirmPlayback(90);
                expect(element('status-text').textContent).toContain('Song D');
                player.getPlayerState.mockReturnValue(2);
                shortcut('A');
                element('status-song-list').children[0].click();
                expect(player.seekTo).toHaveBeenCalledExactlyOnceWith(70, true);
                expect(player.playVideo).toHaveBeenCalledOnce();
                expect(player.loadVideoById).toHaveBeenCalledTimes(2);
            },
        );

        it('cycles all loop states and persists them', () => {
            for (const [mode, text] of [[1, 'Track'], [2, 'Stream'], [0, 'None']]) {
                element('loop-btn').click();
                expect(label('loop-btn')).toBe(`Loop: ${text}`);
                expect(element('loop-btn').classList.contains('active')).toBe(mode !== 0);
                expect(localStorage.getItem('roxy_loopMode')).toBe(String(mode));
            }
        });

        it('toggles shuffle on and off with persisted state', () => {
            for (const enabled of [true, false]) {
                element('shuffle-btn').click();
                expect(label('shuffle-btn')).toBe(`Shuffle: ${enabled ? 'On' : 'Off'}`);
                expect(localStorage.getItem('roxy_shuffleMode')).toBe(String(enabled));
            }
        });

        it('debounces rapid Yap toggles and preserves the last valid time', () => {
            confirmPlayback();
            player.currentTime = 15;
            element('yap-btn').click();
            expect(label('yap-btn')).toBe('Yap: On');
            expect(player.seekTo).toHaveBeenLastCalledWith(15, true);
            element('yap-btn').click();
            expect(label('yap-btn')).toBe('Yap: On');
            vi.advanceTimersByTime(300);
            player.currentTime = 0;
            element('yap-btn').click();
            expect(label('yap-btn')).toBe('Yap: Off');
            expect(player.seekTo).toHaveBeenLastCalledWith(15, true);
        });

        it('uses the known whole-video duration when Yap changes after a player error', async () => {
            application.dispose();
            await start([{ videoId: 'CmMimqir5z0', name: 'Imported video' }]);
            events.onStateChange({ data: 1 }); // Learn the whole-video duration.
            for (const enabled of [true, false]) {
                vi.advanceTimersByTime(300);
                events.onError({ data: 150 }); // Next request must load, not just seek.
                element('yap-btn').click();
                expect(label('yap-btn')).toBe(`Yap: ${enabled ? 'On' : 'Off'}`);
                expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
                    videoId: 'CmMimqir5z0', startSeconds: 15, endSeconds: 200,
                }));
            }
        });

        it('next/previous song buttons invoke production navigation', () => {
            confirmPlayback();
            element('next-song').click();
            expect(player.seekTo).toHaveBeenLastCalledWith(30, true);
            player.currentTime = 31;
            element('prev-song').click();
            expect(player.seekTo).toHaveBeenLastCalledWith(10, true);
        });

        it('stream buttons load another video and restore previous navigation', () => {
            vi.advanceTimersByTime(300);
            element('next-stream').click();
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({ videoId: 'bbbbbbbbbbb' }));
            vi.advanceTimersByTime(300);
            element('prev-stream').click();
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({ videoId: 'aaaaaaaaaaa' }));
        });

        it('keeps the latest stream selection when navigation occurs during the load cooldown', () => {
            vi.advanceTimersByTime(100);
            element('next-stream').click();
            vi.advanceTimersByTime(50);
            element('prev-stream').click();
            vi.advanceTimersByTime(1000);
            expect(player.loadVideoById).toHaveBeenCalledTimes(2);
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
                videoId: 'aaaaaaaaaaa', startSeconds: 10,
            }));
            expect(player.seekTo).not.toHaveBeenCalled();
            expect(localStorage.getItem('roxy_videoId')).toBe('aaaaaaaaaaa');
        });

        it.each([0, 1, 2])('ignores the previous video ending during a pending load with loop=%s', loopMode => {
            for (let i = 0; i < loopMode; i++) element('loop-btn').click();
            vi.advanceTimersByTime(100);
            element('next-stream').click();
            events.onStateChange({ data: 0 });
            vi.advanceTimersByTime(200);
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
                videoId: 'bbbbbbbbbbb', startSeconds: 70,
            }));
        });

        it('learns imported video metadata only after its pending load is sent', async () => {
            application.dispose();
            await start([SEGMENTS[0], { videoId: 'CmMimqir5z0' }]);
            vi.advanceTimersByTime(100);
            element('next-stream').click();
            events.onStateChange({ data: 1 }); // Previous video's duration is 200.
            vi.advanceTimersByTime(200);
            player.getDuration.mockReturnValue(480);
            events.onStateChange({ data: 1 });
            vi.advanceTimersByTime(300);
            events.onError({ data: 150 });
            element('yap-btn').click();
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
                videoId: 'CmMimqir5z0', endSeconds: 480,
            }));
        });

        it.each([
            ['replaced', false], ['replaced', true], ['extended', false], ['extended', true],
        ])('initializes metadata after a deferred PLAYING event for a %s import (hidden=%s)', async (mode, hidden) => {
            application.dispose();
            localStorage.setItem('roxy_customSegments', JSON.stringify([{ videoId: 'CmMimqir5z0' }]));
            if (mode === 'replaced') localStorage.setItem('roxy_segmentsMode', mode);
            localStorage.setItem('roxy_videoId', 'CmMimqir5z0');
            vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden);
            player.getVideoUrl = vi.fn(() => 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
            player.getVideoData.mockReturnValue({ title: 'Previous video' });
            await start();
            player.getPlayerState.mockReturnValue(1);
            events.onStateChange({ data: 1 });
            vi.advanceTimersByTime(200);
            expect(player.getDuration).not.toHaveBeenCalled();
            expect(player.getVideoData).not.toHaveBeenCalled();

            player.getVideoUrl.mockReturnValue('https://www.youtube.com/watch?v=CmMimqir5z0');
            player.currentTime = 0;
            player.getDuration.mockReturnValue(480);
            player.getVideoData.mockReturnValue({ title: 'Imported video' });
            vi.advanceTimersByTime(200); // No second PLAYING event.
            player.currentTime = 1.2;
            vi.advanceTimersByTime(1200);
            expect(player.getDuration).toHaveBeenCalledTimes(1);
            expect(player.getVideoData).toHaveBeenCalledTimes(1);
            expect(JSON.parse(localStorage.getItem('roxy_customSegments'))).toEqual([
                { videoId: 'CmMimqir5z0', name: 'Imported video' },
            ]);
            expect(search('Imported video')).toHaveLength(1);
            pressKey('Escape');
            player.currentTime = 1.2;
            vi.advanceTimersByTime(1200);
            expect(player.getDuration).toHaveBeenCalledTimes(1);
            expect(player.getVideoData).toHaveBeenCalledTimes(1);

            events.onError({ data: 150 });
            element('yap-btn').click();
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
                videoId: 'CmMimqir5z0', endSeconds: 480,
            }));
        });

        it('processes ended events after the pending load is confirmed', () => {
            vi.advanceTimersByTime(100);
            element('next-stream').click();
            vi.advanceTimersByTime(200);
            player.getPlayerState.mockReturnValue(1);
            player.currentTime = 70;
            events.onStateChange({ data: 1 });
            player.currentTime = 71.2;
            vi.advanceTimersByTime(1200);
            events.onStateChange({ data: 0 });
            expect(player.seekTo).toHaveBeenLastCalledWith(90, true);
        });

        it('keeps the selected video when a Yap song pick occurs during its load delay', () => {
            element('yap-btn').click();
            vi.advanceTimersByTime(100);
            element('next-stream').click();
            shortcut('A');
            element('status-song-list').children[1].click();
            vi.advanceTimersByTime(200);
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
                videoId: 'bbbbbbbbbbb', startSeconds: 90, endSeconds: 100,
            }));
        });

        it.each([false, true])('advances within the pending stream using its requested time with Yap=%s', yapMode => {
            if (yapMode) element('yap-btn').click();
            vi.advanceTimersByTime(100);
            element('next-stream').click();
            element('next-song').click();
            vi.advanceTimersByTime(200);
            expect(player.loadVideoById).toHaveBeenCalledTimes(2);
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
                videoId: 'bbbbbbbbbbb', startSeconds: 90,
            }));
        });

        it.each([false, true])('moves back within the pending stream using its requested time with Yap=%s', yapMode => {
            if (yapMode) element('yap-btn').click();
            vi.advanceTimersByTime(100);
            element('next-stream').click();
            element('next-song').click();
            element('prev-song').click();
            vi.advanceTimersByTime(200);
            expect(player.loadVideoById).toHaveBeenCalledTimes(2);
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
                videoId: 'bbbbbbbbbbb', startSeconds: 70,
            }));
        });

        it.each([
            [false, false], [false, true], [true, false], [true, true],
        ])('preserves the latest song until the iframe reports the selected stream (member=%s, Yap=%s)', async (memberMode, yapMode) => {
            application.dispose();
            player.loadVideoById.mockClear();
            localStorage.setItem('roxy_memberMode', String(memberMode));
            localStorage.setItem('roxy_yapMode', String(yapMode));
            await start();
            player.getVideoUrl = vi.fn(() => 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
            player.currentTime = 15;
            vi.advanceTimersByTime(300);
            element('next-stream').click();
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({ videoId: 'bbbbbbbbbbb', startSeconds: 70 }));
            player.seekTo.mockClear();
            element('next-song').click();
            expect(player.seekTo).not.toHaveBeenCalled(); // A is still the reported video.
            shortcut('C');
            expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(`${location.origin}/?v=bbbbbbbbbbb&t=90`);
            element('prev-song').click();
            shortcut('C');
            expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(`${location.origin}/?v=bbbbbbbbbbb&t=70`);
            element('next-song').click();
            events.onStateChange({ data: 0 }); // Late ENDED from A cannot advance B.
            vi.advanceTimersByTime(300); // Dispatch the replacement without awaiting PLAYING.
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
                videoId: 'bbbbbbbbbbb', startSeconds: 90,
            }));
            player.getVideoUrl.mockReturnValue('https://www.youtube.com/watch?v=bbbbbbbbbbb');
            player.currentTime = 70; // A delayed sample from B's original load.
            events.onStateChange({ data: 1 });
            expect(player.seekTo).toHaveBeenLastCalledWith(90, true);
            expect(player.loadVideoById).toHaveBeenCalledTimes(3);
        });

        it('continues start confirmation when PLAYING arrives before the selected video ID', () => {
            player.getVideoUrl = vi.fn(() => 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
            vi.advanceTimersByTime(300);
            element('next-stream').click();
            element('next-song').click();
            player.getPlayerState.mockReturnValue(1);
            events.onStateChange({ data: 1 });
            player.getVideoUrl.mockReturnValue('https://www.youtube.com/watch?v=bbbbbbbbbbb');
            player.currentTime = 70;
            vi.advanceTimersByTime(400);
            expect(player.seekTo).toHaveBeenLastCalledWith(90, true);
        });

        it.each([[false, false], [false, true], [true, false], [true, true]])('resumes the requested position after reload (Yap=%s, load sent=%s)', async (yapMode, loadSent) => {
            if (yapMode) element('yap-btn').click();
            player.getVideoUrl = vi.fn(() => 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
            player.currentTime = 95;
            vi.advanceTimersByTime(100);
            element('next-stream').click();
            if (loadSent) vi.advanceTimersByTime(200);
            window.dispatchEvent(new Event('beforeunload'));
            expect(localStorage.getItem('roxy_videoId')).toBe('bbbbbbbbbbb');
            expect(localStorage.getItem('roxy_lastTime')).toBe('70.00');
            application.dispose();
            await start();
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
                videoId: 'bbbbbbbbbbb', startSeconds: 70,
            }));
        });

        it.each(['timer', 'ended'])('restarts Yap Loop Stream through the %s path', method => {
            confirmPlayback();
            player.currentTime = 15;
            element('yap-btn').click();
            element('loop-btn').click();
            element('loop-btn').click();
            confirmPlayback(15);
            player.seekTo.mockClear();
            player.currentTime = 59.9;
            if (method === 'timer') {
                player.getPlayerState.mockReturnValue(1);
                events.onStateChange({ data: 1 });
                vi.advanceTimersByTime(200);
            } else {
                events.onStateChange({ data: 0 });
            }
            expect(player.loadVideoById).toHaveBeenCalledTimes(1);
            expect(player.seekTo).toHaveBeenLastCalledWith(10, true);
        });

        it.each([0, 1, 2])('uses the effective stream end after hidden Yap playback with loop=%s', loopMode => {
            confirmPlayback();
            player.currentTime = 15;
            element('yap-btn').click();
            for (let i = 0; i < loopMode; i++) element('loop-btn').click();
            vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
            confirmPlayback(15);
            player.seekTo.mockClear();
            vi.advanceTimersByTime(1200);
            expect(player.seekTo).not.toHaveBeenCalled();
            player.currentTime = 60;
            events.onStateChange({ data: 0 });
            if (loopMode === 0) {
                expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({ videoId: 'bbbbbbbbbbb', startSeconds: 70 }));
            } else {
                expect(player.seekTo).toHaveBeenLastCalledWith(loopMode === 1 ? 50 : 10, true);
            }
        });

        it('member mode changes the searchable catalogue', () => {
            expect(search('Member song').some(row => row.textContent.includes('Member song'))).toBe(false);
            pressKey('Escape');
            shortcut('M');
            expect(element('controls-container').classList.contains('member-mode')).toBe(true);
            expect(search('Member song').some(row => row.textContent.includes('Member song'))).toBe(true);
        });

        it('saves a native seek to zero after the initial load is confirmed', () => {
            player.currentTime = 10;
            events.onStateChange({ data: 1 });
            vi.advanceTimersByTime(1000);
            player.currentTime = 11;
            events.onStateChange({ data: 1 });
            player.currentTime = 0;
            window.dispatchEvent(new Event('beforeunload'));
            expect(localStorage.getItem('roxy_lastTime')).toBe('0.00');
        });

        it('saves the observed player time before unload', () => {
            confirmPlayback();
            player.currentTime = 17.25;
            window.dispatchEvent(new Event('beforeunload'));
            expect(localStorage.getItem('roxy_videoId')).toBe('aaaaaaaaaaa');
            expect(localStorage.getItem('roxy_lastTime')).toBe('17.25');
        });
    });

    describe('queue and modal coordination', () => {
        it.each([false, true])('keeps Previous Song shuffled after restored history is exhausted with member=%s', async memberMode => {
            application.dispose();
            const savedQueue = [
                { videoId: 'aaaaaaaaaaa', rIdx: 0 },
                { videoId: 'aaaaaaaaaaa', rIdx: 1 },
                { videoId: 'aaaaaaaaaaa', rIdx: 2 },
                { videoId: 'bbbbbbbbbbb', rIdx: 0 },
            ];
            localStorage.setItem('roxy_queue', JSON.stringify(savedQueue));
            localStorage.setItem('roxy_loopMode', '2');
            localStorage.setItem('roxy_shuffleMode', 'true');
            localStorage.setItem('roxy_memberMode', String(memberMode));
            localStorage.setItem('roxy_videoId', 'bbbbbbbbbbb');
            sessionStorage.setItem('roxy_session_history', JSON.stringify([
                { vIdx: 0, rIdx: 0, time: 10 },
                { vIdx: 0, rIdx: 1, time: 30 },
                { vIdx: 0, rIdx: 2, time: 50 },
            ]));
            await start();
            expect(label('loop-btn')).toBe('Loop: Queue');
            expect(label('shuffle-btn')).toBe('Shuffle: On');
            const random = vi.spyOn(Math, 'random').mockReturnValue(0);

            for (const time of [50, 30, 10]) {
                element('prev-song').click();
                vi.advanceTimersByTime(300);
                expect(Number(localStorage.getItem('roxy_lastTime'))).toBe(time);
            }
            expect(random).not.toHaveBeenCalled();

            for (const [index, time] of [30, 50, 70, 10].entries()) {
                element('prev-song').click();
                vi.advanceTimersByTime(300);
                expect(random).toHaveBeenCalledTimes(index + 1);
                expect(Number(localStorage.getItem('roxy_lastTime'))).toBe(time);
                expect(JSON.parse(sessionStorage.getItem('roxy_session_history'))).toEqual([]);
                expect(queue()).toEqual(savedQueue);
            }
        });

        it.each(['queue-cell', 'mobile-queue-btn', 'shortcut'])('opens queue through %s', target => {
            if (target === 'shortcut') shortcut('Q'); else element(target).click();
            expect(isOpen('queue-overlay')).toBe(true);
            expect(element('queue-overlay').inert).toBe(false);
            pressKey('Escape');
            expect(isOpen('queue-overlay')).toBe(false);
        });

        it('typing shortcuts in the queue filter does not trigger global actions', () => {
            shortcut('Q');
            for (const key of ['Q', 'S', 'E', 'A', 'I']) expect(shortcut(key).defaultPrevented).toBe(false);
            expect(isOpen('queue-overlay')).toBe(true);
            expect(queue()).toEqual([]);
            element('queue-search-input').blur();
            shortcut('Q');
            expect(isOpen('queue-overlay')).toBe(false);
        });

        it('enqueues the current song through Shift+E, including duplicates', () => {
            shortcut('E'); shortcut('E'); shortcut('E');
            expect(queue()).toEqual(Array(3).fill({ videoId: 'aaaaaaaaaaa', rIdx: 0 }));
            expect(element('yap-btn').disabled).toBe(true);
            element('loop-btn').click(); element('loop-btn').click();
            expect(label('loop-btn')).toBe('Loop: Queue');
        });

        it('search enqueue buttons add the result without selecting or closing it', () => {
            const row = search('Song B').find(row => row.textContent.includes('Song B'));
            player.seekTo.mockClear();
            row.querySelector('.enqueue-btn').click();
            expect(queue()).toEqual([{ videoId: 'aaaaaaaaaaa', rIdx: 1 }]);
            expect(player.seekTo).not.toHaveBeenCalled();
            expect(isOpen('modal-overlay')).toBe(true);
            expect(row.querySelector('.enqueue-btn').textContent).toBe('✓');
            vi.advanceTimersByTime(500);
            expect(row.querySelector('.enqueue-btn').textContent).toBe('+');
        });

        it('Shift+E enqueues the highlighted search result', () => {
            search('Song B');
            shortcut('E');
            expect(queue()).toEqual([{ videoId: 'aaaaaaaaaaa', rIdx: 1 }]);
        });

        it('status enqueue adds the selected song without playing it', () => {
            shortcut('A');
            element('status-song-list').children[1].querySelector('.enqueue-btn').click();
            expect(queue()).toEqual([{ videoId: 'aaaaaaaaaaa', rIdx: 1 }]);
            expect(isOpen('status-panel')).toBe(true);
        });

        it('Shift+E enqueues the highlighted status song', () => {
            shortcut('A'); pressKey('ArrowDown'); shortcut('E');
            expect(queue()).toEqual([{ videoId: 'aaaaaaaaaaa', rIdx: 1 }]);
        });

        it('selects and removes queue entries using real keyboard handlers', () => {
            shortcut('E');
            shortcut('E');
            shortcut('Q');
            pressKey('ArrowDown'); // Transfers focus from filter to list.
            pressKey('Delete');
            expect(queue().length).toBe(1);
            element('queue-clear-btn').click();
            expect(queue()).toEqual([]);
            expect(element('yap-btn').disabled).toBe(false);
        });

        it('opening another modal closes the existing one', () => {
            shortcut('A'); shortcut('S');
            expect(isOpen('status-panel')).toBe(false);
            shortcut('Q');
            expect(isOpen('modal-overlay')).toBe(false);
            pressKey('Escape'); shortcut('I');
            expect(isOpen('import-overlay')).toBe(true);
            pressKey('Escape');
            expect(isOpen('import-overlay')).toBe(false);
        });
    });

    describe('running messages', () => {
        it.each(['more-cell', 'more-btn'])('restores dismissed messages through %s', async moreButton => {
            application.dispose();
            application = createRadioApplication({
                segmentsData: structuredClone(SEGMENTS),
                messagesData: ['First announcement', 'Second announcement'],
            });
            await vi.advanceTimersByTimeAsync(500);
            await vi.waitFor(() => expect(element('message-bar').hidden).toBe(false));
            expect(element('more-restore-messages-btn').hidden).toBe(true);
            element('message-close').click();
            expect(element('message-bar').hidden).toBe(true);

            element(moreButton).click();
            expect(isOpen('more-overlay')).toBe(true);
            expect(element('more-restore-messages-btn').hidden).toBe(false);
            element('more-restore-messages-btn').click();

            expect(element('message-bar').hidden).toBe(false);
            expect(element('more-restore-messages-btn').hidden).toBe(true);
            expect(localStorage.getItem('roxy_dismissedMessagesHash')).toBeNull();
        });
    });

    describe('queue transfer', () => {
        const encodeItems = items => btoa(JSON.stringify({ type: 'rourin-radio-queue', version: 1, items }));

        async function importQueue(items, mode = 'replace') {
            navigator.clipboard.readText.mockResolvedValue(encodeItems(items));
            if (!isOpen('import-overlay')) shortcut('I');
            element(`import-${mode}-btn`).click();
            await vi.advanceTimersByTimeAsync(0);
        }

        it('disables empty queue export and closes through the Close button', () => {
            shortcut('I');
            expect(element('import-export-queue-btn').disabled).toBe(true);
            element('import-export-queue-btn').click();
            expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
            element('import-close-btn').click();
            expect(isOpen('import-overlay')).toBe(false);
            expect(element('import-overlay').inert).toBe(true);
        });

        it('exports and restores the queue without interrupting playback', async () => {
            const savedQueue = [
                { videoId: 'aaaaaaaaaaa', rIdx: 1 },
                { videoId: 'bbbbbbbbbbb', rIdx: 0 },
                { videoId: 'aaaaaaaaaaa', rIdx: 1 },
            ];
            application.dispose();
            localStorage.setItem('roxy_queue', JSON.stringify(savedQueue));
            await start();
            confirmPlayback();
            shortcut('I');
            expect(element('import-export-queue-btn').disabled).toBe(false);
            element('import-export-queue-btn').click();
            await vi.advanceTimersByTimeAsync(0);
            const exported = navigator.clipboard.writeText.mock.lastCall[0];
            expect(JSON.parse(atob(exported)).items).toEqual([
                { videoId: 'aaaaaaaaaaa', range: [30, 40] },
                { videoId: 'bbbbbbbbbbb', range: [70, 80] },
                { videoId: 'aaaaaaaaaaa', range: [30, 40] },
            ]);
            expect(queue()).toEqual(savedQueue);
            element('import-close-btn').click();
            shortcut('Q');
            element('queue-clear-btn').click();
            shortcut('I');
            navigator.clipboard.readText.mockResolvedValue(exported);
            player.currentTime = 15.25;
            player.loadVideoById.mockClear();
            player.seekTo.mockClear();
            element('import-replace-btn').click();
            await vi.advanceTimersByTimeAsync(0);

            expect(queue()).toEqual(savedQueue);
            expect(player.loadVideoById).not.toHaveBeenCalled();
            expect(player.seekTo).not.toHaveBeenCalled();
            expect(window.confirm).toHaveBeenCalledWith('Replace your current queue with the imported queue?');
            expect(localStorage.getItem('roxy_lastTime')).toBe('15.25');
            expect(localStorage.getItem('roxy_customSegments')).toBeNull();
            expect(element('import-status').textContent).toBe('Imported 3 songs; skipped 0 missing songs');

            application.dispose();
            await start();
            expect(queue()).toEqual(savedQueue);
        });

        it.each(['replace', 'extend'])('%s skips missing songs and preserves imported order and duplicates', async mode => {
            shortcut('E');
            const original = queue();
            await importQueue([
                { videoId: 'aaaaaaaaaaa', range: [30, 40] },
                { videoId: 'missing', range: [10, 20] },
                { videoId: 'aaaaaaaaaaa', range: [10, 21] },
                { videoId: 'aaaaaaaaaaa', range: [30, 40] },
            ], mode);
            const imported = [{ videoId: 'aaaaaaaaaaa', rIdx: 1 }, { videoId: 'aaaaaaaaaaa', rIdx: 1 }];
            expect(queue()).toEqual(mode === 'extend' ? [...original, ...imported] : imported);
            expect(element('import-status').textContent).toBe('Imported 2 songs; skipped 2 missing songs');
            expect(element('import-status').className).toBe('warning');
            expect(localStorage.getItem('roxy_customSegments')).toBeNull();
            if (mode === 'extend') expect(window.confirm).not.toHaveBeenCalled();
        });

        it('keeps the existing queue when no imported songs match', async () => {
            shortcut('E');
            const original = queue();
            await importQueue([{ videoId: 'missing', range: null }]);
            expect(queue()).toEqual(original);
            expect(element('import-status').textContent).toContain('Queue unchanged');
        });

        it('matches against combined default and custom segments without adding sources', async () => {
            const custom = [{ videoId: 'ccccccccccc', name: 'Custom stream', songs: [
                { name: 'Custom song', range: [100, 150] },
            ] }, { videoId: 'ddddddddddd', name: 'Whole video' }];
            application.dispose();
            localStorage.setItem('roxy_customSegments', JSON.stringify(custom));
            await start();
            await importQueue([
                { videoId: 'ccccccccccc', range: [100, 150] },
                { videoId: 'ddddddddddd', range: null },
                { videoId: 'aaaaaaaaaaa', range: [30, 40] },
            ]);
            expect(queue()).toEqual([
                { videoId: 'ccccccccccc', rIdx: 0 },
                { videoId: 'ddddddddddd', rIdx: 0 },
                { videoId: 'aaaaaaaaaaa', rIdx: 1 },
            ]);
            expect(JSON.parse(localStorage.getItem('roxy_customSegments'))).toEqual(custom);
            expect(localStorage.getItem('roxy_segmentsMode')).toBeNull();
        });

        it('does not import built-in songs excluded by a replacement playlist', async () => {
            application.dispose();
            localStorage.setItem('roxy_customSegments', JSON.stringify([{ videoId: 'ccccccccccc' }]));
            localStorage.setItem('roxy_segmentsMode', 'replaced');
            await start();
            await importQueue([
                { videoId: 'aaaaaaaaaaa', range: [10, 20] },
                { videoId: 'ccccccccccc', range: null },
            ]);
            expect(queue()).toEqual([{ videoId: 'ccccccccccc', rIdx: 0 }]);
            expect(localStorage.getItem('roxy_segmentsMode')).toBe('replaced');
            expect(element('import-status').textContent).toBe('Imported 1 song; skipped 1 missing song');
        });

        it.each([
            'not a queue export!',
            btoa(JSON.stringify({ type: 'rourin-radio-queue', version: 99, items: [] })),
            btoa(JSON.stringify({ type: 'rourin-radio-queue', version: 1, items: [{ videoId: 'aaaaaaaaaaa' }] })),
        ])('rejects invalid input without changing the queue or playlist: %s', async text => {
            shortcut('E');
            const original = queue();
            navigator.clipboard.readText.mockResolvedValue(text);
            shortcut('I');
            element('import-replace-btn').click();
            await vi.advanceTimersByTimeAsync(0);
            expect(queue()).toEqual(original);
            expect(localStorage.getItem('roxy_customSegments')).toBeNull();
            expect(element('import-status').className).toBe('error');
            expect(window.confirm).not.toHaveBeenCalled();
        });

        it('reports clipboard export failure and enables retry', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            shortcut('E');
            const original = queue();
            navigator.clipboard.writeText.mockRejectedValueOnce(new Error('Permission denied'));
            shortcut('I');
            element('import-export-queue-btn').click();
            await vi.advanceTimersByTimeAsync(0);
            expect(element('import-status').textContent).toBe('Couldn’t copy queue to clipboard');
            expect(element('import-export-queue-btn').disabled).toBe(false);
            expect(queue()).toEqual(original);
            element('import-export-queue-btn').click();
            await vi.advanceTimersByTimeAsync(0);
            expect(element('import-status').textContent).toBe('Copied 1 queued song');
        });

        it('ignores a pending queue import after disposal', async () => {
            let resolveClipboard;
            navigator.clipboard.readText.mockReturnValue(new Promise(resolve => { resolveClipboard = resolve; }));
            shortcut('I');
            element('import-replace-btn').click();
            application.dispose();
            resolveClipboard(encodeItems([{ videoId: 'aaaaaaaaaaa', range: [10, 20] }]));
            await vi.advanceTimersByTimeAsync(0);
            expect(queue()).toEqual([]);
            expect(vi.getTimerCount()).toBe(0);
        });
    });

    describe('playlist export', () => {
        const custom = [
            { videoId: 'ccccccccccc', name: '日本語 💜', songs: [
                { name: 'Custom song', range: [12.5, 30], theme: 2 },
            ] },
            { videoId: 'ddddddddddd', name: 'Custom member stream', memberOnly: true },
        ];

        async function extendPlaylist(entries = custom) {
            navigator.clipboard.readText.mockResolvedValue(JSON.stringify(entries));
            if (!isOpen('import-overlay')) shortcut('I');
            element('import-extend-btn').click();
            await vi.advanceTimersByTimeAsync(300);
        }

        it('disables export when the playlist contains only built-in streams', () => {
            shortcut('I');
            expect(element('import-export-playlist-btn').disabled).toBe(true);
            element('import-export-playlist-btn').click();
            expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
        });

        it('exports only additions with all their metadata, ready to extend another playlist', async () => {
            await extendPlaylist([{ ...SEGMENTS[0], name: 'Changed built-in title' }, ...custom]);
            shortcut('E');
            const savedQueue = queue();
            const savedCustom = localStorage.getItem('roxy_customSegments');
            player.loadVideoById.mockClear();
            player.seekTo.mockClear();

            element('import-export-playlist-btn').click();
            await vi.advanceTimersByTimeAsync(0);
            const exported = navigator.clipboard.writeText.mock.lastCall[0];
            expect(JSON.parse(exported)).toEqual(custom);
            expect(element('import-status').textContent).toBe('Copied 2 custom streams');
            expect(queue()).toEqual(savedQueue);
            expect(localStorage.getItem('roxy_customSegments')).toBe(savedCustom);
            expect(player.loadVideoById).not.toHaveBeenCalled();
            expect(player.seekTo).not.toHaveBeenCalled();
            expect(window.confirm).not.toHaveBeenCalled();

            element('import-reset-btn').click();
            shortcut('I');
            expect(element('import-export-playlist-btn').disabled).toBe(true);
            navigator.clipboard.readText.mockResolvedValue(exported);
            element('import-extend-btn').click();
            await vi.advanceTimersByTimeAsync(300);
            expect(JSON.parse(localStorage.getItem('roxy_customSegments'))).toEqual(custom);
            expect(element('import-export-playlist-btn').disabled).toBe(false);
            element('import-close-btn').click();
            expect(search('Song B').some(row => row.textContent.includes('Song B'))).toBe(true);
            expect(search('Custom song').some(row => row.textContent.includes('Custom song'))).toBe(true);
        });

        it('prevents concurrent exports and allows retry after clipboard failure', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            await extendPlaylist();
            shortcut('E');
            let rejectWrite;
            navigator.clipboard.writeText.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectWrite = reject; }));
            element('import-export-playlist-btn').click();
            expect(element('import-export-playlist-btn').disabled).toBe(true);
            expect(element('import-export-queue-btn').disabled).toBe(true);
            element('import-export-queue-btn').click();
            expect(navigator.clipboard.writeText).toHaveBeenCalledOnce();
            rejectWrite(new Error('Permission denied'));
            await vi.advanceTimersByTimeAsync(0);
            expect(element('import-status').textContent).toBe('Couldn’t copy playlist to clipboard');
            expect(element('import-export-playlist-btn').disabled).toBe(false);
            expect(element('import-export-queue-btn').disabled).toBe(false);
            element('import-export-playlist-btn').click();
            await vi.advanceTimersByTimeAsync(0);
            expect(JSON.parse(navigator.clipboard.writeText.mock.lastCall[0])).toEqual(custom);
            expect(element('import-status').textContent).toBe('Copied 2 custom streams');
        });

        it('does not update a new application when an old export finishes', async () => {
            await extendPlaylist();
            let resolveWrite;
            navigator.clipboard.writeText.mockImplementationOnce(() => new Promise(resolve => { resolveWrite = resolve; }));
            element('import-export-playlist-btn').click();
            application.dispose();
            await start();
            if (isOpen('import-overlay')) element('import-close-btn').click();
            shortcut('I');
            resolveWrite();
            await vi.advanceTimersByTimeAsync(0);
            expect(element('import-status').textContent).toBe('');
            expect(element('import-export-playlist-btn').disabled).toBe(false);
        });
    });

    describe('sharing and imports', () => {
        it.each([
            { format: 'queue', type: 'queue', text: btoa(JSON.stringify({
                type: 'rourin-radio-queue', version: 1,
                items: [{ videoId: 'aaaaaaaaaaa', range: [30, 40] }],
            })) },
            { format: 'playlist JSON', type: 'playlist', text: JSON.stringify([{ videoId: 'CmMimqir5z0' }]) },
            { format: 'YouTube links', type: 'playlist', text: 'https://youtu.be/CmMimqir5z0' },
        ])('preserves the playlist, queue, and playback when replacing from $format is cancelled', async ({ type, text }) => {
            application.dispose();
            localStorage.setItem('roxy_customSegments', JSON.stringify([{ videoId: 'ccccccccccc' }]));
            await start();
            confirmPlayback();
            shortcut('E');
            const savedCustom = localStorage.getItem('roxy_customSegments');
            const savedMode = localStorage.getItem('roxy_segmentsMode');
            const savedQueue = queue();
            const savedVideo = localStorage.getItem('roxy_videoId');
            player.loadVideoById.mockClear();
            player.seekTo.mockClear();
            window.confirm.mockReturnValue(false);
            navigator.clipboard.readText.mockResolvedValue(text);
            shortcut('I'); element('import-replace-btn').click();
            await vi.advanceTimersByTimeAsync(0);

            expect(window.confirm).toHaveBeenCalledExactlyOnceWith(`Replace your current ${type} with the imported ${type}?`);
            expect(localStorage.getItem('roxy_customSegments')).toBe(savedCustom);
            expect(localStorage.getItem('roxy_segmentsMode')).toBe(savedMode);
            expect(queue()).toEqual(savedQueue);
            expect(localStorage.getItem('roxy_videoId')).toBe(savedVideo);
            expect(player.loadVideoById).not.toHaveBeenCalled();
            expect(player.seekTo).not.toHaveBeenCalled();
            expect(isOpen('import-overlay')).toBe(true);
        });

        it.each(['shortcut', 'more'])('copies the same floored URL through %s', async method => {
            confirmPlayback();
            player.currentTime = 15.99;
            if (method === 'shortcut') shortcut('C');
            else { element('more-cell').click(); element('more-copy-btn').click(); }
            await Promise.resolve();
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${location.origin}/?v=aaaaaaaaaaa&t=15`);
        });

        it('does not share while search has focus', () => {
            search(); shortcut('C');
            expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
        });

        it('extends with a whole-video URL import and resets to defaults', async () => {
            navigator.clipboard.readText.mockResolvedValue('https://youtu.be/CmMimqir5z0');
            shortcut('I'); element('import-extend-btn').click();
            await vi.advanceTimersByTimeAsync(0);
            expect(JSON.parse(localStorage.getItem('roxy_customSegments'))).toEqual([{ videoId: 'CmMimqir5z0' }]);
            shortcut('I'); element('import-reset-btn').click();
            expect(window.confirm).toHaveBeenCalledOnce();
            expect(localStorage.getItem('roxy_customSegments')).toBeNull();
        });

        it('preserves the playlist, queue, and playback when reset is cancelled', async () => {
            navigator.clipboard.readText.mockResolvedValue('https://youtu.be/CmMimqir5z0');
            shortcut('I'); element('import-extend-btn').click();
            await vi.advanceTimersByTimeAsync(300);
            shortcut('E');
            const savedCustom = localStorage.getItem('roxy_customSegments');
            const savedQueue = queue();
            const savedVideo = localStorage.getItem('roxy_videoId');
            player.loadVideoById.mockClear();
            player.seekTo.mockClear();
            window.confirm.mockReturnValue(false);
            element('import-reset-btn').click();

            expect(window.confirm).toHaveBeenCalledOnce();
            expect(localStorage.getItem('roxy_customSegments')).toBe(savedCustom);
            expect(queue()).toEqual(savedQueue);
            expect(localStorage.getItem('roxy_videoId')).toBe(savedVideo);
            expect(player.loadVideoById).not.toHaveBeenCalled();
            expect(player.seekTo).not.toHaveBeenCalled();
            expect(isOpen('import-overlay')).toBe(true);
        });

        it('replaces the playlist from YouTube links', async () => {
            navigator.clipboard.readText.mockResolvedValue('https://youtu.be/CmMimqir5z0');
            shortcut('I'); element('import-replace-btn').click();
            await vi.advanceTimersByTimeAsync(300);
            expect(window.confirm).toHaveBeenCalledWith('Replace your current playlist with the imported playlist?');
            expect(JSON.parse(localStorage.getItem('roxy_customSegments'))).toEqual([{ videoId: 'CmMimqir5z0' }]);
            expect(localStorage.getItem('roxy_segmentsMode')).toBe('replaced');
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({ videoId: 'CmMimqir5z0' }));
        });

        it('replaces the catalogue from JSON and rejects invalid replacements', async () => {
            const imported = [{ videoId: 'CmMimqir5z0', name: 'Imported video' }];
            navigator.clipboard.readText.mockResolvedValue(JSON.stringify(imported));
            shortcut('I'); element('import-replace-btn').click();
            await vi.advanceTimersByTimeAsync(300);
            expect(localStorage.getItem('roxy_segmentsMode')).toBe('replaced');
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({ videoId: 'CmMimqir5z0' }));
            navigator.clipboard.readText.mockResolvedValue('{}');
            shortcut('I'); element('import-replace-btn').click();
            await vi.advanceTimersByTimeAsync(0);
            expect(element('import-status').textContent).toBe('Not a valid segment file');
            expect(JSON.parse(localStorage.getItem('roxy_customSegments'))).toEqual(imported);
        });

        it.each(['replace', 'extend', 'reset'])('clears persisted navigation history after a successful %s', async mode => {
            vi.advanceTimersByTime(300);
            element('next-stream').click();
            vi.advanceTimersByTime(300);
            element('next-stream').click();
            expect(JSON.parse(sessionStorage.getItem('roxy_session_history'))).toHaveLength(2);
            const recent = sessionStorage.getItem('roxy_session_recent');
            const data = mode === 'extend' ? [SEGMENTS[0]] : [{ videoId: 'CmMimqir5z0' }];
            navigator.clipboard.readText.mockResolvedValue(JSON.stringify(data));
            shortcut('I'); element(`import-${mode}-btn`).click();
            await vi.advanceTimersByTimeAsync(300);
            expect(sessionStorage.getItem('roxy_session_history')).toBe('[]');
            expect(sessionStorage.getItem('roxy_session_recent')).toBe(recent);
            if (isOpen('import-overlay')) pressKey('Escape');
            element('prev-stream').click();
            const expectedVideoId = mode === 'replace' ? 'CmMimqir5z0'
                : mode === 'extend' ? 'aaaaaaaaaaa' : 'bbbbbbbbbbb';
            expect(localStorage.getItem('roxy_videoId')).toBe(expectedVideoId);
            element('next-song').click();
            await vi.advanceTimersByTimeAsync(300);
            expect(localStorage.getItem('roxy_videoId')).not.toBe('');
        });

        it('preserves navigation history when a replacement import is rejected', async () => {
            vi.advanceTimersByTime(300);
            element('next-stream').click();
            const savedHistory = sessionStorage.getItem('roxy_session_history');
            navigator.clipboard.readText.mockResolvedValue(JSON.stringify(
                SEGMENTS.map(stream => ({ ...stream, memberOnly: true }))));
            shortcut('I'); element('import-replace-btn').click();
            await vi.advanceTimersByTimeAsync(0);
            expect(element('import-status').textContent).toBe('Import produced an empty playlist');
            expect(sessionStorage.getItem('roxy_session_history')).toBe(savedHistory);
            pressKey('Escape');
            element('prev-stream').click();
            expect(localStorage.getItem('roxy_videoId')).toBe('aaaaaaaaaaa');
        });

        it.each(['replace', 'extend'])('restores the catalogue after a %s import excludes every stream', async mode => {
            shortcut('E');
            const savedQueue = queue();
            const membersOnly = SEGMENTS.map(stream => ({ ...stream, memberOnly: true }));
            navigator.clipboard.readText.mockResolvedValue(JSON.stringify(membersOnly));
            shortcut('I');
            element(`import-${mode}-btn`).click();
            await vi.advanceTimersByTimeAsync(0);
            expect(element('import-status').textContent).toBe(`${mode === 'replace' ? 'Import' : 'Merge'} produced an empty playlist`);
            expect(isOpen('import-overlay')).toBe(true);
            expect(localStorage.getItem('roxy_customSegments')).toBeNull();
            expect(queue()).toEqual(savedQueue);
            pressKey('Escape');
            expect(search('Song B')[0].textContent).toContain('Song B');
        });
    });

    describe('application lifecycle', () => {
        it('resets an open status panel before recreating the application on the same page', async () => {
            const panel = element('status-panel');
            shortcut('A');
            pressKey('ArrowDown');
            expect(isOpen('status-panel')).toBe(true);
            expect(element('status-song-list').children[1].classList.contains('nav-focus')).toBe(true);

            application.dispose();
            expect(isOpen('status-panel')).toBe(false);
            expect(panel.getAttribute('aria-hidden')).toBe('true');
            expect(panel.inert).toBe(true);
            expect(element('status').getAttribute('aria-expanded')).toBe('false');
            expect(panel.querySelector('.nav-focus')).toBeNull();
            expect(vi.getTimerCount()).toBe(0);

            await start();
            expect(element('status-panel')).toBe(panel);
            expect(isOpen('status-panel')).toBe(false);
            confirmPlayback();

            shortcut('A');
            pressKey('ArrowDown');
            pressKey('Enter');
            expect(player.seekTo).toHaveBeenLastCalledWith(30, true);
            expect(isOpen('status-panel')).toBe(false);

            shortcut('A');
            expect(isOpen('status-panel')).toBe(true);
            pressKey('Escape');
            expect(isOpen('status-panel')).toBe(false);

            shortcut('A');
            expect(isOpen('status-panel')).toBe(true);
            document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            expect(isOpen('status-panel')).toBe(false);
        });

        it('removes listeners and timers, allowing a fresh instance on the same page', async () => {
            const initialTimerCount = vi.getTimerCount();
            application.dispose();
            application.dispose();
            expect(player.destroy).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
            shortcut('S');
            expect(isOpen('modal-overlay')).toBe(false);
            await start();
            expect(vi.getTimerCount()).toBe(initialTimerCount);
            shortcut('S');
            expect(isOpen('modal-overlay')).toBe(true);
            element('loop-btn').click();
            expect(localStorage.getItem('roxy_loopMode')).toBe('1');
        });

        it('cancels pending enqueue feedback on disposal', () => {
            search('Song B')[0].querySelector('.enqueue-btn').click();
            application.dispose();
            expect(vi.getTimerCount()).toBe(0);
        });

        it.each(['search', 'status', 'queue'])('removes rendered %s row handlers on disposal', panel => {
            let row;
            if (panel === 'search') row = search('Song B')[0];
            else if (panel === 'status') {
                shortcut('A');
                row = element('status-song-list').children[1];
            } else {
                shortcut('E');
                shortcut('Q');
                row = element('queue-list').querySelector('.queue-item');
            }
            const savedQueue = queue();
            application.dispose();
            row.querySelector('button').click();
            row.click();
            expect(queue()).toEqual(savedQueue);
            expect(player.seekTo).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        });

        it('cancels a touch hold when its search results are replaced', () => {
            vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
            const row = search('Song B')[0];
            row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: 10, clientY: 10 }));
            search('Song C');
            vi.advanceTimersByTime(600);
            expect(row.classList.contains('armed')).toBe(false);
        });

        it('cancels a pending touch hold on disposal', () => {
            vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
            const row = search('Song B')[0];
            row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: 10, clientY: 10 }));
            application.dispose();
            expect(vi.getTimerCount()).toBe(0);
            vi.advanceTimersByTime(600);
            expect(row.classList.contains('armed')).toBe(false);
        });

        it('ignores clipboard results that arrive after disposal', async () => {
            let resolveClipboard;
            navigator.clipboard.readText.mockReturnValue(new Promise(resolve => { resolveClipboard = resolve; }));
            shortcut('I');
            element('import-extend-btn').click();
            application.dispose();
            const loadCount = player.loadVideoById.mock.calls.length;
            resolveClipboard('https://www.youtube.com/watch?v=CmMimqir5z0');
            await vi.advanceTimersByTimeAsync(0);
            expect(localStorage.getItem('roxy_customSegments')).toBeNull();
            expect(player.loadVideoById).toHaveBeenCalledTimes(loadCount);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('does not allow a late iframe callback to restart disposed playback', () => {
            application.dispose();
            player.loadVideoById.mockClear();
            events.onReady();
            events.onStateChange({ data: 1 });
            vi.advanceTimersByTime(20000);
            expect(player.loadVideoById).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        });
    });
});

describe('Search Result Sorting', () => {
  it('moves current stream to the end among exact matches', () => {
    const items = [
      { name: 'Love Song', streamId: 0, streamName: 'Stream A', songId: 0 },
      { name: 'Love Song', streamId: 1, streamName: 'Stream B', songId: 0 },
      { name: 'Love Song', streamId: 2, streamName: 'Stream C', songId: 0 }
    ];

    const sorted = sortSearchResultsByCurrentStream(items, 1);

    expect(sorted).toHaveLength(3);
    expect(sorted[0].streamId).toBe(0);
    expect(sorted[1].streamId).toBe(2);
    expect(sorted[2].streamId).toBe(1); // Current stream (1) is last
  });

  it('treats names with and without parentheses as exact matches', () => {
    const items = [
      { name: 'Love Song (Live)', streamId: 0, streamName: 'Stream A', songId: 0 },
      { name: 'Love Song', streamId: 1, streamName: 'Stream B', songId: 0 },
      { name: 'LOVE SONG', streamId: 2, streamName: 'Stream C', songId: 0 }
    ];

    const sorted = sortSearchResultsByCurrentStream(items, 1);

    expect(sorted).toHaveLength(3);
    // Current stream (1) should be last
    expect(sorted[2].streamId).toBe(1);
    // Other two streams should come first
    expect([sorted[0].streamId, sorted[1].streamId]).toContain(0);
    expect([sorted[0].streamId, sorted[1].streamId]).toContain(2);
  });

  it('preserves order for items without duplicates', () => {
    const items = [
      { name: 'Song A', streamId: 0, streamName: 'Stream A', songId: 0 },
      { name: 'Song B', streamId: 1, streamName: 'Stream B', songId: 0 },
      { name: 'Song C', streamId: 2, streamName: 'Stream C', songId: 0 }
    ];

    const sorted = sortSearchResultsByCurrentStream(items, 1);

    expect(sorted).toHaveLength(3);
    expect(sorted[0].name).toBe('Song A');
    expect(sorted[1].name).toBe('Song B');
    expect(sorted[2].name).toBe('Song C');
  });

  it('handles multiple groups of duplicates correctly', () => {
    const items = [
      { name: 'Love Song', streamId: 0, streamName: 'Stream A', songId: 0 },
      { name: 'Love Song', streamId: 1, streamName: 'Stream B', songId: 1 },
      { name: 'Different Song', streamId: 2, streamName: 'Stream C', songId: 0 },
      { name: 'Different Song', streamId: 1, streamName: 'Stream B', songId: 2 },
      { name: 'Unique Song', streamId: 3, streamName: 'Stream D', songId: 0 }
    ];

    const sorted = sortSearchResultsByCurrentStream(items, 1);

    expect(sorted).toHaveLength(5);
    
    // Find positions of each song
    const loveSongPositions = sorted
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => normalizeSongBaseName(item.name).toLowerCase() === 'love song');
    
    const differentSongPositions = sorted
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => normalizeSongBaseName(item.name).toLowerCase() === 'different song');

    // For "Love Song" group, stream 1 should be last
    const loveSongFromStream1 = loveSongPositions.find(({ item }) => item.streamId === 1);
    const loveSongFromStream0 = loveSongPositions.find(({ item }) => item.streamId === 0);
    expect(loveSongFromStream1.idx).toBeGreaterThan(loveSongFromStream0.idx);

    // For "Different Song" group, stream 1 should be last
    const differentSongFromStream1 = differentSongPositions.find(({ item }) => item.streamId === 1);
    const differentSongFromStream2 = differentSongPositions.find(({ item }) => item.streamId === 2);
    expect(differentSongFromStream1.idx).toBeGreaterThan(differentSongFromStream2.idx);
  });

  it('handles case when current stream has no duplicates in results', () => {
    const items = [
      { name: 'Love Song', streamId: 0, streamName: 'Stream A', songId: 0 },
      { name: 'Love Song', streamId: 2, streamName: 'Stream C', songId: 0 },
      { name: 'Different Song', streamId: 1, streamName: 'Stream B', songId: 0 }
    ];

    const sorted = sortSearchResultsByCurrentStream(items, 1);

    expect(sorted).toHaveLength(3);
    // Different Song from stream 1 should be in its original position (no reordering)
    const differentSongIdx = sorted.findIndex(item => item.name === 'Different Song');
    expect(sorted[differentSongIdx].streamId).toBe(1);
  });

  it('handles Japanese song names with parentheses', () => {
    const items = [
      { name: '終わりなき旅', streamId: 0, streamName: 'Stream A', songId: 0 },
      { name: '終わりなき旅 (生)', streamId: 1, streamName: 'Stream B', songId: 0 },
      { name: '終わりなき旅', streamId: 2, streamName: 'Stream C', songId: 0 }
    ];

    const sorted = sortSearchResultsByCurrentStream(items, 1);

    expect(sorted).toHaveLength(3);
    // Current stream (1) should be last
    expect(sorted[2].streamId).toBe(1);
    expect([sorted[0].streamId, sorted[1].streamId]).toContain(0);
    expect([sorted[0].streamId, sorted[1].streamId]).toContain(2);
  });

  it('handles empty array', () => {
    const sorted = sortSearchResultsByCurrentStream([], 0);
    expect(sorted).toEqual([]);
  });

  it('handles null/undefined input', () => {
    expect(sortSearchResultsByCurrentStream(null, 0)).toBeNull();
    expect(sortSearchResultsByCurrentStream(undefined, 0)).toBeUndefined();
  });

  it('handles single item', () => {
    const items = [
      { name: 'Only Song', streamId: 0, streamName: 'Stream A', songId: 0 }
    ];

    const sorted = sortSearchResultsByCurrentStream(items, 0);

    expect(sorted).toHaveLength(1);
    expect(sorted[0]).toEqual(items[0]);
  });

  it('maintains relative order of non-current streams', () => {
    const items = [
      { name: 'Love Song', streamId: 0, streamName: 'Stream A', songId: 0 },
      { name: 'Love Song', streamId: 2, streamName: 'Stream C', songId: 0 },
      { name: 'Love Song', streamId: 1, streamName: 'Stream B', songId: 0 },
      { name: 'Love Song', streamId: 3, streamName: 'Stream D', songId: 0 }
    ];

    const sorted = sortSearchResultsByCurrentStream(items, 1);

    expect(sorted).toHaveLength(4);
    // Current stream (1) should be last
    expect(sorted[3].streamId).toBe(1);
    // Other streams should maintain their relative order
    expect(sorted[0].streamId).toBe(0);
    expect(sorted[1].streamId).toBe(2);
    expect(sorted[2].streamId).toBe(3);
  });
});

