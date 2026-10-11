import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStorage, setupDOM } from './test-setup.js';

vi.mock('virtual:roxy-segments', () => ({
    default: [
        { videoId: 'aaaaaaaaaaa', songs: [{ name: 'Bundled song', range: [10, 80] }] },
        { videoId: 'mmmmmmmmmmm', memberOnly: true, songs: [{ name: 'Member song', range: [10, 80] }] },
    ],
}));

describe('shared-link startup', () => {
    let player;
    let events;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        setupDOM();
        clearStorage();
        history.replaceState(null, '', '/?v=bbbbbbbbbbb&t=30');
        localStorage.setItem('roxy_videoId', 'aaaaaaaaaaa');
        localStorage.setItem('roxy_lastTime', '42');
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        player = {
            getCurrentTime: () => 0,
            getPlayerState: () => -1,
            loadVideoById: vi.fn(),
        };
        vi.stubGlobal('YT', {
            PlayerState: { PLAYING: 1 },
            Player: function (_element, config) {
                events = config.events;
                return player;
            },
        });
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        delete window.onYouTubeIframeAPIReady;
        history.replaceState(null, '', '/');
        clearStorage();
    });

    it.each(['member', 'replaced'])('starts immediately for a known %s exclusion without fetching', async (exclusion) => {
        history.replaceState(null, '', exclusion === 'member' ? '/?v=mmmmmmmmmmm' : '/?v=aaaaaaaaaaa');
        if (exclusion === 'replaced') {
            localStorage.setItem('roxy_segmentsMode', 'replaced');
            localStorage.setItem('roxy_customSegments', JSON.stringify([
                { videoId: 'ccccccccccc', name: 'Imported song' },
            ]));
        }
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

        await import('./app.js');
        await vi.advanceTimersByTimeAsync(0);
        expect(document.getElementById('status-text').textContent).toMatch(
            exclusion === 'member' ? /members-only/ : /custom playlist/,
        );
        events.onReady();

        expect(fetch).not.toHaveBeenCalled();
        expect(player.loadVideoById).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            videoId: exclusion === 'member' ? 'aaaaaaaaaaa' : 'ccccccccccc',
        }));
        expect(document.getElementById('overlay').style.display).toBe('none');
    });

    it('plays a known members-only link immediately when Member Mode is enabled', async () => {
        history.replaceState(null, '', '/?v=mmmmmmmmmmm&t=30');
        localStorage.setItem('roxy_memberMode', 'true');
        vi.stubGlobal('fetch', vi.fn());

        await import('./app.js');
        await vi.advanceTimersByTimeAsync(0);
        events.onReady();

        expect(fetch).not.toHaveBeenCalled();
        expect(player.loadVideoById).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            videoId: 'mmmmmmmmmmm', startSeconds: 30,
        }));
    });

    it.each(['response', 'body'])('resumes bundled playback when the %s stalls', async (stage) => {
        let requestSignal;
        vi.stubGlobal('fetch', vi.fn((_url, { signal }) => {
            requestSignal = signal;
            const pending = new Promise((_resolve, reject) => {
                signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            });
            return stage === 'response' ? pending : Promise.resolve({ ok: true, json: () => pending });
        }));

        await import('./app.js');
        await vi.advanceTimersByTimeAsync(0);
        events.onReady();
        document.getElementById('start').click();
        await vi.advanceTimersByTimeAsync(4999);
        expect(player.loadVideoById).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);

        expect(player.loadVideoById).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            videoId: 'aaaaaaaaaaa', startSeconds: 42,
        }));
        expect(requestSignal.aborted).toBe(true);
        expect(document.getElementById('overlay').style.display).toBe('none');
    });

    it('uses fresh data received before the timeout and cancels the deadline', async () => {
        let requestSignal;
        vi.stubGlobal('fetch', vi.fn(async (_url, { signal }) => {
            requestSignal = signal;
            return {
                ok: true,
                json: async () => [{ videoId: 'bbbbbbbbbbb', songs: [{ name: 'Shared song', range: [10, 80] }] }],
            };
        }));

        await import('./app.js');
        await vi.advanceTimersByTimeAsync(0);
        events.onReady();

        expect(player.loadVideoById).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            videoId: 'bbbbbbbbbbb', startSeconds: 30,
        }));
        await vi.advanceTimersByTimeAsync(5000);
        expect(requestSignal.aborted).toBe(false);
        expect(player.loadVideoById).toHaveBeenCalledTimes(1);
    });
});
