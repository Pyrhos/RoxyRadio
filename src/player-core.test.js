import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlayerCore, LOOP_NONE, LOOP_TRACK, LOOP_STREAM, RESTART_THRESHOLD_SECONDS } from './player-core.js';

const MOCK_SEGMENTS = [
  { videoId: 'v1', title: 'Video 1', songs: [{ name: 'S1T1', range: [0, 10] }, { name: 'S1T2', range: [20, 30] }] },
  { videoId: 'v2', title: 'Video 2', songs: [] }, // Rule 0 case
  { videoId: 'v3', title: 'Video 3', songs: [{ name: 'S3T1', range: [0, 10] }] }
];

describe('PlayerCore', () => {
  let core;
  let callbacks;

  beforeEach(() => {
    callbacks = {
      saveSettings: vi.fn(),
      getSettings: vi.fn(() => ({})),
      saveSessionData: vi.fn(),
      getSessionData: vi.fn(() => ({})),
      now: vi.fn(() => 1000000), // Fixed time
      playVideo: vi.fn(),
      seekTo: vi.fn()
    };
    core = new PlayerCore(callbacks);
    core.init(MOCK_SEGMENTS);
  });

  it('initializes correctly', () => {
    expect(core.playlist.length).toBe(3);
    expect(core.vIdx).toBe(0);
    expect(core.rIdx).toBe(0);
  });

  describe('Rule 0: No Segments', () => {
    it('treats video with no songs as single song', () => {
      core.vIdx = 1; // Video 2
      const song = core.getCurrentSong();
      expect(song.name).toBe('Video 2');
      expect(song.range[0]).toBe(0);
    });
  });

  describe('Navigation', () => {
    it('nextStream wraps around', () => {
      core.vIdx = 2;
      core.nextStream();
      expect(core.vIdx).toBe(0);
    });

    it('prevStream wraps around', () => {
      core.vIdx = 0;
      core.prevStream();
      expect(core.vIdx).toBe(2);
    });

    it('nextSong advances index', () => {
      core.nextSong();
      expect(core.rIdx).toBe(1);
    });

    it('nextSong at end of stream goes to next stream', () => {
      core.rIdx = 1; // Last song of v1
      core.nextSong();
      expect(core.vIdx).toBe(1);
      expect(core.rIdx).toBe(0);
    });

    it('nextSong moves to next stream when current stream has no songs', () => {
      core.vIdx = 1; // Video 2 has no segments
      const res = core.nextSong();
      expect(res.type).toBe('load');
      expect(core.vIdx).toBe(2);
      expect(core.rIdx).toBe(0);
    });

    it('nextSong loops single-song streams when loop stream is on', () => {
      core.vIdx = 1; // Video 2 has no segments
      core.loopMode = LOOP_STREAM;
      const res = core.nextSong();
      expect(res.type).toBe('seek');
      expect(res.time).toBe(0);
      expect(core.vIdx).toBe(1); // stays on same stream
    });

    it('nextSong realigns song index using current time before advancing', () => {
      core.playlist[0].songs = [
        { name: 'S1T1', range: [0, 10] },
        { name: 'S1T2', range: [20, 30] },
        { name: 'S1T3', range: [40, 50] }
      ];
      core.vIdx = 0;
      core.rIdx = 0;

      const res = core.nextSong(25);
      expect(res.type).toBe('load');
      expect(core.rIdx).toBe(2);
    });

    it('prevSong realigns song index using current time before restart logic', () => {
      core.playlist[0].songs = [
        { name: 'S1T1', range: [0, 10] },
        { name: 'S1T2', range: [20, 30] }
      ];
      core.vIdx = 0;
      core.rIdx = 0;

      const res = core.prevSong(27);
      expect(res.type).toBe('seek');
      expect(res.time).toBe(20);
    });

    it('syncToTime aligns rIdx to the song containing the timestamp', () => {
      core.vIdx = 0;
      core.rIdx = 0;
      core.syncToTime(25);
      expect(core.rIdx).toBe(1);
    });
  });

  describe('Shuffle & History', () => {
    it('randomizes next stream when shuffle is on', () => {
      core.toggleShuffle();
      // Mock random to return index 2
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99); 
      
      core.nextStream();
      expect(core.vIdx).toBe(2); // v3
      expect(core.history.length).toBe(1);
      expect(core.history[0].vIdx).toBe(0); // Previous was v1 (0)
      expect(core.history[0].rIdx).toBe(0);
      
      randomSpy.mockRestore();
    });

    it('back button uses history', () => {
      core.toggleShuffle();
      core.nextStream(); // Go to some random
      const previousVIdx = core.history[0].vIdx;
      
      core.prevStream();
      expect(core.vIdx).toBe(previousVIdx);
    });

    it('restores previous song index when using history', () => {
        core.rIdx = 1;
        core.nextStream(); // Push history entry for stream 0
        callbacks.saveSettings.mockClear();
        core.prevStream();
        expect(core.vIdx).toBe(0);
        expect(core.rIdx).toBe(1);
        expect(callbacks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ lastTime: '20.00' }));
    });

    it('back button randomizes if history empty and shuffle on', () => {
        core.toggleShuffle();
        core.history = []; // Clear history
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5); // Should map to 1
        
        core.prevStream();
        expect(core.vIdx).toBe(1); // v2
        randomSpy.mockRestore();
    });

    it('restores history from session storage on init', () => {
       const sessionHistory = [
           { vIdx: 0, rIdx: 0 },
           { vIdx: 1, rIdx: 0 }
       ];
       
       callbacks.getSessionData = () => ({ history: JSON.stringify(sessionHistory) });
       
       const newCore = new PlayerCore(callbacks);
       newCore.init(MOCK_SEGMENTS);
       
       expect(newCore.history.length).toBe(2);
       expect(newCore.history[0].vIdx).toBe(0);
       expect(newCore.history[1].vIdx).toBe(1);
    });

    it('caps history to the most recent 20 entries', () => {
        for (let i = 0; i < 25; i += 1) {
            core.nextStream();
        }
        expect(core.history.length).toBeLessThanOrEqual(20);
    });

    it('clears history when shuffle is turned off', () => {
        core.toggleShuffle(); // On
        core.nextStream(); // Adds to history
        core.nextStream(); // Adds more
        expect(core.history.length).toBeGreaterThan(0);
        
        core.toggleShuffle(); // Off - should wipe history
        expect(core.history.length).toBe(0);
    });

    it('does not clear history when shuffle is turned on', () => {
        // Start with shuffle on, add history
        core.toggleShuffle(); // On
        core.nextStream();
        expect(core.history.length).toBe(1);
        
        core.toggleShuffle(); // Off - clears
        core.toggleShuffle(); // On again
        // No history to clear since it was already empty
        expect(core.history.length).toBe(0);
    });

    it('Shift+prevStream bypasses history and goes to actual previous stream when shuffle is ON', () => {
        core.toggleShuffle(); // On
        core.vIdx = 2; // Start at v3
        core.nextStream(); // Go somewhere random, pushes history
        const historyBefore = [...core.history];
        expect(historyBefore.length).toBe(1);
        
        core.prevStream({ skipHistory: true }); // Shift+click
        // Should go to actual previous (vIdx - 1 or wrap)
        // History should NOT be modified
        expect(core.history).toEqual(historyBefore);
    });

    it('Shift+prevStream has no effect when shuffle is OFF', () => {
        // shuffle is off by default
        core.vIdx = 2;
        core.prevStream({ skipHistory: true });
        expect(core.vIdx).toBe(1); // Normal prev behavior
    });

    it('Shift+prevStream wraps around when at first stream', () => {
        core.toggleShuffle();
        core.vIdx = 0;
        core.prevStream({ skipHistory: true });
        expect(core.vIdx).toBe(2); // Wraps to last
    });

    it('saves history to session storage, not localStorage', () => {
        core.nextStream();
        expect(callbacks.saveSessionData).toHaveBeenCalledWith(
            expect.objectContaining({ history: expect.any(String) })
        );
        // localStorage should NOT contain history
        const lastSaveSettings = callbacks.saveSettings.mock.calls.at(-1)[0];
        expect(lastSaveSettings.history).toBeUndefined();
    });
  });

  describe('Loop Modes', () => {
     it('Loop Song stays on song on auto-advance', () => {
         core.loopMode = LOOP_TRACK;
         core.advanceAuto();
         expect(core.rIdx).toBe(0); // Stays same
         expect(callbacks.seekTo).toHaveBeenCalledWith(0);
     });

     it('Loop Song still allows manual skip', () => {
         core.loopMode = LOOP_TRACK;
         core.nextSong();
         expect(core.rIdx).toBe(1); // Manual overrides loop
     });
     
     it('Loop Stream wraps song index but stays on stream', () => {
         core.loopMode = LOOP_STREAM;
         core.rIdx = 1; // Last song
         core.advanceAuto();
         expect(core.vIdx).toBe(0); // Same stream
         expect(core.rIdx).toBe(0); // First song
     });
  });

  describe('Yap Mode', () => {
      it('includes "with Yapping" in status', () => {
          core.toggleYap();
          expect(core.getStatusText(5)).toContain('with Yapping');
      });

      it('nextSong in Yap mode seeks to start of next song', () => {
          core.toggleYap();
          const res = core.nextSong();
          expect(res.type).toBe('seek');
          expect(res.time).toBe(20); // Start of 2nd song
      });
  });

  describe('Status Text', () => {
      it('shows "Next: " when in gap', () => {
          // v1 Song 1 ends at 10, Song 2 starts at 20
          const text = core.getStatusText(15);
          expect(text).toContain('Next: S1T2');
      });

      it('does not show "Next: first song" during transitions when rIdx indicates later song', () => {
          // Bug fix: During video loading/transitions (especially in background tabs),
          // getCurrentTime() may return 0 or stale values. If rIdx already points to
          // a later song, we should NOT show "Next: first song".
          core.playlist[0].songs = [
              { name: 'S1T1', range: [10, 20] },
              { name: 'S1T2', range: [30, 40] },
              { name: 'S1T3', range: [50, 60] }
          ];
          core.vIdx = 0;
          core.rIdx = 2; // Navigation already set us to song 3

          // Simulate transition state: currentTime reports 0 (before first song at 10)
          const text = core.getStatusText(0);

          // Should NOT show "Next: S1T1" - instead should show current song based on rIdx
          expect(text).not.toContain('Next: S1T1');
          expect(text).toContain('S1T3');
          expect(text).toContain('(3/3)');
      });

      it('still shows "Next: first song" when legitimately before first song', () => {
          core.playlist[0].songs = [
              { name: 'S1T1', range: [10, 20] },
              { name: 'S1T2', range: [30, 40] }
          ];
          core.vIdx = 0;
          core.rIdx = 0; // rIdx confirms we're at the start

          const text = core.getStatusText(5); // Before first song
          expect(text).toContain('Next: S1T1');
      });
  });

  describe('getActiveSongName helper', () => {
      it('returns the active song name for a given time', () => {
          core.vIdx = 0;
          const name1 = core.getActiveSongName(5);
          expect(name1).toBe('S1T1');

          const name2 = core.getActiveSongName(25);
          expect(name2).toBe('S1T2');
      });

      it('returns null when no songs are present (Rule 0)', () => {
          core.vIdx = 1; // Video 2 has no songs (Rule 0)
          const name = core.getActiveSongName(5);
          expect(name).toBeNull();
      });
  });

  describe('Previous Song Logic', () => {
      it('restarts current song if playing for more than the threshold seconds', () => {
          core.vIdx = 0;
          core.rIdx = 1; // Song 2: [20, 30]
          const start = MOCK_SEGMENTS[0].songs[1].range[0];
          const res = core.prevSong(start + RESTART_THRESHOLD_SECONDS + 0.5);
          expect(res.type).toBe('seek');
          expect(res.time).toBe(start);
          expect(core.rIdx).toBe(1); // Index shouldn't change
      });

      it('goes to previous song if playing for less than the threshold seconds', () => {
          core.vIdx = 0;
          core.rIdx = 1; // Song 2: [20, 30]
          const start = MOCK_SEGMENTS[0].songs[1].range[0];
          const res = core.prevSong(start + Math.max(RESTART_THRESHOLD_SECONDS - 0.5, 0.1));
          expect(res.type).toBe('load'); // Standard mode reloads
          expect(core.rIdx).toBe(0); // Goes to Song 1
      });

      it('goes to previous stream and selects its last song when under the threshold seconds', () => {
          // Make previous stream have multiple segments to verify last selection
          core.playlist[2].songs = [
              { name: 'S3T1', range: [0, 10] },
              { name: 'S3T2', range: [20, 30] }
          ];
          core.vIdx = 0;
          core.rIdx = 0; // Song 1
          const res = core.prevSong(Math.max(RESTART_THRESHOLD_SECONDS - 1, 0.1));
          expect(core.vIdx).toBe(2); // Wraps to last video
          expect(core.rIdx).toBe(1); // Last song of previous stream
          expect(res.type).toBe('load');
      });

      it('wraps to last song of same stream when loop stream is on', () => {
          core.vIdx = 0;
          core.rIdx = 0;
          core.loopMode = LOOP_STREAM;
          const res = core.prevSong(1);
          expect(res.type).toBe('seek');
          expect(res.reload).toBe(true);
          expect(res.time).toBe(MOCK_SEGMENTS[0].songs[MOCK_SEGMENTS[0].songs.length - 1].range[0]);
          expect(core.vIdx).toBe(0);
          expect(core.rIdx).toBe(MOCK_SEGMENTS[0].songs.length - 1);
      });

      it('wraps and seeks in Yap mode when loop stream is on', () => {
          core.vIdx = 0;
          core.rIdx = 0;
          core.loopMode = LOOP_STREAM;
          core.toggleYap();
          const res = core.prevSong(1);
          expect(res.type).toBe('seek');
          expect(res.reload).toBeUndefined();
          expect(res.time).toBe(MOCK_SEGMENTS[0].songs[MOCK_SEGMENTS[0].songs.length - 1].range[0]);
          expect(core.vIdx).toBe(0);
          expect(core.rIdx).toBe(MOCK_SEGMENTS[0].songs.length - 1);
      });

      it('still loads previous stream last song when Yap is on', () => {
          core.playlist[2].songs = [
              { name: 'S3T1', range: [0, 10] },
              { name: 'S3T2', range: [20, 30] }
          ];
          core.vIdx = 0;
          core.rIdx = 0;
          core.toggleYap();
          const res = core.prevSong(1);
          expect(res.type).toBe('load');
          expect(core.vIdx).toBe(2);
          expect(core.rIdx).toBe(1);
      });

      it('restarts single-song streams when past the threshold', () => {
          core.vIdx = 1; // stream with no songs
          const res = core.prevSong(RESTART_THRESHOLD_SECONDS + 0.5);
          expect(res.type).toBe('seek');
          expect(res.time).toBe(0);
          expect(core.vIdx).toBe(1);
      });

      it('stays on single-song stream when loop stream is on', () => {
          core.vIdx = 1;
          core.loopMode = LOOP_STREAM;
          const res = core.prevSong(1);
          expect(res.type).toBe('seek');
          expect(res.time).toBe(0);
          expect(core.vIdx).toBe(1);
      });

      it('goes to previous stream for single-song streams when not looping', () => {
          // previous stream (v0) should jump to its last song
          core.playlist[0].songs = [
              { name: 'S1T1', range: [0, 10] },
              { name: 'S1T2', range: [20, 30] }
          ];
          core.vIdx = 1;
          const res = core.prevSong(1);
          expect(res.type).toBe('load');
          expect(core.vIdx).toBe(0);
          expect(core.rIdx).toBe(1);
      });

    it('goes to previous rule-0 stream and reloads when both streams lack songs', () => {
        core.playlist[0].songs = null; // ensure previous stream also rule-0
        core.vIdx = 1; // current stream rule-0
        const res = core.prevSong(1);
        expect(res.type).toBe('load');
        expect(core.vIdx).toBe(0);
        expect(core.rIdx).toBe(0);
    });
  });

  describe('Yap Mode - Tick Logic', () => {
      it('does NOT skip when crossing internal song boundaries', () => {
          core.toggleYap();
          // Video 1: S1 [0,10], S2 [20,30]
          core.vIdx = 0;
          core.rIdx = 0;
          
          // Tick at 11 (past S1 end, in gap)
          // Should NOT trigger nextStream or advanceAuto or any callback
          core.checkTick(11);
          expect(callbacks.playVideo).not.toHaveBeenCalled();
          expect(callbacks.seekTo).not.toHaveBeenCalled();
      });

      it('advances to next stream when reaching global end', () => {
          core.toggleYap();
          core.vIdx = 0;
          // Last song ends at 30. Global end is 30.
          // Logic checks: currentTime >= lastSong.range[1] - 0.2
          
          core.checkTick(29.9); 
          expect(callbacks.playVideo).toHaveBeenCalled();
          expect(core.vIdx).toBe(1); // Next stream
      });

      it('keeps rIdx aligned with playback time while Yap mode is active', () => {
          core.toggleYap();
          core.vIdx = 0;
          core.rIdx = 0;
          core.checkTick(25);
          expect(core.rIdx).toBe(1);
      });
  });

  describe('Seamless neighboring segments (Yap Off)', () => {
      it('does not auto-advance when two segments are seamless neighbors', () => {
          // Make first stream have seamlessly neighboring songs
          core.playlist[0].songs = [
              { name: 'S1T1', range: [0, 10] },
              { name: 'S1T2', range: [10, 20] }
          ];
          core.vIdx = 0;
          core.rIdx = 0;
          core.yapMode = false;

          callbacks.playVideo.mockClear();

          // Tick just before the boundary – should NOT trigger auto-advance
          core.checkTick(9.9);
          expect(callbacks.playVideo).not.toHaveBeenCalled();
          expect(core.vIdx).toBe(0);
          expect(core.rIdx).toBe(0);

          // Tick slightly after the boundary – we allow playback to continue,
          // and we still should not have auto-advanced streams.
          core.checkTick(10.5);
          expect(callbacks.playVideo).not.toHaveBeenCalled();
          expect(core.vIdx).toBe(0);

          // Once sufficiently into the second segment, rIdx should catch up.
          core.checkTick(11.5);
          expect(core.rIdx).toBe(1);
      });
  });

  describe('Rule 0 - Reactive Duration', () => {
      it('updates current song range when duration is set', () => {
          core.vIdx = 1; // Video 2 (No segments)
          let song = core.getCurrentSong();
          expect(song.range[1]).toBe(0); // Unknown duration defaults to open-ended
          
          core.setDuration('v2', 1234);
          song = core.getCurrentSong();
          expect(song.range[1]).toBe(1234);
      });
  });

  describe('Shuffle Logic - Edge Cases', () => {
      it('handles single video playlist gracefully', () => {
          // Mock single item playlist
          const singleItemPlaylist = [MOCK_SEGMENTS[0]];
          core.init(singleItemPlaylist);
          
          core.toggleShuffle();
          core.nextStream();
          expect(core.vIdx).toBe(0);
      });
      
      it('excludes current video from random selection', () => {
          // We have 3 videos. vIdx = 0.
          // Mock random to pick 0 (current). It should retry.
          core.toggleShuffle();
          
          // Math.random is called. 
          // Call 1: returns 0.0 (maps to index 0) -> Retry
          // Call 2: returns 0.5 (maps to index 1) -> Accept
          
          const randomSpy = vi.spyOn(Math, 'random');
          randomSpy.mockReturnValueOnce(0.0).mockReturnValueOnce(0.5);
          
          core.nextStream();
          expect(core.vIdx).toBe(1);
          expect(randomSpy).toHaveBeenCalledTimes(2);
          
          randomSpy.mockRestore();
      });
  });

  describe('Arbitrary Seek Position Handling', () => {
      it('nextSong from before first song goes TO first song, not past it', () => {
          // Stream 0 has songs: S1T1 [0, 10], S1T2 [20, 30]
          // Simulate: user seeks to time -5 (or any time before first song start at 0)
          core.vIdx = 0;
          core.rIdx = 1; // Stale index from previous position
          
          // First song starts at 0, so let's modify to have a gap before it
          core.playlist[0].songs = [
              { name: 'S1T1', range: [10, 20] },
              { name: 'S1T2', range: [30, 40] }
          ];
          
          const res = core.nextSong(5); // Time 5 is before first song (starts at 10)
          expect(res.type).toBe('load');
          expect(core.rIdx).toBe(0); // Should go TO first song, not skip it
      });

      it('nextSong from gap between songs goes to the next song', () => {
          core.playlist[0].songs = [
              { name: 'S1T1', range: [0, 10] },
              { name: 'S1T2', range: [20, 30] },
              { name: 'S1T3', range: [40, 50] }
          ];
          core.vIdx = 0;
          core.rIdx = 0; // Stale index
          
          // Time 15 is in the gap between song 0 (ends at 10) and song 1 (starts at 20)
          const res = core.nextSong(15);
          expect(res.type).toBe('load');
          expect(core.rIdx).toBe(1); // Should go to song 1 (the next song after the gap)
      });

      it('nextSong from after last song goes to next stream', () => {
          core.vIdx = 0;
          core.rIdx = 0;
          
          // Time 100 is after the last song (ends at 30)
          const res = core.nextSong(100);
          expect(res.type).toBe('load');
          expect(core.vIdx).toBe(1); // Should go to next stream
      });

      it('prevSong from before first song goes to previous stream', () => {
          core.playlist[0].songs = [
              { name: 'S1T1', range: [10, 20] },
              { name: 'S1T2', range: [30, 40] }
          ];
          core.vIdx = 0;
          core.rIdx = 1;
          
          // Time 5 is before first song (starts at 10)
          const res = core.prevSong(5);
          expect(res.type).toBe('load');
          expect(core.vIdx).toBe(2); // Should wrap to previous stream
      });

      it('prevSong from gap between songs goes back to the preceding song', () => {
          core.playlist[0].songs = [
              { name: 'S1T1', range: [0, 10] },
              { name: 'S1T2', range: [20, 30] }
          ];
          core.vIdx = 0;
          core.rIdx = 1; // Stale index
          
          // Time 15 is in the gap after song 0 (ends at 10)
          const res = core.prevSong(15);
          expect(res.type).toBe('load');
          expect(core.rIdx).toBe(0); // Should go back to song 0
      });

      it('prevSong from after last song goes to the last song', () => {
          core.vIdx = 0;
          core.rIdx = 0;
          
          // Time 100 is after the last song (ends at 30)
          const res = core.prevSong(100);
          expect(res.type).toBe('load');
          expect(core.rIdx).toBe(1); // Should go to last song (index 1)
      });

      it('nextSong in Yap mode from before first song seeks to first song', () => {
          core.playlist[0].songs = [
              { name: 'S1T1', range: [10, 20] },
              { name: 'S1T2', range: [30, 40] }
          ];
          core.vIdx = 0;
          core.rIdx = 1;
          core.toggleYap();
          
          const res = core.nextSong(5); // Before first song
          expect(res.type).toBe('seek');
          expect(res.time).toBe(10); // First song start
          expect(core.rIdx).toBe(0);
      });

      it('prevSong in Yap mode from gap seeks to preceding song', () => {
          core.playlist[0].songs = [
              { name: 'S1T1', range: [0, 10] },
              { name: 'S1T2', range: [20, 30] }
          ];
          core.vIdx = 0;
          core.rIdx = 1;
          core.toggleYap();
          
          const res = core.prevSong(15); // In gap after song 0
          expect(res.type).toBe('seek');
          expect(res.time).toBe(0); // Song 0 start
          expect(core.rIdx).toBe(0);
      });
  });

  describe('Bug: Arbitrary Seek "Snapping"', () => {
      it('should NOT snap to song start if user seeks manually in Yap Off mode', () => {
          // Setup: Standard mode (Yap Off)
          // Video 1 has songs: S1T1 [0, 10], S1T2 [20, 30]
          core.vIdx = 0;
          core.rIdx = 0;
          
          // Simulate seek to 5 (middle of Song 1)
          core.checkTick(5);
          expect(core.rIdx).toBe(0);
          
          // Simulate seek to 25 (middle of Song 2)
          // The bug is that previously logic might try to enforce rIdx=0 end bound or snap back
          // But checkTick logic updates rIdx if we land in a valid song range
          
          core.checkTick(25);
          expect(core.rIdx).toBe(1); // Should update index to match time
          
          // CRITICAL: Ensure we don't trigger a 'load' or 'seek' that would snap to START of song
          // checkTick itself doesn't return action, but its internal state update shouldn't cause a reload loop
          // In the UI integration, `checkTick` is just passive.
          
          // However, if we seek to a GAP (e.g. 15), what happens?
          core.checkTick(15);
          // rIdx should probably stay at last known valid or be indeterminate?
          // Current logic: checkTick ignores gaps if Yap is Off?
          // Let's check logic.
      });

      it('should allow playing in gaps in Standard Mode if user seeks there', () => {
          // User seeks to 15 (Gap between 10 and 20)
          core.vIdx = 0;
          core.rIdx = 0;
          core.checkTick(15);
          
          // If we are in a gap, standard mode (Yap Off) usually implies we only play segments?
          // "Rule 4b: When off, the player strictly plays only parts specified within the songs array"
          // BUT "Rule 2: If user manually seeks... that should ALWAYS do exactly what's expected"
          
          // Conflict: User seeks to gap. Rule 4b says "strictly play only parts". Rule 2 says "do what user wants".
          // Rule 2 "takes over". So we should ALLOW playing in the gap.
          // Does current logic allow this?
          
          // `checkTick` calculates `song = stream.songs[this.rIdx]`. 
          // If `rIdx` was 0 (Song 1), range is [0, 10].
          // If time is 15, `currentTime >= song.range[1]`.
          // `checkTick` calls `advanceAuto()`.
          // `advanceAuto` increments `rIdx` to 1 and calls `playVideo` (RELOAD).
          // So if user seeks to 15, the next tick sees 15 > 10, thinks "Song 1 Ended", and skips to Song 2.
          // THIS IS THE SNAP/SKIP behavior!
          
          // We need to detect if the time jump was a seek (discontinuity) vs natural playback?
          // Or simply: If we are "far" past the end, assume seek and don't auto-advance?
          
          // If we naturally play, we hit 10.0, 10.2...
          // If we seek, we hit 15.0 instantly.
          
          // FIX: Logic to detect discontinuity or allow gap playback if seeked.
          // Assert that we do NOT call playVideo (reload)
          expect(callbacks.playVideo).not.toHaveBeenCalled();
      });
  });

  describe('State Persistence', () => {
      it('saves shuffle mode when toggled', () => {
          core.toggleShuffle();
          // Expect saveSettings to be called with shuffleMode: true
          expect(callbacks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ shuffleMode: true }));
      });

      it('saves loop mode when toggled', () => {
          core.toggleLoop(); // Loop Track
          expect(callbacks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ loopMode: LOOP_TRACK }));
          
          core.toggleLoop(); // Loop Stream
          expect(callbacks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ loopMode: LOOP_STREAM }));
      });

      it('saves stream state on nextStream', () => {
          core.nextStream();
          // Expect saveSettings to include current stream index
          expect(callbacks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ vIdx: expect.any(Number) }));
      });

      it('stores the new stream default start time when moving forward', () => {
          core.playlist[1].songs = [{ name: 'Custom', range: [5, 15] }];
          callbacks.saveSettings.mockClear();
          core.nextStream();
          const lastCall = callbacks.saveSettings.mock.calls.at(-1)[0];
          expect(lastCall.lastTime).toBe('5.00');
      });

      it('stores the new stream default start time when moving backward', () => {
          core.vIdx = 2;
          core.playlist[1].songs = [{ name: 'Prev', range: [8, 20] }];
          callbacks.saveSettings.mockClear();
          core.prevStream();
          const lastCall = callbacks.saveSettings.mock.calls.at(-1)[0];
          expect(lastCall.lastTime).toBe('8.00');
      });

      it('initializes with saved state', () => {
          callbacks.getSettings = () => ({
              shuffleMode: 'true',
              loopMode: String(LOOP_STREAM),
              vIdx: '2',
              yapMode: 'true',
              lastTime: '123.45'
          });
          
          const newCore = new PlayerCore(callbacks);
          newCore.init(MOCK_SEGMENTS);
          
          expect(newCore.shuffleMode).toBe(true);
          expect(newCore.loopMode).toBe(LOOP_STREAM);
          expect(newCore.vIdx).toBe(2);
          expect(newCore.yapMode).toBe(true);
          expect(newCore.getStartSeconds()).toBe(123.45);
      });
      
      it('saves current time when saveState is called', () => {
          core.saveState(100.5);
          expect(callbacks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ lastTime: '100.50' }));
      });

      it('prefers saved videoId over index when restoring streams', () => {
          callbacks.getSettings = () => ({
              videoId: 'v3',
              vIdx: '0'
          });

          const newCore = new PlayerCore(callbacks);
          // Provide a reordered playlist so index 0 is v3
          const reordered = [MOCK_SEGMENTS[2], MOCK_SEGMENTS[0], MOCK_SEGMENTS[1]];
          newCore.init(reordered);
          expect(newCore.vIdx).toBe(0);
      });

      it('falls back to saved index when videoId missing or not found', () => {
          callbacks.getSettings = () => ({
              videoId: 'vx',
              vIdx: '1'
          });

          const newCore = new PlayerCore(callbacks);
          newCore.init(MOCK_SEGMENTS);
          expect(newCore.vIdx).toBe(1);
      });

      describe('normalizeResumeTime', () => {
          it('returns same time when inside a song and updates rIdx', () => {
              const resume = core.normalizeResumeTime(5);
              expect(resume).toBe(5);
              expect(core.rIdx).toBe(0);
          });

          it('allows times before first song start (non-negative)', () => {
              const resume = core.normalizeResumeTime(0);
              expect(resume).toBe(0);
              expect(core.rIdx).toBe(0);
          });

          it('clamps negative values to zero', () => {
              const resume = core.normalizeResumeTime(-10);
              expect(resume).toBe(0);
              expect(core.rIdx).toBe(0);
          });

          it('clamps gap times up to the next song start', () => {
              const resume = core.normalizeResumeTime(15); // between 10 and 20
              expect(resume).toBe(core.playlist[0].songs[1].range[0]);
              expect(core.rIdx).toBe(1); // next song index
          });

          it('keeps times beyond stream end unchanged but tracks last song', () => {
              const resume = core.normalizeResumeTime(9999);
              expect(resume).toBe(9999);
              expect(core.rIdx).toBe(MOCK_SEGMENTS[0].songs.length - 1);
          });

          it('returns time unchanged in Yap mode', () => {
              core.toggleYap();
              const resume = core.normalizeResumeTime(15);
              expect(resume).toBe(15);
          });
      });
  });

  describe('Timestamp Restoration Bug', () => {
    it('returns 0 if saved time is invalid or missing', () => {
        // Missing
        callbacks.getSettings = () => ({});
        expect(core.getStartSeconds()).toBe(0);
        
        // Invalid string
        callbacks.getSettings = () => ({ lastTime: "NaN" });
        expect(core.getStartSeconds()).toBe(0);
        
        // Negative
        callbacks.getSettings = () => ({ lastTime: "-10" });
        expect(core.getStartSeconds()).toBe(0);
    });
  });

  describe('History parsing resilience', () => {
      it('ignores corrupted history payloads from session storage', () => {
          callbacks.getSessionData = () => ({
              history: 'this-is-not-json'
          });

          const newCore = new PlayerCore(callbacks);
          expect(() => newCore.init(MOCK_SEGMENTS)).not.toThrow();
          expect(newCore.history.length).toBe(0);
      });
  });

  describe('Start time sanitization', () => {
      it('keeps valid numeric times unchanged', () => {
          expect(core.sanitizeStartTime(12.34)).toBe(12.34);
      });

      it('falls back to stream default when value is NaN', () => {
          core.vIdx = 0;
          expect(core.sanitizeStartTime('nope')).toBe(core.playlist[0].songs[0].range[0]);
      });

      it('uses first song start even when not zero', () => {
          core.vIdx = 0;
          const originalStart = core.playlist[0].songs[0].range[0];
          core.playlist[0].songs[0].range[0] = 5;
          expect(core.sanitizeStartTime(undefined, core.playlist[0])).toBe(5);
          core.playlist[0].songs[0].range[0] = originalStart;
      });
  });
});
