import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read index.html once at module load time for efficiency
const indexPath = resolve(import.meta.dirname, '../index.html');
const indexHtml = readFileSync(indexPath, 'utf-8');

// Extract body content, stripping <script> tags (we don't want the real app running)
const bodyMatch = indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
const bodyContent = bodyMatch
  ? bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '')
  : '';

/**
 * Sets up the DOM structure for integration tests.
 * Reads directly from index.html so tests stay in sync with the real markup.
 */
export function setupDOM() {
  document.body.innerHTML = bodyContent;
}

/**
 * Creates a mock YouTube IFrame API player.
 * @returns {Object} Mock player instance with spy methods
 */
export function mockYouTubeAPI() {
  const mockPlayer = {
    currentTime: 0,
    playerState: 1, // PLAYING
    duration: 300,
    getCurrentTime: vi.fn(function() { return this.currentTime; }),
    getPlayerState: vi.fn(function() { return this.playerState; }),
    getDuration: vi.fn(function() { return this.duration; }),
    seekTo: vi.fn(),
    loadVideoById: vi.fn(),
    getVideoData: vi.fn(() => ({ title: 'Mock Video' })),
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
  };

  window.YT = {
    PlayerState: {
      UNSTARTED: -1,
      ENDED: 0,
      PLAYING: 1,
      PAUSED: 2,
      BUFFERING: 3,
      CUED: 5,
    },
    Player: vi.fn().mockImplementation((el, config) => {
      // Store config for later access in tests
      mockPlayer._config = config;
      // Simulate async onReady callback
      setTimeout(() => config.events?.onReady?.(), 0);
      return mockPlayer;
    }),
  };

  return mockPlayer;
}

/**
 * Dispatches a keyboard event on the document.
 * @param {string} key - The key value (e.g., 'Enter', 'Escape', 'ArrowDown')
 * @param {Object} options - Additional KeyboardEvent options
 * @returns {KeyboardEvent} The dispatched event
 */
export function pressKey(key, options = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  document.dispatchEvent(event);
  return event;
}

/**
 * Dispatches a keyboard event on a specific element.
 * @param {HTMLElement} element - Target element
 * @param {string} key - The key value
 * @param {Object} options - Additional KeyboardEvent options
 * @returns {KeyboardEvent} The dispatched event
 */
export function pressKeyOn(element, key, options = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  element.dispatchEvent(event);
  return event;
}

/**
 * Simulates a double-shift key press.
 * @param {number} delay - Delay between shifts in ms (default 100, must be < 300 to trigger)
 * @returns {Promise<void>}
 */
export function doubleShift(delay = 100) {
  pressKey('Shift');
  return new Promise(resolve => {
    setTimeout(() => {
      pressKey('Shift');
      resolve();
    }, delay);
  });
}

/**
 * Populates the status song list with mock songs.
 * @param {number} count - Number of songs to add
 * @returns {HTMLElement[]} Array of created song elements
 */
export function populateStatusSongList(count = 3) {
  const statusSongList = document.getElementById('status-song-list');
  const songs = [];
  
  for (let i = 0; i < count; i++) {
    const li = document.createElement('li');
    li.className = 'status-song';
    li.dataset.songIndex = String(i);
    li.tabIndex = 0;
    li.setAttribute('role', 'option');
    li.innerHTML = `
      <span class="status-song-index">${i + 1}.</span>
      <span class="status-song-name">Test Song ${i + 1}</span>
    `;
    statusSongList.appendChild(li);
    songs.push(li);
  }
  
  return songs;
}

/**
 * Populates search results with mock items.
 * @param {number} count - Number of results to add
 * @returns {HTMLElement[]} Array of created result elements
 */
export function populateSearchResults(count = 5) {
  const resultsContainer = document.getElementById('search-results');
  const results = [];
  
  for (let i = 0; i < count; i++) {
    const div = document.createElement('div');
    div.className = 'result-item';
    if (i === 0) div.classList.add('selected');
    div.innerHTML = `
      <span class="result-title">Search Result ${i + 1}</span>
      <span class="result-sub">Stream ${i + 1} • Song ${i + 1}</span>
    `;
    resultsContainer.appendChild(div);
    results.push(div);
  }
  
  return results;
}

/**
 * Clears localStorage and sessionStorage.
 */
export function clearStorage() {
  localStorage.clear();
  sessionStorage.clear();
}

