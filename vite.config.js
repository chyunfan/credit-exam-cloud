import { defineConfig } from 'vite';

// ============================================================
// base 说明（很重要，改错会导致样式/脚本 404）
// ------------------------------------------------------------
// 本应用在 chyunfan.cn 上不是直接部署，而是被「网关项目的 rewrites」代理到
// 子路径 /credit-exam-cloud（参见该网关 vercel.json：
//   { "source": "/credit-exam-cloud(.*)", "destination": "https://credit-exam-cloud.vercel.app$1" } ）
//
// rewrites 属于服务端代理，浏览器地址栏 URL 不会变。因此：
//   ✗ base './'  → 产出 ./assets/x.js，浏览器会按「当前目录=站点根」解析成
//                  https://www.chyunfan.cn/assets/x.js → 落到网关的兜底规则 → 404（样式全丢）
//   ✓ base '/credit-exam-cloud/' → 产出 /credit-exam-cloud/assets/x.js，
//                  正好命中网关的 /credit-exam-cloud(.*) 规则 → 转发到 Vercel → 200
//
// 同样的做法已在 /eva 上验证可用（其产物引用 /eva/assets/...）。
// 该 base 同时被 src/auth.js 用来拼接后端接口地址（import.meta.env.BASE_URL）。
// ============================================================
const APP_BASE = '/credit-exam-cloud/';

export default defineConfig({
  root: '.',
  base: APP_BASE,
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 5173
  }
});
