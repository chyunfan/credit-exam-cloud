/**
 * 手机端布局验收：对 dist/index.html（单文件产物）做多宽度截图 + 关键尺寸量测。
 *
 * 用法：
 *   node scripts/shot_mobile.mjs
 * 前置：先跑 `vite build && node scripts/inline.mjs` 生成 dist/index.html。
 * 说明：直接 file:// 打开单文件产物，再手动把界面切到「首页 / 答题页」，
 *       无需登录、无需后端，纯看排版。
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// playwright-core 装在 node 隔离工作区里（ESM 不认 NODE_PATH，只能用绝对路径加载）
const PW_CORE = process.env.PW_CORE
  || 'C:/Users/cyf/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const _pw = await import(pathToFileURL(PW_CORE).href);      // CommonJS 包，导出可能挂在 default 上
const chromium = _pw.chromium || _pw.default?.chromium;

const EXE = 'C:/Users/cyf/AppData/Local/ms-playwright/chromium-1140/chrome-win/chrome.exe';
const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = pathToFileURL(path.join(ROOT, 'dist', 'index.html')).href;
const OUT = path.join(ROOT, 'shots');
fs.mkdirSync(OUT, { recursive: true });

/* 把界面切到「首页」 */
const FIX_HOME = () => {
  document.getElementById('auth').classList.add('hide');
  const app = document.getElementById('app');
  app.classList.remove('hide', 'in-practice');
  for (const s of ['banks', 'home', 'practice', 'result']) document.getElementById(s).classList.add('hide');
  document.getElementById('home').classList.remove('hide');
  document.getElementById('topBankName').textContent = '合规-人事';
  document.getElementById('topUser').textContent = 'admin';
};

/* 把界面切到「答题页」，并注入一道假题用于观感 */
const FIX_PRACTICE = () => {
  document.getElementById('auth').classList.add('hide');
  const app = document.getElementById('app');
  app.classList.remove('hide');
  app.classList.add('in-practice');
  for (const s of ['banks', 'home', 'practice', 'result']) document.getElementById(s).classList.add('hide');
  document.getElementById('practice').classList.remove('hide');
  document.getElementById('pcount').textContent = '第 1 / 170 题';
  document.getElementById('modeTag').textContent = '顺序练习 · 共 170 题';
  document.getElementById('pbarFill').style.width = '1%';
  document.getElementById('sheetToggle').classList.remove('hide');
  document.getElementById('sheetCount').textContent = '(0/170)';
  document.getElementById('qBody').innerHTML = `
    <div class="qhead"><span class="badge b-single">单选题</span><button class="favBtn">☆</button></div>
    <div class="stem">《关于进一步规范和加强行社员工招聘管理的指导意见》，员工招聘管理的首要标准是什么？</div>
    <div class="opts">
      <div class="opt"><span class="k">A</span><span class="txt">学历背景</span></div>
      <div class="opt"><span class="k">B</span><span class="txt">工作经验</span></div>
      <div class="opt"><span class="k">C</span><span class="txt">认同企业价值观与品德优良</span></div>
      <div class="opt"><span class="k">D</span><span class="txt">专业技能</span></div>
    </div>`;
};

/* 首页量测 */
const M_HOME = () => {
  const h = el => (el ? Math.round(el.getBoundingClientRect().height) : null);
  const tb2 = document.getElementById('topbar2');
  const d = getComputedStyle(tb2).display;
  const t = document.querySelector('.tb-title').getBoundingClientRect();
  const r = document.querySelector('.tb-right').getBoundingClientRect();
  return {
    顶部栏高度: d === 'none' ? '（已隐藏）' : h(tb2) + 'px',
    标题与按钮是否重叠: Math.round(t.right) > Math.round(r.left) ? '重叠!' : '不重叠',
    首页是否冒出底部操作条: document.querySelector('#practice .nav').getBoundingClientRect().height > 0 ? '冒出来了 ❌' : '没有 ✅',
    横向溢出px: document.documentElement.scrollWidth - document.documentElement.clientWidth
  };
};

/* 答题页量测：题干出现前占掉的纵向空间 */
const M_PRACTICE = () => {
  const h = el => (el ? Math.round(el.getBoundingClientRect().height) : null);
  const tb2 = document.getElementById('topbar2');
  const stem = document.querySelector('#practice .stem').getBoundingClientRect();
  return {
    视口宽: document.documentElement.clientWidth + 'px',
    顶部栏高度: getComputedStyle(tb2).display === 'none' ? '（已收起，省空间）' : h(tb2) + 'px',
    退出按钮高度: h(document.getElementById('quitBtn')),
    答题卡按钮高度: document.getElementById('sheetToggle').classList.contains('hide') ? '（隐藏）' : h(document.getElementById('sheetToggle')),
    上一题按钮高度: h(document.getElementById('prevBtn')) + '（>50 说明文字换行了）',
    从屏幕顶端到题干: Math.round(stem.top) + 'px',
    横向溢出px: document.documentElement.scrollWidth - document.documentElement.clientWidth
  };
};

/* 底部操作条量测：是否真的固定在屏幕最下方 */
const M_FIXED = () => {
  const nav = document.querySelector('#practice .nav');
  const r = nav.getBoundingClientRect();
  const cs = getComputedStyle(nav);
  const tail = document.getElementById('probeTail');
  const tr = tail ? tail.getBoundingClientRect() : null;
  return {
    定位方式: cs.position + (cs.position === 'fixed' ? ' ✅' : ' ❌ 应为 fixed'),
    底栏底边距视口底: Math.round(window.innerHeight - r.bottom) + 'px（0 = 贴底）',
    底栏高度: Math.round(r.height) + 'px',
    左右留白: Math.round(r.left) + ' / ' + Math.round(window.innerWidth - r.right) + '（居中应相等）',
    是否已滚到最底: Math.abs(document.documentElement.scrollHeight - window.innerHeight - window.scrollY) < 3 ? '是 ✅' : '否',
    内容底部与底栏间隙: tr ? Math.round(r.top - tr.bottom) + 'px' + (r.top - tr.bottom >= 0 ? ' ✅ 未遮挡' : ' ❌ 被遮挡') : '—',
    横向溢出px: document.documentElement.scrollWidth - document.documentElement.clientWidth
  };
};

/* 三按钮共存（上一题 / 核对答案 / 下一题）时，窄屏是否把文字挤出去 */
const SHOW_CHECK = () => { document.getElementById('checkBtn').classList.remove('hide'); };
const M_THREE = () => {
  const out = {};
  for (const id of ['prevBtn', 'checkBtn', 'nextBtn']) {
    const el = document.getElementById(id);
    out[id] = Math.round(el.getBoundingClientRect().width) + 'px'
      + (el.scrollWidth > el.clientWidth + 1 ? ' ⚠️ 文字溢出' : ' ✅');
  }
  out.底栏内容宽 = Math.round(document.querySelector('#practice .nav').clientWidth) + 'px';
  out.横向溢出px = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  return out;
};

/* 在题目下方塞一段长内容，制造「题目长到要滚动」的真实场景 */
const PAD_TAIL = () => {
  document.getElementById('qBody').insertAdjacentHTML('beforeend', '<div id="probeTail" style="height:1000px"></div>');
  window.scrollTo(0, 999999);
};

const browser = await chromium.launch({ executablePath: EXE });
const report = {};

const WIDTHS = [375, 320, 1280];   // 手机两档 + 桌面（验底栏是否居中限宽）

for (const w of WIDTHS) {
  const desk = w >= 1000;
  const tag = desk ? 'desktop' : 'mobile';
  const ctx = await browser.newContext({
    viewport: { width: w, height: desk ? 800 : 812 },
    deviceScaleFactor: desk ? 1 : 2
  });
  const page = await ctx.newPage();
  await page.goto(FILE);
  await page.waitForTimeout(1200); // 等 main.js 的 boot() 跑完，避免它随后覆盖注入的界面

  await page.evaluate(FIX_HOME);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, `${tag}-${w}-home.png`), clip: { x: 0, y: 0, width: w, height: 300 } });
  const home = await page.evaluate(M_HOME);

  await page.evaluate(FIX_PRACTICE);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, `${tag}-${w}-practice.png`), clip: { x: 0, y: 0, width: w, height: desk ? 800 : 760 } });
  const prac = await page.evaluate(M_PRACTICE);

  // 三按钮共存：核对答案按钮显示出来，验窄屏是否挤出边界
  await page.evaluate(SHOW_CHECK);
  await page.waitForTimeout(120);
  const three = await page.evaluate(M_THREE);
  await page.screenshot({ path: path.join(OUT, `${tag}-${w}-practice-3btn.png`), clip: { x: 0, y: desk ? 500 : 620, width: w, height: desk ? 300 : 192 } });

  // 制造「题目很长需要滚动」的场景，滚到最底再验操作条是否仍贴屏幕底部
  await page.evaluate(PAD_TAIL);
  await page.waitForTimeout(250);
  const fixed = await page.evaluate(M_FIXED);
  await page.screenshot({ path: path.join(OUT, `${tag}-${w}-practice-scrolled.png`) });

  report[w + 'px'] = { 首页: home, 答题页: prac, 三按钮底栏: three, 底部操作条: fixed };
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify(report, null, 2));
console.log('截图输出：' + OUT);
