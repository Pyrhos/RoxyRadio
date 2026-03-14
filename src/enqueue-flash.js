export const LONG_PRESS_MS = 1000;
const FLASH_MS = 500;

/**
 * Shows a checkmark on an enqueue button briefly, acting as both
 * visual feedback and a debounce guard against rapid clicks.
 * @param {HTMLElement} btn - The .enqueue-btn element
 */
export function flashEnqueue(btn) {
    if (!btn || btn.classList.contains('enqueue-ok')) return;
    btn.classList.add('enqueue-ok');
    btn.textContent = '\u2713';
    setTimeout(() => {
        btn.classList.remove('enqueue-ok');
        btn.textContent = '+';
    }, FLASH_MS);
}
