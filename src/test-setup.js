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
 * Clears localStorage and sessionStorage.
 */
export function clearStorage() {
  localStorage.clear();
  sessionStorage.clear();
}

