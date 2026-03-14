import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlayerCore, LOOP_NONE, LOOP_TRACK, LOOP_STREAM } from './player-core.js';

const MOCK_SEGMENTS = [
  { videoId: 'v1', title: 'Video 1', songs: [{ name: 'S1T1', range: [0, 10] }, { name: 'S1T2', range: [20, 30] }] },
  { videoId: 'v2', title: 'Video 2', songs: [] }, // Rule 0
  { videoId: 'v3', title: 'Video 3', songs: [{ name: 'S3T1', range: [0, 10] }] }
];

describe('Queue (§13)', () => {
  let core;
  let callbacks;

  beforeEach(() => {
    callbacks = {
      saveSettings: vi.fn(),
      getSettings: vi.fn(() => ({})),
      saveSessionData: vi.fn(),
      getSessionData: vi.fn(() => ({})),
      now: vi.fn(() => 1000000),
      playVideo: vi.fn(),
      seekTo: vi.fn()
    };
    core = new PlayerCore(callbacks);
    core.init(MOCK_SEGMENTS);
  });

  describe('Queue manipulation methods', () => {
    it('enqueue adds item to the back', () => {
      core.enqueue('v1', 0);
      core.enqueue('v3', 0);
      expect(core.getQueue()).toEqual([
        { videoId: 'v1', rIdx: 0 },
        { videoId: 'v3', rIdx: 0 }
      ]);
    });

    it('enqueue defaults rIdx to 0', () => {
      core.enqueue('v1');
      expect(core.getQueue()).toEqual([{ videoId: 'v1', rIdx: 0 }]);
    });

    it('removeFromQueue removes item at index', () => {
      core.enqueue('v1', 0);
      core.enqueue('v3', 0);
      core.enqueue('v2', 0);
      core.removeFromQueue(1);
      expect(core.getQueue()).toEqual([
        { videoId: 'v1', rIdx: 0 },
        { videoId: 'v2', rIdx: 0 }
      ]);
    });

    it('removeFromQueue ignores out-of-bounds index', () => {
      core.enqueue('v1', 0);
      core.removeFromQueue(5);
      core.removeFromQueue(-1);
      expect(core.getQueue()).toEqual([{ videoId: 'v1', rIdx: 0 }]);
    });

    it('clearQueue empties the queue', () => {
      core.enqueue('v1', 0);
      core.enqueue('v3', 0);
      core.clearQueue();
      expect(core.getQueue()).toEqual([]);
      expect(core.isQueueActive()).toBe(false);
    });

    it('getQueue returns a shallow copy', () => {
      core.enqueue('v1', 0);
      const q = core.getQueue();
      q.push({ videoId: 'v3', rIdx: 0 });
      expect(core.getQueue().length).toBe(1);
    });

    it('isQueueActive reflects queue state', () => {
      expect(core.isQueueActive()).toBe(false);
      core.enqueue('v1', 0);
      expect(core.isQueueActive()).toBe(true);
      core.clearQueue();
      expect(core.isQueueActive()).toBe(false);
    });

    it('allows duplicate entries', () => {
      core.enqueue('v1', 0);
      core.enqueue('v1', 0);
      expect(core.getQueue().length).toBe(2);
    });
  });

  describe('Persistence', () => {
    it('saves queue to localStorage via saveSettings', () => {
      core.enqueue('v1', 0);
      const lastCall = callbacks.saveSettings.mock.calls.at(-1)[0];
      expect(JSON.parse(lastCall.queue)).toEqual([{ videoId: 'v1', rIdx: 0 }]);
    });

    it('restores queue from localStorage on init', () => {
      callbacks.getSettings = vi.fn(() => ({
        queue: JSON.stringify([{ videoId: 'v1', rIdx: 1 }, { videoId: 'v3', rIdx: 0 }])
      }));
      const newCore = new PlayerCore(callbacks);
      newCore.init(MOCK_SEGMENTS);
      expect(newCore.getQueue()).toEqual([
        { videoId: 'v1', rIdx: 1 },
        { videoId: 'v3', rIdx: 0 }
      ]);
    });

    it('discards malformed queue entries on restore', () => {
      callbacks.getSettings = vi.fn(() => ({
        queue: JSON.stringify([
          { videoId: 'v1', rIdx: 0 },
          { noVideoId: true },
          { videoId: 'v3', rIdx: 'bad' },
          { videoId: 'v2', rIdx: 0 }
        ])
      }));
      const newCore = new PlayerCore(callbacks);
      newCore.init(MOCK_SEGMENTS);
      expect(newCore.getQueue()).toEqual([
        { videoId: 'v1', rIdx: 0 },
        { videoId: 'v2', rIdx: 0 }
      ]);
    });

    it('handles corrupted queue JSON gracefully', () => {
      callbacks.getSettings = vi.fn(() => ({ queue: 'not-json' }));
      const newCore = new PlayerCore(callbacks);
      expect(() => newCore.init(MOCK_SEGMENTS)).not.toThrow();
      expect(newCore.getQueue()).toEqual([]);
    });

    it('survives init (import/reset) without being cleared', () => {
      core.enqueue('v1', 0);
      core.enqueue('v3', 0);
      // Simulate import: re-init reads queue from saved settings
      callbacks.getSettings.mockReturnValue({
        queue: JSON.stringify([{ videoId: 'v1', rIdx: 0 }, { videoId: 'v3', rIdx: 0 }])
      });
      core.init(MOCK_SEGMENTS);
      expect(core.getQueue().length).toBe(2);
    });
  });

  describe('Yap interaction', () => {
    it('turns off yap mode when enqueueing if yap was on', () => {
      core.yapMode = true;
      core.enqueue('v1', 0);
      expect(core.yapMode).toBe(false);
    });

    it('leaves yap off when enqueueing if yap was already off', () => {
      core.yapMode = false;
      core.enqueue('v1', 0);
      expect(core.yapMode).toBe(false);
    });
  });

  describe('advanceAuto with queue', () => {
    it('Loop None: takes front item and plays it', () => {
      core.loopMode = LOOP_NONE;
      core.enqueue('v3', 0);
      core.enqueue('v1', 1);
      core.vIdx = 0; // currently at v1
      core.rIdx = 0;

      core.advanceAuto();

      // Front item (v3) taken and played, v1/1 remains in queue
      expect(core.getQueue()).toEqual([{ videoId: 'v1', rIdx: 1 }]);
      expect(core.vIdx).toBe(2); // v3
      expect(core.rIdx).toBe(0);
      expect(callbacks.playVideo).toHaveBeenCalled();
    });

    it('Loop Queue (LOOP_STREAM): takes front and cycles it to back', () => {
      core.loopMode = LOOP_STREAM;
      core.enqueue('v3', 0);
      core.enqueue('v1', 1);
      core.vIdx = 0;
      core.rIdx = 0;

      core.advanceAuto();

      // v3 taken, played, and cycled to back
      expect(core.getQueue()).toEqual([
        { videoId: 'v1', rIdx: 1 },
        { videoId: 'v3', rIdx: 0 }
      ]);
      expect(core.vIdx).toBe(2); // v3
      expect(core.rIdx).toBe(0);
      expect(callbacks.playVideo).toHaveBeenCalled();
    });

    it('Loop Track: repeats current song, queue unchanged', () => {
      core.loopMode = LOOP_TRACK;
      core.enqueue('v3', 0);
      core.enqueue('v1', 1);
      core.vIdx = 2;
      core.rIdx = 0;

      core.advanceAuto();

      expect(core.getQueue().length).toBe(2);
      expect(core.vIdx).toBe(2);
      expect(core.rIdx).toBe(0);
      expect(callbacks.seekTo).toHaveBeenCalledWith(0);
      expect(callbacks.playVideo).not.toHaveBeenCalled();
    });

    it('silently drops invalid videoIds and plays next valid item', () => {
      core.loopMode = LOOP_NONE;
      core.enqueue('invalid1', 0);
      core.enqueue('invalid2', 0);
      core.enqueue('v1', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      core.advanceAuto();

      // Both invalid items dropped, v1 taken and played
      expect(core.getQueue()).toEqual([]);
      expect(core.vIdx).toBe(0); // v1
      expect(callbacks.playVideo).toHaveBeenCalled();
    });

    it('falls through to normal behavior when queue exhausts', () => {
      core.loopMode = LOOP_NONE;
      core.enqueue('invalid', 0);
      core.vIdx = 0;
      core.rIdx = 0; // v1, first song

      core.advanceAuto();

      // Queue exhausted (invalid item dropped). Normal advanceAuto:
      // v1 has songs [0,10] and [20,30]. rIdx was 0, so advances to rIdx 1.
      expect(core.getQueue()).toEqual([]);
      expect(core.vIdx).toBe(0);
      expect(core.rIdx).toBe(1);
      expect(callbacks.playVideo).toHaveBeenCalled();
    });

    it('pushes history when playing a queue item', () => {
      core.loopMode = LOOP_NONE;
      core.vIdx = 0;
      core.rIdx = 1;
      core.enqueue('v3', 0);

      core.advanceAuto();

      // History should have the position before queue item loaded
      expect(core.history.length).toBe(1);
      expect(core.history[0].vIdx).toBe(0);
      expect(core.history[0].rIdx).toBe(1);
    });

    it('handles queue with Rule 0 stream (rIdx 0)', () => {
      core.loopMode = LOOP_NONE;
      core.enqueue('v2', 0); // Rule 0
      core.enqueue('v1', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      core.advanceAuto();

      // v2 taken, v1 remains
      expect(core.getQueue()).toEqual([{ videoId: 'v1', rIdx: 0 }]);
      expect(core.vIdx).toBe(1); // v2
      expect(core.rIdx).toBe(0);
    });

    it('clamps out-of-bounds rIdx to valid range', () => {
      core.loopMode = LOOP_NONE;
      core.enqueue('v1', 99); // v1 only has 2 songs (index 0, 1)
      core.vIdx = 2;
      core.rIdx = 0;

      core.advanceAuto();

      // rIdx 99 should be clamped; since 99 >= songs.length (2), it falls to 0
      expect(core.vIdx).toBe(0);
      expect(core.rIdx).toBe(0);
    });
  });

  describe('nextStream with queue', () => {
    it('takes front queue item instead of normal navigation', () => {
      core.enqueue('v3', 0);
      core.enqueue('v1', 1);
      core.vIdx = 0;

      core.nextStream();

      // Front item (v3) taken and loaded, v1/1 remains
      expect(core.getQueue()).toEqual([{ videoId: 'v1', rIdx: 1 }]);
      expect(core.vIdx).toBe(2); // v3
      expect(core.rIdx).toBe(0);
    });

    it('pushes history before consuming queue', () => {
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 1;

      core.nextStream();

      expect(core.history.length).toBe(1);
      expect(core.history[0].vIdx).toBe(0);
      expect(core.history[0].rIdx).toBe(1);
    });

    it('falls through to normal navigation when queue exhausts', () => {
      core.enqueue('invalid', 0);
      core.vIdx = 0;

      core.nextStream();

      // Invalid item dropped, queue empty, normal nextStream: v1 -> v2
      expect(core.getQueue()).toEqual([]);
      expect(core.vIdx).toBe(1);
    });

    it('cycles item in Loop Queue mode', () => {
      core.loopMode = LOOP_STREAM;
      core.enqueue('v3', 0);
      core.enqueue('v1', 0);
      core.vIdx = 0; // currently at v1

      core.nextStream();

      // v3 taken and cycled to back, v3 loaded
      expect(core.getQueue()).toEqual([
        { videoId: 'v1', rIdx: 0 },
        { videoId: 'v3', rIdx: 0 }
      ]);
      expect(core.vIdx).toBe(2); // v3
    });
  });

  describe('nextSong with queue active', () => {
    it('goes directly to queue from any position (not just last song)', () => {
      core.loopMode = LOOP_NONE;
      core.enqueue('v3', 0);
      core.vIdx = 0; // at v1
      core.rIdx = 0; // FIRST song, not last

      const action = core.nextSong(5); // time inside S1T1

      expect(action.type).toBe('load');
      expect(core.vIdx).toBe(2); // v3 from queue
      expect(core.rIdx).toBe(0);
    });

    it('pushes history before playing from queue', () => {
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 1;

      core.nextSong(25);

      expect(core.history.length).toBe(1);
      expect(core.history[0].vIdx).toBe(0);
    });

    it('recycles item in Loop Queue mode', () => {
      core.loopMode = LOOP_STREAM;
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      core.nextSong(5);

      expect(core.vIdx).toBe(2); // v3
      expect(core.getQueue()).toEqual([{ videoId: 'v3', rIdx: 0 }]); // recycled
    });

    it('restarts current song in Loop Track mode without consuming queue', () => {
      core.loopMode = LOOP_TRACK;
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      const action = core.nextSong(5);

      // Loop Track: seek to start of current song, queue untouched
      expect(action.type).toBe('seek');
      expect(action.time).toBe(0); // S1T1 starts at 0
      expect(core.vIdx).toBe(0); // didn't change stream
      expect(core.getQueue()).toEqual([{ videoId: 'v3', rIdx: 0 }]); // queue intact
    });

    it('consumes item in Loop None mode', () => {
      core.loopMode = LOOP_NONE;
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      core.nextSong(5);

      expect(core.vIdx).toBe(2);
      expect(core.getQueue()).toEqual([]); // consumed
    });

    it('falls through to normal navigation when queue items are all invalid', () => {
      core.enqueue('nonexistent', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      const action = core.nextSong(5);

      // Queue exhausted, falls through to normal next-song behavior
      expect(action.type).toBe('load');
      expect(core.rIdx).toBe(1); // advanced to next song in stream
    });

    it('loops current stream when queue is empty and Loop Stream is on', () => {
      core.loopMode = LOOP_STREAM;
      core.vIdx = 0;
      core.rIdx = 1; // last song of v1

      const action = core.nextSong(25);

      // No queue, Loop Stream wraps to first song
      expect(action.type).toBe('load');
      expect(core.vIdx).toBe(0);
      expect(core.rIdx).toBe(0);
    });

    it('single-item queue with Loop Queue stays on that item', () => {
      core.loopMode = LOOP_STREAM;
      core.enqueue('v3', 0);
      core.vIdx = 2; // already playing v3
      core.rIdx = 0;

      core.nextSong(5);

      // Item recycled, stays on v3
      expect(core.vIdx).toBe(2);
      expect(core.rIdx).toBe(0);
      expect(core.getQueue()).toEqual([{ videoId: 'v3', rIdx: 0 }]);
    });

    it('plays front item even when it matches current song', () => {
      core.loopMode = LOOP_NONE;
      core.enqueue('v1', 0); // same as current — still respected
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      // Press 1: {v1,0} plays (even though it matches current)
      core.nextSong(5);
      expect(core.vIdx).toBe(0); // v1
      expect(core.getQueue()).toEqual([{ videoId: 'v3', rIdx: 0 }]);

      // Press 2: {v3,0} plays
      core.nextSong(5);
      expect(core.vIdx).toBe(2); // v3
      expect(core.getQueue()).toEqual([]);
    });

    it('prevSong restarts current song when queue is active', () => {
      core.loopMode = LOOP_NONE;
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 1; // S1T2

      const action = core.prevSong(25);

      expect(action.type).toBe('seek');
      expect(action.time).toBe(20); // S1T2 starts at 20
      expect(core.vIdx).toBe(0); // didn't change stream
      expect(core.getQueue()).toEqual([{ videoId: 'v3', rIdx: 0 }]); // queue intact
    });

    it('prevSong restarts current song with Loop Track + queue', () => {
      core.loopMode = LOOP_TRACK;
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      const action = core.prevSong(5);

      expect(action.type).toBe('seek');
      expect(action.time).toBe(0);
      expect(core.getQueue()).toEqual([{ videoId: 'v3', rIdx: 0 }]);
    });

    it('prevSong restarts in Loop Queue when not yet playing from queue', () => {
      core.loopMode = LOOP_STREAM;
      core.enqueue('v3', 0);
      core.vIdx = 2;
      core.rIdx = 0;

      const action = core.prevSong(5);

      expect(action.type).toBe('seek');
      expect(action.time).toBe(0);
      expect(core.getQueue()).toEqual([{ videoId: 'v3', rIdx: 0 }]);
    });

    it('Loop Queue prevSong navigates backwards through circular queue', () => {
      core.loopMode = LOOP_STREAM;
      core.enqueue('v3', 0);
      core.enqueue('v1', 0);
      core.vIdx = 0; // playing v1 (not from queue)
      core.rIdx = 0;

      // Enter queue: plays v3
      core.nextSong(5);
      expect(core.vIdx).toBe(2); // v3
      // Queue: [v1/0, v3/0]

      // Advance: plays v1
      core.nextSong(5);
      expect(core.vIdx).toBe(0); // v1
      // Queue: [v3/0, v1/0]

      // Previous: should go back to v3
      const action = core.prevSong(5);
      expect(action.type).toBe('load');
      expect(core.vIdx).toBe(2); // v3
      // Queue: [v1/0, v3/0] — current (v1) unshifted to front, previous (v3) at back
      expect(core.getQueue()).toEqual([
        { videoId: 'v1', rIdx: 0 },
        { videoId: 'v3', rIdx: 0 },
      ]);
    });

    it('Loop Queue prevSong wraps around at start to last item', () => {
      core.loopMode = LOOP_STREAM;
      core.enqueue('v3', 0);
      core.enqueue('v1', 1);
      core.vIdx = 0;
      core.rIdx = 0;

      // Enter queue: plays v3 (first item)
      core.nextSong(5);
      expect(core.vIdx).toBe(2); // v3
      // Queue: [v1/1, v3/0]

      // Previous at start: should wrap to last item (v1/1)
      const action = core.prevSong(5);
      expect(action.type).toBe('load');
      expect(core.vIdx).toBe(0); // v1
      expect(core.rIdx).toBe(1);
    });

    it('Loop Queue prevSong with single item wraps to itself', () => {
      core.loopMode = LOOP_STREAM;
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      // Enter queue
      core.nextSong(5);
      expect(core.vIdx).toBe(2); // v3
      // Queue: [v3/0]

      // Previous with single item: restart
      const action = core.prevSong(5);
      expect(action.type).toBe('seek');
      expect(action.time).toBe(0);
      expect(core.vIdx).toBe(2); // still v3
      expect(core.getQueue()).toEqual([{ videoId: 'v3', rIdx: 0 }]);
    });

    it('Loop Queue prevSong then nextSong returns to original position', () => {
      core.loopMode = LOOP_STREAM;
      core.enqueue('v3', 0);
      core.enqueue('v1', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      // Enter queue and advance to v1
      core.nextSong(5); // v3
      core.nextSong(5); // v1
      expect(core.vIdx).toBe(0); // v1

      // Go back
      core.prevSong(5);
      expect(core.vIdx).toBe(2); // v3

      // Go forward again — should return to v1
      core.nextSong(5);
      expect(core.vIdx).toBe(0); // v1
    });

    it('preserves queue order during Loop Queue cycling (no reordering)', () => {
      core.loopMode = LOOP_STREAM;
      core.enqueue('v1', 0);
      core.enqueue('v1', 0); // deliberate duplicate
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      // Every cycle is a full 3-item rotation: v1, v1, v3
      core.nextSong(5);
      expect(core.vIdx).toBe(0); // v1

      core.nextSong(5);
      expect(core.vIdx).toBe(0); // v1 (duplicate)

      core.nextSong(5);
      expect(core.vIdx).toBe(2); // v3

      // Second cycle: same order
      core.nextSong(5);
      expect(core.vIdx).toBe(0); // v1

      core.nextSong(5);
      expect(core.vIdx).toBe(0); // v1 (duplicate)

      core.nextSong(5);
      expect(core.vIdx).toBe(2); // v3

      // Queue returns to original order after full cycle
      expect(core.getQueue()).toEqual([
        { videoId: 'v1', rIdx: 0 },
        { videoId: 'v1', rIdx: 0 },
        { videoId: 'v3', rIdx: 0 },
      ]);
    });

    it('rapid presses with Loop Queue produce consistent results', () => {
      core.loopMode = LOOP_STREAM;
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      // First press: goes to v3
      core.nextSong(5);
      expect(core.vIdx).toBe(2);

      // Second press: v3 was recycled, goes to v3 again
      core.nextSong(5);
      expect(core.vIdx).toBe(2);

      // Third press: same
      core.nextSong(5);
      expect(core.vIdx).toBe(2);

      // Queue still has the recycled item
      expect(core.getQueue()).toEqual([{ videoId: 'v3', rIdx: 0 }]);
    });

    it('Loop Queue prevSong drops invalid items and plays next valid', () => {
      core.loopMode = LOOP_STREAM;
      core.enqueue('v1', 0);
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      // Advance into queue: v1 → v3
      core.nextSong(5); // plays v1, queue: [v3, v1]
      core.nextSong(5); // plays v3, queue: [v1, v3]
      expect(core.vIdx).toBe(2); // v3

      // Poison the item behind the current one (v1 → invalid)
      // Queue is [v1, v3(current)], so v1 is the "previous"
      core.queue[0] = { videoId: 'gone', rIdx: 0 };

      // prevSong should skip "gone" — since no valid previous exists,
      // it falls through to restart
      const action = core.prevSong(0);
      expect(action.type).toBe('seek');
      // Invalid item was dropped, only current remains
      expect(core.getQueue()).toEqual([{ videoId: 'v3', rIdx: 0 }]);
    });

    it('Shuffle + Loop Queue prevSong uses history when valid entry exists', () => {
      core.shuffleMode = true;
      core.loopMode = LOOP_STREAM;
      core.enqueue('v1', 0);
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      const spy = vi.spyOn(Math, 'random').mockReturnValue(0);

      // Enter queue: plays v1, then v3
      core.nextSong(5);
      expect(core.vIdx).toBe(2); // v3 (only candidate excluding v1/0)
      core.nextSong(5);
      expect(core.vIdx).toBe(0); // v1

      // prevSong should walk history back to v3
      const action = core.prevSong(5);
      expect(action.type).toBe('load');
      expect(core.vIdx).toBe(2); // v3 from history

      spy.mockRestore();
    });

    it('Shuffle + Loop Queue prevSong picks random when no valid history', () => {
      core.shuffleMode = true;
      core.loopMode = LOOP_STREAM;
      core.enqueue('v1', 0);
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      const spy = vi.spyOn(Math, 'random').mockReturnValue(0);

      // Enter queue
      core.nextSong(5);
      expect(core.vIdx).toBe(2); // v3

      // Clear history to force random fallback
      core.history = [];

      const action = core.prevSong(5);
      expect(action.type).toBe('load');
      // Should have picked from queue via _playFromQueue

      spy.mockRestore();
    });

    it('Shuffle + Loop Queue prevSong navigates even without _lastPlayWasQueue', () => {
      core.shuffleMode = true;
      core.loopMode = LOOP_STREAM;
      core.enqueue('v1', 0);
      core.enqueue('v3', 0);
      core.enqueue('v1', 1);
      core.enqueue('v2', 0);
      core.vIdx = 0;
      core.rIdx = 0;
      // Deliberately leave _lastPlayWasQueue = false
      core._lastPlayWasQueue = false;

      const spy = vi.spyOn(Math, 'random').mockReturnValue(0);

      // prevSong should still navigate the queue (random pick), not restart
      const action = core.prevSong(5);
      expect(action.type).toBe('load');

      spy.mockRestore();
    });

    it('prevSong navigates queue after selectQueueItem', () => {
      core.loopMode = LOOP_STREAM;
      core.enqueue('v1', 0);
      core.enqueue('v3', 0);
      core.enqueue('v1', 1);
      core.enqueue('v2', 0);

      // Select the 3rd item (v1/1) via modal — simulates user clicking
      core.selectQueueItem(2);
      expect(core.vIdx).toBe(0); // v1
      expect(core.rIdx).toBe(1);

      // Advance to next queue item
      core.nextSong(25);
      const prevVIdx = core.vIdx;

      // prevSong should navigate back, NOT restart
      const action = core.prevSong(0);
      expect(action.type).toBe('load');
      expect(core.vIdx).not.toBe(prevVIdx); // actually moved
    });
  });

  describe('selectQueueItem', () => {
    it('loads the selected item and sets _lastPlayWasQueue', () => {
      core.loopMode = LOOP_STREAM;
      core.enqueue('v3', 0);
      core.enqueue('v1', 1);
      core.vIdx = 0;
      core.rIdx = 0;

      const result = core.selectQueueItem(1);

      expect(result).toBe(true);
      expect(core.vIdx).toBe(0); // v1
      expect(core.rIdx).toBe(1);
      expect(core._lastPlayWasQueue).toBe(true);
      // Loop Queue: item stays in queue
      expect(core.getQueue()).toEqual([
        { videoId: 'v3', rIdx: 0 },
        { videoId: 'v1', rIdx: 1 },
      ]);
    });

    it('removes item from queue in non-loop modes', () => {
      core.loopMode = LOOP_NONE;
      core.enqueue('v3', 0);
      core.enqueue('v1', 1);
      core.vIdx = 0;
      core.rIdx = 0;

      core.selectQueueItem(0);

      expect(core.vIdx).toBe(2); // v3
      expect(core.getQueue()).toEqual([{ videoId: 'v1', rIdx: 1 }]);
      expect(core._lastPlayWasQueue).toBe(true);
    });

    it('returns false for invalid index', () => {
      core.enqueue('v3', 0);
      expect(core.selectQueueItem(-1)).toBe(false);
      expect(core.selectQueueItem(5)).toBe(false);
    });

    it('returns false for invalid videoId', () => {
      core.enqueue('nonexistent', 0);
      expect(core.selectQueueItem(0)).toBe(false);
    });

    it('pushes history before switching', () => {
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 1;

      core.selectQueueItem(0);

      expect(core.history.length).toBe(1);
      expect(core.history[0].vIdx).toBe(0);
      expect(core.history[0].rIdx).toBe(1);
    });

    it('clamps out-of-bounds rIdx', () => {
      core.enqueue('v1', 99);
      core.selectQueueItem(0);
      expect(core.rIdx).toBe(0); // clamped (v1 has 2 songs)
    });
  });

  describe('Loop Queue without queue items', () => {
    it('behaves like Loop Stream when queue is empty', () => {
      core.loopMode = LOOP_STREAM;
      core.vIdx = 0;
      core.rIdx = 1; // Last song of v1

      core.advanceAuto();

      // Should wrap to first song of same stream (Loop Stream behavior)
      expect(core.vIdx).toBe(0);
      expect(core.rIdx).toBe(0);
    });
  });

  describe('Single-item queue with Loop Queue', () => {
    it('cycles the sole item back, effectively repeating it', () => {
      core.loopMode = LOOP_STREAM;
      core.enqueue('v3', 0);
      core.vIdx = 2; // at v3
      core.rIdx = 0;

      core.advanceAuto();

      // Single item cycled to back = still front
      expect(core.getQueue()).toEqual([{ videoId: 'v3', rIdx: 0 }]);
      expect(core.vIdx).toBe(2);
      expect(core.rIdx).toBe(0);
      expect(callbacks.playVideo).toHaveBeenCalled();
    });
  });

  describe('Shuffle + Queue', () => {
    it('picks a random queue item instead of the front', () => {
      core.shuffleMode = true;
      core.loopMode = LOOP_NONE;
      core.enqueue('v1', 0);
      core.enqueue('v2', 0);
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      // Mock Math.random to pick index 2 (v3)
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99);

      core.nextSong(5);
      expect(core.vIdx).toBe(2); // v3 picked randomly
      // v1 and v2 remain (v3 was spliced from index 2)
      expect(core.getQueue()).toEqual([
        { videoId: 'v1', rIdx: 0 },
        { videoId: 'v2', rIdx: 0 },
      ]);

      spy.mockRestore();
    });

    it('picks from front when shuffle is off (FIFO)', () => {
      core.shuffleMode = false;
      core.loopMode = LOOP_NONE;
      core.enqueue('v1', 0);
      core.enqueue('v3', 0);
      core.vIdx = 2;
      core.rIdx = 0;

      core.nextSong(5);
      expect(core.vIdx).toBe(0); // v1 (front)
      expect(core.getQueue()).toEqual([{ videoId: 'v3', rIdx: 0 }]);
    });

    it('shuffle + Loop Queue recycles the randomly picked item to the back', () => {
      core.shuffleMode = true;
      core.loopMode = LOOP_STREAM;
      core.enqueue('v1', 0);
      core.enqueue('v3', 0);
      core.enqueue('v1', 1);
      core.vIdx = 0;
      core.rIdx = 0;

      // Candidates excluding current {v1,0}: indices [1,2] → pick first (v3)
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0);

      core.nextSong(5);
      expect(core.vIdx).toBe(2); // v3 picked
      // v3 spliced from middle, recycled to back
      expect(core.getQueue()).toEqual([
        { videoId: 'v1', rIdx: 0 },
        { videoId: 'v1', rIdx: 1 },
        { videoId: 'v3', rIdx: 0 },
      ]);

      spy.mockRestore();
    });

    it('shuffle avoids picking the same song currently playing', () => {
      core.shuffleMode = true;
      core.loopMode = LOOP_STREAM;
      core.enqueue('v1', 0); // same as current
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      // {v1,0} excluded — only candidate is {v3,0} at index 1
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99);

      core.nextSong(5);
      expect(core.vIdx).toBe(2); // v3, not v1

      spy.mockRestore();
    });

    it('shuffle falls back to same song when all queue items match current', () => {
      core.shuffleMode = true;
      core.loopMode = LOOP_STREAM;
      core.enqueue('v1', 0);
      core.enqueue('v1', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      const spy = vi.spyOn(Math, 'random').mockReturnValue(0);

      core.nextSong(5);
      // No alternative — must pick v1 anyway
      expect(core.vIdx).toBe(0);
      // Item recycled back in Loop Queue
      expect(core.getQueue()).toEqual([
        { videoId: 'v1', rIdx: 0 },
        { videoId: 'v1', rIdx: 0 },
      ]);

      spy.mockRestore();
    });

    it('shuffle with single-item queue still plays that item', () => {
      core.shuffleMode = true;
      core.loopMode = LOOP_STREAM;
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      const spy = vi.spyOn(Math, 'random').mockReturnValue(0);

      core.nextSong(5);
      expect(core.vIdx).toBe(2); // v3 played
      expect(core.getQueue()).toEqual([{ videoId: 'v3', rIdx: 0 }]); // recycled

      spy.mockRestore();
    });

    it('shuffle with single-item queue matching current still works', () => {
      core.shuffleMode = true;
      core.loopMode = LOOP_STREAM;
      core.enqueue('v1', 0); // same as current
      core.vIdx = 0;
      core.rIdx = 0;

      const spy = vi.spyOn(Math, 'random').mockReturnValue(0);

      core.nextSong(5);
      // Only item matches current — fallback picks it anyway
      expect(core.vIdx).toBe(0);
      expect(core.getQueue()).toEqual([{ videoId: 'v1', rIdx: 0 }]);

      spy.mockRestore();
    });

    it('shuffle + advanceAuto picks randomly from queue', () => {
      core.shuffleMode = true;
      core.loopMode = LOOP_NONE;
      core.enqueue('v1', 0);
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      // Mock: pick index 1 (v3)
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99);

      core.advanceAuto();
      expect(core.vIdx).toBe(2); // v3
      expect(core.getQueue()).toEqual([{ videoId: 'v1', rIdx: 0 }]);
      expect(callbacks.playVideo).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('shuffle skips invalid items and picks from remaining', () => {
      core.shuffleMode = true;
      core.loopMode = LOOP_NONE;
      core.enqueue('invalid', 0);
      core.enqueue('v3', 0);
      core.vIdx = 0;
      core.rIdx = 0;

      // Mock picks index 0 first (invalid), then 0 again (v3, only item left)
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0);

      core.nextSong(5);
      expect(core.vIdx).toBe(2); // v3 after invalid dropped
      expect(core.getQueue()).toEqual([]);

      spy.mockRestore();
    });
  });
});
