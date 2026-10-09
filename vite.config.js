import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { localPreviewPlugin } from './scripts/local-preview-server.mjs';
export default defineConfig({
  plugins: process.env.VITE_LOCAL_SANDBOX === '1' ? [localPreviewPlugin()] : [],
  base: './',
  build: { rollupOptions: { input: {
    home: resolve(import.meta.dirname, 'index.html'),
    planner: resolve(import.meta.dirname, 'planning.html'),
    groups: resolve(import.meta.dirname, 'groups.html'),
    login: resolve(import.meta.dirname, 'login.html'),
    profile: resolve(import.meta.dirname, 'profile.html'),
    roster: resolve(import.meta.dirname, 'roster.html'),
    tools: resolve(import.meta.dirname, 'tools.html'),
    admin: resolve(import.meta.dirname, 'admin/index.html'),
  } } },
});
