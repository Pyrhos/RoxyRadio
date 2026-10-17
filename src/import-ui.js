import { createLifecycle } from './lifecycle.js';
import { validateSegmentData, parseYouTubeUrls } from './import-helpers.js';
import { decodeQueue } from './queue-transfer.js';

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
 * @param {HTMLElement} deps.importExportQueueBtn
 * @param {HTMLElement} deps.importCloseBtn
 * @param {(validatedData: Segment[]) => void} deps.onImportReplace
 * @param {(validatedData: Segment[]) => void} deps.onImportAppend
 * @param {() => void} deps.onImportReset
 * @param {(items: Array, options: {replace: boolean}) => void} deps.onQueueImport
 * @param {() => {text: string, count: number, skipped: number}} deps.getQueueExport
 * @param {() => number} deps.getQueueLength
 * @param {() => void} deps.onMemberToggle
 * @param {(buttonEl: HTMLElement) => void} deps.onCopyShareUrl
 * @param {() => boolean} deps.isMemberMode
 */
export function createImportAndMoreController({
    importModal, importStatus,
    moreOverlay, moreMemberBtn, moreBtn, moreCopyBtn, moreImportBtn, moreCloseBtn,
    importReplaceBtn, importAppendBtn, importResetBtn, importExportQueueBtn, importCloseBtn,
    onImportReplace, onImportAppend, onImportReset,
    onQueueImport, getQueueExport, getQueueLength,
    onMemberToggle, onCopyShareUrl, isMemberMode,
}) {
    const lifecycle = createLifecycle();
    let exportingQueue = false;
    function setImportStatus(msg, type) {
        if (!importStatus) return;
        importStatus.textContent = msg || '';
        importStatus.className = type || '';
    }

    /**
     * @returns {Promise<{type: string, entries: Array} | null>}
     */
    function readAndValidateClipboard() {
        return navigator.clipboard.readText().then(text => {
            if (lifecycle.signal.aborted) return null;
            try {
                const queue = decodeQueue(text);
                if (queue) return { type: 'queue', entries: queue };
            } catch (err) {
                setImportStatus(err.message, 'error');
                return null;
            }
            let data;
            try {
                data = JSON.parse(text);
            } catch {
                try {
                    const result = parseYouTubeUrls(text);
                    if (result && result.entries.length > 0) {
                        if (result.failed.length > 0) {
                            setImportStatus(`Skipped ${result.failed.length} unrecognized link(s): ${result.failed.join(', ')}`, 'warning');
                            console.warn('[Import] Failed to parse:', result.failed);
                        }
                        return { type: 'playlist', entries: result.entries };
                    }
                } catch (err) {
                    console.warn('[Import] URL parsing failed:', err.message);
                }
                const msg = 'No valid YouTube links, playlist JSON, or queue export found';
                setImportStatus(msg, 'error');
                console.warn('[Import]', msg);
                return null;
            }

            if (!validateSegmentData(data)) {
                setImportStatus('Not a valid segment file', 'error');
                console.warn('[Import] Clipboard JSON is not a valid segment file');
                return null;
            }

            return { type: 'playlist', entries: data };
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
        if (isOpen) {
            setImportStatus();
            updateExportQueueButton();
        }
    }

    function updateExportQueueButton() {
        if (importExportQueueBtn) {
            importExportQueueBtn.disabled = exportingQueue || getQueueLength() === 0;
        }
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
            if (!window.confirm(`Replace your current ${data.type} with the imported ${data.type}?`)) return;
            if (data.type === 'queue') onQueueImport(data.entries, { replace: true });
            else onImportReplace(data.entries);
        });
    });

    lifecycle.listen(importAppendBtn, 'click', () => {
        readAndValidateClipboard().then(data => {
            if (!data || lifecycle.signal.aborted) return;
            if (data.type === 'queue') onQueueImport(data.entries, { replace: false });
            else onImportAppend(data.entries);
        });
    });

    lifecycle.listen(importResetBtn, 'click', () => {
        if (window.confirm('Reset to the radio’s default playlist? Custom playlist changes will be removed. Your queue will be kept.')) {
            onImportReset();
        }
    });
    lifecycle.listen(importCloseBtn, 'click', () => toggleImportModal());

    lifecycle.listen(importExportQueueBtn, 'click', async () => {
        if (exportingQueue || !getQueueLength()) return;
        exportingQueue = true;
        updateExportQueueButton();
        try {
            const { text, count, skipped } = getQueueExport();
            if (!count) {
                setImportStatus('No queued songs found in your playlist', 'error');
                return;
            }
            await navigator.clipboard.writeText(text);
            if (lifecycle.signal.aborted) return;
            setImportStatus(`Copied ${count} queued song${count === 1 ? '' : 's'}${skipped ? `; skipped ${skipped} missing` : ''}`, skipped ? 'warning' : 'ok');
        } catch (err) {
            if (lifecycle.signal.aborted) return;
            setImportStatus('Couldn\u2019t copy queue to clipboard', 'error');
            console.warn('[Import] Failed to export queue:', err.message);
        } finally {
            exportingQueue = false;
            if (!lifecycle.signal.aborted) updateExportQueueButton();
        }
    });

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
        updateExportQueueButton,
        setImportStatus,
        isImportOpen,
        isMoreOpen,
    };
}
