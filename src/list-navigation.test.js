import { describe, it, expect } from 'vitest';
import { resolveListNavigation, NAV_ACTION_MOVE, NAV_ACTION_SELECT, NAV_ACTION_NONE } from './list-navigation.js';

describe('resolveListNavigation', () => {
    it('returns unhandled when there are no items', () => {
        const result = resolveListNavigation('ArrowDown', 0, 0);
        expect(result).toEqual({ handled: false, nextIndex: 0, action: NAV_ACTION_NONE });
    });

    it('moves down within bounds', () => {
        const result = resolveListNavigation('ArrowDown', 0, 3);
        expect(result).toEqual({ handled: true, nextIndex: 1, action: NAV_ACTION_MOVE });
    });

    it('moves up within bounds', () => {
        const result = resolveListNavigation('ArrowUp', 2, 5);
        expect(result).toEqual({ handled: true, nextIndex: 1, action: NAV_ACTION_MOVE });
    });

    it('clamps movement at the list edges', () => {
        const downResult = resolveListNavigation('ArrowDown', 10, 2);
        expect(downResult).toEqual({ handled: true, nextIndex: 1, action: NAV_ACTION_MOVE });

        const upResult = resolveListNavigation('ArrowUp', -5, 2);
        expect(upResult).toEqual({ handled: true, nextIndex: 0, action: NAV_ACTION_MOVE });
    });

    it('selects current item on Enter', () => {
        const result = resolveListNavigation('Enter', 2, 4);
        expect(result).toEqual({ handled: true, nextIndex: 2, action: NAV_ACTION_SELECT });
    });

    it('ignores unrelated keys', () => {
        const result = resolveListNavigation('Home', 1, 3);
        expect(result).toEqual({ handled: false, nextIndex: 1, action: NAV_ACTION_NONE });
    });
});

