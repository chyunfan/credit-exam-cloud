import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // 相对路径引用资源：域名根、子路径、本地预览都能正确加载
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 5173
  }
});
