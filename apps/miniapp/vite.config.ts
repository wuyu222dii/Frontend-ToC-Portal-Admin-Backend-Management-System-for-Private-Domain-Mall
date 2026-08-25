import uni from '@dcloudio/vite-plugin-uni';
import { defineConfig } from 'vite';

const uniPlugin = (uni as typeof uni & { default?: typeof uni }).default ?? uni;

export default defineConfig({
  plugins: [uniPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api/v1': {
        target: 'http://127.0.0.1:3000',
      },
    },
    strictPort: true,
  },
});
