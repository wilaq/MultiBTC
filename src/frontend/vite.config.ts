import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Project root holds the dfx-generated .env file with CANISTER_ID_* + DFX_NETWORK.
const PROJECT_ROOT = resolve(__dirname, '../..');

export default defineConfig({
  plugins: [react()],
  envDir: PROJECT_ROOT,
  envPrefix: ['VITE_', 'CANISTER_ID_', 'DFX_'],
  resolve: {
    alias: {
      declarations: resolve(__dirname, '../../declarations'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4943',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
