import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@sudonym-btc/marketplace-evm-contracts'],
  },
  server: {
    port: 5178,
  },
})
