import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  optimizeDeps: {
    exclude: ['@sudonym-btc/marketplace-evm-contracts'],
  },
  resolve: {
    alias: [
      {
        find: /^shiki$/,
        replacement: new URL('./src/codeHints/shikiSingleton.ts', import.meta.url).pathname,
      },
      {
        find: '@',
        replacement: new URL('./src', import.meta.url).pathname,
      },
    ],
  },
  server: {
    allowedHosts: [
      '.test',
      'ts.client.marketplace.test',
    ],
    port: 5178,
  },
})
