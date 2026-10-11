import { createLifecycle } from './lifecycle.js';
import { validateSegmentData, parseYouTubeUrls } from './import-helpers.js';

/** @typedef {import('./import-helpers.js').Segment} Segment */

/**
 * @param {object} deps
 * @param {HTMLElement} deps.importModal
 * @param {HTMLElement} deps.importStatus
 * @param {HTMLElement} deps.moreOverlay
 * @param {HTMLElement} deps.moreMemberBtn
 * @param {HTMLElement} deps.moreBtn
 * @param {HTMLElement} deps.moreCopyBtn
 * @param {HTMLElement} deps.moreImportBtn
 * @param {HTMLElement} deps.moreCloseBtn
 * @param {HTMLElement} deps.importReplaceBtn
 * @param {HTMLElement} deps.importAppendBtn
 * @param {HTMLElement} deps.importResetBtn
 * @param {(validatedData: Segment[]) => void} deps.onImportReplace
 * @param {(validatedData: Segment[]) => void} deps.onImportAppend
 * @param {() => void} deps.onImportReset
 * @param {() => void} deps.onMemberToggle
 * @param {(buttonEl: HTMLElement) => void} deps.onCopyShareUrl
 * @param {() => boolean} deps.isMemberMode
 */
export function createImportAndMoreController({
    importModal, importStatus,
    moreOverlay, moreMemberBtn, moreBtn, moreCopyBtn, moreImportBtn, moreCloseBtn,
    importReplaceBtn, importAppendBtn, importResetBtn,
    onImportReplace, onImportAppend, onImportReset,
    onMemberToggle, onCopyShareUrl, isMemberMode,
}) {
    const lifecycle = createLifecycle();
    function setImportStatus(msg, type) {
        if (!importStatus) return;
        importStatus.textContent = msg || '\u00A0';
        importStatus.className = type || '';
    }

    /**
     * @param {{urlFallback?: boolean}} [options]
     * @returns {Promise<Segment[] | null>}
     */
    function readAndValidateClipboard({ urlFallback = false } = {}) {
        return navigator.clipboard.readText().then(text => {
            if (lifecycle.signal.aborted) return null;
            let data;
            try {
                data = JSON.parse(text);
            } catch {
                if (urlFallback) {
                    try {
                        const result = parseYouTubeUrls(text);
                        if (result && result.entries.length > 0) {
                            if (result.failed.length > 0) {
                                setImportStatus(`Skipped ${result.failed.length} unrecognized link(s): ${result.failed.join(', ')}`, 'warning');
                                console.warn('[Import] Failed to parse:', result.failed);
                            }
                            return result.entries;
                        }
                    } catch (err) {
                        console.warn('[Import] URL parsing failed:', err.message);
                    }
                }
                const msg = urlFallback
                    ? 'No valid YouTube links or JSON found'
                    : 'Clipboard doesn\u2019t contain valid JSON';
                setImportStatus(msg, 'error');
                console.warn('[Import]', msg);
                return null;
            }

            if (!validateSegmentData(data)) {
                setImportStatus('Not a valid segment file', 'error');
                console.warn('[Import] Clipboard JSON is not a valid segment file');
                return null;
            }

            return data;
        }).catch(err => {
            if (lifecycle.signal.aborted) return null;
            setImportStatus('Couldn\u2019t read clipboard', 'error');
            console.warn('[Import] Failed to read clipboard:', err.message);
            return null;
        });
    }

    function toggleImportModal() {
        const isOpen = importModal.classList.toggle('open');
        importModal.inert = !isOpen;
        if (isOpen) setImportStatus();
    }

    function toggleMoreOverlay() {
        const isOpen = moreOverlay.classList.toggle('open');
        moreOverlay.inert = !isOpen;
        if (isOpen) updateMoreMemberBtn();
    }

    function updateMoreMemberBtn() {
        moreMemberBtn.textContent = `Member Mode: ${isMemberMode() ? 'On' : 'Off'}`;
        moreMemberBtn.classList.toggle('active', isMemberMode());
    }

    function isImportOpen() {
        return importModal.classList.contains('open');
    }

    function isMoreOpen() {
        return moreOverlay.classList.contains('open');
    }

    // Wire up event listeners
    lifecycle.listen(importModal, 'click', (e) => {
        if (e.target === importModal) {
            toggleImportModal();
        }
    });

    lifecycle.listen(importReplaceBtn, 'click', () => {
        readAndValidateClipboard().then(data => {
            if (!data || lifecycle.signal.aborted) return;
            onImportReplace(data);
        });
    });

    lifecycle.listen(importAppendBtn, 'click', () => {
        readAndValidateClipboard({ urlFallback: true }).then(data => {
            if (!data || lifecycle.signal.aborted) return;
            onImportAppend(data);
        });
    });

    if (importResetBtn) lifecycle.listen(importResetBtn, 'click', () => onImportReset());

    lifecycle.listen(moreOverlay, 'click', (e) => {
        if (e.target === moreOverlay) {
            toggleMoreOverlay();
        }
    });

    lifecycle.listen(moreBtn, 'click', () => toggleMoreOverlay());
    lifecycle.listen(moreCloseBtn, 'click', () => toggleMoreOverlay());

    lifecycle.listen(moreMemberBtn, 'click', () => {
        onMemberToggle();
        updateMoreMemberBtn();
    });

    lifecycle.listen(moreImportBtn, 'click', () => {
        toggleMoreOverlay();
        toggleImportModal();
    });

    lifecycle.listen(moreCopyBtn, 'click', () => onCopyShareUrl(moreCopyBtn));

    return {
        destroy: lifecycle.dispose,
        toggleImportModal,
        toggleMoreOverlay,
        updateMoreMemberBtn,
        setImportStatus,
        isImportOpen,
        isMoreOpen,
    };
}
