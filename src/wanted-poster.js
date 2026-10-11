import { createLifecycle } from './lifecycle.js';
/**
 * @param {object} deps
 * @param {HTMLElement} deps.boltTrigger
 * @param {HTMLElement} deps.wantedOverlay
 */
export function initWantedPoster({ boltTrigger, wantedOverlay }) {
    const lifecycle = createLifecycle();
    if (!boltTrigger || !wantedOverlay) return;

    lifecycle.listen(boltTrigger, 'click', () => {
        wantedOverlay.classList.add('open');
    });

    lifecycle.listen(wantedOverlay, 'click', (e) => {
        if (e.target === wantedOverlay) {
            wantedOverlay.classList.remove('open');
        }
    });

    const closeBtn = wantedOverlay.querySelector('#wanted-close');
    if (closeBtn) {
        lifecycle.listen(closeBtn, 'click', () => {
            wantedOverlay.classList.remove('open');
        });
    }

    lifecycle.listen(document, 'keydown', (e) => {
        if (e.key === 'Escape' && wantedOverlay.classList.contains('open')) {
            wantedOverlay.classList.remove('open');
        }
    });
    return { destroy: lifecycle.dispose };
}
