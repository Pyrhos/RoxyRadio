/**
 * @param {object} deps
 * @param {HTMLElement} deps.boltTrigger
 * @param {HTMLElement} deps.wantedOverlay
 */
export function initWantedPoster({ boltTrigger, wantedOverlay }) {
    if (!boltTrigger || !wantedOverlay) return;

    boltTrigger.addEventListener('click', () => {
        wantedOverlay.classList.add('open');
    });

    wantedOverlay.addEventListener('click', (e) => {
        if (e.target === wantedOverlay) {
            wantedOverlay.classList.remove('open');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && wantedOverlay.classList.contains('open')) {
            wantedOverlay.classList.remove('open');
        }
    });
}
