export const FUSE_CONFIG = {
  keys: [
    { name: 'name', weight: 2 },
    { name: 'streamName', weight: 1 }
  ],
  threshold: 0.35,
  ignoreLocation: false,  // Prefer matches closer to start of string
  location: 0,            // Ideal match position is at the beginning
  distance: 100           // How quickly score degrades with distance from location
};

export function normalizeSongBaseName(name) {
  if (!name) return '';
  let base = String(name).trim();
  // Strip a single trailing parenthesized suffix, e.g. "Track (Live)" -> "Track"
  base = base.replace(/\s*\([^)]*\)\s*$/u, '');
  return base;
}

export function buildSearchIndexFromPlaylist(playlist) {
  const searchIndex = [];

  playlist.forEach((stream, sIdx) => {
    const streamDisplayName = stream.name || stream.title || `Stream ${sIdx + 1}`;

    if (stream.songs) {
      stream.songs.forEach((song, songIdx) => {
        searchIndex.push({
          name: song.name || 'Unknown',
          streamId: sIdx,
          streamName: streamDisplayName,
          songId: songIdx,
          type: 'song'
        });
      });
    } else {
      searchIndex.push({
        name: streamDisplayName,
        streamId: sIdx,
        streamName: streamDisplayName,
        songId: 0,
        type: 'song' // Treat as song for unified search
      });
    }
  });

  return searchIndex;
}

export function buildDuplicateNameIndex(items) {
  const map = new Map();

  for (const item of items) {
    const rawName = item.name || '';
    const baseName = normalizeSongBaseName(rawName);
    if (!baseName) continue;
    const key = baseName.toLocaleLowerCase('en-US');
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.items.push(item);
    } else {
      map.set(key, {
        key,
        baseName,
        count: 1,
        items: [item]
      });
    }
  }

  return map;
}

export function sortSearchResultsByCurrentStream(items, currentStreamId) {
  if (!items || items.length === 0) return items;

  // Group by normalized base name
  const groups = new Map();

  items.forEach((item) => {
    const baseName = normalizeSongBaseName(item.name).toLocaleLowerCase('en-US');
    if (!groups.has(baseName)) {
      groups.set(baseName, []);
    }
    groups.get(baseName).push(item);
  });

  const sorted = [];
  groups.forEach((group) => {
    if (group.length > 1) {
      // Partition by current stream
      const otherStreams = group.filter(item => item.streamId !== currentStreamId);
      const currentStreamItems = group.filter(item => item.streamId === currentStreamId);
      sorted.push(...otherStreams, ...currentStreamItems);
    } else {
      sorted.push(...group);
    }
  });

  return sorted;
}