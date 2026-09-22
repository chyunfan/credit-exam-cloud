import { setToken, getToken } from './supabase.js';

// ============================================================
// 接口地址前缀
// ------------------------------------------------------------
// 本应用在 chyunfan.cn 上是「rewrites 代理」部署在 /credit-exam-cloud 子路径下，
// 浏览器地址栏 URL 不变，所以绝对路径 /api/login 会打到主站（404），
// 必须显式带上 base 前缀 /credit-exam-cloud/api/login，才能被网关转发到 Vercel 函数。
// import.meta.env.BASE_URL 即 vite.config.js 里配置的 base。
// ============================================================
const API_PREFIX = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

function apiUrl(path) {
  const p = String(path || '');
  return API_PREFIX + (p.startsWith('/') ? p : '/' + p);
}

/** 统一 POST：对「返回非 JSON」（=请求没打到后端）给出可读错误 */
async function postJSON(path, body) {
  const resp = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = null; }
  if (data === null) {
    throw new Error(resp.status === 404
      ? `接口未找到（404）：${apiUrl(path)}`
      : `接口返回非 JSON（HTTP ${resp.status}）`);
  }
  if (!resp.ok) throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);
  return data;
}

let mode = 'login';
let onLogin = null;

export function initAuth(cb) {
  onLogin = cb.onLogin;

  document.getElementById('tabLogin').addEventListener('click', () => setMode('login'));
  document.getElementById('tabReg').addEventListener('click', () => setMode('reg'));
  document.getElementById('authSubmit').addEventListener('click', submit);
  document.getElementById('authPass').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  document.getElementById('authUser').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

export function getSession() {
  return getToken() ? { token: getToken() } : null;
}

export function getUsername() {
  try { return localStorage.getItem('ce_user') || ''; } catch { return ''; }
}

function setMode(m) {
  mode = m;
  document.getElementById('tabLogin').classList.toggle('active', m === 'login');
  document.getElementById('tabReg').classList.toggle('active', m === 'reg');
  document.getElementById('authSubmit').textContent = m === 'login' ? '登录' : '注册';
  document.getElementById('authMsg').textContent = '';
}

function msg(t, bad) {
  const el = document.getElementById('authMsg');
  el.textContent = t;
  el.style.color = bad ? 'var(--bad)' : 'var(--ok)';
}

async function submit() {
  const username = document.getElementById('authUser').value.trim();
  const password = document.getElementById('authPass').value;
  if (!username || !password) { msg('请填写账号和密码', true); return; }

  const btn = document.getElementById('authSubmit');
  btn.disabled = true;
  try {
    if (mode === 'reg') {
      await postJSON('/api/register', { username, password });
      // 注册成功后自动登录
      const d2 = await postJSON('/api/login', { username, password });
      setToken(d2.token);
    } else {
      const data = await postJSON('/api/login', { username, password });
      setToken(data.token);
    }
    try { localStorage.setItem('ce_user', username); } catch (e) {}
    document.getElementById('authPass').value = '';
    msg('', false);
    if (onLogin) onLogin(username);
  } catch (e) {
    msg(e.message || '操作失败', true);
  } finally {
    btn.disabled = false;
  }
}

export function logout() {
  setToken(null);
  try { localStorage.removeItem('ce_user'); } catch (e) {}
}
