export const NAV_ACTION_MOVE = 'move';
export const NAV_ACTION_SELECT = 'select';
export const NAV_ACTION_NONE = 'none';

function clampIndex(index, maxIndex) {
    if (!Number.isFinite(index)) return 0;
    if (index < 0) return 0;
    if (index > maxIndex) return maxIndex;
    return index;
}

export function resolveListNavigation(key, currentIndex, totalItems) {
    const maxIndex = Number.isInteger(totalItems) ? totalItems - 1 : -1;
    if (maxIndex < 0) {
        return { handled: false, nextIndex: 0, action: NAV_ACTION_NONE };
    }

    const safeIndex = clampIndex(currentIndex, maxIndex);

    if (key === 'ArrowDown') {
        const nextIndex = Math.min(safeIndex + 1, maxIndex);
        return {
            handled: true,
            nextIndex,
            action: NAV_ACTION_MOVE
        };
    }

    if (key === 'ArrowUp') {
        const nextIndex = Math.max(safeIndex - 1, 0);
        return {
            handled: true,
            nextIndex,
            action: NAV_ACTION_MOVE
        };
    }

    if (key === 'Enter') {
        return {
            handled: true,
            nextIndex: safeIndex,
            action: NAV_ACTION_SELECT
        };
    }

    return {
        handled: false,
        nextIndex: safeIndex,
        action: NAV_ACTION_NONE
    };
}

