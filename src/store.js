import { supabase, getUserId } from './supabase.js';

export const LS = {
  wrong: 'credit_exam_wrong',
  fav: 'credit_exam_fav',
  progress: 'credit_exam_progress'
};

// ============================================================
// 练习进度：**按模式各存一份**
// ------------------------------------------------------------
// 历史问题：progress 是个单值，在「顺序练习」练到一半、切去「组卷模拟」再存一次，
// 前者的进度就被覆盖没了 —— 用户的原话是「不管切换了哪种模式，都需要记住每种模式的练习进度」。
// 所以现在存成 map：{ sequential|exam|wrong|fav: 完整快照 }，各模式互不影响。
// 云端 exam_bank_progress.progress（jsonb）与本地镜像用同一形状，读的时候自动迁移旧格式。
// ============================================================
const PROGRESS_V = 4;
const MODES = ['sequential', 'exam', 'wrong', 'fav'];
const MARK_MAX = 3;                 // 标记色数：1 存疑 / 2 重点 / 3 待查

/**
 * 题目标记表归一成 `{ [题目id]: 1..3 }`。
 * 键一律按字符串存（题目 id 可能是数字，对象键本来也会被转成字符串），越界的颜色直接丢掉。
 */
function normalizeMarks(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    Object.keys(raw).forEach(k => {
      const v = parseInt(raw[k], 10);
      if (v >= 1 && v <= MARK_MAX) out[k] = v;
    });
  }
  return out;
}

/**
 * 把任意历史格式的进度归一成 `{ v:4, byMode:{...}, marks:{...} }`。
 *  · marks（答题卡上的彩色标记）与进度平级放在同一个 jsonb 里 —— 不新增列、不用改表结构，
 *    但它**不属于任何模式**：练完一遍 clearProgress 清掉的是进度，标记要留下来。
 *  · 旧版（v2.11 及之前）存的是**单个**快照：`{ v:2, mode:'sequential', ids:[...], idx, ... }`，
 *    这里按它的 `mode` 字段归到 byMode 下对应模式 —— 升级后已有的进度不会丢。
 */
export function normalizeProgress(raw) {
  const empty = { v: PROGRESS_V, byMode: {}, marks: {} };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const marks = normalizeMarks(raw.marks);
  if (raw.byMode && typeof raw.byMode === 'object' && !Array.isArray(raw.byMode)) {
    const byMode = {};
    Object.keys(raw.byMode).forEach(m => {
      const p = raw.byMode[m];
      if (p && typeof p === 'object' && !p.finished) byMode[m] = p;
    });
    return { v: PROGRESS_V, byMode, marks };
  }
  if (Array.isArray(raw.ids) && raw.ids.length) {   // 旧格式：单个快照
    return { v: PROGRESS_V, byMode: { [raw.mode || 'sequential']: raw }, marks };
  }
  return { v: PROGRESS_V, byMode: {}, marks };
}

const state = {
  cloud: false,
  bankId: null,
  wrong: [],
  fav: [],
  progressByMode: {},     // { [mode]: 快照 } —— 每种模式各记一份
  marks: {},              // { [题目id]: 1|2|3 } —— 答题卡彩色标记（跨模式共用，不随进度清）
  _timer: null
};

function mirrorKey() {
  return state.cloud ? 'ce_cloud_' + state.bankId : null;
}

/** 序列化用：进度与标记都为空时写 null（语义清晰，也省空间） */
function progressPayload() {
  const byMode = state.progressByMode;
  const marks = marksTable();
  if (!Object.keys(byMode).length && !Object.keys(marks).length) return null;
  return { v: PROGRESS_V, byMode, marks };
}

function persistLocal() {
  try {
    if (state.cloud) {
      localStorage.setItem(mirrorKey(), JSON.stringify({ wrong: state.wrong, fav: state.fav, progress: progressPayload() }));
    } else {
      localStorage.setItem(LS.wrong, JSON.stringify(state.wrong));
      localStorage.setItem(LS.fav, JSON.stringify(state.fav));
      localStorage.setItem(LS.progress, JSON.stringify(progressPayload()));
    }
  } catch (e) { /* quota */ }
}

function readLocal() {
  try {
    let raw;
    if (state.cloud) {
      const t = localStorage.getItem(mirrorKey());
      raw = (t ? JSON.parse(t) : null) || { wrong: [], fav: [], progress: null };
    } else {
      raw = {
        wrong: JSON.parse(localStorage.getItem(LS.wrong) || '[]'),
        fav: JSON.parse(localStorage.getItem(LS.fav) || '[]'),
        progress: JSON.parse(localStorage.getItem(LS.progress) || 'null')
      };
    }
    return { wrong: raw.wrong, fav: raw.fav, progress: normalizeProgress(raw.progress) };
  } catch (e) {
    return { wrong: [], fav: [], progress: normalizeProgress(null) };
  }
}
function scheduleFlush() {
  if (!state.cloud || !state.bankId) return;
  if (state._timer) clearTimeout(state._timer);
  state._timer = setTimeout(flushNow, 400);
}

export async function flushNow() {
  if (!state.cloud || !state.bankId) return;
  const userId = getUserId();
  if (!userId) return;
  try {
    await supabase.from('exam_bank_progress').upsert({
      user_id: userId,
      bank_id: state.bankId,
      wrong: state.wrong,
      fav: state.fav,
      progress: progressPayload()
    }, { onConflict: 'user_id,bank_id' });
  } catch (e) { /* 离线时忽略，本地镜像仍有效 */ }
}

// 切换题库时调用：加载该题库的错题/收藏/进度（云端优先，本地镜像兜底）
export async function loadBankState(bankId, cloud) {
  // 切换前：先把上一题库的待写入数据立即落库，避免防抖定时器把旧题库的数据写到新题库
  if (state.cloud && state.bankId && state.bankId !== bankId) {
    if (state._timer) { clearTimeout(state._timer); state._timer = null; }
    await flushNow();
  }
  state.cloud = cloud;
  state.bankId = bankId;
  state.wrong = [];
  state.fav = [];
  state.progressByMode = {};
  state.marks = {};
  // 先读本地镜像（离线可用）
  const local = readLocal();
  state.wrong = Array.isArray(local.wrong) ? local.wrong : [];
  state.fav = Array.isArray(local.fav) ? local.fav : [];
  state.progressByMode = Object.assign({}, local.progress.byMode);
  state.marks = Object.assign({}, local.progress.marks);
  // 云端：拉取服务端权威数据覆盖
  if (cloud && bankId) {
    try {
      const { data } = await supabase
        .from('exam_bank_progress')
        .select('wrong,fav,progress')
        .eq('bank_id', bankId)
        .maybeSingle();
      if (data) {
        state.wrong = Array.isArray(data.wrong) ? data.wrong : [];
        state.fav = Array.isArray(data.fav) ? data.fav : [];
        const np = normalizeProgress(data.progress);
        state.progressByMode = np.byMode;
        state.marks = np.marks;
        persistLocal();
      }
    } catch (e) { /* 离线：保持本地镜像 */ }
  }
}

function getArr(key) {
  return key === LS.wrong ? state.wrong : state.fav;
}
function setArr(key, arr) {
  if (key === LS.wrong) state.wrong = arr; else state.fav = arr;
  persistLocal();
  scheduleFlush();
}

export function loadArr(key) {
  const a = getArr(key);
  return Array.isArray(a) ? a.slice() : [];
}
export function saveArr(key, arr) {
  setArr(key, Array.isArray(arr) ? [...new Set(arr)] : []);
}
export function addId(key, id) {
  const a = getArr(key);
  if (!a.includes(id)) { a.push(id); setArr(key, a); }
}
export function removeId(key, id) {
  setArr(key, getArr(key).filter(x => x !== id));
}
export function hasId(key, id) {
  return getArr(key).includes(id);
}
export function countId(key) {
  return getArr(key).length;
}

// ============================================================
// 答题卡标记：{ [题目id]: 1|2|3 }（1 存疑 / 2 重点 / 3 待查）
// ------------------------------------------------------------
// 和错题/收藏一样按题库存，但**跨模式共用**：同一个题目在顺序练习里打的黄标，
// 到组卷模拟的答题卡上照样看得见（否则「标记」就失去了复习索引的意义）。
// 也不随进度被清 —— 练完一遍只是把进度清了，标记要留着下次重点看。
// ============================================================
/** 标记表兜底取值：任何情况下都返回一个对象，别让一格标记把整张答题卡搞崩 */
function marksTable() {
  if (!state.marks || typeof state.marks !== 'object') state.marks = {};
  return state.marks;
}
/** 取某题的标记色（0 = 没标记）。读的是内存里的表，答题卡逐格渲染时不会有拷贝开销 */
export function markOf(id) {
  return marksTable()[String(id)] || 0;
}
/** 上色（color 传 0 或空 = 取消标记） */
export function setMark(id, color) {
  const k = String(id);
  const c = parseInt(color, 10) || 0;
  const t = marksTable();
  if (c >= 1 && c <= MARK_MAX) t[k] = c; else delete t[k];
  persistLocal();
  scheduleFlush();
}
export function markCount() {
  return Object.keys(marksTable()).length;
}
export function clearMarks() {
  state.marks = {};
  persistLocal();
  scheduleFlush();
}
/** 整个标记表的副本（验收脚本用） */
export function loadMarks() {
  return Object.assign({}, marksTable());
}

/**
 * 清进度。
 *  · 传 mode → 只清该模式的进度（练习完成、点了「从头开始」都是这个语义）；
 *  · 不传   → 清全部模式的进度。
 */
export function clearProgress(mode) {
  if (mode) delete state.progressByMode[mode];
  else state.progressByMode = {};
  persistLocal();
  scheduleFlush();
}

/** 存进度：按快照自带的 mode 归档，各模式互不覆盖 */
export function saveProgress(obj) {
  if (!obj || !obj.mode) return;
  state.progressByMode[obj.mode] = obj;
  persistLocal();
  scheduleFlush();
}

/**
 * 取进度。
 *  · 传 mode → 该模式那一份（新逻辑都用这个）；
 *  · 不传   → 最近更新的一份（兼容旧调用，避免外面漏改时拿到 null）。
 */
export function loadProgress(mode) {
  if (mode) return state.progressByMode[mode] || null;
  let best = null;
  Object.keys(state.progressByMode).forEach(m => {
    const p = state.progressByMode[m];
    if (p && (!best || (p.updatedAt || 0) > (best.updatedAt || 0))) best = p;
  });
  return best;
}

/** 整个 map（首页四张卡片各自显示进度时用） */
export function loadProgressMap() {
  return Object.assign({}, state.progressByMode);
}

export function resetState() {
  state.cloud = false;
  state.bankId = null;
  state.wrong = [];
  state.fav = [];
  state.progressByMode = {};
  state.marks = {};
}

// 本地开发调试钩子（生产构建会被剔除），供 scripts/check_resume.mjs、check_modeprog.mjs 验收使用
if (import.meta.env.DEV) {
  window.__store = {
    loadBankState, saveProgress, loadProgress, loadProgressMap, clearProgress,
    normalizeProgress, saveArr, loadArr, LS, MODES,
    markOf, setMark, markCount, clearMarks, loadMarks
  };
}
