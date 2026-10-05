import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Página estática: caminhos relativos, funciona em qualquer hospedagem.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5175 },
});
