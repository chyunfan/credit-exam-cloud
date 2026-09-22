// 检查线上 bundle 是否包含最新改动标记
const base = 'https://www.chyunfan.cn/credit-exam-cloud';
const markers = ['flushNow', 'cancelPending', 'loadBankState', 'exam_bank_progress',
  'exam_banks', 'openBankById', 'applyTemplateInline', 'inline', '__diag__'];

const count = (s, n) => s.split(n).length - 1;

(async () => {
  const html = await (await fetch(base + '/index.html')).text();
  const jsPath = (html.match(/src="([^"]*\.js)"/) || [])[1];
  console.log('线上 JS:', jsPath);
  const jsUrl = new URL(jsPath, base + '/').toString();
  const js = await (await fetch(jsUrl)).text();
  console.log('bytes:', Buffer.byteLength(js));
  for (const m of markers) console.log('  ' + m.padEnd(20) + count(js, m));
})();
