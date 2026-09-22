import { setToken, getToken } from './supabase.js';

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
    const path = mode === 'login' ? '/api/login' : '/api/register';
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await resp.json();
    if (!resp.ok) { msg(data.error || '操作失败', true); return; }
    if (mode === 'reg') {
      // 注册成功后自动登录
      const r2 = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const d2 = await r2.json();
      if (!r2.ok) { msg(d2.error || '注册成功但登录失败', true); return; }
      setToken(d2.token);
    } else {
      setToken(data.token);
    }
    try { localStorage.setItem('ce_user', username); } catch (e) {}
    document.getElementById('authPass').value = '';
    msg('', false);
    if (onLogin) onLogin(username);
  } catch (e) {
    msg('网络错误：' + e.message, true);
  } finally {
    btn.disabled = false;
  }
}

export function logout() {
  setToken(null);
  try { localStorage.removeItem('ce_user'); } catch (e) {}
}
