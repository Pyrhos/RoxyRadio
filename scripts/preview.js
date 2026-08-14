// Materialises the exact runtime payload (curation order + non-runtime fields stripped)
// the app ships, into a gitignored file for eyeballing/diffing before deploy.

import fs from 'node:fs';
import path from 'node:path';
import { transformSegments } from './transform-segments.js';

const DATA = path.join(import.meta.dirname, '..', 'src', 'data');
const source = JSON.parse(fs.readFileSync(path.join(DATA, 'segments.json'), 'utf8'));
const out = transformSegments(source);
const dest = path.join(DATA, 'segments.built.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
console.log(`[preview] ${out.length} entries -> ${path.relative(process.cwd(), dest)} (gitignored)`);
