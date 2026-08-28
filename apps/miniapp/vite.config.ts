import uni from '@dcloudio/vite-plugin-uni';
import { defineConfig } from 'vite';

const uniPlugin = (uni as typeof uni & { default?: typeof uni }).default ?? uni;
const devPort = Number(process.env.MINIAPP_DEV_PORT?.trim() || '5173');
const apiProxyTarget = process.env.MINIAPP_DEV_API_PROXY_TARGET?.trim() || 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [uniPlugin()],
  server: {
    port: devPort,
    proxy: {
      '/api/v1': {
        target: apiProxyTarget,
      },
    },
    strictPort: true,
  },
});
