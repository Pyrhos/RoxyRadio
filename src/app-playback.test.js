import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import segments from 'virtual:roxy-segments';
import { clearStorage, setupDOM } from './test-setup.js';

describe('imported video to shuffled queue segment', () => {
    let application;
    let player;
    let events;
    let videoId;
    let currentTime;
    let playerState;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        setupDOM();
        clearStorage();
        history.replaceState(null, '', '/');
        vi.spyOn(document, 'hasFocus').mockReturnValue(false);
        videoId = 'CmMimqir5z0';
        currentTime = 0;
        playerState = -1;
        player = {
            getCurrentTime: () => currentTime,
            getPlayerState: () => playerState,
            getVideoUrl: () => `https://www.youtube.com/watch?v=${videoId}`,
            getVideoData: () => ({ video_id: videoId, title: 'Imported cover' }),
            getDuration: () => 200.041,
            loadVideoById: vi.fn(),
            seekTo: vi.fn(),
        };
        vi.stubGlobal('YT', {
            PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 },
            Player: function (_element, config) {
                events = config.events;
                return player;
            },
        });
        localStorage.setItem('roxy_customSegments', JSON.stringify([
            { videoId, name: 'Imported video' },
        ]));
        localStorage.setItem('roxy_videoId', videoId);
        localStorage.setItem('roxy_loopMode', '2');
        localStorage.setItem('roxy_shuffleMode', 'true');
    });

    afterEach(() => {
        application?.dispose();
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        delete window.onYouTubeIframeAPIReady;
        clearStorage();
    });

    it.each([false, true])('advances a shuffled loop queue when the end callback is missing (hidden=%s)', async hidden => {
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden);
        const nextStream = segments.find(stream => stream.songs && !stream.memberOnly);
        const queue = [{ videoId, rIdx: 0 }, { videoId: nextStream.videoId, rIdx: 0 }];
        localStorage.setItem('roxy_queue', JSON.stringify(queue));

        ({ application } = await import('./app.js'));
        await vi.advanceTimersByTimeAsync(0);
        events.onReady();
        playerState = 1;
        events.onStateChange({ data: playerState });
        currentTime = 1.2;
        await vi.advanceTimersByTimeAsync(1200);

        // The iframe reaches its end without delivering onStateChange.
        currentTime = 200.041;
        playerState = 0;
        await vi.advanceTimersByTimeAsync(4000);
        expect(player.loadVideoById).toHaveBeenCalledTimes(2);
        const next = player.loadVideoById.mock.lastCall[0];
        expect(next).toEqual(expect.objectContaining({
            videoId: nextStream.videoId, startSeconds: nextStream.songs[0].range[0],
        }));
        expect(JSON.parse(localStorage.getItem('roxy_queue'))).toEqual(queue);

        // A delayed callback and an early ID update must not consume another item.
        events.onStateChange({ data: 0 });
        videoId = next.videoId;
        events.onStateChange({ data: 0 });
        await vi.advanceTimersByTimeAsync(4000);
        expect(player.loadVideoById).toHaveBeenCalledTimes(2);
        expect(player.seekTo).not.toHaveBeenCalled();
    });

    it('rechecks an end callback received before the final playback time', async () => {
        const next = segments.find(stream => stream.songs && !stream.memberOnly);
        localStorage.setItem('roxy_queue', JSON.stringify([
            { videoId, rIdx: 0 }, { videoId: next.videoId, rIdx: 0 },
        ]));
        localStorage.setItem('roxy_lastTime', '199.9');
        ({ application } = await import('./app.js'));
        await vi.advanceTimersByTimeAsync(0);
        events.onReady();
        currentTime = 199.9;
        playerState = 1;
        events.onStateChange({ data: 1 });
        await vi.advanceTimersByTimeAsync(100);
        playerState = 0;
        events.onStateChange({ data: 0 });
        expect(player.loadVideoById).toHaveBeenCalledTimes(1);

        currentTime = 200.041;
        await vi.advanceTimersByTimeAsync(4000);
        expect(player.loadVideoById).toHaveBeenCalledTimes(2);
        expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({ videoId: next.videoId }));
    });

    it.each([
        { hidden: false, memberMode: false },
        { hidden: true, memberMode: false },
        { hidden: false, memberMode: true },
        { hidden: true, memberMode: true },
    ])('confirms the queued timestamp after an optimistic reading and ignored seek (hidden=$hidden, memberMode=$memberMode)', async ({ hidden, memberMode }) => {
        if (memberMode) localStorage.setItem('roxy_memberMode', 'true');
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden);
        const target = segments.find(stream => stream.videoId === '8crU8T3mv5Y');
        expect(!!target.memberOnly).toBe(false);
        const rIdx = target.songs.findIndex(song => song.range[0] === 2428);
        expect(rIdx).toBeGreaterThanOrEqual(0);
        const queue = [{ videoId, rIdx: 0 }, { videoId: target.videoId, rIdx }];
        localStorage.setItem('roxy_queue', JSON.stringify(queue));

        ({ application } = await import('./app.js'));
        await vi.advanceTimersByTimeAsync(0);
        expect(document.getElementById('controls-container').classList.contains('member-mode')).toBe(memberMode);
        events.onReady();
        expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
            videoId: 'CmMimqir5z0', startSeconds: 0,
        }));
        playerState = 1;
        events.onStateChange({ data: playerState });
        currentTime = 1.2;
        await vi.advanceTimersByTimeAsync(1200);

        currentTime = 200.041;
        playerState = 0;
        events.onStateChange({ data: playerState });
        expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
            videoId: target.videoId, startSeconds: 2428,
        }));

        // The first reported time reflects the request; actual playback then starts at zero.
        videoId = target.videoId;
        currentTime = 2428;
        playerState = 1;
        events.onStateChange({ data: playerState });
        currentTime = 0;
        await vi.advanceTimersByTimeAsync(200);
        expect(player.seekTo).toHaveBeenCalledExactlyOnceWith(2428, true);

        // The iframe ignores that first seek while the media transition settles.
        currentTime = 1;
        await vi.advanceTimersByTimeAsync(1000);
        expect(player.seekTo).toHaveBeenCalledTimes(2);
        for (let i = 0; i < 8; i++) {
            currentTime = 2428 + i * 0.2;
            await vi.advanceTimersByTimeAsync(200);
        }
        expect(document.getElementById('status-text').textContent).toContain(target.songs[rIdx].name);
        expect(JSON.parse(localStorage.getItem('roxy_queue'))).toEqual(queue);
        expect(player.loadVideoById).toHaveBeenCalledTimes(2);

        // Once settled, a native seek into the intro must remain under user control.
        currentTime = 7;
        await vi.advanceTimersByTimeAsync(2000);
        expect(player.seekTo).toHaveBeenCalledTimes(2);
    });
});
