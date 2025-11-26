import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const filePath = path.resolve(__dirname, 'data/segments.json');
const fileContent = fs.readFileSync(filePath, 'utf-8');
const segments = JSON.parse(fileContent);

describe('Data Integrity', () => {
    it('should not have duplicate videoIds in segments.json', () => {
        
        const idCounts = {};
        segments.forEach(s => {
            idCounts[s.videoId] = (idCounts[s.videoId] || 0) + 1;
        });
        
        const duplicateIds = Object.keys(idCounts).filter(id => idCounts[id] > 1);
        
        if (duplicateIds.length === 0) {
            return;
        }

        const lines = fileContent.split(/\r?\n/);
        const locations = [];
        
        let depth = 0;
        let inString = false;
        let isEscaping = false;
        let entryStartLine = -1;
        let entryBuffer = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;
            
            for (let j = 0; j < line.length; j++) {
                const char = line[j];
                
                if (inString) {
                    if (isEscaping) {
                        isEscaping = false;
                    } else if (char === '\\') {
                        isEscaping = true;
                    } else if (char === '"') {
                        inString = false;
                    }
                } else {
                    if (char === '"') {
                        inString = true;
                    } else if (char === '{') {
                        if (depth === 0) {
                            entryStartLine = lineNum;
                            entryBuffer = '';
                        }
                        depth++;
                    } else if (char === '}') {
                        depth--;
                        if (depth === 0) {
                            entryBuffer += char;

                            const chunk = lines.slice(entryStartLine - 1, lineNum).join('\n');
                            try {
                                let cleanChunk = chunk.trim();
                                if (cleanChunk.endsWith(',')) {
                                    cleanChunk = cleanChunk.slice(0, -1);
                                }
                                
                                const obj = JSON.parse(cleanChunk);
                                if (duplicateIds.includes(obj.videoId)) {
                                    locations.push({
                                        id: obj.videoId,
                                        start: entryStartLine,
                                        end: lineNum,
                                        songs: obj.songs ? obj.songs.length : 0
                                    });
                                }
                            } catch (err) {
                                //ignore
                            }
                            
                            entryStartLine = -1;
                        }
                    }
                }
            }
        }

        const report = duplicateIds.map(id => {
            const occs = locations.filter(l => l.id === id);
            const details = occs.map((o, i) => 
                `    Occurrence ${i + 1}:\n      - Lines: ${o.start} to ${o.end}\n      - Song Count: ${o.songs}`
            ).join('\n');
            return `Duplicate VideoID Found: "${id}"\n${details}`;
        }).join('\n\n');

        throw new Error(`Found ${duplicateIds.length} duplicate stream IDs:\n\n${report}`);
    });

    it('ensures every song range has exactly two numeric values', () => {
        const invalidRanges = [];
        segments.forEach((stream, streamIdx) => {
            if (!Array.isArray(stream.songs)) return;
            stream.songs.forEach((song, songIdx) => {
                const range = song.range;
                const isValidTuple =
                    Array.isArray(range) &&
                    range.length === 2 &&
                    range.every((value) => typeof value === 'number' && Number.isFinite(value));
                if (!isValidTuple) {
                    invalidRanges.push(`${stream.videoId} song ${songIdx + 1} (${song.name ?? 'Unnamed'})`);
                }
            });
        });

        expect(invalidRanges).toEqual([]);
    });

    it('ensures song ranges are non-negative and strictly increasing', () => {
        const invalid = [];
        segments.forEach((stream, streamIdx) => {
            if (!Array.isArray(stream.songs)) return;
            stream.songs.forEach((song, songIdx) => {
                const [start, end] = song.range || [];
                const nonNegative = typeof start === 'number' && typeof end === 'number' && start >= 0 && end >= 0;
                const strictlyIncreasing = typeof start === 'number' && typeof end === 'number' && end > start;
                if (!nonNegative || !strictlyIncreasing) {
                    invalid.push(`${stream.videoId} song ${songIdx + 1} (${song.name ?? 'Unnamed'}) -> [${start}, ${end}]`);
                }
            });
        });

        expect(invalid).toEqual([]);
    });

    it('ensures song ranges do not overlap within the same stream', () => {
        const overlaps = [];
        segments.forEach((stream) => {
            if (!Array.isArray(stream.songs) || stream.songs.length < 2) return;
            const sorted = [...stream.songs].sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0));
            for (let i = 1; i < sorted.length; i++) {
                const prev = sorted[i - 1];
                const curr = sorted[i];
                if (!prev.range || !curr.range) continue;
                if (curr.range[0] < prev.range[1]) {
                    overlaps.push(`${stream.videoId}: "${prev.name ?? 'Unnamed'}" overlaps "${curr.name ?? 'Unnamed'}"`);
                }
            }
        });

        expect(overlaps).toEqual([]);
    });
});

