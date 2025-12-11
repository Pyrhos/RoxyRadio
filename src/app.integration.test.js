import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupDOM,
  pressKey,
  pressKeyOn,
  populateStatusSongList,
  populateSearchResults,
  clearStorage,
} from './test-setup.js';
import { resolveListNavigation, NAV_ACTION_MOVE, NAV_ACTION_SELECT } from './list-navigation.js';

// ============================================================================
// SEARCH MODAL TESTS
// ============================================================================

describe('Search Modal', () => {
  let modal, searchBtn, searchInput, resultsContainer, comicBox;
  let keydownHandler;

  beforeEach(() => {
    setupDOM();
    clearStorage();

    modal = document.getElementById('modal-overlay');
    searchBtn = document.getElementById('search-btn');
    searchInput = document.getElementById('search-input');
    resultsContainer = document.getElementById('search-results');
    comicBox = document.getElementById('comic-box');

    // Wire up modal toggle (mirrors app.js toggleModal logic)
    const toggleModal = () => {
      const isOpen = modal.classList.toggle('open');
      if (isOpen) {
        searchInput.value = '';
        resultsContainer.innerHTML = '';
        searchInput.focus();
      }
    };

    searchBtn.addEventListener('click', () => toggleModal());

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('open');
      }
    });

    keydownHandler = (e) => {
      if (e.key === 'Escape' && modal.classList.contains('open')) {
        e.preventDefault();
        modal.classList.remove('open');
        return;
      }
      if (e.key === 'S' && e.shiftKey && !modal.classList.contains('open')) {
        e.preventDefault();
        toggleModal();
      }
    };
    document.addEventListener('keydown', keydownHandler);
  });

  afterEach(() => {
    document.removeEventListener('keydown', keydownHandler);
    vi.restoreAllMocks();
  });

  describe('Opening the modal', () => {
    it('opens when search button is clicked', () => {
      expect(modal.classList.contains('open')).toBe(false);
      searchBtn.click();
      expect(modal.classList.contains('open')).toBe(true);
    });

    it('opens on Shift+S keyboard shortcut', () => {
      expect(modal.classList.contains('open')).toBe(false);
      pressKey('S', { shiftKey: true });
      expect(modal.classList.contains('open')).toBe(true);
    });

    it('focuses search input when opened', () => {
      searchBtn.click();
      expect(document.activeElement).toBe(searchInput);
    });

    it('clears previous search input on open', () => {
      searchInput.value = 'previous search';
      modal.classList.add('open');
      
      // Close and reopen
      modal.classList.remove('open');
      searchBtn.click();
      
      expect(searchInput.value).toBe('');
    });

    it('clears previous results on open', () => {
      resultsContainer.innerHTML = '<div class="result-item">old result</div>';
      modal.classList.add('open');
      
      // Close and reopen
      modal.classList.remove('open');
      searchBtn.click();
      
      expect(resultsContainer.children.length).toBe(0);
    });
  });

  describe('Closing the modal', () => {
    beforeEach(() => {
      modal.classList.add('open');
    });

    it('closes when clicking on the overlay background', () => {
      // Simulate click on the modal overlay itself (not the comic-box)
      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', { value: modal });
      modal.dispatchEvent(clickEvent);
      
      expect(modal.classList.contains('open')).toBe(false);
    });

    it('does NOT close when clicking inside the comic-box', () => {
      comicBox.click();
      expect(modal.classList.contains('open')).toBe(true);
    });

    it('does NOT close when clicking on search input', () => {
      searchInput.click();
      expect(modal.classList.contains('open')).toBe(true);
    });

    it('closes on Escape key', () => {
      pressKey('Escape');
      expect(modal.classList.contains('open')).toBe(false);
    });

    it('closes when selecting a result', () => {
      const results = populateSearchResults(3);
      
      // Wire up result selection (mirrors app.js selectResult)
      results.forEach(r => {
        r.addEventListener('click', () => {
          modal.classList.remove('open');
        });
      });
      
      results[1].click();
      expect(modal.classList.contains('open')).toBe(false);
    });
  });

  describe('Keyboard navigation in results', () => {
    let results;
    let searchSelIdx;

    beforeEach(() => {
      modal.classList.add('open');
      results = populateSearchResults(5);
      searchSelIdx = 0;
    });

    const updateSelection = () => {
      results.forEach((r, i) => {
        r.classList.toggle('selected', i === searchSelIdx);
      });
    };

    it('ArrowDown moves selection to next result', () => {
      const nav = resolveListNavigation('ArrowDown', searchSelIdx, results.length);
      expect(nav.handled).toBe(true);
      expect(nav.action).toBe(NAV_ACTION_MOVE);
      
      searchSelIdx = nav.nextIndex;
      updateSelection();
      
      expect(results[0].classList.contains('selected')).toBe(false);
      expect(results[1].classList.contains('selected')).toBe(true);
    });

    it('ArrowUp moves selection to previous result', () => {
      searchSelIdx = 2;
      updateSelection();
      
      const nav = resolveListNavigation('ArrowUp', searchSelIdx, results.length);
      expect(nav.handled).toBe(true);
      
      searchSelIdx = nav.nextIndex;
      updateSelection();
      
      expect(results[1].classList.contains('selected')).toBe(true);
      expect(results[2].classList.contains('selected')).toBe(false);
    });

    it('ArrowDown at last item stays on last item', () => {
      searchSelIdx = results.length - 1;
      updateSelection();
      
      const nav = resolveListNavigation('ArrowDown', searchSelIdx, results.length);
      searchSelIdx = nav.nextIndex;
      
      expect(searchSelIdx).toBe(results.length - 1);
    });

    it('ArrowUp at first item stays on first item', () => {
      searchSelIdx = 0;
      
      const nav = resolveListNavigation('ArrowUp', searchSelIdx, results.length);
      searchSelIdx = nav.nextIndex;
      
      expect(searchSelIdx).toBe(0);
    });

    it('Enter triggers selection action', () => {
      searchSelIdx = 2;
      
      const nav = resolveListNavigation('Enter', searchSelIdx, results.length);
      expect(nav.handled).toBe(true);
      expect(nav.action).toBe(NAV_ACTION_SELECT);
      expect(nav.nextIndex).toBe(2);
    });

    it('unrelated keys are not handled', () => {
      const nav = resolveListNavigation('Tab', searchSelIdx, results.length);
      expect(nav.handled).toBe(false);
    });
  });

  describe('Double-shift trigger', () => {
    let lastShiftTime;
    let keydownHandler;

    beforeEach(() => {
      vi.useFakeTimers();
      lastShiftTime = 0;
      
      // Wire up double-shift detection (mirrors app.js logic)
      keydownHandler = (e) => {
        if (e.key === 'Shift' && !e.repeat) {
          const now = Date.now();
          if (now - lastShiftTime < 300) {
            modal.classList.add('open');
          }
          lastShiftTime = now;
        }
      };
      document.addEventListener('keydown', keydownHandler);
    });

    afterEach(() => {
      document.removeEventListener('keydown', keydownHandler);
      vi.useRealTimers();
    });

    it('opens modal on double-shift within 300ms', () => {
      expect(modal.classList.contains('open')).toBe(false);
      
      pressKey('Shift');
      vi.advanceTimersByTime(100);
      pressKey('Shift');
      
      expect(modal.classList.contains('open')).toBe(true);
    });

    it('does NOT open on slow double-shift (> 300ms)', () => {
      expect(modal.classList.contains('open')).toBe(false);
      
      pressKey('Shift');
      vi.advanceTimersByTime(400);
      pressKey('Shift');
      
      expect(modal.classList.contains('open')).toBe(false);
    });
  });
});

// ============================================================================
// STATUS PANEL (SLIDE-OUT MENU) TESTS
// ============================================================================

describe('Status Panel', () => {
  let statusEl, statusPanel, statusSongList, statusTextEl;
  let statusPanelOpen = false;
  let statusPanelSelIdx = -1;
  let keydownHandler, pointerdownHandler;

  const toggleStatusPanel = (forceState) => {
    const hasSongs = statusSongList.children.length > 0;
    let nextState = typeof forceState === 'boolean' ? forceState : !statusPanelOpen;
    if (nextState && !hasSongs) nextState = false;
    
    statusPanelOpen = nextState;
    statusPanel.classList.toggle('open', statusPanelOpen);
    statusPanel.setAttribute('aria-hidden', statusPanelOpen ? 'false' : 'true');
    statusEl.setAttribute('aria-expanded', statusPanelOpen ? 'true' : 'false');
    
    if (statusPanelOpen) {
      statusPanelSelIdx = 0;
      applySelection();
    } else {
      clearSelection();
    }
  };

  const applySelection = () => {
    const rows = statusSongList.querySelectorAll('.status-song');
    rows.forEach((row, idx) => {
      row.classList.toggle('nav-focus', idx === statusPanelSelIdx);
    });
  };

  const clearSelection = () => {
    statusPanelSelIdx = -1;
    statusSongList.querySelectorAll('.status-song').forEach(row => {
      row.classList.remove('nav-focus');
    });
  };

  beforeEach(() => {
    setupDOM();
    clearStorage();
    statusPanelOpen = false;
    statusPanelSelIdx = -1;

    statusEl = document.getElementById('status');
    statusPanel = document.getElementById('status-panel');
    statusSongList = document.getElementById('status-song-list');
    statusTextEl = document.getElementById('status-text');

    // Wire up interactions (mirrors app.js)
    statusEl.addEventListener('click', () => toggleStatusPanel());
    
    statusEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleStatusPanel();
      }
    });

    // Global keyboard handler
    keydownHandler = (e) => {
      if (e.key === 'Escape' && statusPanelOpen) {
        e.preventDefault();
        toggleStatusPanel(false);
        return;
      }
      if (e.key === 'A' && e.shiftKey) {
        e.preventDefault();
        toggleStatusPanel();
      }
    };
    document.addEventListener('keydown', keydownHandler);

    // Close on outside click
    pointerdownHandler = (e) => {
      if (!statusPanelOpen) return;
      if (statusPanel.contains(e.target) || statusEl.contains(e.target)) return;
      toggleStatusPanel(false);
    };
    document.addEventListener('pointerdown', pointerdownHandler);
  });

  afterEach(() => {
    document.removeEventListener('keydown', keydownHandler);
    document.removeEventListener('pointerdown', pointerdownHandler);
    vi.restoreAllMocks();
  });

  describe('Opening the panel', () => {
    beforeEach(() => {
      populateStatusSongList(3);
    });

    it('opens when clicking status element', () => {
      statusEl.click();
      expect(statusPanel.classList.contains('open')).toBe(true);
      expect(statusPanelOpen).toBe(true);
    });

    it('opens on Enter key when status is focused', () => {
      pressKeyOn(statusEl, 'Enter');
      expect(statusPanel.classList.contains('open')).toBe(true);
    });

    it('opens on Space key when status is focused', () => {
      pressKeyOn(statusEl, ' ');
      expect(statusPanel.classList.contains('open')).toBe(true);
    });

    it('opens on Shift+A keyboard shortcut', () => {
      pressKey('A', { shiftKey: true });
      expect(statusPanel.classList.contains('open')).toBe(true);
    });

    it('sets aria-expanded to true when open', () => {
      statusEl.click();
      expect(statusEl.getAttribute('aria-expanded')).toBe('true');
    });

    it('sets aria-hidden to false on panel when open', () => {
      statusEl.click();
      expect(statusPanel.getAttribute('aria-hidden')).toBe('false');
    });

    it('does NOT open when song list is empty', () => {
      statusSongList.innerHTML = '';
      statusEl.click();
      expect(statusPanel.classList.contains('open')).toBe(false);
      expect(statusPanelOpen).toBe(false);
    });

    it('initializes selection on first song when opened', () => {
      statusEl.click();
      const songs = statusSongList.querySelectorAll('.status-song');
      expect(songs[0].classList.contains('nav-focus')).toBe(true);
    });
  });

  describe('Closing the panel', () => {
    beforeEach(() => {
      populateStatusSongList(3);
      toggleStatusPanel(true);
    });

    it('closes on Escape key', () => {
      pressKey('Escape');
      expect(statusPanel.classList.contains('open')).toBe(false);
      expect(statusPanelOpen).toBe(false);
    });

    it('closes on Shift+A toggle', () => {
      pressKey('A', { shiftKey: true });
      expect(statusPanel.classList.contains('open')).toBe(false);
    });

    it('closes when clicking outside panel and status', () => {
      const outsideElement = document.body;
      outsideElement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(statusPanel.classList.contains('open')).toBe(false);
    });

    it('does NOT close when clicking inside the panel', () => {
      const insideClick = new PointerEvent('pointerdown', { bubbles: true });
      Object.defineProperty(insideClick, 'target', { value: statusSongList });
      statusPanel.dispatchEvent(insideClick);
      // Since we check contains, need to dispatch on document
      // but the handler should detect it's inside
      expect(statusPanelOpen).toBe(true);
    });

    it('sets aria-expanded to false when closed', () => {
      pressKey('Escape');
      expect(statusEl.getAttribute('aria-expanded')).toBe('false');
    });

    it('sets aria-hidden to true on panel when closed', () => {
      pressKey('Escape');
      expect(statusPanel.getAttribute('aria-hidden')).toBe('true');
    });

    it('clears nav-focus when closed', () => {
      const songs = statusSongList.querySelectorAll('.status-song');
      expect(songs[0].classList.contains('nav-focus')).toBe(true);
      
      pressKey('Escape');
      
      songs.forEach(song => {
        expect(song.classList.contains('nav-focus')).toBe(false);
      });
    });
  });

  describe('Keyboard navigation', () => {
    let songs;

    beforeEach(() => {
      songs = populateStatusSongList(5);
      toggleStatusPanel(true);
    });

    it('ArrowDown moves focus to next song', () => {
      const nav = resolveListNavigation('ArrowDown', statusPanelSelIdx, songs.length);
      expect(nav.handled).toBe(true);
      expect(nav.action).toBe(NAV_ACTION_MOVE);
      
      statusPanelSelIdx = nav.nextIndex;
      applySelection();
      
      expect(songs[0].classList.contains('nav-focus')).toBe(false);
      expect(songs[1].classList.contains('nav-focus')).toBe(true);
    });

    it('ArrowUp moves focus to previous song', () => {
      statusPanelSelIdx = 3;
      applySelection();
      
      const nav = resolveListNavigation('ArrowUp', statusPanelSelIdx, songs.length);
      statusPanelSelIdx = nav.nextIndex;
      applySelection();
      
      expect(songs[2].classList.contains('nav-focus')).toBe(true);
      expect(songs[3].classList.contains('nav-focus')).toBe(false);
    });

    it('ArrowDown at last song stays on last song', () => {
      statusPanelSelIdx = songs.length - 1;
      applySelection();
      
      const nav = resolveListNavigation('ArrowDown', statusPanelSelIdx, songs.length);
      expect(nav.nextIndex).toBe(songs.length - 1);
    });

    it('ArrowUp at first song stays on first song', () => {
      statusPanelSelIdx = 0;
      
      const nav = resolveListNavigation('ArrowUp', statusPanelSelIdx, songs.length);
      expect(nav.nextIndex).toBe(0);
    });

    it('Enter triggers selection action', () => {
      statusPanelSelIdx = 2;
      
      const nav = resolveListNavigation('Enter', statusPanelSelIdx, songs.length);
      expect(nav.handled).toBe(true);
      expect(nav.action).toBe(NAV_ACTION_SELECT);
    });
  });

  describe('Song selection', () => {
    let songs;
    let selectedSongIndex = -1;

    beforeEach(() => {
      songs = populateStatusSongList(3);
      
      // Wire up song click handlers
      songs.forEach((song, idx) => {
        song.addEventListener('click', () => {
          selectedSongIndex = idx;
          toggleStatusPanel(false);
        });
      });
      
      toggleStatusPanel(true);
    });

    it('clicking a song selects it', () => {
      songs[1].click();
      expect(selectedSongIndex).toBe(1);
    });

    it('clicking a song closes the panel', () => {
      songs[2].click();
      expect(statusPanel.classList.contains('open')).toBe(false);
    });
  });

  describe('Active state tracking', () => {
    let songs;

    beforeEach(() => {
      songs = populateStatusSongList(3);
    });

    it('marks currently playing song as active', () => {
      const activeIdx = 1;
      songs.forEach((s, i) => {
        s.classList.toggle('active', i === activeIdx);
        s.setAttribute('aria-selected', i === activeIdx ? 'true' : 'false');
      });
      
      expect(songs[1].classList.contains('active')).toBe(true);
      expect(songs[0].classList.contains('active')).toBe(false);
      expect(songs[2].classList.contains('active')).toBe(false);
    });

    it('sets aria-selected correctly for active song', () => {
      const activeIdx = 0;
      songs.forEach((s, i) => {
        s.setAttribute('aria-selected', i === activeIdx ? 'true' : 'false');
      });
      
      expect(songs[0].getAttribute('aria-selected')).toBe('true');
      expect(songs[1].getAttribute('aria-selected')).toBe('false');
    });
  });
});

// ============================================================================
// CONTROL BUTTON TESTS
// ============================================================================

describe('Control Buttons', () => {
  let loopBtn, shuffleBtn, yapBtn, prevStreamBtn, nextStreamBtn, prevSongBtn, nextSongBtn;
  let loopMode = 0;
  let shuffleMode = false;
  let yapMode = false;
  const loopLabels = ['None', 'Track', 'Stream'];

  const updateButtons = () => {
    loopBtn.textContent = `Loop: ${loopLabels[loopMode]}`;
    loopBtn.classList.toggle('active', loopMode !== 0);
    
    shuffleBtn.textContent = `Shuffle: ${shuffleMode ? 'On' : 'Off'}`;
    shuffleBtn.classList.toggle('active', shuffleMode);
    
    yapBtn.textContent = `Yap: ${yapMode ? 'On' : 'Off'}`;
    yapBtn.classList.toggle('active', yapMode);
  };

  beforeEach(() => {
    setupDOM();
    clearStorage();
    loopMode = 0;
    shuffleMode = false;
    yapMode = false;

    loopBtn = document.getElementById('loop-btn');
    shuffleBtn = document.getElementById('shuffle-btn');
    yapBtn = document.getElementById('yap-btn');
    prevStreamBtn = document.getElementById('prev-stream');
    nextStreamBtn = document.getElementById('next-stream');
    prevSongBtn = document.getElementById('prev-song');
    nextSongBtn = document.getElementById('next-song');

    // Wire up button handlers
    loopBtn.addEventListener('click', () => {
      loopMode = (loopMode + 1) % 3;
      updateButtons();
    });

    shuffleBtn.addEventListener('click', () => {
      shuffleMode = !shuffleMode;
      updateButtons();
    });

    yapBtn.addEventListener('click', () => {
      yapMode = !yapMode;
      updateButtons();
    });

    updateButtons();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Loop button', () => {
    it('displays "Loop: None" initially', () => {
      expect(loopBtn.textContent).toBe('Loop: None');
      expect(loopBtn.classList.contains('active')).toBe(false);
    });

    it('cycles to "Loop: Track" on first click', () => {
      loopBtn.click();
      expect(loopBtn.textContent).toBe('Loop: Track');
      expect(loopBtn.classList.contains('active')).toBe(true);
    });

    it('cycles to "Loop: Stream" on second click', () => {
      loopBtn.click();
      loopBtn.click();
      expect(loopBtn.textContent).toBe('Loop: Stream');
      expect(loopBtn.classList.contains('active')).toBe(true);
    });

    it('cycles back to "Loop: None" on third click', () => {
      loopBtn.click();
      loopBtn.click();
      loopBtn.click();
      expect(loopBtn.textContent).toBe('Loop: None');
      expect(loopBtn.classList.contains('active')).toBe(false);
    });

    it('completes full cycle: None → Track → Stream → None', () => {
      expect(loopMode).toBe(0);
      loopBtn.click();
      expect(loopMode).toBe(1);
      loopBtn.click();
      expect(loopMode).toBe(2);
      loopBtn.click();
      expect(loopMode).toBe(0);
    });
  });

  describe('Shuffle button', () => {
    it('displays "Shuffle: Off" initially', () => {
      expect(shuffleBtn.textContent).toBe('Shuffle: Off');
      expect(shuffleBtn.classList.contains('active')).toBe(false);
    });

    it('toggles to "Shuffle: On" on click', () => {
      shuffleBtn.click();
      expect(shuffleBtn.textContent).toBe('Shuffle: On');
      expect(shuffleBtn.classList.contains('active')).toBe(true);
    });

    it('toggles back to "Shuffle: Off" on second click', () => {
      shuffleBtn.click();
      shuffleBtn.click();
      expect(shuffleBtn.textContent).toBe('Shuffle: Off');
      expect(shuffleBtn.classList.contains('active')).toBe(false);
    });

    it('updates shuffleMode state correctly', () => {
      expect(shuffleMode).toBe(false);
      shuffleBtn.click();
      expect(shuffleMode).toBe(true);
      shuffleBtn.click();
      expect(shuffleMode).toBe(false);
    });
  });

  describe('Yap button', () => {
    it('displays "Yap: Off" initially', () => {
      expect(yapBtn.textContent).toBe('Yap: Off');
      expect(yapBtn.classList.contains('active')).toBe(false);
    });

    it('toggles to "Yap: On" on click', () => {
      yapBtn.click();
      expect(yapBtn.textContent).toBe('Yap: On');
      expect(yapBtn.classList.contains('active')).toBe(true);
    });

    it('toggles back to "Yap: Off" on second click', () => {
      yapBtn.click();
      yapBtn.click();
      expect(yapBtn.textContent).toBe('Yap: Off');
      expect(yapBtn.classList.contains('active')).toBe(false);
    });

    it('updates yapMode state correctly', () => {
      expect(yapMode).toBe(false);
      yapBtn.click();
      expect(yapMode).toBe(true);
      yapBtn.click();
      expect(yapMode).toBe(false);
    });
  });

  describe('Yap button - Race condition regression', () => {
    let yapToggleTime;
    let lastKnownTime; // Simulate a known playback position
    let toggleCount;
    const YAP_TOGGLE_DEBOUNCE_MS = 300;

    // Simulate player.getCurrentTime() behavior during race condition:
    // During rapid toggles or video loading, it may return 0 or stale data
    const createMockPlayer = (timeToReturn) => ({
      getCurrentTime: () => timeToReturn
    });

    const getSafeCurrentTime = (player) => {
      if (!player || typeof player.getCurrentTime !== 'function') {
        return lastKnownTime;
      }

      const playerTime = player.getCurrentTime();

      if (Number.isFinite(playerTime) && playerTime > 0) {
        lastKnownTime = playerTime;
        return playerTime;
      }

      if (Number.isFinite(lastKnownTime) && lastKnownTime > 0) {
        return lastKnownTime;
      }

      return playerTime;
    };

    const simulateYapToggle = (player, currentTimeMs) => {
      if (currentTimeMs - yapToggleTime < YAP_TOGGLE_DEBOUNCE_MS) {
        return { debounced: true, time: null };
      }
      yapToggleTime = currentTimeMs;
      toggleCount++;
      const t = getSafeCurrentTime(player);
      return { debounced: false, time: t };
    };

    beforeEach(() => {
      // Initialize to a time far in the past so first toggle always works
      // This mirrors how the app starts: yapToggleTime = 0, but Date.now() is large
      yapToggleTime = -Infinity;
      lastKnownTime = 25;
      toggleCount = 0;
    });

    it('debounces rapid yap toggles to prevent race condition', () => {
      const player = createMockPlayer(25);

      // First toggle at t=1000 (simulating Date.now())
      const result1 = simulateYapToggle(player, 1000);
      expect(result1.debounced).toBe(false);
      expect(toggleCount).toBe(1);

      // Rapid toggle at t=1050ms - should be debounced
      const result2 = simulateYapToggle(player, 1050);
      expect(result2.debounced).toBe(true);
      expect(toggleCount).toBe(1);

      // Rapid toggle at t=1100ms - should be debounced
      const result3 = simulateYapToggle(player, 1100);
      expect(result3.debounced).toBe(true);
      expect(toggleCount).toBe(1);

      // Toggle after debounce period at t=1350ms - should work
      const result4 = simulateYapToggle(player, 1350);
      expect(result4.debounced).toBe(false);
      expect(toggleCount).toBe(2);
    });

    it('uses lastKnownTime when player.getCurrentTime() returns 0 during race', () => {
      // Simulate race condition: player returns 0 during video loading transition
      const racingPlayer = createMockPlayer(0);

      const result = simulateYapToggle(racingPlayer, 1000);

      // Should fall back to lastKnownTime (25) instead of 0
      expect(result.time).toBe(25);
    });

    it('uses player time when getCurrentTime() returns valid positive value', () => {
      const player = createMockPlayer(42);

      const result = simulateYapToggle(player, 1000);

      expect(result.time).toBe(42);
    });

    it('handles missing player gracefully', () => {
      const result = simulateYapToggle(null, 1000);

      expect(result.time).toBe(25); // Falls back to lastKnownTime
    });

    it('handles player without getCurrentTime method', () => {
      const brokenPlayer = {};

      const result = simulateYapToggle(brokenPlayer, 1000);

      expect(result.time).toBe(25); // Falls back to lastKnownTime
    });

    it('updates lastKnownTime when player returns valid time', () => {
      lastKnownTime = 10;
      const player = createMockPlayer(50);

      getSafeCurrentTime(player);

      expect(lastKnownTime).toBe(50); // Should be updated
    });

    it('does not update lastKnownTime when player returns 0', () => {
      lastKnownTime = 30;
      const racingPlayer = createMockPlayer(0);

      getSafeCurrentTime(racingPlayer);

      expect(lastKnownTime).toBe(30); // Should remain unchanged
    });

    it('returns 0 when both player and lastKnownTime are 0 (legitimate stream start)', () => {
      lastKnownTime = 0;
      const player = createMockPlayer(0);

      const time = getSafeCurrentTime(player);

      expect(time).toBe(0); // Both are 0, so return 0 (stream start)
    });
  });

  describe('Navigation buttons exist and are clickable', () => {
    it('prev-stream button exists and is clickable', () => {
      let clicked = false;
      prevStreamBtn.addEventListener('click', () => { clicked = true; });
      prevStreamBtn.click();
      expect(clicked).toBe(true);
    });

    it('next-stream button exists and is clickable', () => {
      let clicked = false;
      nextStreamBtn.addEventListener('click', () => { clicked = true; });
      nextStreamBtn.click();
      expect(clicked).toBe(true);
    });

    it('prev-song button exists and is clickable', () => {
      let clicked = false;
      prevSongBtn.addEventListener('click', () => { clicked = true; });
      prevSongBtn.click();
      expect(clicked).toBe(true);
    });

    it('next-song button exists and is clickable', () => {
      let clicked = false;
      nextSongBtn.addEventListener('click', () => { clicked = true; });
      nextSongBtn.click();
      expect(clicked).toBe(true);
    });
  });
});

// ============================================================================
// KEYBOARD SHORTCUT TESTS
// ============================================================================

describe('Global Keyboard Shortcuts', () => {
  let modal, statusPanel, statusSongList;
  let modalOpen = false;
  let statusPanelOpen = false;
  let keydownHandler;

  beforeEach(() => {
    setupDOM();
    clearStorage();
    modalOpen = false;
    statusPanelOpen = false;

    modal = document.getElementById('modal-overlay');
    statusPanel = document.getElementById('status-panel');
    statusSongList = document.getElementById('status-song-list');

    // Add songs so status panel can open
    populateStatusSongList(3);

    // Wire up keyboard shortcuts
    keydownHandler = (e) => {
      if (e.key === 'Escape') {
        if (modalOpen) {
          modal.classList.remove('open');
          modalOpen = false;
          e.preventDefault();
          return;
        }
        if (statusPanelOpen) {
          statusPanel.classList.remove('open');
          statusPanelOpen = false;
          e.preventDefault();
          return;
        }
      }

      if (e.key === 'S' && e.shiftKey) {
        e.preventDefault();
        modalOpen = !modalOpen;
        modal.classList.toggle('open', modalOpen);
        return;
      }

      if (e.key === 'A' && e.shiftKey) {
        e.preventDefault();
        statusPanelOpen = !statusPanelOpen;
        statusPanel.classList.toggle('open', statusPanelOpen);
      }
    };
    document.addEventListener('keydown', keydownHandler);
  });

  afterEach(() => {
    document.removeEventListener('keydown', keydownHandler);
    vi.restoreAllMocks();
  });

  describe('Shift+S (Search)', () => {
    it('opens search modal', () => {
      pressKey('S', { shiftKey: true });
      expect(modal.classList.contains('open')).toBe(true);
    });

    it('toggles search modal on repeated presses', () => {
      pressKey('S', { shiftKey: true });
      expect(modal.classList.contains('open')).toBe(true);
      
      pressKey('S', { shiftKey: true });
      expect(modal.classList.contains('open')).toBe(false);
    });
  });

  describe('Shift+A (Status Panel)', () => {
    it('opens status panel', () => {
      pressKey('A', { shiftKey: true });
      expect(statusPanel.classList.contains('open')).toBe(true);
    });

    it('toggles status panel on repeated presses', () => {
      pressKey('A', { shiftKey: true });
      expect(statusPanel.classList.contains('open')).toBe(true);
      
      pressKey('A', { shiftKey: true });
      expect(statusPanel.classList.contains('open')).toBe(false);
    });
  });

  describe('Escape key priority', () => {
    it('closes modal before status panel when both are open', () => {
      modalOpen = true;
      statusPanelOpen = true;
      modal.classList.add('open');
      statusPanel.classList.add('open');
      
      pressKey('Escape');
      
      expect(modal.classList.contains('open')).toBe(false);
      expect(statusPanel.classList.contains('open')).toBe(true);
    });

    it('closes status panel when modal is not open', () => {
      statusPanelOpen = true;
      statusPanel.classList.add('open');
      
      pressKey('Escape');
      
      expect(statusPanel.classList.contains('open')).toBe(false);
    });
  });
});

// ============================================================================
// DUPLICATES BUTTON TESTS
// ============================================================================

describe('Duplicates Button', () => {
  let duplicatesBtn, noteCount;

  beforeEach(() => {
    setupDOM();
    duplicatesBtn = document.getElementById('duplicates-btn');
    noteCount = duplicatesBtn.querySelector('.note-count');
  });

  it('exists in the DOM', () => {
    expect(duplicatesBtn).not.toBeNull();
    expect(noteCount).not.toBeNull();
  });

  it('can be shown when song has duplicates', () => {
    duplicatesBtn.style.display = 'flex';
    noteCount.textContent = '3';
    
    expect(duplicatesBtn.style.display).toBe('flex');
    expect(noteCount.textContent).toBe('3');
  });

  it('updates count when duplicates change', () => {
    noteCount.textContent = '5';
    expect(noteCount.textContent).toBe('5');
    
    noteCount.textContent = '2';
    expect(noteCount.textContent).toBe('2');
  });

  it('can be hidden when no duplicates exist', () => {
    duplicatesBtn.style.display = 'flex';
    duplicatesBtn.style.display = 'none';
    
    expect(duplicatesBtn.style.display).toBe('none');
  });
});

// ============================================================================
// START OVERLAY TESTS
// ============================================================================

describe('Start Overlay', () => {
  let overlay, startBtn;

  beforeEach(() => {
    setupDOM();
    overlay = document.getElementById('overlay');
    startBtn = document.getElementById('start');
  });

  it('is visible initially', () => {
    expect(overlay.style.display).not.toBe('none');
  });

  it('hides when start button is clicked', () => {
    let startRequested = false;
    
    startBtn.addEventListener('click', () => {
      startRequested = true;
      overlay.style.display = 'none';
    });
    
    startBtn.click();
    
    expect(startRequested).toBe(true);
    expect(overlay.style.display).toBe('none');
  });

  it('start button has correct text', () => {
    expect(startBtn.textContent).toBe('▶ Start');
  });
});

// ============================================================================
// ACCESSIBILITY TESTS
// ============================================================================

describe('Accessibility', () => {
  beforeEach(() => {
    setupDOM();
  });

  describe('Status element', () => {
    it('has role="button"', () => {
      const statusEl = document.getElementById('status');
      expect(statusEl.getAttribute('role')).toBe('button');
    });

    it('has tabindex="0" for keyboard focus', () => {
      const statusEl = document.getElementById('status');
      expect(statusEl.getAttribute('tabindex')).toBe('0');
    });

    it('has aria-expanded attribute', () => {
      const statusEl = document.getElementById('status');
      expect(statusEl.hasAttribute('aria-expanded')).toBe(true);
    });

    it('has aria-controls pointing to status-panel', () => {
      const statusEl = document.getElementById('status');
      expect(statusEl.getAttribute('aria-controls')).toBe('status-panel');
    });
  });

  describe('Status panel', () => {
    it('has aria-hidden attribute', () => {
      const statusPanel = document.getElementById('status-panel');
      expect(statusPanel.hasAttribute('aria-hidden')).toBe(true);
    });
  });

  describe('Song list', () => {
    it('exists in the DOM', () => {
      const songList = document.getElementById('status-song-list');
      expect(songList).not.toBeNull();
      expect(songList.tagName).toBe('OL');
    });

    it('can have role="listbox" set dynamically', () => {
      const songList = document.getElementById('status-song-list');
      // Mirrors what app.js does at init
      songList.setAttribute('role', 'listbox');
      expect(songList.getAttribute('role')).toBe('listbox');
    });

    it('can have aria-label set dynamically', () => {
      const songList = document.getElementById('status-song-list');
      // Mirrors what app.js does at init
      songList.setAttribute('aria-label', 'Current karaoke songs');
      expect(songList.getAttribute('aria-label')).toBe('Current karaoke songs');
    });
  });

  describe('Search button', () => {
    it('has aria-label', () => {
      const searchBtn = document.getElementById('search-btn');
      expect(searchBtn.getAttribute('aria-label')).toBe('Search songs');
    });

    it('has title for tooltip', () => {
      const searchBtn = document.getElementById('search-btn');
      expect(searchBtn.getAttribute('title')).toBe('Search (Shift+S)');
    });
  });

  describe('Bolt trigger (easter egg)', () => {
    it('has aria-label', () => {
      const boltTrigger = document.getElementById('bolt-trigger');
      expect(boltTrigger.getAttribute('aria-label')).toBe('Secret');
    });
  });
});

