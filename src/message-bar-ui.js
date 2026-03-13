import { MessageQueue, validateMessages } from './message-bar.js';

/**
 * @param {object} deps
 * @param {HTMLElement} deps.messageBar
 * @param {HTMLElement} deps.messageText
 * @param {HTMLElement} deps.messageClose
 * @param {Array} deps.messagesData
 */
export function createMessageBarController({ messageBar, messageText, messageClose, messagesData }) {
    const MESSAGE_WPM = 70;
    const MESSAGE_MIN_SECONDS = 10;

    let messageQueueInstance = null;
    let messageTimeoutHandle = null;

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
        if (messageTimeoutHandle) {
            clearTimeout(messageTimeoutHandle);
            messageTimeoutHandle = null;
        }
    }

    function hideMessageBar() {
        stopMessageCycle();
        if (messageBar) {
            messageBar.hidden = true;
        }
    }

    function init() {
        try {
            const validMessages = validateMessages(messagesData);

            if (validMessages.length === 0) {
                console.log('[Messages] No valid messages found in messages.json');
                return;
            }

            messageQueueInstance = new MessageQueue(validMessages, {
                wpm: MESSAGE_WPM,
                minSeconds: MESSAGE_MIN_SECONDS
            });

            if (messageBar) {
                messageBar.hidden = false;
            }

            showNextMessage();

            if (messageClose) {
                messageClose.addEventListener('click', hideMessageBar);
            }

            console.log(`[Messages] Loaded ${messageQueueInstance.size} messages`);
        } catch (err) {
            console.warn('[Messages] Failed to initialize message bar:', err.message);
        }
    }

    function destroy() {
        stopMessageCycle();
    }

    return { init, destroy };
}
