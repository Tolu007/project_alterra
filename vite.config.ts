import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works from any static host or subfolder.
export default defineConfig({
  plugins: [react()],
  base: './',
});
