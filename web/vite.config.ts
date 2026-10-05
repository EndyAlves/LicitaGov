import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // O build de demonstração vira uma página estática: caminhos relativos e saída separada.
  base: mode === 'demo' ? './' : '/',
  build: mode === 'demo' ? { outDir: 'dist-demo' } : undefined,
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:3334' },
  },
}));
