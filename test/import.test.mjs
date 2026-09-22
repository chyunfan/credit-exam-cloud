import * as XLSX from 'xlsx';
import { parseWorkbook, buildTemplateWorkbook, buildBankWorkbook } from '../src/import.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

function wb(aoa) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const b = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(b, ws, 's');
  return XLSX.write(b, { type: 'array', bookType: 'xlsx' });
}

console.log('TEST parseWorkbook:');
const sample = [
  ['题型', '案例材料', '题干', 'A', 'B', 'C', 'D', 'E', 'F', '答案', '解析'],
  ['单选', '', 'q1', 'a', 'b', 'c', '', '', '', 'A', 'x'],
  ['多选', '', 'q2', 'a', 'b', 'c', '', '', '', 'AB', 'x'],
  ['判断', '', 'q3', '', '', '', '', '', '', '对', 'x'],
  ['案例', '案情背景', '子问题1', 'a', 'b', 'c', '', '', '', 'A', ''],
  ['案例', '案情背景', '子问题2', 'a', 'b', 'c', '', '', '', 'BC', '']
];
const r = parseWorkbook(wb(sample));
ok(r.ok, '样例解析成功 (ok=' + r.ok + ')');
ok(r.questions.length === 5, '共 5 题 (got ' + r.questions.length + ')');
ok(r.caseCount === 1, '案例 1 组 (got ' + r.caseCount + ')');

const single = r.questions[0];
ok(single.type === 'single' && single.answerKeys.join('') === 'A', '单选题答案归一化 A');
const multi = r.questions[1];
ok(multi.type === 'multiple' && multi.answerKeys.join('') === 'AB', '多选题答案 AB');
const judge = r.questions[2];
ok(judge.type === 'judge' && judge.answerKeys.join('') === 'A' && judge.options.length === 2, '判断题生成 正确/错误 两选项');
const c1 = r.questions[3], c2 = r.questions[4];
ok(c1.isCase && c1.caseId === c2.caseId && c1.caseBackground === '案情背景', '案例子题共享 caseId/背景');
ok(c2.type === 'multiple' && c2.answerKeys.join('') === 'BC', '案例子题（多选 BC）识别正确');

console.log('TEST 校验拦截:');
const bad = [
  ['题型', '题干', 'A', 'B', '答案'],
  ['填空', '非法题型', 'a', 'b', 'A'],          // 题型非法
  ['单选', '全选判断缺失', 'a', '', 'A'],         // 选项不足(仅1个)
  ['多选', '全选', 'a', 'b', 'AB'],              // 正确(2选2) -> 合法
];
const rb = parseWorkbook(wb(bad));
ok(!rb.ok, '含非法题型时整体不通过 (ok=' + rb.ok + ')');
ok(rb.errors.length >= 1, '产生错误清单 (' + rb.errors.length + ' 条)');

const allSel = [
  ['题型', '题干', 'A', 'B', 'C', '答案'],
  ['多选', '全选应被拒', 'a', 'b', 'c', 'ABC']
];
const ra = parseWorkbook(wb(allSel));
ok(!ra.ok && ra.errors.some(e => /全选/.test(e)), '多选全选被拦截');

console.log('TEST 模板/导出 round-trip:');
const tpl = buildTemplateWorkbook();
ok(!!tpl.Sheets['题库模板'], '模板工作簿生成成功');
const exp = buildBankWorkbook(r.questions);
const re = parseWorkbook(XLSX.write(exp, { type: 'array', bookType: 'xlsx' }));
ok(re.ok && re.questions.length === 5, '导出再导入数量一致 (got ' + re.questions.length + ')');

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
