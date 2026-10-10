// Persistent storage names are part of the app's compatibility contract: changing
// one without a migration would strand existing settings or imported playlists.
export const LOCAL_STORAGE_PREFIX = 'roxy_';
export const SESSION_STORAGE_PREFIX = 'roxy_session_';

export const CUSTOM_SEGMENTS_STORAGE_KEY = `${LOCAL_STORAGE_PREFIX}customSegments`;
export const SEGMENTS_MODE_STORAGE_KEY = `${LOCAL_STORAGE_PREFIX}segmentsMode`;

export const SEGMENTS_MODE_REPLACED = 'replaced';
