export const LOOP_NONE = 0;
export const LOOP_TRACK = 1;
export const LOOP_STREAM = 2;
export const RESTART_THRESHOLD_SECONDS = 5;
const HISTORY_LIMIT = 20;
const SEAMLESS_GAP_SECONDS = 1.0; // Threshold to treat neighboring segments as seamless in Yap Off

export class PlayerCore {
  constructor(callbacks = {}) {
    this.cb = {
      playVideo: callbacks.playVideo || (() => {}),
      seekTo: callbacks.seekTo || (() => {}),
      saveSettings: callbacks.saveSettings || (() => {}),
      getSettings: callbacks.getSettings || (() => ({})),
      saveSessionData: callbacks.saveSessionData || (() => {}),
      getSessionData: callbacks.getSessionData || (() => ({})),
      now: callbacks.now || (() => Date.now()), // Mockable time
      onStatus: callbacks.onStatus || (() => {}),
    };

    this.playlist = [];
    this.vIdx = 0; // Stream Index
    this.rIdx = 0; // Range/Song Index
    
    this.loopMode = LOOP_NONE;
    this.yapMode = false;
    this.shuffleMode = false;
    this.memberMode = false;

    // Stream history powers deterministic back navigation (behavior §4C).
    // Session-only: cleared when tab closes, capped at HISTORY_LIMIT.
    this.history = [];
    // Persistent queue: FIFO of {videoId, rIdx} items (behavior §13).
    // Arrangement is stable: only enqueue (append), removal, and Loop None
    // consumption may mutate the array. Playback never reorders it — the
    // cycle position lives entirely in the cursor below.
    this.queue = [];
    // Index of the queue item currently playing, or null when playback is
    // not attached to a queue slot. With _cursorDetached, the item that was
    // playing has been removed from the queue and the cursor points at the
    // slot its successor slid into (may equal queue.length: wraps to front),
    // so the cycle continues from the gap instead of resetting.
    this._queueCursor = null;
    this._cursorDetached = false;
    // Rule 0 streams cache their durations once YouTube reports them.
    this.durations = {};
  }

  init(segmentData) {
    const saved = this.cb.getSettings();
    this.yapMode = saved.yapMode === 'true' || saved.yapMode === true;
    this.shuffleMode = saved.shuffleMode === 'true' || saved.shuffleMode === true;
    this.memberMode = saved.memberMode === 'true' || saved.memberMode === true;

    // Filter out member-only streams unless member mode is enabled.
    const filtered = this.memberMode ? segmentData : segmentData.filter(v => !v.memberOnly);

    // Preserve empty song lists so Rule 0 streams play as a single track.
    this.playlist = filtered.map(v => ({
      videoId: v.videoId,
      name: v.name || '',
      title: v.title || v.videoId, // Fallback title if provided or ID
      songs: (v.songs && v.songs.length > 0) ? v.songs : null,
      memberOnly: !!v.memberOnly
    }));
    
    // Parse Loop Mode (default to 0)
    const savedLoop = parseInt(saved.loopMode, 10);
    this.loopMode = isNaN(savedLoop) ? LOOP_NONE : savedLoop;

    // Restore stream by explicit videoId first, fallback to saved index
    const savedVideoId = saved.videoId;
    let restoredIndex = false;
    if (savedVideoId) {
        const matchIdx = this.playlist.findIndex(p => p.videoId === savedVideoId);
        if (matchIdx !== -1) {
            this.vIdx = matchIdx;
            restoredIndex = true;
        }
    }

    if (!restoredIndex) {
        const savedVIdx = parseInt(saved.vIdx, 10);
        if (!isNaN(savedVIdx) && savedVIdx >= 0 && savedVIdx < this.playlist.length) {
            this.vIdx = savedVIdx;
        } else if (this.vIdx >= this.playlist.length) {
            this.vIdx = 0;
        }
    }
    
    // Restore history from session storage (session-only, cleared on tab close)
    const sessionData = this.cb.getSessionData();
    let rawHistory = [];
    if (sessionData.history) {
        try {
            rawHistory = JSON.parse(sessionData.history);
        } catch {
            rawHistory = [];
        }
    }
    this.history = rawHistory
        .filter((h) => h && typeof h.vIdx === 'number')
        .map((h) => ({
            vIdx: h.vIdx,
            rIdx: typeof h.rIdx === 'number' ? h.rIdx : 0,
            time: typeof h.time === 'number' ? h.time : undefined
        }));
    if (this.history.length > HISTORY_LIMIT) {
        this.history = this.history.slice(-HISTORY_LIMIT);
    }

    // Restore queue from localStorage (persistent across sessions, §13)
    if (saved.queue) {
        try {
            const parsed = JSON.parse(saved.queue);
            this.queue = Array.isArray(parsed)
                ? parsed.filter(item => item && typeof item.videoId === 'string' && typeof item.rIdx === 'number')
                : [];
        } catch {
            this.queue = [];
        }
    } else {
        this.queue = [];
    }

    // Restore the cycle position so a reload mid-Loop-Queue continues where
    // it left off. An attached cursor must still match the restored stream —
    // otherwise it's stale and playback re-enters the queue from front/back.
    this._clearQueueCursor();
    const savedCursor = parseInt(saved.queueCursor, 10);
    const savedDetached = saved.queueCursorDetached === 'true' || saved.queueCursorDetached === true;
    if (!isNaN(savedCursor) && savedCursor >= 0 && this.queue.length > 0) {
        if (savedDetached) {
            if (savedCursor <= this.queue.length) {
                this._queueCursor = savedCursor;
                this._cursorDetached = true;
            }
        } else if (savedCursor < this.queue.length) {
            const cur = this.playlist[this.vIdx];
            if (cur && this.queue[savedCursor].videoId === cur.videoId) {
                this._queueCursor = savedCursor;
            }
        }
    }
  }

  // Force save state
  saveState(currentTime = 0) {
      this._saveState(currentTime);
  }

  _saveState(currentTime = 0) {
      const stream = this.getCurrentStream();
      this.cb.saveSettings({
          yapMode: this.yapMode,
          shuffleMode: this.shuffleMode,
          memberMode: this.memberMode,
          loopMode: this.loopMode,
          vIdx: this.vIdx,
          videoId: stream ? stream.videoId : '',
          lastTime: currentTime.toFixed(2),
          queue: JSON.stringify(this.queue),
          queueCursor: this._queueCursor === null ? '' : String(this._queueCursor),
          queueCursorDetached: this._cursorDetached
      });
      // Session-only history (cleared on tab close)
      this.cb.saveSessionData({
          history: JSON.stringify(this.history)
      });
  }

  getStartSeconds() {
      const saved = this.cb.getSettings();
      if (!saved.lastTime) return 0;
      const t = parseFloat(saved.lastTime);
      if (isNaN(t) || !isFinite(t) || t < 0) return 0;
      return t;
  }

  normalizeResumeTime(timeSeconds) {
      if (timeSeconds === undefined || timeSeconds === null) return 0;
      let time = Number(timeSeconds);
      if (!isFinite(time) || time < 0) {
          time = 0;
      }
      const stream = this.getCurrentStream();
      if (!stream) return time;

      // If no songs defined (Rule 0) or Yap mode, allow any timestamp
      if (!stream.songs || this.yapMode) {
          return time;
      }

      const songs = stream.songs;
      const firstStart = songs[0].range[0];

      if (time < firstStart) {
          this.rIdx = 0;
          return time;
      }

      for (let i = 0; i < songs.length; i++) {
          const current = songs[i];
          const start = current.range[0];
          const end = current.range[1];

          if (time >= start && time < end) {
              this.rIdx = i;
              return time;
          }

          const next = songs[i + 1];
          if (next && time >= end && time < next.range[0]) {
              this.rIdx = i + 1;
              return next.range[0];
          }
      }

      // Past end of stream, keep last song index but allow time
      this.rIdx = songs.length - 1;
      return time;
  }

  getStreamDefaultStart(stream = this.getCurrentStream()) {
      if (!stream) return 0;
      if (stream.songs && stream.songs.length > 0) {
          return stream.songs[0].range[0];
      }
      return 0;
  }

  sanitizeStartTime(time, stream = this.getCurrentStream()) {
      const numeric = Number(time);
      if (Number.isFinite(numeric) && numeric >= 0) {
          return numeric;
      }
      return this.getStreamDefaultStart(stream);
  }

  getCurrentStream() {
    return this.playlist[this.vIdx];
  }

  getCurrentSong() {
    const stream = this.getCurrentStream();
    if (!stream) return null;
    
    // Rule 0: If no songs defined, treat whole video as one song
    if (!stream.songs) {
        const cached = this.durations[stream.videoId];
        const duration = Number.isFinite(cached) && cached > 0 ? cached : 0;
        return { name: stream.title, range: [0, duration] };
    }
    return stream.songs[this.rIdx];
  }

  // Used by UI to update duration when player loads
  setDuration(videoId, duration) {
      this.durations[videoId] = duration;
  }
  
  getDuration(videoId) {
      return this.durations[videoId];
  }

  toggleYap() {
    this.yapMode = !this.yapMode;
    this._saveState();
    return this.yapMode;
  }

  toggleLoop() {
    this.loopMode = (this.loopMode + 1) % 3;
    this._saveState();
    return this.loopMode;
  }

  toggleShuffle() {
      const wasOn = this.shuffleMode;
      this.shuffleMode = !this.shuffleMode;
      // Wipe history entirely when shuffle is turned off
      if (wasOn && !this.shuffleMode) {
          this.history = [];
      }
      this._saveState();
      return this.shuffleMode;
  }

  toggleMemberMode() {
      this.memberMode = !this.memberMode;
      this.history = []; // Playlist indices change, history is invalid
      this._saveState();
      return this.memberMode;
  }

  // ================= QUEUE (§13) =================

  enqueue(videoId, rIdx = 0) {
      if (this.yapMode) {
          this.yapMode = false;
      }
      // Additions always append (§13). Appends never shift existing indices,
      // so the cycle cursor needs no adjustment — the new item simply plays
      // last in the current cycle.
      this.queue.push({ videoId, rIdx });
      this._saveState();
  }

  _clearQueueCursor() {
      this._queueCursor = null;
      this._cursorDetached = false;
  }

  // Playback can move off the cursor's item without going through the queue
  // (a jump via search, a loop/shuffle mode change, Loop None consumption
  // while a stale cursor lingers). Rather than patching every such path,
  // this drops the cursor at the point of use when it no longer matches
  // what's actually playing, so prev/next re-enter the queue cleanly.
  _reconcileQueueCursor() {
      if (this._queueCursor === null || this._cursorDetached) return;
      const item = this.queue[this._queueCursor];
      const current = this.getCurrentStream();
      if (!item || !current || item.videoId !== current.videoId) {
          this._clearQueueCursor();
      }
  }

  // Remove queue[index] while keeping the cursor on the same logical position
  // in the cycle. Removing the currently playing item detaches the cursor
  // onto the gap it occupied: the next advance plays the item that slid into
  // its slot, prev plays the one before it.
  _removeQueueIndex(index) {
      this.queue.splice(index, 1);
      if (this._queueCursor === null) return;
      if (this.queue.length === 0) {
          this._clearQueueCursor();
          return;
      }
      if (index < this._queueCursor) {
          this._queueCursor--;
      } else if (index === this._queueCursor && !this._cursorDetached) {
          this._cursorDetached = true;
      }
      // index === cursor while detached: the new successor slides into the
      // same slot; index > cursor: positions up to the cursor are unaffected.
  }

  // Next slot in the cycle: successor of the cursor, the gap's successor when
  // detached, or the front when entering the queue fresh.
  _nextQueueIndex() {
      const n = this.queue.length;
      if (this._queueCursor === null) return 0;
      if (this._cursorDetached) return this._queueCursor % n;
      return (this._queueCursor + 1) % n;
  }

  // Previous slot in the cycle, or the back when entering the queue fresh.
  // A detached cursor sits between predecessor and successor, so the same
  // arithmetic yields the predecessor. Cursor never exceeds queue.length,
  // keeping the modulo in range.
  _prevQueueIndex() {
      const n = this.queue.length;
      if (this._queueCursor === null) return n - 1;
      return (this._queueCursor - 1 + n) % n;
  }

  removeFromQueue(index) {
      if (index >= 0 && index < this.queue.length) {
          this._removeQueueIndex(index);
          this._saveState();
      }
  }

  clearQueue() {
      this.queue = [];
      this._clearQueueCursor();
      this._saveState();
  }

  getQueue() {
      return this.queue.slice();
  }

  isQueueActive() {
      return this.queue.length > 0;
  }

  // Exact track-level membership (videoId + rIdx). Duplicates are allowed, so this
  // only reports presence — the UI uses it to tint the "add" affordance.
  isQueued(videoId, rIdx) {
      return this.queue.some(q => q.videoId === videoId && q.rIdx === rIdx);
  }

  // Pick a queue item, resolve it to a playlist position, and play it.
  // With shuffle on, a random item is chosen; otherwise Loop Queue continues
  // the cycle from the cursor and other modes take the front. Playback never
  // reorders the queue: Loop Queue only moves the cursor, other modes consume
  // (remove) the played item. Invalid items are silently dropped until a
  // valid one is found. Returns true if a valid item was loaded, false if
  // queue exhausted.
  _playFromQueue(pushHist) {
      // Forward-path mirror of prevSong's reconcile: drop a cursor left stale by
      // playback moving off the queue (a search jump, a loop-mode change, Loop
      // None consumption) so the non-shuffle Loop Queue pick below re-enters from
      // the front instead of advancing off a dangling cursor.
      this._reconcileQueueCursor();
      while (this.queue.length > 0) {
          let pickIdx;
          if (this.shuffleMode) {
              const current = this.getCurrentStream();
              // Build list of indices that differ from the currently playing song
              const candidates = [];
              for (let i = 0; i < this.queue.length; i++) {
                  if (!current || this.queue[i].videoId !== current.videoId
                      || this.queue[i].rIdx !== this.rIdx) {
                      candidates.push(i);
                  }
              }
              pickIdx = candidates.length > 0
                  ? candidates[Math.floor(Math.random() * candidates.length)]
                  // All items are the same song — pick any
                  : Math.floor(Math.random() * this.queue.length);
          } else if (this.loopMode === LOOP_STREAM) {
              pickIdx = this._nextQueueIndex();
          } else {
              pickIdx = 0;
          }
          const item = this.queue[pickIdx];
          const idx = this.playlist.findIndex(p => p.videoId === item.videoId);
          if (idx === -1) {
              // Invalid videoId — silently dropped
              this._removeQueueIndex(pickIdx);
              continue;
          }
          if (pushHist) this.pushHistory();
          if (this.loopMode === LOOP_STREAM) {
              // Loop Queue: the item stays in place; the cursor marks it as current.
              this._queueCursor = pickIdx;
              this._cursorDetached = false;
          } else {
              this._removeQueueIndex(pickIdx);
          }
          this.vIdx = idx;
          const stream = this.playlist[idx];
          this.rIdx = (stream.songs && item.rIdx < stream.songs.length)
              ? item.rIdx : 0;
          const song = this.getCurrentSong();
          this._saveState(song ? song.range[0] : 0);
          return true;
      }
      this._saveState();
      return false;
  }

  // Select a specific queue item by index (e.g. from the queue modal).
  // In Loop Queue the item stays in place and the cursor jumps to it, so the
  // arrangement is untouched and the cycle continues from that position; in
  // other modes it's consumed.
  selectQueueItem(index) {
      if (index < 0 || index >= this.queue.length) return false;
      const item = this.queue[index];
      const streamIdx = this.playlist.findIndex(p => p.videoId === item.videoId);
      if (streamIdx === -1) return false;
      this.pushHistory();
      if (this.loopMode === LOOP_STREAM) {
          this._queueCursor = index;
          this._cursorDetached = false;
      } else {
          this._removeQueueIndex(index);
      }
      this.vIdx = streamIdx;
      const stream = this.playlist[streamIdx];
      this.rIdx = (stream.songs && item.rIdx < stream.songs.length)
          ? item.rIdx : 0;
      const song = this.getCurrentSong();
      this._saveState(song ? song.range[0] : 0);
      return true;
  }

  // Index of the queue item currently playing (Loop Queue cycling), or -1
  // when playback isn't attached to a queue slot. Used by the queue modal
  // to mark the active row.
  getNowPlayingQueueIndex() {
      this._reconcileQueueCursor();
      return (this._queueCursor !== null && !this._cursorDetached)
          ? this._queueCursor : -1;
  }

  // ================= NAVIGATION =================

  pushHistory() {
      // Record the current stream before we leave so "Prev Stream" can restore it.
      const stream = this.getCurrentStream();
      this.history.push({
          vIdx: this.vIdx,
          rIdx: this.rIdx,
          time: this._getHistoryPosition(stream)
      });
      if (this.history.length > HISTORY_LIMIT) {
          this.history.shift();
      }
  }

  _getHistoryPosition(stream = this.getCurrentStream()) {
      if (!stream) return 0;
      if (!stream.songs || stream.songs.length === 0) {
          return this.getStreamDefaultStart(stream);
      }
      const maxIdx = stream.songs.length - 1;
      const safeIdx = Math.min(Math.max(this.rIdx, 0), maxIdx);
      return stream.songs[safeIdx].range[0];
  }

  // Helper to get next index
  _getNextStreamIndex() {
      if (this.shuffleMode) {
          // Pick random excluding current if possible
          if (this.playlist.length <= 1) return 0;
          let next;
          do {
              next = Math.floor(Math.random() * this.playlist.length);
          } while (next === this.vIdx);
          return next;
      } else {
          if (this.vIdx < this.playlist.length - 1) {
              return this.vIdx + 1;
          } else {
              return 0; // Wrap
          }
      }
  }

  nextStream() {
      this.pushHistory();

      if (this.isQueueActive()) {
          if (this._playFromQueue(false)) {
              return true;
          }
      }

      this._clearQueueCursor();
      this.vIdx = this._getNextStreamIndex();
      this.rIdx = 0;
      this._saveState(this.getStreamDefaultStart());
      return true;
  }

  prevStream(options = {}) {
    const { skipHistory = false } = options;
    this._clearQueueCursor();
    let saveTime = 0;

    // Shift+prevStream when shuffle ON: bypass history, go to actual prev index
    if (skipHistory && this.shuffleMode) {
        if (this.vIdx > 0) {
            this.vIdx--;
        } else {
            this.vIdx = this.playlist.length - 1;
        }
        this.rIdx = 0;
        saveTime = this.getStreamDefaultStart();
        this._saveState(saveTime);
        return true;
    }

    if (this.history.length > 0) {
          const prev = this.history.pop();
          this.vIdx = prev.vIdx;
        const stream = this.getCurrentStream();
        if (stream && stream.songs && stream.songs.length > 0) {
            const maxIdx = stream.songs.length - 1;
            const storedIdx = typeof prev.rIdx === 'number' ? prev.rIdx : 0;
            this.rIdx = Math.min(Math.max(storedIdx, 0), maxIdx);
        } else {
            this.rIdx = 0;
        }
        saveTime = typeof prev.time === 'number' && prev.time >= 0 ? prev.time : this.getStreamDefaultStart();
      } else {
          // "Once we run out of history, we randomize even on the backwards direction"
          if (this.shuffleMode) {
              // Randomize
              this.vIdx = this._getNextStreamIndex(); // Same logic as next for random
              this.rIdx = 0;
          } else {
              // Standard prev behavior
              if (this.vIdx > 0) {
                  this.vIdx--;
              } else {
                  this.vIdx = this.playlist.length - 1;
              }
              this.rIdx = 0;
          }
        saveTime = this.getStreamDefaultStart();
      }
    this._saveState(saveTime);
      return true;
  }

  nextSong(currentTime) {
      const stream = this.getCurrentStream();

      // Queue active: skip directly to next queue item, bypassing within-stream
      // advancement. Avoids stale-time issues from _syncIndexToTime and ensures
      // "the next item to play always comes from the queue" (§13).
      if (this.isQueueActive()) {
          // Loop Track: repeat current song, don't advance or consume the queue
          if (this.loopMode === LOOP_TRACK) {
              const song = this.getCurrentSong();
              return { type: 'seek', time: song.range[0] };
          }
          this.pushHistory();
          if (this._playFromQueue(false)) {
              return { type: 'load' };
          }
          // Queue exhausted (all items invalid), fall through to normal navigation
      }

      this._clearQueueCursor();
      const posContext = this._syncIndexToTime(currentTime, stream);
      const jumpToNextStreamStart = () => {
          this.nextStream();
          return { type: 'load' };
      };
      // Rule 0: treat whole video as a single segment.
      if (!stream.songs) {
          if (this.loopMode === LOOP_STREAM) {
              const start = this.getStreamDefaultStart(stream);
              return { type: 'seek', time: start };
          }
          return jumpToNextStreamStart();
      }

      // If before the first song, "next" goes TO song 0 (don't skip past it)
      if (posContext === 'before') {
          this.rIdx = 0;
          return this.yapMode
              ? { type: 'seek', time: stream.songs[0].range[0] }
              : { type: 'load' };
      }

      // If after the last song, go to next stream
      if (posContext === 'after') {
          if (this.loopMode === LOOP_STREAM) {
              this.rIdx = 0;
              return { type: 'load' };
          }
          return jumpToNextStreamStart();
      }

      // Yap mode advances within the continuous range without reloading.
      if (this.yapMode) {
          if (this.rIdx < stream.songs.length - 1) {
              this.rIdx++;
              return { type: 'seek', time: stream.songs[this.rIdx].range[0] };
          } else {
              this.nextStream();
              return { type: 'load' };
          }
      }

      // Standard segmented playback reloads so end bounds remain enforced.
      // For 'gap' context, rIdx points to the song that just ended, so rIdx++ goes to the next song.
      if (this.rIdx < stream.songs.length - 1) {
          this.rIdx++;
          return { type: 'load' };
      } else {
          if (this.loopMode === LOOP_STREAM) {
              this.rIdx = 0;
              return { type: 'load' };
          } else {
             return jumpToNextStreamStart();
          }
      }
  }

  prevSong(currentTime = 0) {
      const stream = this.getCurrentStream();

      if (this.isQueueActive()) {
          // Drop a stale cursor (playback moved off the queue item without
          // going through the queue) so the branches below pick circular-nav
          // vs enter-from-back correctly.
          this._reconcileQueueCursor();
          // Shuffle + Loop Queue: use history to go back (play order is random,
          // so cursor arithmetic can't reconstruct it).
          if (this.loopMode === LOOP_STREAM && this.shuffleMode) {
              // Walk history for an entry whose stream is still in the queue
              while (this.history.length > 0) {
                  const prev = this.history.pop();
                  const hStream = this.playlist[prev.vIdx];
                  if (hStream && this.queue.some(q => q.videoId === hStream.videoId)) {
                      this.vIdx = prev.vIdx;
                      if (hStream.songs && hStream.songs.length > 0) {
                          this.rIdx = Math.min(Math.max(prev.rIdx || 0, 0), hStream.songs.length - 1);
                      } else {
                          this.rIdx = 0;
                      }
                      // Re-attach the cursor to a matching slot so the cycle
                      // has a correct position if shuffle is turned off later.
                      let slot = this.queue.findIndex(q => q.videoId === hStream.videoId && q.rIdx === this.rIdx);
                      if (slot === -1) slot = this.queue.findIndex(q => q.videoId === hStream.videoId);
                      this._queueCursor = slot === -1 ? null : slot;
                      this._cursorDetached = false;
                      const song = this.getCurrentSong();
                      this._saveState(song ? song.range[0] : 0);
                      return { type: 'load' };
                  }
              }
              // No valid history — pick random from queue
              if (this._playFromQueue(true)) {
                  return { type: 'load' };
              }
          }
          // Non-shuffle Loop Queue: navigate backwards through the circular
          // queue, purely by moving the cursor — the arrangement is untouched.
          // With no cursor (restored session, or a stream reached via search),
          // this enters the queue from the back — the mirror image of Next
          // entering from the front.
          if (this.loopMode === LOOP_STREAM) {
              while (this.queue.length > 0) {
                  const target = this._prevQueueIndex();
                  if (!this._cursorDetached && target === this._queueCursor) {
                      // Single-item cycle wraps to itself — restart below.
                      break;
                  }
                  const item = this.queue[target];
                  const idx = this.playlist.findIndex(p => p.videoId === item.videoId);
                  if (idx === -1) {
                      this._removeQueueIndex(target); // drop invalid, keep scanning
                      continue;
                  }
                  this.pushHistory();
                  this._queueCursor = target;
                  this._cursorDetached = false;
                  this.vIdx = idx;
                  const pStream = this.playlist[idx];
                  this.rIdx = (pStream.songs && item.rIdx < pStream.songs.length)
                      ? item.rIdx : 0;
                  const song = this.getCurrentSong();
                  this._saveState(song ? song.range[0] : 0);
                  return { type: 'load' };
              }
              // Queue emptied (all invalid) or wrapped to itself — restart.
          }
          // Non-Loop-Queue with queue active, or nothing to go back to:
          // restart current song
          const song = this.getCurrentSong();
          if (song) {
              return { type: 'seek', time: song.range[0] };
          }
      }

      this._clearQueueCursor();
      const posContext = this._syncIndexToTime(currentTime, stream);

      const jumpToPreviousStreamEnd = () => {
          this.prevStream();
          const prev = this.getCurrentStream();
          if (prev && prev.songs && prev.songs.length > 0) {
              this.rIdx = prev.songs.length - 1;
              return { type: 'load' };
          }
          return { type: 'load' };
      };
      
      // Rule 0: whole stream is single song
      if (!stream.songs || stream.songs.length === 0) {
          const start = this.getStreamDefaultStart(stream);
          if (currentTime - start > RESTART_THRESHOLD_SECONDS) {
              return { type: 'seek', time: start };
          }
          if (this.loopMode === LOOP_STREAM) {
              // single-song stream wraps by seeking back to start
              return { type: 'seek', time: start };
          }
          return jumpToPreviousStreamEnd();
      }

      // If before the first song, go to previous stream
      if (posContext === 'before') {
          if (this.loopMode === LOOP_STREAM) {
              this.rIdx = stream.songs.length - 1;
              const wrapStart = stream.songs[this.rIdx].range[0];
              return this.yapMode
                  ? { type: 'seek', time: wrapStart }
                  : { type: 'seek', time: wrapStart, reload: true };
          }
          return jumpToPreviousStreamEnd();
      }

      // If in a gap after a song, or after the last song, go back to that song
      if (posContext === 'gap' || posContext === 'after') {
          const targetStart = stream.songs[this.rIdx].range[0];
          return this.yapMode
              ? { type: 'seek', time: targetStart }
              : { type: 'load' };
      }

      const song = stream.songs[this.rIdx];
      const start = song.range[0];

      if (currentTime - start > RESTART_THRESHOLD_SECONDS) {
          return { type: 'seek', time: start };
      }

      if (this.rIdx > 0) {
          this.rIdx--;
          if (this.yapMode) {
              return { type: 'seek', time: stream.songs[this.rIdx].range[0] };
          }
          return { type: 'load' };
      } else {
          if (this.loopMode === LOOP_STREAM && stream.songs && stream.songs.length > 0) {
              this.rIdx = stream.songs.length - 1;
              const wrapStart = stream.songs[this.rIdx].range[0];
              const action = { type: 'seek', time: wrapStart };
              if (!this.yapMode) {
                  action.reload = true;
              }
              return action;
          }
          return jumpToPreviousStreamEnd();
      }
  }
  
  // ================= PLAYBACK TICK LOGIC =================

  // Enforces per-song boundaries specified in behavior.md §4A/§4E.
  checkTick(currentTime) {
      const stream = this.getCurrentStream();
      if (!stream) return;

      if (!stream.songs) {
          return;
      }

      if (this.yapMode) {
           this._syncIndexToTime(currentTime, stream);
           const lastSong = stream.songs[stream.songs.length - 1];
           if (currentTime >= lastSong.range[1] - 0.2) { // SEEK_EARLY
               this.nextStream();
               this.cb.playVideo(); // Trigger load
           }
           return;
      }

      const currentSong = stream.songs[this.rIdx];

      if (currentTime < currentSong.range[0] - 1 || currentTime > currentSong.range[1] + 1) {
          const matchIdx = stream.songs.findIndex(s => currentTime >= s.range[0] && currentTime < s.range[1]);
          if (matchIdx !== -1) {
              this.rIdx = matchIdx;
          } else {
              // Manual seeks into gaps should play uninterrupted (behavior §4E).
          }
          return; 
      }

      const nextSong = stream.songs[this.rIdx + 1];
      const hasSeamlessNext =
          !!nextSong &&
          Math.abs((nextSong.range[0] ?? 0) - (currentSong.range[1] ?? 0)) <= SEAMLESS_GAP_SECONDS;

      // In non-yap mode, if two segments neighbor each other seamlessly,
      // we do not auto-advance at that internal boundary – we just let
      // playback continue and rely on status text updating from rIdx tracking.
      if (!hasSeamlessNext && currentTime >= currentSong.range[1] - 0.2) {
          this.advanceAuto();
      }
  }

  onVideoEnded() {
      this.advanceAuto();
  }

  advanceAuto() {
      if (this.loopMode === LOOP_TRACK) {
          this.cb.seekTo(this.getCurrentSong().range[0]);
          return;
      }

      if (this.isQueueActive()) {
          if (this._playFromQueue(true)) {
              this.cb.playVideo();
              return;
          }
          // Queue exhausted, fall through to normal auto-advance
      }

      this._clearQueueCursor();
      const stream = this.getCurrentStream();
      if (!stream.songs) {
           if (this.loopMode === LOOP_STREAM) {
               this.cb.seekTo(0);
           } else {
               this.nextStream();
               this.cb.playVideo();
           }
           return;
      }

      if (this.rIdx < stream.songs.length - 1) {
          this.rIdx++;
          this.cb.playVideo(); 
      } else {
          if (this.loopMode === LOOP_STREAM) {
              this.rIdx = 0;
              this.cb.playVideo();
          } else {
              this.nextStream();
              this.cb.playVideo();
          }
      }
  }

  // Status Text Generation
  getStatusText(currentTime) {
      const stream = this.getCurrentStream();
      if (!stream) return "Loading...";
      
      const suffix = this.yapMode ? ' with Yapping' : '';

      if (!stream.songs) {
          const text = stream.title || "Unknown Video";
          return `${text} (1/1)${suffix}`;
      }

      const gapStatus = this._getGapStatus(currentTime, stream.songs, suffix);
      if (gapStatus) {
          return gapStatus;
      }

      // Determine active song based on time (for Yap/Seek accuracy)
      const { name, index } = this._getActiveSongDisplayInfo(currentTime, stream.songs);
      const base = `${name} (${index + 1}/${stream.songs.length})`;
      return `${base}${suffix}`;
  }

  // So UI and status text agree on "which song is active"
  _getActiveSongDisplayInfo(currentTime, songs) {
      const idx = this._findSongIndexForTime(currentTime, songs);
      const safeIdx = (idx >= 0 && idx < songs.length) ? idx : 0;
      const song = songs[safeIdx];
      const name = song && song.name ? song.name : "Unknown Track";
      return { song, name, index: safeIdx };
  }

  _getGapStatus(currentTime, songs, suffix) {
      // In Yap mode, or if user sought manually, rIdx might not match time
      // We should find if the currentTime lands in any gap or outside bounds.
      if (currentTime < songs[0].range[0]) {
          // Avoid "Next: first song" flashing between songs
          if (this.rIdx > 0 && this.rIdx < songs.length) {
              return null;
          }
          const text = `Next: ${songs[0].name}`;
          const info = `(1/${songs.length})`;
          return `${text} ${info}${suffix}`;
      }

      for (let i = 0; i < songs.length - 1; i++) {
          if (currentTime >= songs[i].range[1] && currentTime < songs[i + 1].range[0]) {
              const text = `Next: ${songs[i + 1].name}`;
              const info = `(${i + 2}/${songs.length})`;
              return `${text} ${info}${suffix}`;
          }
      }

      // Past end
      if (currentTime >= songs[songs.length - 1].range[1]) {
          return "Stream Ending...";
      }
      return null;
  }

  _findSongIndexForTime(currentTime, songs) {
      const matchIdx = songs.findIndex(s => currentTime >= s.range[0] && currentTime < s.range[1]);
      if (matchIdx !== -1) {
          return matchIdx;
      }
      if (this.rIdx >= 0 && this.rIdx < songs.length) {
          return this.rIdx;
      }
      return 0;
  }

  // Returns the active song name for a given time
  // when inside a song segment, or null when outside (gaps / Rule 0).
  getActiveSongName(currentTime, fallback = "Unknown Track") {
      const stream = this.getCurrentStream();
      if (!stream || !stream.songs || !stream.songs.length) {
          return null;
      }
      const songs = stream.songs;
      const inSongIdx = songs.findIndex(s => currentTime >= s.range[0] && currentTime < s.range[1]);
      if (inSongIdx === -1) {
          // Outside any defined song – let the UI fall back to full status text.
          return null;
      }
      const info = this._getActiveSongDisplayInfo(currentTime, songs);
      return info.name || fallback;
  }

  syncToTime(currentTime) {
      this._syncIndexToTime(currentTime);
  }

  // Returns position context: 'inside' | 'before' | 'gap' | 'after'
  // Also updates rIdx appropriately for gap positions
  _syncIndexToTime(currentTime, stream = this.getCurrentStream()) {
      if (!Number.isFinite(currentTime) || !stream || !stream.songs || stream.songs.length === 0) {
          return 'none';
      }
      const songs = stream.songs;

      // Check if inside any song
      const matchIdx = songs.findIndex((s) => currentTime >= s.range[0] && currentTime < s.range[1]);
      if (matchIdx !== -1) {
          this.rIdx = matchIdx;
          return 'inside';
      }

      // Before the first song
      if (currentTime < songs[0].range[0]) {
          this.rIdx = 0;
          return 'before';
      }

      // After the last song
      if (currentTime >= songs[songs.length - 1].range[1]) {
          this.rIdx = songs.length - 1;
          return 'after';
      }

      // In a gap between songs - find which gap and set rIdx to the preceding song
      for (let i = 0; i < songs.length - 1; i++) {
          if (currentTime >= songs[i].range[1] && currentTime < songs[i + 1].range[0]) {
              this.rIdx = i;
              return 'gap';
          }
      }

      return 'none';
  }
}
