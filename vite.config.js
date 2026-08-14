import { defineConfig } from 'vite';
import compression from 'vite-plugin-compression';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSegments } from './scripts/transform-segments.js';

const SEGMENTS_SOURCE = fileURLToPath(new URL('./src/data/segments.json', import.meta.url));

// Derives the runtime segment payload from the authored source at build/serve time:
// ordering + field-strip live in transformSegments, so the source stays the single
// committed file and nothing on disk is a generated artifact. addWatchFile re-derives
// on a source edit, keeping tune-by-ear a save-and-listen loop.
function roxySegments() {
  const ID = 'virtual:roxy-segments';
  const RESOLVED = '\0' + ID;
  return {
    name: 'roxy-segments',
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED) return;
      this.addWatchFile(SEGMENTS_SOURCE);
      const source = JSON.parse(fs.readFileSync(SEGMENTS_SOURCE, 'utf8'));
      return `export default ${JSON.stringify(transformSegments(source))};`;
    },
  };
}

const buildCompressors = [
  compression({
    algorithm: 'gzip',
    ext: '.gz',
    deleteOriginFile: false,
  }),
  compression({
    algorithm: 'brotliCompress',
    ext: '.br',
    deleteOriginFile: false,
  }),
];

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

  return {
    base: isProd ? './' : '/',
    plugins: [roxySegments(), ...(isProd ? buildCompressors : [])],
    build: {
      minify: 'esbuild',
      target: 'esnext',
      sourcemap: !isProd,
    },
    test: {
      environment: 'happy-dom',
    },
  };
});
