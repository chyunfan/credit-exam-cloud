/**
 * 验收「练习选项退出后保持上次设置」。
 *
 * 用法：node scripts/check_prefs.mjs      （前置：先构建出 dist/index.html）
 *
 * 做法：file:// 打开单文件产物 → 模拟用户切换 4 个开关 → 刷新页面（等价于
 *       "退出后再次打开/登录"）→ 检查开关是否回到用户改过的状态，而不是 HTML 里的默认值。
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const PW_CORE = process.env.PW_CORE
  || 'C:/Users/cyf/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const _pw = await import(pathToFileURL(PW_CORE).href);
const chromium = _pw.chromium || _pw.default?.chromium;
const EXE = 'C:/Users/cyf/AppData/Local/ms-playwright/chromium-1140/chrome-win/chrome.exe';
const FILE = pathToFileURL(path.resolve(import.meta.dirname, '..', 'dist', 'index.html')).href;

const SWITCHES = ['showAns', 'rmAll', 'rmCorrectJudge', 'revealAfter', 'autoRemoveWrong'];
const HTML_DEFAULT = { showAns: false, rmAll: true, rmCorrectJudge: true, revealAfter: false, autoRemoveWrong: true };
const readSwitches = ids => Object.fromEntries(ids.map(id => [id, document.getElementById(id).checked]));

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 375, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto(FILE);
await page.waitForTimeout(1200);

// 1) 用户手动改 4 个开关（模拟真实点击：改 checked 再派发 change）
await page.evaluate(() => {
  const toggle = id => {
    const el = document.getElementById(id);
    el.checked = !el.checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  ['showAns', 'rmAll', 'rmCorrectJudge', 'revealAfter'].forEach(toggle);
});
await page.waitForTimeout(300);

const changed = await page.evaluate(readSwitches, SWITCHES);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('credit_exam_cfg') || 'null'));

// 2) 刷新页面 = 退出后再次打开/登录
await page.reload();
await page.waitForTimeout(1200);
const afterReload = await page.evaluate(readSwitches, SWITCHES);

// 3) 顺手拍一张「练习选项」区域，看提示文案与开关状态
await page.evaluate(() => {
  document.getElementById('auth').classList.add('hide');
  const app = document.getElementById('app');
  app.classList.remove('hide', 'in-practice');
  ['banks', 'practice', 'result'].forEach(s => document.getElementById(s).classList.add('hide'));
  document.getElementById('home').classList.remove('hide');
});
const clip = await page.evaluate(() => {
  const sec = [...document.querySelectorAll('#home .section')].find(s => s.textContent.includes('练习选项'));
  sec.scrollIntoView({ block: 'center' });
  const r = sec.getBoundingClientRect();
  return { x: 0, y: Math.max(0, Math.round(r.top - 12)), width: 375, height: Math.round(Math.min(r.height + 24, 880)) };
});
await page.screenshot({ path: path.resolve(import.meta.dirname, '..', 'shots', 'prefs-section.png'), clip });

await browser.close();

// 3) 判定
const rows = SWITCHES.map(k => ({
  开关: k,
  页面默认值: HTML_DEFAULT[k],
  用户改后: changed[k],
  刷新后: afterReload[k],
  是否记住: changed[k] === afterReload[k] ? '✅' : '❌ 丢失'
}));
const ok = rows.every(r => r['是否记住'] === '✅');
const reallyRestored = SWITCHES.some(k => HTML_DEFAULT[k] !== afterReload[k]); // 确实不是"回到默认"

console.log(JSON.stringify({
  本地存储: stored ? { 有updatedAt: typeof stored.updatedAt === 'number', rmAll: stored.rmAll, revealAfter: stored.revealAfter } : '（无）',
  逐项: rows,
  结论: ok ? '✅ 退出后保持上次设置' : '❌ 有设置未保持',
  佐证非默认值: reallyRestored ? '✅ 恢复的是用户设定，不是 HTML 默认' : '⚠️ 恰好与默认相同，判据不足',
  JS错误: errors.length ? errors : '无'
}, null, 2));
