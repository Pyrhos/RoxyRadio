/**
 * Navigation computes an action; only the application executes player commands.
 * A seek with reload preserves the existing seek-before-load ordering.
 * @typedef {{type: 'none'} | {type: 'load', time?: number} |
 *   {type: 'seek', time: number, reload?: boolean}} PlaybackAction
 */
export const NO_PLAYBACK_ACTION = Object.freeze({ type: 'none' });

/** @param {PlaybackAction} action */
export function executePlaybackAction(action, { load, seek }) {
    if (action.type === 'load') {
        load(action.time);
    } else if (action.type === 'seek') {
        seek(action.time);
        if (action.reload) load();
    } else {
        return false;
    }
    return true;
}
