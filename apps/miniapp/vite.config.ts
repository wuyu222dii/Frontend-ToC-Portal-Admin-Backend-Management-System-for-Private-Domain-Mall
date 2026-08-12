import uni from '@dcloudio/vite-plugin-uni';
import { defineConfig } from 'vite';

const uniPlugin = (uni as typeof uni & { default?: typeof uni }).default ?? uni;

export default defineConfig({
  plugins: [uniPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
