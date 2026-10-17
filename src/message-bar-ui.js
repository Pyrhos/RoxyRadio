import { MessageQueue, validateMessages, hashMessages } from './message-bar.js';
import { DISMISSED_MESSAGES_HASH_STORAGE_KEY } from './storage-keys.js';

/**
 * @param {object} deps
 * @param {HTMLElement} deps.messageBar
 * @param {HTMLElement} deps.messageText
 * @param {HTMLElement} deps.messageClose
 * @param {HTMLElement} deps.messageRestore
 * @param {Array} deps.messagesData
 */
export function createMessageBarController({ messageBar, messageText, messageClose, messageRestore, messagesData }) {
    const MESSAGE_WPM = 70;
    const MESSAGE_MIN_SECONDS = 10;

    let messageQueueInstance = null;
    let messageTimeoutHandle = null;
    let messagesHash = null;
    let destroyed = false;

    function showNextMessage() {
        if (!messageBar || !messageText || !messageQueueInstance) return;

        const next = messageQueueInstance.next();
        if (!next) return;

        // Trigger re-animation by briefly removing the element content
        messageText.style.animation = 'none';
        messageText.offsetHeight; // Force reflow
        messageText.style.animation = '';
        messageText.textContent = next.message;

        messageTimeoutHandle = setTimeout(showNextMessage, next.duration * 1000);
    }

    function stopMessageCycle() {
        if (messageTimeoutHandle !== null) {
            clearTimeout(messageTimeoutHandle);
            messageTimeoutHandle = null;
        }
    }

    function setDismissed(dismissed) {
        stopMessageCycle();
        if (messageBar) {
            messageBar.hidden = dismissed;
        }
        if (messageRestore) {
            messageRestore.hidden = !dismissed;
        }
        if (!dismissed) showNextMessage();
    }

    function hideMessageBar() {
        try {
            localStorage.setItem(DISMISSED_MESSAGES_HASH_STORAGE_KEY, messagesHash);
        } catch (err) {
            console.warn('[Messages] Failed to save dismissal:', err.message);
        }
        setDismissed(true);
    }

    function restoreMessageBar() {
        try {
            localStorage.removeItem(DISMISSED_MESSAGES_HASH_STORAGE_KEY);
        } catch (err) {
            console.warn('[Messages] Failed to clear dismissal:', err.message);
        }
        setDismissed(false);
    }

    async function init() {
        if (destroyed) return;
        try {
            const validMessages = validateMessages(messagesData);

            if (validMessages.length === 0) {
                console.log('[Messages] No valid messages found in messages.json');
                return;
            }

            messagesHash = await hashMessages(messagesData);
            if (destroyed) return;
            messageQueueInstance = new MessageQueue(validMessages, {
                wpm: MESSAGE_WPM,
                minSeconds: MESSAGE_MIN_SECONDS
            });

            let dismissed = false;
            try {
                dismissed = localStorage.getItem(DISMISSED_MESSAGES_HASH_STORAGE_KEY) === messagesHash;
            } catch (err) {
                console.warn('[Messages] Failed to read dismissal:', err.message);
            }
            setDismissed(dismissed);

            if (messageClose) {
                messageClose.addEventListener('click', hideMessageBar);
            }
            messageRestore?.addEventListener('click', restoreMessageBar);

            console.log(`[Messages] Loaded ${messageQueueInstance.size} messages`);
        } catch (err) {
            if (destroyed) return;
            console.warn('[Messages] Failed to initialize message bar:', err.message);
        }
    }

    function destroy() {
        destroyed = true;
        messageClose?.removeEventListener('click', hideMessageBar);
        messageRestore?.removeEventListener('click', restoreMessageBar);
        stopMessageCycle();
    }

    return { init, destroy };
}
