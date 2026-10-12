import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// A Netlify build without the API URL ships a bundle that calls localhost.
// Fail the production deploy (the live site keeps its previous version);
// previews and branch deploys still build, with a warning, so pull requests
// aren't blocked before the API exists.
if (process.env.NETLIFY === 'true' && !process.env.VITE_API_URL) {
  const message =
    'VITE_API_URL is not set. Add it under Site configuration → Environment variables.';
  if (process.env.CONTEXT === 'production') throw new Error(message);
  console.warn(
    `Warning: ${message} This ${process.env.CONTEXT ?? 'non-production'} build will call http://localhost:4000.`,
  );
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
