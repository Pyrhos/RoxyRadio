export const LOOP_NONE = 0;
export const LOOP_TRACK = 1;
export const LOOP_STREAM = 2;
export const RESTART_THRESHOLD_SECONDS = 5;
const HISTORY_LIMIT = 20;
const SEAMLESS_GAP_SECONDS = 0.05; // Threshold to treat neighboring segments as seamless in Yap Off

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

    // Stream history powers deterministic back navigation (behavior §4C).
    // Session-only: cleared when tab closes, capped at HISTORY_LIMIT.
    this.history = [];
    // Rule 0 streams cache their durations once YouTube reports them.
    this.durations = {};
  }

  init(segmentData) {
    // Preserve empty song lists so Rule 0 streams play as a single track.
    this.playlist = segmentData.map(v => ({
      videoId: v.videoId,
      name: v.name || '',
      title: v.title || v.videoId, // Fallback title if provided or ID
      songs: (v.songs && v.songs.length > 0) ? v.songs : null
    }));

    const saved = this.cb.getSettings();
    this.yapMode = saved.yapMode === 'true' || saved.yapMode === true;
    this.shuffleMode = saved.shuffleMode === 'true' || saved.shuffleMode === true;
    
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
          loopMode: this.loopMode,
          vIdx: this.vIdx,
          videoId: stream ? stream.videoId : '',
          lastTime: currentTime.toFixed(2)
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
      this.vIdx = this._getNextStreamIndex();
      this.rIdx = 0;
      this._saveState(this.getStreamDefaultStart());
      return true; // Indicates change happened
  }

  prevStream(options = {}) {
    const { skipHistory = false } = options;
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
          } else if (this.loopMode === LOOP_TRACK) {
               return jumpToNextStreamStart();
          } else {
             return jumpToNextStreamStart();
          }
      }
  }

  prevSong(currentTime = 0) {
      const stream = this.getCurrentStream();
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
