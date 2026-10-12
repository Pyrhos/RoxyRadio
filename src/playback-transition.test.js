import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlaybackController } from './playback.js';

describe('playback transition confirmation', () => {
    let controller, player, state, onTick;
    const stream = { videoId: 'selected', songs: [{ range: [70, 150] }] };

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('YT', { PlayerState: { PLAYING: 1 } });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        state = { videoId: 'previous', time: 0, status: -1 };
        player = {
            getVideoUrl: () => `https://www.youtube.com/watch?v=${state.videoId}`,
            getCurrentTime: () => state.time,
            getPlayerState: () => state.status,
            loadVideoById: vi.fn(),
            seekTo: vi.fn(),
            playVideo: vi.fn(),
        };
        onTick = vi.fn();
        controller = createPlaybackController({
            getPlayer: () => player,
            getCurrentStream: () => stream,
            sanitizeStartTime: time => time,
            isYapMode: () => false,
            onTick,
            onSeek: vi.fn(),
            TICK_MS: 200,
            VIDEO_LOAD_DEBOUNCE_MS: 300,
            TITLE_REFRESH_MS: 2000,
        });
    });

    afterEach(() => {
        controller.destroy();
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function confirm(videoId, time) {
        state.videoId = videoId;
        state.status = 1;
        state.time = time;
        controller.reconcileStartOnPlaying();
        controller.evaluateTickLoop();
        state.time += 1.2;
        vi.advanceTimersByTime(1200);
    }

    const selections = ['load', 'seek'].flatMap(selection =>
        [-1, 0, 2, 3, 5].flatMap(status =>
            [false, true].flatMap(idBeforeSelection =>
                [50, 300, 60000].map(delay => ({ selection, status, idBeforeSelection, delay })))));

    it.each(selections)('replaces an unconfirmed load: $selection, state=$status, ID before selection=$idBeforeSelection, delay=$delay', ({ selection, status, idBeforeSelection, delay }) => {
        controller.playVideoAt(stream, 70, 150);
        state.status = status;
        vi.advanceTimersByTime(delay);
        if (idBeforeSelection) state.videoId = stream.videoId;

        if (selection === 'load') controller.playVideoAt(stream, 120, 150);
        else controller.seekToSafe(120);
        // The ID can also arrive while the replacement awaits dispatch.
        state.videoId = stream.videoId;
        expect(controller.reconcileStartOnEnded()).toBe(false);
        vi.advanceTimersByTime(300);
        expect(player.loadVideoById).toHaveBeenCalledTimes(2);
        expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
            videoId: stream.videoId, startSeconds: 120, endSeconds: 150,
        }));
        expect(player.seekTo).not.toHaveBeenCalled();
        expect(player.playVideo).not.toHaveBeenCalled();

        vi.advanceTimersByTime(60000);
        expect(player.loadVideoById).toHaveBeenCalledTimes(2);
        expect(controller.getSafeCurrentTime()).toBe(120);
        expect(onTick).not.toHaveBeenCalled();

        confirm(stream.videoId, 120);
        expect(onTick).toHaveBeenLastCalledWith(121.2);
        // A confirmed stream stays seekable when subsequently paused.
        state.status = 2;
        controller.seekToSafe(130);
        expect(player.loadVideoById).toHaveBeenCalledTimes(2);
        expect(player.seekTo).toHaveBeenCalledExactlyOnceWith(130, true);
        expect(player.playVideo).toHaveBeenCalledOnce();
    });

    it('does not treat a matching ID and an optimistic PLAYING sample as confirmation', () => {
        controller.playVideoAt(stream, 70);
        state.videoId = stream.videoId;
        state.status = 1;
        state.time = 70;
        controller.reconcileStartOnPlaying();
        controller.playVideoAt(stream, 120);
        vi.advanceTimersByTime(300);
        expect(player.loadVideoById).toHaveBeenCalledTimes(2);
        expect(player.seekTo).not.toHaveBeenCalled();
    });

    it('does not confirm a load when timestamp correction expires', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        controller.playVideoAt(stream, 70);
        state.videoId = stream.videoId;
        state.status = 1;
        state.time = 7000;
        controller.reconcileStartOnPlaying();
        controller.evaluateTickLoop();
        vi.advanceTimersByTime(20000);
        controller.playVideoAt(stream, 120);
        expect(player.loadVideoById).toHaveBeenCalledTimes(2);
        expect(player.seekTo).not.toHaveBeenCalled();
    });

    it.each([false, true])('returning to a confirmed stream respects whether the other load was sent (sent=%s)', sent => {
        controller.playVideoAt(stream, 70);
        // A short segment can confirm before the load cooldown expires.
        state.videoId = stream.videoId;
        state.status = 1;
        state.time = 70;
        controller.reconcileStartOnPlaying();
        vi.advanceTimersByTime(100);
        state.time = 70.1;
        state.status = 0;
        expect(controller.reconcileStartOnEnded()).toBe(true);
        if (sent) vi.advanceTimersByTime(200);
        controller.playVideoAt({ videoId: 'other' }, 10);
        controller.playVideoAt(stream, 120);
        vi.advanceTimersByTime(300);
        expect(player.loadVideoById).toHaveBeenCalledTimes(sent ? 3 : 1);
        if (sent) {
            expect(player.loadVideoById).toHaveBeenLastCalledWith(expect.objectContaining({
                videoId: stream.videoId, startSeconds: 120,
            }));
            expect(player.seekTo).not.toHaveBeenCalled();
        } else expect(player.seekTo).toHaveBeenCalledExactlyOnceWith(120, true);
    });

    it('invalidates confirmation after a player error', () => {
        controller.playVideoAt(stream, 70);
        confirm(stream.videoId, 70);
        controller.resetLoadedVideoId();
        controller.seekToSafe(120);
        expect(player.loadVideoById).toHaveBeenCalledTimes(2);
        expect(player.seekTo).not.toHaveBeenCalled();
    });
});
