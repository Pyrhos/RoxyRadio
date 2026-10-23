/**
 * Keep the hover boundary stationary while its control translates inside it.
 * The control retains its element type, focus, labels, and event handlers.
 */
export function wrapControl(control) {
    if (control.parentElement?.classList.contains('control-container')) {
        return control.parentElement;
    }

    const container = document.createElement('div');
    container.className = 'control-container';
    if (control.parentNode) control.replaceWith(container);
    container.appendChild(control);

    // The padding includes the control's original position after it moves.
    // Forward a padding click once, preserving modifiers such as Shift+Previous.
    container.addEventListener('click', (event) => {
        if (event.target !== container) return;
        event.stopPropagation();
        if (control.matches(':disabled') || !control.getClientRects().length || hasControlTextSelection(control)) return;
        control.focus({ preventScroll: true });
        control.dispatchEvent(new MouseEvent('click', event));
    });

    return container;
}

export function hasControlTextSelection(control) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return false;
    for (let index = 0; index < selection.rangeCount; index++) {
        if (selection.getRangeAt(index).intersectsNode(control)) return true;
    }
    return false;
}

export function initializeControlContainers() {
    document.querySelectorAll('button:not(#message-close), #status, .wanted-contact-link')
        .forEach(wrapControl);
}
