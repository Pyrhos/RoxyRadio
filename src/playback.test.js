import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPlaybackController } from './playback.js';

describe('createPlaybackController', () => {
    let ctrl;
    let deps;
    let mockPlayer;

    beforeEach(() => {
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

        it('fires only once without an intervening load', () => {
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
});
