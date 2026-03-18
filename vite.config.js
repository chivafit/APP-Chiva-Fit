import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function normalizeBasePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let out = raw;
  if (!out.startsWith('/')) out = `/${out}`;
  if (!out.endsWith('/')) out = `${out}/`;
  return out;
}

export default defineConfig(({ command }) => {
  const envBase = normalizeBasePath(process.env.VITE_BASE_PATH || process.env.BASE_PATH || '');
  const base = envBase || (command === 'serve' ? '/' : '/');

  return {
    base,
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
          login: resolve(__dirname, 'login.html'),
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        include: ['utils.js', 'constants.js', 'store.js'],
      },
    },
  };
});
