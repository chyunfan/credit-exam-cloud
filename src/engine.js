import {
  LS, loadArr, saveArr, addId, removeId, hasId, countId,
  clearProgress, saveProgress, loadProgress
} from './store.js';

// ---------- data source (set per bank) ----------
let QUESTIONS = [];
export function setQuestions(arr) { QUESTIONS = Array.isArray(arr) ? arr : []; }

// ---------- state ----------
const S = {
  mode: 'sequential', types: { single: true, multiple: true, judge: true, case: true },
  showAns: false, rmAll: true, rmCorrectJudge: true, revealAfter: false, autoRemoveWrong: true,
  examCounts: { single: 60, multiple: 40, judge: 20, case: 5 },
  examPoints: { single: 0.5, multiple: 1, judge: 0.5, case: 4 },
  examMin: 90,
  pool: [], idx: 0, userAns: [], revealed: [], correctCount: 0, questionPts: [],
  timer: null, deadline: 0, finished: false
};
const TYPE_NAME = { single: '单选题', multiple: '多选题', judge: '判断题', case: '案例题' };
const TYPE_CLS = { single: 'b-single', multiple: 'b-multi', judge: 'b-judge', case: 'b-case' };

function $(id) { return document.getElementById(id); }
function saveSettings() {
  try { localStorage.setItem('credit_exam_cfg', JSON.stringify(
    { mode: S.mode, types: S.types, showAns: S.showAns, rmAll: S.rmAll, rmCorrectJudge: S.rmCorrectJudge, revealAfter: S.revealAfter, autoRemoveWrong: S.autoRemoveWrong,
      examCounts: S.examCounts, examPoints: S.examPoints, examMin: S.examMin })); } catch (e) { }
}
function loadSettings() {
  try { const c = JSON.parse(localStorage.getItem('credit_exam_cfg')); if (c) {
    S.mode = c.mode || 'sequential'; S.types = Object.assign(S.types, c.types || {});
    S.showAns = !!c.showAns; S.rmAll = !!c.rmAll; S.rmCorrectJudge = (c.rmCorrectJudge === undefined ? true : !!c.rmCorrectJudge); S.revealAfter = !!c.revealAfter;
    S.autoRemoveWrong = (c.autoRemoveWrong === undefined ? true : !!c.autoRemoveWrong);
    if (c.examCounts) S.examCounts = Object.assign(S.examCounts, c.examCounts);
    if (c.examPoints) S.examPoints = Object.assign(S.examPoints, c.examPoints);
    S.examMin = c.examMin || 90;
  } } catch (e) { }
}

function updateMaxScore() {
  const c = S.examCounts, p = S.examPoints;
  const max = Math.round((c.single * p.single + c.multiple * p.multiple + c.judge * p.judge + c.case * p.case) * 10) / 10;
  const el = document.getElementById('maxScore'); if (el) el.textContent = max;
}

// ---------- pool building ----------
function isAllSelected(q) {
  return q.type === 'multiple' && Array.isArray(q.correctIdx) &&
    q.correctIdx.length === q.options.length && q.options.length > 0;
}
function isAnswered(a) { return a !== null && !(Array.isArray(a) && a.length === 0); }
function revealMode(q, i) {
  if (S.showAns) return 'full';
  const r = getRender(q);
  if (S.revealAfter && !r.multi && isAnswered(S.userAns[i])) return 'full';
  if (S.revealed[i]) return 'full';
  return null;
}
function buildPool() {
  if (S.mode === 'wrong' || S.mode === 'fav') {
    const set = new Set(loadArr(S.mode === 'wrong' ? LS.wrong : LS.fav));
    return QUESTIONS.filter(q => set.has(q.id) && (q.isCase ? S.types.case : S.types[q.type]));
  }
  let pool = QUESTIONS.filter(q => {
    if (q.isCase) { if (!S.types.case) return false; }
    else if (!S.types[q.type]) return false;
    if (S.rmAll && !q.isCase && q.type === 'multiple' && isAllSelected(q)) return false;
    if (S.rmCorrectJudge && !q.isCase && q.type === 'judge' && q.answerText === '正确') return false;
    return true;
  });
  return pool;
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function updateFilterStat() {
  const el = $('filterStat'); if (!el) return;
  let base = 0, rmAllN = 0, rmJudgeN = 0;
  QUESTIONS.forEach(q => {
    if (q.isCase) { if (!S.types.case) return; }
    else if (!S.types[q.type]) return;
    base++;
    if (S.rmAll && !q.isCase && q.type === 'multiple' && isAllSelected(q)) rmAllN++;
    if (S.rmCorrectJudge && !q.isCase && q.type === 'judge' && q.answerText === '正确') rmJudgeN++;
  });
  const remain = base - rmAllN - rmJudgeN;
  const removed = [];
  if (S.rmAll && rmAllN > 0) removed.push('去多选全选 ' + rmAllN + ' 题');
  if (S.rmCorrectJudge && rmJudgeN > 0) removed.push('去正确判断题 ' + rmJudgeN + ' 题');
  const extra = removed.length ? '（' + removed.join('，') + '）' : '';
  el.innerHTML = '当前勾选下共 <b>' + base + '</b> 题' + extra + '，最终 <b class="hl">' + remain + '</b> 题';
}
function sampleExam(pool, counts) {
  const byType = { single: [], multiple: [], judge: [], case: [] };
  const caseMap = {};
  pool.forEach(q => {
    if (q.isCase) { (caseMap[q.caseId] = caseMap[q.caseId] || []).push(q); }
    else byType[q.type].push(q);
  });
  const out = [];
  ['single', 'multiple', 'judge'].forEach(t => {
    const want = Math.min(counts[t] || 0, byType[t].length);
    shuffle(byType[t]).slice(0, want).forEach(q => out.push(q));
  });
  const wantCase = Math.min(counts.case || 0, Object.keys(caseMap).length);
  shuffle(Object.values(caseMap)).slice(0, wantCase).forEach(grp => grp.forEach(q => out.push(q)));
  return out;
}
function assignPts(pool) {
  const caseSubCount = {};
  pool.forEach(q => { if (q.isCase) { caseSubCount[q.caseId] = (caseSubCount[q.caseId] || 0) + 1; } });
  return pool.map(q => {
    if (q.isCase) return Math.round(S.examPoints.case / (caseSubCount[q.caseId] || 1) * 1000) / 1000;
    return S.examPoints[q.type];
  });
}

// ---------- render helpers ----------
function getRender(q) {
  if (q.type === 'judge') {
    const choices = q.options ? q.options.map(o => o.text) : ['正确', '错误'];
    const keys = q.options ? q.options.map(o => o.key) : ['A', 'B'];
    let correctIndex = -1;
    const ci = q.correctIdx;
    if (Array.isArray(ci) && ci.length) correctIndex = ci[0];
    else if (q.answerText && choices.indexOf(q.answerText) >= 0) correctIndex = choices.indexOf(q.answerText);
    return { choices, correctIndex, keys, multi: false, judge: true };
  } else {
    const choices = q.options.map(o => o.text);
    const keys = q.options.map(o => o.key);
    return { choices, correctIndex: q.correctIdx, keys, multi: (q.type === 'multiple'), judge: false };
  }
}
function letterOf(q, i) { const r = getRender(q); return r.keys[i]; }

// ---------- start ----------
function start(p, atIdx) {
  let pool, resumed = !!p, rem = 0;
  if (resumed) {
    S.mode = p.mode || 'sequential';
    S.types = Object.assign({ single: true, multiple: true, judge: true, case: true }, p.types || {});
    S.showAns = !!p.showAns; S.rmAll = !!p.rmAll;
    S.rmCorrectJudge = (p.rmCorrectJudge === undefined ? true : !!p.rmCorrectJudge);
    S.revealAfter = !!p.revealAfter;
    S.autoRemoveWrong = (p.autoRemoveWrong === undefined ? true : !!p.autoRemoveWrong);
    applyUIFromState();
    if (Array.isArray(p.ids) && p.ids.length) {
      const idset = new Set(p.ids);
      pool = QUESTIONS.filter(q => idset.has(q.id));
    } else {
      pool = buildPool();
    }
    rem = p.remainingMs || 0;
  } else {
    pool = buildPool();
    if (pool.length === 0) { alert('当前筛选条件下没有可用题目，请调整设置。'); return; }
    if (S.mode === 'exam') pool = sampleExam(pool, S.examCounts);
  }
  if (pool.length === 0) { alert('没有可用题目，请返回首页调整设置。'); clearProgress(); return; }
  S.pool = pool;
  S.questionPts = S.mode === 'exam' ? assignPts(pool) : [];
  if (resumed) {
    S.idx = p.idx || 0;
    S.userAns = Array.isArray(p.userAns) ? p.userAns : new Array(pool.length).fill(null);
    S.revealed = Array.isArray(p.revealed) ? p.revealed : new Array(pool.length).fill(false);
  } else {
    S.idx = 0; S.userAns = new Array(S.pool.length).fill(null);
    S.revealed = new Array(S.pool.length).fill(false);
  }
  if (atIdx !== undefined && atIdx >= 0 && atIdx < S.pool.length) S.idx = atIdx;
  S.correctCount = 0; S.finished = false;
  saveSettings();
  $('home').classList.add('hide');
  $('result').classList.add('hide');
  $('practice').classList.remove('hide');
  $('examCfg').classList.toggle('hide', S.mode !== 'exam');
  const modeName = S.mode === 'exam' ? '组卷模拟考试' : (S.mode === 'wrong' ? '错题练习' : (S.mode === 'fav' ? '收藏练习' : '顺序练习'));
  $('modeTag').textContent = modeName + ' · 共 ' + S.pool.length + ' 题';
  $('sheetToggle').classList.toggle('hide', S.mode !== 'exam');
  $('sheetCard').classList.add('hide');
  $('sheetArr').textContent = '▾';
  $('sheetToggle').classList.remove('open');
  $('checkBtn').classList.toggle('hide', S.mode === 'exam' || S.showAns);
  if (S.mode === 'exam') startTimer(rem); else stopTimer();
  renderSheet();
  renderQuestion();
  saveProgress(rem);
}

function startTimer(remainingMs) {
  const ms = (remainingMs && remainingMs > 0) ? remainingMs : (S.examMin > 0 ? S.examMin : 60) * 60000;
  S.deadline = Date.now() + ms;
  $('timerSpan').classList.remove('hide');
  tick();
  S.timer = setInterval(tick, 1000);
}
function currentRemaining() { return S.timer ? Math.max(0, S.deadline - Date.now()) : 0; }
function stopTimer() { if (S.timer) { clearInterval(S.timer); S.timer = null; } $('timerSpan').classList.add('hide'); }
function tick() {
  const left = Math.max(0, S.deadline - Date.now());
  const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
  $('timerSpan').textContent = '⏱ ' + m + ':' + (s < 10 ? '0' : '') + s;
  if (left <= 0) { stopTimer(); finishExam(true); }
}

// ---------- question render ----------
function renderQuestion() {
  const q = S.pool[S.idx];
  const total = S.pool.length;
  $('pbarFill').style.width = ((S.idx + 1) / total * 100) + '%';
  $('pcount').textContent = '第 ' + (S.idx + 1) + ' / ' + total + ' 题';
  let badgeType = q.isCase ? 'case' : q.type;
  let badge = '<span class="badge ' + TYPE_CLS[badgeType] + '">' + TYPE_NAME[badgeType] + '</span>';
  let bgHtml = '';
  const prev = S.pool[S.idx - 1];
  if (q.isCase && q.caseBackground && !(prev && prev.isCase && prev.caseId === q.caseId)) {
    bgHtml = '<div class="bg"><span class="tag">【案例背景】</span>' + escapeHtml(String(q.caseBackground).replace(/\s+/g, ' ').trim()) + '</div>';
  }
  const r = getRender(q);
  const ans = S.userAns[S.idx];
  const mode = revealMode(q, S.idx);
  const favOn = hasId(LS.fav, q.id);
  let html = '<div class="qhead">' + badge + '<button type="button" class="favBtn ' + (favOn ? 'on' : '') + '" id="favBtn" title="收藏此题">★</button></div>' + bgHtml + '<div class="stem">' + escapeHtml(String(q.stem).replace(/\s+/g, ' ').trim()) + '</div>';
  if (r.judge) {
    html += '<div class="judge-btns" id="opts">';
    r.choices.forEach((c, i) => {
      let cls = 'opt';
      if (ans === i) cls += ' sel';
      if (mode === 'full') {
        if (i === r.correctIndex) cls += ' ok';
        else if (ans === i) cls += ' no';
        else cls += ' dim';
      }
      html += '<div class="' + cls + '" data-i="' + i + '">' + escapeHtml(c) + '</div>';
    });
    html += '</div>';
  } else {
    html += '<div class="opts" id="opts">';
    r.choices.forEach((c, i) => {
      let cls = 'opt';
      const selHere = Array.isArray(ans) ? ans.includes(i) : ans === i;
      if (selHere) cls += ' sel';
      if (mode === 'full') {
        if (Array.isArray(r.correctIndex) ? r.correctIndex.includes(i) : r.correctIndex === i) cls += ' ok';
        else if (selHere) cls += ' no';
        else cls += ' dim';
      }
      html += '<div class="' + cls + '" data-i="' + i + '"><div class="k">' + r.keys[i] + '</div><div class="txt">' + escapeHtml(String(c).replace(/\s+/g, ' ').trim()) + '</div></div>';
    });
    html += '</div>';
  }
  let fb = '', ansLine = '';
  if (mode) {
    if (mode === 'full') {
      const correct = isCorrect(q, S.idx);
      fb = '<div class="feedback show ' + (correct ? 'ok' : 'no') + '">' + (correct ? '✓ 回答正确' : '✗ 回答错误') + '</div>';
    }
    ansLine = '<div class="answer-line show">正确答案：<b>' + escapeHtml(answerKeysStr(q)) + '</b></div>';
  }
  html += fb + ansLine;
  $('qBody').innerHTML = html;
  const optsEl = $('opts');
  if (optsEl && !S.finished) {
    optsEl.querySelectorAll('.opt').forEach(el => {
      el.addEventListener('click', () => onPick(q, parseInt(el.dataset.i), r));
    });
  }
  const favBtnEl = $('favBtn');
  if (favBtnEl && !S.finished) {
    favBtnEl.addEventListener('click', () => {
      const on = !hasId(LS.fav, q.id);
      if (on) addId(LS.fav, q.id); else removeId(LS.fav, q.id);
      favBtnEl.classList.toggle('on', on);
      updateLibStats();
    });
  }
  $('prevBtn').disabled = S.idx === 0;
  const cr2 = getRender(q);
  const revealedNow = revealMode(q, S.idx) !== null;
  const nbtn = $('nextBtn');
  if (S.mode !== 'exam' && cr2.multi && !revealedNow) {
    nbtn.textContent = '确定';
    nbtn.dataset.act = 'check';
  } else {
    nbtn.textContent = (S.idx === total - 1) ? (S.mode === 'exam' ? '交卷' : '完成') : '下一题 →';
    nbtn.dataset.act = 'next';
  }
  const cbtn = $('checkBtn');
  let showCheck = false;
  if (!S.finished && S.mode === 'exam' && S.revealAfter && cr2.multi && isAnswered(ans) && revealMode(q, S.idx) !== 'full') {
    showCheck = true;
  }
  cbtn.classList.toggle('hide', !showCheck);
  renderSheet();
}

function recordWrong(q) {
  const i = S.idx;
  if (revealMode(q, i) !== 'full') return;
  if (isCorrect(q, i)) { if (S.autoRemoveWrong) removeId(LS.wrong, q.id); }
  else { addId(LS.wrong, q.id); }
}
function onPick(q, i, r) {
  if (r.multi) {
    let a = S.userAns[S.idx];
    if (!Array.isArray(a)) a = [];
    if (a.includes(i)) a = a.filter(x => x !== i); else a.push(i);
    S.userAns[S.idx] = a;
  } else {
    S.userAns[S.idx] = i;
  }
  renderQuestion();
  recordWrong(q);
  saveProgress(currentRemaining());
}

function checkCurrent() {
  const q = S.pool[S.idx];
  if (S.userAns[S.idx] === null || (Array.isArray(S.userAns[S.idx]) && S.userAns[S.idx].length === 0)) {
    alert('请先选择答案，再核对。'); return;
  }
  S.revealed[S.idx] = true;
  renderQuestion();
  recordWrong(q);
}

// ---------- correctness ----------
function isCorrect(q, i) {
  const r = getRender(q);
  const a = S.userAns[i];
  if (a === null || a === undefined) return false;
  if (r.judge) return a === r.correctIndex;
  const ci = Array.isArray(r.correctIndex) ? r.correctIndex : [r.correctIndex];
  const sa = Array.isArray(a) ? a : [a];
  if (sa.length !== ci.length) return false;
  const sa2 = [...sa].sort(), sc = [...ci].sort();
  return sa2.every((v, k) => v === sc[k]);
}
function answerText(q) {
  const r = getRender(q);
  if (r.judge) return r.choices[r.correctIndex];
  return Array.isArray(r.correctIndex)
    ? r.correctIndex.map(i => r.keys[i] + '. ' + r.choices[i]).join('；')
    : r.keys[r.correctIndex] + '. ' + r.choices[r.correctIndex];
}
function answerKeysStr(q) {
  const r = getRender(q);
  const ci = Array.isArray(r.correctIndex) ? r.correctIndex : [r.correctIndex];
  return ci.map(i => r.keys[i]).join('、');
}
function userText(q, i) {
  const r = getRender(q);
  const a = (i === undefined) ? S.userAns[S.idx] : S.userAns[i];
  if (r.judge) return a === null ? '' : r.choices[a];
  if (a === null) return '（未作答）';
  return Array.isArray(a) ? a.map(x => r.keys[x] + '. ' + r.choices[x]).join('；') : r.keys[a] + '. ' + r.choices[a];
}

// ---------- sheet ----------
function renderSheet() {
  if (S.mode !== 'exam') return;
  const el = $('sheet'); let h = ''; let answered = 0;
  for (let i = 0; i < S.pool.length; i++) {
    let cls = 'c';
    if (i === S.idx) cls += ' cur';
    const a = S.userAns[i];
    const ans = a !== null && !(Array.isArray(a) && a.length === 0);
    if (ans) { answered++; cls += ' ans'; }
    h += '<div class="' + cls + '" data-go="' + i + '">' + (i + 1) + '</div>';
  }
  el.innerHTML = h;
  const sc = $('sheetCount'); if (sc) sc.textContent = '(' + answered + '/' + S.pool.length + ')';
  el.querySelectorAll('.c').forEach(c => c.addEventListener('click', () => {
    S.idx = parseInt(c.dataset.go); renderQuestion(); saveProgress(currentRemaining());
    $('sheetCard').classList.add('hide'); $('sheetArr').textContent = '▾'; $('sheetToggle').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

// ---------- navigation ----------
function next() {
  if (S.idx < S.pool.length - 1) { S.idx++; renderQuestion(); window.scrollTo({ top: 0, behavior: 'smooth' }); saveProgress(currentRemaining()); }
  else {
    if (S.mode === 'exam') { if (confirm('确定交卷吗？')) finishExam(false); }
    else finishSequential();
  }
}
function prev() { if (S.idx > 0) { S.idx--; renderQuestion(); window.scrollTo({ top: 0, behavior: 'smooth' }); saveProgress(currentRemaining()); } }

// ---------- finish ----------
function finishSequential() {
  let right = 0, answered = 0;
  for (let i = 0; i < S.pool.length; i++) {
    const a = S.userAns[i];
    if (a !== null && !(Array.isArray(a) && a.length === 0)) answered++;
    if (isCorrect(S.pool[i], i)) right++;
  }
  const wrong = S.pool.length - answered;
  showResult(right, right, wrong, S.pool.length, '顺序练习完成', false);
}
function finishExam(auto) {
  stopTimer();
  let right = 0, score = 0;
  for (let i = 0; i < S.pool.length; i++) {
    if (isCorrect(S.pool[i], i)) { right++; score += S.questionPts[i] || 0; }
  }
  const total = S.pool.length, wrong = total - right;
  score = Math.round(score * 10) / 10;
  showResult(score, right, wrong, total, '模拟考试' + (auto ? '（时间到自动交卷）' : ''), true);
}

function showResult(scoreNum, right, wrong, total, title, isExam) {
  S.finished = true;
  clearProgress();
  stopTimer();
  for (let i = 0; i < S.pool.length; i++) { if (!isCorrect(S.pool[i], i)) addId(LS.wrong, S.pool[i].id); }
  $('practice').classList.add('hide');
  $('result').classList.remove('hide');
  $('resTitle').textContent = title;
  if (isExam) { $('resScore').textContent = scoreNum + ' / 100'; }
  else { $('resScore').textContent = right; }
  $('resSub').textContent = (isExam ? ('得分 ' + scoreNum + ' 分　') : '') + (right + ' / ' + total + ' 正确');
  $('stTotal').textContent = total;
  $('stRight').textContent = right;
  $('stWrong').textContent = wrong;
  const wl = $('wrongList'); wl.innerHTML = '';
  for (let i = 0; i < S.pool.length; i++) {
    if (!isCorrect(S.pool[i], i)) {
      const q = S.pool[i]; const r = getRender(q);
      const div = document.createElement('div'); div.className = 'wl-item';
      let badge = '<span class="badge ' + TYPE_CLS[(q.isCase ? 'case' : q.type)] + '">' + TYPE_NAME[(q.isCase ? 'case' : q.type)] + '</span>';
      div.innerHTML = badge + '<div class="q">' + escapeHtml(String(q.stem).replace(/\s+/g, ' ').trim()) + '</div>' +
        '<div class="a">正确答案：<span class="r">' + escapeHtml(answerKeysStr(q)) + '</span></div>';
      wl.appendChild(div);
    }
  }
  $('wrongWrap').classList.add('hide');
}

function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------- 错题/收藏 分组回顾 ----------
function updateLibStats() {
  const w = $('wrongCnt'), f = $('favCnt');
  const wc = countId(LS.wrong), fc = countId(LS.fav);
  if (w) w.textContent = wc;
  if (f) f.textContent = fc;
  const wb = $('wrongLibBtn'), fb = $('favLibBtn');
  if (wb) wb.disabled = wc === 0;
  if (fb) fb.disabled = fc === 0;
  renderModeCounts('wrong', 'wrongCounts');
  renderModeCounts('fav', 'favCounts');
}
function typeCountsFor(kind) {
  const ids = loadArr(kind === 'wrong' ? LS.wrong : LS.fav);
  const set = new Set(ids);
  const byType = { single: 0, multiple: 0, judge: 0, case: 0 };
  QUESTIONS.forEach(q => { if (set.has(q.id)) byType[q.isCase ? 'case' : q.type]++; });
  return byType;
}
function renderModeCounts(kind, elId) {
  const el = $(elId); if (!el) return;
  const c = typeCountsFor(kind);
  const total = c.single + c.multiple + c.judge + c.case;
  if (total === 0) { el.innerHTML = '<span class="muted">暂无题目</span>'; return; }
  const parts = [['单选', c.single], ['多选', c.multiple], ['判断', c.judge], ['案例', c.case]]
    .map(p => p[0] + ' ' + p[1]);
  el.innerHTML = parts.join(' · ') + ' · <span class="tot">共 ' + total + '</span>';
}
function openLib(kind) {
  const key = kind === 'wrong' ? LS.wrong : LS.fav;
  const ids = loadArr(key);
  if (ids.length === 0) { alert(kind === 'wrong' ? '错题集还是空的，先去做题吧。' : '还没有收藏的题目。'); return; }
  const idset = new Set(ids);
  const pool = QUESTIONS.filter(q => idset.has(q.id));
  $('libTitle').textContent = (kind === 'wrong' ? '错题集' : '收藏') + ' · 共 ' + pool.length + ' 题';
  const order = [['single', '单选题'], ['multiple', '多选题'], ['judge', '判断题'], ['case', '案例题']];
  let h = '';
  order.forEach(([t, name]) => {
    const list = [];
    pool.forEach((q, i) => { if ((q.isCase ? 'case' : q.type) === t) list.push(i); });
    if (list.length === 0) return;
    h += '<div class="lib-sec"><div class="lib-sec-h">' + name + ' <span class="lib-sec-n">' + list.length + ' 题</span></div><div class="sheet">';
    list.forEach(i => { h += '<div class="c" data-kind="' + kind + '" data-idx="' + i + '">' + (i + 1) + '</div>'; });
    h += '</div></div>';
  });
  const body = $('libBody'); body.innerHTML = h;
  body.querySelectorAll('.c').forEach(c => c.addEventListener('click', () => {
    const idx = parseInt(c.dataset.idx, 10);
    S.mode = c.dataset.kind;
    S.types = { single: true, multiple: true, judge: true, case: true };
    closeLib();
    start(undefined, idx);
  }));
  $('libModal').classList.remove('hide');
}
function closeLib() { $('libModal').classList.add('hide'); }

// ---------- UI bindings ----------
function bindHome() {
  document.querySelectorAll('.mode').forEach(m => m.addEventListener('click', () => {
    document.querySelectorAll('.mode').forEach(x => x.classList.remove('active'));
    m.classList.add('active'); S.mode = m.dataset.mode;
    const exam = S.mode === 'exam';
    $('examCfg').classList.toggle('hide', !exam);
    if (exam) { $('examCfgBody').classList.add('hide'); $('examCfgArr').textContent = '▸'; }
  }));
  $('examCfgHead').addEventListener('click', () => {
    const b = $('examCfgBody'); b.classList.toggle('hide');
    $('examCfgArr').textContent = b.classList.contains('hide') ? '▸' : '▾';
  });
  document.querySelectorAll('#typeChips .chip').forEach(c => c.addEventListener('click', () => {
    const t = c.dataset.t; S.types[t] = !S.types[t]; c.classList.toggle('active', S.types[t]); updateFilterStat();
  }));
  $('showAns').addEventListener('change', e => { S.showAns = e.target.checked; });
  $('rmAll').addEventListener('change', e => { S.rmAll = e.target.checked; updateFilterStat(); });
  $('rmCorrectJudge').addEventListener('change', e => { S.rmCorrectJudge = e.target.checked; updateFilterStat(); });
  $('revealAfter').addEventListener('change', e => { S.revealAfter = e.target.checked; });
  $('autoRemoveWrong').addEventListener('change', e => { S.autoRemoveWrong = e.target.checked; });
  $('wrongLibBtn').addEventListener('click', () => openLib('wrong'));
  $('favLibBtn').addEventListener('click', () => openLib('fav'));
  $('libClose').addEventListener('click', closeLib);
  $('libMask').addEventListener('click', closeLib);
  $('resumeBtn').addEventListener('click', () => { const p = loadProgress(); if (p) start(p); });
  $('discardBtn').addEventListener('click', () => { clearProgress(); $('resumeBanner').classList.add('hide'); });
  document.querySelectorAll('.ec').forEach(inp => inp.addEventListener('change', e => {
    const t = e.target.dataset.t;
    const v = Math.max(0, Math.min(200, parseInt(e.target.value) || 0));
    S.examCounts[t] = v; e.target.value = v; updateMaxScore();
  }));
  $('examMin').addEventListener('change', e => { S.examMin = Math.max(5, Math.min(240, parseInt(e.target.value) || 90)); });
  $('startBtn').addEventListener('click', () => start());
}
function bindPractice() {
  $('prevBtn').addEventListener('click', prev);
  $('nextBtn').addEventListener('click', () => {
    if ($('nextBtn').dataset.act === 'check') checkCurrent();
    else next();
  });
  $('checkBtn').addEventListener('click', checkCurrent);
  $('quitBtn').addEventListener('click', () => {
    if (confirm('确定退出当前练习？进度已保存，可稍后继续。')) {
      saveProgress(currentRemaining()); stopTimer();
      $('practice').classList.add('hide'); $('home').classList.remove('hide');
      refreshResumeBanner();
      updateLibStats();
    }
  });
  $('sheetToggle').addEventListener('click', () => {
    const c = $('sheetCard'); c.classList.toggle('hide');
    const open = !c.classList.contains('hide');
    $('sheetToggle').classList.toggle('open', open);
    $('sheetArr').textContent = open ? '▴' : '▾';
  });
}
function bindResult() {
  $('againBtn').addEventListener('click', () => { $('result').classList.add('hide'); $('home').classList.remove('hide'); updateLibStats(); });
  $('quitBtn2').addEventListener('click', () => { $('result').classList.add('hide'); $('home').classList.remove('hide'); updateLibStats(); });
  $('reviewWrong').addEventListener('click', () => { $('wrongWrap').classList.toggle('hide'); });
}

function applyUIFromState() {
  document.querySelectorAll('.mode').forEach(m => m.classList.toggle('active', m.dataset.mode === S.mode));
  document.querySelectorAll('#typeChips .chip').forEach(c => c.classList.toggle('active', !!S.types[c.dataset.t]));
  $('showAns').checked = S.showAns; $('rmAll').checked = S.rmAll; $('rmCorrectJudge').checked = S.rmCorrectJudge; $('revealAfter').checked = S.revealAfter; $('autoRemoveWrong').checked = S.autoRemoveWrong;
  document.querySelectorAll('.ec').forEach(inp => { inp.value = S.examCounts[inp.dataset.t]; });
  $('examMin').value = S.examMin;
  updateMaxScore();
  $('examCfg').classList.toggle('hide', S.mode !== 'exam');
  if (S.mode === 'exam') { $('examCfgBody').classList.add('hide'); $('examCfgArr').textContent = '▸'; }
  updateFilterStat();
}
function refreshResumeBanner() {
  const pr = loadProgress();
  if (pr && !pr.finished) {
    $('rbIdx').textContent = (pr.idx || 0) + 1;
    $('rbTotal').textContent = Array.isArray(pr.ids) ? pr.ids.length : (pr.userAns ? pr.userAns.length : 0);
    const ids = Array.isArray(pr.ids) ? pr.ids : [];
    const idset = new Set(ids);
    const byType = { single: 0, multiple: 0, judge: 0, case: 0 };
    QUESTIONS.forEach(q => { if (idset.has(q.id)) byType[q.isCase ? 'case' : q.type]++; });
    const el = $('rbTypes');
    const total = byType.single + byType.multiple + byType.judge + byType.case;
    if (total === 0) { el.innerHTML = '<span class="muted">暂无题型分布</span>'; }
    else { el.textContent = [['单选', 'single'], ['多选', 'multiple'], ['判断', 'judge'], ['案例', 'case']].map(([n, t]) => n + ' ' + byType[t]).join(' · '); }
    $('resumeBanner').classList.remove('hide');
  } else {
    $('resumeBanner').classList.add('hide');
  }
}

// 切换题库后刷新首页统计（不重复绑定事件）
export function refreshHomeUI() {
  updateFilterStat();
  updateLibStats();
  refreshResumeBanner();
  applyUIFromState();
}

let _inited = false;
export function initEngine() {
  loadSettings();
  if (['sequential', 'exam'].indexOf(S.mode) < 0) S.mode = 'sequential';
  applyUIFromState();
  refreshResumeBanner();
  updateLibStats();
  if (!_inited) { bindHome(); bindPractice(); bindResult(); _inited = true; }
}
