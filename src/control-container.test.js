import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasControlTextSelection, wrapControl } from './control-container.js';

afterEach(() => {
    window.getSelection().removeAllRanges();
    document.body.innerHTML = '';
});

describe('control containers', () => {
    it('preserves a control and its handlers when wrapping an existing element', () => {
        document.body.innerHTML = '<button id="previous">Previous</button>';
        const button = document.getElementById('previous');
        const activate = vi.fn();
        button.addEventListener('click', activate);
        const container = wrapControl(button);

        expect(wrapControl(button)).toBe(container);
        button.click();
        expect(activate).toHaveBeenCalledTimes(1);
        expect(document.getElementById('previous')).toBe(button);
    });

    it('forwards padding clicks once with modifiers and focuses the original button', () => {
        const button = document.createElement('button');
        const container = wrapControl(button);
        document.body.appendChild(container);
        const activate = vi.fn();
        const parentClick = vi.fn();
        button.addEventListener('click', activate);
        document.body.addEventListener('click', parentClick, { once: true });

        container.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));

        expect(activate).toHaveBeenCalledTimes(1);
        expect(activate.mock.calls[0][0].shiftKey).toBe(true);
        expect(parentClick).toHaveBeenCalledTimes(1);
        expect(parentClick.mock.calls[0][0].target).toBe(button);
        expect(document.activeElement).toBe(button);
    });

    it('does not activate a disabled button through its padding', () => {
        const button = document.createElement('button');
        button.disabled = true;
        const activate = vi.fn();
        button.addEventListener('click', activate);
        wrapControl(button).click();
        expect(activate).not.toHaveBeenCalled();
    });

    it('preserves selected text when a drag ends on the container', () => {
        const status = document.createElement('div');
        status.tabIndex = 0;
        status.textContent = 'Current song';
        const container = wrapControl(status);
        document.body.appendChild(container);
        const range = document.createRange();
        range.selectNodeContents(status);
        window.getSelection().addRange(range);
        const activate = vi.fn();
        status.addEventListener('click', activate);

        container.click();

        expect(activate).not.toHaveBeenCalled();
        expect(window.getSelection().toString()).toBe('Current song');
        expect(hasControlTextSelection(status)).toBe(true);
        const otherControl = document.createElement('div');
        document.body.appendChild(otherControl);
        expect(hasControlTextSelection(otherControl)).toBe(false);
    });
});
