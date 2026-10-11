const FLASH_MS = 500;

/**
 * Shows a checkmark on an enqueue button briefly, acting as both
 * visual feedback and a debounce guard against rapid clicks.
 * @param {HTMLElement} btn - The .enqueue-btn element
 * @param {() => void} [onComplete] - Called after the flash reverts (e.g. to disarm).
 * @param {typeof setTimeout} [schedule] - Controller-owned timeout scheduler.
 */
export function flashEnqueue(btn, onComplete, schedule = setTimeout) {
    if (!btn || btn.classList.contains('enqueue-ok')) return;
    btn.classList.add('enqueue-ok');
    btn.textContent = '✓';
    schedule(() => {
        btn.classList.remove('enqueue-ok');
        btn.textContent = '+';
        if (typeof onComplete === 'function') onComplete();
    }, FLASH_MS);
}
