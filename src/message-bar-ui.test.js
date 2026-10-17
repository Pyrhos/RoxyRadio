import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMessageBarController } from './message-bar-ui.js';
import { DISMISSED_MESSAGES_HASH_STORAGE_KEY } from './storage-keys.js';
import { clearStorage, setupDOM } from './test-setup.js';

const MESSAGES = ['First announcement 💜', 'Second announcement'];
const element = id => document.getElementById(id);

describe('message bar dismissal', () => {
    let controller;

    async function load(messagesData = MESSAGES) {
        controller?.destroy();
        setupDOM();
        controller = createMessageBarController({
            messageBar: element('message-bar'),
            messageText: element('message-text'),
            messageClose: element('message-close'),
            messageRestore: element('more-restore-messages-btn'),
            messagesData,
        });
        await controller.init();
    }

    beforeEach(() => {
        vi.useFakeTimers();
        clearStorage();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        controller?.destroy();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        clearStorage();
    });

    it('shows messages by default and hides the restore button', async () => {
        await load();
        expect(element('message-bar').hidden).toBe(false);
        expect(element('more-restore-messages-btn').hidden).toBe(true);
        const first = element('message-text').textContent;
        expect(MESSAGES).toContain(first);
        vi.advanceTimersByTime(10000);
        expect(element('message-text').textContent).not.toBe(first);
    });

    it('saves a content hash and stops rotation when closed', async () => {
        await load();
        const current = element('message-text').textContent;
        element('message-close').click();

        expect(localStorage.getItem(DISMISSED_MESSAGES_HASH_STORAGE_KEY)).toMatch(/^[0-9a-f]{64}$/);
        expect(element('message-bar').hidden).toBe(true);
        expect(element('more-restore-messages-btn').hidden).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(60000);
        expect(element('message-text').textContent).toBe(current);
    });

    it('keeps identical JSON hidden on subsequent loads without starting a timer', async () => {
        await load();
        element('message-close').click();
        const storedHash = localStorage.getItem(DISMISSED_MESSAGES_HASH_STORAGE_KEY);

        await load(JSON.parse(JSON.stringify(MESSAGES, null, 2)));

        expect(element('message-bar').hidden).toBe(true);
        expect(element('message-text').textContent).toBe('');
        expect(element('more-restore-messages-btn').hidden).toBe(false);
        expect(localStorage.getItem(DISMISSED_MESSAGES_HASH_STORAGE_KEY)).toBe(storedHash);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        ['edited', ['First announcement 🖤', MESSAGES[1]]],
        ['added', [...MESSAGES, 'New announcement']],
        ['removed', [MESSAGES[0]]],
        ['reordered', [...MESSAGES].reverse()],
    ])('shows messages again when the JSON has been %s', async (_change, messages) => {
        await load();
        element('message-close').click();
        const previousHash = localStorage.getItem(DISMISSED_MESSAGES_HASH_STORAGE_KEY);

        await load(messages);

        expect(element('message-bar').hidden).toBe(false);
        expect(element('more-restore-messages-btn').hidden).toBe(true);
        expect(messages).toContain(element('message-text').textContent);
        element('message-close').click();
        expect(localStorage.getItem(DISMISSED_MESSAGES_HASH_STORAGE_KEY)).not.toBe(previousHash);
        await load(messages);
        expect(element('message-bar').hidden).toBe(true);
    });

    it('restores rotation immediately, removes the stored hash, and remains enabled after reload', async () => {
        await load();
        element('message-close').click();
        await load();
        element('more-restore-messages-btn').click();

        expect(localStorage.getItem(DISMISSED_MESSAGES_HASH_STORAGE_KEY)).toBeNull();
        expect(element('message-bar').hidden).toBe(false);
        expect(element('more-restore-messages-btn').hidden).toBe(true);
        const first = element('message-text').textContent;
        expect(MESSAGES).toContain(first);
        vi.advanceTimersByTime(10000);
        expect(element('message-text').textContent).not.toBe(first);
        expect(vi.getTimerCount()).toBe(1);

        await load();
        expect(element('message-bar').hidden).toBe(false);
    });

    it('can dismiss restored messages again without leaving a timer running', async () => {
        await load();
        element('message-close').click();
        element('more-restore-messages-btn').click();
        element('message-close').click();
        expect(vi.getTimerCount()).toBe(0);
        await load();
        expect(element('message-bar').hidden).toBe(true);
        expect(element('more-restore-messages-btn').hidden).toBe(false);
    });

    it.each([[[]], [['', '  ', null]], [null]])('does not offer restoration when no valid messages exist: %j', async messages => {
        localStorage.setItem(DISMISSED_MESSAGES_HASH_STORAGE_KEY, 'previous dismissal');
        await load(messages);
        expect(element('message-bar').hidden).toBe(true);
        expect(element('more-restore-messages-btn').hidden).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['getItem', 'setItem', 'removeItem'])('keeps controls usable when localStorage.%s fails', async method => {
        vi.stubGlobal('localStorage', {
            getItem: localStorage.getItem.bind(localStorage),
            setItem: localStorage.setItem.bind(localStorage),
            removeItem: localStorage.removeItem.bind(localStorage),
            [method]: () => { throw new Error('Storage unavailable'); },
        });
        await load();
        expect(element('message-bar').hidden).toBe(false);
        element('message-close').click();
        expect(element('message-bar').hidden).toBe(true);
        expect(element('more-restore-messages-btn').hidden).toBe(false);
        element('more-restore-messages-btn').click();
        expect(element('message-bar').hidden).toBe(false);
        expect(element('more-restore-messages-btn').hidden).toBe(true);
        expect(vi.getTimerCount()).toBe(1);
        expect(console.warn).toHaveBeenCalled();
    });

    it('removes both button handlers and the rotation timer on destruction', async () => {
        await load();
        controller.destroy();
        element('message-close').click();
        element('more-restore-messages-btn').click();
        expect(element('message-bar').hidden).toBe(false);
        expect(localStorage.getItem(DISMISSED_MESSAGES_HASH_STORAGE_KEY)).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not start rotation or attach handlers if destroyed while hashing', async () => {
        let finishHash;
        vi.spyOn(crypto.subtle, 'digest').mockImplementation(() => new Promise(resolve => {
            finishHash = resolve;
        }));
        const loading = load();
        controller.destroy();
        finishHash(new ArrayBuffer(32));
        await loading;

        element('message-close').click();
        element('more-restore-messages-btn').click();
        expect(element('message-bar').hidden).toBe(true);
        expect(element('more-restore-messages-btn').hidden).toBe(true);
        expect(localStorage.getItem(DISMISSED_MESSAGES_HASH_STORAGE_KEY)).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });
});
