import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { devApi } from './server/dev-plugin';

// base './' so the build works from any static host or subfolder. In dev, /api is served by the same
// handler that runs on Vercel.
export default defineConfig({
  plugins: [react(), devApi()],
  base: './',
});
