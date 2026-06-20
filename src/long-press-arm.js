// Coarse-pointer long-press → reveal an "armed" action button (add / remove) on a
// list item, instead of acting immediately. Tapping the revealed button performs the
// action; tapping anywhere else dismisses it with no other effect. Only one item is
// armed at a time, app-wide.
//
// The reveal/dismiss machinery is gated to coarse pointers (touch): fine-pointer users
// keep their always-visible inline +/− buttons, so this code stays dormant for them.

export const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 5;

// The currently armed list item (the element carrying the `.armed` class), or null.
let armedItem = null;
// Document-level listeners are attached only while something is armed.
let docPointerDownHandler = null;
let docClickHandler = null;

function isCoarsePointer() {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Attach long-press detection to a list item (coarse pointers only). Held past
 * LONG_PRESS_MS, `onLongPress` fires (typically calling arm()). Also suppresses the
 * gesture's own trailing click so the item isn't selected/played on release.
 *
 * IMPORTANT: call this BEFORE attaching the item's own play/select click handler, so
 * the suppressor below (which uses stopImmediatePropagation) runs first and can cancel
 * the same-element handler registered after it.
 *
 * @param {HTMLElement} item
 * @param {() => void} onLongPress
 */
export function attachLongPress(item, onLongPress) {
    if (!isCoarsePointer()) return;

    let pressTimer = null;
    let pressTriggered = false;
    let startX = 0;
    let startY = 0;

    const cancel = () => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    };

    item.addEventListener('pointerdown', (e) => {
        pressTriggered = false;
        startX = e.clientX;
        startY = e.clientY;
        cancel();
        pressTimer = setTimeout(() => {
            pressTimer = null;
            pressTriggered = true;
            onLongPress();
        }, LONG_PRESS_MS);
    });
    item.addEventListener('pointerup', cancel);
    item.addEventListener('pointerleave', cancel);
    item.addEventListener('pointercancel', cancel);
    item.addEventListener('pointermove', (e) => {
        if (!pressTimer) return;
        if (Math.abs(e.clientX - startX) > MOVE_CANCEL_PX
            || Math.abs(e.clientY - startY) > MOVE_CANCEL_PX) {
            cancel();
        }
    });
    item.addEventListener('click', (e) => {
        if (pressTriggered) {
            pressTriggered = false;
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    });
}

function getArmedActionButton() {
    if (!armedItem) return null;
    return armedItem.querySelector('.enqueue-btn, .queue-item-remove');
}

function teardownDocListeners() {
    if (docPointerDownHandler) {
        document.removeEventListener('pointerdown', docPointerDownHandler, true);
        docPointerDownHandler = null;
    }
    if (docClickHandler) {
        document.removeEventListener('click', docClickHandler, true);
        docClickHandler = null;
    }
}

// A fresh gesture started after arming. Begin listening for ITS click so we can either
// dismiss or let the armed button confirm. The arming gesture fires onLongPress while
// the finger is still down, so its own trailing click lands before any new pointerdown —
// with no click listener attached yet, that trailing click can't dismiss the just-armed
// button. (This is why we wait for the next pointerdown rather than attaching eagerly.)
function onDocPointerDown() {
    if (!docClickHandler) {
        docClickHandler = onDocClick;
        document.addEventListener('click', docClickHandler, true);
    }
}

function onDocClick(e) {
    if (!armedItem) {
        teardownDocListeners();
        return;
    }
    const btn = getArmedActionButton();
    if (btn && (e.target === btn || btn.contains(e.target))) {
        // Tap on the armed action button: let its own handler run the action (it calls
        // disarm() afterward). Don't consume.
        return;
    }
    // Outside tap (including a different item): dismiss with no other effect. Capture
    // phase guarantees this runs before the tapped item's handlers, so nothing plays.
    e.preventDefault();
    e.stopPropagation();
    disarm();
}

/**
 * Reveal the armed action button for `item`. Disarms any previously armed item.
 * @param {HTMLElement} item
 * @param {{inQueue?: boolean}} [opts] inQueue tints the + box to signal it's already queued.
 */
export function arm(item, { inQueue = false } = {}) {
    if (armedItem === item) return;
    if (armedItem) disarm();

    armedItem = item;
    item.classList.add('armed');
    item.classList.toggle('in-queue', !!inQueue);

    docPointerDownHandler = onDocPointerDown;
    document.addEventListener('pointerdown', docPointerDownHandler, true);
}

/** Dismiss any armed item and remove global listeners. Safe to call when nothing is armed. */
export function disarm() {
    teardownDocListeners();
    if (armedItem) {
        armedItem.classList.remove('armed', 'in-queue');
        armedItem = null;
    }
}

export function isArmed() {
    return armedItem !== null;
}
