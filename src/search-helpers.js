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
    if (stream.songs) {
      stream.songs.forEach((song, songIdx) => {
        searchIndex.push({
          name: song.name || 'Unknown',
          streamId: sIdx,
          songId: songIdx,
          type: 'song'
        });
      });
    } else {
      searchIndex.push({
        name: stream.title || 'Unknown Stream',
        streamId: sIdx,
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

