import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPlaybackController } from './playback.js';

describe('createPlaybackController', () => {
    let ctrl;
    let deps;
    let mockPlayer;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('YT', { PlayerState: { PLAYING: 1 } });
        mockPlayer = {
            seekTo: vi.fn(),
            loadVideoById: vi.fn(),
            getCurrentTime: vi.fn(() => 50),
            getPlayerState: vi.fn(() => 1),
        };

        deps = {
            getPlayer: () => mockPlayer,
            getCurrentStream: () => ({ videoId: 'abc', songs: [{ name: 'S1', range: [10, 60] }] }),
            sanitizeStartTime: vi.fn((time) => time),
            isYapMode: () => false,
            onTick: vi.fn(),
            onSeek: vi.fn(),
            TICK_MS: 200,
            VIDEO_LOAD_DEBOUNCE_MS: 300,
            TITLE_REFRESH_MS: 2000,
        };

        ctrl = createPlaybackController(deps);
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    describe('seekToSafe', () => {
        it('calls onSeek, not onTick', () => {
            ctrl.seekToSafe(30);

            expect(deps.onSeek).toHaveBeenCalledWith(30);
            expect(deps.onTick).not.toHaveBeenCalled();
        });

        it('updates lastKnownTime', () => {
            ctrl.seekToSafe(42);
            expect(ctrl.getLastKnownTime()).toBe(42);
        });

        it('delegates to player.seekTo with sanitized time', () => {
            deps.sanitizeStartTime.mockReturnValue(25);
            ctrl.seekToSafe(25);

            expect(mockPlayer.seekTo).toHaveBeenCalledWith(25, true);
        });
    });

    describe('reconcileStartOnPlaying', () => {
        it('corrects a fresh cross-video load that starts from zero', () => {
            ctrl.playVideoAt({ videoId: 'stream-2' }, 3461);
            mockPlayer.getCurrentTime.mockReturnValue(0);

            ctrl.reconcileStartOnPlaying();

            expect(mockPlayer.seekTo).toHaveBeenCalledTimes(1);
            expect(mockPlayer.seekTo).toHaveBeenCalledWith(3461, true);
        });

        it('does not seek when playback starts within tolerance', () => {
            ctrl.playVideoAt({ videoId: 'stream-2' }, 3461);
            mockPlayer.getCurrentTime.mockReturnValue(3459);

            ctrl.reconcileStartOnPlaying();

            expect(mockPlayer.seekTo).not.toHaveBeenCalled();
        });

        it('does not duplicate a seek for repeated immediate PLAYING events', () => {
            ctrl.playVideoAt({ videoId: 'stream-2' }, 3461);
            mockPlayer.getCurrentTime.mockReturnValue(0);

            ctrl.reconcileStartOnPlaying();
            ctrl.reconcileStartOnPlaying();

            expect(mockPlayer.seekTo).toHaveBeenCalledTimes(1);
            expect(mockPlayer.seekTo).toHaveBeenCalledWith(3461, true);
        });

        it('is disarmed by an explicit seek before playback starts', () => {
            ctrl.playVideoAt({ videoId: 'stream-2' }, 3461);
            ctrl.seekToSafe(120);
            mockPlayer.seekTo.mockClear();
            mockPlayer.getCurrentTime.mockReturnValue(0);

            ctrl.reconcileStartOnPlaying();

            expect(mockPlayer.seekTo).not.toHaveBeenCalled();
        });

        it('corrects a resume load to its saved time', () => {
            const savedTime = 812;
            ctrl.playVideoAt({ videoId: 'stream-2' }, savedTime);
            mockPlayer.getCurrentTime.mockReturnValue(0);

            ctrl.reconcileStartOnPlaying();

            expect(mockPlayer.seekTo).toHaveBeenCalledTimes(1);
            expect(mockPlayer.seekTo).toHaveBeenCalledWith(savedTime, true);
            expect(ctrl.getLastKnownTime()).toBe(savedTime);
        });
    });

    describe('start confirmation across player updates', () => {
        function begin(start = 2428) {
            mockPlayer.getVideoUrl = vi.fn(() => 'https://www.youtube.com/watch?v=8crU8T3mv5Y');
            ctrl.playVideoAt({ videoId: '8crU8T3mv5Y' }, start);
            ctrl.evaluateTickLoop();
        }

        it.each([NaN, 2428])('corrects a later zero after the first PLAYING reports %s', (firstTime) => {
            begin();
            mockPlayer.getCurrentTime.mockReturnValue(firstTime);
            ctrl.reconcileStartOnPlaying();
            mockPlayer.getCurrentTime.mockReturnValue(0);
            vi.advanceTimersByTime(200);

            expect(mockPlayer.seekTo).toHaveBeenCalledWith(2428, true);
            expect(deps.onTick).not.toHaveBeenCalled();
        });

        it('retries an ineffective early seek without seeking on every tick', () => {
            begin();
            mockPlayer.getCurrentTime.mockReturnValue(0);
            ctrl.reconcileStartOnPlaying();
            vi.advanceTimersByTime(800);
            expect(mockPlayer.seekTo).toHaveBeenCalledTimes(1);
            vi.advanceTimersByTime(200);
            expect(mockPlayer.seekTo).toHaveBeenCalledTimes(2);
            expect(deps.onTick).not.toHaveBeenCalled();
        });

        it('waits for the requested video before seeking or forwarding timestamps', () => {
            begin();
            mockPlayer.getVideoUrl.mockReturnValue('https://www.youtube.com/watch?v=CmMimqir5z0');
            mockPlayer.getCurrentTime.mockReturnValue(200);
            ctrl.reconcileStartOnPlaying();
            vi.advanceTimersByTime(400);
            expect(mockPlayer.seekTo).not.toHaveBeenCalled();
            expect(deps.onTick).not.toHaveBeenCalled();

            mockPlayer.getVideoUrl.mockReturnValue('https://www.youtube.com/watch?v=8crU8T3mv5Y');
            mockPlayer.getCurrentTime.mockReturnValue(0);
            vi.advanceTimersByTime(200);
            expect(mockPlayer.seekTo).toHaveBeenCalledWith(2428, true);
        });

        it('does not advance the queue using a stale timestamp beyond the requested start', () => {
            begin();
            mockPlayer.getCurrentTime.mockReturnValue(7000);
            ctrl.reconcileStartOnPlaying();
            vi.advanceTimersByTime(1200);
            expect(deps.onTick).not.toHaveBeenCalled();
            expect(mockPlayer.seekTo).not.toHaveBeenCalled();

            mockPlayer.getCurrentTime.mockReturnValue(0);
            vi.advanceTimersByTime(200);
            expect(mockPlayer.seekTo).toHaveBeenCalledWith(2428, true);
        });

        it('stops retrying while paused and resumes confirmation on PLAYING', () => {
            begin();
            mockPlayer.getCurrentTime.mockReturnValue(0);
            ctrl.reconcileStartOnPlaying();
            mockPlayer.getPlayerState.mockReturnValue(2);
            vi.advanceTimersByTime(2000);
            expect(mockPlayer.seekTo).toHaveBeenCalledTimes(1);

            mockPlayer.getPlayerState.mockReturnValue(1);
            ctrl.reconcileStartOnPlaying();
            ctrl.evaluateTickLoop();
            expect(mockPlayer.seekTo).toHaveBeenCalledTimes(2);
        });

        it('replaces the pending start when a different video is selected', () => {
            begin();
            mockPlayer.getCurrentTime.mockReturnValue(NaN);
            ctrl.reconcileStartOnPlaying();
            vi.advanceTimersByTime(400);
            ctrl.playVideoAt({ videoId: 'CmMimqir5z0' }, 10);
            mockPlayer.getVideoUrl.mockReturnValue('https://www.youtube.com/watch?v=CmMimqir5z0');
            mockPlayer.getCurrentTime.mockReturnValue(0);
            vi.advanceTimersByTime(200);
            expect(mockPlayer.seekTo).toHaveBeenCalledExactlyOnceWith(10, true);
        });

        it('releases correction after sustained progress, preserving later native seeks', () => {
            begin();
            mockPlayer.getCurrentTime.mockReturnValue(2428);
            ctrl.reconcileStartOnPlaying();
            for (let i = 1; i <= 6; i++) {
                mockPlayer.getCurrentTime.mockReturnValue(2428 + i * 0.2);
                vi.advanceTimersByTime(200);
            }
            mockPlayer.getCurrentTime.mockReturnValue(20);
            vi.advanceTimersByTime(200);
            expect(mockPlayer.seekTo).not.toHaveBeenCalled();
            expect(deps.onTick).toHaveBeenLastCalledWith(20);
        });

        it.each(['seek', 'error'])('cancels pending correction on an explicit %s', (action) => {
            begin();
            mockPlayer.getCurrentTime.mockReturnValue(NaN);
            ctrl.reconcileStartOnPlaying();
            if (action === 'seek') ctrl.seekToSafe(50);
            else ctrl.resetLoadedVideoId();
            mockPlayer.seekTo.mockClear();
            mockPlayer.getCurrentTime.mockReturnValue(50);
            vi.advanceTimersByTime(2000);
            expect(mockPlayer.seekTo).not.toHaveBeenCalled();
        });

        it('bounds correction attempts and eventually releases a failing player', () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            begin();
            mockPlayer.getCurrentTime.mockReturnValue(0);
            ctrl.reconcileStartOnPlaying();
            vi.advanceTimersByTime(20000);
            expect(mockPlayer.seekTo).toHaveBeenCalledTimes(3);
            expect(deps.onTick).toHaveBeenLastCalledWith(0);
        });

        it('checks a hidden whole-video resume only until the requested start is confirmed', () => {
            vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
            deps.getCurrentStream = () => ({ videoId: '8crU8T3mv5Y', songs: null });
            ctrl = createPlaybackController(deps);
            begin();
            mockPlayer.getCurrentTime.mockReturnValue(NaN);
            ctrl.reconcileStartOnPlaying();
            mockPlayer.getCurrentTime.mockReturnValue(0);
            vi.advanceTimersByTime(200);
            expect(mockPlayer.seekTo).toHaveBeenCalledWith(2428, true);

            for (let i = 1; i <= 8; i++) {
                mockPlayer.getCurrentTime.mockReturnValue(2428 + i * 0.2);
                vi.advanceTimersByTime(200);
            }
            mockPlayer.getCurrentTime.mockClear();
            vi.advanceTimersByTime(2000);
            expect(mockPlayer.getCurrentTime).not.toHaveBeenCalled();
        });
    });
});
