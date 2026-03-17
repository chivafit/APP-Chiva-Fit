const { defineConfig } = require("vite");
const path = require("path");

module.exports = defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, "index.html"),
        login: path.resolve(__dirname, "login.html"),
      },
    },
  },
});
