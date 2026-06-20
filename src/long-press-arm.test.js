import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachLongPress, arm, disarm, isArmed, LONG_PRESS_MS } from './long-press-arm.js';

// Stub matchMedia so we can toggle coarse-pointer mode deterministically (happy-dom's
// default is fine-pointer). The module reads window.matchMedia fresh on each call.
let originalMatchMedia;
function setCoarse(on) {
    window.matchMedia = (q) => ({
        matches: on && /coarse/.test(q),
        media: q,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return false; },
    });
}

function fire(el, type, x = 0, y = 0) {
    const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    el.dispatchEvent(e);
    return e;
}

function makeItem(withButton) {
    const el = document.createElement('div');
    el.className = 'result-item';
    if (withButton) {
        const btn = document.createElement('button');
        btn.className = 'enqueue-btn';
        btn.textContent = '+';
        el.appendChild(btn);
    }
    document.body.appendChild(el);
    return el;
}

describe('long-press-arm', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        originalMatchMedia = window.matchMedia;
        setCoarse(true);
        vi.useFakeTimers();
    });

    afterEach(() => {
        disarm();
        vi.useRealTimers();
        window.matchMedia = originalMatchMedia;
    });

    describe('attachLongPress gesture', () => {
        it('fires onLongPress after the threshold', () => {
            const item = makeItem();
            const onLongPress = vi.fn();
            attachLongPress(item, onLongPress);

            fire(item, 'pointerdown');
            expect(onLongPress).not.toHaveBeenCalled();
            vi.advanceTimersByTime(LONG_PRESS_MS);
            expect(onLongPress).toHaveBeenCalledTimes(1);
        });

        it('does not fire if released before the threshold', () => {
            const item = makeItem();
            const onLongPress = vi.fn();
            attachLongPress(item, onLongPress);

            fire(item, 'pointerdown');
            fire(item, 'pointerup');
            vi.advanceTimersByTime(LONG_PRESS_MS);
            expect(onLongPress).not.toHaveBeenCalled();
        });

        it('does not fire if the pointer is cancelled', () => {
            const item = makeItem();
            const onLongPress = vi.fn();
            attachLongPress(item, onLongPress);

            fire(item, 'pointerdown');
            fire(item, 'pointercancel');
            vi.advanceTimersByTime(LONG_PRESS_MS);
            expect(onLongPress).not.toHaveBeenCalled();
        });

        it('does not fire if the pointer moves past the slop threshold', () => {
            const item = makeItem();
            const onLongPress = vi.fn();
            attachLongPress(item, onLongPress);

            fire(item, 'pointerdown', 0, 0);
            fire(item, 'pointermove', 10, 0); // > 5px
            vi.advanceTimersByTime(LONG_PRESS_MS);
            expect(onLongPress).not.toHaveBeenCalled();
        });

        it('is inert on fine pointers', () => {
            setCoarse(false);
            const item = makeItem();
            const onLongPress = vi.fn();
            attachLongPress(item, onLongPress);

            fire(item, 'pointerdown');
            vi.advanceTimersByTime(LONG_PRESS_MS);
            expect(onLongPress).not.toHaveBeenCalled();
        });

        it('suppresses the item\'s own click after a long-press, but not after a normal tap', () => {
            const item = makeItem();
            const selectSpy = vi.fn();
            attachLongPress(item, () => arm(item));
            item.addEventListener('click', selectSpy); // registered AFTER attachLongPress

            // Long-press: the trailing click must be suppressed.
            fire(item, 'pointerdown');
            vi.advanceTimersByTime(LONG_PRESS_MS);
            fire(item, 'click');
            expect(selectSpy).not.toHaveBeenCalled();

            disarm();

            // Normal quick tap: the click should go through.
            fire(item, 'pointerdown');
            fire(item, 'pointerup');
            fire(item, 'click');
            expect(selectSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('arm / disarm', () => {
        it('arms an item and toggles the in-queue tint', () => {
            const a = makeItem();
            arm(a, { inQueue: true });
            expect(isArmed()).toBe(true);
            expect(a.classList.contains('armed')).toBe(true);
            expect(a.classList.contains('in-queue')).toBe(true);

            disarm();
            expect(isArmed()).toBe(false);
            expect(a.classList.contains('armed')).toBe(false);
            expect(a.classList.contains('in-queue')).toBe(false);
        });

        it('arms without the tint when not queued', () => {
            const a = makeItem();
            arm(a, { inQueue: false });
            expect(a.classList.contains('armed')).toBe(true);
            expect(a.classList.contains('in-queue')).toBe(false);
        });

        it('keeps only one item armed at a time', () => {
            const a = makeItem();
            const b = makeItem();
            arm(a);
            arm(b);
            expect(a.classList.contains('armed')).toBe(false);
            expect(b.classList.contains('armed')).toBe(true);
        });
    });

    describe('dismiss behaviour', () => {
        it('does not dismiss on the arming gesture\'s own trailing click', () => {
            const item = makeItem();
            attachLongPress(item, () => arm(item));

            fire(item, 'pointerdown');
            vi.advanceTimersByTime(LONG_PRESS_MS);
            expect(isArmed()).toBe(true);

            // Trailing click of the SAME gesture (no fresh pointerdown yet).
            fire(item, 'click');
            expect(isArmed()).toBe(true);
        });

        it('dismisses and consumes a tap outside on the next gesture', () => {
            const item = makeItem();
            const outside = document.createElement('div');
            const outsideClick = vi.fn();
            outside.addEventListener('click', outsideClick);
            document.body.appendChild(outside);

            attachLongPress(item, () => arm(item));
            fire(item, 'pointerdown');
            vi.advanceTimersByTime(LONG_PRESS_MS);
            fire(item, 'click'); // trailing click, ignored
            expect(isArmed()).toBe(true);

            // Fresh gesture on an outside element: arms dismiss listening, then dismisses.
            fire(outside, 'pointerdown');
            const click = fire(outside, 'click');
            expect(isArmed()).toBe(false);
            expect(item.classList.contains('armed')).toBe(false);
            expect(click.defaultPrevented).toBe(true);     // consumed
            expect(outsideClick).not.toHaveBeenCalled();   // outside target never received it
        });

        it('lets a tap on the armed action button through without dismissing', () => {
            const item = makeItem(true);
            const btn = item.querySelector('.enqueue-btn');
            const btnClick = vi.fn();
            btn.addEventListener('click', btnClick);

            attachLongPress(item, () => arm(item));
            fire(item, 'pointerdown');
            vi.advanceTimersByTime(LONG_PRESS_MS);
            fire(item, 'click'); // trailing click, ignored
            expect(isArmed()).toBe(true);

            // Fresh gesture on the armed button: it should reach the button, not dismiss.
            fire(btn, 'pointerdown');
            const click = fire(btn, 'click');
            expect(btnClick).toHaveBeenCalledTimes(1);
            expect(click.defaultPrevented).toBe(false);
            expect(isArmed()).toBe(true); // module leaves disarm() to the button's handler
        });
    });
});
