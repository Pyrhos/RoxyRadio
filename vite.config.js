import { defineConfig } from 'vite';
import compression from 'vite-plugin-compression';

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
    plugins: isProd ? buildCompressors : [],
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

