import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  // GRC_WEB_DIST lets several builds coexist (the server reads the same variable).
  build: { outDir: process.env.GRC_WEB_DIST || '../dist/web', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    fs: { allow: ['..'] }, // the Help pages are bundled from docs/user
    port: 5173,
    proxy: { '/api': `http://127.0.0.1:${process.env.GRC_PORT || 8080}` },
  },
});
