import { supabase, getUserId } from './supabase.js';

export const LS = {
  wrong: 'credit_exam_wrong',
  fav: 'credit_exam_fav',
  progress: 'credit_exam_progress'
};

const state = {
  cloud: false,
  bankId: null,
  wrong: [],
  fav: [],
  progress: null,
  _timer: null
};

function mirrorKey() {
  return state.cloud ? 'ce_cloud_' + state.bankId : null;
}

function persistLocal() {
  try {
    if (state.cloud) {
      localStorage.setItem(mirrorKey(), JSON.stringify({ wrong: state.wrong, fav: state.fav, progress: state.progress }));
    } else {
      localStorage.setItem(LS.wrong, JSON.stringify(state.wrong));
      localStorage.setItem(LS.fav, JSON.stringify(state.fav));
      localStorage.setItem(LS.progress, JSON.stringify(state.progress));
    }
  } catch (e) { /* quota */ }
}

function readLocal() {
  try {
    if (state.cloud) {
      const raw = localStorage.getItem(mirrorKey());
      const o = raw ? JSON.parse(raw) : null;
      return o || { wrong: [], fav: [], progress: null };
    }
    return {
      wrong: JSON.parse(localStorage.getItem(LS.wrong) || '[]'),
      fav: JSON.parse(localStorage.getItem(LS.fav) || '[]'),
      progress: JSON.parse(localStorage.getItem(LS.progress) || 'null')
    };
  } catch (e) {
    return { wrong: [], fav: [], progress: null };
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
      progress: state.progress
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
  state.progress = null;
  // 先读本地镜像（离线可用）
  const local = readLocal();
  state.wrong = Array.isArray(local.wrong) ? local.wrong : [];
  state.fav = Array.isArray(local.fav) ? local.fav : [];
  state.progress = local.progress || null;
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
        state.progress = data.progress || null;
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
export function clearProgress() {
  state.progress = null;
  persistLocal();
  scheduleFlush();
}
export function saveProgress(obj) {
  state.progress = obj;
  persistLocal();
  scheduleFlush();
}
export function loadProgress() {
  return state.progress;
}

export function resetState() {
  state.cloud = false;
  state.bankId = null;
  state.wrong = [];
  state.fav = [];
  state.progress = null;
}

// 本地开发调试钩子（生产构建会被剔除），供 scripts/check_resume.mjs 验收使用
if (import.meta.env.DEV) {
  window.__store = { loadBankState, saveProgress, loadProgress, clearProgress, LS };
}
