import {
  LS, loadArr, saveArr, addId, removeId, hasId, countId,
  clearProgress, saveProgress, loadProgress
} from './store.js';
import { supabase, getUserId } from './supabase.js';

// ---------- data source (set per bank) ----------
let QUESTIONS = [];
export function setQuestions(arr) { QUESTIONS = Array.isArray(arr) ? arr : []; }

// ---------- state ----------
const EXAM_DEFAULT_COUNTS = { single: 60, multiple: 40, judge: 20, case: 5 };
const EXAM_TYPES = ['single', 'multiple', 'judge', 'case'];

const S = {
  mode: 'sequential', types: { single: true, multiple: true, judge: true, case: true },
  showAns: false, rmAll: true, rmCorrectJudge: true, revealAfter: false, autoRemoveWrong: true,
  examCounts: Object.assign({}, EXAM_DEFAULT_COUNTS),
  examPoints: { single: 0.5, multiple: 1, judge: 0.5, case: 4 },
  examMin: 90,
  bankId: null,
  examCfgByBank: {},        // { [题库id]: { counts, min, updatedAt } } —— 组卷配置按题库各存一份
  fullScore: 100,           // 本次组卷的理论满分（自选题量后不再是固定 100）
  pool: [], idx: 0, userAns: [], revealed: [], correctCount: 0, questionPts: [],
  timer: null, deadline: 0, finished: false
};
const TYPE_NAME = { single: '单选题', multiple: '多选题', judge: '判断题', case: '案例题' };
const TYPE_CLS = { single: 'b-single', multiple: 'b-multi', judge: 'b-judge', case: 'b-case' };
const TYPE_UNIT = { single: '题', multiple: '题', judge: '题', case: '组' };

function $(id) { return document.getElementById(id); }

// ============================================================
// 练习设置（练习选项 / 模式 / 组卷参数）：保存与恢复
// ------------------------------------------------------------
// 两层存储：
//   ① 本地 localStorage —— 每次一改立即写入，离线也可用，刷新/退出后立刻还在；
//   ② 云端 exam_user_prefs —— 登录后按账号跟随，换手机、换浏览器也是同一套设置。
// 冲突判定：比较 updatedAt，谁新用谁。这样"离线时改过"的设置不会被云端旧值抹掉。
// ============================================================
const PREFS_KEY = 'credit_exam_cfg';

function settingsSnapshot() {
  return {
    mode: S.mode, types: S.types, showAns: S.showAns, rmAll: S.rmAll,
    rmCorrectJudge: S.rmCorrectJudge, revealAfter: S.revealAfter, autoRemoveWrong: S.autoRemoveWrong,
    examCounts: S.examCounts, examPoints: S.examPoints, examMin: S.examMin,
    examCfgByBank: S.examCfgByBank,
    updatedAt: Date.now()
  };
}

function applySettings(c) {
  S.mode = c.mode || 'sequential'; S.types = Object.assign(S.types, c.types || {});
  S.showAns = !!c.showAns; S.rmAll = !!c.rmAll;
  S.rmCorrectJudge = (c.rmCorrectJudge === undefined ? true : !!c.rmCorrectJudge); S.revealAfter = !!c.revealAfter;
  S.autoRemoveWrong = (c.autoRemoveWrong === undefined ? true : !!c.autoRemoveWrong);
  if (c.examPoints) S.examPoints = Object.assign(S.examPoints, c.examPoints);
  S.examCounts = Object.assign({}, EXAM_DEFAULT_COUNTS, c.examCounts || {});
  S.examMin = c.examMin || 90;
  if (c.examCfgByBank && typeof c.examCfgByBank === 'object') S.examCfgByBank = Object.assign({}, c.examCfgByBank);
  loadBankExamCfg();          // 题库级配置优先于"上次用过的配置"
}

// ---------- 组卷配置：按题库各存一份 ----------
/** 切题库时调用：把该题库上次的组卷配置带回首页 */
export function setBankKey(id) {
  S.bankId = id || null;
  loadBankExamCfg();
  _ecSig = '';                 // 题库变了，题型行必须重建
  renderExamCfg(true);
}

function loadBankExamCfg() {
  if (!S.bankId) return;
  const c = S.examCfgByBank[S.bankId];
  if (c && c.counts) {
    S.examCounts = Object.assign({ single: 0, multiple: 0, judge: 0, case: 0 }, c.counts);
    if (c.min) S.examMin = c.min;
  }
}
function saveBankExamCfg() {
  if (!S.bankId) return;
  S.examCfgByBank[S.bankId] = { counts: Object.assign({}, S.examCounts), min: S.examMin, updatedAt: Date.now() };
  showEcSaved();
}
function showEcSaved() {
  const el = $('ecSaved');
  if (!el) return;
  const g = $('topBankName');
  const bank = g && g.textContent && g.textContent !== '—' ? '题库「' + g.textContent + '」' : '当前题库';
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, '0'), mm = String(t.getMinutes()).padStart(2, '0');
  el.textContent = '✓ 组卷配置已保存到 ' + bank + '（' + hh + ':' + mm + '），下次进入自动带出，并跟随账号同步';
}

/** 改了就存：本地立即写，云端防抖 800ms */
function saveSettings() {
  const snap = settingsSnapshot();
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(snap)); } catch (e) { }
  scheduleCloudSave(snap);
}

function loadSettings() {
  try {
    const c = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (c) applySettings(c);
  } catch (e) { }
}

let _cloudTimer = null;
function scheduleCloudSave(snap) {
  if (!getUserId()) return;                    // 未登录（本地练习）只写本地
  if (_cloudTimer) clearTimeout(_cloudTimer);
  _cloudTimer = setTimeout(() => { _cloudTimer = null; pushPrefs(snap); }, 800);
}

/** 让用户一眼看出设置存到了哪里（跟随账号 / 仅本机） */
function setPrefsHint(text, ok) {
  const el = $('prefsHint');
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? 'var(--ok)' : 'var(--sub)';
}

async function pushPrefs(snap) {
  try {
    const { error } = await supabase.from('exam_user_prefs')
      .upsert({ user_id: getUserId(), prefs: snap }, { onConflict: 'user_id' });
    if (error) throw error;
    setPrefsHint('改完自动记住（跟随账号）', true);
  } catch (e) {
    // 离线、或 exam_user_prefs 表还没建：本地已保存，不打断用户
    setPrefsHint('改完自动记住（仅本机）', false);
  }
}

/** 登录进入题库后调用：把本地与云端设置对齐（谁新用谁） */
export async function syncPrefsFromCloud() {
  const uid = getUserId();
  if (!uid) return;
  let cloud = null;
  try {
    const { data, error } = await supabase.from('exam_user_prefs').select('prefs').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    cloud = (data && data.prefs) || null;
  } catch (e) {
    // 拉不到（离线/表未建）→ 保持本地现状，并如实告诉用户"只存本机"
    setPrefsHint('改完自动记住（仅本机）', false);
    return;
  }
  let local = null;
  try { local = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'); } catch (e) { }

  const cloudAt = (cloud && cloud.updatedAt) || 0;
  const localAt = (local && local.updatedAt) || 0;

  if (cloud && cloudAt >= localAt) {
    applySettings(cloud);                       // 云端较新 → 覆盖本地
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(cloud)); } catch (e) { }
    applyUIFromState();
    setPrefsHint('改完自动记住（跟随账号）', true);
  } else if (local && localAt > cloudAt) {
    pushPrefs(local);                           // 本地较新（如离线改过）→ 推上云
  } else {
    setPrefsHint('改完自动记住（跟随账号）', true);   // 两端都空/一致，账号同步可用
  }
}

// ============================================================
// 组卷设置：题型行按「当前题库实际有的题型」动态生成
// ------------------------------------------------------------
//  · 可用量口径与真正抽题完全一致（同一份 buildPool）：
//    受「题目类型」勾选与「去除多选全选 / 去除正确判断题」开关影响；
//  · 案例题按「组」计，可用量 = 题库里案例组数；
//  · 题量可自行定义，超量自动收敛到可用量并给出提示；
//  · 配置按题库保存（examCfgByBank），下次进入该题库自动带出。
// ============================================================
const EXAM_AVAIL_HINT = {
  single: '题', multiple: '题', judge: '题', case: '组'
};


  const pool = buildPool();
  const avail = { single: 0, multiple: 0, judge: 0, case: 0 };
  const caseGroups = {};
  pool.forEach(q => {
    if (q.isCase) caseGroups[q.caseId] = (caseGroups[q.caseId] || 0) + 1;
    else if (avail[q.type] !== undefined) avail[q.type]++;
  });
  const caseArr = Object.values(caseGroups);
  avail.case = caseArr.length;
  const present = EXAM_TYPES.filter(t => avail[t] > 0);
  let planned = 0;
  ['single', 'multiple', 'judge'].forEach(t => { planned += Math.min(S.examCounts[t] || 0, avail[t]); });
  const wantCase = Math.min(S.examCounts.case || 0, caseArr.length);
  const avgCase = caseArr.length ? caseArr.reduce((s, n) => s + n, 0) / caseArr.length : 0;
  const caseQs = Math.round(wantCase * avgCase);
  return { avail, present, planned, caseQs, poolTotal: pool.length, caseGroups: caseArr.length };
}

function examFullScore() {
  const c = S.examCounts, p = S.examPoints;
  return Math.round(EXAM_TYPES.reduce((s, t) => s + (c[t] || 0) * (p[t] || 0), 0) * 10) / 10;
}

/** 渲染汇总行：已选题量 + 理论满分 + 超量提醒（不做 DOM 重建） */
function updateMaxScore() {
  const plan = examPlan();
  S.fullScore = examFullScore();
  const el = $('maxScore'); if (el) el.textContent = S.fullScore;
  const cnt = $('ecSumCount'); if (cnt) cnt.textContent = S.examCounts.single + S.examCounts.multiple + S.examCounts.judge + S.examCounts.case;
  const extra = $('ecSumExtra');
  if (extra) extra.textContent = plan.caseQs > 0 ? '（案例按组抽，实际约 ' + (plan.planned + plan.caseQs) + ' 道小题）' : '';
  // 超量提醒：配置数大于可用量时，实际只抽可用量
  const short = [];
  EXAM_TYPES.forEach(t => {
    const want = S.examCounts[t] || 0;
    if (want > plan.avail[t]) short.push(TYPE_NAME[t] + ' 配置 ' + want + ' ' + TYPE_UNIT[t] + '，题库仅 ' + plan.avail[t] + ' ' + TYPE_UNIT[t]);
  });
  const warn = $('ecWarn');
  if (warn) {
    if (short.length) { warn.innerHTML = '⚠️ 以下题型题库不足，实际按可用量抽取：<br>· ' + short.join('<br>· '); warn.classList.remove('hide'); }
    else { warn.innerHTML = ''; warn.classList.add('hide'); }
  }
  // 首页「组卷模拟考试」卡片上的摘要
  const card = $('examCounts');
  if (card) {
    const list = EXAM_TYPES.filter(t => plan.avail[t] > 0).map(t => TYPE_NAME[t].replace('题', '') + ' ' + (S.examCounts[t] || 0) + TYPE_UNIT[t]);
    card.textContent = list.length ? list.join(' · ') + '｜满分 ' + S.fullScore + ' 分 · ' + S.examMin + ' 分钟' : '当前题库暂无可用题目';
  }
  return S.fullScore;
}

/** 让输入框显示值跟随状态（仅在非输入状态下调用，避免打断打字） */
function syncEcInputs() {
  document.querySelectorAll('#ecRows .ec').forEach(inp => {
    const v = S.examCounts[inp.dataset.t] || 0;
    if (String(inp.value) !== String(v)) inp.value = v;
  });
}

let _ecSig = '';
/**
 * 生成题型行。
 * @param {boolean} force 强制重建（题库切换时用）
 * 只有「可用题型 / 可用量」签名变化时才重建 DOM，避免把用户正在输入的内容打断。
 */
function renderExamCfg(force) {
  const box = $('ecRows');
  if (!box) return;
  const plan = examPlan();
  const sig = plan.present.join(',') + '|' + plan.present.map(t => plan.avail[t]).join(',');
  const availEl = $('ecAvail');
  if (availEl) {
    availEl.textContent = plan.poolTotal
      ? '本库当前可用 ' + plan.poolTotal + ' 题（受「题目类型」与「去除」开关影响），题型与题量可自行定义：'
      : '当前题库/筛选下没有可用题目，请调整「题目类型」或「练习选项」。';
  }
  if (force || sig !== _ecSig) {
    _ecSig = sig;
    box.innerHTML = plan.present.map(t => {
      const max = plan.avail[t];
      return '<div class="opt-row ec-row" data-t="' + t + '">' +
        '<div class="ec-info"><div class="lbl">' + TYPE_NAME[t] + ' <span class="muted">× ' + S.examPoints[t] + ' 分 / ' + TYPE_UNIT[t] + '</span></div>' +
        '<div class="hint">题库可用 <b>' + max + '</b> ' + TEMP_UNIT(t) + '</div></div>' +
        '<div class="num-row">' +
        '<button type="button" class="ec-mini ec-step" data-t="' + t + '" data-step="-1" aria-label="减少">−</button>' +
        '<input type="number" class="ec ec-num" data-t="' + t + '" min="0" max="' + max + '" value="' + (S.examCounts[t] || 0) + '" inputmode="numeric">' +
        '<button type="button" class="ec-mini ec-step" data-t="' + t + '" data-step="1" aria-label="增加">+</button>' +
        '<button type="button" class="ec-mini ec-max" data-t="' + t + '">全部</button>' +
        '</div></div>';
    }).join('');
  }
  syncEcInputs();
  updateMaxScore();
}
function TEMP_UNIT(t) { return EXAM_UNIT[t]; }
const EXAM_UNIT = { single: '题', multiple: '题', judge: '题', case: '组' };

/** 设置某题型题量并即时保存（clamp 到 0..可用量） */
function setExamCount(t, v, opt) {
  const plan = examPlan();
  const max = plan.avail[t] || 0;
  let n = parseInt(v, 10);
  if (isNaN(n)) n = 0;
  n = Math.max(0, Math.min(max, n));
  S.examCounts[t] = n;
  if (!opt || !opt.silent) {
    saveBankExamCfg();
    saveSettings();
  }
  return n;
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

// ---------- progress snapshot ----------
// ⚠️ 必须存「完整快照」：题序 ids + 作答 userAns + 揭示状态 revealed + 考试剩余时间 + 当时设置。
// 历史 bug：这里只存了一个剩余时间数字，于是「继续练习」恢复出来永远是空的（等于从头开始）。
function snapshotProgress(rem) {
  if (!S.pool || !S.pool.length) return null;
  const arr = Array.isArray(S.userAns) ? S.userAns : [];
  const answered = arr.filter(a => a !== null && a !== undefined && !(Array.isArray(a) && a.length === 0)).length;
  return {
    v: 2,
    mode: S.mode,
    types: Object.assign({}, S.types),
    showAns: S.showAns, rmAll: S.rmAll, rmCorrectJudge: S.rmCorrectJudge,
    revealAfter: S.revealAfter, autoRemoveWrong: S.autoRemoveWrong,
    ids: S.pool.map(q => q.id),
    idx: S.idx,
    userAns: arr.map(a => (Array.isArray(a) ? a.slice() : a)),
    revealed: Array.isArray(S.revealed) ? S.revealed.slice() : [],
    questionPts: Array.isArray(S.questionPts) ? S.questionPts.slice() : [],
    remainingMs: (typeof rem === 'number' && rem > 0) ? rem : currentRemaining(),
    answered: answered,
    total: S.pool.length,
    finished: false,
    updatedAt: Date.now()
  };
}
function saveSnapshot(rem) {
  const snap = snapshotProgress(rem);
  if (snap) saveProgress(snap);
}

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
  saveSnapshot(rem);
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
  saveSnapshot();
}

function checkCurrent() {
  const q = S.pool[S.idx];
  if (S.userAns[S.idx] === null || (Array.isArray(S.userAns[S.idx]) && S.userAns[S.idx].length === 0)) {
    alert('请先选择答案，再核对。'); return;
  }
  S.revealed[S.idx] = true;
  renderQuestion();
  recordWrong(q);
  saveSnapshot();
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
    S.idx = parseInt(c.dataset.go); renderQuestion(); saveSnapshot();
    $('sheetCard').classList.add('hide'); $('sheetArr').textContent = '▾'; $('sheetToggle').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

// ---------- navigation ----------
function next() {
  if (S.idx < S.pool.length - 1) { S.idx++; renderQuestion(); window.scrollTo({ top: 0, behavior: 'smooth' }); saveSnapshot(); }
  else {
    if (S.mode === 'exam') { if (confirm('确定交卷吗？')) finishExam(false); }
    else finishSequential();
  }
}
function prev() { if (S.idx > 0) { S.idx--; renderQuestion(); window.scrollTo({ top: 0, behavior: 'smooth' }); saveSnapshot(); } }

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
    saveSettings();
  }));
  $('examCfgHead').addEventListener('click', () => {
    const b = $('examCfgBody'); b.classList.toggle('hide');
    $('examCfgArr').textContent = b.classList.contains('hide') ? '▸' : '▾';
  });
  document.querySelectorAll('#typeChips .chip').forEach(c => c.addEventListener('click', () => {
    const t = c.dataset.t; S.types[t] = !S.types[t]; c.classList.toggle('active', S.types[t]); updateFilterStat();
    saveSettings();
  }));
  // 练习选项：每一次切换都立即落盘（本地 + 云端），退出/刷新后原样恢复
  $('showAns').addEventListener('change', e => { S.showAns = e.target.checked; saveSettings(); });
  $('rmAll').addEventListener('change', e => { S.rmAll = e.target.checked; updateFilterStat(); saveSettings(); });
  $('rmCorrectJudge').addEventListener('change', e => { S.rmCorrectJudge = e.target.checked; updateFilterStat(); saveSettings(); });
  $('revealAfter').addEventListener('change', e => { S.revealAfter = e.target.checked; saveSettings(); });
  $('autoRemoveWrong').addEventListener('change', e => { S.autoRemoveWrong = e.target.checked; saveSettings(); });
  $('wrongLibBtn').addEventListener('click', () => openLib('wrong'));
  $('favLibBtn').addEventListener('click', () => openLib('fav'));
  $('libClose').addEventListener('click', closeLib);
  $('libMask').addEventListener('click', closeLib);
  // 继续练习：用完整快照恢复（题序 / 已作答 / 对错揭示 / 考试剩余时间都在快照里）
  $('continueBtn').addEventListener('click', () => {
    const p = loadProgress();
    if (p && Array.isArray(p.ids) && p.ids.length) start(p);
    else { clearProgress(); start(); }
  });
  // 从头开始：丢掉旧进度，按当前设置重新组题
  $('restartBtn').addEventListener('click', () => { clearProgress(); start(); });
  document.querySelectorAll('.ec').forEach(inp => inp.addEventListener('change', e => {
    const t = e.target.dataset.t;
    const v = Math.max(0, Math.min(200, parseInt(e.target.value) || 0));
    S.examCounts[t] = v; e.target.value = v; updateMaxScore(); saveSettings();
  }));
  $('examMin').addEventListener('change', e => { S.examMin = Math.max(5, Math.min(240, parseInt(e.target.value) || 90)); saveSettings(); });
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
      saveSnapshot(); stopTimer();
      $('practice').classList.add('hide'); $('home').classList.remove('hide');
      refreshStartActions();
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
  // 练习完成后进度已被清掉（showResult → clearProgress），返回首页应恢复成单个「开始练习」
  $('againBtn').addEventListener('click', () => { $('result').classList.add('hide'); $('home').classList.remove('hide'); updateLibStats(); refreshStartActions(); });
  $('quitBtn2').addEventListener('click', () => { $('result').classList.add('hide'); $('home').classList.remove('hide'); updateLibStats(); refreshStartActions(); });
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
/** 有未完成的练习进度时返回摘要，否则 null */
function resumeInfo() {
  const p = loadProgress();
  if (!p || p.finished) return null;
  const total = Array.isArray(p.ids) ? p.ids.length : 0;
  if (!total) return null;
  const arr = Array.isArray(p.userAns) ? p.userAns : [];
  const answered = typeof p.answered === 'number'
    ? p.answered
    : arr.filter(a => a !== null && a !== undefined && !(Array.isArray(a) && a.length === 0)).length;
  return {
    at: Math.min((p.idx || 0) + 1, total),
    total: total,
    answered: answered,
    mode: p.mode || 'sequential'
  };
}

/**
 * 主操作区状态：
 *  - 无进度 → 只显示「开始练习」
 *  - 有未完成进度 → 换成「从头开始」+「继续练习」（继续练习为绿色）
 */
function refreshStartActions() {
  const info = resumeInfo();
  const act = $('startActions'), hint = $('startHint');
  if (!act) return;
  if (info) {
    $('startBtn').classList.add('hide');
    $('restartBtn').classList.remove('hide');
    $('continueBtn').classList.remove('hide');
    act.classList.add('with-resume');
    const modeName = info.mode === 'exam' ? '模拟考试'
      : (info.mode === 'wrong' ? '错题练习' : (info.mode === 'fav' ? '收藏练习' : '顺序练习'));
    hint.textContent = '上次练到第 ' + info.at + ' / ' + info.total + ' 题，已答 ' + info.answered + ' 题（' + modeName + '）';
    hint.classList.remove('hide');
  } else {
    $('startBtn').classList.remove('hide');
    $('restartBtn').classList.add('hide');
    $('continueBtn').classList.add('hide');
    act.classList.remove('with-resume');
    hint.textContent = '';
    hint.classList.add('hide');
  }
}

// 切换题库后刷新首页统计（不重复绑定事件）
export function refreshHomeUI() {
  updateFilterStat();
  updateLibStats();
  refreshStartActions();
  applyUIFromState();
}

let _inited = false;
export function initEngine() {
  loadSettings();
  if (['sequential', 'exam'].indexOf(S.mode) < 0) S.mode = 'sequential';
  applyUIFromState();
  refreshStartActions();
  updateLibStats();
  if (!_inited) { bindHome(); bindPractice(); bindResult(); _inited = true; }
}

// 本地开发调试钩子（供 scripts/check_resume.mjs 端到端验收使用）。
// import.meta.env.DEV 在 vite build 时被替换为 false，整块会被打包器剔除，不会进生产包。
if (import.meta.env.DEV) {
  window.__exam = { setQuestions, initEngine, refreshHomeUI, start, snapshotProgress, S };
}
