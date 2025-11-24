import { describe, it, expect } from 'vitest';
import Fuse from 'fuse.js';
import {
  normalizeSongBaseName,
  buildSearchIndexFromPlaylist,
  buildDuplicateNameIndex
} from './search-helpers.js';

describe('search helpers', () => {
  describe('normalizeSongBaseName', () => {
    it('strips a single trailing parenthesized suffix', () => {
      expect(normalizeSongBaseName('Track (Live)')).toBe('Track');
      expect(normalizeSongBaseName(' Song (again)  ')).toBe('Song');
    });

    it('leaves names without parentheses unchanged', () => {
      expect(normalizeSongBaseName('Simple Name')).toBe('Simple Name');
    });

    it('handles Japanese titles without modification', () => {
      expect(normalizeSongBaseName('終わりなき旅')).toBe('終わりなき旅');
      expect(normalizeSongBaseName('青い栞 (生)')).toBe('青い栞');
    });
  });

  describe('buildSearchIndexFromPlaylist', () => {
    it('creates entries for each song and stream', () => {
      const playlist = [
        {
          videoId: 'v1',
          title: 'Stream One',
          songs: [
            { name: 'Song A', range: [0, 10] },
            { name: 'Song B', range: [10, 20] }
          ]
        },
        {
          videoId: 'v2',
          title: 'JP Stream',
          songs: [
            { name: '終わりなき旅', range: [0, 100] }
          ]
        },
        {
          videoId: 'v3',
          title: 'Rule 0 Video',
          songs: null
        }
      ];

      const index = buildSearchIndexFromPlaylist(playlist);
      expect(index).toHaveLength(4);
      expect(index[0]).toMatchObject({ name: 'Song A', streamId: 0, songId: 0 });
      expect(index[2]).toMatchObject({ name: '終わりなき旅', streamId: 1, songId: 0 });
      expect(index[3]).toMatchObject({ name: 'Rule 0 Video', streamId: 2, songId: 0 });
    });
  });

  describe('buildDuplicateNameIndex', () => {
    it('groups duplicates ignoring case and trailing parentheses', () => {
      const items = [
        { name: 'Love Song', streamId: 0, songId: 0 },
        { name: 'LOVE SONG', streamId: 1, songId: 0 },
        { name: 'Love Song (Live)', streamId: 2, songId: 0 },
        { name: 'Different', streamId: 3, songId: 0 }
      ];

      const map = buildDuplicateNameIndex(items);
      const entry = map.get('love song');
      expect(entry).toBeTruthy();
      expect(entry.baseName).toBe('Love Song');
      expect(entry.count).toBe(3);
      expect(entry.items.map(i => i.name)).toEqual([
        'Love Song',
        'LOVE SONG',
        'Love Song (Live)'
      ]);
    });

    it('supports Japanese titles as duplicates', () => {
      const items = [
        { name: '終わりなき旅', streamId: 0, songId: 0 },
        { name: '終わりなき旅', streamId: 1, songId: 0 },
        { name: '青い栞', streamId: 2, songId: 0 },
        { name: '青い栞 (生)', streamId: 3, songId: 0 }
      ];

      const map = buildDuplicateNameIndex(items);

      const keyA = '終わりなき旅';
      const keyB = '青い栞';

      const entryA = map.get(keyA);
      const entryB = map.get(keyB);

      expect(entryA).toBeTruthy();
      expect(entryA.count).toBe(2);

      expect(entryB).toBeTruthy();
      expect(entryB.count).toBe(2);
      expect(entryB.baseName).toBe('青い栞');
    });
  });

  describe('Fuse search integration', () => {
    it('finds songs with Japanese titles using the same config as the app', () => {
      const items = [
        { name: 'Love Song', streamId: 0, songId: 0 },
        { name: '終わりなき旅', streamId: 1, songId: 0 },
        { name: '青い栞', streamId: 2, songId: 0 }
      ];

      const fuse = new Fuse(items, {
        keys: ['name'],
        threshold: 0.3,
        ignoreLocation: true
      });

      const jpQuery = '終わりなき旅';
      const jpResults = fuse.search(jpQuery, { limit: 10 }).map(r => r.item.name);
      expect(jpResults).toContain('終わりなき旅');

      const kanaQuery = '青い栞';
      const kanaResults = fuse.search(kanaQuery, { limit: 10 }).map(r => r.item.name);
      expect(kanaResults).toContain('青い栞');
    });
  });
});


