// 线上前端版本核对：Node 的 fetch 会自动解压 gzip/br
const BASE = process.argv[2] || 'https://www.chyunfan.cn/credit-exam-cloud';

const html = await fetch(BASE, { headers: { 'Cache-Control': 'no-cache' } }).then(r => r.text());
console.log('HTML chars:', html.length, '| buildTag 元素:', html.includes('id="buildTag"'));
const jsPath = /src="([^"]+\.js)"/.exec(html)?.[1];
console.log('JS path:', jsPath);

const js = await fetch('https://www.chyunfan.cn' + jsPath, { headers: { 'Cache-Control': 'no-cache' } }).then(r => r.text());
console.log('JS chars:', js.length);

const marks = {
  'v2.1 版本号': 'v2.1',
  '后端正常 文案': '后端正常',
  'checkBackend → /api/health': 'api/health',
  '多候选回退（接口未就绪）': '接口未就绪',
  '旧文案（网络错误）': '网络错误',
  'BASE_URL 字面量 /credit-exam-cloud/': '"/credit-exam-cloud/"',
  '调用 /api/register': '/api/register',
  'exam_banks 表': 'exam_banks',
  'supabase 域名': 'supabase.co',
  'SheetJS 标记 XLSX': 'XLSX',
};
for (const [k, v] of Object.entries(marks)) console.log('  ' + k.padEnd(32, ' ') + ':', js.includes(v));

const i = js.indexOf('.replace(/\\/+$/');
if (i > 0) console.log('\nBASE_URL 片段:', JSON.stringify(js.slice(Math.max(0, i - 90), i + 15)));
const j = js.indexOf('api/health');
if (j > 0) console.log('health 调用片段:', JSON.stringify(js.slice(Math.max(0, j - 120), j + 60)));
