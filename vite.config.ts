import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { allowedHosts: ['terminal.local'] },
  build: { rollupOptions: { output: { manualChunks: { react: ['react','react-dom'], motion: ['framer-motion'] } } } },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] }
});
