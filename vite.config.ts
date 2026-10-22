import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Stránky: publikum (/), plátno (/screen/), ovladač (/control/), statický náhled (/preview/).
// Relativní base, aby to fungovalo na GitHub Pages pod /kisk/ i lokálně.
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        audience: resolve(import.meta.dirname, 'index.html'),
        screen: resolve(import.meta.dirname, 'screen/index.html'),
        control: resolve(import.meta.dirname, 'control/index.html'),
        preview: resolve(import.meta.dirname, 'preview/index.html'),
      },
    },
  },
});
