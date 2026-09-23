import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: './',
  build: { rollupOptions: { input: {
    home: resolve(import.meta.dirname, 'index.html'),
    planner: resolve(import.meta.dirname, 'planning.html'),
    login: resolve(import.meta.dirname, 'login.html'),
    profile: resolve(import.meta.dirname, 'profile.html'),
    roster: resolve(import.meta.dirname, 'roster.html'),
    admin: resolve(import.meta.dirname, 'admin/index.html'),
  } } },
});
