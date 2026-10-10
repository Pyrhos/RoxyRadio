import { defineConfig } from 'vite';
import compression from 'vite-plugin-compression';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSegments } from './scripts/transform-segments.js';

const SEGMENTS_SOURCE = fileURLToPath(new URL('./src/data/segments.json', import.meta.url));

function deriveRuntimePayload() {
  return transformSegments(JSON.parse(fs.readFileSync(SEGMENTS_SOURCE, 'utf8')));
}

// Derives the runtime segment payload from the authored source at build/serve time:
// ordering + field-strip live in transformSegments, so the source stays the single
// committed file and nothing on disk is a generated artifact. addWatchFile re-derives
// on a source edit, keeping tune-by-ear a save-and-listen loop.
//
// The payload is exposed two ways, both from the same derive so they never diverge:
//   1. the inlined `virtual:roxy-segments` module — the app's primary data source.
//   2. an unhashed `segments.json` (emitted at build; served no-store in dev) — a
//      stable-URL fallback the app fetches only when a shared `?v=` link points at a
//      stream a stale cached bundle doesn't know (see app.js cold path).
function roxySegments() {
  const ID = 'virtual:roxy-segments';
  const RESOLVED = '\0' + ID;
  return {
    name: 'roxy-segments',
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED) return;
      this.addWatchFile(SEGMENTS_SOURCE);
      return `export default ${JSON.stringify(deriveRuntimePayload())};`;
    },
    generateBundle() {
      // fileName (not name) keeps it unhashed at dist root: a stable URL to fetch.
      this.emitFile({ type: 'asset', fileName: 'segments.json', source: JSON.stringify(deriveRuntimePayload()) });
    },
    configureServer(server) {
      // Serve the fallback in dev too, derived fresh per request so it tracks source
      // edits like the inlined module does. (In practice the cold path never fires in
      // dev, since the inlined data is already fresh — this only keeps dev == prod.)
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0];
        if (path !== '/segments.json') return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(deriveRuntimePayload()));
      });
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
