import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // three.js dwarfs the app code and changes on its own cadence.
          if (/node_modules[\\/]three[\\/]/.test(id)) return "three";
        },
      },
    },
  },
});
