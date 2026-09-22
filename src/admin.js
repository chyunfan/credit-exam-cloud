import { apiCandidates } from './auth.js';
import { getToken } from './supabase.js';

// ============================================================
// 当前登录者的身份资料 + 用户管理界面（仅管理员）
// ------------------------------------------------------------
// 身份资料来自 /api/me（服务端读 exam_accounts 返回）。
// 这里的 isAdmin 只用于「界面显示哪些按钮」，真正的权限判定在
// 数据库 RLS 与 /api/admin-users 里各自独立校验，前端改不了。
// ============================================================

let me = null;          // { id, username, isAdmin, dept, role }
let users = [];         // 用户列表缓存（同时作为「部门 / 角色」候选来源）
let onBack = null;
let onShow = null;
let onMeChange = null;
let _inited = false;

export function getMe() { return me; }
export function isAdmin() { return !!(me && me.isAdmin); }
export function getKnownUsers() { return users; }

/** 从缓存里取出出现过的部门 / 角色（去重、按出现次数排序） */
export function knownTags() {
  const tally = list => {
    const m = new Map();
    list.forEach(v => { const s = String(v || '').trim(); if (s) m.set(s, (m.get(s) || 0) + 1); });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  };
  return {
    depts: tally(users.map(u => u.dept)),
    roles: tally(users.map(u => u.role))
  };
}

/**
 * 带令牌的接口请求。沿用登录接口那套「多候选地址回退」：
 * 子路径代理下接口是 /credit-exam-cloud/api/xxx，直连 Vercel 时是 /api/xxx。
 */
export async function apiRequest(method, path, body, needAuth = true) {
  const urls = apiCandidates(path);
  let lastErr = null;

  for (const url of urls) {
    let resp;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (needAuth && getToken()) headers.Authorization = 'Bearer ' + getToken();
      resp = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (e) { lastErr = new Error('网络不可达：' + url); continue; }

    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = null; }
    if (data === null) { lastErr = new Error('接口未就绪（HTTP ' + resp.status + '）：' + url); continue; }
    if (!resp.ok) throw new Error(data.error || ('请求失败（HTTP ' + resp.status + '）'));
    return data;
  }
  throw lastErr || new Error('接口不可用');
}

/** 拉取自己的资料；失败（未登录 / 接口未部署）时降级为「非管理员」，不影响练习 */
export async function loadMe() {
  if (!getToken()) { me = null; return null; }
  try { me = await apiRequest('GET', '/api/me'); }
  catch (e) { me = null; }
  return me;
}

/** 确保用户列表已加载（可见范围弹窗要用它给出「常用部门 / 角色」候选） */
export async function ensureUsers() {
  if (users.length || !isAdmin()) return users;
  try {
    const d = await apiRequest('GET', '/api/admin-users');
    users = d.users || [];
  } catch (e) { /* 拉不到就只支持手工输入 */ }
  return users;
}

/** 顶部栏「用户管理」入口的显隐 */
export function applyAdminEntry() {
  const btn = document.getElementById('toAdmin');
  if (btn) btn.classList.toggle('hide', !isAdmin());
}

export function initAdmin(cb) {
  onBack = cb.onBack;
  onShow = cb.onShow;
  onMeChange = cb.onMeChange;

  if (_inited) return;
  _inited = true;

  document.getElementById('toAdmin').addEventListener('click', () => showAdmin());
  document.getElementById('userReload').addEventListener('click', () => renderAdminUsers());
  document.getElementById('userSearch').addEventListener('input', renderUserRows);
  document.getElementById('userList').addEventListener('click', onUserListClick);
}

export async function showAdmin() {
  if (!isAdmin()) return false;
  if (onShow) onShow();
  await renderAdminUsers();
  return true;
}

export async function renderAdminUsers() {
  const box = document.getElementById('userList');
  if (!box) return;
  if (!isAdmin()) { box.innerHTML = '<div class="muted" style="padding:16px 0">需要管理员权限。</div>'; return; }
  box.innerHTML = '<div class="muted" style="padding:16px 0">加载中…</div>';
  try {
    const d = await apiRequest('GET', '/api/admin-users');
    users = d.users || [];
    adminMsg('');
    renderUserRows();
  } catch (e) {
    box.innerHTML = '<div class="feedback no show">加载用户失败：' + esc(e.message) + '</div>';
  }
}

function renderUserRows() {
  const box = document.getElementById('userList');
  const kw = (document.getElementById('userSearch').value || '').trim().toLowerCase();
  const list = users.filter(u => {
    if (!kw) return true;
    return (u.username || '').toLowerCase().includes(kw)
      || (u.dept || '').toLowerCase().includes(kw)
      || (u.role || '').toLowerCase().includes(kw);
  });

  const admins = users.filter(u => u.isAdmin).length;
  const head = '<div class="muted list-head">共 ' + users.length + ' 个账号 · 管理员 ' + admins + ' 名' +
    (kw ? '（筛选后 ' + list.length + ' 个）' : '') + '</div>';

  if (!list.length) {
    box.innerHTML = head + '<div class="muted" style="padding:14px 0">没有匹配的账号。</div>';
    return;
  }

  box.innerHTML = head + list.map(u => `
    <div class="user-row${u.isAdmin ? ' is-adm' : ''}" data-id="${esc(u.id)}">
      <div class="u-main">
        <div class="u-name">${esc(u.username)}
          ${u.isAdmin ? '<span class="u-badge">管理员</span>' : ''}
          ${u.id === (me && me.id) ? '<span class="u-badge me">我</span>' : ''}
        </div>
        <div class="muted">注册 ${fmtDate(u.createdAt)} · 题库 ${u.bankCount} 个${u.sharedCount ? '（共享 ' + u.sharedCount + '）' : ''}</div>
      </div>
      <div class="u-fields">
        <label class="u-f"><span>部门</span><input class="field u-dept" value="${esc(u.dept)}" placeholder="如：信贷部"></label>
        <label class="u-f"><span>角色</span><input class="field u-role" value="${esc(u.role)}" placeholder="如：客户经理"></label>
        <label class="u-adm"><input type="checkbox" class="u-isadmin"${u.isAdmin ? ' checked' : ''}> 管理员</label>
        <button class="btn btn-primary btn-sm u-save" type="button">保存</button>
      </div>
    </div>`).join('');
}

async function onUserListClick(e) {
  const btn = e.target.closest('.u-save');
  if (!btn) return;
  const row = btn.closest('.user-row');
  if (!row) return;
  const id = row.dataset.id;
  const before = users.find(u => u.id === id);
  if (!before) return;

  const dept = row.querySelector('.u-dept').value.trim();
  const role = row.querySelector('.u-role').value.trim();
  const isAdm = row.querySelector('.u-isadmin').checked;

  btn.disabled = true;
  btn.textContent = '保存中…';
  adminMsg('');
  try {
    const d = await apiRequest('POST', '/api/admin-users', {
      action: 'updateUser', userId: id, dept, role, isAdmin: isAdm
    });
    users = d.users || users;
    adminMsg('已保存：' + (d.updated || before.username), true);
    // 管理员名单可能变了（含把自己降级）→ 重新取一次自己的资料
    await loadMe();
    applyAdminEntry();
    if (onMeChange) onMeChange();
    renderUserRows();
    if (!isAdmin()) {
      document.getElementById('userList').innerHTML =
        '<div class="feedback warn show">你已不再拥有管理员权限，管理入口已隐藏。</div>';
      return;
    }
  } catch (err) {
    adminMsg(err.message, false, true);
    renderUserRows();
  } finally {
    btn.disabled = false;
    btn.textContent = '保存';
  }
}

function adminMsg(t, ok, bad) {
  const el = document.getElementById('adminMsg');
  if (!el) return;
  el.textContent = t || '';
  el.style.color = bad ? 'var(--bad)' : (ok ? 'var(--ok)' : '');
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  const p = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
