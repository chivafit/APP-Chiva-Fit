const { defineConfig } = require('vite');
const path = require('path');

module.exports = defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : '/APP-Chiva-Fit/',
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        login: path.resolve(__dirname, 'login.html'),
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
}));
